"""``script.yaml`` models, loading and friendly issue reporting."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    ValidationError,
    field_validator,
    model_validator,
)
from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from vidgen.narration import CueNotFound, Narration, NarrationError, find_cue, parse_narration

AT_RE = re.compile(
    r"^(scene_start|@cue:(?P<name>[\w.-]+)(#(?P<n>[1-9]\d*))?|\+(?P<rel>\d+(\.\d+)?))(?P<off>[+-]\d+(\.\d+)?)?$"
)
ACTIONS = ("send", "highlight", "show", "hide", "badge", "group", "text", "code")
SCENE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# Every issue template this module reports, keyed by rule. `reference/format.md` in the
# vidgen-authoring skill documents each one; `tests/test_skill.py` keeps the two in step.
MESSAGES: dict[str, str] = {
    # loading
    "read_error": "{file}: {error}",
    "invalid_yaml": "{file}: invalid YAML: {error}",
    "not_mapping": "a script must be a YAML mapping with title and scenes",
    "unknown_field": "unknown field",
    # field rules
    "at_grammar": 'at "{value}" must be scene_start, @cue:<word>[#n] or +<seconds>, with an optional +/- offset',
    "at_rel_offset": 'at "{value}": a relative at (+N) can\'t have an offset',
    "at_quoted": 'at must be a quoted string, e.g. "+{value}"',
    "one_action": "a step needs exactly one action ({actions}); found {found}",
    "layout_kind": "layout needs exactly one of row, column or grid",
    "commit_quoted": "syncedCommit must be a quoted string",
    # cross-reference rules
    "unknown_node": 'unknown node "{node}"',
    "unknown_target": 'unknown node or element "{node}"',
    "duplicate_element": 'duplicate element id "{id}"',
    "duplicate_scene": 'duplicate scene id "{id}"',
    "scene_id": 'scene id "{id}" must match ^[a-z0-9][a-z0-9-]*$',
    "slug": 'slug "{slug}" must match ^[a-z0-9][a-z0-9-]*$',
    "cue_not_found": 'cue "{name}" not found in the narration',
    "cue_not_after": 'cue "{name}" not found in the narration after the previous cue',
    "cue_occurrence": 'cue "{name}" has no occurrence #{n} in the narration',
    "first_inherit": "the first scene has no previous scene to inherit from",
    "no_position": 'node "{node}" has no at and is not in layout',
    "line_range": "line {line} is out of range (the code has {count} lines)",
}


def _msg(rule: str, **kw: Any) -> str:
    return MESSAGES[rule].format(**kw)


@dataclass(frozen=True)
class Issue:
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}" if self.path else self.message


class ScriptError(Exception):
    """A script that doesn't load; ``issues`` lists every problem found."""

    def __init__(self, issues: list[Issue]) -> None:
        self.issues = issues
        super().__init__("\n".join(str(i) for i in issues))


# --- at grammar -------------------------------------------------------------------------


@dataclass(frozen=True)
class At:
    """A parsed step ``at``: ``scene_start``, ``@cue:name[#n]`` or ``+N``, with an optional offset."""

    kind: Literal["start", "cue", "rel"]
    name: str | None = None
    occurrence: int | None = None
    rel: float = 0.0
    offset: float = 0.0


def parse_at(value: str) -> At:
    m = AT_RE.match(value)
    if m is None:
        raise ValueError(_msg("at_grammar", value=value))
    off = float(m["off"]) if m["off"] else 0.0
    if m["rel"] is not None:
        if m["off"]:
            raise ValueError(_msg("at_rel_offset", value=value))
        return At(kind="rel", rel=float(m["rel"]))
    if m["name"] is not None:
        return At(kind="cue", name=m["name"], occurrence=int(m["n"]) if m["n"] else None, offset=off)
    return At(kind="start", offset=off)


# --- models -------------------------------------------------------------------------------


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _intify(v: float) -> float:
    # Keep whole coordinates as ints so the scene JSON reads [170, 345], not [170.0, 345.0].
    return int(v) if float(v).is_integer() else v


Num = Annotated[float, AfterValidator(_intify)]
Point = tuple[Num, Num]


class Send(_Model):
    from_: str = Field(alias="from")
    to: str
    label: str = ""
    kind: Literal["request", "reply", "answer"] = "request"


class Highlight(_Model):
    node: str
    color: str | None = None
    pulse: bool = True

    @model_validator(mode="before")
    @classmethod
    def _bare_node(cls, data: Any) -> Any:
        return {"node": data} if isinstance(data, str) else data


class NodeList(RootModel[list[str]]):
    """The ``show``/``hide`` payload: node (or element) ids. A bare id is accepted."""

    @model_validator(mode="before")
    @classmethod
    def _bare_id(cls, data: Any) -> Any:
        return [data] if isinstance(data, str) else data


class Badge(_Model):
    text: str
    near: str


class Group(_Model):
    nodes: list[str]
    label: str = ""
    style: Literal["dashed", "solid"] = "dashed"


class TextBox(_Model):
    id: str
    text: str
    at: Point
    size: Point | None = None


class Code(_Model):
    id: str
    lang: str = "text"
    text: str
    at: Point
    size: Point | None = None
    typing: bool = False
    highlight_lines: list[int] = []


class Node(_Model):
    label: str
    sub: str | None = None
    at: Point | None = None
    size: Point | None = None
    hidden: bool = False


class Grid(_Model):
    cols: int = Field(ge=1)
    nodes: list[str]


class Layout(_Model):
    row: list[str] | None = None
    column: list[str] | None = None
    grid: Grid | None = None

    @model_validator(mode="after")
    def _one_kind(self) -> "Layout":
        kinds = [k for k in ("row", "column", "grid") if getattr(self, k) is not None]
        if len(kinds) != 1:
            raise ValueError(_msg("layout_kind"))
        return self

    def names(self) -> list[tuple[str, str]]:
        """``(path, node id)`` for every node the layout places."""
        if self.row is not None:
            return [(f"row[{i}]", n) for i, n in enumerate(self.row)]
        if self.column is not None:
            return [(f"column[{i}]", n) for i, n in enumerate(self.column)]
        assert self.grid is not None
        return [(f"grid.nodes[{i}]", n) for i, n in enumerate(self.grid.nodes)]

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class Diagram(_Model):
    inherit: bool = False
    layout: Layout | None = None
    nodes: dict[str, Node] = {}


class Step(_Model):
    at: str
    caption: str | None = None
    duration: float | None = Field(default=None, gt=0)
    send: Send | None = None
    highlight: Highlight | None = None
    show: NodeList | None = None
    hide: NodeList | None = None
    badge: Badge | None = None
    group: Group | None = None
    text: TextBox | None = None
    code: Code | None = None

    @field_validator("at", mode="before")
    @classmethod
    def _at_string(cls, v: Any) -> Any:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            raise ValueError(_msg("at_quoted", value=v))
        return v

    @field_validator("at")
    @classmethod
    def _at_grammar(cls, v: str) -> str:
        parse_at(v)
        return v

    @model_validator(mode="after")
    def _one_action(self) -> "Step":
        found = [a for a in ACTIONS if getattr(self, a) is not None]
        if len(found) != 1:
            got = ", ".join(found) if found else "none"
            raise ValueError(_msg("one_action", actions=", ".join(ACTIONS), found=got))
        return self

    @property
    def action(self) -> tuple[str, BaseModel]:
        for name in ACTIONS:
            value = getattr(self, name)
            if value is not None:
                return name, value
        raise AssertionError("a validated step always has one action")

    @property
    def when(self) -> At:
        return parse_at(self.at)


class Scene(_Model):
    id: str
    narration: str
    diagram: Diagram = Field(default_factory=Diagram)
    steps: list[Step] = []


class Script(_Model):
    title: str
    slug: str
    voice: str = "default"
    language: str = "en"
    style: Literal["sketch-dark"] = "sketch-dark"
    seed: int = 0
    syncedCommit: str | None = None
    sources: list[str] = []
    pronunciations: dict[str, str] = {}
    scenes: list[Scene] = Field(min_length=1)

    @field_validator("syncedCommit", mode="before")
    @classmethod
    def _quoted_commit(cls, v: Any) -> Any:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            raise ValueError(_msg("commit_quoted"))
        return v

    def scene(self, scene_id: str) -> Scene:
        for s in self.scenes:
            if s.id == scene_id:
                return s
        raise KeyError(scene_id)


# --- loading -------------------------------------------------------------------------------


def _scene_label(raw: Any, index: int) -> str:
    try:
        sid = raw["scenes"][index]["id"]
    except (KeyError, IndexError, TypeError):
        return str(index)
    return sid if isinstance(sid, str) and sid else str(index)


def _loc_path(raw: Any, loc: tuple[Any, ...]) -> str:
    out = ""
    for i, part in enumerate(loc):
        if isinstance(part, int):
            label = _scene_label(raw, part) if i == 1 and loc[0] == "scenes" else str(part)
            out += f"[{label}]"
        else:
            out += f".{part}" if out else str(part)
    return out


def _message(err: Any) -> str:
    if err["type"] == "extra_forbidden":
        return _msg("unknown_field")
    msg = str(err["msg"])
    return msg.removeprefix("Value error, ")


def _issues_from(raw: Any, err: ValidationError) -> list[Issue]:
    return [Issue(_loc_path(raw, tuple(e["loc"])), _message(e)) for e in err.errors()]


def _read_yaml(path: Path) -> Any:
    yaml = YAML(typ="safe", pure=True)  # pure: the YAML 1.2 loader, so `no:`/`on:` stay strings
    try:
        return yaml.load(path.read_text(encoding="utf-8"))
    except OSError as e:
        raise ScriptError([Issue("", _msg("read_error", file=path, error=e.strerror or e))]) from None
    except YAMLError as e:
        raise ScriptError([Issue("", _msg("invalid_yaml", file=path.name, error=e))]) from None


def default_slug(path: Path) -> str:
    """The folder name for ``script.yaml``, else the file stem, made into a valid slug.

    Lowercased, every run of other characters becomes ``-``, and the ends are trimmed:
    ``"My Video_v2.yaml"`` gives ``"my-video-v2"``. A name with nothing usable gives ``"video"``.
    """
    name = path.parent.name if path.name == "script.yaml" else path.stem
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "video"


def load_script(path: Path) -> Script:
    """Load and validate a script, raising :class:`ScriptError` with every issue found."""
    path = Path(path)
    raw = _read_yaml(path)
    if not isinstance(raw, dict):
        raise ScriptError([Issue("", _msg("not_mapping"))])
    data = dict(raw)
    data.setdefault("slug", default_slug(path))
    try:
        script = Script.model_validate(data)
    except ValidationError as e:
        raise ScriptError(_issues_from(raw, e)) from None
    issues = check_script(script)
    if issues:
        raise ScriptError(issues)
    return script


def _final_visibility(nodes: dict[str, Node], scene: Scene) -> dict[str, Node]:
    """``nodes`` with ``hidden`` set from their state after ``scene``'s show/hide steps."""
    hidden = {k: n.hidden for k, n in nodes.items()}
    for step in scene.steps:
        for action, value in (("show", step.show), ("hide", step.hide)):
            if value is None:
                continue
            for node_id in value.root:
                if node_id in hidden:
                    hidden[node_id] = action == "hide"
    return {
        k: n if n.hidden == hidden[k] else n.model_copy(update={"hidden": hidden[k]}) for k, n in nodes.items()
    }


def effective_diagrams(script: Script) -> list[tuple[dict[str, Node], Layout | None]]:
    """Each scene's starting nodes and layout, after ``inherit``.

    ``inherit: true`` starts from the previous scene's effective nodes, with ``hidden`` taken
    from their final state at the end of that scene, and from its layout. The scene's own
    nodes then replace or add to them, and its own layout, if any, replaces the inherited
    one. ``inherit`` on the first scene is ignored here (``check_script`` reports it).
    """
    out: list[tuple[dict[str, Node], Layout | None]] = []
    for i, scene in enumerate(script.scenes):
        nodes: dict[str, Node] = {}
        layout: Layout | None = None
        if scene.diagram.inherit and i > 0:
            prev_nodes, prev_layout = out[i - 1]
            nodes = _final_visibility(prev_nodes, script.scenes[i - 1])
            layout = prev_layout
        nodes = {**nodes, **scene.diagram.nodes}
        if scene.diagram.layout is not None:
            layout = scene.diagram.layout
        out.append((nodes, layout))
    return out


def _check_cues(base: str, scene: Scene, narration: Narration) -> list[Issue]:
    """Resolve every cue statically against the narration words, in step order."""
    issues: list[Issue] = []
    after: int | None = None
    for i, step in enumerate(scene.steps):
        when = step.when
        if when.kind != "cue":
            continue
        assert when.name is not None
        try:
            after = find_cue(narration, when.name, when.occurrence, after)
        except CueNotFound as e:
            if e.occurrence is not None:
                msg = _msg("cue_occurrence", name=e.name, n=e.occurrence)
            elif e.after is not None:
                msg = _msg("cue_not_after", name=e.name)
            else:
                msg = _msg("cue_not_found", name=e.name)
            issues.append(Issue(f"{base}.steps[{i}].at", msg))
    return issues


def _check_steps(base: str, scene: Scene, nodes: dict[str, Node]) -> list[Issue]:
    issues: list[Issue] = []
    elements: set[str] = set()  # text/code ids defined by earlier steps of this scene

    def need_node(path: str, node_id: str) -> None:
        if node_id not in nodes:
            issues.append(Issue(path, _msg("unknown_node", node=node_id)))

    def need_target(path: str, node_id: str) -> None:
        if node_id not in nodes and node_id not in elements:
            issues.append(Issue(path, _msg("unknown_target", node=node_id)))

    for i, step in enumerate(scene.steps):
        sp = f"{base}.steps[{i}]"
        if step.send is not None:
            need_node(f"{sp}.send.from", step.send.from_)
            need_node(f"{sp}.send.to", step.send.to)
        if step.highlight is not None:
            need_target(f"{sp}.highlight.node", step.highlight.node)
        for action, ids in (("show", step.show), ("hide", step.hide)):
            if ids is not None:
                for j, node_id in enumerate(ids.root):
                    need_target(f"{sp}.{action}[{j}]", node_id)
        if step.badge is not None:
            need_node(f"{sp}.badge.near", step.badge.near)
        if step.group is not None:
            for j, node_id in enumerate(step.group.nodes):
                need_node(f"{sp}.group.nodes[{j}]", node_id)
        for action, element in (("text", step.text), ("code", step.code)):
            if element is None:
                continue
            if element.id in nodes or element.id in elements:
                issues.append(Issue(f"{sp}.{action}.id", _msg("duplicate_element", id=element.id)))
            elements.add(element.id)
        if step.code is not None:
            count = len(step.code.text.splitlines())
            for j, line in enumerate(step.code.highlight_lines):
                if not 1 <= line <= count:
                    issues.append(
                        Issue(f"{sp}.code.highlight_lines[{j}]", _msg("line_range", line=line, count=count))
                    )
    return issues


def check_script(script: Script) -> list[Issue]:
    """Cross-reference rules run after the models parse. Every issue found is reported."""
    issues: list[Issue] = []
    if not SCENE_ID_RE.fullmatch(script.slug):
        issues.append(Issue("slug", _msg("slug", slug=script.slug)))
    seen: set[str] = set()
    for i, scene in enumerate(script.scenes):
        if scene.id in seen:
            issues.append(Issue(f"scenes[{i}].id", _msg("duplicate_scene", id=scene.id)))
        seen.add(scene.id)

    for i, (scene, (nodes, layout)) in enumerate(zip(script.scenes, effective_diagrams(script))):
        base = f"scenes[{scene.id}]"
        if not SCENE_ID_RE.fullmatch(scene.id):
            issues.append(Issue(f"{base}.id", _msg("scene_id", id=scene.id)))
        if i == 0 and scene.diagram.inherit:
            issues.append(Issue(f"{base}.diagram.inherit", _msg("first_inherit")))

        placed: set[str] = set()
        if layout is not None:
            for sub, node_id in layout.names():
                placed.add(node_id)
                # Only the scene's own layout is reported; an inherited one was checked in its scene.
                if layout is scene.diagram.layout and node_id not in nodes:
                    issues.append(Issue(f"{base}.diagram.layout.{sub}", _msg("unknown_node", node=node_id)))
        for node_id, node in nodes.items():
            # An inherited node is re-checked only when this scene brings its own layout.
            own = node_id in scene.diagram.nodes or scene.diagram.layout is not None
            if own and node.at is None and node_id not in placed:
                issues.append(Issue(f"{base}.diagram.nodes.{node_id}", _msg("no_position", node=node_id)))

        try:
            narration = parse_narration(scene.narration)
        except NarrationError as e:
            issues.append(Issue(f"{base}.narration", str(e)))
        else:
            issues.extend(_check_cues(base, scene, narration))

        issues.extend(_check_steps(base, scene, nodes))
    return issues


def script_hash(s: Script) -> str:
    """``sha256:<hex>`` of the script model's canonical JSON (comments and formatting don't count)."""
    canonical = json.dumps(s.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
