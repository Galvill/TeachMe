import json
import subprocess
from pathlib import Path

import pytest

from conftest import needs_ffmpeg
from vidgen.config import Config
from vidgen.render import RendererError, frames, lint, render_scene
from vidgen.tools import ToolMissing, renderer_cli

FIXTURES = Path(__file__).parent / "fixtures"
RENDERER_FIXTURES = Path(__file__).parents[1] / "renderer" / "test" / "fixtures"


def _built() -> bool:
    try:
        renderer_cli(Config())
    except ToolMissing:
        return False
    return True


needs_renderer = pytest.mark.skipif(not _built(), reason="renderer dist/cli.js not built")


def _small_scene() -> dict:
    """The dns-mini intro scene at 320x180, cut to 1 s, so encoding is quick."""
    scene = json.loads((FIXTURES / "dns-mini.intro.scene.json").read_text(encoding="utf-8"))
    scene["width"], scene["height"] = 320, 180
    scene["scene"]["duration"] = 1.0
    scene["scene"]["steps"] = [s for s in scene["scene"]["steps"] if s["start"] < 1.0]
    return scene


def _probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


@needs_renderer
def test_lint_reports_issues():
    scene = json.loads((RENDERER_FIXTURES / "lint-label-overlap.json").read_text(encoding="utf-8"))
    report = lint(Config(), scene)
    assert report.issues, "the overlap fixture must report issues"
    assert {i["kind"] for i in report.issues} >= {"label-overlap"}
    first = report.issues[0]
    assert set(first) >= {"scene", "t", "kind", "elements", "message"}
    assert first["scene"] == "overlap"
    assert report.densest and set(report.densest[0]) == {"t", "labels"}

    clean = json.loads((RENDERER_FIXTURES / "lint-clean.json").read_text(encoding="utf-8"))
    assert lint(Config(), clean).issues == []


@needs_renderer
@needs_ffmpeg
def test_render_writes_mp4(tmp_path):
    out = tmp_path / "scenes" / "01-intro.mp4"
    render_scene(Config(), _small_scene(), out)
    assert out.is_file() and out.stat().st_size > 0
    assert _probe_duration(out) == pytest.approx(1.0, abs=1 / 30)
    assert not list(out.parent.glob("*.part.mp4"))


@needs_renderer
def test_frames(tmp_path):
    paths = frames(Config(), _small_scene(), [0.0, 0.5], tmp_path / "frames")
    assert [p.name for p in paths] == ["intro-0.00.png", "intro-0.50.png"]
    assert all(p.read_bytes().startswith(b"\x89PNG") for p in paths)


@needs_renderer
def test_bad_input_raises(tmp_path):
    scene = _small_scene()
    del scene["width"]
    with pytest.raises(RendererError) as info:
        lint(Config(), scene)
    assert info.value.code == 2
    assert "width" in info.value.stderr_tail
    with pytest.raises(RendererError):
        frames(Config(), scene, [0.0], tmp_path)
