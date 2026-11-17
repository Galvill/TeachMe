"""Narration text: ``{mark}`` markers, the spoken (pronunciation) copy, and cue word lookup."""

from __future__ import annotations

import re
from dataclasses import dataclass

MARKER_RE = re.compile(r"\{([\w.-]+)\}")
_EDGE_RE = re.compile(r"^(\W*)(.*?)(\W*)$", re.DOTALL)


class NarrationError(Exception):
    """Narration text that can't be parsed (a bad ``{mark}``)."""


class CueNotFound(Exception):
    """A cue name that matches no marker and no word in the narration."""

    def __init__(self, name: str, occurrence: int | None = None, after: int | None = None) -> None:
        self.name = name
        self.occurrence = occurrence
        self.after = after
        if occurrence is not None:
            msg = f'cue "{name}" has no occurrence #{occurrence} in the narration'
        elif after is not None:
            msg = f'cue "{name}" not found in the narration after the previous cue'
        else:
            msg = f'cue "{name}" not found in the narration'
        super().__init__(msg)


@dataclass(frozen=True)
class Narration:
    text: str
    words: list[str]
    norms: list[str]
    marks: dict[str, int]


@dataclass(frozen=True)
class Spoken:
    text: str
    tokens: list[str]
    source: list[int]  # source[i] = index into Narration.words


def norm(word: str) -> str:
    """Casefold and drop every non-word character: ``"Example.com?"`` -> ``"examplecom"``."""
    return re.sub(r"\W", "", word.casefold())


def parse_narration(raw: str) -> Narration:
    """Split narration into words, stripping ``{mark}`` markers.

    A marker names the word that follows it, whether attached (``{r}the``) or separate
    (``{r} the``). Whitespace in the text is collapsed to single spaces.
    """
    words: list[str] = []
    marks: dict[str, int] = {}
    pending: list[str] = []

    def add_mark(name: str, index: int | None) -> None:
        if name in marks or name in pending:
            raise NarrationError(f'duplicate marker "{{{name}}}"')
        if index is None:
            pending.append(name)
        else:
            marks[name] = index

    for chunk in raw.split():
        parts = MARKER_RE.split(chunk)  # text, name, text, name, ..., text
        texts = parts[0::2]
        names = parts[1::2]
        word = "".join(texts)
        if not word:
            for name in names:
                add_mark(name, None)
            continue
        index = len(words)
        for name in pending:
            marks[name] = index
        pending.clear()
        # A marker after all of this chunk's text belongs to the next word.
        last_text = max(i for i, t in enumerate(texts) if t)
        for i, name in enumerate(names):
            add_mark(name, index if i < last_text else None)
        words.append(word)

    if pending:
        raise NarrationError(f'marker "{{{pending[0]}}}" has no word after it')
    return Narration(text=" ".join(words), words=words, norms=[norm(w) for w in words], marks=marks)


def to_spoken(n: Narration, pron: dict[str, str]) -> Spoken:
    """Apply the pronunciation dictionary to whole words, keeping surrounding punctuation.

    Matching is case-sensitive on the word with leading and trailing punctuation stripped.
    ``"DNS,"`` with ``{"DNS": "D N S"}`` gives tokens ``["D", "N", "S,"]``.
    """
    tokens: list[str] = []
    source: list[int] = []
    for i, word in enumerate(n.words):
        m = _EDGE_RE.match(word)
        assert m is not None
        lead, core, trail = m.groups()
        replacement = pron.get(core, "").split() if core else []
        if not replacement:
            tokens.append(word)
            source.append(i)
            continue
        replacement[0] = lead + replacement[0]
        replacement[-1] = replacement[-1] + trail
        tokens.extend(replacement)
        source.extend([i] * len(replacement))
    return Spoken(text=" ".join(tokens), tokens=tokens, source=source)


def find_cue(n: Narration, name: str, occurrence: int | None, after: int | None) -> int:
    """The word index a cue resolves to.

    A ``{mark}`` name wins over a word. Otherwise, with ``occurrence=k``, the k-th matching
    word from the start; without it, the first matching word with index greater than
    ``after`` (``None`` searches from the start). Words match on :func:`norm`.
    """
    if name in n.marks:
        return n.marks[name]
    target = norm(name)
    matches = [i for i, w in enumerate(n.norms) if target and w == target]
    if occurrence is not None:
        if occurrence < 1 or occurrence > len(matches):
            raise CueNotFound(name, occurrence=occurrence)
        return matches[occurrence - 1]
    floor = -1 if after is None else after
    for i in matches:
        if i > floor:
            return i
    raise CueNotFound(name, after=after if matches else None)
