"""The vidgen-authoring skill: its format reference stays in step with the code, and its
examples load."""

import re
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from vidgen.schema import MESSAGES, load_script

ROOT = Path(__file__).parents[1]
SKILL = ROOT / "skill" / "vidgen-authoring"
FORMAT = SKILL / "reference" / "format.md"
LINT_KINDS = ("label-overlap", "label-line", "overflow", "zone")  # renderer/src/lint.ts LintKind

VALID_BLOCK_RE = re.compile(r"<!-- valid -->\s*```yaml\n(.*?)```", re.DOTALL)


def _frontmatter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    assert m, "SKILL.md must start with a --- frontmatter block"
    return YAML(typ="safe", pure=True).load(m.group(1))


@pytest.mark.parametrize("rule", sorted(MESSAGES))
def test_every_message_documented(rule):
    assert MESSAGES[rule] in FORMAT.read_text(encoding="utf-8")


def test_valid_blocks_parse(tmp_path):
    blocks = VALID_BLOCK_RE.findall(FORMAT.read_text(encoding="utf-8"))
    assert len(blocks) >= 3
    for i, block in enumerate(blocks):
        p = tmp_path / f"block{i}.yaml"
        p.write_text(block, encoding="utf-8")
        load_script(p)


def test_lint_kinds_documented():
    text = FORMAT.read_text(encoding="utf-8")
    lint_ts = (ROOT / "renderer" / "src" / "lint.ts").read_text(encoding="utf-8")
    declared = re.search(r"export type LintKind = (.*);", lint_ts)
    assert declared and set(re.findall(r"'([\w-]+)'", declared.group(1))) == set(LINT_KINDS)
    for kind in LINT_KINDS:
        assert f"| `{kind}` |" in text, kind


def test_skill_frontmatter():
    fm = _frontmatter((SKILL / "SKILL.md").read_text(encoding="utf-8"))
    assert fm["name"] == "vidgen-authoring"
    desc = fm["description"]
    assert desc.startswith("Use when")
    assert "video" in desc and "animated explainer" in desc
    assert "TeachMe course" in desc and "three or more" in desc


def test_skill_files_table_paths_exist():
    text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    paths = re.findall(r"^\| `([^`]+)` \|", text, re.MULTILINE)
    assert paths
    for rel in paths:
        assert (SKILL / rel).exists(), rel


@pytest.mark.parametrize("name", ["dns-lookup", "code-flow"])
def test_skill_examples_validate(name):
    s = load_script(SKILL / "examples" / name / "script.yaml")
    assert s.slug == name


def test_skill_code_flow_shape():
    s = load_script(SKILL / "examples" / "code-flow" / "script.yaml")
    assert len(s.scenes) == 2
    codes = [st.code for sc in s.scenes for st in sc.steps if st.code is not None]
    assert any(c.typing and c.highlight_lines for c in codes)


def test_skill_dns_copy_in_sync():
    copy = SKILL / "examples" / "dns-lookup" / "script.yaml"
    assert copy.read_bytes() == (ROOT / "examples" / "dns-lookup" / "script.yaml").read_bytes()
