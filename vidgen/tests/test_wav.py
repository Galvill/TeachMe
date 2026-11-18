import io
import wave

import pytest
from fake_endpoint import tone_wav

from vidgen.bakeoff import wav_duration
from vidgen.config import Config, Endpoint, EndpointSet
from vidgen.tts import engine_from_config
from vidgen.wav import parse_wav, repair_streamed

FF = b"\xff\xff\xff\xff"


def _streamed(wav: bytes) -> bytes:
    """``wav`` with Kokoro-FastAPI-style placeholder RIFF and data sizes."""
    out = bytearray(wav)
    out[4:8] = FF
    i = out.index(b"data")
    out[i + 4 : i + 8] = FF
    return bytes(out)



def test_wav_duration_streamed_header(tmp_path):
    wav = tone_wav(["a", "b"], "a b")  # 0.8 s at 24 kHz
    path = tmp_path / "x.wav"
    assert wav_duration(wav, path, Config()) == pytest.approx(0.8)
    streamed = _streamed(wav)
    with wave.open(io.BytesIO(streamed)) as w:  # what the header claims: about 24 h
        assert w.getnframes() / w.getframerate() > 3600
    assert wav_duration(streamed, path, Config()) == pytest.approx(0.8)
    # A data size longer than the bytes present (a cut-off stream) uses the bytes present.
    assert wav_duration(wav[:-4800], path, Config()) == pytest.approx(0.7)
    # Trailing chunks after a well-formed data chunk aren't audio.
    assert wav_duration(wav + b"LIST\x04\x00\x00\x00abcd", path, Config()) == pytest.approx(0.8)


def test_wav_duration_unparsable_uses_ffprobe(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr("vidgen.assemble.probe_duration", lambda path, cfg: calls.append(path) or 1.5)
    path = tmp_path / "x.wav"
    assert wav_duration(b"RIFF\x00\x00\x00\x00WAVE", path, Config()) == 1.5
    assert calls == [path]


def test_parse_wav_rejects_non_wav():
    assert parse_wav(b"") is None
    assert parse_wav(b"ID3\x03mp3 bytes") is None
    wav = tone_wav(["a"], "a")
    info = parse_wav(wav)
    assert info is not None and not info.streamed
    assert (info.rate, info.channels, info.block_align) == (24000, 1, 2)


def test_streamed_wav_repaired_by_engine(fake_endpoint):
    wav = tone_wav(["a", "b"], "a b")
    fake_endpoint.respond_next(200, _streamed(wav), "audio/wav")
    eps = {"fake": Endpoint(base_url=fake_endpoint.base_url, model="m")}
    cfg = Config(tts=EndpointSet(endpoint="fake", endpoints=eps))
    got = engine_from_config(cfg).synthesize("a b", "v", None)
    assert got == wav
    with wave.open(io.BytesIO(got)) as w:
        assert w.getnframes() == round(0.8 * 24000)
    # Well-formed or unparsable bytes pass through unchanged.
    assert repair_streamed(wav) == wav
    assert repair_streamed(b"RIFFjunk") == b"RIFFjunk"
