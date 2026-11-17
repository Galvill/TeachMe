import subprocess
from pathlib import Path

import pytest

from conftest import needs_ffmpeg
from vidgen.assemble import (
    burn_captions,
    caption_cues,
    concat_quote,
    concat_video,
    loudnorm,
    measure_lufs,
    mix_music,
    mux,
    narration_track,
    probe_duration,
    write_srt,
)
from vidgen.config import Config, Encoder, Music
from vidgen.timeline import SceneTime, Timeline, WordTime

CFG = Config(encoder=Encoder(codec="libx264", preset="ultrafast"))
FRAME = 1 / 30


def _ffmpeg(*args: str | Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-v", "error", *map(str, args)], check=True)


def _clip(path: Path, seconds: float) -> Path:
    _ffmpeg("-f", "lavfi", "-i", f"testsrc=size=320x180:rate=30:duration={seconds}", "-c:v", "libx264",
            "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30", path)
    return path


def _tone(path: Path, seconds: float, volume: float = 0.1, freq: int = 440, rate: int = 24000) -> Path:
    _ffmpeg("-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate={rate}:duration={seconds}",
            "-af", f"volume={volume}", "-ac", "1", path)
    return path


def _scene(sid: str, offset: float, duration: float, audio: Path, words: list[WordTime] = ()) -> SceneTime:
    return SceneTime(id=sid, offset=offset, duration=duration, audio=audio, words=list(words), steps=[])


@needs_ffmpeg
def test_concat_duration(tmp_path):
    a = _clip(tmp_path / "a.mp4", 1.0)
    b = _clip(tmp_path / "b.mp4", 2.0)
    out = tmp_path / "out.mp4"
    concat_video([a, b], out, CFG)
    assert probe_duration(out, CFG) == pytest.approx(3.0, abs=FRAME)


@needs_ffmpeg
def test_concat_quote_path(tmp_path):
    assert concat_quote(Path("/x/it's.mp4")) == "file '/x/it'\\''s.mp4'"
    odd = tmp_path / "it's a scene"
    odd.mkdir()
    a = _clip(odd / "o'ne.mp4", 1.0)
    concat_video([a, a], tmp_path / "out.mp4", CFG)
    assert probe_duration(tmp_path / "out.mp4", CFG) == pytest.approx(2.0, abs=FRAME)


@needs_ffmpeg
def test_narration_length(tmp_path):
    # Audio shorter than the scene is padded; longer is cut.
    a = _tone(tmp_path / "a.wav", 1.2)
    b = _tone(tmp_path / "b.wav", 3.0, rate=44100)
    tl = Timeline(fps=30, width=1280, height=720, total=3.6,
                  scenes=[_scene("a", 0.0, 1.6, a), _scene("b", 1.6, 2.0, b)])
    out = tmp_path / "narration.wav"
    narration_track(tl, out, CFG)
    assert probe_duration(out, CFG) == pytest.approx(tl.total, abs=FRAME)
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate,channels", "-of",
                           "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout.strip()
    assert info == "48000,1"


@needs_ffmpeg
def test_loudnorm_target(tmp_path):
    src = _tone(tmp_path / "quiet.wav", 6.0, volume=0.02)
    assert measure_lufs(src, CFG) < -25
    out = tmp_path / "norm.wav"
    loudnorm(src, out, CFG)
    assert measure_lufs(out, CFG) == pytest.approx(-16, abs=1)
    assert probe_duration(out, CFG) == pytest.approx(6.0, abs=FRAME)


@needs_ffmpeg
def test_music_ducked_shorter_than_speech_ok(tmp_path):
    speech = _tone(tmp_path / "speech.wav", 4.0, volume=0.3)
    music = _tone(tmp_path / "music.wav", 1.0, volume=0.5, freq=220)
    cfg = CFG.model_copy(update={"music": Music(path=music, volume_db=-20)})
    mixed = tmp_path / "mixed.wav"
    mix_music(speech, mixed, cfg)
    assert probe_duration(mixed, cfg) == pytest.approx(4.0, abs=FRAME)
    loudnorm(mixed, tmp_path / "final.wav", cfg)
    assert measure_lufs(tmp_path / "final.wav", cfg) == pytest.approx(-16, abs=1)
    with pytest.raises(ValueError, match="no \\[music\\]"):
        mix_music(speech, mixed, CFG)


@needs_ffmpeg
def test_mux_and_burn(tmp_path):
    video = _clip(tmp_path / "v.mp4", 2.0)
    audio = _tone(tmp_path / "a.wav", 2.0)
    out = tmp_path / "video.mp4"
    mux(video, audio, out, CFG)
    streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0",
                              str(out)], capture_output=True, text=True, check=True).stdout.split()
    assert streams == ["h264", "aac"]
    words = [WordTime("Hello", 0.1, 0.5), WordTime("there.", 0.6, 1.0)]
    tl = Timeline(fps=30, width=320, height=180, total=2.0, scenes=[_scene("s", 0.0, 2.0, audio, words)])
    srt = tmp_path / "it's.srt"
    write_srt(tl, srt)
    burn_captions(out, srt, tmp_path / "video.burned.mp4", CFG)
    assert probe_duration(tmp_path / "video.burned.mp4", CFG) == pytest.approx(2.0, abs=0.1)
    assert not list(tmp_path.glob("*.part.*"))


def test_srt_chunking(tmp_path):
    def words(text: str, start: float, step: float) -> list[WordTime]:
        return [WordTime(w, round(start + i * step, 3), round(start + i * step + step * 0.8, 3))
                for i, w in enumerate(text.split())]

    s1 = words("Short one. And this is a much longer sentence that has to wrap somewhere soon", 0.0, 0.2)
    s2 = words("slow words here then more", 0.0, 1.0)
    tl = Timeline(fps=30, width=1920, height=1080, total=20.0,
                  scenes=[_scene("a", 0.0, 10.0, Path("a.wav"), s1), _scene("b", 10.0, 10.0, Path("b.wav"), s2)])
    cues = caption_cues(tl)
    texts = [c[2] for c in cues]
    assert texts[0] == "Short one."  # sentence end
    assert all(len(t) <= 42 for t in texts)
    assert " ".join(texts[1:3]).startswith("And this is a much longer sentence")
    # 3.5 s cap: "then" would end the cue at 3.8 s, so it starts the next; the scene offset is added.
    b_cues = [c for c in cues if c[0] >= 10.0]
    assert [c[2] for c in b_cues] == ["slow words here", "then more"]
    assert b_cues[0][0] == 10.0 and b_cues[0][1] == pytest.approx(12.8)
    # Cues never cross scenes.
    assert cues[len(cues) - len(b_cues) - 1][1] < 10.0

    out = tmp_path / "c.srt"
    write_srt(tl, out)
    text = out.read_text()
    assert text.startswith("1\n00:00:00,000 --> 00:00:00,360\nShort one.\n\n2\n")
    assert "00:00:10,000 --> 00:00:12,800\nslow words here\n" in text
