from pathlib import Path

import pytest

from vidgen.schema import At, Highlight, ScriptError, Send, load_script, parse_at, script_hash

FIXTURES = Path(__file__).parent / "fixtures"

BASE = """\
title: T
scenes:
  - id: intro
    narration: "Ask the resolver now"
    diagram:
      nodes:
        a: {label: A, at: [100, 100]}
        b: {label: B, at: [500, 100]}
    steps:
"""


def _script(tmp_path: Path, body: str, name: str = "s.yaml") -> Path:
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return p


def _issues(path: Path) -> list[str]:
    with pytest.raises(ScriptError) as err:
        load_script(path)
    return [str(i) for i in err.value.issues]


def test_valid_fixture():
    s = load_script(FIXTURES / "dns-mini.yaml")
    assert s.title == "How a DNS lookup works"
    assert s.slug == "dns-mini"
    assert s.seed == 7
    assert s.syncedCommit == "3f2a9c1"
    assert [sc.id for sc in s.scenes] == ["intro", "ask-root"]
    intro = s.scenes[0]
    assert intro.diagram.nodes["browser"].at == (170, 345)
    assert intro.diagram.nodes["root"].hidden is True
    name, hl = intro.steps[0].action
    assert name == "highlight" and isinstance(hl, Highlight) and hl.node == "browser" and hl.pulse
    name, send = intro.steps[1].action
    assert name == "send" and isinstance(send, Send)
    assert (send.from_, send.to, send.kind) == ("browser", "resolver", "request")
    assert intro.steps[2].action[0] == "show"
    assert s.scenes[1].steps[3].action[0] == "code"


def test_yaml_12_keys_stay_strings(tmp_path):
    p = _script(tmp_path, BASE.replace("a: {label: A", "no: {label: No").replace("b: {label: B", "on: {label: On")
                + '      - at: scene_start\n        send: {from: "no", to: "on"}\n')
    s = load_script(p)
    assert set(s.scenes[0].diagram.nodes) == {"no", "on"}


def test_unknown_field(tmp_path):
    p = _script(tmp_path, BASE + "      - at: scene_start\n        send: {from: a, to: b, knd: reply}\n")
    assert _issues(p) == ["scenes[intro].steps[0].send.knd: unknown field"]
    p = _script(tmp_path, "titel: T\n" + BASE)
    assert "titel: unknown field" in _issues(p)


def test_step_action_count(tmp_path):
    p = _script(tmp_path, BASE + "      - at: scene_start\n        caption: nothing\n")
    assert _issues(p) == [
        "scenes[intro].steps[0]: a step needs exactly one action "
        "(send, highlight, show, hide, badge, group, text, code); found none"
    ]
    p = _script(tmp_path, BASE + "      - at: scene_start\n        highlight: a\n        show: [b]\n")
    assert _issues(p) == [
        "scenes[intro].steps[0]: a step needs exactly one action "
        "(send, highlight, show, hide, badge, group, text, code); found highlight, show"
    ]


def test_at_grammar(tmp_path):
    assert parse_at("scene_start") == At(kind="start")
    assert parse_at("scene_start+1.5") == At(kind="start", offset=1.5)
    assert parse_at("@cue:resolver") == At(kind="cue", name="resolver")
    assert parse_at("@cue:example.com#2-0.25") == At(kind="cue", name="example.com", occurrence=2, offset=-0.25)
    assert parse_at("+0.5") == At(kind="rel", rel=0.5)
    for bad in ("@cue:", "start", "@cue:x#0", "+", "+0.5+0.2", "@cue:x+"):
        with pytest.raises(ValueError):
            parse_at(bad)

    p = _script(tmp_path, BASE + '      - at: "@cue:the#0"\n        highlight: a\n')
    assert _issues(p) == [
        'scenes[intro].steps[0].at: at "@cue:the#0" must be scene_start, @cue:<word>[#n] or +<seconds>, '
        "with an optional +/- offset"
    ]
    p = _script(tmp_path, BASE + '      - at: "+0.5+0.2"\n        highlight: a\n')
    assert _issues(p) == ["scenes[intro].steps[0].at: at \"+0.5+0.2\": a relative at (+N) can't have an offset"]
    p = _script(tmp_path, BASE + "      - at: +0.5\n        highlight: a\n")
    assert _issues(p) == ['scenes[intro].steps[0].at: at must be a quoted string, e.g. "+0.5"']


def test_style_only_sketch_dark(tmp_path):
    p = _script(tmp_path, "style: neon\n" + BASE + "      - at: scene_start\n        highlight: a\n")
    assert _issues(p) == ["style: Input should be 'sketch-dark'"]


def test_synced_commit_unquoted(tmp_path):
    for value in ("1234567", "12e4567"):
        p = _script(tmp_path, f"syncedCommit: {value}\n" + BASE + "      - at: scene_start\n        highlight: a\n")
        assert _issues(p) == ["syncedCommit: syncedCommit must be a quoted string"]


def test_slug_default(tmp_path):
    body = BASE + "      - at: scene_start\n        highlight: a\n"
    folder = tmp_path / "dns-lookup"
    folder.mkdir()
    assert load_script(_script(folder, body, "script.yaml")).slug == "dns-lookup"
    assert load_script(_script(folder, body, "other-name.yaml")).slug == "other-name"
    assert load_script(_script(folder, "slug: given\n" + body, "script.yaml")).slug == "given"


def test_slug_rejects_paths(tmp_path):
    body = BASE + "      - at: scene_start\n        highlight: a\n"
    for bad in ("../x", "a/b", "Upper", "-lead", ""):
        p = _script(tmp_path, f'slug: "{bad}"\n' + body, "a.yaml")
        assert _issues(p) == [f'slug: slug "{bad}" must match ^[a-z0-9][a-z0-9-]*$']


def test_slug_and_scene_id_reject_trailing_newline(tmp_path):
    body = BASE + "      - at: scene_start\n        highlight: a\n"
    p = _script(tmp_path, 'slug: "abc\\n"\n' + body, "a.yaml")
    assert _issues(p) == ['slug: slug "abc\n" must match ^[a-z0-9][a-z0-9-]*$']
    p = _script(tmp_path, "slug: ok\n" + body.replace("  - id: intro\n", '  - id: "intro\\n"\n'), "b.yaml")
    assert 'scene id "intro\n" must match ^[a-z0-9][a-z0-9-]*$' in "\n".join(_issues(p))


def test_default_slug_always_valid(tmp_path):
    from vidgen.schema import SCENE_ID_RE, default_slug

    body = BASE + "      - at: scene_start\n        highlight: a\n"
    odd = tmp_path / "My Video_v2 (final)"
    odd.mkdir()
    assert load_script(_script(odd, body, "script.yaml")).slug == "my-video-v2-final"
    assert load_script(_script(tmp_path, body, "..Weird..name!.yaml")).slug == "weird-name"
    for path in ("___.yaml", "ünï/script.yaml", "-x-.yaml", "..yaml"):
        assert SCENE_ID_RE.fullmatch(default_slug(Path(path)))


def test_script_hash_ignores_comments(tmp_path):
    body = BASE + "      - at: scene_start\n        highlight: a\n"
    a = load_script(_script(tmp_path, body, "a.yaml"))
    commented = "# a comment\n" + body.replace("title: T", "title:   T   # trailing")
    b = load_script(_script(tmp_path, commented, "a.yaml"))
    assert script_hash(a) == script_hash(b)
    assert script_hash(a).startswith("sha256:") and len(script_hash(a)) == len("sha256:") + 64
    c = load_script(_script(tmp_path, body.replace("title: T", "title: U"), "a.yaml"))
    assert script_hash(c) != script_hash(a)
