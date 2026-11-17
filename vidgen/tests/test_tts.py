import pytest

from vidgen.config import Config, Endpoint, EndpointSet
from vidgen.tts import EndpointError, engine_from_config


def _cfg(base_url: str, **kw) -> Config:
    ep = Endpoint(base_url=base_url, model="fake-tts", voice="v1", **kw)
    return Config(tts=EndpointSet(endpoint="fake", endpoints={"fake": ep}))


def test_request_body_and_seed(fake_endpoint):
    engine = engine_from_config(_cfg(fake_endpoint.base_url, extra={"exaggeration": 0.5}))
    assert engine.name == "fake"
    wav = engine.synthesize("Hello there world.", "narrator", 7)
    assert wav.startswith(b"RIFF")
    req = fake_endpoint.tts_requests()[-1]
    assert req["method"] == "POST" and req["path"] == "/v1/audio/speech"
    assert req["json"] == {
        "model": "fake-tts", "input": "Hello there world.", "voice": "narrator", "response_format": "wav",
        "exaggeration": 0.5, "seed": 7,
    }
    assert "authorization" not in req["headers"]

    # No seed when None; extra's own seed wins over the argument.
    engine.synthesize("a", "v", None)
    assert "seed" not in fake_endpoint.tts_requests()[-1]["json"]
    engine = engine_from_config(_cfg(fake_endpoint.base_url, extra={"seed": 3}))
    engine.synthesize("a", "v", 7)
    assert fake_endpoint.tts_requests()[-1]["json"]["seed"] == 3


def test_bearer_from_env(fake_endpoint, monkeypatch):
    monkeypatch.setenv("FAKE_TTS_KEY", "s3cret")
    engine_from_config(_cfg(fake_endpoint.base_url, api_key_env="FAKE_TTS_KEY")).synthesize("hi", "v", None)
    assert fake_endpoint.requests[-1]["headers"]["authorization"] == "Bearer s3cret"


def test_missing_env_var(fake_endpoint, monkeypatch):
    monkeypatch.delenv("FAKE_TTS_KEY", raising=False)
    engine = engine_from_config(_cfg(fake_endpoint.base_url, api_key_env="FAKE_TTS_KEY"))
    with pytest.raises(EndpointError, match='env var "FAKE_TTS_KEY" is not set') as info:
        engine.synthesize("hi", "v", None)
    assert info.value.endpoint == "fake"
    assert fake_endpoint.requests == []


def test_retries_5xx_then_succeeds(fake_endpoint, backoff_sleeps):
    fake_endpoint.fail_next(503, 2)
    wav = engine_from_config(_cfg(fake_endpoint.base_url)).synthesize("hi", "v", None)
    assert wav.startswith(b"RIFF")
    assert len(fake_endpoint.requests) == 3
    assert backoff_sleeps == [1.0, 2.0]

    fake_endpoint.fail_next(500, 3)
    with pytest.raises(EndpointError, match=r"HTTP 500 .*after 3 attempts"):
        engine_from_config(_cfg(fake_endpoint.base_url)).synthesize("hi", "v", None)


def test_connect_error_retried(backoff_sleeps):
    # Port 9 on loopback: nothing listens there.
    with pytest.raises(EndpointError, match="cannot connect") as info:
        engine_from_config(_cfg("http://127.0.0.1:9/v1")).synthesize("hi", "v", None)
    assert info.value.endpoint == "fake"
    assert backoff_sleeps == [1.0, 2.0]


def test_4xx_no_retry(fake_endpoint, backoff_sleeps):
    fake_endpoint.respond_next(422, b'{"error": "voice unknown"}', "application/json")
    with pytest.raises(EndpointError) as info:
        engine_from_config(_cfg(fake_endpoint.base_url)).synthesize("hi", "v", None)
    assert "HTTP 422" in info.value.detail and "voice unknown" in info.value.detail
    assert len(fake_endpoint.requests) == 1
    assert backoff_sleeps == []


def test_non_wav_rejected(fake_endpoint):
    fake_endpoint.respond_next(200, b"ID3\x03mp3 bytes", "audio/mpeg")
    with pytest.raises(EndpointError, match=r"returned non-WAV \(content-type audio/mpeg\)"):
        engine_from_config(_cfg(fake_endpoint.base_url)).synthesize("hi", "v", None)


def test_unknown_endpoint_name():
    with pytest.raises(EndpointError, match=r"no \[tts.endpoints.other\] entry"):
        engine_from_config(_cfg("http://x/v1"), "other")
