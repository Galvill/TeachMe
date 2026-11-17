"""Assembly with ffmpeg: concat, narration track, loudness, music ducking, mux, captions.

Every ffmpeg call runs from an argument list, and every output is written to a temporary
name first and renamed when ffmpeg succeeds.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from vidgen.config import Config
from vidgen.timeline import Timeline, WordTime
from vidgen.tools import find_ffmpeg, run

AUDIO_RATE = 48000
LOUD_TP = -1.5
LOUD_LRA = 11
CUE_MAX_CHARS = 42
CUE_MAX_S = 3.5
_SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]*$")


@contextmanager
def _atomic(out: Path) -> Iterator[Path]:
    """A temp path next to ``out`` (same extension, so ffmpeg picks the muxer); renamed on success."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    try:
        yield tmp
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)


def _ff(cfg: Config) -> Path:
    return find_ffmpeg(cfg)[0]


def probe_duration(path: Path, cfg: Config) -> float:
    _, ffprobe = find_ffmpeg(cfg)
    out = run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(out.stdout.decode().strip())


def concat_quote(path: Path) -> str:
    """A concat-demuxer ``file`` line: single-quoted, with ``'`` written as ``'\\''``."""
    return "file '" + str(Path(path).resolve()).replace("'", "'\\''") + "'"


def concat_video(parts: list[Path], out: Path, cfg: Config) -> None:
    """Join scene MP4s with the concat demuxer and ``-c copy`` (scenes share encoder settings)."""
    if not parts:
        raise ValueError("concat_video: no parts")
    with tempfile.TemporaryDirectory(prefix="vidgen-concat-") as tmp:
        listing = Path(tmp) / "parts.txt"
        listing.write_text("".join(concat_quote(p) + "\n" for p in parts), encoding="utf-8")
        with _atomic(out) as part:
            run([_ff(cfg), "-y", "-hide_banner", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing,
                 "-c", "copy", "-movflags", "+faststart", part])


def narration_track(tl: Timeline, out: Path, cfg: Config) -> None:
    """One 48 kHz mono WAV: each scene's audio padded (or cut) to its scene duration, in order."""
    if not tl.scenes:
        raise ValueError("narration_track: no scenes")
    cmd: list[str | Path] = [_ff(cfg), "-y", "-hide_banner", "-v", "error"]
    chains = []
    for i, s in enumerate(tl.scenes):
        cmd += ["-i", s.audio]
        chains.append(
            f"[{i}:a]aresample={AUDIO_RATE},aformat=sample_fmts=s16:channel_layouts=mono,"
            f"apad,atrim=duration={s.duration:.6f},asetpts=N/SR/TB[a{i}]"
        )
    joined = "".join(f"[a{i}]" for i in range(len(tl.scenes)))
    graph = ";".join(chains) + f";{joined}concat=n={len(tl.scenes)}:v=0:a=1[out]"
    with _atomic(out) as part:
        run([*cmd, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", "-ar", str(AUDIO_RATE),
             "-ac", "1", part])


def _last_json(text: str) -> dict:
    end = text.rfind("}")
    start = text.rfind("{", 0, end)
    while start >= 0:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            start = text.rfind("{", 0, start)
    raise ValueError("no JSON object in ffmpeg output")


def _measure(src: Path, cfg: Config, target: float) -> dict:
    proc = run([_ff(cfg), "-hide_banner", "-nostats", "-i", src, "-af",
                f"loudnorm=I={target}:TP={LOUD_TP}:LRA={LOUD_LRA}:print_format=json", "-f", "null", "-"])
    return _last_json(proc.stderr.decode("utf-8", errors="replace"))


def measure_lufs(path: Path, cfg: Config) -> float:
    """Integrated loudness of ``path`` in LUFS."""
    return float(_measure(path, cfg, -16)["input_i"])


def loudnorm(src: Path, out: Path, cfg: Config, target: float = -16) -> None:
    """Two-pass EBU R128 normalisation to ``target`` LUFS (TP -1.5, LRA 11), linear when possible."""
    m = _measure(src, cfg, target)
    af = (
        f"loudnorm=I={target}:TP={LOUD_TP}:LRA={LOUD_LRA}"
        f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
        f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    )
    with _atomic(out) as part:
        run([_ff(cfg), "-y", "-hide_banner", "-v", "error", "-i", src, "-af", af, "-ar", str(AUDIO_RATE),
             "-c:a", "pcm_s16le", part])


def mix_music(speech: Path, out: Path, cfg: Config) -> None:
    """Loop ``cfg.music`` under ``speech``, ducked by a sidechain compressor keyed on the speech.

    The result is as long as the speech. Run :func:`loudnorm` after the mix.
    """
    if cfg.music is None:
        raise ValueError("mix_music: no [music] configured")
    graph = (
        f"[0:a]aresample={AUDIO_RATE},aformat=channel_layouts=mono,asplit=2[sp][key];"
        f"[1:a]aresample={AUDIO_RATE},aformat=channel_layouts=mono,volume={cfg.music.volume_db}dB[bed];"
        "[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];"
        "[sp][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]"
    )
    with _atomic(out) as part:
        run([_ff(cfg), "-y", "-hide_banner", "-v", "error", "-i", speech, "-stream_loop", "-1", "-i",
             cfg.music.path, "-filter_complex", graph, "-map", "[out]", "-ar", str(AUDIO_RATE), "-c:a",
             "pcm_s16le", part])


def mux(video: Path, audio: Path, out: Path, cfg: Config) -> None:
    with _atomic(out) as part:
        run([_ff(cfg), "-y", "-hide_banner", "-v", "error", "-i", video, "-i", audio, "-map", "0:v:0", "-map",
             "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", part])


def _stamp(t: float) -> str:
    ms = max(0, int(round(t * 1000)))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def caption_cues(tl: Timeline) -> list[tuple[float, float, str]]:
    """``(start, end, text)`` cues: break at sentence ends, 42 characters or 3.5 s; never across scenes."""
    cues: list[tuple[float, float, str]] = []
    for s in tl.scenes:
        cur: list[WordTime] = []

        def flush() -> None:
            if cur:
                cues.append((s.offset + cur[0].start, s.offset + cur[-1].end, " ".join(w.text for w in cur)))
                cur.clear()

        for w in s.words:
            if cur:
                too_long = len(" ".join(x.text for x in cur)) + 1 + len(w.text) > CUE_MAX_CHARS
                too_slow = w.end - cur[0].start > CUE_MAX_S
                if too_long or too_slow:
                    flush()
            cur.append(w)
            if _SENTENCE_END.search(w.text):
                flush()
        flush()
    return cues


def write_srt(tl: Timeline, out: Path) -> None:
    blocks = [f"{i}\n{_stamp(a)} --> {_stamp(b)}\n{text}\n" for i, (a, b, text) in enumerate(caption_cues(tl), 1)]
    Path(out).write_text("\n".join(blocks), encoding="utf-8")


def burn_captions(video: Path, srt: Path, out: Path, cfg: Config) -> None:
    """Re-encode ``video`` with ``srt`` burned in (audio copied)."""
    from vidgen.render import video_encoder_args

    # The subtitles filter takes a filter-graph string; a fixed name in a temp cwd avoids escaping paths.
    with tempfile.TemporaryDirectory(prefix="vidgen-burn-") as tmp:
        shutil.copyfile(srt, Path(tmp) / "captions.srt")
        with _atomic(out) as part:
            run([_ff(cfg), "-y", "-hide_banner", "-v", "error", "-i", Path(video).resolve(), "-vf",
                 "subtitles=captions.srt", *video_encoder_args(cfg), "-pix_fmt", "yuv420p", "-c:a", "copy",
                 "-movflags", "+faststart", part.resolve()], cwd=Path(tmp))
