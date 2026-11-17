# vidgen renderer

Renders one vidgen scene JSON (the `version: 1` contract written by vidgen core) to MP4 or PNG
frames in the `sketch-dark` look, and lints a scene for overlaps and overflow. It never reads
`script.yaml`. Node 20+, runtime deps `roughjs` and `skia-canvas` only.

```
npm ci && npm run build
node dist/cli.js render --scene <file.json> --out <file.mp4> --ffmpeg <path> --encoder '<json>' [--ssaa N]
node dist/cli.js frames --scene <file.json> --t <sec> [--t <sec>...] --out-dir <dir> [--ssaa N]
node dist/cli.js lint   --scene <file.json>
exit: 0 ok · 1 lint issues · 2 bad input · 3 ffmpeg failed
encoder json: { "args": ["-c:v","libx264","-crf","18","-preset","slow"] }
```

- `render` pipes `round(duration * fps)` raw RGBA frames into ffmpeg, writing `<out>.part.mp4`
  (`intro.mp4` writes `intro.part.mp4`), and renames it to `<out>` only when ffmpeg exits 0.
  On failure it deletes the part file, prints the ffmpeg stderr tail and exits 3.
- `frames` writes `<out-dir>/<sceneId>-<t.toFixed(2)>.png` (t in scene-local seconds) and prints
  each path on its own line.
- `lint` prints one JSON issue per line (`label-overlap`, `label-line`, `overflow`, `zone`), then
  `{"densest":[...]}`, and exits 1 if there is any issue.
- `--ssaa N` draws each frame at N x and downsamples it with high-quality smoothing.

`at` is a box center in 1920x1080 design space (for nodes, text and code blocks); everything is
scaled to the output size by `width / 1920`. All wobble comes from seeds derived from
(script seed, scene id, element id), so renders are deterministic.

## Tests

`npm test` runs vitest. The real-ffmpeg encode tests need `ffmpeg` and `ffprobe` on `PATH` and
skip without them; a fake ffmpeg covers the pipe, rename and cleanup paths everywhere else.

The golden frame `test/golden/intro-2.5.png` is `test/fixtures/intro.json` at t = 2.5. It passes
when at most 0.5 % of pixels differ by more than 16 in any channel. After a Skia, font or
drawing change, regenerate it with `UPDATE_GOLDEN=1 npm test` and look at the PNG before
committing it. The fonts in `fonts/` are committed; see `fonts/README.md`.
