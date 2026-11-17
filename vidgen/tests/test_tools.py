import sys
from pathlib import Path

import pytest

from vidgen import tools
from vidgen.config import Config, Encoder, Paths
from vidgen.tools import ToolFailed, ToolMissing, encoder_args, find_ffmpeg, renderer_cli, run


def _exe(path: Path, body: str = "exit 0") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(0o755)
    return path


def test_ffmpeg_lookup_order(tmp_path, monkeypatch):
    on_path = tmp_path / "path"
    _exe(on_path / "ffmpeg")
    _exe(on_path / "ffprobe")
    monkeypatch.setenv("PATH", str(on_path))
    cache = tmp_path / "cache"
    explicit = _exe(tmp_path / "explicit" / "ffmpeg")
    _exe(tmp_path / "explicit" / "ffprobe")

    # 3. PATH, when nothing else is set.
    assert find_ffmpeg(Config(paths=Paths(cache=cache))) == (on_path / "ffmpeg", on_path / "ffprobe")

    # 2. <cache>/bin/ffmpeg wins over PATH; ffprobe comes from the same folder.
    cached = _exe(cache / "bin" / "ffmpeg")
    _exe(cache / "bin" / "ffprobe")
    assert find_ffmpeg(Config(paths=Paths(cache=cache))) == (cached, cache / "bin" / "ffprobe")

    # 1. paths.ffmpeg wins over both.
    cfg = Config(paths=Paths(cache=cache, ffmpeg=str(explicit)))
    assert find_ffmpeg(cfg) == (explicit, explicit.with_name("ffprobe"))

    # A configured path that doesn't exist falls through to the next candidate.
    cfg = Config(paths=Paths(cache=cache, ffmpeg=str(tmp_path / "nope" / "ffmpeg")))
    assert find_ffmpeg(cfg)[0] == cached

    # Nothing anywhere.
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(ToolMissing, match=r"ffmpeg not found; run vidgen/setup.sh"):
        find_ffmpeg(Config(paths=Paths(cache=tmp_path / "other")))


def test_renderer_cli(tmp_path):
    with pytest.raises(ToolMissing, match="renderer not built; run vidgen/setup.sh"):
        renderer_cli(Config(paths=Paths(renderer=tmp_path)))
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "cli.js").write_text("")
    assert renderer_cli(Config(paths=Paths(renderer=tmp_path))) == tmp_path / "dist" / "cli.js"
    # Default: renderer/ next to the package source.
    assert tools.renderer_dir(Config()) == Path(tools.__file__).resolve().parents[2] / "renderer"


def test_encoder_auto_fallback():
    cfg = Config(encoder=Encoder(codec="auto", crf=20, cq=23, preset="medium"))
    assert encoder_args(cfg, {"libx264", "h264_nvenc"}) == [
        "-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "0",
        "-profile:v", "high",
    ]
    assert encoder_args(cfg, {"libx264"}) == ["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-profile:v", "high"]


def test_explicit_nvenc_missing():
    cfg = Config(encoder=Encoder(codec="h264_nvenc"))
    with pytest.raises(ToolMissing, match="h264_nvenc"):
        encoder_args(cfg, {"libx264"})
    assert encoder_args(Config(encoder=Encoder(codec="libx264")), {"libx264", "h264_nvenc"})[1] == "libx264"


def test_run_failure_tail():
    script = "import sys\nfor i in range(100): print(f'line {i}', file=sys.stderr)\nsys.exit(3)"
    with pytest.raises(ToolFailed) as info:
        run([sys.executable, "-c", script])
    err = info.value
    assert err.code == 3
    assert err.cmd[0] == sys.executable
    lines = err.stderr_tail.splitlines()
    assert len(lines) == 40
    assert lines[0] == "line 60" and lines[-1] == "line 99"
    assert run([sys.executable, "-c", "print('ok')"]).stdout.strip() == b"ok"


def test_encoders_parsing(tmp_path):
    listing = """Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx264              libx264 H.264 / AVC (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
"""
    (tmp_path / "listing.txt").write_text(listing)
    ff = _exe(tmp_path / "ffmpeg", f'cat "{tmp_path / "listing.txt"}"')
    assert tools.encoders(ff) == {"libx264", "h264_nvenc", "aac"}
    # Listed but unusable (no GPU): a test encode fails, so h264_nvenc doesn't count.
    ff = _exe(tmp_path / "ffmpeg2", f'case "$*" in *lavfi*) exit 1;; esac\ncat "{tmp_path / "listing.txt"}"')
    assert tools.encoders(ff) == {"libx264", "aac"}
