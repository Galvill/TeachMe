"""Word timestamps: the alignment endpoint client, and mapping ASR words onto script words.

The ASR transcript is matched against the *spoken* tokens (after the pronunciation
dictionary) with a sequence alignment that tolerates ASR spelling differences, then against
the written form of any word whose spoken tokens went unmatched ("DNS" heard for "D N S").
Each original narration word takes the span of the spoken tokens it produced.
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


Span = tuple[int, int]  # first and last ASR word index, inclusive


def _written_hit(heard: list[str], written: str, lo: int, hi: int, used: set[int]) -> Span | None:
    """The first run of free ASR words strictly between ``lo`` and ``hi`` that joins to ``written``.

    A run rather than one word because ASR splits some written forms: "example .com",
    "93 .184 .216 .34".
    """
    for j in range(lo + 1, hi):
        if j in used or not heard[j] or not written.startswith(heard[j]):
            continue
        acc = ""
        for k in range(j, hi):
            if k in used:
                break
            acc += heard[k]
            if acc == written:
                return (j, k)
            if not written.startswith(acc):
                break
    return None


def _match(asr: list[AsrWord], spoken: Spoken, n: Narration) -> list[Span | None]:
    """For each spoken token, the span of ASR words it aligned to, or None.

    Two passes. First the spoken tokens are sequence-aligned against the ASR words, one word
    each. Then each narration word whose tokens didn't all match is tried in its written form:
    ASR models usually write "DNS" or "nginx", not the dictionary's "D N S" or "engine x". The
    ASR words between the group's matched neighbours that spell the written word are taken by
    every token of the group (:func:`map_words` splits their span evenly across them).
    """
    tokens = [norm(t) for t in spoken.tokens]
    heard = [norm(w.text) for w in asr]
    out: list[Span | None] = [None] * len(tokens)
    sm = difflib.SequenceMatcher(None, tokens, heard, autojunk=False)
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            out[block.a + k] = (block.b + k, block.b + k)

    groups: dict[int, list[int]] = {}
    for t, src in enumerate(spoken.source):
        groups.setdefault(src, []).append(t)
    used = {j for s in out if s is not None for j in range(s[0], s[1] + 1)}
    for src, members in groups.items():
        written = n.norms[src]
        if not written or all(out[t] is not None for t in members):
            continue
        before = (out[t] for t in range(members[0] - 1, -1, -1))
        after = (out[t] for t in range(members[-1] + 1, len(out)))
        lo = next((s[1] for s in before if s is not None), -1)
        hi = next((s[0] for s in after if s is not None), len(asr))
        own = {j for t in members if (s := out[t]) is not None for j in range(s[0], s[1] + 1)}
        hit = _written_hit(heard, written, lo, hi, used - own)
        if hit is None:
            continue
        used -= own
        used.update(range(hit[0], hit[1] + 1))
        for t in members:
            out[t] = hit
    return out


def matched_tokens(asr: list[AsrWord], spoken: Spoken, n: Narration) -> list[bool]:
    """Per spoken token, whether the transcript matched it (the alignment :func:`map_words` uses)."""
    return [s is not None for s in _match(asr, spoken, n)]


def map_words(asr: list[AsrWord], spoken: Spoken, n: Narration, duration: float) -> list[WordTime]:
    """Word times 1:1 with ``n.words``.

    Matched spoken tokens take the ASR words' times; unmatched runs are spread evenly between
    their matched neighbours (0 and ``duration`` at the edges). Raises :class:`AlignError` when
    fewer than half the tokens match; the caller prefixes the scene id.
    """
    tokens = [norm(t) for t in spoken.tokens]
    match = _match(asr, spoken, n)
    times: list[tuple[float, float] | None] = [None] * len(match)
    t = 0
    while t < len(match):
        span = match[t]
        if span is None:
            t += 1
            continue
        # Tokens sharing one ASR span (a written-form match) split it evenly.
        k = t
        while k < len(match) and match[k] == span:
            k += 1
        first, last = asr[span[0]].start, asr[span[1]].end
        step = max(0.0, last - first) / (k - t)
        for m in range(t, k):
            start = first + (m - t) * step
            times[m] = (start, start + step)
        t = k

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
