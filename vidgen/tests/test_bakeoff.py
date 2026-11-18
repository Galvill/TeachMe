import socket
import wave

from typer.testing import CliRunner

from vidgen.align import AsrWord, matched_tokens
from vidgen.bakeoff import COLUMNS, DEFAULT_PASSAGE, Row, _cue_score, load_passage, results_table, run_bakeoff
from vidgen.cli import app
from vidgen.config import Config, Endpoint, EndpointSet
from vidgen.narration import norm, parse_narration, to_spoken

runner = CliRunner()
CUES = ["DNS", "TTL", "TLD", "nginx", "example.com", "IPv6", "93.184.216.34"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def cfg_for(base_url: str, align: bool = True, **more: Endpoint) -> Config:
    tts = {
        "alpha": Endpoint(base_url=base_url, model="alpha-model", license="MIT"),
        "beta": Endpoint(base_url=base_url, model="beta-model", license="Apache-2.0"),
        **more,
    }
    aligner = {"fake": Endpoint(base_url=base_url, model="whisper")} if align else {}
    return Config(
        tts=EndpointSet(endpoint="alpha", endpoints=tts),
        align=EndpointSet(endpoint="fake" if align else None, endpoints=aligner),
        pronunciations={"nginx": "engine x"},
    )


def test_passage_shape():
    p = load_passage(DEFAULT_PASSAGE)
    assert p.cues == CUES
    assert set(p.pronunciations) >= {"DNS", "TTL", "TLD", "nginx"}
    assert 170 <= len(p.narration.words) <= 230


def test_bakeoff_two_endpoints(fake_endpoint, tmp_path):
    out = tmp_path / "clips"
    rows = run_bakeoff(cfg_for(fake_endpoint.base_url), DEFAULT_PASSAGE, ["alpha", "beta"], out)
    assert [r.endpoint for r in rows] == ["alpha", "beta"]
    assert sorted(p.name for p in out.iterdir()) == ["alpha-dict.wav", "alpha-raw.wav", "beta-dict.wav", "beta-raw.wav"]
    for r in rows:
        assert r.error is None
        assert r.clips == [out / f"{r.endpoint}-raw.wav", out / f"{r.endpoint}-dict.wav"]
        assert r.rtf is not None and r.rtf > 0
        assert r.cue_aligned == "7/7"
        with wave.open(str(r.clips[1])) as w:
            assert w.getnframes() > 0
    assert (rows[0].model, rows[0].license) == ("alpha-model", "MIT")

    # The raw clip is the passage as written; the dict clip goes through config + passage dictionary.
    inputs = [r["json"]["input"] for r in fake_endpoint.tts_requests()]
    assert "DNS" in inputs[0].split() and "nginx" in inputs[0].split()
    assert "D N S" in inputs[1] and "engine x" in inputs[1] and "example dot com" in inputs[1]
    assert "DNS" not in inputs[1].split()

    # No aligner configured: cue alignment is n/a.
    rows = run_bakeoff(cfg_for(fake_endpoint.base_url, align=False), DEFAULT_PASSAGE, ["alpha"], tmp_path / "c2")
    assert rows[0].cue_aligned == "n/a" and rows[0].error is None


def test_endpoint_error_row(fake_endpoint, tmp_path):
    down = Endpoint(base_url=f"http://127.0.0.1:{free_port()}/v1", model="down-model", license="?")
    cfg = cfg_for(fake_endpoint.base_url, down=down)
    rows = run_bakeoff(cfg, DEFAULT_PASSAGE, ["down", "missing", "beta"], tmp_path / "clips")
    assert [r.endpoint for r in rows] == ["down", "missing", "beta"]
    assert rows[0].error is not None and 'endpoint "down"' in rows[0].error and "cannot connect" in rows[0].error
    assert rows[0].rtf is None and rows[0].clips == [] and rows[0].model == "down-model"
    assert rows[1].error is not None and "missing" in rows[1].error
    assert rows[2].error is None and rows[2].cue_aligned == "7/7"


def test_results_table_columns(fake_endpoint, tmp_path):
    rows = [
        Row("alpha", "m", "MIT", 0.25, "6/7", [tmp_path / "clips" / "alpha-raw.wav"], None),
        Row("down", "m|x", "", None, "n/a", [], "boom"),
    ]
    text = results_table(rows, tmp_path)
    table = [line for line in text.splitlines() if line.startswith("|")]
    assert table[0] == "| Endpoint | Model | License | RTF | Cue words aligned | Clips | VRAM | Notes |"
    assert len(COLUMNS) == 8
    assert table[2] == "| alpha | m | MIT | 0.250 | 6/7 | clips/alpha-raw.wav |  |  |"
    assert table[3] == "| down | m\\|x |  |  | n/a |  |  | error: boom |"

    # The command writes the same table and defaults its endpoints to bakeoff.endpoints.
    toml = tmp_path / "vidgen.toml"
    toml.write_text(
        f"""[tts]
endpoint = "alpha"
[tts.endpoints.alpha]
base_url = "{fake_endpoint.base_url}"
model = "alpha-model"
license = "MIT"
[bakeoff]
endpoints = ["alpha"]
""",
        encoding="utf-8",
    )
    results = tmp_path / "results.md"
    args = ["bakeoff", "--config", str(toml), "--out", str(tmp_path / "clips"), "--results", str(results)]
    r = runner.invoke(app, args)
    assert r.exit_code == 0, r.output
    cells = [line.split(" | ") for line in results.read_text().splitlines() if line.startswith("| alpha")]
    assert len(cells) == 1
    row = cells[0]
    assert row[:3] == ["| alpha", "alpha-model", "MIT"]
    assert float(row[3]) > 0
    assert row[4:] == ["n/a", "clips/alpha-raw.wav, clips/alpha-dict.wav", "", " |"]

    empty = tmp_path / "empty.toml"
    empty.write_text("", encoding="utf-8")
    r = runner.invoke(app, ["bakeoff", "--config", str(empty), "--results", str(tmp_path / "r2.md")])
    assert r.exit_code == 1
    assert r.output == "error: no bake-off endpoints; set bakeoff.endpoints or pass --endpoints\n"


def test_matched_tokens():
    n = parse_narration("Ask DNS for example.com now")
    spoken = to_spoken(n, {"DNS": "D N S", "example.com": "example dot com"})
    assert spoken.tokens == ["Ask", "D", "N", "S", "for", "example", "dot", "com", "now"]
    # The ASR writes "DNS" in its written form; the whole D N S group matches it.
    heard = ["ask", "dns", "for", "example", "dot", "com", "now"]
    asr = [AsrWord(w, i * 0.3, i * 0.3 + 0.2) for i, w in enumerate(heard)]
    assert matched_tokens(asr, spoken, n) == [True] * 9
    # A heard word that is neither the spoken nor the written form still doesn't match.
    heard = ["ask", "dennis", "for", "example.com", "now"]
    asr = [AsrWord(w, i * 0.3, i * 0.3 + 0.2) for i, w in enumerate(heard)]
    assert matched_tokens(asr, spoken, n) == [True, False, False, False, True, True, True, True, True]
    assert matched_tokens([], spoken, n) == [False] * 9


def test_cue_score_written_form_asr():
    # Whisper-style ASR writes every cue in its written form ("DNS", "nginx", "93.184.216.34").
    p = load_passage(DEFAULT_PASSAGE)
    spoken = to_spoken(p.narration, p.pronunciations)
    asr = [AsrWord(w, i * 0.3, i * 0.3 + 0.25) for i, w in enumerate(p.narration.words)]
    assert _cue_score(p, matched_tokens(asr, spoken, p.narration), spoken.source) == "7/7"
    # Every cue gets spoken tokens through the passage dictionary, the IP address included.
    for cue in p.cues:
        i = p.narration.norms.index(norm(cue))
        toks = [spoken.tokens[t] for t, src in enumerate(spoken.source) if src == i]
        assert toks and toks != [p.narration.words[i]]
