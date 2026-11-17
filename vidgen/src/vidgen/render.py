"""The bridge to the Node renderer. Python talks to it only through its CLI contract.

``node dist/cli.js render|frames|lint``; exit 0 ok, 1 lint issues, 2 bad input, 3 ffmpeg failed.
"""

from __future__ import annotations

import functools
import json
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from vidgen.config import Config
from vidgen.contracts import dumps
from vidgen.tools import encoder_args, encoders, find_ffmpeg, find_node, renderer_cli, stderr_tail


class RendererError(Exception):
    """The renderer rejected its input (exit 2) or ffmpeg failed inside it (exit 3)."""

    def __init__(self, command: str, code: int, stderr: str) -> None:
        self.command = command
        self.code = code
        self.stderr_tail = stderr
        super().__init__(f"renderer {command} exited with code {code}" + (f":\n{stderr}" if stderr else ""))


@dataclass
class LintReport:
    issues: list[dict] = field(default_factory=list)
    densest: list[dict] = field(default_factory=list)


@functools.lru_cache(maxsize=8)
def _encoders(ffmpeg: Path) -> frozenset[str]:
    return frozenset(encoders(ffmpeg))


def video_encoder_args(cfg: Config) -> list[str]:
    """The encoder args every scene is rendered with (identical across scenes, so concat is safe)."""
    ffmpeg, _ = find_ffmpeg(cfg)
    return encoder_args(cfg, set(_encoders(ffmpeg)))


def _call(cfg: Config, command: str, scene: dict, extra: list[str]) -> subprocess.CompletedProcess[str]:
    node = find_node(cfg)
    cli = renderer_cli(cfg)
    with tempfile.TemporaryDirectory(prefix="vidgen-scene-") as tmp:
        scene_file = Path(tmp) / "scene.json"
        scene_file.write_text(dumps(scene), encoding="utf-8")
        proc = subprocess.run(
            [str(node), str(cli), command, "--scene", str(scene_file), *extra],
            capture_output=True,
            text=True,
            check=False,
        )
    if proc.returncode not in (0, 1) or (proc.returncode == 1 and command != "lint"):
        raise RendererError(command, proc.returncode, stderr_tail(proc.stderr))
    return proc


def render_scene(cfg: Config, scene: dict, out: Path) -> None:
    """Encode one scene to ``out`` (the renderer writes a part file and renames on success)."""
    ffmpeg, _ = find_ffmpeg(cfg)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    enc = json.dumps({"args": video_encoder_args(cfg)})
    _call(cfg, "render", scene, ["--out", str(out), "--ffmpeg", str(ffmpeg), "--encoder", enc, "--ssaa", str(cfg.ssaa)])


def frames(cfg: Config, scene: dict, times: list[float], out_dir: Path) -> list[Path]:
    """PNG frames at scene-local ``times``; returns the paths in order."""
    args: list[str] = []
    for t in times:
        args += ["--t", repr(float(t))]
    proc = _call(cfg, "frames", scene, [*args, "--out-dir", str(out_dir), "--ssaa", str(cfg.ssaa)])
    return [Path(line) for line in proc.stdout.splitlines() if line.strip()]


def lint(cfg: Config, scene: dict) -> LintReport:
    proc = _call(cfg, "lint", scene, [])
    report = LintReport()
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        if "densest" in obj and len(obj) == 1:
            report.densest = obj["densest"]
        else:
            report.issues.append(obj)
    return report
