"""``vidgen bakeoff``: run one passage against several TTS endpoints for a listening pick (spec §8).

For each endpoint it writes ``<endpoint>-raw.wav`` (the passage as written) and
``<endpoint>-dict.wav`` (through the pronunciation dictionary), measures the real-time factor
on the dict clip, and, when an alignment endpoint is configured, counts the cue words whose
spoken tokens the transcript matched. An endpoint that fails gets a row with its error and
the run moves on. Nothing here picks a winner: the user listens.
"""

from __future__ import annotations

import io
import re
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from vidgen.align import aligner_from_config, matched_tokens
from vidgen.config import Config
from vidgen.narration import Narration, NarrationError, norm, parse_narration, to_spoken
from vidgen.tts.engine import engine_from_config

BAKEOFF_DIR = (Path(__file__).resolve().parent / ".." / ".." / "bakeoff").resolve()
DEFAULT_PASSAGE = BAKEOFF_DIR / "passage.md"
DEFAULT_CLIPS = BAKEOFF_DIR / "clips"
DEFAULT_RESULTS = BAKEOFF_DIR / "results.md"
COLUMNS = ("Endpoint", "Model", "License", "RTF", "Cue words aligned", "Clips", "VRAM", "Notes")
SEED = 0


class PassageError(ValueError):
    """A passage file without valid frontmatter, or with a cue its narration doesn't contain."""


@dataclass
class Row:
    endpoint: str
    model: str = ""
    license: str = ""
    rtf: float | None = None
    cue_aligned: str = "n/a"
    clips: list[Path] = field(default_factory=list)
    error: str | None = None


@dataclass(frozen=True)
class Passage:
    narration: Narration
    pronunciations: dict[str, str]
    cues: list[str]


def load_passage(path: Path) -> Passage:
    """Parse ``---``-fenced YAML frontmatter (``pronunciations``, ``cues``) and the narration."""
    text = Path(path).read_text(encoding="utf-8")
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", text, re.DOTALL)
    if m is None:
        raise PassageError(f"{Path(path).name}: needs --- fenced YAML frontmatter before the narration")
    try:
        front = YAML(typ="safe", pure=True).load(m[1]) or {}
    except YAMLError as e:
        raise PassageError(f"{Path(path).name}: invalid frontmatter: {e}") from None
    if not isinstance(front, dict):
        raise PassageError(f"{Path(path).name}: frontmatter must be a mapping")
    pron = {str(k): str(v) for k, v in (front.get("pronunciations") or {}).items()}
    cues = [str(c) for c in (front.get("cues") or [])]
    try:
        narration = parse_narration(m[2])
    except NarrationError as e:
        raise PassageError(f"{Path(path).name}: {e}") from None
    for cue in cues:
        if norm(cue) not in narration.norms:
            raise PassageError(f'{Path(path).name}: cue "{cue}" is not in the narration')
    return Passage(narration, pron, cues)


def wav_duration(data: bytes, path: Path, cfg: Config) -> float:
    """Seconds of audio; ffprobe only when Python's ``wave`` can't read the format."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            return w.getnframes() / float(w.getframerate())
    except (wave.Error, EOFError):
        from vidgen.assemble import probe_duration

        return probe_duration(path, cfg)


def clip_stem(endpoint: str) -> str:
    """A file-name-safe form of the endpoint name (clips never leave ``out``)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", endpoint).lstrip(".") or "endpoint"


def _cue_score(p: Passage, matched: list[bool], source: list[int]) -> str:
    ok = 0
    for cue in p.cues:
        words = {i for i, w in enumerate(p.narration.norms) if w == norm(cue)}
        flags = [matched[t] for t, src in enumerate(source) if src in words]
        ok += bool(flags) and all(flags)
    return f"{ok}/{len(p.cues)}"


def _one(cfg: Config, p: Passage, name: str, out: Path) -> Row:
    row = Row(endpoint=name)
    try:
        ep = cfg.tts.endpoints.get(name)
        if ep is not None:
            row.model, row.license = ep.model, ep.license
        engine = engine_from_config(cfg, name)
        assert ep is not None
        stem = clip_stem(name)

        raw = to_spoken(p.narration, {})
        raw_path = out / f"{stem}-raw.wav"
        raw_path.write_bytes(engine.synthesize(raw.text, ep.voice, SEED))
        row.clips.append(raw_path)

        spoken = to_spoken(p.narration, {**cfg.pronunciations, **p.pronunciations})
        dict_path = out / f"{stem}-dict.wav"
        t0 = time.perf_counter()
        data = engine.synthesize(spoken.text, ep.voice, SEED)
        wall = time.perf_counter() - t0
        dict_path.write_bytes(data)
        row.clips.append(dict_path)
        duration = wav_duration(data, dict_path, cfg)
        row.rtf = round(wall / duration, 3) if duration > 0 else None

        if cfg.align.endpoints:
            asr = aligner_from_config(cfg).words(dict_path, language="en")
            row.cue_aligned = _cue_score(p, matched_tokens(asr, spoken), spoken.source)
    except Exception as e:  # one endpoint's failure never stops the bake-off
        lines = [line for line in str(e).splitlines() if line.strip()]
        row.error = lines[0] if lines else type(e).__name__
    return row


def run_bakeoff(cfg: Config, passage: Path, endpoints: list[str], out: Path) -> list[Row]:
    """One row per endpoint, in order; clips are written under ``out``."""
    p = load_passage(passage)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    return [_one(cfg, p, name, out) for name in endpoints]


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def _rel(path: Path, base: Path) -> str:
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def results_table(rows: list[Row], base: Path) -> str:
    """The results.md text: a header, then a Markdown table. Clip paths are relative to ``base``."""
    lines = [
        "# TTS bake-off results",
        "",
        "Written by `vidgen bakeoff`. RTF is client wall time over audio length for the dict clip",
        "(lower is faster). VRAM isn't visible to the client: fill it in by hand if wanted.",
        "",
        "| " + " | ".join(COLUMNS) + " |",
        "|" + "|".join("---" for _ in COLUMNS) + "|",
    ]
    for r in rows:
        cells = [
            r.endpoint,
            r.model,
            r.license,
            "" if r.rtf is None else f"{r.rtf:.3f}",
            r.cue_aligned,
            ", ".join(_rel(c, base) for c in r.clips),
            "",
            f"error: {r.error}" if r.error else "",
        ]
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
    return "\n".join(lines) + "\n"


def write_results(rows: list[Row], path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(results_table(rows, path.parent), encoding="utf-8")
