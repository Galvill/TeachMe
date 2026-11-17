"""Publishing a finished build to a local path or S3 (spec §10).

``publish`` reads only the build dir's ``build.json`` and the files it names; it never re-runs
the pipeline. Objects are content-addressed by the video's sha256:

    <prefix>/<slug>/<sha256(video)[:12]>/{video.mp4,captions.srt,poster.png}

so an old manifest keeps working after a new build, and publishing an unchanged build copies or
uploads nothing. A local target has no prefix and never writes outside its ``path``.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from vidgen.cache import build_dir as default_build_dir
from vidgen.config import Config, LocalTarget, S3Target
from vidgen.manifest import FileRef, Files, Manifest, ManifestError, TtsInfo, manifest_path, read_manifest
from vidgen.schema import load_script, script_hash

# role -> (published file name, Content-Type)
FILES: dict[str, tuple[str, str]] = {
    "video": ("video.mp4", "video/mp4"),
    "captions": ("captions.srt", "application/x-subrip"),
    "poster": ("poster.png", "image/png"),
}
HASH_DIR_CHARS = 12
CHUNK = 1 << 20


class PublishError(Exception):
    """A build that can't be published (missing, draft, out of date) or a bad target."""


@dataclass(frozen=True)
class _Source:
    role: str
    path: Path
    name: str
    content_type: str
    sha256: str
    size: int


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def _resolve_target(cfg: Config, target: str | None) -> tuple[str, LocalTarget | S3Target]:
    name = target if target is not None else cfg.publish.default
    if name is None:
        raise PublishError("no publish target; set publish.default or pass --target")
    if name not in cfg.publish.targets:
        known = ", ".join(sorted(cfg.publish.targets)) or "none configured"
        raise PublishError(f'no publish target "{name}" (targets: {known})')
    return name, cfg.publish.targets[name]


def _read_build(d: Path, slug: str) -> dict[str, Any]:
    bj = d / "build.json"
    if not bj.is_file():
        raise PublishError(f"no build for {slug}; run vidgen build")
    try:
        meta = json.loads(bj.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise PublishError(f"{bj}: unreadable build.json ({e})") from None
    if not isinstance(meta, dict):
        raise PublishError(f"{bj}: build.json is not a JSON object")
    return meta


def _sources(d: Path, meta: dict[str, Any]) -> list[_Source]:
    files = meta.get("files") or {}
    out: list[_Source] = []
    root = d.resolve()
    for role, (name, ctype) in FILES.items():
        rel = files.get(role)
        if not isinstance(rel, str) or not rel:
            raise PublishError(f"build.json lists no {role} file; run vidgen build")
        path = (d / rel).resolve()
        if path.parent != root:
            raise PublishError(f'build.json {role} file "{rel}" is outside the build dir')
        if not path.is_file():
            raise PublishError(f"{path}: missing from the build; run vidgen build")
        out.append(_Source(role, path, name, ctype, sha256_file(path), path.stat().st_size))
    return out


def _url(base: str | None, rel: str) -> str | None:
    return None if not base else base.rstrip("/") + "/" + rel


# --- targets ------------------------------------------------------------------------------


def _local_dir(t: LocalTarget, rel_dir: str) -> Path:
    """``<path>/<rel_dir>``, refusing anything that resolves outside ``path``."""
    root = Path(t.path).expanduser().resolve()
    dest = (root / rel_dir).resolve()
    if not dest.is_relative_to(root) or dest == root:
        raise PublishError(f'"{rel_dir}" escapes the publish path {root}')
    return dest


def _publish_local(t: LocalTarget, rel_dir: str, srcs: list[_Source]) -> tuple[dict[str, FileRef], bool]:
    dest_dir = _local_dir(t, rel_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    _local_dir(t, rel_dir)  # re-check now that it exists: a symlinked dir must not lead outside the path
    refs: dict[str, FileRef] = {}
    changed = False
    for s in srcs:
        dest = dest_dir / s.name
        if dest.is_symlink() or not (dest.is_file() and sha256_file(dest) == s.sha256):
            tmp = dest_dir / f".{s.name}.tmp"
            try:
                shutil.copyfile(s.path, tmp)
                os.replace(tmp, dest)  # replaces a symlink itself, never its target
            finally:
                tmp.unlink(missing_ok=True)
            changed = True
        refs[s.role] = FileRef(
            location=dest.as_uri(), url=_url(t.public_base_url, f"{rel_dir}/{s.name}"), sha256=s.sha256, bytes=s.size
        )
    return refs, changed


def _s3_client(t: S3Target) -> Any:
    import boto3

    return boto3.client("s3", region_name=t.region or None, endpoint_url=t.endpoint_url or None)


def _s3_has(client: Any, bucket: str, key: str, sha: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except ClientError as e:
        if str(e.response.get("Error", {}).get("Code")) in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
    return (head.get("Metadata") or {}).get("sha256") == sha


def _publish_s3(t: S3Target, rel_dir: str, srcs: list[_Source]) -> tuple[dict[str, FileRef], bool]:
    client = _s3_client(t)
    prefix = t.prefix.strip("/")
    key_dir = f"{prefix}/{rel_dir}" if prefix else rel_dir
    refs: dict[str, FileRef] = {}
    changed = False
    for s in srcs:
        key = f"{key_dir}/{s.name}"
        if not _s3_has(client, t.bucket, key, s.sha256):
            client.upload_file(
                str(s.path), t.bucket, key, ExtraArgs={"ContentType": s.content_type, "Metadata": {"sha256": s.sha256}}
            )
            changed = True
        refs[s.role] = FileRef(
            location=f"s3://{t.bucket}/{key}",
            url=_url(t.public_base_url, f"{rel_dir}/{s.name}"),
            sha256=s.sha256,
            bytes=s.size,
        )
    return refs, changed


# --- publish ------------------------------------------------------------------------------


def publish(script_path: Path, cfg: Config, target: str | None = None, build_dir: Path | None = None) -> Manifest:
    """Publish the script's finished build and return its manifest (the caller writes it).

    ``publishedAt`` is carried over from the existing manifest when nothing was copied or
    uploaded and the files are the same, so republishing an unchanged build is a no-op.
    """
    script_path = Path(script_path)
    script = load_script(script_path)
    name, t = _resolve_target(cfg, target)
    d = Path(build_dir) if build_dir is not None else default_build_dir(cfg.paths.cache, script.slug)
    meta = _read_build(d, script.slug)
    if meta.get("draft"):
        raise PublishError("draft build; rebuild without --draft")
    if meta.get("scriptHash") != script_hash(script):
        raise PublishError("build is out of date; run vidgen build")

    srcs = _sources(d, meta)
    video_sha = next(s.sha256 for s in srcs if s.role == "video")
    rel_dir = f"{script.slug}/{video_sha[:HASH_DIR_CHARS]}"
    if isinstance(t, LocalTarget):
        refs, changed = _publish_local(t, rel_dir, srcs)
    else:
        refs, changed = _publish_s3(t, rel_dir, srcs)
    files = Files(**refs)

    try:
        previous = read_manifest(manifest_path(script_path))
    except ManifestError:
        previous = None
    keep = previous is not None and not changed and previous.files == files and previous.target == name
    tts = meta.get("tts") or {}
    return Manifest(
        slug=script.slug,
        title=script.title,
        scriptHash=script_hash(script),
        syncedCommit=script.syncedCommit,
        sources=list(script.sources),
        durationSec=float(meta.get("durationSec", 0.0)),
        resolution=(int(meta.get("width", 0)), int(meta.get("height", 0))),
        language=script.language,
        tts=TtsInfo(
            engine=str(tts.get("endpoint", "")),
            model=str(tts.get("model", "")),
            voice=str(tts.get("voice", "")),
            license=str(tts.get("license", "")),
        ),
        vidgenVersion=str(meta.get("vidgenVersion", "")),
        publishedAt=previous.publishedAt if keep and previous is not None else _now(),
        target=name,
        files=files,
    )
