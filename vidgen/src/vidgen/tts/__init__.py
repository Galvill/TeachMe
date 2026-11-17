"""Text-to-speech: the engine interface and the OpenAI-compatible HTTP engine."""

from vidgen.tts.engine import EndpointError, TTSEngine, engine_from_config

__all__ = ["EndpointError", "TTSEngine", "engine_from_config"]
