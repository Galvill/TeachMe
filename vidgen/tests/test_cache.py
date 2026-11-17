from vidgen.cache import Cache, build_dir, key, objects_root


def test_key_stable_across_dict_order():
    a = key("hello", {"seed": 7, "exaggeration": 0.5}, None)
    b = key("hello", {"exaggeration": 0.5, "seed": 7}, None)
    assert a == b
    assert len(a) == 64 and all(c in "0123456789abcdef" for c in a)
    assert key("hello", {"seed": 8, "exaggeration": 0.5}, None) != a
    assert key("a", "b") != key("ab")


def test_path_layout(tmp_path):
    cache = Cache(objects_root(tmp_path))
    k = key("x")
    assert cache.path("tts", k, "wav") == tmp_path / "objects" / "tts" / k[:2] / f"{k}.wav"
    assert build_dir(tmp_path, "dns") == tmp_path / "builds" / "dns"


def test_write_atomic(tmp_path):
    cache = Cache(tmp_path)
    p = cache.path("scene", key("s"), "mp4")
    cache.write(p, b"one")
    cache.write(p, b"two")
    assert p.read_bytes() == b"two"
    assert [f.name for f in p.parent.iterdir()] == [p.name]  # no .tmp left behind
