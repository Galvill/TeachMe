"""Build orchestration: TTS, alignment, timeline, lint, render, assemble, ``build.json``.

Every expensive step is cached by content hash under ``<cfg.paths.cache>/objects``:

- TTS: ``key(spoken text, endpoint, model, voice, extra, seed)``
- alignment: ``key(tts key, align endpoint, model)``
- scene video: ``key(scene JSON, sha256 of renderer dist/, encoder args, ssaa)``

so an unchanged rebuild calls no endpoint and renders no scene.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from vidgen import __version__
from vidgen.align import AlignError, AsrWord, aligner_from_config, map_words
from vidgen.assemble import burn_captions, concat_video, loudnorm, mix_music, mux, narration_track, probe_duration, write_srt
from vidgen.cache import Cache, build_dir, key, objects_root
from vidgen.config import Config
from vidgen.contracts import dumps, scene_json, timeline_json
from vidgen.narration import parse_narration, to_spoken
from vidgen.render import LintReport, frames, lint, render_scene, video_encoder_args
from vidgen.schema import Script, load_script, script_hash
from vidgen.timeline import SceneAudio, Timeline, build_timeline
from vidgen.tools import renderer_dir
from vidgen.tts.engine import engine_from_config

BUILD_JSON_VERSION = 1
PREVIEW_DEFAULT_COUNT = 3


class BuildUsageError(ValueError):
    """A bad command argument: an unknown scene, a preview time outside the video."""


class LintFailed(Exception):
    """One or more scenes have lint issues; nothing was rendered."""

    def __init__(self, issues: list[dict]) -> None:
        self.issues = issues
        super().__init__("\n".join(format_issue(i) for i in issues))


def format_issue(issue: dict) -> str:
    return f"scene {issue.get('scene')} t={float(issue.get('t', 0)):.2f} {issue.get('kind')}: {issue.get('message')}"


@dataclass
class SynthStats:
    synthesized: list[str] = field(default_factory=list)  # scene ids sent to the TTS endpoint
    aligned: list[str] = field(default_factory=list)  # scene ids sent to the alignment endpoint


@dataclass
class BuildResult:
    dir: Path
    build_json: Path
    video: Path
    captions: Path
    poster: Path
    timeline: Path
    burned: Path | None
    duration: float
    rendered: list[str] = field(default_factory=list)  # scene ids rendered this run
    reused: list[str] = field(default_factory=list)  # scene ids taken from the cache
    synth: SynthStats = field(default_factory=SynthStats)


def _cache(cfg: Config) -> Cache:
    return Cache(objects_root(cfg.paths.cache))


def _voice(script: Script, default: str) -> str:
    return script.voice if script.voice != "default" else default


def _synthesize(script: Script, cfg: Config) -> tuple[dict[str, SceneAudio], SynthStats]:
    cache = _cache(cfg)
    engine = engine_from_config(cfg)
    tts_ep = cfg.tts.endpoints[engine.name]
    aligner = aligner_from_config(cfg)
    pron = {**cfg.pronunciations, **script.pronunciations}
    voice = _voice(script, tts_ep.voice)
    stats = SynthStats()
    out: dict[str, SceneAudio] = {}
    for scene in script.scenes:
        n = parse_narration(scene.narration)
        spoken = to_spoken(n, pron)
        tts_key = key(spoken.text, engine.name, tts_ep.model, voice, tts_ep.extra, script.seed)
        wav = cache.path("tts", tts_key, "wav")
        if not wav.is_file():
            cache.write(wav, engine.synthesize(spoken.text, voice, script.seed))
            stats.synthesized.append(scene.id)
        duration = probe_duration(wav, cfg)

        align_key = key(tts_key, aligner.name, aligner.endpoint.model)
        words_file = cache.path("align", align_key, "json")
        if words_file.is_file():
            asr = [AsrWord(**w) for w in json.loads(words_file.read_text(encoding="utf-8"))]
        else:
            asr = aligner.words(wav, language=script.language)
            payload = [{"text": w.text, "start": w.start, "end": w.end} for w in asr]
            cache.write(words_file, json.dumps(payload).encode("utf-8"))
            stats.aligned.append(scene.id)
        try:
            words = map_words(asr, spoken, n, duration)
        except AlignError as e:
            raise AlignError(f"scene {scene.id}: {e}") from None
        out[scene.id] = SceneAudio(path=wav, duration=duration, words=words)
    return out, stats


def synthesize_all(script: Script, cfg: Config) -> dict[str, SceneAudio]:
    """TTS and alignment for every scene (cached), as ``build_timeline`` wants them."""
    return _synthesize(script, cfg)[0]


def renderer_hash(cfg: Config) -> str:
    """sha256 over the renderer's ``dist/`` (paths and contents), part of the scene cache key."""
    dist = renderer_dir(cfg) / "dist"
    h = hashlib.sha256()
    for p in sorted(dist.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(dist).as_posix().encode() + b"\0")
            h.update(p.read_bytes() + b"\0")
    return h.hexdigest()


@dataclass
class _Prepared:
    script: Script
    cfg: Config
    timeline: Timeline
    scenes: dict[str, dict]  # scene id -> scene JSON
    synth: SynthStats


def _prepare(script_path: Path, cfg: Config) -> _Prepared:
    script = load_script(Path(script_path))
    audio, stats = _synthesize(script, cfg)
    tl = build_timeline(script, audio, cfg)
    scenes = {s.id: scene_json(script, tl, s.id, cfg) for s in script.scenes}
    return _Prepared(script, cfg, tl, scenes, stats)


def lint_all(cfg: Config, scenes: dict[str, dict]) -> dict[str, LintReport]:
    """Lint every scene; raise :class:`LintFailed` with all issues if any scene has one."""
    reports = {sid: lint(cfg, sj) for sid, sj in scenes.items()}
    issues = [i for r in reports.values() for i in r.issues]
    if issues:
        raise LintFailed(issues)
    return reports


def _scene_video(p: _Prepared, sid: str, enc_args: list[str], rhash: str) -> tuple[Path, bool]:
    """The cached MP4 for scene ``sid``, rendering it if needed; ``(path, rendered)``."""
    cache = _cache(p.cfg)
    k = key(p.scenes[sid], rhash, enc_args, p.cfg.ssaa)
    path = cache.path("scene", k, "mp4")
    if path.is_file():
        return path, False
    render_scene(p.cfg, p.scenes[sid], path)
    return path, True


def _out_dir(script: Script, cfg: Config, out: Path | None) -> Path:
    d = Path(out) if out is not None else build_dir(cfg.paths.cache, script.slug)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _scene_file(script: Script, sid: str) -> str:
    index = [s.id for s in script.scenes].index(sid) + 1
    return f"{index:02d}-{sid}.mp4"


def _densest_global(p: _Prepared, reports: dict[str, LintReport]) -> list[tuple[str, float, int]]:
    """``(scene id, local t, labels)`` across all scenes, most labels first, then earliest."""
    offsets = {s.id: s.offset for s in p.timeline.scenes}
    rows = [(sid, float(d["t"]), int(d["labels"])) for sid, r in reports.items() for d in r.densest]
    rows.sort(key=lambda r: (-r[2], offsets[r[0]] + r[1]))
    return rows


def build(script_path: Path, cfg: Config, out: Path | None = None, burn: bool = False) -> BuildResult:
    p = _prepare(script_path, cfg)
    reports = lint_all(cfg, p.scenes)  # before any render

    enc_args = video_encoder_args(cfg)
    rhash = renderer_hash(cfg)
    rendered: list[str] = []
    reused: list[str] = []
    parts: list[Path] = []
    for s in p.script.scenes:
        path, did = _scene_video(p, s.id, enc_args, rhash)
        (rendered if did else reused).append(s.id)
        parts.append(path)

    d = _out_dir(p.script, cfg, out)
    video = d / "video.mp4"
    captions = d / "captions.srt"
    poster = d / "poster.png"
    timeline_file = d / "timeline.json"
    with tempfile.TemporaryDirectory(prefix="vidgen-build-", dir=d) as tmp:
        work = Path(tmp)
        concat_video(parts, work / "video.silent.mp4", cfg)
        narration_track(p.timeline, work / "narration.wav", cfg)
        speech = work / "narration.wav"
        if cfg.music is not None:
            mix_music(speech, work / "mixed.wav", cfg)
            speech = work / "mixed.wav"
        loudnorm(speech, work / "audio.wav", cfg)
        mux(work / "video.silent.mp4", work / "audio.wav", video, cfg)

        write_srt(p.timeline, captions)
        timeline_file.write_text(dumps(timeline_json(p.timeline)), encoding="utf-8")

        densest = _densest_global(p, reports)
        if densest:
            sid, t, _ = densest[0]
        else:
            sid, t = p.script.scenes[0].id, 0.0
        shot = frames(cfg, p.scenes[sid], [t], work / "poster")
        shutil.copyfile(shot[0], poster)

    burned: Path | None = None
    if burn:
        burned = d / "video.burned.mp4"
        burn_captions(video, captions, burned, cfg)

    files = {"video": video.name, "captions": captions.name, "poster": poster.name, "timeline": timeline_file.name}
    if burned is not None:
        files["burned"] = burned.name
    tts_name = cfg.tts.endpoint or next(iter(cfg.tts.endpoints))
    tts_ep = cfg.tts.endpoints[tts_name]
    meta = {
        "version": BUILD_JSON_VERSION,
        "slug": p.script.slug,
        "title": p.script.title,
        "scriptHash": script_hash(p.script),
        "syncedCommit": p.script.syncedCommit,
        "sources": list(p.script.sources),
        "draft": cfg.draft,
        "durationSec": round(p.timeline.total, 3),
        "width": p.timeline.width,
        "height": p.timeline.height,
        "language": p.script.language,
        "tts": {"endpoint": tts_name, "model": tts_ep.model, "voice": _voice(p.script, tts_ep.voice),
                "license": tts_ep.license},
        "vidgenVersion": __version__,
        "files": files,
    }
    build_json = d / "build.json"
    build_json.write_text(dumps(meta), encoding="utf-8")  # last: its presence means the build finished
    return BuildResult(dir=d, build_json=build_json, video=video, captions=captions, poster=poster,
                       timeline=timeline_file, burned=burned, duration=p.timeline.total, rendered=rendered,
                       reused=reused, synth=p.synth)


def resolve_scene(script: Script, scene: str) -> str:
    """A scene id from an id or a 1-based number."""
    ids = [s.id for s in script.scenes]
    if scene in ids:
        return scene
    if scene.isdigit() and 1 <= int(scene) <= len(ids):
        return ids[int(scene) - 1]
    raise BuildUsageError(f'no scene "{scene}" (ids: {", ".join(ids)}; or a number from 1 to {len(ids)})')


def render_one(script_path: Path, cfg: Config, scene: str, out: Path | None = None) -> Path:
    """Render one scene (by id or 1-based number) to ``<build dir>/scenes/NN-<id>.mp4``."""
    sid = resolve_scene(load_script(Path(script_path)), scene)  # fail before any endpoint call
    p = _prepare(script_path, cfg)
    lint_all(cfg, {sid: p.scenes[sid]})
    path, _ = _scene_video(p, sid, video_encoder_args(cfg), renderer_hash(cfg))
    dest = _out_dir(p.script, cfg, out) / "scenes" / _scene_file(p.script, sid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    return dest


def to_local(tl: Timeline, t: float) -> tuple[str, float]:
    """Map a whole-video time to ``(scene id, scene-local time)``."""
    if t < 0 or t > tl.total + 1e-9:
        raise BuildUsageError(f"time {t:g} s is outside the video (0 to {tl.total:g} s)")
    for s in tl.scenes:
        if t < s.offset + s.duration:
            return s.id, max(0.0, round(t - s.offset, 6))
    last = tl.scenes[-1]
    return last.id, round(last.duration - 1 / tl.fps, 6)


def preview(script_path: Path, cfg: Config, times: list[float], out: Path | None = None) -> list[Path]:
    """PNG frames at whole-video ``times`` (default: the 3 densest moments), without encoding."""
    p = _prepare(script_path, cfg)
    if times:
        wanted = [to_local(p.timeline, t) for t in times]
    else:
        reports = {sid: lint(cfg, sj) for sid, sj in p.scenes.items()}
        wanted = [(sid, t) for sid, t, _ in _densest_global(p, reports)[:PREVIEW_DEFAULT_COUNT]]
        if not wanted:
            wanted = [(p.script.scenes[0].id, 0.0)]
    out_dir = _out_dir(p.script, cfg, out) / "preview"
    paths: list[Path] = []
    for sid, t in wanted:
        paths += frames(cfg, p.scenes[sid], [t], out_dir)
    return paths
