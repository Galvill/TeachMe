import json
from pathlib import Path

from vidgen.config import Config
from vidgen.contracts import dumps, effective_nodes, scene_json, timeline_json
from vidgen.narration import parse_narration
from vidgen.schema import Script, load_script
from vidgen.timeline import SceneAudio, WordTime, build_timeline

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN = FIXTURES / "dns-mini.intro.scene.json"


def _audio(script: Script) -> dict[str, SceneAudio]:
    """Fake audio: one word every 0.3 s, each 0.25 s long."""
    out = {}
    for scene in script.scenes:
        words = parse_narration(scene.narration).words
        times = [WordTime(w, round(i * 0.3, 6), round(i * 0.3 + 0.25, 6)) for i, w in enumerate(words)]
        out[scene.id] = SceneAudio(path=Path(f"/work/{scene.id}.wav"), duration=len(words) * 0.3, words=times)
    return out


def _build(cfg: Config = Config()):
    script = load_script(FIXTURES / "dns-mini.yaml")
    return script, build_timeline(script, _audio(script), cfg)


def test_scene_json_shape():
    script, tl = _build()
    got = scene_json(script, tl, "intro", Config())
    assert got == json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert dumps(got) == GOLDEN.read_text(encoding="utf-8")

    tj = timeline_json(tl)
    assert set(tj) == {"version", "fps", "width", "height", "total", "scenes"}
    first = tj["scenes"][0]
    assert set(first) == {"id", "offset", "duration", "audio", "words", "steps"}
    assert first["audio"] == "/work/intro.wav"
    assert first["words"][0] == {"text": "Before", "start": 0.0, "end": 0.25}
    assert set(first["steps"][0]) == {"index", "start", "duration"}
    assert tj["scenes"][1]["offset"] == first["duration"]


def test_inherit_visibility():
    script = load_script(FIXTURES / "dns-mini.yaml")
    intro, intro_layout = effective_nodes(script, "intro")
    assert intro["root"]["hidden"] is True
    nodes, layout = effective_nodes(script, "ask-root")
    # Inherited with root's state at the end of intro (its `show` step ran), plus the new node.
    assert set(nodes) == {"browser", "resolver", "root", "tld"}
    assert nodes["root"]["hidden"] is False
    assert nodes["browser"] == intro["browser"]
    assert nodes["tld"] == {"label": ".com TLD", "sub": None, "at": [1500, 345], "size": None, "hidden": False}
    assert layout == intro_layout == {"row": ["browser", "resolver"]}

    # A hide in the inherited scene carries over; the scene's own node overrides the inherited one.
    data = script.model_dump(by_alias=True)
    data["scenes"][0]["steps"].append({"at": "+0", "hide": ["browser"]})
    data["scenes"][1]["diagram"]["nodes"]["root"] = {"label": "Root (moved)", "at": [1060, 600], "hidden": True}
    nodes, _ = effective_nodes(Script.model_validate(data), "ask-root")
    assert nodes["browser"]["hidden"] is True
    assert nodes["root"] == {"label": "Root (moved)", "sub": None, "at": [1060, 600], "size": None, "hidden": True}


def test_draft_size():
    cfg = Config(draft=True)
    script, tl = _build(cfg)
    got = scene_json(script, tl, "ask-root", cfg)
    assert (got["width"], got["height"]) == (1280, 720)
    assert got["design"] == [1920, 1080]
    assert (tl.width, tl.height) == (1280, 720)
    assert (timeline_json(tl)["width"], timeline_json(tl)["height"]) == (1280, 720)


def test_byte_stable():
    a_script, a_tl = _build()
    b_script, b_tl = _build()
    for sid in ("intro", "ask-root"):
        a = dumps(scene_json(a_script, a_tl, sid, Config()))
        b = dumps(scene_json(b_script, b_tl, sid, Config()))
        assert a == b
        # Key order in the dict doesn't matter: sort_keys fixes it.
        shuffled = dict(reversed(list(json.loads(a).items())))
        assert dumps(shuffled) == a
    assert dumps(timeline_json(a_tl)) == dumps(timeline_json(b_tl))
