from pathlib import Path
from typing import Any

import pytest

from vidgen.config import Config
from vidgen.narration import parse_narration
from vidgen.schema import Script
from vidgen.timeline import SceneAudio, WordTime, build_timeline

NODES = {"a": {"label": "A", "at": [100, 100]}, "b": {"label": "B", "at": [500, 100]}}
CFG = Config()


def _scene(sid: str, narration: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": sid, "narration": narration, "diagram": {"nodes": NODES}, "steps": steps}


def _script(*scenes: dict[str, Any]) -> Script:
    return Script.model_validate({"title": "T", "slug": "t", "scenes": list(scenes)})


def _audio(narration: str, step: float = 0.5, duration: float | None = None) -> SceneAudio:
    words = parse_narration(narration).words
    times = [WordTime(w, i * step, i * step + 0.4) for i, w in enumerate(words)]
    return SceneAudio(path=Path("a.wav"), duration=duration if duration is not None else len(words) * step, words=times)


def _steps(narration: str, steps: list[dict[str, Any]], **audio: Any) -> list[tuple[float, float]]:
    tl = build_timeline(_script(_scene("s", narration, steps)), {"s": _audio(narration, **audio)}, CFG)
    return [(round(s.start, 6), round(s.duration, 6)) for s in tl.scenes[0].steps]


NARRATION = "the browser asks the resolver then the resolver asks the root"
#            0   1       2    3   4        5    6   7        8    9   10


def test_cue_start():
    steps = [
        {"at": "@cue:resolver", "highlight": "a"},
        {"at": "@cue:resolver+0.3", "highlight": "a"},  # the next "resolver", after the previous cue
        {"at": "@cue:browser#1-5", "highlight": "a"},  # floored at 0
        {"at": "scene_start+0.25", "highlight": "a"},
    ]
    assert [s for s, _ in _steps(NARRATION, steps)] == [2.0, 3.8, 0.0, 0.25]


def test_relative_after_end():
    steps = [
        {"at": "@cue:asks", "highlight": "a"},  # 1.0 + 1.0
        {"at": "+0.5", "show": ["b"]},  # 2.5 + 0.4
        {"at": "+0", "badge": {"text": "x", "near": "a"}},  # 2.9 + 0.6
        {"at": "+1", "group": {"nodes": ["a", "b"]}, "duration": 2.0},
    ]
    assert _steps(NARRATION, steps) == [(1.0, 1.0), (2.5, 0.4), (2.9, 0.6), (4.5, 2.0)]
    # A first step that's relative counts from the scene start.
    assert _steps(NARRATION, [{"at": "+0.5", "text": {"id": "t", "text": "x", "at": [1, 1]}}]) == [(0.5, 0.4)]


def test_arrow_gap_clamped():
    send = {"from": "a", "to": "b"}
    # Gap to the next absolute step: 2.0 -> 2.5 clamps up to 0.6; 0.5 -> 2.5 is 2.0, within [0.6, 2.5].
    assert _steps(NARRATION, [{"at": "@cue:resolver", "send": send}, {"at": "@cue:then", "hide": ["b"]}])[0] == (2.0, 0.6)
    assert _steps(NARRATION, [{"at": "@cue:browser", "send": send}, {"at": "@cue:then", "hide": ["b"]}])[0] == (0.5, 2.0)
    # Too long a gap clamps to arrow_max_s, too short to arrow_min_s.
    assert _steps(NARRATION, [{"at": "@cue:the", "send": send}, {"at": "@cue:root", "hide": ["b"]}])[0] == (0.0, 2.5)
    assert _steps(NARRATION, [{"at": "@cue:the", "send": send}, {"at": "@cue:browser", "hide": ["b"]}])[0] == (0.0, 0.6)
    # An explicit duration wins.
    assert _steps(NARRATION, [{"at": "@cue:the", "send": send, "duration": 3.0}, {"at": "@cue:root", "hide": ["b"]}])[0] == (0.0, 3.0)


def test_arrow_before_relative_uses_default():
    steps = [{"at": "@cue:the", "send": {"from": "a", "to": "b"}}, {"at": "+0.2", "hide": ["b"]}]
    assert _steps(NARRATION, steps) == [(0.0, 1.2), (1.4, 0.4)]


def test_last_arrow_to_narration_end():
    send = {"from": "a", "to": "b"}
    # Narration ends at the last word's end: 10 * 0.5 + 0.4 = 5.4.
    assert _steps(NARRATION, [{"at": "@cue:root", "send": send}]) == [(5.0, 0.6)]  # 0.4 clamps up
    assert _steps(NARRATION, [{"at": "@cue:asks#2", "send": send}]) == [(4.0, 1.4)]
    assert _steps(NARRATION, [{"at": "@cue:browser", "send": send}]) == [(0.5, 2.5)]


def test_typing_duration():
    def code(text: str, typing: bool) -> dict[str, Any]:
        return {"at": "scene_start", "code": {"id": "c", "text": text, "at": [1, 1], "typing": typing}}

    assert _steps(NARRATION, [code("x" * 50, True)]) == [(0.0, 2.0)]
    assert _steps(NARRATION, [code("x" * 5, True)]) == [(0.0, 0.4)]
    assert _steps(NARRATION, [code("x" * 500, True)]) == [(0.0, 6.0)]
    assert _steps(NARRATION, [code("x" * 500, False)]) == [(0.0, 0.4)]


def test_scene_duration_frame_aligned():
    narration = "one two"
    tl = build_timeline(
        _script(_scene("s", narration, [])), {"s": _audio(narration, duration=4.01)}, CFG
    )
    assert tl.scenes[0].duration == pytest.approx(133 / 30)  # ceil((4.01 + 0.4) * 30) / 30 = 4.433...
    assert round(tl.scenes[0].duration * 30, 9) == 133
    # Exactly on a frame stays put (no float noise adds a frame): (4.0 + 0.4) * 30 = 132.
    tl = build_timeline(_script(_scene("s", narration, [])), {"s": _audio(narration, duration=4.0)}, CFG)
    assert tl.scenes[0].duration == pytest.approx(132 / 30)
    # The last animation end counts when it's past the audio.
    steps = [{"at": "scene_start+5", "highlight": "a"}]
    tl = build_timeline(_script(_scene("s", narration, steps)), {"s": _audio(narration, duration=1.0)}, CFG)
    assert tl.scenes[0].duration == pytest.approx(6.4)


def test_offsets_cumulative():
    s1 = _scene("one", "one two", [])
    s2 = _scene("two", "three four", [])
    s3 = _scene("three", "five", [])
    audio = {
        "one": _audio("one two", duration=4.01),
        "two": _audio("three four", duration=2.0),
        "three": _audio("five", duration=1.0),
    }
    tl = build_timeline(_script(s1, s2, s3), audio, CFG)
    assert [s.id for s in tl.scenes] == ["one", "two", "three"]
    d = [s.duration for s in tl.scenes]
    assert [s.offset for s in tl.scenes] == pytest.approx([0, d[0], d[0] + d[1]])
    assert tl.total == pytest.approx(sum(d))
    assert (tl.fps, tl.width, tl.height) == (30, 1920, 1080)


def test_word_count_mismatch():
    narration = "one two three"
    bad = SceneAudio(path=Path("a.wav"), duration=2.0, words=[WordTime("one", 0, 0.4)])
    with pytest.raises(ValueError, match='scene "s": 1 word timings for 3 narration words'):
        build_timeline(_script(_scene("s", narration, [])), {"s": bad}, CFG)
