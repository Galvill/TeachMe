import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from vidgen.cli import app
from vidgen.manifest import (
    FileRef,
    Files,
    Manifest,
    ManifestError,
    TtsInfo,
    is_stale,
    manifest_path,
    read_manifest,
    write_manifest,
)
from vidgen.schema import load_script, script_hash

FIXTURES = Path(__file__).parent / "fixtures"
runner = CliRunner()


def make_manifest(script_hash_value: str, **over) -> Manifest:
    ref = FileRef(location="file:///pub/dns-mini/ab12cd34ef56/video.mp4", url=None, sha256="ab" * 32, bytes=10)
    data = dict(
        slug="dns-mini",
        title="DNS",
        scriptHash=script_hash_value,
        syncedCommit="3f2a9c1",
        sources=["src/resolver.ts"],
        durationSec=52.4,
        resolution=(1920, 1080),
        language="en",
        tts=TtsInfo(engine="fake", model="fake-model", voice="default", license="MIT"),
        vidgenVersion="0.0.0",
        publishedAt="2026-11-17T10:00:00Z",
        target="nas",
        files=Files(video=ref, captions=ref, poster=ref),
    )
    data.update(over)
    return Manifest(**data)


def test_path_rule(tmp_path):
    assert manifest_path(tmp_path / "dns" / "script.yaml") == tmp_path / "dns" / "manifest.json"
    assert manifest_path(tmp_path / "videos" / "dns-lookup.yaml") == tmp_path / "videos" / "dns-lookup.manifest.json"
    assert manifest_path(Path("a/b.yml")) == Path("a/b.manifest.json")


def test_roundtrip_byte_stable(tmp_path):
    p = tmp_path / "manifest.json"
    m = make_manifest("sha256:" + "0" * 64)
    write_manifest(p, m)
    first = p.read_bytes()
    assert first.endswith(b"}\n")
    assert b'\n  "files": {' in first  # two-space indent
    keys = [line.split('"')[1] for line in first.decode().splitlines() if line.startswith('  "')]
    assert keys == sorted(keys)
    assert b'"version": 1' in first
    assert b'"url": null' in first

    back = read_manifest(p)
    assert back == m
    write_manifest(p, back)
    assert p.read_bytes() == first

    assert read_manifest(tmp_path / "missing.json") is None
    (tmp_path / "bad.json").write_text("{not json")
    with pytest.raises(ManifestError, match="bad.json: invalid JSON"):
        read_manifest(tmp_path / "bad.json")


def test_stale_detected():
    s = load_script(FIXTURES / "dns-mini.yaml")
    assert not is_stale(make_manifest(script_hash(s)), s)
    changed = s.model_copy(update={"title": "Something else"})
    assert is_stale(make_manifest(script_hash(s)), changed)


def test_validate_strict_exit(tmp_path):
    script = tmp_path / "dns-mini.yaml"
    shutil.copyfile(FIXTURES / "dns-mini.yaml", script)
    s = load_script(script)

    write_manifest(manifest_path(script), make_manifest(script_hash(s)))
    fresh = runner.invoke(app, ["validate", "--strict", str(script)])
    assert fresh.exit_code == 0, fresh.output
    assert "warn:" not in fresh.output

    write_manifest(manifest_path(script), make_manifest("sha256:" + "0" * 64))
    warn = "warn: manifest is out of date (script changed since publish)"
    loose = runner.invoke(app, ["validate", str(script)])
    assert loose.exit_code == 0
    assert loose.output == f"{warn}\nok: 2 scenes\n"

    strict = runner.invoke(app, ["validate", "--strict", str(script)])
    assert strict.exit_code == 1
    assert strict.output == f"{warn}\n"
