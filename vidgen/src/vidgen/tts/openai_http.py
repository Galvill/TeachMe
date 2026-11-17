"""OpenAI-compatible HTTP clients: ``POST {base_url}/audio/speech`` (the v1 TTS engine).

The retrying POST helper here is shared with the alignment client.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

from vidgen.config import Endpoint
from vidgen.tts.engine import EndpointError

ATTEMPTS = 3
BACKOFF_S = (1.0, 2.0)  # sleep before attempt 2 and attempt 3
DETAIL_CHARS = 500

# Indirection so tests can skip the real waits.
_sleep = time.sleep


def auth_headers(name: str, ep: Endpoint) -> dict[str, str]:
    if not ep.api_key_env:
        return {}
    value = os.environ.get(ep.api_key_env)
    if not value:
        raise EndpointError(name, f'env var "{ep.api_key_env}" is not set')
    return {"Authorization": f"Bearer {value}"}


def url(ep: Endpoint, path: str) -> str:
    return ep.base_url.rstrip("/") + "/" + path.lstrip("/")


def post(name: str, ep: Endpoint, path: str, **kwargs: Any) -> httpx.Response:
    """POST with up to 3 attempts on connect errors or 5xx; a 4xx fails at once."""
    headers = auth_headers(name, ep)
    target = url(ep, path)
    last = ""
    for attempt in range(ATTEMPTS):
        if attempt:
            _sleep(BACKOFF_S[attempt - 1])
        try:
            with httpx.Client(timeout=ep.timeout_s) as client:
                resp = client.post(target, headers=headers, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            last = f"cannot connect to {target} ({e})"
            continue
        except httpx.HTTPError as e:
            raise EndpointError(name, f"request to {target} failed: {e}") from None
        if resp.status_code >= 500:
            last = f"HTTP {resp.status_code} from {target}: {resp.text[:DETAIL_CHARS]}"
            continue
        if resp.status_code >= 400:
            raise EndpointError(name, f"HTTP {resp.status_code} from {target}: {resp.text[:DETAIL_CHARS]}")
        return resp
    raise EndpointError(name, f"{last} (after {ATTEMPTS} attempts)")


class OpenAIHttpEngine:
    def __init__(self, name: str, endpoint: Endpoint) -> None:
        self.name = name
        self.endpoint = endpoint

    def synthesize(self, text: str, voice: str, seed: int | None) -> bytes:
        ep = self.endpoint
        body: dict[str, Any] = {"model": ep.model, "input": text, "voice": voice, "response_format": "wav", **ep.extra}
        if seed is not None and "seed" not in ep.extra:
            body["seed"] = seed
        resp = post(self.name, ep, "audio/speech", json=body)
        data = resp.content
        if not data.startswith(b"RIFF"):
            ctype = resp.headers.get("content-type", "none")
            raise EndpointError(self.name, f"returned non-WAV (content-type {ctype})")
        return data
