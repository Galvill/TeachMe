"""A fake OpenAI-compatible audio server for tests (no model, no GPU).

- ``POST /v1/audio/speech`` returns a 24 kHz mono 440 Hz WAV lasting 0.3 s per input token
  plus 0.2 s, and remembers sha256(wav) -> tokens.
- ``POST /v1/audio/transcriptions`` finds the WAV in the multipart body (``cgi`` is gone in
  Python 3.13, so it locates ``RIFF`` and reads the RIFF length) and returns verbose_json
  words, lowercased and punctuation-stripped, at ``start = i * 0.3``, ``end = start + 0.25``.
- Any GET answers 200, so reachability checks pass.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
import struct
import threading
import wave
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

RATE = 24000
TOKEN_S = 0.3
TAIL_S = 0.2
WORD_S = 0.25


def tone_wav(tokens: list[str], text: str) -> bytes:
    seconds = TOKEN_S * len(tokens) + TAIL_S
    n = int(round(seconds * RATE))
    # The first samples carry a hash of the text so two inputs with the same token count still
    # give different WAVs (and so different sha256 keys).
    tag = hashlib.sha256(text.encode("utf-8")).digest()[:8]
    frames = bytearray()
    for i in range(n):
        if i < len(tag):
            v = tag[i]
        else:
            v = int(8000 * math.sin(2 * math.pi * 440 * i / RATE))
        frames += struct.pack("<h", v)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def extract_wav(body: bytes) -> bytes | None:
    i = body.find(b"RIFF")
    if i < 0 or len(body) < i + 8:
        return None
    (size,) = struct.unpack("<I", body[i + 4 : i + 8])
    return body[i : i + 8 + size]


def _asr_word(token: str) -> str:
    return re.sub(r"[^\w]", "", token.lower())


@dataclass
class _Canned:
    status: int
    body: bytes
    content_type: str


@dataclass
class FakeEndpoint:
    base_url: str = ""
    requests: list[dict] = field(default_factory=list)
    words_shape: str = "words"  # or "segments"
    _queue: list[_Canned] = field(default_factory=list)
    _known: dict[str, list[str]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def fail_next(self, status: int, n: int = 1) -> None:
        """The next ``n`` POSTs answer ``status`` with a plain-text body."""
        self.respond_next(status, f"fake failure {status}".encode(), "text/plain", n)

    def respond_next(self, status: int, body: bytes, content_type: str, n: int = 1) -> None:
        with self._lock:
            self._queue.extend(_Canned(status, body, content_type) for _ in range(n))

    def tts_requests(self) -> list[dict]:
        return [r for r in self.requests if r["path"].endswith("/audio/speech")]

    # Called by the handler.
    def handle(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes, str]:
        rec: dict[str, Any] = {"method": method, "path": path, "headers": headers, "body": body, "json": None}
        if headers.get("content-type", "").startswith("application/json"):
            rec["json"] = json.loads(body or b"null")
        with self._lock:
            self.requests.append(rec)
            if method == "POST" and self._queue:
                c = self._queue.pop(0)
                return c.status, c.body, c.content_type
        if method == "GET":
            return 200, b"{}", "application/json"
        if path.endswith("/audio/speech"):
            text = str((rec["json"] or {}).get("input", ""))
            tokens = text.split()
            wav = tone_wav(tokens, text)
            with self._lock:
                self._known[hashlib.sha256(wav).hexdigest()] = tokens
            return 200, wav, "audio/wav"
        if path.endswith("/audio/transcriptions"):
            wav = extract_wav(body)
            tokens = self._known.get(hashlib.sha256(wav).hexdigest()) if wav else None
            if tokens is None:
                return 400, b'{"error": "unknown audio"}', "application/json"
            words = [
                {"word": _asr_word(t), "start": round(i * TOKEN_S, 6), "end": round(i * TOKEN_S + WORD_S, 6)}
                for i, t in enumerate(tokens)
            ]
            words = [w for w in words if w["word"]]
            text = " ".join(w["word"] for w in words)
            payload: dict[str, Any] = {"text": text, "duration": TOKEN_S * len(tokens) + TAIL_S}
            if self.words_shape == "segments":
                payload["segments"] = [{"text": text, "words": words}]
            else:
                payload["words"] = words
            return 200, json.dumps(payload).encode(), "application/json"
        return 404, b'{"error": "not found"}', "application/json"


def _handler(fake: FakeEndpoint) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _serve(self, method: str) -> None:
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length) if length else b""
            headers = {k.lower(): v for k, v in self.headers.items()}
            status, out, ctype = fake.handle(method, self.path, headers, body)
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def do_GET(self) -> None:  # noqa: N802
            self._serve("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._serve("POST")

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            pass

    return Handler


class FakeServer:
    def __init__(self) -> None:
        self.fake = FakeEndpoint()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self.fake))
        host, port = self.httpd.server_address[:2]
        self.fake.base_url = f"http://{host}:{port}/v1"
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)

    def __enter__(self) -> FakeEndpoint:
        self.thread.start()
        return self.fake

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
