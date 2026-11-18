"""Reading RIFF/WAVE headers by hand, so streamed WAVs report their real length.

A server that streams WAV can't know the length when it writes the header, so it writes
placeholder sizes (Kokoro-FastAPI uses ``0xFFFFFFFF`` for both the RIFF and the data chunk).
Python's ``wave`` trusts those and reports about 24 hours of audio. Here the data chunk is
sized by the bytes actually present when its declared size is a placeholder or overruns them.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

STREAMED = 0xFFFFFFFF


@dataclass(frozen=True)
class WavInfo:
    rate: int
    channels: int
    block_align: int  # bytes per frame (all channels)
    data_offset: int  # where the sample bytes start
    data_size: int  # sample bytes actually present
    declared_size: int  # the data chunk's size field as written

    @property
    def duration(self) -> float:
        return (self.data_size // self.block_align) / self.rate

    @property
    def streamed(self) -> bool:
        """The header's data size is a placeholder or longer than the bytes that arrived."""
        return self.declared_size != self.data_size


def parse_wav(data: bytes) -> WavInfo | None:
    """The fmt and data chunk facts, or None when ``data`` isn't a WAV this can read."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    fmt: tuple[int, int, int] | None = None
    off = 12
    while off + 8 <= len(data):
        cid = data[off : off + 4]
        (size,) = struct.unpack_from("<I", data, off + 4)
        body = off + 8
        if cid == b"fmt ":
            if size < 16 or body + 16 > len(data):
                return None
            _tag, channels, rate, _byte_rate, block_align = struct.unpack_from("<HHIIH", data, body)
            fmt = (rate, channels, block_align)
        elif cid == b"data":
            if fmt is None or fmt[0] <= 0 or fmt[2] <= 0:
                return None
            present = len(data) - body
            actual = present if size == STREAMED or size > present else size
            return WavInfo(fmt[0], fmt[1], fmt[2], body, actual, size)
        if size == STREAMED:
            return None
        off = body + size + (size & 1)
    return None


def repair_streamed(data: bytes) -> bytes:
    """``data`` with real RIFF and data sizes when the header carries streaming placeholders.

    Anything else (a well-formed WAV, or bytes this can't parse) comes back unchanged.
    """
    info = parse_wav(data)
    riff_ok = len(data) >= 8 and struct.unpack_from("<I", data, 4)[0] <= len(data) - 8
    if info is None or (not info.streamed and riff_ok):
        return data
    # A streamed data chunk runs to the end of the bytes, so nothing is cut.
    out = bytearray(data)
    struct.pack_into("<I", out, 4, len(data) - 8)
    struct.pack_into("<I", out, info.data_offset - 4, info.data_size)
    return bytes(out)
