# vidgen

Turns a short YAML script into a narrated explainer video. The design is
`docs/superpowers/specs/2026-11-17-vidgen-design.md` at the repo root.

vidgen is a client. It calls a text-to-speech endpoint and a word-alignment endpoint over HTTP,
draws the frames with its own Node renderer, and encodes with ffmpeg. It runs no models itself.

## Install

```sh
make setup        # or: ./setup.sh
```

`setup.sh` is safe to re-run. It installs uv if it's missing, runs `uv sync`, builds the
renderer (`npm ci && npm run build` in `renderer/`; needs Node 20+), and makes sure there's an
ffmpeg with libx264 and loudnorm. When there isn't one, it downloads a pinned, sha256-checked static
build into `~/.cache/vidgen/bin` without sudo (Linux x86_64 and aarch64). It then runs
`uv tool install --editable .` to put `vidgen` on `PATH`, and ends with `vidgen doctor`. It downloads
no models. An endpoint that isn't running yet makes `doctor` report a failure; that's expected on
a first install.

## Endpoints

vidgen needs two OpenAI-compatible endpoints, both set in `vidgen.toml`:

- `[tts]`: `POST {base_url}/audio/speech`, asked for WAV.
- `[align]`: `POST {base_url}/audio/transcriptions`, which must return word timestamps.

Copy `vidgen.example.toml` to `vidgen.toml` and edit it. vidgen reads the first `vidgen.toml` it
finds in the script's folder, then at the git root, then in `~/.config/vidgen/`. That one file is
used whole; files are never merged. `--config FILE` overrides the search. Unknown keys are errors.

**Warning: a remote endpoint sees your script.** Narration text goes to the TTS endpoint and the
synthesized audio goes to the alignment endpoint. Use a local endpoint for anything you wouldn't
paste into a third party's service. API keys are read from the environment variable named in
`api_key_env`; they are never read from a file and never belong in the repo.

### Local example

Kokoro-FastAPI for speech and speaches for alignment, both on your own machine:

```sh
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest-cu128
```

```toml
[tts]
endpoint = "kokoro"

[tts.endpoints.kokoro]
base_url = "http://127.0.0.1:8880/v1"
model = "kokoro"
voice = "af_heart"
license = "Apache-2.0"        # recorded in the manifest; set the real one

[align]
endpoint = "speaches"

[align.endpoints.speaches]
base_url = "http://127.0.0.1:8000/v1"
model = "Systran/faster-whisper-large-v3"
```

Starting these servers, and their GPU environments, is up to you. `bakeoff/CANDIDATES.md` lists
other TTS servers and their licenses. A model's license must allow redistributing the audio if you
share the videos.

### Remote example (OpenAI)

```toml
[tts]
endpoint = "openai"

[tts.endpoints.openai]
base_url = "https://api.openai.com/v1"
model = "gpt-4o-mini-tts"
voice = "alloy"
api_key_env = "OPENAI_API_KEY"     # export OPENAI_API_KEY=... in your shell
license = "see provider terms"

[align]
endpoint = "openai"

[align.endpoints.openai]
base_url = "https://api.openai.com/v1"
model = "whisper-1"
api_key_env = "OPENAI_API_KEY"
```

Checked 2026-11-17, and likely to change: OpenAI's `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts`
shut down on 2027-01-06; `whisper-1` is the only OpenAI model that returns word timestamps, until
2027-02-26; and publishing AI-generated voice requires disclosing it. Re-check before relying on any
of this.

## Commands

```sh
vidgen doctor [script.yaml]            # toolchain, encoders and endpoint reachability
vidgen validate script.yaml [--strict] # schema, references and cues; no endpoints
vidgen tts script.yaml                 # synthesize and align every scene (cached)
vidgen lint script.yaml                # overlap and overflow checks on every scene
vidgen preview script.yaml --t 12.5    # PNG frames at whole-video times (default: densest 3)
vidgen render script.yaml --scene 2    # one scene, to scenes/02-<id>.mp4
vidgen build script.yaml [--draft] [--burn-captions] [--out DIR]
vidgen publish script.yaml [--target NAME] [--build-dir DIR]
vidgen bakeoff [--endpoints a,b] [--out DIR]   # compare TTS endpoints
vidgen --version
```

Every command except `validate` also takes `--config FILE`. `preview`, `render` and `build` take
`--draft` (1280x720) and `--out DIR`.

A build writes `video.mp4`, `captions.srt`, `poster.png`, `timeline.json` and, last,
`build.json` into `~/.cache/vidgen/builds/<slug>/` (or `--out`). TTS, alignment and scene
renders are cached by content hash under `~/.cache/vidgen/objects/`, so an unchanged rebuild
calls no endpoint and renders nothing, and editing one scene redoes only that scene.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | validation or lint failure; a bad `vidgen.toml`; a bad `--scene` or `--t`; a publish error (no target, draft or out-of-date build); `validate --strict` with an out-of-date manifest; `doctor` with any `fail` check |
| 2 | an endpoint, alignment, ffmpeg, node or renderer failure; an S3 error during `publish` |

Exit 2 prints a one-line `error: ...` message.

## Config keys

All keys are optional; the defaults apply with no `vidgen.toml`. `~` is expanded in paths.

| Key | Default | Meaning |
|---|---|---|
| `width`, `height`, `fps` | 1920, 1080, 30 | Output size and rate. Script coordinates are always a 1920x1080 design space. |
| `draft` | `false` | Render at 1280x720 (`--draft` sets it). Draft builds can't be published. |
| `ssaa` | 1 | Renderer supersample factor. |
| `scene_pad_s` | 0.4 | Silence after each scene's last word or animation. |
| `arrow_default_s`, `arrow_min_s`, `arrow_max_s` | 1.2, 0.6, 2.5 | Arrow durations. |
| `[paths]` `cache`, `ffmpeg`, `node`, `renderer` | `~/.cache/vidgen`, found on its own, `node`, `renderer/` | Build and cache dir; tool locations. |
| `[tts]`, `[align]` `endpoint` | none | Name of the entry in `endpoints` to use. |
| `[tts.endpoints.NAME]`, `[align.endpoints.NAME]` | | `base_url`, `model` (required); `voice` (`default`), `api_key_env` (empty: no auth), `timeout_s` (120), `extra` (merged into the request body), `license`. |
| `[pronunciations]` | empty | Whole-word replacements applied before TTS. A script's own `pronunciations` are merged over it. |
| `[encoder]` | see Encoder | `codec`, `crf`, `cq`, `preset`. |
| `[music]` | none | `path` and `volume_db` (-24) for a background bed ducked under speech. |
| `[publish]` | | `default` target name and `[publish.targets.NAME]` entries. |
| `[bakeoff]` `endpoints` | empty | `[tts.endpoints]` names that `vidgen bakeoff` compares. |

## Publishing

`vidgen publish` uploads a finished, non-draft, up-to-date build to a target and writes the manifest
next to the script: `manifest.json` beside `script.yaml`, or `<stem>.manifest.json` for any other
file name. Commit the manifest; the video never enters git. Files land at
`<prefix>/<slug>/<sha256(video)[:12]>/{video.mp4,captions.srt,poster.png}`, so an old manifest keeps
working after a rebuild. Publishing an unchanged build copies and uploads nothing, and leaves the
manifest alone. `validate --strict` fails when the manifest no longer matches the script.

```toml
[publish]
default = "nas"

[publish.targets.nas]
type = "local"
path = "~/vidgen-published"
public_base_url = "http://nas.local/vidgen"    # optional; fills in each file's url

[publish.targets.s3]
type = "s3"
bucket = "my-videos"
prefix = "teachme"
region = "eu-west-1"
endpoint_url = "https://minio.example.com"     # MinIO, R2, Backblaze; omit for AWS
public_base_url = "https://cdn.example.com/teachme"
```

A local target never writes outside its `path`. An S3 target takes its credentials from the standard
AWS chain: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (plus `AWS_SESSION_TOKEN`), a shared
credentials file or profile (`AWS_PROFILE`), or an instance role. Credentials are not stored in
`vidgen.toml`. The policy needs `s3:PutObject`; `s3:GetObject` lets vidgen skip files that are
already there (without it, it uploads them again).

## Encoder

`[encoder] codec = "auto"` uses `h264_nvenc` when the ffmpeg can really open it (`doctor` and builds
test-encode a tiny clip, because distro builds list it on machines with no NVIDIA GPU), and falls
back to `libx264`. Set `codec = "libx264"` or `"h264_nvenc"` to force one; forcing an encoder that
isn't available is an error. libx264 uses `crf` (18) and `preset` (`slow`); NVENC uses `cq` (19).

NVENC vs libx264 CRF 18 measurements (VMAF or SSIM, file sizes, and the chosen default) come in a
later task. Until then `auto` is the default.

## Skill install

The `vidgen-authoring` skill teaches a coding agent to write scripts and run the pipeline. It lives
at `vidgen/skill/vidgen-authoring` and is not shipped in the npm package. Symlink it into your
agent's skills folder, using an absolute path to your clone:

```sh
ln -s /path/to/TeachMe/vidgen/skill/vidgen-authoring ~/.claude/skills/vidgen-authoring   # all projects
ln -s /path/to/TeachMe/vidgen/skill/vidgen-authoring .claude/skills/vidgen-authoring     # one repo
```

## Troubleshooting

Run `vidgen doctor` first. Each line is `ok`, `warn` or `fail`, then a check name and detail; any
`fail` exits 1.

| Message | Fix |
|---|---|
| `fail python: ...; need 3.11+` | Install Python 3.11+; `uv` can fetch one. |
| `fail node: not found (...); install Node 20+` or `...; need 20+` | Install Node 20+, or set `[paths] node`. |
| `fail renderer: renderer not built; run vidgen/setup.sh` | Run `./setup.sh`, or `npm ci && npm run build` in `renderer/`. |
| `fail ffmpeg: not found; run vidgen/setup.sh` | Run `./setup.sh`, or set `[paths] ffmpeg`. |
| `fail libx264: missing from this ffmpeg` or `fail loudnorm: missing ...` | The ffmpeg lacks it; run `./setup.sh` to get a static build. |
| `warn h264_nvenc: not available; encoding falls back to libx264` | Fine without a GPU. Otherwise check the NVIDIA driver. |
| `warn tts: no [tts.endpoints] configured in vidgen.toml` (or `align`) | Add an endpoint; see Endpoints. |
| `fail tts endpoint NAME: URL unreachable (ConnectError)` | The server isn't running, or `base_url` is wrong. |
| `fail config: ...` | `vidgen.toml` is invalid. The message names the file and key, e.g. `unknown key 'tts.endpoints.x.voce'`, or `tts.endpoint "x" has no [tts.endpoints.x] entry`. |
| `error: endpoint "NAME": env var "KEY" is not set` | Export the variable named in `api_key_env`. |
| `error: endpoint "NAME": HTTP 4xx from URL: ...` | The endpoint rejected the request: wrong `model` or `voice`, or a bad key. A 4xx fails at once; connect errors and 5xx are tried 3 times. |
| `error: endpoint "NAME": returned non-WAV` | The server ignored the WAV request; check the model and server settings. |
| `error: endpoint "NAME": transcription words lack word/start/end; is word timestamping supported?` | The alignment model or server doesn't return word timestamps. |
| `error: only N/M words aligned; check the endpoint's language/model` | The alignment model heard something other than the script; check its language and the TTS voice. |
| `error: no publish target; set publish.default or pass --target` | Add `[publish]` config, or pass `--target NAME`. |
| `error: draft build; rebuild without --draft` | Rebuild, then publish. |
| `error: build is out of date; run vidgen build` | The script changed since the last build. |
| `warn: manifest is out of date (script changed since publish)` | Rebuild and publish again, then commit the manifest. |
| `s3: AccessDenied: ...` or `s3: NoCredentials: ...` (exit 2) | Check the credential chain and the bucket policy. |
