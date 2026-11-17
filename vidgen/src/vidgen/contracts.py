"""The JSON contracts written for the renderer (scene JSON) and the pipeline (``timeline.json``).

Both are plain dicts; :func:`dumps` serializes them with sorted keys so identical inputs
give byte-identical JSON (the scene JSON is part of the render cache key).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from vidgen.config import Config
from vidgen.schema import Script, effective_diagrams
from vidgen.timeline import Timeline

CONTRACT_VERSION = 1
DESIGN_SIZE = [1920, 1080]
TIME_DIGITS = 6


def _plain(value: Any) -> Any:
    """Tuples to lists, recursively, so the dict equals its own JSON round trip."""
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def _t(seconds: float) -> float:
    return round(seconds, TIME_DIGITS)


def effective_nodes(script: Script, scene_id: str) -> tuple[dict, dict | None]:
    """A scene's starting nodes and layout, after ``inherit`` (see ``effective_diagrams``)."""
    for scene, (nodes, layout) in zip(script.scenes, effective_diagrams(script)):
        if scene.id == scene_id:
            out = {k: _plain(n.model_dump()) for k, n in nodes.items()}
            return out, (_plain(layout.to_dict()) if layout is not None else None)
    raise KeyError(scene_id)


def scene_json(script: Script, tl: Timeline, scene_id: str, cfg: Config) -> dict:
    """The renderer input for one scene (Plan B's ``SceneInput``)."""
    scene = script.scene(scene_id)
    times = next((s for s in tl.scenes if s.id == scene_id), None)
    if times is None:
        raise KeyError(scene_id)
    nodes, layout = effective_nodes(script, scene_id)
    steps = []
    for step, st in zip(scene.steps, times.steps):
        action, payload = step.action
        steps.append(
            {
                "index": st.index,
                "start": _t(st.start),
                "duration": _t(st.duration),
                "caption": step.caption,
                "action": action,
                action: _plain(payload.model_dump(by_alias=True)),
            }
        )
    width, height = cfg.output_size()
    return {
        "version": CONTRACT_VERSION,
        "width": width,
        "height": height,
        "fps": cfg.fps,
        "design": list(DESIGN_SIZE),
        "seed": script.seed,
        "style": script.style,
        "title": script.title,
        "scene": {
            "id": scene.id,
            "duration": _t(times.duration),
            "nodes": nodes,
            "layout": layout,
            "steps": steps,
        },
    }


def timeline_json(tl: Timeline) -> dict:
    """``timeline.json``: per-scene audio, duration, word timestamps and step times."""
    return {
        "version": CONTRACT_VERSION,
        "fps": tl.fps,
        "width": tl.width,
        "height": tl.height,
        "total": _t(tl.total),
        "scenes": [
            {
                "id": s.id,
                "offset": _t(s.offset),
                "duration": _t(s.duration),
                "audio": str(s.audio),
                "words": [{"text": w.text, "start": _t(w.start), "end": _t(w.end)} for w in s.words],
                "steps": [{"index": st.index, "start": _t(st.start), "duration": _t(st.duration)} for st in s.steps],
            }
            for s in tl.scenes
        ],
    }


def dumps(obj: dict) -> str:
    """Stable JSON text: sorted keys, two-space indent, trailing newline."""
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def write_json(path: Path, obj: dict) -> None:
    Path(path).write_text(dumps(obj), encoding="utf-8")
