# vidgen: narrated technical explainer videos (design spec)

Date: 2026-11-17
Status: Draft for review
Source: the user's "technical explainer video generator" prompt, refined in a brainstorming session.

## 1. Intent

TeachMe teaches engineers the codebase they work on through agent-written Markdown courses.
Some ideas are best explained with a short animation instead of prose. Examples are a
request moving through services, a cache miss falling through layers, or a retry path. **vidgen** is a local
tool that turns a short YAML script into a narrated explainer video with animated,
hand-drawn-style diagrams.

- **Who writes the scripts:** a coding agent, from the real code. A `vidgen-authoring` skill
  teaches it how, following the pattern of `skill/teachme-authoring`.
- **Who watches:** engineers. They watch embedded in TeachMe course pages (a later integration) and also as
  standalone videos they can watch or share.
- **This spec covers:** the standalone utility and its skill, built in this repo, with
  the data shapes TeachMe will need later. The TeachMe integration itself is a later project
  (§14).

Success: an agent using the skill on a repo writes a script grounded in the code, and
`vidgen build` produces a 1080p video with narration in sync with the arrows and no overlapping
labels. Then `vidgen publish` uploads it to a local path or S3 and writes a manifest that is committed
next to the script.

## 2. Goals, non-goals, anti-goals

**Goals**
- Text in, MP4 out. Rendering and assembly are local. Models are reached through endpoints that can be
  local. Reproducible (my call on what that means): the renderer is
  bit-deterministic (CPU Skia, seeded roughjs). TTS is seeded, but GPU kernels may not be
  bit-exact, so reproducibility comes from the cache. A cached scene's audio is reused unchanged,
  and a rebuild from a cold cache may produce a slightly different WAV and therefore a new video
  hash. Bit-exact TTS is not a bake-off criterion.
- Narration drives the timeline. Every animation starts when its narration cue is spoken.
- Speech quality clearly better than Kokoro, chosen by the user in a listening bake-off.
- **vidgen does not run models.** TTS and alignment are reached through configured HTTP
  endpoints, either local (a server on the 5090 at `localhost`) or remote (user decision). vidgen itself stays a
  light CPU tool that any engineer or agent can install and run, as long as an endpoint is reachable.
- Incremental: only scenes whose inputs changed are re-synthesized or re-rendered.
- A layout linter that fails the build on overlapping or overflowing text.
- Publish targets: a local path, or S3 (including S3-compatible endpoints).
- A skill so a coding agent can author, check, build and publish videos without help.

**Non-goals (v1)**
- TeachMe UI embedding, `teachme validate`/`status` support for videos (§14).
- Diagram shapes beyond box-and-arrow plus code/terminal blocks (§14 lists next shapes).
- Hosting, downloading or running TTS/alignment models (they live behind endpoints the user runs
  or points to); cloud rendering; multi-user hosting; an interactive editor or preview studio.
- Video committed to git.

**Anti-goals** (a failure even if everything technically works)
- Narration and arrows drifting out of sync.
- Overlapping or clipped labels reaching a finished video.
- Robotic or mispronounced speech (acronyms, hostnames, IP addresses).
- vidgen's Python/CUDA/model weight footprint leaking into the `teachme` npm package or its CI.
- A diagram that shows something the code doesn't do (the skill's grounding rule).
- A license that blocks sharing the videos or using vidgen from an MIT repo.

## Constraints

- **Hardware/OS:** vidgen runs on Linux or Windows via WSL2, CPU only, with no PyTorch or CUDA in
  its env. The user's main box has an RTX 5090 (32 GB, Blackwell sm_120). Model servers run there are
  the user's concern, and a model has to run on sm_120 to be a bake-off candidate on that box.
  NVENC is used when the local ffmpeg has it; otherwise libx264.
- **Current machine state (checked):** GPU visible (driver 610.88). Python 3.12.3. **No ffmpeg
  and no uv installed.** Setup must handle both (§11).
- **Endpoints:** TTS and alignment are HTTP endpoints configured in `vidgen.toml`, and may be
  local or remote. Narration text and audio are sent to them, so the README warns that a remote
  endpoint sees the script. API keys come from env vars named in config, never from the repo.
  S3 is used only as a publish destination.
- **Isolation from TeachMe:** everything lives under a top-level `vidgen/` folder with its own
  toolchain. The root `package.json` `files` list (`bin server shared dist skill`) and root
  `vitest.config.ts` (scoped to `src/ server/ test/`) already exclude it, and must stay that way.
  The vidgen skill lives at `vidgen/skill/vidgen-authoring/`, not under root `skill/`, so it is not
  published with the npm package.
- **Licenses:** vidgen code is MIT like the repo. Renderer dependencies must be permissive.
  The chosen TTS model's license must allow redistributing the generated audio, because
  published videos may be shared. If the winner doesn't allow that, the bake-off table says so
  and the user decides. Fonts: Excalifont or Caveat (both OFL), with Inter (OFL) as fallback.
- **Python 3.11+ via `uv`. Node 20+** for the renderer (it matches the repo's engines floor).
- **No hard-coded paths.** All config is in `vidgen.toml`.
- **Video never enters git.** Only scripts and manifests do.

## 4. Approaches considered (renderer)

The outer shape was fixed by the prompt: a Python CLI (`uv`) runs TTS and alignment, which are
Python ML stacks, and ffmpeg does the encoding. The open choice was the frame renderer.

| | Approach | Trade-offs |
|---|---|---|
| A | **Remotion** (React + TS + roughjs) | Mature, frame-accurate, preview studio. Renders through headless Chromium (heavier, slower). License: free only for individuals and companies of up to 3 people, which would bind anyone using vidgen from an MIT repo. |
| B | **Motion Canvas** (TS, MIT) | Built for code explainers, with code animation included. Scenes are imperative generator code, so it needs a YAML-to-scene interpreter. Headless batch rendering is less polished and still runs through a browser. |
| C | **Custom Node renderer: `skia-canvas` + `roughjs`** | MIT throughout, no browser, deterministic (seeded roughjs), fast, raw frames piped to ffmpeg. Costs a small timeline/easing layer and has no studio (PNG previews instead). The drawing code can later run in a browser canvas, a path to in-page playback in TeachMe. |

An all-Python Skia renderer was dropped: it would mean reimplementing the sketch look, and
nothing could be reused in TeachMe.

**Chosen: C** (user decision). The reasons: licensing is clean for an MIT repo, it is light, it
matches TeachMe's Node/TS stack, and it leaves a path to reuse.

## 5. Architecture

```
vidgen/
  README.md  CLAUDE.md  setup.sh  Makefile  vidgen.example.toml
  pyproject.toml  uv.lock
  src/vidgen/
    cli.py            # typer entry point: build, tts, preview, render, lint, validate, publish
    schema.py         # pydantic models for script.yaml + friendly error formatting
    config.py         # vidgen.toml loading and defaults
    tts/engine.py     # TTSEngine protocol, pronunciation dictionary, cache
    tts/openai_http.py  # OpenAI-compatible /v1/audio/speech client (the v1 engine)
    align.py          # alignment endpoint client + mapping transcript words onto script words
    bakeoff.py        # `vidgen bakeoff`: run one passage against several configured endpoints
    timeline.py       # cue resolution, step timing, scene durations → timeline.json
    assemble.py       # concat, audio mux, loudnorm, music ducking, captions
    publish.py        # local and S3 targets
    manifest.py       # manifest.json read/write/verify
    cache.py          # content-hash cache keys and directories
  renderer/           # standalone Node/TS package, own package.json
    src/              # scene model, primitives, layout helpers, rough strokes, lint, encode, preview
    test/
  bakeoff/            # passage.md, run scripts, results.md (clips gitignored)
  examples/dns/script.yaml
  tests/              # pytest
  skill/vidgen-authoring/
    SKILL.md  reference/format.md  examples/
```

**Data flow for `vidgen build script.yaml`:**

1. **Parse and validate** `script.yaml` (§6). Errors name the scene id, step index and field.
2. **TTS** per scene, through the configured endpoint. The pronunciation dictionary is applied to a
   *spoken* copy of the text, and the original text is kept for captions. Cache key:
   hash(spoken text, endpoint name, model, voice, extra params, seed).
3. **Align** by sending the scene's audio to the alignment endpoint to get word timestamps. Then match
   the transcript words to the spoken text (a sequence alignment that tolerates ASR spelling
   differences), and map them back to the original words (the dictionary map tracks which spoken
   tokens came from which original token). Cached with the audio.
4. **Timeline** (Python): resolve each step's `at`, compute animation durations and the scene
   length, and write `timeline.json` (§7).
5. **Render** each scene: Python calls `node renderer/dist/cli.js render --scene <scene.json>
   --out <tmp>.mp4`. The scene JSON holds the resolved scene plus timeline plus style and resolution. The
   renderer draws each frame with skia-canvas and pipes raw RGBA to an ffmpeg child process.
   It writes to a temporary name and renames only when ffmpeg exits 0. Cache key: hash(resolved
   scene JSON, renderer version, resolution, fps, encoder settings).
6. **Lint** runs before rendering (§9). A failure stops the build.
7. **Assemble:** concat demuxer with `-c copy` over the scene MP4s, then build the narration track
   (per-scene WAVs, each padded to its scene length), two-pass `loudnorm` to about -16 LUFS,
   optional background music ducked under speech (`sidechaincompress`), and a mux with `-c:v copy`.
8. **Outputs** go in the build dir: `video.mp4`, `captions.srt`, `timeline.json`, `poster.png`
   (a frame from the densest moment), and optionally `video.burned.mp4` with burned-in captions.

**Other commands:** `vidgen tts` (steps 1–3), `vidgen preview --t 12.5 --t 30` (PNG frames at
whole-video times, without encoding), `vidgen render --scene 3` (one scene), `vidgen lint`,
`vidgen validate` (schema only, no endpoints), `vidgen publish` (§10), `vidgen bakeoff` (§8),
`vidgen doctor` (checks ffmpeg, encoders and that each configured endpoint answers).

**Build and cache location** (my call): by default, outside the repo, at
`~/.cache/vidgen/<slug>/`, so nothing lands in git by accident. `--out` overrides it. Configurable in
`vidgen.toml`.

**Script location:** vidgen accepts any path. The convention for TeachMe repos is
`.teachme/videos/<slug>/script.yaml` plus `manifest.json`. TeachMe's loader reads only
`courses/` and `quizzes/` (`server/content.js`), so this folder is ignored today and safe to add.

## 6. Script format

The prompt's sketch, made precise. `at` coordinates are in a 1920×1080 design space. Draft
mode (1280×720) scales them.

```yaml
title: How a DNS lookup works
slug: dns-lookup                 # optional; default from the folder or file name
voice: default
language: en
style: sketch-dark
seed: 7                          # optional; drives TTS and the rough wobble
syncedCommit: 3f2a9c1            # optional; the commit the script was grounded in (skill sets it)
sources: [src/resolver.ts]       # optional; files the video explains (used for staleness later)
pronunciations: {TTL: "T T L"}   # optional; merged over the global dictionary
scenes:
  - id: intro
    narration: "Before your browser can load a website, the name has to become an IP address."
    diagram:
      layout: {row: [browser, resolver, root]}     # optional auto-placement helper
      nodes:
        browser:  {label: Browser, sub: "own + OS cache", at: [170, 345]}
        resolver: {label: Recursive resolver, sub: "ISP / 8.8.8.8", at: [590, 345], size: [250, 330]}
        root:     {label: Root server, at: [1060, 150], hidden: true}
    steps:
      - at: "@cue:resolver"
        send: {from: browser, to: resolver, label: "example.com ?", kind: request}
        caption: "1  Browser and OS caches miss"
```

**Step timing (`at`)**, decided as my call:
- `scene_start`: time 0 of the scene.
- `+0.5`: 0.5 s after the previous step's animation *ends*.
- `@cue:word`: the start of the first spoken word matching `word` (case-insensitive, punctuation
  stripped) after the previous cue in this scene. `@cue:word#2` selects the 2nd occurrence counted
  from the scene start, ignoring the previous cue.
- Inline markers: narration may contain `{mark}` tokens, which are stripped before TTS.
  `@cue:mark` resolves to the start of the word that follows the marker. This is for cases where
  the right moment isn't a distinctive word.
- Any form may add an offset: `@cue:resolver+0.3`, `@cue:resolver-0.2`.
- An unresolvable cue is a validation error that names the scene and the cue.

**Step actions** (each step has one action plus an optional `caption`):
- `send: {from, to, label, kind}`: an arrow drawn in progressively with a moving dot. `kind` is
  `request` (pink), `reply` (gold) or `answer` (purple). Request and reply between the same pair get
  opposite perpendicular offsets so they don't overlap. Optional `duration`.
- `highlight: node` (optional `color`, `pulse`), `show: [nodes]`, `hide: [nodes]`.
- `badge: {text, near: node}`: the final result badge.
- `group: {nodes: [...], label, style: dashed}`: dashed grouping bracket.
- `text: {id, text, at, size}`: a simple text box.
- `code: {id, lang, text, at, size, typing: true, highlight_lines: [3,4]}`: a code or terminal block
  (`lang: shell` gets the terminal look), with an optional typing animation and line highlights.

`caption` sets the bottom caption line from that step onward. The persistent small title is
the script `title`. These on-screen captions are separate from the SRT subtitles, which follow the
narration.

**Layout helpers:** `layout: {row: [...]}` / `{column: [...]}` / `{grid: {cols: 3, nodes: [...]}}`
auto-place nodes that have no `at`. Arrows attach to box edges automatically, picking the facing
edges and adding the perpendicular pair offsets.

**Scene continuity** (my call): `diagram: {inherit: true, …}` starts the scene with the previous
scene's nodes, in their positions and their visibility at its end. Arrows, badges and text are
not carried over. Nodes listed in the scene override or add to the inherited ones. Without
`inherit`, a scene's diagram stands alone.

**Validation** uses pydantic. Unknown fields are errors (typos fail loudly). Node references in
steps must exist. The format is documented in `vidgen/skill/vidgen-authoring/reference/format.md`.

## 7. Timeline rules

- Narration time is fixed. Animations are placed on it, never the other way around.
- **Arrow duration** (my call): unless `duration` is set, it's the time until the next step starts,
  clamped to [0.6 s, 2.5 s], so arrows move at speaking pace. If the next step is itself relative
  (`+N`), that gap isn't known yet, so the arrow gets a fixed default of 1.2 s (configurable). Steps
  resolve in order in one pass, with no circular dependency.
- **Scene length** = max(narration end, last animation end) + 0.4 s pad.
- `timeline.json` records, per scene: audio file, duration, word timestamps, and each step's
  resolved start and duration. Captions and the renderer both read it.
- Pure functions, unit-tested (§12).

## 8. TTS

vidgen is an endpoint client. The user runs or points to the model servers (user decision).

**Endpoints** (my call on the protocol): v1 speaks the **OpenAI-compatible audio API**, which most
local TTS servers already expose (for example Kokoro-FastAPI, Chatterbox, Orpheus and vLLM-based
servers), and which remote providers also offer.

```toml
[tts]
endpoint = "local-chatterbox"          # which entry below to use

[tts.endpoints.local-chatterbox]
base_url = "http://127.0.0.1:8004/v1"
model = "chatterbox"
voice = "default"
api_key_env = ""                       # name of an env var; empty = no auth
timeout_s = 120
extra = { seed = 7, exaggeration = 0.5 }   # passed through in the request body
license = "MIT"                        # recorded in bake-off results and the manifest

[align]
endpoint = "local-whisper"

[align.endpoints.local-whisper]
base_url = "http://127.0.0.1:8000/v1"  # /audio/transcriptions with word timestamps
model = "large-v3"
```

- TTS: `POST {base_url}/audio/speech` with `{model, input, voice, response_format: "wav", …extra}`.
- Alignment: `POST {base_url}/audio/transcriptions` with `timestamp_granularities=["word"]` and
  `response_format=verbose_json` (served by faster-whisper/WhisperX-based servers such as
  speaches). vidgen maps the transcript onto the known script text (§5 step 3).
- `TTSEngine.synthesize(text, voice, seed) -> wav` stays the internal interface. The HTTP client is the
  v1 implementation, and an in-process engine can be added later without touching the pipeline.
- Retries with backoff, and a clear error naming the endpoint and scene when a server is down or returns
  non-audio. `vidgen doctor` checks every configured endpoint.
- Global pronunciation dictionary in `vidgen.toml`, plus per-script `pronunciations`. Matching is on
  whole tokens.
- Voice cloning and language are whatever the chosen endpoint supports, passed through
  `voice`, `language` and `extra`. English is required; Italian works if the chosen model does it.
- **CI:** a fake OpenAI-compatible server (a fixture that returns a tone WAV and synthetic word
  timestamps) lets the whole pipeline run end to end in CI with no GPU.

**Bake-off** (`vidgen bakeoff`, a stage in its own right, no longer a gate before everything else):
- It runs `vidgen/bakeoff/passage.md` (60–90 s of technical narration with DNS, TTL, TLD, nginx,
  `example.com`, IPv6 and 93.184.216.34) against every endpoint listed under `[bakeoff].endpoints`,
  once without the pronunciation dictionary and once with it.
- It writes clips to `vidgen/bakeoff/clips/` (gitignored) and `vidgen/bakeoff/results.md`: endpoint,
  model, license (from config), real-time factor measured by the client, alignment quality on the
  cue words, notes, and clip paths. VRAM is not visible to the client, so it's entered by hand if wanted.
- `vidgen/bakeoff/CANDIDATES.md` lists the candidates to stand up as servers (Chatterbox, Higgs Audio
  v2, VibeVoice, Fish Speech / OpenAudio, IndexTTS2, F5-TTS, Orpheus, Qwen-family TTS, with
  Kokoro as baseline). For each it notes license, languages, whether it has an OpenAI-compatible server and
  whether it runs on sm_120, as researched at build time. Standing the servers up is
  the user's job. The builder only documents it.
- The user listens and sets the chosen endpoint as the default in `vidgen.toml`.

## 9. Renderer and linter

- **Look** (`style: sketch-dark`): dark background, faint seeded star dots, rough.js boxes and
  arrows, window-style boxes (title bar plus two dots). Colors as theme tokens: teal outlines, pink
  request, gold reply, purple answer. Handwriting font (Excalifont, else Caveat), Inter fallback.
  Persistent small title, caption line at the bottom.
- **Determinism:** the roughjs seed is derived from (script seed, scene id, element id), so editing one
  element doesn't re-wobble the others. No wall-clock or random calls anywhere.
- **Quality:** vector drawing at output resolution with Skia antialiasing. A configurable
  supersample factor; the builder sets the default after comparing edges in previews.
- **Encoding:** all scenes use identical size, fps, pixel format, GOP and encoder settings, so
  `-c copy` concat is safe. NVENC (`h264_nvenc`) is used if it matches or beats libx264 CRF 18. The builder
  measures this once with VMAF or SSIM on the example and records the result and the chosen settings
  in `README.md`. libx264 is the fallback when NVENC is unavailable.
- **Performance:** one scene renders in under a minute at 1080p30.
- **Linter** (in the renderer, because it owns font metrics and geometry): it samples each scene
  every 0.25 s and at every step's settled state. It checks label/label overlap,
  label/line overlap (arrow paths against other labels, excluding the arrow's own label), and text
  overflowing its box or the frame. Failures print the scene id, the time and the elements involved,
  and the command exits non-zero. Python runs it via `node renderer/dist/cli.js lint`.

## 10. Publishing and the manifest

`vidgen publish script.yaml [--target name]` uploads the latest build and writes
`manifest.json` next to the script. Targets are defined in `vidgen.toml`:

```toml
[publish.targets.nas]
type = "local"
path = "/mnt/nas/vidgen"
public_base_url = "http://nas.local/vidgen"   # optional

[publish.targets.s3]
type = "s3"
bucket = "my-videos"
prefix = "teachme"
region = "eu-west-1"
endpoint_url = ""                             # optional: MinIO / R2 / Backblaze
public_base_url = "https://cdn.example.com/teachme"   # optional
```

- Object layout: `<prefix>/<slug>/<sha256[:12]>/{video.mp4,captions.srt,poster.png}`.
  Content-addressed, so old manifests keep working and a new build never overwrites a file in use.
- S3 credentials come from the standard AWS chain (env vars or profile) via boto3. They are never
  read from or written to the repo.
- Publishing an unchanged build is a no-op (the object already exists).
- Manifest (my call; TeachMe will read it later):

```json
{
  "version": 1,
  "slug": "dns-lookup",
  "title": "How a DNS lookup works",
  "scriptHash": "sha256:…",
  "syncedCommit": "3f2a9c1",
  "sources": ["src/resolver.ts"],
  "durationSec": 52.4,
  "resolution": [1920, 1080],
  "language": "en",
  "tts": {"engine": "…", "model": "…", "voice": "default"},
  "vidgenVersion": "0.1.0",
  "publishedAt": "2026-11-17T10:00:00Z",
  "target": "s3",
  "files": {
    "video":    {"location": "s3://my-videos/teachme/dns-lookup/ab12cd34ef56/video.mp4",
                 "url": "https://cdn.example.com/teachme/dns-lookup/ab12cd34ef56/video.mp4",
                 "sha256": "…", "bytes": 8123456},
    "captions": {"location": "…", "url": "…", "sha256": "…", "bytes": 2048},
    "poster":   {"location": "…", "url": "…", "sha256": "…", "bytes": 90000}
  }
}
```

  `url` is present only when `public_base_url` is set. For a private bucket, the TeachMe integration
  can presign from `location` when it serves the page. Presigned URLs are never committed, because they expire.
- `vidgen validate` reports when `scriptHash` no longer matches the script, meaning the published video
  is out of date and needs a rebuild and republish.

## 11. Setup and config

- `vidgen/setup.sh` (wrapped by `make setup`) installs uv if missing, runs `uv sync`, and installs
  renderer deps and builds it. It checks for an ffmpeg with `h264_nvenc` and `loudnorm`. If none is found, it downloads a pinned
  static Linux build into `~/.cache/vidgen/bin/` without sudo (my call). It also fetches fonts. It downloads no
  models. It is idempotent and prints what it did, then runs `vidgen doctor`.
- **Installing the CLI for use from other repos** (my call): setup runs `uv tool install --editable ./vidgen`, which puts
  `vidgen` on `PATH`. The renderer is found next to the package source (`vidgen/renderer/`, holding
  `dist/` and `node_modules/` from setup), or at `paths.renderer` in config. It isn't bundled,
  because skia-canvas is a native addon. Node 20+ is a runtime requirement that `vidgen doctor` checks.
- `vidgen.toml` (searched in the script's folder, then the repo root, then `~/.config/vidgen/`) holds resolution,
  fps, draft mode, TTS and alignment endpoints, the pronunciation dictionary, paths (cache,
  ffmpeg), encoder settings and publish targets. `vidgen.example.toml` is committed, with a local
  endpoint example and a commented remote one.

## 12. Testing

- **pytest (CPU, runs in CI):** schema validation and error messages, cue resolution (occurrences,
  markers, offsets, errors), timeline computation (durations, clamps, padding), manifest
  round-trip, publish to a local temp target, and cache-key stability.
- **vitest in `vidgen/renderer` (CPU, runs in CI):** layout helpers, edge attachment and pair
  offsets, and the linter (fixtures with known overlaps and overflows, each expected to fail at a
  known time).
- **Golden frame (CPU, runs in CI):** render one example scene at a fixed time and compare it to a committed
  PNG within a small pixel tolerance. Fonts are bundled so the output is stable.
- **Full pipeline against the fake endpoint (CPU, runs in CI):** build the DNS example with the fake
  TTS and alignment server and libx264. Check the outputs exist, scene concat succeeds, the duration matches
  `timeline.json`, and loudness is about -16 LUFS.
- **Local-only (marked `@pytest.mark.endpoint`, skipped in CI):** the same build against the real
  configured endpoints, and the NVENC comparison.
- **CI:** a separate `vidgen` job in `.github/workflows/ci.yml` (or its own workflow) running the
  CPU suites. The existing TeachMe jobs stay untouched.

## 13. Skill: `vidgen-authoring`

At `vidgen/skill/vidgen-authoring/` (`SKILL.md`, `reference/format.md`, `examples/`), modeled on
`teachme-authoring`. It is installed the same way, by symlinking it into a skills folder.

- **When to use:** asked for a video or animated explainer of a flow, or while writing a TeachMe
  course where an ordered interaction between three or more parts is hard to follow in prose.
  It should also say when *not* to make a video: a static Mermaid diagram is enough.
- **Core rule:** read the code first. Every node, arrow and label must match real code at
  `syncedCommit`, and `sources` lists the files it relies on.
- **Create workflow:** pick the flow → draft narration (short sentences, about 150 wpm, one idea per scene)
  → diagram and steps cued to narration words → `vidgen validate` → `vidgen lint` →
  `vidgen preview` at the densest moments and *look at the PNGs* → `vidgen build` → spot-check →
  `vidgen publish` → commit the script and manifest (never the MP4).
- **Update workflow:** when `git log <syncedCommit>.. -- <sources>` shows changes, re-read
  the code, edit the affected scenes, rebuild (only changed scenes re-render), republish and bump `syncedCommit`.
- **Pronunciation:** add acronyms and hostnames to `pronunciations` and listen to the TTS of new terms.
- **Working rule from the prompt:** aim for one full render per change, and re-render only the changed scene.

## 14. Later: TeachMe integration and next shapes (out of scope)

**Integration** (separate future spec): an embed syntax in course Markdown that references a
video slug, `teachme validate` checking manifests, `teachme status` reporting stale videos from
`syncedCommit`/`sources`, the server presigning private-bucket URLs, and the course page showing a
poster and placeholder when a video isn't published. A possible later step is live in-page playback using
the same renderer drawing to a browser canvas.

**Next diagram shapes**, suggested for v2:
- call stack frames growing and shrinking
- data-structure changes (array or map cells, linked nodes, tree insertions)
- state machines with animated transitions
- code walkthroughs: line-by-line highlight synced to narration, with diff animation
- sequence-diagram lanes (lifelines with arrows), as an alternative layout for the current primitives

## 15. Delivery stages

**Versioning and process** (my call): vidgen gets its own release-please package, `vidgen/`,
with its own version (the source of `vidgenVersion`), tags and `vidgen/CHANGELOG.md`. The root `"."`
package excludes `vidgen/` (`exclude-paths`), so vidgen commits never bump the teachme npm version.
Commits use the `vidgen` scope (`feat(vidgen): …`). Work follows the repo's normal PR flow with
semantic PR titles. Each stage below is one PR (or a small group of PRs) into an integration
branch, and the integration branch goes to main by the existing gate. The plan decides the exact
branch layout.

Commit after each stage.

1. Script schema, parser, `vidgen validate`, and pytest.
2. Timeline and cue resolution, plus tests.
3. Renderer for one scene, preview PNGs, and the golden-frame test.
4. Full pipeline: endpoint clients (TTS and alignment), the fake endpoint fixture, per-scene render,
   assembly, loudness, captions, caching, and `vidgen doctor`.
5. Linter, plus its tests.
6. Publish (local and S3) and the manifest.
7. `vidgen bakeoff` and `bakeoff/CANDIDATES.md`. **Stop here** so the user can stand up candidate
   servers, listen, and pick the default endpoint.
8. `vidgen-authoring` skill.
9. README (install, endpoint setup, format reference, troubleshooting, encoder measurement),
   `vidgen/CLAUDE.md`, and the CI job.

## Delivery plans

- **A, core** (`docs/superpowers/plans/2026-11-17-vidgen-A-core.md`): repo plumbing (release-please
  split, coder brief), the Python package, config, script schema, narration parsing, cue
  resolution, timeline, and the scene-JSON contract the renderer consumes. Covers stages 1–2.
- **B, renderer** (`…-B-renderer.md`): the Node/TS renderer: look, layout, elements, encoding, preview
  frames, linter and golden frame. Covers stages 3 and 5. Starts once A's contracts are fixed.
- **C, pipeline** (`…-C-pipeline.md`): endpoint clients, the fake endpoint, alignment mapping, cache,
  build orchestration, assembly, captions, the CLI, doctor, setup and the CI job. Covers stage 4 and
  the CI part of 9.
- **D, publish and bake-off** (`…-D-publish-bakeoff.md`): manifest, local/S3 publish, the stale-build
  check, and `vidgen bakeoff` with its candidate list. Covers stages 6–7 and ends at the listening stop.
- **E, skill and docs** (`…-E-skill-docs.md`): the `vidgen-authoring` skill, the DNS example, README,
  `vidgen/CLAUDE.md` and the acceptance runs. Covers stages 8–9 and §16.

## 16. Acceptance

1. **DNS example**, end to end: "the path a DNS request takes from the browser until an IP is
   resolved". Scenes: intro; browser and OS cache miss; resolver asks root; asks the .com TLD;
   asks the authoritative server; the IP returns to the browser and is cached. About 45–60 s,
   narration in sync with the arrows, lint clean, loudness about -16 LUFS (measured with
   `ebur128`), published to a local target with a valid manifest. Run against the chosen real TTS
   endpoint (the same build passes in CI against the fake endpoint).
2. **Dogfood** (my call): an agent using the skill produces a short video about a real TeachMe
   flow (for example, how `teachme status` decides a lesson is stale), grounded in
   `server/status.js`, and it passes lint and builds.

## 17. Left to the builder

- NVENC vs libx264 settings (measured). The TTS default endpoint is the user's pick after the bake-off.
- The word-matching algorithm between the ASR transcript and the script text.
- Easing curves, exact geometry of the window boxes and dot animation, star density.
- Caption chunking rules for the SRT (line length, max duration).
- Music ducking parameters.
- Internal module boundaries inside `renderer/src` and the scene-JSON contract details, as long as
  §5's flow holds.
