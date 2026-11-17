"""Locating ffmpeg, ffprobe, node and the built renderer, and running them.

Every subprocess runs from an argument list, never a shell string.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from vidgen.config import Config

STDERR_TAIL_LINES = 40
SETUP_HINT = "run vidgen/setup.sh"
_FLAGS_RE = re.compile(r"[A-Z.|]+")


class ToolMissing(Exception):
    """A required external tool (ffmpeg, node, the built renderer, an encoder) isn't available."""


class ToolFailed(Exception):
    """A subprocess exited non-zero."""

    def __init__(self, cmd: list[str], code: int, stderr_tail: str) -> None:
        self.cmd = cmd
        self.code = code
        self.stderr_tail = stderr_tail
        name = Path(cmd[0]).name if cmd else "command"
        msg = f"{name} exited with code {code}"
        if stderr_tail:
            msg += f":\n{stderr_tail}"
        super().__init__(msg)


def _executable(candidate: str | Path) -> Path | None:
    """``candidate`` as an executable path: a path that exists, or a bare name found on PATH."""
    text = str(candidate)
    if "/" in text or "\\" in text:
        p = Path(text).expanduser()
        return p if p.is_file() else None
    found = shutil.which(text)
    return Path(found) if found else None


def find_ffmpeg(cfg: Config) -> tuple[Path, Path]:
    """``(ffmpeg, ffprobe)``.

    ffmpeg comes from ``cfg.paths.ffmpeg``, then ``<cache>/bin/ffmpeg``, then PATH. ffprobe is
    taken from the same folder as ffmpeg, falling back to PATH.
    """
    ffmpeg: Path | None = None
    if cfg.paths.ffmpeg:
        ffmpeg = _executable(cfg.paths.ffmpeg)
    if ffmpeg is None:
        cached = cfg.paths.cache / "bin" / "ffmpeg"
        ffmpeg = cached if cached.is_file() else None
    if ffmpeg is None:
        ffmpeg = _executable("ffmpeg")
    if ffmpeg is None:
        raise ToolMissing(f"ffmpeg not found; {SETUP_HINT}")
    sibling = ffmpeg.with_name("ffprobe" + ffmpeg.suffix)
    ffprobe = sibling if sibling.is_file() else _executable("ffprobe")
    if ffprobe is None:
        raise ToolMissing(f"ffprobe not found next to {ffmpeg} or on PATH; {SETUP_HINT}")
    return ffmpeg, ffprobe


def find_node(cfg: Config) -> Path:
    node = _executable(cfg.paths.node)
    if node is None:
        raise ToolMissing(f"node not found ({cfg.paths.node}); install Node 20+")
    return node


def renderer_dir(cfg: Config) -> Path:
    """``cfg.paths.renderer``, or ``renderer/`` next to the package source."""
    if cfg.paths.renderer is not None:
        return cfg.paths.renderer
    return (Path(__file__).resolve().parent / ".." / ".." / "renderer").resolve()


def renderer_cli(cfg: Config) -> Path:
    cli = renderer_dir(cfg) / "dist" / "cli.js"
    if not cli.is_file():
        raise ToolMissing(f"renderer not built; {SETUP_HINT}")
    return cli


def run(cmd: list[str | Path]) -> subprocess.CompletedProcess[bytes]:
    """Run ``cmd`` capturing output; raise :class:`ToolFailed` with the stderr tail on failure."""
    args = [str(c) for c in cmd]
    try:
        proc = subprocess.run(args, capture_output=True, check=False)
    except FileNotFoundError:
        raise ToolMissing(f"{args[0]} not found; {SETUP_HINT}") from None
    if proc.returncode != 0:
        raise ToolFailed(args, proc.returncode, stderr_tail(proc.stderr))
    return proc


def stderr_tail(stderr: bytes | str, lines: int = STDERR_TAIL_LINES) -> str:
    text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else stderr
    return "\n".join([line for line in text.splitlines() if line.strip()][-lines:])


def _listing(ffmpeg: Path, flag: str) -> set[str]:
    out = run([ffmpeg, "-hide_banner", flag]).stdout.decode("utf-8", errors="replace")
    names: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        # Rows look like " V....D libx264   description" (encoders) or " ... loudnorm  A->A  ..." (filters).
        if len(parts) >= 3 and parts[1] != "=" and _FLAGS_RE.fullmatch(parts[0]):
            names.add(parts[1])
    return names


# Hardware encoders that distro builds often list but can't open without the GPU and driver.
_PROBED = ("h264_nvenc",)


def _encoder_works(ffmpeg: Path, name: str) -> bool:
    cmd = [str(ffmpeg), "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
           "-c:v", name, "-f", "null", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, check=False, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def encoders(ffmpeg: Path) -> set[str]:
    """Encoder names this ffmpeg can use.

    Hardware encoders (``h264_nvenc``) count only when a tiny test encode succeeds: a distro
    ffmpeg lists them even on a machine with no NVIDIA GPU.
    """
    names = _listing(ffmpeg, "-encoders")
    for name in _PROBED:
        if name in names and not _encoder_works(ffmpeg, name):
            names.discard(name)
    return names


def filters(ffmpeg: Path) -> set[str]:
    """Filter names this ffmpeg was built with."""
    return _listing(ffmpeg, "-filters")


def encoder_args(cfg: Config, available: set[str]) -> list[str]:
    """ffmpeg video encoder arguments for ``cfg.encoder`` given the encoders ``available``."""
    enc = cfg.encoder
    codec = enc.codec
    if codec == "auto":
        codec = "h264_nvenc" if "h264_nvenc" in available else "libx264"
    if codec not in available:
        raise ToolMissing(f"encoder {codec} is not available in this ffmpeg; {SETUP_HINT}")
    if codec == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", str(enc.cq),
                "-b:v", "0", "-profile:v", "high"]
    return ["-c:v", "libx264", "-crf", str(enc.crf), "-preset", enc.preset, "-profile:v", "high"]
