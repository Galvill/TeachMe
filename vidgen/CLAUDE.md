# vidgen conventions

vidgen is a Python CLI plus a Node renderer in `renderer/`. It has its own toolchain and is
released separately from the root TeachMe package.

- **Renderer only through its CLI contract.** Python calls `node renderer/dist/cli.js` with a
  `version: 1` scene JSON (`render`, `frames`, `lint`); see `renderer/README.md`. Never import
  renderer code or reach into its internals, and change the JSON contract on both sides together.
- **No randomness outside `seedFor`.** Every wobble and any random-looking placement comes from
  `seedFor(seed, sceneId, elementId)` in `renderer/src/rough.ts`. No `Math.random`, no clock, so the
  same script renders the same pixels and the cache stays valid.
- **Frame-aligned durations.** Scene durations round up to whole frames and offsets stay on whole
  frames (`timeline.py`). Don't introduce a duration or offset that isn't a multiple of `1/fps`.
- **Commit scope.** Title commits and PRs `feat(vidgen):`, `fix(vidgen):` and so on
  (`chore(vidgen):` for unseen work). release-please attributes by file path, so a vidgen commit
  must touch only `vidgen/`, or the root teachme package is bumped too.
- **Golden frame.** `renderer/test/golden.test.ts` compares a render with a committed PNG. Regenerate
  it only with `UPDATE_GOLDEN=1 npm test` in `renderer/`, and look at the new PNG before committing.
- **Never commit video.** Scripts and manifests only.

## Verification

Run the lines that match what you touched. The root suite still has to pass; nothing under `vidgen/`
changes it.

- Core (Python), from `vidgen/`: `uv sync && uv run pytest -m "not endpoint"`.
- Renderer, from `vidgen/renderer/`: `npm ci && npm run typecheck && npm test && npm run build`.
  Encode tests need `ffmpeg` on `PATH` and skip without it.
- Pipeline: the core line, after `npm ci && npm run build` in `vidgen/renderer/`, with `ffmpeg` on
  `PATH`. Tests that need the renderer skip only when `dist/cli.js` is missing, and CI always builds it.
- `make test` runs the renderer typecheck and tests, then pytest, from `vidgen/`.
- Tests marked `endpoint` need real endpoints and are never run in CI.
