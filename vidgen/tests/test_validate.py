from pathlib import Path

import pytest
from typer.testing import CliRunner

from vidgen.cli import app
from vidgen.schema import ScriptError, load_script

FIXTURES = Path(__file__).parent / "fixtures"
runner = CliRunner()


def _issues(name: str) -> list[str]:
    with pytest.raises(ScriptError) as err:
        load_script(FIXTURES / name)
    return [str(i) for i in err.value.issues]


def test_unknown_node():
    assert _issues("invalid-unknown-node.yaml") == ['scenes[again].steps[0].send.to: unknown node "resolvr"']


def test_unknown_element():
    assert _issues("invalid-unknown-element.yaml") == [
        'scenes[intro].steps[0].hide[0]: unknown node or element "dig"'
    ]


def test_duplicate_element():
    assert _issues("invalid-duplicate-element.yaml") == ['scenes[intro].steps[0].text.id: duplicate element id "browser"']


def test_duplicate_scene():
    assert _issues("invalid-duplicate-scene.yaml") == ['scenes[1].id: duplicate scene id "intro"']


def test_scene_id_format():
    assert _issues("invalid-scene-id.yaml") == [
        'scenes[Ask_Root].id: scene id "Ask_Root" must match ^[a-z0-9][a-z0-9-]*$'
    ]


def test_cue_not_found():
    assert _issues("invalid-cue.yaml") == ['scenes[intro].steps[0].at: cue "resolvr" not found in the narration']


def test_cue_order_and_occurrence(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(
        """\
title: T
scenes:
  - id: intro
    narration: "The resolver asks the root."
    diagram: {nodes: {a: {label: A, at: [1, 1]}}}
    steps:
      - {at: "@cue:root", highlight: a}
      - {at: "@cue:resolver", highlight: a}
      - {at: "@cue:resolver#2", highlight: a}
      - {at: "@cue:resolver#1", highlight: a}
""",
        encoding="utf-8",
    )
    with pytest.raises(ScriptError) as err:
        load_script(p)
    assert [str(i) for i in err.value.issues] == [
        'scenes[intro].steps[1].at: cue "resolver" not found in the narration after the previous cue',
        'scenes[intro].steps[2].at: cue "resolver" has no occurrence #2 in the narration',
    ]


def test_marker_without_word():
    assert _issues("invalid-marker.yaml") == ['scenes[intro].narration: marker "{end}" has no word after it']


def test_first_scene_inherit():
    assert _issues("invalid-first-inherit.yaml") == [
        "scenes[intro].diagram.inherit: the first scene has no previous scene to inherit from"
    ]


def test_layout_unknown_node():
    assert _issues("invalid-layout-node.yaml") == ['scenes[intro].diagram.layout.row[2]: unknown node "root"']


def test_node_without_position():
    assert _issues("invalid-no-position.yaml") == [
        'scenes[intro].diagram.nodes.root: node "root" has no at and is not in layout'
    ]


def test_highlight_lines_range():
    assert _issues("invalid-highlight-lines.yaml") == [
        "scenes[intro].steps[0].code.highlight_lines[1]: line 3 is out of range (the code has 2 lines)"
    ]


def test_all_issues_reported(tmp_path):
    body = (FIXTURES / "invalid-cue.yaml").read_text(encoding="utf-8").replace("id: intro", "id: Intro")
    p = tmp_path / "two.yaml"
    p.write_text(body, encoding="utf-8")
    with pytest.raises(ScriptError) as err:
        load_script(p)
    assert str(err.value).splitlines() == [
        'scenes[Intro].id: scene id "Intro" must match ^[a-z0-9][a-z0-9-]*$',
        'scenes[Intro].steps[0].at: cue "resolvr" not found in the narration',
    ]


def test_inherit_and_valid_fixture():
    s = load_script(FIXTURES / "dns-mini.yaml")
    assert len(s.scenes) == 2


def test_cli_validate_exit_codes():
    ok = runner.invoke(app, ["validate", str(FIXTURES / "dns-mini.yaml")])
    assert ok.exit_code == 0
    assert ok.output == "ok: 2 scenes\n"

    bad = runner.invoke(app, ["validate", str(FIXTURES / "invalid-cue.yaml")])
    assert bad.exit_code == 1
    assert bad.output == 'scenes[intro].steps[0].at: cue "resolvr" not found in the narration\n'

    missing = runner.invoke(app, ["validate", str(FIXTURES / "does-not-exist.yaml")])
    assert missing.exit_code == 1
