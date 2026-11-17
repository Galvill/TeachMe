# vidgen D: Publish and Bake-off Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-17-vidgen-design.md`, sections 8 (bake-off), 10.
**Goal:** `vidgen publish` uploads a finished build to a local path or S3 and writes a committed manifest, `vidgen validate` flags out-of-date manifests, and `vidgen bakeoff` produces clips and a results table for the user's listening pick.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- Plans A–C are merged. Publish reads only the build dir's `build.json` (Plan C Task 7) and never re-runs the pipeline.
- New runtime dep: `boto3`. New dev dep: `moto[s3]`. S3 tests never touch the network.
**Verification:** Plan C's line.

## File structure

| File | Responsibility |
|---|---|
| `vidgen/src/vidgen/manifest.py` | manifest model, path rule, read/write, staleness |
| `vidgen/src/vidgen/publish.py` | `LocalPublisher`, `S3Publisher`, `publish` |
| `vidgen/src/vidgen/align.py` | add `matched_tokens` |
| `vidgen/src/vidgen/bakeoff.py` | run a passage against endpoints, write results |
| `vidgen/src/vidgen/cli.py` | `publish`, `bakeoff`; staleness note in `validate` |
| `vidgen/bakeoff/passage.md` | the bake-off narration, its dictionary and cue words |
| `vidgen/bakeoff/CANDIDATES.md` | researched TTS candidates and how to serve each |
| `vidgen/tests/test_manifest.py`, `test_publish.py`, `test_bakeoff.py` | tests |

### Task 1: Manifest

**Files:**
- Create: `vidgen/src/vidgen/manifest.py`
- Modify: `vidgen/src/vidgen/cli.py` (`validate`)
- Test: `vidgen/tests/test_manifest.py`

**Interfaces:**
- Consumes: `script_hash(s: Script) -> str` (Plan A Task 4).
- Produces: `manifest_path(script_path: Path) -> Path`, `Manifest` (pydantic, the spec §10 shape, `version: 1`), `FileRef(location: str, url: str | None, sha256: str, bytes: int)`, `read_manifest(p: Path) -> Manifest | None`, `write_manifest(p: Path, m: Manifest) -> None`, `is_stale(m: Manifest, s: Script) -> bool`.

**Behavior:**
- `manifest_path` gives `<dir>/manifest.json` for `script.yaml`, and `<dir>/<stem>.manifest.json` otherwise.
- Manifests are written with sorted keys, 2-space indent and a trailing newline. A rewrite with no changes leaves the file byte-identical.
- `vidgen validate` with a stale manifest prints `warn: manifest is out of date (script changed since publish)` and still exits 0. With `--strict` it exits 1.

**Tests:**
- `test_path_rule`, `test_roundtrip_byte_stable`, `test_stale_detected`, `test_validate_strict_exit`.

### Task 2: Publishers

**Files:**
- Create: `vidgen/src/vidgen/publish.py`
- Test: `vidgen/tests/test_publish.py`

**Interfaces:**
- Consumes: `LocalTarget`, `S3Target` (Plan A Task 2), `build.json` (Plan C Task 7).
- Produces: `publish(script_path: Path, cfg, target: str | None = None, build_dir: Path | None = None) -> Manifest`, `class PublishError(Exception)`.

**Behavior:**
- The object directory is `<prefix>/<slug>/<sha256(video)[:12]>/`, holding `video.mp4`, `captions.srt` and `poster.png`.
- Local target: files are copied to `<path>/<objdir>/` with `location = file://<abs path>`.
- S3 target: `boto3.client("s3", region_name=…, endpoint_url=…)` with `ContentType` set (`video/mp4`, `application/x-subrip`, `image/png`) and metadata `sha256`. The location is `s3://bucket/<objdir>/…`. An existing key with matching `sha256` metadata is skipped.
- `url = public_base_url.rstrip("/") + "/" + <objdir>/<file>` when `public_base_url` is set, otherwise `null`.
- Target resolution: the `--target` name, then `publish.default`. If neither is set, it raises `PublishError("no publish target; set publish.default or pass --target")`.
- It refuses, with `PublishError`, when:
  - there is no `build.json` (`no build for <slug>; run vidgen build`);
  - `draft: true` (`draft build; rebuild without --draft`);
  - `scriptHash` differs from the current script (`build is out of date; run vidgen build`).

**Tests:**
- `test_local_publish_layout`, `test_local_public_url`, `test_s3_upload_metadata` (moto), `test_s3_skip_existing`, `test_s3_endpoint_url_passed`, `test_refuse_draft`, `test_refuse_out_of_date`, `test_no_target`.

**Gotchas:**
- Under moto, set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to dummies in the test env, or boto3 picks up the developer's real profile.

### Task 3: `vidgen publish` command

**Files:**
- Modify: `vidgen/src/vidgen/cli.py`
- Test: `vidgen/tests/test_publish.py`

**Behavior:**
- `vidgen publish <script> [--target name] [--build-dir dir]` publishes and writes the manifest via `manifest_path`, then prints `published <slug> → <video url or location>` and exits 0.
- A `PublishError` prints its message and exits 1. A boto3 `ClientError` or `NoCredentialsError` exits 2 with `s3: <code>: <message>`.
- Publishing the same build again changes nothing on disk: the manifest stays byte-identical except `publishedAt`. `publishedAt` is only updated when a file was actually uploaded or copied.

**Tests:**
- `test_cli_publish_local_writes_manifest`, `test_republish_noop`, `test_no_credentials_exit_2`.

### Task 4: `vidgen bakeoff`

**Files:**
- Create: `vidgen/src/vidgen/bakeoff.py`, `vidgen/bakeoff/passage.md`
- Modify: `vidgen/src/vidgen/align.py` (add `matched_tokens`), `vidgen/src/vidgen/cli.py`
- Test: `vidgen/tests/test_bakeoff.py`

**Interfaces:**
- Consumes: `engine_from_config`, `aligner_from_config`, `to_spoken`, `parse_narration`.
- Produces: `matched_tokens(asr: list[AsrWord], spoken: Spoken) -> list[bool]`, `run_bakeoff(cfg, passage: Path, endpoints: list[str], out: Path) -> list[Row]`, `Row(endpoint, model, license, rtf: float | None, cue_aligned: str, clips: list[Path], error: str | None)`.

**Behavior:**
- `passage.md` has YAML frontmatter `pronunciations:` and `cues:` (DNS, TTL, TLD, nginx, example.com, IPv6, 93.184.216.34), followed by 170–230 words of narration.
- For each endpoint, it writes `<out>/<endpoint>-raw.wav` (no dictionary) and `<out>/<endpoint>-dict.wav` (config plus passage dictionary). RTF is wall time divided by audio duration, using the dict clip.
- `cue_aligned` is `"k/n"` cue words whose tokens all matched, or `"n/a"` when no aligner is configured.
- An endpoint error fills `error` and the run continues.
- `vidgen bakeoff [--endpoints a,b] [--out dir]` defaults to `cfg.bakeoff.endpoints` and `vidgen/bakeoff/clips/`. It writes `vidgen/bakeoff/results.md`: Endpoint | Model | License | RTF | Cue words aligned | Clips | VRAM (blank, filled by hand) | Notes.

**Tests:**
- `test_bakeoff_two_endpoints` (two fake endpoints, 4 clips, 2 rows), `test_endpoint_error_row`, `test_results_table_columns`, `test_matched_tokens`.

### Task 5: Candidate list and the listening stop

**Files:**
- Create: `vidgen/bakeoff/CANDIDATES.md`

**Behavior:**
- One row per spec §8 candidate, with Kokoro marked as the baseline. Each row records:
  - version and date checked;
  - license, and whether generated audio may be redistributed;
  - EN/IT support;
  - an OpenAI-compatible server project and its start command;
  - sm_120/CUDA 12.8 notes;
  - cloning support.
- A short "how to run a bake-off" section: start the servers, add them under `[tts.endpoints]` and `bakeoff.endpoints`, run `vidgen bakeoff`, listen, and set `tts.endpoint`.

**Tests:**
- None (docs only).

**Gotchas:**
- Check each candidate's license and server project on the web at build time, and date each row. Model knowledge from memory is out of date.
- This PR ends the automated work for now. Its body must ask the user to run the bake-off and pick the endpoint. Plan E Task 5 waits for that pick.

## Coverage

Spec sections: 8 (bake-off), 10 (targets, object layout, manifest, stale check).
