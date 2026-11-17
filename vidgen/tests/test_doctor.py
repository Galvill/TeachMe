import shutil
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from vidgen import tools
from vidgen.cli import app
from vidgen.config import Config, Endpoint, EndpointSet
from vidgen.doctor import doctor

HERE = Path(__file__).resolve().parents[1]


@pytest.fixture
def toolchain(monkeypatch, tmp_path):
    """A healthy fake toolchain, so only the thing under test can fail."""
    cli = tmp_path / "renderer" / "dist" / "cli.js"
    cli.parent.mkdir(parents=True)
    cli.write_text("")
    monkeypatch.setattr(tools, "renderer_cli", lambda cfg: cli)
    monkeypatch.setattr(tools, "find_ffmpeg", lambda cfg: (Path("/x/ffmpeg"), Path("/x/ffprobe")))
    monkeypatch.setattr(tools, "encoders", lambda ff: {"libx264", "h264_nvenc"})
    monkeypatch.setattr(tools, "filters", lambda ff: {"loudnorm"})


def _cfg(tts_url: str, align_url: str | None = None) -> Config:
    return Config(
        tts=EndpointSet(endpoint="t", endpoints={"t": Endpoint(base_url=tts_url, model="m")}),
        align=EndpointSet(endpoint="a", endpoints={"a": Endpoint(base_url=align_url or tts_url, model="m")}),
    )


def _by_name(checks):
    return {c.name: c for c in checks}


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_doctor_endpoint_reachable(fake_endpoint, toolchain):
    checks = doctor(_cfg(fake_endpoint.base_url))
    assert [c.status for c in checks] == ["ok"] * len(checks), [str(c) for c in checks]
    names = _by_name(checks)
    assert names["tts endpoint t"].detail.endswith("answered HTTP 200")
    assert "align endpoint a" in names
    assert {"python", "node", "renderer", "ffmpeg", "libx264", "loudnorm", "h264_nvenc"} <= set(names)


def test_doctor_endpoint_down_fails(fake_endpoint, toolchain, tmp_path):
    checks = _by_name(doctor(_cfg(fake_endpoint.base_url, "http://127.0.0.1:9/v1")))
    assert checks["tts endpoint t"].status == "ok"
    assert checks["align endpoint a"].status == "fail"
    assert str(checks["align endpoint a"]).startswith("fail align endpoint a: http://127.0.0.1:9/v1 unreachable")

    (tmp_path / "vidgen.toml").write_text(
        '[tts]\nendpoint = "t"\n[tts.endpoints.t]\nbase_url = "http://127.0.0.1:9/v1"\nmodel = "m"\n'
    )
    res = CliRunner().invoke(app, ["doctor", "--config", str(tmp_path / "vidgen.toml")])
    assert res.exit_code == 1
    assert "fail tts endpoint t: " in res.output


def test_doctor_nvenc_warn_only(fake_endpoint, toolchain, monkeypatch, tmp_path):
    monkeypatch.setattr(tools, "encoders", lambda ff: {"libx264"})
    checks = _by_name(doctor(_cfg(fake_endpoint.base_url)))
    assert checks["h264_nvenc"].status == "warn"
    assert checks["libx264"].status == "ok"

    toml = tmp_path / "vidgen.toml"
    toml.write_text(f'[tts]\nendpoint = "t"\n[tts.endpoints.t]\nbase_url = "{fake_endpoint.base_url}"\nmodel = "m"\n')
    res = CliRunner().invoke(app, ["doctor", "--config", str(toml)])
    assert "warn h264_nvenc: " in res.output
    if shutil.which("node"):
        assert res.exit_code == 0, res.output

    # Missing libx264 or loudnorm, and a missing ffmpeg, are failures.
    monkeypatch.setattr(tools, "encoders", lambda ff: set())
    monkeypatch.setattr(tools, "filters", lambda ff: set())
    checks = _by_name(doctor(_cfg(fake_endpoint.base_url)))
    assert checks["libx264"].status == checks["loudnorm"].status == "fail"

    def missing(cfg):
        raise tools.ToolMissing("ffmpeg not found; run vidgen/setup.sh")

    monkeypatch.setattr(tools, "find_ffmpeg", missing)
    assert str(_by_name(doctor(_cfg(fake_endpoint.base_url)))["ffmpeg"]) == "fail ffmpeg: not found; run vidgen/setup.sh"


def test_setup_sh_parses():
    setup = HERE / "setup.sh"
    assert setup.is_file()
    subprocess.run(["bash", "-n", str(setup)], check=True)
    text = setup.read_text()
    assert "releases/latest" not in text and "download/latest" not in text
    assert "sha256sum" in text and "autobuild-" in text
