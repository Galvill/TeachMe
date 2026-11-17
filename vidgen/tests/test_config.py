import subprocess
from pathlib import Path

import pytest

from vidgen.config import Config, ConfigError, load_config

EXAMPLE = Path(__file__).resolve().parents[1] / "vidgen.example.toml"


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / "home"
    h.mkdir()
    monkeypatch.setenv("HOME", str(h))
    return h


def _write(path: Path, body: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def test_search_order(tmp_path, home):
    repo = tmp_path / "repo"
    script_dir = repo / "videos" / "dns"
    script_dir.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    script = script_dir / "script.yaml"
    script.write_text("title: x\n", encoding="utf-8")

    # Nothing found: defaults.
    assert load_config(script).fps == 30

    _write(home / ".config" / "vidgen" / "vidgen.toml", "fps = 24\n")
    assert load_config(script).fps == 24

    _write(repo / "vidgen.toml", "fps = 25\n")
    assert load_config(script).fps == 25

    # The script's folder wins, and the found file is used whole (no merge with the others).
    _write(script_dir / "vidgen.toml", "width = 1280\n")
    cfg = load_config(script)
    assert cfg.width == 1280
    assert cfg.fps == 30

    # An explicit file beats the search.
    explicit = _write(tmp_path / "other.toml", "fps = 60\n")
    assert load_config(script, explicit=explicit).fps == 60


def test_defaults_without_file(tmp_path, home):
    script = _write(tmp_path / "s" / "script.yaml", "title: x\n")
    cfg = load_config(script)
    assert cfg == Config()
    assert (cfg.width, cfg.height, cfg.fps, cfg.draft, cfg.ssaa) == (1920, 1080, 30, False, 1)
    assert cfg.scene_pad_s == 0.4
    assert (cfg.arrow_default_s, cfg.arrow_min_s, cfg.arrow_max_s) == (1.2, 0.6, 2.5)
    assert cfg.paths.cache == home / ".cache" / "vidgen"
    assert cfg.paths.node == "node"
    assert cfg.encoder.codec == "auto"
    assert cfg.music is None
    assert cfg.tts.endpoint is None


def test_unknown_key(tmp_path, home):
    path = _write(tmp_path / "vidgen.toml", '[tts]\nendpints = "x"\n')
    with pytest.raises(ConfigError) as err:
        load_config(explicit=path)
    assert str(err.value) == "vidgen.toml: unknown key 'tts.endpints'"

    path = _write(tmp_path / "vidgen.toml", '[publish.targets.nas]\ntype = "local"\npath = "/x"\npaht = "/y"\n')
    with pytest.raises(ConfigError) as err:
        load_config(explicit=path)
    assert str(err.value) == "vidgen.toml: unknown key 'publish.targets.nas.paht'"


def test_dangling_endpoint(tmp_path, home):
    path = _write(tmp_path / "vidgen.toml", '[tts]\nendpoint = "missing"\n')
    with pytest.raises(ConfigError, match='tts.endpoint "missing"'):
        load_config(explicit=path)

    path = _write(tmp_path / "vidgen.toml", '[align]\nendpoint = "gone"\n')
    with pytest.raises(ConfigError, match='align.endpoint "gone"'):
        load_config(explicit=path)

    path = _write(
        tmp_path / "vidgen.toml",
        '[tts.endpoints.a]\nbase_url = "http://x/v1"\nmodel = "m"\n[bakeoff]\nendpoints = ["a", "b"]\n',
    )
    with pytest.raises(ConfigError, match='bakeoff.endpoints entry "b"'):
        load_config(explicit=path)


def test_draft_size(tmp_path, home):
    assert Config().output_size() == (1920, 1080)
    assert Config(draft=True).output_size() == (1280, 720)
    path = _write(tmp_path / "vidgen.toml", "draft = true\nwidth = 3840\nheight = 2160\n")
    assert load_config(explicit=path).output_size() == (1280, 720)


def test_example_toml_loads(home):
    cfg = load_config(explicit=EXAMPLE)
    assert cfg.tts.endpoint == "local-chatterbox"
    assert cfg.tts.endpoints["local-chatterbox"].extra == {"seed": 7, "exaggeration": 0.5}
    assert cfg.align.endpoints["local-whisper"].model == "large-v3"
    target = cfg.publish.targets["nas"]
    assert target.type == "local"
    assert target.path == home / "vidgen-published"
    assert cfg.paths.cache == home / ".cache" / "vidgen"
