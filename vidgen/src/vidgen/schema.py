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

AT_RE = re.compile(
    r"^(scene_start|@cue:(?P<name>[\w.-]+)(#(?P<n>[1-9]\d*))?|\+(?P<rel>\d+(\.\d+)?))(?P<off>[+-]\d+(\.\d+)?)?$"
)
ACTIONS = ("send", "highlight", "show", "hide", "badge", "group", "text", "code")


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
        raise ValueError(f'at "{value}" must be scene_start, @cue:<word>[#n] or +<seconds>, with an optional +/- offset')
    off = float(m["off"]) if m["off"] else 0.0
    if m["rel"] is not None:
        if m["off"]:
            raise ValueError(f'at "{value}": a relative at (+N) can\'t have an offset')
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
            raise ValueError("layout needs exactly one of row, column or grid")
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
            raise ValueError(f'at must be a quoted string, e.g. "+{v}"')
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
            raise ValueError(f"a step needs exactly one action ({', '.join(ACTIONS)}); found {got}")
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
            raise ValueError("syncedCommit must be a quoted string")
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
        return "unknown field"
    msg = str(err["msg"])
    return msg.removeprefix("Value error, ")


def _issues_from(raw: Any, err: ValidationError) -> list[Issue]:
    return [Issue(_loc_path(raw, tuple(e["loc"])), _message(e)) for e in err.errors()]


def _read_yaml(path: Path) -> Any:
    yaml = YAML(typ="safe", pure=True)  # pure: the YAML 1.2 loader, so `no:`/`on:` stay strings
    try:
        return yaml.load(path.read_text(encoding="utf-8"))
    except OSError as e:
        raise ScriptError([Issue("", f"{path}: {e.strerror or e}")]) from None
    except YAMLError as e:
        raise ScriptError([Issue("", f"{path.name}: invalid YAML: {e}")]) from None


def default_slug(path: Path) -> str:
    return path.parent.name if path.name == "script.yaml" else path.stem


def load_script(path: Path) -> Script:
    """Load and validate a script, raising :class:`ScriptError` with every issue found."""
    path = Path(path)
    raw = _read_yaml(path)
    if not isinstance(raw, dict):
        raise ScriptError([Issue("", "a script must be a YAML mapping with title and scenes")])
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


def check_script(script: Script) -> list[Issue]:
    """Cross-reference rules run after the models parse."""
    return []


def script_hash(s: Script) -> str:
    """``sha256:<hex>`` of the script model's canonical JSON (comments and formatting don't count)."""
    canonical = json.dumps(s.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
