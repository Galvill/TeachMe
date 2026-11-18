import pytest

from vidgen.align import AlignError, AsrWord, _match, aligner_from_config, map_words, matched_tokens, parse_words
from vidgen.config import Config, Endpoint, EndpointSet
from vidgen.narration import parse_narration, to_spoken
from vidgen.tts import engine_from_config


def _asr(*words: str, step: float = 0.3) -> list[AsrWord]:
    return [AsrWord(w, round(i * step, 6), round(i * step + 0.25, 6)) for i, w in enumerate(words)]


def test_exact_match():
    n = parse_narration("Hello, big World.")
    sp = to_spoken(n, {})
    got = map_words(_asr("hello", "big", "world"), sp, n, 1.0)
    assert [(w.text, w.start, w.end) for w in got] == [("Hello,", 0.0, 0.25), ("big", 0.3, 0.55), ("World.", 0.6, 0.85)]


def test_spelled_acronym_written_form():
    n = parse_narration("the DNS server answers fast")
    sp = to_spoken(n, {"DNS": "D N S"})
    assert sp.tokens == ["the", "D", "N", "S", "server", "answers", "fast"]
    # ASR writes "dns" as one word: D, N, S match its written form and share its span.
    asr = [AsrWord("the", 0.0, 0.2), AsrWord("dns", 0.3, 0.8), AsrWord("server", 0.9, 1.2),
           AsrWord("answers", 1.3, 1.6), AsrWord("fast", 1.7, 2.0)]
    assert _match(asr, sp, n) == [(0, 0), (1, 1), (1, 1), (1, 1), (2, 2), (3, 3), (4, 4)]
    got = map_words(asr, sp, n, 2.2)
    assert [w.text for w in got] == n.words
    dns = got[1]
    assert dns.start == pytest.approx(0.3) and dns.end == pytest.approx(0.8)
    assert got[2].start == 0.9


def test_spelled_acronym_interpolated():
    n = parse_narration("the DNS server answers fast")
    sp = to_spoken(n, {"DNS": "D N S"})
    # ASR hears neither form; D, N, S don't match and are spread between "the" and "server".
    asr = [AsrWord("the", 0.0, 0.2), AsrWord("dennis", 0.3, 0.8), AsrWord("server", 0.9, 1.2),
           AsrWord("answers", 1.3, 1.6), AsrWord("fast", 1.7, 2.0)]
    got = map_words(asr, sp, n, 2.2)
    dns = got[1]
    assert dns.start == pytest.approx(0.2) and dns.end == pytest.approx(0.9)


def test_written_form_group_split_evenly():
    n = parse_narration("on nginx today")
    sp = to_spoken(n, {"nginx": "engine x"})
    asr = [AsrWord("on", 0.0, 0.2), AsrWord("nginx", 0.4, 0.8), AsrWord("today", 0.9, 1.2)]
    assert _match(asr, sp, n) == [(0, 0), (1, 1), (1, 1), (2, 2)]
    got = map_words(asr, sp, n, 1.5)
    assert (got[1].start, got[1].end) == (0.4, 0.8)
    assert (got[2].start, got[2].end) == (0.9, 1.2)


def test_written_form_respects_order():
    # A written-form hit must lie between the group's matched neighbours: the first DNS has
    # none before "one", so only the last DNS takes the heard "dns".
    n = parse_narration("DNS one two DNS")
    sp = to_spoken(n, {"DNS": "D N S"})
    asr = [AsrWord("one", 0.0, 0.2), AsrWord("two", 0.3, 0.5), AsrWord("dns", 0.6, 0.9)]
    assert _match(asr, sp, n) == [None, None, None, (0, 0), (1, 1), (2, 2), (2, 2), (2, 2)]


def test_written_form_split_by_asr():
    # Whisper splits some written forms into several words: "example .com", "93 .184 .216 .34".
    n = parse_narration("type example.com at 93.184.216.34 now")
    pron = {"example.com": "example dot com", "93.184.216.34": "ninety three dot one eighty four"}
    sp = to_spoken(n, pron)
    asr = _asr("type", "example", ".com", "at", "93", ".184", ".216", ".34", "now")
    match = _match(asr, sp, n)
    assert match[1:4] == [(1, 2)] * 3
    assert match[5:11] == [(4, 7)] * 6
    got = map_words(asr, sp, n, 3.0)
    assert (got[1].start, got[1].end) == (0.3, 0.85)
    assert (got[3].start, got[3].end) == (1.2, 2.35)
    # A run that only starts the written form isn't a match.
    asr = _asr("type", "example", "now")
    short = parse_narration("type example.com now")
    assert matched_tokens(asr, to_spoken(short, pron), short) == [True, True, False, False, True]


def test_written_form_replaces_partial_match():
    # "example dot com" half-matched by stray heard words still takes the written-form hit.
    n = parse_narration("see example.com now")
    sp = to_spoken(n, {"example.com": "example dot com"})
    asr = [AsrWord("see", 0.0, 0.2), AsrWord("example.com", 0.3, 0.9), AsrWord("com", 1.0, 1.1),
           AsrWord("now", 1.2, 1.4)]
    match = _match(asr, sp, n)
    assert match[1:4] == [(1, 1)] * 3 and match[4] == (3, 3)


def test_missing_word_interpolated():
    n = parse_narration("one two three four")
    sp = to_spoken(n, {})
    asr = [AsrWord("one", 0.0, 0.2), AsrWord("three", 1.0, 1.2), AsrWord("four", 1.4, 1.6)]
    got = map_words(asr, sp, n, 2.0)
    assert (got[1].start, got[1].end) == (0.2, 1.0)
    # Unmatched at the edges: 0 at the start, duration at the end.
    asr = [AsrWord("two", 0.5, 0.7), AsrWord("three", 1.0, 1.2), AsrWord("x", 1.3, 1.4)]
    got = map_words(asr, sp, n, 2.0)
    assert (got[0].start, got[0].end) == (0.0, 0.5)
    assert (got[3].start, got[3].end) == (1.2, 2.0)


def test_low_match_raises():
    n = parse_narration("one two three four")
    sp = to_spoken(n, {})
    with pytest.raises(AlignError, match=r"only 1/4 words aligned; check the endpoint's language/model"):
        map_words(_asr("uno", "two", "tres", "cuatro"), sp, n, 2.0)
    # Exactly half is enough.
    map_words(_asr("one", "two", "tres", "cuatro"), sp, n, 2.0)


def test_segments_shape(fake_endpoint, tmp_path):
    payload = {"segments": [{"words": [{"word": " Hi", "start": 0, "end": 0.2}]},
                            {"words": [{"word": "there", "start": 0.3, "end": 0.5}]}]}
    assert parse_words("x", payload) == [AsrWord("Hi", 0, 0.2), AsrWord("there", 0.3, 0.5)]

    # Round trip through the fake endpoint, in both response shapes.
    eps = {"fake": Endpoint(base_url=fake_endpoint.base_url, model="m")}
    cfg = Config(tts=EndpointSet(endpoint="fake", endpoints=eps), align=EndpointSet(endpoint="fake", endpoints=eps))
    wav = tmp_path / "a.wav"
    wav.write_bytes(engine_from_config(cfg).synthesize("Hello, big World.", "v", None))
    for shape in ("words", "segments"):
        fake_endpoint.words_shape = shape
        got = aligner_from_config(cfg).words(wav, language="en")
        assert got == [AsrWord("hello", 0.0, 0.25), AsrWord("big", 0.3, 0.55), AsrWord("world", 0.6, 0.85)]
    req = fake_endpoint.requests[-1]
    assert req["path"] == "/v1/audio/transcriptions"
    for field in (b'name="model"', b'name="response_format"', b"verbose_json", b'name="timestamp_granularities[]"',
                  b'name="file"', b'name="language"'):
        assert field in req["body"]


def test_monotonic():
    n = parse_narration("a b c d e")
    sp = to_spoken(n, {})
    # ASR times out of order (overlapping) must still give non-decreasing starts.
    asr = [AsrWord("a", 0.5, 0.6), AsrWord("b", 0.2, 0.3), AsrWord("c", 0.9, 1.0), AsrWord("d", 0.8, 0.85),
           AsrWord("e", 1.2, 1.3)]
    got = map_words(asr, sp, n, 1.5)
    starts = [w.start for w in got]
    assert starts == sorted(starts)
    assert all(w.end >= w.start for w in got)
