"""Word timestamps: the alignment endpoint client, and mapping ASR words onto script words.

The ASR transcript is matched against the *spoken* tokens (after the pronunciation
dictionary) with a sequence alignment that tolerates ASR spelling differences, then each
original narration word takes the span of the spoken tokens it produced.
"""

from __future__ import annotations

import difflib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from vidgen.config import Config, Endpoint
from vidgen.narration import Narration, Spoken, norm
from vidgen.timeline import WordTime
from vidgen.tts.engine import EndpointError, pick_endpoint
from vidgen.tts.openai_http import post

MIN_MATCH = 0.5


class AlignError(Exception):
    """Too few transcript words matched the script (wrong language or model, or garbled audio)."""


@dataclass(frozen=True)
class AsrWord:
    text: str
    start: float
    end: float


def parse_words(name: str, payload: Any) -> list[AsrWord]:
    """Words from a verbose_json response: top-level ``words`` or ``segments[].words``."""
    if not isinstance(payload, dict):
        raise EndpointError(name, "transcription response is not a JSON object")
    raw = payload.get("words")
    if raw is None:
        raw = [w for seg in payload.get("segments") or [] for w in (seg.get("words") or [])]
    out: list[AsrWord] = []
    try:
        for w in raw:
            text = w.get("word", w.get("text", ""))
            out.append(AsrWord(str(text).strip(), float(w["start"]), float(w["end"])))
    except (AttributeError, KeyError, TypeError, ValueError):
        raise EndpointError(name, "transcription words lack word/start/end; is word timestamping supported?") from None
    return out


class Aligner:
    def __init__(self, name: str, endpoint: Endpoint) -> None:
        self.name = name
        self.endpoint = endpoint

    def words(self, wav: Path, language: str | None = None) -> list[AsrWord]:
        ep = self.endpoint
        data = {"model": ep.model, "response_format": "verbose_json", "timestamp_granularities[]": "word"}
        if language:
            data["language"] = language
        data.update({k: str(v) for k, v in ep.extra.items()})
        files = {"file": (Path(wav).name, Path(wav).read_bytes(), "audio/wav")}
        resp = post(self.name, ep, "audio/transcriptions", data=data, files=files)
        try:
            payload = resp.json()
        except json.JSONDecodeError:
            ctype = resp.headers.get("content-type", "none")
            raise EndpointError(self.name, f"transcription returned non-JSON (content-type {ctype})") from None
        return parse_words(self.name, payload)


def aligner_from_config(cfg: Config, name: str | None = None) -> Aligner:
    chosen, ep = pick_endpoint(cfg.align, "align", name)
    return Aligner(chosen, ep)


def _match(asr: list[AsrWord], spoken: Spoken) -> list[int | None]:
    """For each spoken token, the index of the ASR word it aligned to, or None."""
    tokens = [norm(t) for t in spoken.tokens]
    heard = [norm(w.text) for w in asr]
    out: list[int | None] = [None] * len(tokens)
    sm = difflib.SequenceMatcher(None, tokens, heard, autojunk=False)
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            out[block.a + k] = block.b + k
    return out


def matched_tokens(asr: list[AsrWord], spoken: Spoken) -> list[bool]:
    """Per spoken token, whether the transcript matched it (the alignment :func:`map_words` uses)."""
    return [j is not None for j in _match(asr, spoken)]


def map_words(asr: list[AsrWord], spoken: Spoken, n: Narration, duration: float) -> list[WordTime]:
    """Word times 1:1 with ``n.words``.

    Matched spoken tokens take the ASR word's times; unmatched runs are spread evenly between
    their matched neighbours (0 and ``duration`` at the edges). Raises :class:`AlignError` when
    fewer than half the tokens match; the caller prefixes the scene id.
    """
    tokens = [norm(t) for t in spoken.tokens]
    times: list[tuple[float, float] | None] = [
        None if j is None else (asr[j].start, asr[j].end) for j in _match(asr, spoken)
    ]

    countable = [i for i, t in enumerate(tokens) if t]
    matched = sum(1 for i in countable if times[i] is not None)
    total = len(countable)
    if total and matched / total < MIN_MATCH:
        raise AlignError(f"only {matched}/{total} words aligned; check the endpoint's language/model")

    # Interpolate unmatched runs.
    i = 0
    while i < len(times):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        left = times[i - 1][1] if i > 0 and times[i - 1] is not None else 0.0  # type: ignore[index]
        right = times[j][0] if j < len(times) and times[j] is not None else duration  # type: ignore[index]
        span = max(0.0, right - left)
        step = span / (j - i)
        for k in range(i, j):
            start = left + (k - i) * step
            times[k] = (start, start + step)
        i = j

    out: list[WordTime] = []
    prev_start = 0.0
    for wi, word in enumerate(n.words):
        spans = [times[t] for t, src in enumerate(spoken.source) if src == wi]
        start = min(s for s, _ in spans)  # type: ignore[misc]
        end = max(e for _, e in spans)  # type: ignore[misc]
        start = max(start, prev_start)
        end = max(end, start)
        out.append(WordTime(word, round(start, 6), round(end, 6)))
        prev_start = start
    return out
