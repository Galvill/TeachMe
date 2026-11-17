"""``vidgen.toml`` loading and defaults.

The search order, when no explicit file is given, is the script's folder, then the git
toplevel of that folder, then ``~/.config/vidgen/``. The first file found is used whole;
files are never merged. With no file at all, the defaults below apply.
"""

from __future__ import annotations

import subprocess
import tomllib
from pathlib import Path
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

CONFIG_NAME = "vidgen.toml"
DRAFT_SIZE = (1280, 720)


class ConfigError(Exception):
    """A ``vidgen.toml`` that can't be read or doesn't validate."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _expand(value: Any) -> Any:
    if isinstance(value, (str, Path)):
        return Path(value).expanduser()
    return value


class Endpoint(_Model):
    base_url: str
    model: str
    voice: str = "default"
    api_key_env: str = ""
    timeout_s: float = Field(default=120, gt=0)
    extra: dict[str, Any] = {}
    license: str = ""


class EndpointSet(_Model):
    endpoint: str | None = None
    endpoints: dict[str, Endpoint] = {}


class Encoder(_Model):
    codec: Literal["auto", "h264_nvenc", "libx264"] = "auto"
    crf: int = 18
    cq: int = 19
    preset: str = "slow"


class LocalTarget(_Model):
    type: Literal["local"] = "local"
    path: Path
    public_base_url: str | None = None

    _expand_path = field_validator("path", mode="before")(_expand)


class S3Target(_Model):
    type: Literal["s3"] = "s3"
    bucket: str
    prefix: str = ""
    region: str | None = None
    endpoint_url: str | None = None
    public_base_url: str | None = None


Target = Annotated[Union[LocalTarget, S3Target], Field(discriminator="type")]


class Paths(_Model):
    cache: Path = Field(default_factory=lambda: Path("~/.cache/vidgen").expanduser())
    ffmpeg: str | None = None
    node: str = "node"
    renderer: Path | None = None

    _expand_paths = field_validator("cache", "renderer", mode="before")(_expand)

    @field_validator("ffmpeg", "node", mode="before")
    @classmethod
    def _expand_exe(cls, value: Any) -> Any:
        # An executable is either a bare name looked up on PATH or a path; only expand "~".
        if isinstance(value, str) and value.startswith("~"):
            return str(Path(value).expanduser())
        return value


class Music(_Model):
    path: Path
    volume_db: float = -24

    _expand_path = field_validator("path", mode="before")(_expand)


class Publish(_Model):
    default: str | None = None
    targets: dict[str, Target] = {}


class Bakeoff(_Model):
    endpoints: list[str] = []


class Config(_Model):
    width: int = Field(default=1920, gt=0)
    height: int = Field(default=1080, gt=0)
    fps: int = Field(default=30, gt=0)
    draft: bool = False
    ssaa: int = Field(default=1, ge=1)
    scene_pad_s: float = Field(default=0.4, ge=0)
    arrow_default_s: float = Field(default=1.2, gt=0)
    arrow_min_s: float = Field(default=0.6, gt=0)
    arrow_max_s: float = Field(default=2.5, gt=0)
    paths: Paths = Field(default_factory=Paths)
    tts: EndpointSet = EndpointSet()
    align: EndpointSet = EndpointSet()
    pronunciations: dict[str, str] = {}
    encoder: Encoder = Encoder()
    music: Music | None = None
    publish: Publish = Publish()
    bakeoff: Bakeoff = Bakeoff()

    def output_size(self) -> tuple[int, int]:
        """The rendered frame size: 1280x720 in draft mode, else ``(width, height)``."""
        return DRAFT_SIZE if self.draft else (self.width, self.height)


def _git_toplevel(folder: Path) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(folder), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    return Path(out.stdout.strip())


def find_config(script: Path | None = None) -> Path | None:
    """The first ``vidgen.toml`` in the search order, or None."""
    base = (script.resolve().parent if script is not None else Path.cwd())
    candidates = [base / CONFIG_NAME]
    top = _git_toplevel(base)
    if top is not None:
        candidates.append(top / CONFIG_NAME)
    candidates.append(Path.home() / ".config" / "vidgen" / CONFIG_NAME)
    for path in candidates:
        if path.is_file():
            return path
    return None


def _dotted(loc: tuple[Any, ...]) -> str:
    parts: list[str] = []
    for i, part in enumerate(loc):
        # A discriminated union adds the tag ("local"/"s3") after the target name; drop it.
        if i == 3 and loc[:2] == ("publish", "targets") and part in ("local", "s3"):
            continue
        parts.append(str(part))
    return ".".join(parts)


def _format(name: str, err: ValidationError) -> str:
    lines = []
    for e in err.errors():
        where = _dotted(tuple(e["loc"]))
        if e["type"] == "extra_forbidden":
            lines.append(f"{name}: unknown key '{where}'")
        else:
            lines.append(f"{name}: {where}: {e['msg']}")
    return "\n".join(lines)


def _check_references(name: str, cfg: Config) -> None:
    for section in ("tts", "align"):
        es: EndpointSet = getattr(cfg, section)
        if es.endpoint is not None and es.endpoint not in es.endpoints:
            raise ConfigError(
                f'{name}: {section}.endpoint "{es.endpoint}" has no [{section}.endpoints.{es.endpoint}] entry'
            )
    for ep in cfg.bakeoff.endpoints:
        if ep not in cfg.tts.endpoints:
            raise ConfigError(f'{name}: bakeoff.endpoints entry "{ep}" has no [tts.endpoints.{ep}] entry')
    default = cfg.publish.default
    if default is not None and default not in cfg.publish.targets:
        raise ConfigError(f'{name}: publish.default "{default}" has no [publish.targets.{default}] entry')


def load_config(script: Path | None = None, explicit: Path | None = None) -> Config:
    """Load the config for ``script`` (or the cwd), or from ``explicit`` when given."""
    path: Path | None
    if explicit is not None:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise ConfigError(f"{path}: config file not found")
    else:
        path = find_config(script)
    if path is None:
        return Config()
    name = path.name
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{name}: {e}") from None
    except OSError as e:
        raise ConfigError(f"{name}: {e.strerror or e}") from None
    try:
        cfg = Config.model_validate(data)
    except ValidationError as e:
        raise ConfigError(_format(name, e)) from None
    _check_references(name, cfg)
    return cfg
