# vidgen A: Core Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-17-vidgen-design.md`, sections 5 (layout), 6, 7, 11 (config), 15 (versioning).
**Goal:** a `vidgen` Python package that loads config, validates scripts (`vidgen validate`), computes the timeline from word timings, and writes the `timeline.json` and scene-JSON contracts consumed by Plans B and C.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Python 3.11+, `uv`. Runtime deps for this plan: `pydantic>=2`, `typer`, `ruamel.yaml`. No torch, no network.
- Nothing under `vidgen/` may be imported by, or packaged with, the root `teachme` npm package.
**Verification:** from `vidgen/`: `uv sync && uv run pytest -m "not endpoint"`. The root suite in `.claude/agents/coder.md` must stay green too.

## File structure

| File | Responsibility |
|---|---|
| `release-please-config.json`, `.release-please-manifest.json` | add the `vidgen` package; exclude it from `.` |
| `.gitignore` | Python and vidgen artifacts |
| `.claude/agents/coder.md` | vidgen verification suite section |
| `vidgen/pyproject.toml`, `vidgen/uv.lock` | package `vidgen`, entry point `vidgen = vidgen.cli:app` |
| `vidgen/src/vidgen/__init__.py` | `__version__` |
| `vidgen/src/vidgen/cli.py` | typer app; `validate` command (others added in Plans C, D) |
| `vidgen/src/vidgen/config.py` | `Config` model, `load_config` |
| `vidgen/src/vidgen/narration.py` | marker parsing, pronunciation spoken text, cue word lookup |
| `vidgen/src/vidgen/schema.py` | script models, `load_script`, `ScriptError` |
| `vidgen/src/vidgen/timeline.py` | `build_timeline` and timing types |
| `vidgen/src/vidgen/contracts.py` | `timeline.json` and scene-JSON writers |
| `vidgen/vidgen.example.toml` | documented example config |
| `vidgen/tests/fixtures/*.yaml` | valid and invalid scripts |
| `vidgen/tests/test_*.py` | tests per module |

### Task 1: Repo plumbing and package skeleton

**Files:**
- Modify: `release-please-config.json`, `.release-please-manifest.json`, `.gitignore`, `.claude/agents/coder.md` (new section after "Verification suite")
- Create: `vidgen/pyproject.toml`, `vidgen/src/vidgen/__init__.py`, `vidgen/src/vidgen/cli.py`
- Test: `vidgen/tests/test_cli.py`

**Interfaces:**
- Produces: `vidgen.__version__: str` (`"0.0.0"`, owned by release-please), `vidgen.cli.app: typer.Typer`.

**Behavior:**
- release-please: the `.` package gets `"exclude-paths": ["vidgen"]`. A new `"vidgen"` package has `release-type: python`, `package-name: vidgen`, `include-component-in-tag: true` and the same changelog sections. The manifest gets `"vidgen": "0.0.0"`.
- `.gitignore` adds `.venv/`, `__pycache__/`, `vidgen/bakeoff/clips/`, `vidgen/bakeoff/envs/`.
- `coder.md` gains a "vidgen units" section. It lists the Verification lines of Plans A–C, the `feat(vidgen):` scope rule, and the fact that the root suite still runs.
- `vidgen --version` prints `vidgen 0.0.0` and exits 0.

**Tests:**
- `test_version`: the `--version` output matches `vidgen.__version__`.

**Gotchas:**
- This task must merge before any `feat(vidgen)` commit reaches main. Otherwise release-please bumps teachme.
- For release-please `python` to update `__version__`, the file must hold the line `__version__ = "0.0.0"`.

### Task 2: Config

**Files:**
- Create: `vidgen/src/vidgen/config.py`, `vidgen/vidgen.example.toml`
- Test: `vidgen/tests/test_config.py`

**Interfaces:**
- Produces: `load_config(script: Path | None = None, explicit: Path | None = None) -> Config`, `class ConfigError(Exception)`, `Config.output_size() -> tuple[int, int]`.

```python
Endpoint{base_url, model, voice="default", api_key_env="", timeout_s=120, extra: dict={}, license=""}
EndpointSet{endpoint: str|None, endpoints: dict[str, Endpoint]}
Encoder{codec: auto|h264_nvenc|libx264 = auto, crf=18, cq=19, preset="slow"}
LocalTarget{type="local", path: Path, public_base_url: str|None}
S3Target{type="s3", bucket, prefix="", region|None, endpoint_url|None, public_base_url|None}
Paths{cache=~/.cache/vidgen, ffmpeg: str|None, node="node", renderer: Path|None}
Config{width=1920, height=1080, fps=30, draft=False, ssaa=1, scene_pad_s=0.4,
  arrow_default_s=1.2, arrow_min_s=0.6, arrow_max_s=2.5, paths, tts: EndpointSet, align: EndpointSet,
  pronunciations: dict[str,str]={}, encoder, music: {path, volume_db=-24}|None,
  publish: {default: str|None, targets: dict[str, LocalTarget|S3Target]}, bakeoff: {endpoints: list[str]=[]}}
```

**Behavior:**
- Search when `explicit` is None: `<script dir>/vidgen.toml`, then `<git toplevel>/vidgen.toml`, then `~/.config/vidgen/vidgen.toml`. The first file found is used whole. If none is found, defaults apply.
- `output_size()` returns `(1280, 720)` when `draft`, else `(width, height)`.
- `extra="forbid"` everywhere. An unknown key raises `ConfigError("vidgen.toml: unknown key 'tts.endpints'")`.
- `tts.endpoint`, `align.endpoint` or a `bakeoff.endpoints` entry with no matching `endpoints` entry raises `ConfigError` naming it. `~` is expanded.

**Tests:**
- `test_search_order`, `test_defaults_without_file`, `test_unknown_key`, `test_dangling_endpoint`, `test_draft_size`, `test_example_toml_loads`.

### Task 3: Narration and cue words

**Files:**
- Create: `vidgen/src/vidgen/narration.py`
- Test: `vidgen/tests/test_narration.py`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class Narration: text: str; words: list[str]; norms: list[str]; marks: dict[str, int]
@dataclass(frozen=True)
class Spoken: text: str; tokens: list[str]; source: list[int]   # source[i] = index into Narration.words
def parse_narration(raw: str) -> Narration
def to_spoken(n: Narration, pron: dict[str, str]) -> Spoken
def norm(word: str) -> str                    # casefold, drop every non-\w character
def find_cue(n: Narration, name: str, occurrence: int | None, after: int | None) -> int
class NarrationError(Exception): ...
class CueNotFound(Exception): name: str
```

**Behavior:**
- `"Ask {r}the resolver now"` gives words `["Ask","the","resolver","now"]`, marks `{"r": 1}`, and text `"Ask the resolver now"`, with whitespace collapsed.
- A marker with no following word raises `NarrationError('marker "{x}" has no word after it')`. A duplicate marker name raises `NarrationError('duplicate marker "{x}"')`.
- `to_spoken` matches whole words, case-sensitive, after stripping surrounding punctuation. `"DNS,"` with `{DNS: "D N S"}` gives tokens `["D","N","S,"]`, with all three mapping to the source word index.
- `find_cue`: a mark name wins over a word. Otherwise it returns the first index where `norms[i] == norm(name)` and `i > after` (`after=None` means from the start). With `occurrence=k` it ignores `after` and returns the k-th match from the start. If there is no match it raises `CueNotFound`.
- `norm("example.com") == norm("Example.com?") == "examplecom"`.

**Tests:**
- `test_markers_stripped`, `test_marker_without_word`, `test_duplicate_marker`, `test_pron_whole_word_only` (`DNSSEC` is untouched by a `DNS` key), `test_pron_keeps_punctuation`, `test_cue_after_previous`, `test_cue_occurrence_absolute`, `test_mark_beats_word`, `test_cue_not_found`.

### Task 4: Script models

**Files:**
- Create: `vidgen/src/vidgen/schema.py`, `vidgen/tests/fixtures/dns-mini.yaml` (valid, 2 scenes)
- Test: `vidgen/tests/test_schema.py`

**Interfaces:**
- Produces: `load_script(path: Path) -> Script`, `class ScriptError(Exception): issues: list[Issue]`, `Issue(path: str, message: str)`, `Step.action -> tuple[str, BaseModel]`, `script_hash(s: Script) -> str` (`"sha256:<hex>"` of canonical JSON of the model).

```python
AT_RE = r"^(scene_start|@cue:(?P<name>[\w.-]+)(#(?P<n>[1-9]\d*))?|\+(?P<rel>\d+(\.\d+)?))(?P<off>[+-]\d+(\.\d+)?)?$"
ACTIONS = ("send","highlight","show","hide","badge","group","text","code")
Send{from_ (alias "from"), to, label="", kind: request|reply|answer = request}
Highlight{node, color: str|None, pulse: bool = True}   # also accepts a bare node id string
Badge{text, near}; Group{nodes: list[str], label="", style: dashed|solid = dashed}
TextBox{id, text, at: [x,y], size: [w,h] | None}; Code{id, lang="text", text, at, size|None, typing=False, highlight_lines: list[int]=[]}
Node{label, sub|None, at|None, size|None, hidden=False}; Diagram{inherit=False, layout: dict|None, nodes: dict[str, Node] = {}}
Step{at, caption|None, duration: float|None, <exactly one action>}; Scene{id, narration, diagram, steps}
Script{title, slug, voice="default", language="en", style="sketch-dark", seed=0, syncedCommit|None, sources=[], pronunciations={}, scenes (≥1)}
```

**Behavior:**
- Issue paths use scene ids. For example: `scenes[intro].steps[2].kind: …`.
- Model-level issues: an unknown field (`extra="forbid"`); a step with zero or two actions; an `at` not matching `AT_RE`, or a relative `at` with an offset; `style` other than `sketch-dark`.
- `syncedCommit` parsed as int or float raises an issue: `syncedCommit must be a quoted string`.
- The default `slug` is the parent folder name if the file is `script.yaml`, else the file stem.

**Tests:**
- `test_valid_fixture`, `test_unknown_field`, `test_step_action_count`, `test_at_grammar`, `test_synced_commit_unquoted`, `test_slug_default`, `test_script_hash_ignores_comments`.

**Gotchas:**
- Load with `ruamel.yaml` `typ="safe"` (YAML 1.2), so `no:` or `on:` node ids stay strings.

### Task 5: Reference rules and `vidgen validate`

**Files:**
- Modify: `vidgen/src/vidgen/schema.py`, `vidgen/src/vidgen/cli.py` (add `validate`)
- Create: `vidgen/tests/fixtures/invalid-*.yaml`, one per rule
- Test: `vidgen/tests/test_validate.py`

**Interfaces:**
- Consumes: `parse_narration`, `find_cue` (Task 3), the models (Task 4).

**Behavior:**
- `load_script` runs these checks after the models parse, each producing one issue. Example: `scenes[intro].steps[2].send.to: unknown node "resolvr"`.
  - a node or element reference missing, after inheritance;
  - a duplicate scene id;
  - a scene id not matching `^[a-z0-9][a-z0-9-]*$`;
  - a cue `CueNotFound`, or a `NarrationError`;
  - `inherit: true` on the first scene;
  - `layout` naming an undeclared node;
  - a node with no `at` that isn't in `layout`;
  - `highlight_lines` out of range.
- Cues are checked statically against the narration words, in step order, with no audio needed.
- `vidgen validate <file>` prints `ok: <n> scenes` and exits 0. On failure it prints one issue per line and exits 1.

**Tests:**
- One `test_<rule>` per rule above, each asserting the exact issue text. Also `test_all_issues_reported` (two broken rules give two lines) and `test_cli_validate_exit_codes`.

### Task 6: Timeline

**Files:**
- Create: `vidgen/src/vidgen/timeline.py`
- Test: `vidgen/tests/test_timeline.py`

**Interfaces:**
- Consumes: `Script`, `Config`, `find_cue`.
- Produces:

```python
@dataclass(frozen=True) class WordTime: text: str; start: float; end: float
@dataclass(frozen=True) class SceneAudio: path: Path; duration: float; words: list[WordTime]  # 1:1 with Narration.words
@dataclass(frozen=True) class StepTime: index: int; start: float; duration: float
@dataclass(frozen=True) class SceneTime: id: str; offset: float; duration: float; audio: Path; words: list[WordTime]; steps: list[StepTime]
@dataclass(frozen=True) class Timeline: fps: int; width: int; height: int; scenes: list[SceneTime]; total: float
def build_timeline(script: Script, audio: dict[str, SceneAudio], cfg: Config) -> Timeline
```

**Behavior:**
- Pass 1 resolves `scene_start` and `@cue` starts (`words[idx].start + offset`, floored at 0). Pass 2 walks the steps in order, giving `+N` steps `prev.start + prev.duration + N`.
- Default durations, overridden by `duration`: `highlight` 1.0; `show`/`hide`/`text` 0.4; `badge`/`group` 0.6; `code` 0.4, or `len(text)/25` clamped to [0.4, 6] with `typing`.
- `send` default: if the next step is absolute, the gap to its start is clamped to [`arrow_min_s`, `arrow_max_s`]. If the next step is `+N`, it's `arrow_default_s`. On the last step, the gap to narration end is clamped the same way.
- Scene duration = `ceil((max(audio.duration, last step end) + scene_pad_s) * fps) / fps`. Offsets are cumulative.
- A word count that doesn't match the narration raises `ValueError` naming the scene.

**Tests:**
- `test_cue_start`, `test_relative_after_end`, `test_arrow_gap_clamped`, `test_arrow_before_relative_uses_default`, `test_last_arrow_to_narration_end`, `test_typing_duration`, `test_scene_duration_frame_aligned` (4.01 s at 30 fps plus 0.4 pad gives 4.433…), `test_offsets_cumulative`, `test_word_count_mismatch`.

**Gotchas:**
- Frame-aligned durations are what keep `-c copy` concat and the padded audio the same length (Plan C).

### Task 7: Contract writers

**Files:**
- Create: `vidgen/src/vidgen/contracts.py`
- Test: `vidgen/tests/test_contracts.py`

**Interfaces:**
- Produces: `scene_json(script: Script, tl: Timeline, scene_id: str, cfg: Config) -> dict`, `timeline_json(tl: Timeline) -> dict`, `effective_nodes(script: Script, scene_id: str) -> tuple[dict, dict | None]` (nodes, layout).

Scene JSON (the Plan B input):

```json
{ "version": 1, "width": 1920, "height": 1080, "fps": 30, "design": [1920, 1080],
  "seed": 7, "style": "sketch-dark", "title": "How a DNS lookup works",
  "scene": { "id": "intro", "duration": 6.4333,
    "nodes": { "browser": {"label": "Browser", "sub": "own + OS cache", "at": [170, 345], "size": null, "hidden": false} },
    "layout": {"row": ["browser", "resolver"]},
    "steps": [ {"index": 0, "start": 1.2, "duration": 1.4, "caption": "1  Browser…",
                "action": "send", "send": {"from": "browser", "to": "resolver", "label": "example.com ?", "kind": "request"}} ] } }
```

`timeline.json`: `{"version":1,"fps","width","height","total","scenes":[{"id","offset","duration","audio","words":[{"text","start","end"}],"steps":[{"index","start","duration"}]}]}`.

**Behavior:**
- `inherit: true` merges the previous scene's effective nodes and layout. Each node's `hidden` is set from its final state after that scene's `show`/`hide` steps. Then the scene's own nodes are overlaid.
- `width`/`height` come from `cfg.output_size()`, and `design` is always `[1920, 1080]`.
- Keys are emitted in a stable order (`sort_keys`), so identical inputs give byte-identical JSON (cache keys in Plan C).

**Tests:**
- `test_scene_json_shape` against a golden JSON file, `test_inherit_visibility`, `test_draft_size`, `test_byte_stable`.

## Coverage

Spec sections: 5 (package layout, steps 1 and 4), 6, 7, 11 (config search and keys), 15 (versioning).
