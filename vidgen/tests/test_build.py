import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from conftest import needs_ffmpeg
from test_render import needs_renderer
from vidgen.assemble import measure_lufs, probe_duration
from vidgen.build import LintFailed, build, preview, render_one, to_local
from vidgen.cli import app
from vidgen.config import Config, Encoder, Endpoint, EndpointSet, Paths
from vidgen.timeline import SceneTime, Timeline

FIXTURES = Path(__file__).parent / "fixtures"
FRAME = 1 / 30

pytestmark = [needs_renderer, needs_ffmpeg]


def _cfg(base_url: str, cache: Path) -> Config:
    eps = {"fake": Endpoint(base_url=base_url, model="fake-model", license="MIT")}
    return Config(
        width=480, height=270,  # small frames keep the suite fast; geometry is in design space
        tts=EndpointSet(endpoint="fake", endpoints=eps),
        align=EndpointSet(endpoint="fake", endpoints=eps),
        encoder=Encoder(codec="libx264", preset="ultrafast"),
        paths=Paths(cache=cache),
    )


def _toml(base_url: str, cache: Path) -> str:
    return f"""width = 480
height = 270
[paths]
cache = "{cache}"
[tts]
endpoint = "fake"
[tts.endpoints.fake]
base_url = "{base_url}"
model = "fake-model"
license = "MIT"
[align]
endpoint = "fake"
[align.endpoints.fake]
base_url = "{base_url}"
model = "fake-model"
[encoder]
codec = "libx264"
preset = "ultrafast"
"""


# dns-mini.yaml is a schema fixture and doesn't lint clean ("Recursive resolver" overflows the
# default box and the code block is a few px short). The build tests give those two elements room.
RESOLVER = 'resolver: {label: Recursive resolver, sub: "ISP / 8.8.8.8"}'
ROOMY = {
    RESOLVER: 'resolver: {label: Recursive resolver, sub: "ISP / 8.8.8.8", size: [330, 200]}',
    "size: [700, 160]": "size: [700, 190]",
}


@pytest.fixture
def script(tmp_path) -> Path:
    d = tmp_path / "videos" / "dns-mini"
    d.mkdir(parents=True)
    path = d / "script.yaml"
    text = (FIXTURES / "dns-mini.yaml").read_text()
    for old, new in ROOMY.items():
        assert old in text
        text = text.replace(old, new)
    path.write_text(text)
    return path


def test_build_end_to_end(fake_endpoint, script, tmp_path):
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    r = build(script, cfg, burn=True)
    assert r.dir == tmp_path / "cache" / "builds" / "dns-mini"
    for name in ("video.mp4", "captions.srt", "poster.png", "timeline.json", "build.json", "video.burned.mp4"):
        assert (r.dir / name).is_file(), name
    assert r.rendered == ["intro", "ask-root"]

    tl = json.loads(r.timeline.read_text())
    assert probe_duration(r.video, cfg) == pytest.approx(tl["total"], abs=FRAME)
    assert measure_lufs(r.video, cfg) == pytest.approx(-16, abs=1)
    assert r.poster.read_bytes().startswith(b"\x89PNG")
    assert r.captions.read_text().startswith("1\n00:00:00,000 --> ")

    meta = json.loads(r.build_json.read_text())
    assert meta["version"] == 1
    assert meta["slug"] == "dns-mini" and meta["title"] == "How a DNS lookup works"
    assert meta["scriptHash"].startswith("sha256:")
    assert meta["syncedCommit"] == "3f2a9c1" and meta["sources"] == ["src/resolver.ts"]
    assert meta["draft"] is False
    assert meta["durationSec"] == pytest.approx(tl["total"], abs=0.001)
    assert (meta["width"], meta["height"], meta["language"]) == (480, 270, "en")
    assert meta["tts"] == {"endpoint": "fake", "model": "fake-model", "voice": "default", "license": "MIT"}
    assert meta["files"] == {"video": "video.mp4", "captions": "captions.srt", "poster": "poster.png",
                             "timeline": "timeline.json", "burned": "video.burned.mp4"}
    # One TTS call per scene, with {mark} markers stripped from the spoken text.
    inputs = [req["json"]["input"] for req in fake_endpoint.tts_requests()]
    assert len(inputs) == 2
    assert "{r}" not in inputs[0] and "the recursive resolver." in inputs[0]


def test_rebuild_reuses_all(fake_endpoint, script, tmp_path):
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    build(script, cfg)
    before = len(fake_endpoint.requests)
    r = build(script, cfg, out=tmp_path / "out2")
    assert r.rendered == [] and r.reused == ["intro", "ask-root"]
    assert r.synth.synthesized == [] and r.synth.aligned == []
    assert len(fake_endpoint.requests) == before  # no endpoint call at all
    assert (tmp_path / "out2" / "build.json").is_file()


def test_language_change_realigns(fake_endpoint, script, tmp_path):
    from vidgen.build import _synthesize
    from vidgen.schema import load_script

    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    _synthesize(load_script(script), cfg)
    script.write_text(script.read_text().replace("language: en", "language: it"))
    _, stats = _synthesize(load_script(script), cfg)
    assert stats.synthesized == []  # the audio is reused
    assert stats.aligned == ["intro", "ask-root"]  # but the transcription request changed
    assert b'name="language"\r\n\r\nit' in fake_endpoint.requests[-1]["body"]


def test_failed_rebuild_leaves_no_build_json(fake_endpoint, script, tmp_path, monkeypatch):
    import vidgen.build as build_mod

    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    r = build(script, cfg)
    assert r.build_json.is_file()

    def boom(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(build_mod, "write_srt", boom)  # fails after the mux
    with pytest.raises(RuntimeError, match="disk full"):
        build(script, cfg)
    assert r.video.is_file()
    assert not r.build_json.exists()


def test_edit_one_scene(fake_endpoint, script, tmp_path):
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    build(script, cfg)
    text = script.read_text()
    old = "The resolver asks a root server, which points it to the .com servers."
    assert old in text
    script.write_text(text.replace(old, "Next the resolver asks a root server, and it points it to the .com servers."))
    r = build(script, cfg)
    assert r.rendered == ["ask-root"] and r.reused == ["intro"]
    assert r.synth.synthesized == ["ask-root"]
    tl = json.loads(r.timeline.read_text())
    assert probe_duration(r.video, cfg) == pytest.approx(tl["total"], abs=FRAME)


def test_lint_blocks_render(fake_endpoint, script, tmp_path):
    # Put the resolver right on top of the browser: their labels overlap.
    text = script.read_text().replace(ROOMY[RESOLVER], ROOMY[RESOLVER].replace("}", ", at: [190, 355]}"))
    script.write_text(text)
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    with pytest.raises(LintFailed) as info:
        build(script, cfg)
    assert any(i["kind"] == "label-overlap" for i in info.value.issues)
    assert not (tmp_path / "cache" / "objects" / "scene").exists()  # nothing rendered

    (script.parent / "vidgen.toml").write_text(_toml(fake_endpoint.base_url, tmp_path / "cache"))
    res = CliRunner().invoke(app, ["build", str(script)])
    assert res.exit_code == 1, res.output
    lines = res.output.strip().splitlines()
    assert lines and all(line.startswith("scene ") for line in lines)
    assert any(" label-overlap: " in line and line.startswith("scene intro t=") for line in lines)


def test_render_one_scene(fake_endpoint, script, tmp_path):
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    out = tmp_path / "out"
    path = render_one(script, cfg, "2", out)
    assert path == out / "scenes" / "02-ask-root.mp4"
    assert [p.name for p in (out / "scenes").iterdir()] == ["02-ask-root.mp4"]
    assert not (out / "video.mp4").exists()
    assert render_one(script, cfg, "intro", out) == out / "scenes" / "01-intro.mp4"
    with pytest.raises(ValueError, match='no scene "9"'):
        render_one(script, cfg, "9", out)


def test_preview_time_mapping(fake_endpoint, script, tmp_path):
    tl = Timeline(fps=30, width=1, height=1, total=5.0, scenes=[
        SceneTime("a", 0.0, 2.0, Path("a"), [], []), SceneTime("b", 2.0, 3.0, Path("b"), [], [])])
    assert to_local(tl, 0.0) == ("a", 0.0)
    assert to_local(tl, 1.5) == ("a", 1.5)
    assert to_local(tl, 2.0) == ("b", 0.0)
    assert to_local(tl, 3.25) == ("b", 1.25)
    assert to_local(tl, 5.0) == ("b", pytest.approx(3.0 - FRAME))
    with pytest.raises(ValueError, match="outside the video"):
        to_local(tl, 5.5)

    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    out = tmp_path / "out"
    build_tl = json.loads(build(script, cfg, out=out).timeline.read_text())
    second = build_tl["scenes"][1]
    t = second["offset"] + 1.0
    paths = preview(script, cfg, [0.5, t], out)
    assert [p.name for p in paths] == ["intro-0.50.png", "ask-root-1.00.png"]
    assert all(p.is_file() for p in paths)
    # Without --t: the top 3 densest moments.
    assert 1 <= len(preview(script, cfg, [], out)) <= 3


def test_endpoint_down_exit_2(script, tmp_path):
    (script.parent / "vidgen.toml").write_text(_toml("http://127.0.0.1:9/v1", tmp_path / "cache"))
    res = CliRunner().invoke(app, ["build", str(script)])
    assert res.exit_code == 2, res.output
    lines = res.output.strip().splitlines()
    assert len(lines) == 1
    assert lines[0].startswith('error: endpoint "fake": cannot connect')


def test_cli_build_draft(fake_endpoint, script, tmp_path):
    (script.parent / "vidgen.toml").write_text(_toml(fake_endpoint.base_url, tmp_path / "cache"))
    out = tmp_path / "out"
    res = CliRunner().invoke(app, ["build", str(script), "--out", str(out), "--draft"])
    assert res.exit_code == 0, res.output
    meta = json.loads((out / "build.json").read_text())
    assert meta["draft"] is True and (meta["width"], meta["height"]) == (1280, 720)
    for cmd in (["tts", str(script)], ["lint", str(script)], ["render", str(script), "--scene", "1", "--out", str(out)],
                ["preview", str(script), "--t", "1.0", "--out", str(out)]):
        res = CliRunner().invoke(app, cmd)
        assert res.exit_code == 0, (cmd, res.output)
    res = CliRunner().invoke(app, ["render", str(script), "--scene", "9"])
    assert res.exit_code == 1 and res.output.startswith('error: no scene "9"')
