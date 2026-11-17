# vidgen C: Pipeline Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-17-vidgen-design.md`, sections 5 (data flow, commands), 8 (endpoints, CI fake), 11, 12.
**Goal:** `vidgen build|tts|preview|render|lint|doctor` work end to end against OpenAI-compatible endpoints, with per-scene caching, loudness-normalised assembly and captions, and the whole pipeline runs in CI against a fake endpoint.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Plans A and B are merged. The renderer is used only through its CLI contract (Plan B Task 6).
- ffmpeg, ffprobe and node run with `subprocess.run([...])` argument lists, never a shell string.
- New runtime dep: `httpx`. No other network library.
**Verification:** Plan A's line, run after `npm ci && npm run build` in `vidgen/renderer/` with `ffmpeg` on `PATH`. Tests that need the renderer skip only when `dist/cli.js` is missing, and CI always builds it.

## File structure

| File | Responsibility |
|---|---|
| `vidgen/src/vidgen/tools.py` | locate ffmpeg/ffprobe/node/renderer, run with stderr tail, encoder args |
| `vidgen/src/vidgen/cache.py` | content-hash keys, atomic writes |
| `vidgen/src/vidgen/tts/engine.py`, `tts/openai_http.py` | `TTSEngine`, HTTP engine, `EndpointError` |
| `vidgen/src/vidgen/align.py` | alignment client, transcript→script word mapping |
| `vidgen/src/vidgen/render.py` | bridge to the renderer CLI |
| `vidgen/src/vidgen/assemble.py` | concat, narration track, loudnorm, music, mux, SRT, burn-in |
| `vidgen/src/vidgen/build.py` | orchestration, `build.json` |
| `vidgen/src/vidgen/doctor.py` | environment and endpoint checks |
| `vidgen/src/vidgen/cli.py` | the commands above |
| `vidgen/setup.sh`, `vidgen/Makefile` | one-step install |
| `vidgen/tests/conftest.py`, `tests/fake_endpoint.py` | fake OpenAI-compatible server fixture |
| `.github/workflows/ci.yml` | `vidgen` job |

### Task 1: Tools

**Files:**
- Create: `vidgen/src/vidgen/tools.py`
- Test: `vidgen/tests/test_tools.py`

**Interfaces:**
- Produces: `find_ffmpeg(cfg) -> tuple[Path, Path]` (ffmpeg, ffprobe), `renderer_cli(cfg) -> Path`, `encoders(ffmpeg: Path) -> set[str]`, `encoder_args(cfg, available: set[str]) -> list[str]`, `run(cmd: list[str|Path]) -> CompletedProcess`, `class ToolMissing(Exception)`, `class ToolFailed(Exception): cmd; code; stderr_tail`.

**Behavior:**
- ffmpeg lookup order: `cfg.paths.ffmpeg`, then `<cfg.paths.cache>/bin/ffmpeg`, then `PATH`. If none is found it raises `ToolMissing("ffmpeg not found; run vidgen/setup.sh")`.
- `renderer_cli`: `cfg.paths.renderer` or `<package source>/../../renderer`, then `dist/cli.js`. If that is missing it raises `ToolMissing("renderer not built; run vidgen/setup.sh")`.
- `encoder_args` with `auto` and `h264_nvenc` available gives `-c:v h264_nvenc -preset p7 -tune hq -rc vbr -cq <cq> -b:v 0 -profile:v high`. Otherwise it gives `-c:v libx264 -crf <crf> -preset <preset> -profile:v high`. An explicit `h264_nvenc` when unavailable raises `ToolMissing`.
- `run` raises `ToolFailed` on a non-zero exit, carrying the last 40 stderr lines.

**Tests:**
- `test_ffmpeg_lookup_order`, `test_encoder_auto_fallback`, `test_explicit_nvenc_missing`, `test_run_failure_tail`.

### Task 2: Cache

**Files:**
- Create: `vidgen/src/vidgen/cache.py`
- Test: `vidgen/tests/test_cache.py`

**Interfaces:**
- Produces: `key(*parts: Any) -> str` (sha256 hex of `json.dumps(parts, sort_keys=True, separators=(",",":"), default=str)`), `Cache(root: Path)`, `Cache.path(kind: Literal["tts","align","scene"], k: str, ext: str) -> Path`, `Cache.write(path: Path, data: bytes) -> None`.

**Behavior:**
- The object root is `<cfg.paths.cache>/objects`, laid out as `<kind>/<k[:2]>/<k>.<ext>`. Build outputs go to `<cfg.paths.cache>/builds/<slug>/` unless `--out` is given.
- `write` goes to `<path>.tmp` and then `os.replace`, so a crash never leaves a partial object.

**Tests:**
- `test_key_stable_across_dict_order`, `test_write_atomic` (no `.tmp` is left behind).

### Task 3: TTS engine and fake endpoint

**Files:**
- Create: `vidgen/src/vidgen/tts/{__init__,engine,openai_http}.py`, `vidgen/tests/fake_endpoint.py`, `vidgen/tests/conftest.py`
- Test: `vidgen/tests/test_tts.py`

**Interfaces:**
- Consumes: `Endpoint`, `EndpointSet` (Plan A Task 2).
- Produces: `TTSEngine` protocol `{name: str; synthesize(text: str, voice: str, seed: int | None) -> bytes}` (WAV bytes), `engine_from_config(cfg, name: str | None = None) -> TTSEngine`, `class EndpointError(Exception): endpoint: str; detail: str`, and the pytest fixture `fake_endpoint -> FakeEndpoint{base_url: str; fail_next(status: int, n: int); requests: list[dict]}`.

**Behavior:**
- Request: `POST {base_url}/audio/speech` with JSON `{model, input, voice, response_format: "wav", **extra}`. `seed` is added when it isn't None and isn't already in `extra`.
- When `api_key_env` is set, the request sends `Authorization: Bearer $VAR`. If the variable is unset it raises `EndpointError('env var "X" is not set')`.
- Up to 3 attempts, with 1 s and 2 s backoff, on connect errors or 5xx. A 4xx fails immediately, with the response body in `detail`.
- A body that doesn't start with `RIFF` raises `EndpointError("returned non-WAV (content-type …)")`.
- The fake TTS returns a 24 kHz mono 440 Hz WAV lasting 0.3 s per token plus 0.2 s. It remembers sha256(wav)→tokens. The fake `/audio/transcriptions` returns verbose_json words, lowercased and with punctuation stripped, at `start = i·0.3`, `end = start + 0.25`.

**Tests:**
- `test_request_body_and_seed`, `test_bearer_from_env`, `test_missing_env_var`, `test_retries_5xx_then_succeeds`, `test_4xx_no_retry`, `test_non_wav_rejected`.

**Gotchas:**
- `cgi` is gone in Python 3.13. The fake finds the WAV inside the multipart body by locating `RIFF` and reading the RIFF length.

### Task 4: Alignment

**Files:**
- Create: `vidgen/src/vidgen/align.py`
- Test: `vidgen/tests/test_align.py`

**Interfaces:**
- Consumes: `Narration`, `Spoken`, `norm` (Plan A Task 3), `WordTime` (Plan A Task 6).
- Produces: `AsrWord(text, start, end)`, `aligner_from_config(cfg) -> Aligner` with `Aligner.words(wav: Path) -> list[AsrWord]`, `map_words(asr: list[AsrWord], spoken: Spoken, n: Narration, duration: float) -> list[WordTime]`, `class AlignError(Exception)`.

**Behavior:**
- Request: multipart `POST {base_url}/audio/transcriptions` with `file`, `model`, `response_format=verbose_json` and `timestamp_granularities[]=word`. Words are read from top-level `words` or from `segments[].words`.
- Matching: `difflib.SequenceMatcher(autojunk=False)` over normed spoken tokens against normed ASR words. A matched token takes the ASR times. Unmatched tokens are interpolated linearly between their matched neighbours (0 and `duration` at the edges).
- Each original word gets the min start and max end of its tokens. Starts are non-decreasing.
- Fewer than 50 % of tokens matched raises `AlignError("scene <id>: only k/n words aligned; check the endpoint's language/model")`. The scene id is attached by the caller.

**Tests:**
- `test_exact_match`, `test_spelled_acronym_interpolated` (spoken `D N S` against ASR `dns`), `test_missing_word_interpolated`, `test_low_match_raises`, `test_segments_shape`, `test_monotonic`.

### Task 5: Renderer bridge

**Files:**
- Create: `vidgen/src/vidgen/render.py`
- Test: `vidgen/tests/test_render.py`

**Interfaces:**
- Consumes: the CLI contract (Plan B Task 6), `scene_json` (Plan A Task 7).
- Produces: `render_scene(cfg, scene: dict, out: Path) -> None`, `frames(cfg, scene: dict, times: list[float], out_dir: Path) -> list[Path]`, `lint(cfg, scene: dict) -> LintReport{issues: list[dict]; densest: list[dict]}`, `class RendererError(Exception)`.

**Behavior:**
- The scene JSON goes to a temp file. The bridge calls `node <cli> …` with `--ffmpeg`, `--encoder '{"args": encoder_args(...)}'` and `--ssaa cfg.ssaa`.
- Exit 1 from `lint` returns the issues. Exit 2 or 3, from any subcommand, raises `RendererError` with the stderr tail.

**Tests:**
- `test_lint_reports_issues` (using Plan B's overlap fixture), `test_render_writes_mp4`, `test_bad_input_raises`.

### Task 6: Assembly and captions

**Files:**
- Create: `vidgen/src/vidgen/assemble.py`
- Test: `vidgen/tests/test_assemble.py`

**Interfaces:**
- Produces: `concat_video(parts: list[Path], out: Path, cfg)`, `narration_track(tl: Timeline, out: Path, cfg)`, `loudnorm(src: Path, out: Path, cfg, target: float = -16)`, `mix_music(speech: Path, out: Path, cfg)`, `mux(video: Path, audio: Path, out: Path, cfg)`, `write_srt(tl: Timeline, out: Path)`, `burn_captions(video: Path, srt: Path, out: Path, cfg)`, `measure_lufs(path: Path, cfg) -> float`.

**Behavior:**
- `concat_video` uses the concat demuxer with `-c copy`. A path containing `'` is escaped as `'\''`.
- `narration_track` resamples each scene to 48 kHz mono, then `apad` plus `atrim=duration=<scene.duration>`, then concat. Its length equals `tl.total` within one frame.
- `loudnorm` runs a first pass with `print_format=json` (parsing the last JSON object in stderr), then a second pass with the `measured_*` values and `linear=true`, at TP −1.5 and LRA 11.
- `mix_music` is used only when `cfg.music` is set. The music loops, takes `volume_db`, is ducked with `sidechaincompress` keyed on speech, and goes through `amix duration=first`. Loudnorm runs after the mix.
- `mux` uses `-c:v copy -c:a aac -b:a 192k`, writing to a temp file and then renaming.
- SRT cues are taken from the words, breaking at sentence-ending punctuation, at 42 characters or at 3.5 s. Times are `scene.offset + word time`.

**Tests:**
- `test_concat_duration` (two lavfi `testsrc` clips), `test_concat_quote_path`, `test_narration_length`, `test_loudnorm_target` (within ±1 LU), `test_music_ducked_shorter_than_speech_ok`, `test_srt_chunking`.

### Task 7: Build orchestration and CLI

**Files:**
- Create: `vidgen/src/vidgen/build.py`
- Modify: `vidgen/src/vidgen/cli.py`
- Test: `vidgen/tests/test_build.py`

**Interfaces:**
- Produces: `synthesize_all(script, cfg) -> dict[str, SceneAudio]`, `build(script_path: Path, cfg, out: Path | None = None, burn: bool = False) -> BuildResult`, `render_one(script_path, cfg, scene: str, out: Path | None) -> Path`, `preview(script_path, cfg, times: list[float]) -> list[Path]`.

`build.json` (consumed by Plan D), written last into the build dir:

```json
{ "version": 1, "slug": "dns-lookup", "title": "…", "scriptHash": "sha256:…", "syncedCommit": "3f2a9c1",
  "sources": [], "draft": false, "durationSec": 52.4, "width": 1920, "height": 1080, "language": "en",
  "tts": {"endpoint": "local-chatterbox", "model": "chatterbox", "voice": "default", "license": "MIT"},
  "vidgenVersion": "0.1.0",
  "files": {"video": "video.mp4", "captions": "captions.srt", "poster": "poster.png", "timeline": "timeline.json"} }
```

**Behavior:**
- Cache keys: TTS `key(spoken.text, endpoint, model, voice, extra, seed)`; alignment `key(tts key, align endpoint, model)`; scene `key(scene_json, sha256 of renderer dist/, encoder args, ssaa)`.
- All scenes are linted before any renders. Issues print as `scene intro t=3.25 label-overlap: <message>`, then exit 1.
- An unchanged rebuild renders 0 scenes. Editing one scene's narration redoes only that scene.
- Poster: the frame at the highest-label-count `densest` time. `--burn-captions` adds `video.burned.mp4`.
- `render --scene <id|1-based n>` writes only `scenes/NN-<id>.mp4`. `preview --t <global s>` maps to scene-local time. Without `--t` it uses the top 3 densest times.
- Exit 1 for validation or lint failures. Exit 2, with a one-line message, for `EndpointError`, `AlignError`, `ToolMissing`, `ToolFailed` or `RendererError`.
- `--draft` sets `cfg.draft` and writes `"draft": true` to `build.json`.

**Tests:**
- `test_build_end_to_end` (`dns-mini.yaml` on the fake endpoint: outputs exist, duration = `tl.total` ±1 frame, −16 ±1 LUFS), `test_rebuild_reuses_all`, `test_edit_one_scene`, `test_lint_blocks_render`, `test_render_one_scene`, `test_preview_time_mapping`, `test_endpoint_down_exit_2`.

### Task 8: Doctor and setup

**Files:**
- Create: `vidgen/src/vidgen/doctor.py`, `vidgen/setup.sh`, `vidgen/Makefile`
- Modify: `vidgen/src/vidgen/cli.py`
- Test: `vidgen/tests/test_doctor.py`

**Interfaces:**
- Produces: `doctor(cfg) -> list[Check]`, with `Check(status: Literal["ok","warn","fail"], name: str, detail: str)`.

**Behavior:**
- Checks:
  - fail: Python < 3.11, Node < 20, renderer not built, ffmpeg missing, `libx264` or `loudnorm` missing, any configured endpoint unreachable.
  - warn: `h264_nvenc` missing.
- An endpoint counts as reachable if a GET on `base_url` within 5 s gets any HTTP status.
- Output is one line per check (`fail ffmpeg: not found`), and the command exits 1 if any check fails.
- `setup.sh` is idempotent. It installs uv when missing, then runs `uv sync`, `npm ci && npm run build` in `renderer/` and `uv tool install --editable .`. If no ffmpeg with `libx264` is found, it downloads a pinned static build into `~/.cache/vidgen/bin`. It ends with `vidgen doctor`.
- `make setup` and `make test` wrap these.

**Tests:**
- `test_doctor_endpoint_reachable`, `test_doctor_endpoint_down_fails`, `test_doctor_nvenc_warn_only`, `test_setup_sh_parses` (`bash -n`).

**Gotchas:**
- Pin the static ffmpeg to a dated BtbN autobuild tag and check its sha256 in the script. Never use `latest`.

### Task 9: CI job

**Files:**
- Modify: `.github/workflows/ci.yml` (append a job)

**Behavior:**
- Job `vidgen` on `ubuntu-latest`: checkout, setup-node 20, `sudo apt-get install -y ffmpeg`, setup-uv, then in `vidgen/renderer` `npm ci && npm run typecheck && npm test && npm run build`, then in `vidgen` `uv sync && uv run pytest -m "not endpoint"`.
- The existing `verify` and `gate` jobs are unchanged. `vidgen` is not added to the required checks in this plan.

**Tests:**
- The job passes on the PR that adds it.

**Gotchas:**
- The repo pins every action by commit SHA with a version comment, as `ci.yml` does. Pin `astral-sh/setup-uv` the same way.

## Coverage

Spec sections: 5 (data flow 2–8, commands, build location), 8 (endpoint protocol, retries, fake endpoint), 11 (setup, CLI install, doctor), 12 (pipeline and CI tests).
