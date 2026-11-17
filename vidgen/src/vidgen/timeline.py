"""Cue resolution, step timing and scene durations.

Narration time is fixed; animations are placed on it. All functions here are pure.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from vidgen.config import Config
from vidgen.narration import find_cue, parse_narration
from vidgen.schema import Scene, Script, Step

# Default animation durations (seconds) per action, when a step sets no `duration`.
DEFAULT_DURATIONS = {"highlight": 1.0, "show": 0.4, "hide": 0.4, "text": 0.4, "badge": 0.6, "group": 0.6, "code": 0.4}
TYPING_CHARS_PER_S = 25.0
TYPING_MIN_S = 0.4
TYPING_MAX_S = 6.0


@dataclass(frozen=True)
class WordTime:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class SceneAudio:
    path: Path
    duration: float
    words: list[WordTime]  # 1:1 with Narration.words


@dataclass(frozen=True)
class StepTime:
    index: int
    start: float
    duration: float


@dataclass(frozen=True)
class SceneTime:
    id: str
    offset: float
    duration: float
    audio: Path
    words: list[WordTime]
    steps: list[StepTime]


@dataclass(frozen=True)
class Timeline:
    fps: int
    width: int
    height: int
    scenes: list[SceneTime]
    total: float


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _frame_ceil(seconds: float, fps: int) -> float:
    # Round first so float noise (4.4 * 30 = 132.00000000000003) doesn't add a frame.
    return math.ceil(round(seconds * fps, 6)) / fps


def _absolute_starts(scene: Scene, audio: SceneAudio) -> list[float | None]:
    """Pass 1: the start of every scene_start and @cue step; None for +N steps."""
    narration = parse_narration(scene.narration)
    starts: list[float | None] = []
    after: int | None = None
    for step in scene.steps:
        when = step.when
        if when.kind == "rel":
            starts.append(None)
        elif when.kind == "start":
            starts.append(max(0.0, when.offset))
        else:
            assert when.name is not None
            after = find_cue(narration, when.name, when.occurrence, after)
            starts.append(max(0.0, audio.words[after].start + when.offset))
    return starts


def _default_duration(step: Step) -> float:
    name, _ = step.action
    if name == "code":
        assert step.code is not None
        if step.code.typing:
            return _clamp(len(step.code.text) / TYPING_CHARS_PER_S, TYPING_MIN_S, TYPING_MAX_S)
    return DEFAULT_DURATIONS[name]


def _scene_steps(scene: Scene, audio: SceneAudio, cfg: Config) -> list[StepTime]:
    starts = _absolute_starts(scene, audio)
    narration_end = audio.words[-1].end if audio.words else audio.duration
    out: list[StepTime] = []
    for i, step in enumerate(scene.steps):
        known = starts[i]
        if known is None:
            prev_end = out[-1].start + out[-1].duration if out else 0.0
            start = prev_end + step.when.rel
        else:
            start = known
        if step.duration is not None:
            duration = step.duration
        elif step.send is not None:
            if i + 1 < len(scene.steps):
                nxt = starts[i + 1]
                if nxt is None:
                    duration = cfg.arrow_default_s
                else:
                    duration = _clamp(nxt - start, cfg.arrow_min_s, cfg.arrow_max_s)
            else:
                duration = _clamp(narration_end - start, cfg.arrow_min_s, cfg.arrow_max_s)
        else:
            duration = _default_duration(step)
        out.append(StepTime(index=i, start=start, duration=duration))
    return out


def build_timeline(script: Script, audio: dict[str, SceneAudio], cfg: Config) -> Timeline:
    """Resolve every step's start and duration and every scene's length and offset.

    ``audio`` maps scene id to its synthesized audio, whose ``words`` are 1:1 with the
    scene's narration words. Scene durations are rounded up to whole frames.
    """
    scenes: list[SceneTime] = []
    offset = 0.0
    for scene in script.scenes:
        if scene.id not in audio:
            raise ValueError(f'scene "{scene.id}": no audio')
        sa = audio[scene.id]
        expected = len(parse_narration(scene.narration).words)
        if len(sa.words) != expected:
            raise ValueError(
                f'scene "{scene.id}": {len(sa.words)} word timings for {expected} narration words'
            )
        steps = _scene_steps(scene, sa, cfg)
        last_end = max((s.start + s.duration for s in steps), default=0.0)
        duration = _frame_ceil(max(sa.duration, last_end) + cfg.scene_pad_s, cfg.fps)
        scenes.append(
            SceneTime(id=scene.id, offset=offset, duration=duration, audio=sa.path, words=list(sa.words), steps=steps)
        )
        offset = round((offset + duration) * cfg.fps) / cfg.fps  # stay on whole frames
    width, height = cfg.output_size()
    return Timeline(fps=cfg.fps, width=width, height=height, scenes=scenes, total=offset)
