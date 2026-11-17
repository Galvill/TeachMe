# vidgen

Turns a short YAML script into a narrated explainer video. Work in progress; the design is
`docs/superpowers/specs/2026-11-17-vidgen-design.md` at the repo root.

## Setup

```sh
make setup        # or: bash setup.sh
```

`setup.sh` is safe to re-run. It installs uv if it's missing, runs `uv sync`, builds the
renderer (`npm ci && npm run build` in `renderer/`; needs Node 20+), and makes sure there's an
ffmpeg with libx264 and loudnorm. When there isn't one, it downloads a pinned static build into
`~/.cache/vidgen/bin` without sudo. It then runs `uv tool install --editable .` to put `vidgen` on
`PATH`, and ends with `vidgen doctor`. It downloads no models.

Copy `vidgen.example.toml` to `vidgen.toml` and point `[tts]` and `[align]` at your
OpenAI-compatible endpoints. Narration text and audio are sent to them, so a remote endpoint
sees your script. API keys come from the env var named in `api_key_env`, never from a file.

## Commands

```sh
vidgen doctor                          # toolchain, encoders and endpoint reachability
vidgen validate script.yaml            # schema, references and cues; no endpoints
vidgen tts script.yaml                 # synthesize and align every scene (cached)
vidgen lint script.yaml                # overlap and overflow checks on every scene
vidgen preview script.yaml --t 12.5    # PNG frames at whole-video times (default: densest 3)
vidgen render script.yaml --scene 2    # one scene, to scenes/02-<id>.mp4
vidgen build script.yaml [--draft] [--burn-captions] [--out DIR]
```

A build writes `video.mp4`, `captions.srt`, `poster.png`, `timeline.json` and, last,
`build.json` into `~/.cache/vidgen/builds/<slug>/` (or `--out`). TTS, alignment and scene
renders are cached by content hash under `~/.cache/vidgen/objects/`, so an unchanged rebuild
calls no endpoint and renders nothing, and editing one scene redoes only that scene.

Exit codes: 0 ok, 1 validation or lint failure, 2 an endpoint, alignment, ffmpeg or renderer
failure.

## Tests

```sh
make test         # renderer typecheck + vitest, then pytest -m "not endpoint"
```

The pipeline tests run against a fake OpenAI-compatible server (`tests/fake_endpoint.py`), so
they need ffmpeg on `PATH` and the built renderer but no model. Tests marked `endpoint` need
real endpoints and are excluded.
