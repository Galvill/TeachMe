"""Shared fixtures: the fake OpenAI-compatible endpoint, and no real retry waits."""

from __future__ import annotations

import shutil
from collections.abc import Iterator

import pytest

from fake_endpoint import FakeEndpoint, FakeServer
from vidgen.tts import openai_http


@pytest.fixture
def fake_endpoint() -> Iterator[FakeEndpoint]:
    with FakeServer() as fake:
        yield fake


@pytest.fixture(autouse=True)
def backoff_sleeps(monkeypatch) -> list[float]:
    """Retry backoff waits are recorded instead of slept."""
    slept: list[float] = []
    monkeypatch.setattr(openai_http, "_sleep", slept.append)
    return slept


needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg/ffprobe not on PATH"
)
