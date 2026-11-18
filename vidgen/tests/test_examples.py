"""The DNS acceptance example: it validates, lints clean and builds against the fake endpoint."""

from pathlib import Path

import pytest

from conftest import needs_ffmpeg
from test_render import needs_renderer
from vidgen.build import LintFailed, _prepare, build, format_issue
from vidgen.config import Config, Encoder, Endpoint, EndpointSet, Paths
from vidgen.narration import parse_narration
from vidgen.render import lint
from vidgen.schema import load_script

DNS = Path(__file__).parents[1] / "examples" / "dns-lookup" / "script.yaml"
SCENES = ["intro", "cache-miss", "ask-root", "ask-tld", "ask-authoritative", "answer-cached"]
SERVERS = {"root", "tld", "authoritative"}


def _cfg(base_url: str, cache: Path, **kw) -> Config:
    eps = {"fake": Endpoint(base_url=base_url, model="fake-model", license="MIT")}
    return Config(
        tts=EndpointSet(endpoint="fake", endpoints=eps),
        align=EndpointSet(endpoint="fake", endpoints=eps),
        encoder=Encoder(codec="libx264", preset="ultrafast"),
        paths=Paths(cache=cache),
        **kw,
    )


def test_dns_validates():
    s = load_script(DNS)
    assert s.slug == "dns-lookup"
    assert [sc.id for sc in s.scenes] == SCENES
    assert set(s.scenes[0].diagram.nodes) == {"browser", "resolver"} | SERVERS
    assert all(sc.diagram.inherit for sc in s.scenes[1:])
    assert {"DNS", "TLD", "TTL", "IPv6"} <= set(s.pronunciations)


def test_dns_word_count():
    s = load_script(DNS)
    words = sum(len(parse_narration(sc.narration).words) for sc in s.scenes)
    assert 115 <= words <= 150


def test_dns_queries_are_request_reply_pairs():
    s = load_script(DNS)
    for sc in s.scenes:
        sends = [st.send for st in sc.steps if st.send is not None]
        for req in (x for x in sends if x.kind == "request" and x.to in SERVERS):
            # The request is cued on the server's name and answered by a reply from it.
            step = next(st for st in sc.steps if st.send is req)
            assert step.when.kind == "cue"
            assert any(x.kind == "reply" and (x.from_, x.to) == (req.to, req.from_) for x in sends)
    asked = {x.to for sc in s.scenes for st in sc.steps if (x := st.send) and x.kind == "request"}
    assert SERVERS <= asked

    last = s.scenes[-1].steps
    i = next(k for k, st in enumerate(last) if st.send and st.send.kind == "answer")
    assert last[i].send.to == "browser"
    assert last[i + 1].badge is not None and last[i + 1].badge.text == "93.184.216.34"


@needs_renderer
def test_dns_lint_clean(fake_endpoint, tmp_path):
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache")
    p = _prepare(DNS, cfg)
    for sid in SCENES:
        assert lint(cfg, p.scenes[sid]).issues == [], sid


@needs_renderer
@needs_ffmpeg
def test_dns_builds_lint_clean(fake_endpoint, tmp_path):
    # Small frames keep it fast; lint runs inside build on the same scaled geometry.
    cfg = _cfg(fake_endpoint.base_url, tmp_path / "cache", width=480, height=270)
    try:
        r = build(DNS, cfg, out=tmp_path / "out")
    except LintFailed as e:  # build lints every scene before rendering any
        pytest.fail("\n".join(format_issue(i) for i in e.issues))
    assert r.video.is_file()
    assert sorted(r.rendered) == sorted(SCENES)
    assert 30 < r.duration < 90


@pytest.mark.parametrize("sid", SCENES)
def test_dns_cues_resolve(sid):
    # Every step's cue names a word in its own scene's narration (validate checks this too).
    s = load_script(DNS)
    words = {w.lower().strip(".,?") for w in parse_narration(s.scene(sid).narration).words}
    for st in s.scene(sid).steps:
        if st.when.kind == "cue":
            assert st.when.name.lower() in words
