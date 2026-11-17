"""Content-hash cache keys and atomic object writes.

Objects live under ``<cfg.paths.cache>/objects/<kind>/<k[:2]>/<k>.<ext>``. Build outputs go
to ``<cfg.paths.cache>/builds/<slug>/`` unless ``--out`` is given.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Literal

Kind = Literal["tts", "align", "scene"]


def key(*parts: Any) -> str:
    """sha256 hex of the parts' canonical JSON; dict key order doesn't matter."""
    text = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def objects_root(cache_dir: Path) -> Path:
    return Path(cache_dir) / "objects"


def build_dir(cache_dir: Path, slug: str) -> Path:
    """``<cache>/builds/<slug>``; raises ``ValueError`` if ``slug`` would escape ``builds/``.

    The schema already restricts slugs to ``^[a-z0-9][a-z0-9-]*$``; this is defense in depth.
    """
    builds = (Path(cache_dir) / "builds").resolve()
    d = (builds / slug).resolve()
    if d.parent != builds:
        raise ValueError(f'slug "{slug}" escapes the build folder {builds}')
    return d


class Cache:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path(self, kind: Kind, k: str, ext: str) -> Path:
        return self.root / kind / k[:2] / f"{k}.{ext.lstrip('.')}"

    def write(self, path: Path, data: bytes) -> None:
        """Write ``data`` to ``<path>.tmp`` then rename, so a crash never leaves a partial object."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        try:
            with open(tmp, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
