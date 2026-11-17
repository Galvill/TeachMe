# vidgen E: Skill, Docs and Acceptance Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-17-vidgen-design.md`, sections 13, 16, and 15 stage 9 (docs).
**Goal:** the `vidgen-authoring` skill lets a coding agent author, check, build and publish a code-grounded video. The DNS example and the dogfood video pass the spec §16 acceptance, and vidgen is documented.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Plans A–D are merged. Tasks 1–4 need no real endpoint. Task 5 waits for the user's bake-off pick (Plan D Task 5).
- Skill files live under `vidgen/skill/vidgen-authoring/` only. Nothing is added to root `skill/`.
**Verification:** Plan C's line, plus the root suite in `.claude/agents/coder.md` (the root README changes).

## File structure

| File | Responsibility |
|---|---|
| `vidgen/examples/dns-lookup/script.yaml` | acceptance example, six scenes |
| `vidgen/src/vidgen/schema.py` | gather issue messages into `MESSAGES` |
| `vidgen/skill/vidgen-authoring/SKILL.md` | triggers, core rule, create and update workflows |
| `vidgen/skill/vidgen-authoring/reference/format.md` | full script format and every validation and lint message |
| `vidgen/skill/vidgen-authoring/examples/` | copy of the DNS script and a small code-flow script |
| `vidgen/tests/test_examples.py`, `vidgen/tests/test_skill.py` | example and skill-reference tests |
| `vidgen/README.md`, `vidgen/CLAUDE.md` | user docs, project conventions |
| `README.md` | short "vidgen" section linking to `vidgen/README.md` |
| `.teachme/videos/teachme-status/script.yaml` | dogfood video script |

### Task 1: DNS example

**Files:**
- Create: `vidgen/examples/dns-lookup/script.yaml`
- Test: `vidgen/tests/test_examples.py`

**Behavior:**
- Scene ids: `intro`, `cache-miss`, `ask-root`, `ask-tld`, `ask-authoritative`, `answer-cached`, in that order. Narration totals 115–150 words (45–60 s at about 150 wpm).
- Nodes are `browser`, `resolver`, `root`, `tld`, `authoritative`. Scenes 2–6 use `inherit: true`. Each query is a `request`/`reply` pair cued on the server's name. The final `answer` to the browser is followed by a `badge` showing `93.184.216.34`.
- The script declares `pronunciations` for DNS, TLD, TTL and IPv6.

**Tests:**
- `test_dns_validates`, `test_dns_lint_clean`, a fake-endpoint build that asserts lint has no issues for every scene, and `test_dns_word_count` (115–150).

### Task 2: Format reference and message table

**Files:**
- Modify: `vidgen/src/vidgen/schema.py` (move every issue template into `MESSAGES: dict[str, str]`, keyed by rule)
- Create: `vidgen/skill/vidgen-authoring/reference/format.md`
- Test: `vidgen/tests/test_skill.py`

**Behavior:**
- `format.md` documents:
  - every top-level, scene, diagram, node and step field;
  - the `at` grammar, with cue, marker, occurrence and offset examples;
  - default durations;
  - `inherit` semantics;
  - that layout `at` is a box center in 1920×1080;
  - the lint kinds, with how to fix each.
- Every `MESSAGES` value appears in `format.md` with its placeholders (`{node}`, …) unchanged. Every fenced `yaml` block marked `<!-- valid -->` passes `load_script`.

**Tests:**
- `test_every_message_documented`, `test_valid_blocks_parse`, `test_lint_kinds_documented` (the four kinds from Plan B Task 7).

**Gotchas:**
- Existing `test_schema.py` assertions on exact issue text must still pass. Change where the text lives, not what it says.

### Task 3: SKILL.md and examples

**Files:**
- Create: `vidgen/skill/vidgen-authoring/SKILL.md`, `examples/dns-lookup/script.yaml` (copy of Task 1's), `examples/code-flow/script.yaml`
- Test: `vidgen/tests/test_skill.py`

**Behavior:**
- Frontmatter `name: vidgen-authoring` and a `description` that triggers on "make a video / animated explainer of <flow>". It also triggers while writing a TeachMe course where three or more components interact in order.
- It covers:
  - when not to make a video: a static Mermaid diagram is enough;
  - the core rule: read the code first, with every node, arrow and label true at `syncedCommit` and `sources` listing the files;
  - the narration rules: short sentences, about 150 wpm, one idea per scene, spell acronyms through `pronunciations`.
- Create workflow: validate, lint, preview the densest frames and look at them, build, spot-check, publish, then commit the script and manifest (never the MP4). Scripts in TeachMe repos go in `.teachme/videos/<slug>/`.
- Update workflow: `git log <syncedCommit>.. -- <sources>`, edit only the affected scenes, rebuild, republish, bump `syncedCommit`.
- `examples/code-flow` is a 2-scene script with a `code` step with `typing` and `highlight_lines`.

**Tests:**
- `test_skill_frontmatter`, `test_skill_examples_validate`, `test_skill_dns_copy_in_sync` (byte-equal to `vidgen/examples/dns-lookup/script.yaml`).

### Task 4: README and CLAUDE.md

**Files:**
- Create: `vidgen/README.md`, `vidgen/CLAUDE.md`
- Modify: `README.md` (add a "vidgen" section after "Writing content with a coding agent")

**Behavior:**
- `vidgen/README.md` covers:
  - install (`./setup.sh` or `make setup`);
  - endpoint setup, with a local example, a remote example and the warning that a remote endpoint sees the script;
  - the commands and their exit codes;
  - config keys;
  - publish targets and S3 credentials;
  - an encoder section (the NVENC vs libx264 measurement goes here in Task 5);
  - skill install by symlink;
  - troubleshooting, keyed by the `doctor` and error messages.
- `vidgen/CLAUDE.md` covers the conventions: renderer only through its CLI contract, no randomness outside `seedFor`, frame-aligned durations, `feat(vidgen)` scope, the verification lines from Plans A–C, and that the golden frame is regenerated only with `UPDATE_GOLDEN=1` and reviewed.

**Tests:**
- The root suite passes. No new tests.

### Task 5: Acceptance runs (after the user's pick)

**Files:**
- Create: `.teachme/videos/teachme-status/script.yaml`
- Modify: `vidgen/README.md` (the encoder section)

**Behavior:**
- The DNS example builds against the chosen real endpoint. Duration 45–60 s, lint clean, `measure_lufs` within −16 ± 1. Published to a local target with a manifest that validates. The coder watches the densest preview frames before the full build.
- NVENC vs libx264 CRF 18 is measured on the DNS video with ffmpeg `libvmaf` (or `ssim` if VMAF is unavailable). The scores, file sizes, chosen default and reason are recorded in the README.
- Dogfood: following the skill, a 2–4 scene script explains how `teachme status` decides a lesson is stale. It is grounded in `server/status.js` and `server/git.js`, has `sources` set to those files and `syncedCommit` quoted. It validates, lints clean and builds. Only the script is committed. The manifest is committed only if it was published to a target other viewers can reach.

**Tests:**
- `node bin/teachme.js validate .teachme` still reports `0 errors, 0 warnings` (the loader ignores `videos/`). `uv run pytest -m endpoint` passes locally. Record the run in the PR body.

**Gotchas:**
- `syncedCommit` must be a quoted string. An unquoted SHA like `1234567` parses as an int and fails validation (Plan A Task 4).

## Coverage

Spec sections: 13, 15 (stage 9 docs), 16.
