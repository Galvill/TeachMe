"""The TTS engine interface and endpoint errors."""

from __future__ import annotations

from typing import Protocol

from vidgen.config import Config, Endpoint, EndpointSet


class EndpointError(Exception):
    """A TTS or alignment endpoint that is down, misconfigured or returned something unusable."""

    def __init__(self, endpoint: str, detail: str) -> None:
        self.endpoint = endpoint
        self.detail = detail
        super().__init__(f'endpoint "{endpoint}": {detail}')


class TTSEngine(Protocol):
    name: str

    def synthesize(self, text: str, voice: str, seed: int | None) -> bytes:
        """WAV bytes for ``text``."""
        ...


def pick_endpoint(es: EndpointSet, section: str, name: str | None = None) -> tuple[str, Endpoint]:
    """``(name, Endpoint)`` for ``name`` or the section's default endpoint."""
    chosen = name if name is not None else es.endpoint
    if chosen is None:
        if len(es.endpoints) == 1:
            chosen = next(iter(es.endpoints))
        else:
            raise EndpointError("(none)", f"no {section} endpoint configured; set [{section}] endpoint in vidgen.toml")
    if chosen not in es.endpoints:
        raise EndpointError(chosen, f"no [{section}.endpoints.{chosen}] entry in vidgen.toml")
    return chosen, es.endpoints[chosen]


def engine_from_config(cfg: Config, name: str | None = None) -> TTSEngine:
    """The TTS engine for endpoint ``name`` (default: ``cfg.tts.endpoint``)."""
    from vidgen.tts.openai_http import OpenAIHttpEngine

    chosen, ep = pick_endpoint(cfg.tts, "tts", name)
    return OpenAIHttpEngine(chosen, ep)
