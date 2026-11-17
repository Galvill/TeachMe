"""The published-video manifest (spec §10): model, path rule, read/write and staleness.

The manifest is committed next to the script, so it is written as stable JSON (sorted keys,
two-space indent, trailing newline): rewriting an unchanged manifest leaves the file
byte-identical.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from vidgen.contracts import dumps
from vidgen.schema import Script, script_hash

MANIFEST_VERSION = 1


class ManifestError(Exception):
    """A manifest file that exists but can't be read or doesn't validate."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileRef(_Model):
    location: str  # file://… or s3://bucket/key
    url: str | None  # public URL when the target has public_base_url, else null
    sha256: str
    bytes: int


class Files(_Model):
    video: FileRef
    captions: FileRef
    poster: FileRef


class TtsInfo(_Model):
    engine: str  # the [tts.endpoints] name used for the build
    model: str
    voice: str
    license: str = ""


class Manifest(_Model):
    version: Literal[1] = MANIFEST_VERSION
    slug: str
    title: str
    scriptHash: str
    syncedCommit: str | None = None
    sources: list[str] = []
    durationSec: float
    resolution: tuple[int, int]
    language: str
    tts: TtsInfo
    vidgenVersion: str
    publishedAt: str
    target: str
    files: Files


def manifest_path(script_path: Path) -> Path:
    """``<dir>/manifest.json`` for ``script.yaml``, else ``<dir>/<stem>.manifest.json``."""
    p = Path(script_path)
    if p.name == "script.yaml":
        return p.with_name("manifest.json")
    return p.with_name(f"{p.stem}.manifest.json")


def read_manifest(p: Path) -> Manifest | None:
    """The manifest at ``p``, or None when there is none. Raises :class:`ManifestError` if invalid."""
    p = Path(p)
    try:
        text = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as e:
        raise ManifestError(f"{p.name}: {e.strerror or e}") from None
    try:
        return Manifest.model_validate(json.loads(text))
    except json.JSONDecodeError as e:
        raise ManifestError(f"{p.name}: invalid JSON: {e}") from None
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(x) for x in first["loc"])
        raise ManifestError(f"{p.name}: {where}: {first['msg']}") from None


def render_manifest(m: Manifest) -> str:
    return dumps(m.model_dump(mode="json"))


def write_manifest(p: Path, m: Manifest) -> None:
    """Write ``m`` as stable JSON; an unchanged manifest is left untouched on disk."""
    p = Path(p)
    text = render_manifest(m)
    try:
        if p.read_text(encoding="utf-8") == text:
            return
    except OSError:
        pass
    tmp = p.with_name(p.name + ".tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, p)
    finally:
        tmp.unlink(missing_ok=True)


def is_stale(m: Manifest, s: Script) -> bool:
    """True when the script changed since the manifest's video was published."""
    return m.scriptHash != script_hash(s)
