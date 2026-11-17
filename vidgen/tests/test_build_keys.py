"""Cache keys for the build: no ffmpeg or renderer needed."""

from vidgen.build import alignment_key, renderer_hash
from vidgen.config import Config, Endpoint, Paths


def test_alignment_key_covers_the_request():
    ep = Endpoint(base_url="http://x/v1", model="large-v3")
    base = alignment_key("tts", "whisper", ep, "en")
    assert alignment_key("tts", "whisper", ep, "en") == base
    assert alignment_key("tts", "whisper", ep, "it") != base  # language is sent, so it's keyed
    assert alignment_key("tts", "whisper", ep.model_copy(update={"extra": {"temperature": 0}}), "en") != base
    assert alignment_key("tts", "whisper", ep.model_copy(update={"model": "small"}), "en") != base
    assert alignment_key("tts", "other", ep, "en") != base
    assert alignment_key("tts2", "whisper", ep, "en") != base


def test_renderer_hash_covers_dist_fonts_and_lockfile(tmp_path):
    (tmp_path / "dist").mkdir()
    (tmp_path / "fonts").mkdir()
    (tmp_path / "dist" / "cli.js").write_text("a")
    (tmp_path / "fonts" / "Excalifont-Regular.woff2").write_bytes(b"font")
    (tmp_path / "package-lock.json").write_text("{}")
    (tmp_path / "README.md").write_text("docs")
    cfg = Config(paths=Paths(renderer=tmp_path))

    seen = {renderer_hash(cfg)}
    for path, data in [("dist/cli.js", "b"), ("fonts/Excalifont-Regular.woff2", "font2"),
                       ("package-lock.json", '{"v": 2}'), ("dist/extra.js", "x")]:
        (tmp_path / path).write_text(data)
        h = renderer_hash(cfg)
        assert h not in seen, path
        seen.add(h)

    before = renderer_hash(cfg)
    (tmp_path / "README.md").write_text("other docs")  # not a render input
    assert renderer_hash(cfg) == before
