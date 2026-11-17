"""``vidgen doctor``: check the toolchain and that every configured endpoint answers."""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Literal

import httpx

from vidgen import tools
from vidgen.config import Config

ENDPOINT_TIMEOUT_S = 5.0
MIN_PYTHON = (3, 11)
MIN_NODE = 20

Status = Literal["ok", "warn", "fail"]


@dataclass(frozen=True)
class Check:
    status: Status
    name: str
    detail: str

    def __str__(self) -> str:
        return f"{self.status} {self.name}: {self.detail}"


def _python() -> Check:
    v = sys.version_info
    ok = (v.major, v.minor) >= MIN_PYTHON
    detail = f"{v.major}.{v.minor}.{v.micro}" + ("" if ok else f"; need {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+")
    return Check("ok" if ok else "fail", "python", detail)


def _node(cfg: Config) -> Check:
    try:
        node = tools.find_node(cfg)
        out = subprocess.run([str(node), "--version"], capture_output=True, text=True, check=False, timeout=10)
    except (tools.ToolMissing, OSError, subprocess.TimeoutExpired):
        return Check("fail", "node", f"not found ({cfg.paths.node}); install Node {MIN_NODE}+")
    m = re.match(r"v?(\d+)", out.stdout.strip())
    if not m:
        return Check("fail", "node", f"can't read the version of {node}")
    if int(m.group(1)) < MIN_NODE:
        return Check("fail", "node", f"{out.stdout.strip()} at {node}; need {MIN_NODE}+")
    return Check("ok", "node", f"{out.stdout.strip()} at {node}")


def _renderer(cfg: Config) -> Check:
    try:
        return Check("ok", "renderer", str(tools.renderer_cli(cfg)))
    except tools.ToolMissing as e:
        return Check("fail", "renderer", str(e))


def _ffmpeg(cfg: Config) -> list[Check]:
    try:
        ffmpeg, ffprobe = tools.find_ffmpeg(cfg)
    except tools.ToolMissing:
        return [Check("fail", "ffmpeg", "not found; run vidgen/setup.sh")]
    checks = [Check("ok", "ffmpeg", f"{ffmpeg} (ffprobe {ffprobe})")]
    try:
        encs = tools.encoders(ffmpeg)
        filts = tools.filters(ffmpeg)
    except (tools.ToolFailed, tools.ToolMissing) as e:
        return [Check("fail", "ffmpeg", f"{ffmpeg} doesn't run: {str(e).splitlines()[0]}")]
    checks.append(Check("ok", "libx264", "available") if "libx264" in encs
                  else Check("fail", "libx264", "missing from this ffmpeg; run vidgen/setup.sh"))
    checks.append(Check("ok", "loudnorm", "available") if "loudnorm" in filts
                  else Check("fail", "loudnorm", "missing from this ffmpeg; run vidgen/setup.sh"))
    checks.append(Check("ok", "h264_nvenc", "available") if "h264_nvenc" in encs
                  else Check("warn", "h264_nvenc", "not available; encoding falls back to libx264"))
    return checks


def _endpoint(section: str, name: str, base_url: str) -> Check:
    label = f"{section} endpoint {name}"
    try:
        resp = httpx.get(base_url, timeout=ENDPOINT_TIMEOUT_S)
    except httpx.HTTPError as e:
        return Check("fail", label, f"{base_url} unreachable ({type(e).__name__})")
    return Check("ok", label, f"{base_url} answered HTTP {resp.status_code}")


def doctor(cfg: Config) -> list[Check]:
    checks = [_python(), _node(cfg), _renderer(cfg), *_ffmpeg(cfg)]
    for section in ("tts", "align"):
        endpoints = getattr(cfg, section).endpoints
        if not endpoints:
            checks.append(Check("warn", section, f"no [{section}.endpoints] configured in vidgen.toml"))
        for name, ep in endpoints.items():
            checks.append(_endpoint(section, name, ep.base_url))
    return checks
