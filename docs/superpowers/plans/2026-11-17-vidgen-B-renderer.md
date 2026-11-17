# vidgen B: Renderer Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-17-vidgen-design.md`, sections 6 (actions, layout helpers), 9, 12 (renderer tests, golden frame).
**Goal:** `vidgen/renderer`, a Node/TS package whose CLI renders a scene JSON to MP4 (raw RGBA piped to ffmpeg), writes PNG frames at given times, and lints a scene for overlaps and overflow.
**Constraints:** the spec's `## Constraints` section applies. Additionally:
- The input is exactly Plan A Task 7's scene JSON (`version: 1`). The renderer never reads `script.yaml`.
- Dependencies: `roughjs`, `skia-canvas` (runtime); `typescript`, `vitest`, `@types/node` (dev). There's no browser and no DOM types.
- No `Math.random()` or `Date` anywhere in drawing code. All randomness comes from `seedFor`.
- `at` is a box **center** in 1920×1080 design space. All drawing scales design→output by `width/1920`.
**Verification:** from `vidgen/renderer/`: `npm ci && npm run typecheck && npm test && npm run build`. Encode tests need `ffmpeg` on `PATH` and skip without it.

## File structure

| File | Responsibility |
|---|---|
| `vidgen/renderer/package.json`, `tsconfig.json`, `vitest.config.ts` | private ESM package, `bin`-less, `dist/cli.js` |
| `vidgen/renderer/fonts/` | Excalifont, Inter TTFs and `OFL.txt` (committed) |
| `src/scene.ts` | `SceneInput` types, `parseScene` |
| `src/theme.ts` | `sketch-dark` tokens and sizes |
| `src/rough.ts` | seeded rough drawables → canvas paths |
| `src/layout.ts` | auto-placement, edge attachment, lanes |
| `src/model.ts` | `buildModel`: resolved geometry in output px |
| `src/state.ts` | `elementsAt(model, t)`: what is visible, how far along |
| `src/draw.ts` | `drawFrame` |
| `src/encode.ts` | ffmpeg pipe, temp-then-rename |
| `src/lint.ts` | `lintScene` |
| `src/cli.ts` | `render`, `frames`, `lint` subcommands |
| `test/fixtures/*.json`, `test/golden/intro-2.5.png` | scene inputs, golden frame |
| `test/*.test.ts` | tests per module |

### Task 1: Package, scene input, theme, fonts

**Files:**
- Create: `vidgen/renderer/{package.json,tsconfig.json,vitest.config.ts}`, `src/scene.ts`, `src/theme.ts`, `fonts/*`
- Test: `test/scene.test.ts`

**Interfaces:**
- Produces: `parseScene(json: unknown): SceneInput` (throws `InputError`), `THEME: Theme`, `registerFonts(): void`.

```ts
type Kind = 'request' | 'reply' | 'answer';
type NodeIn = { label: string; sub: string | null; at: [number, number] | null; size: [number, number] | null; hidden: boolean };
type StepIn = { index: number; start: number; duration: number; caption: string | null; action: Action } & Record<Action, unknown>;
type SceneInput = { version: 1; width: number; height: number; fps: number; design: [1920, 1080]; seed: number;
  style: 'sketch-dark'; title: string; scene: { id: string; duration: number; nodes: Record<string, NodeIn>;
  layout: Layout | null; steps: StepIn[] } };
```

**Behavior:**
- `version` other than 1, or a missing field, raises `InputError` with the JSON path.
- THEME: bg `#14161a`, teal `#3fb7a8`, request `#ff6fa5`, reply `#f2c14e`, answer `#a98bff`, text `#e8e6e3`, muted `#8a8f98`. Default node size is `[220, 140]`, the title-bar height is 34, the title band is y < 70 and the caption band is y > 970 (design px).
- `registerFonts` loads `fonts/` through `FontLibrary.use`. The family is `Excalifont`, with `Inter` as fallback.

**Tests:**
- `rejects wrong version`, `rejects missing field path`, `fonts registered` (`FontLibrary.has('Excalifont')`).

**Gotchas:**
- Commit the fonts. The golden frame depends on them, so setup must not fetch different versions.

### Task 2: Seeded rough strokes

**Files:**
- Create: `src/rough.ts`
- Test: `test/rough.test.ts`

**Interfaces:**
- Produces: `seedFor(seed: number, sceneId: string, elementId: string): number` (FNV-1a 32-bit, never 0), `roughRect(x,y,w,h, opts): Path2D`, `roughLine(x1,y1,x2,y2, opts): Path2D`, `roughEllipse(cx,cy,w,h, opts): Path2D`, with `opts = { seed: number; roughness?: number; bowing?: number }`.

**Behavior:**
- The same arguments give an identical `Path2D` SVG string. A different `elementId` gives a different path.
- `roughness` defaults to 1.2 and `bowing` to 1.

**Tests:**
- `same seed same path`, `element id changes path`, `seed never zero`.

**Gotchas:**
- Use `rough.generator()`, not `rough.canvas()` (which needs a DOM canvas). Map each drawable's `sets[].ops` (`move`, `bcurveTo`, `lineTo`) onto a skia-canvas `Path2D`.

### Task 3: Layout, edge attachment, lanes

**Files:**
- Create: `src/layout.ts`
- Test: `test/layout.test.ts`

**Interfaces:**
- Produces: `place(nodes: Record<string, NodeIn>, layout: Layout | null): Record<string, Box>`, `attach(a: Box, b: Box, laneOffset: number): { from: Pt; to: Pt }`, `lanes(steps: StepIn[]): Map<number, number>` (step index → offset px). `Box = { cx, cy, w, h }` in design px.

**Behavior:**
- `row` spreads the listed nodes evenly over x ∈ [160, 1760] at y 470. `column` spreads them over y ∈ [140, 900] at x 960. `grid{cols}` fills row-major in that area. A node with its own `at` keeps it.
- A node with no `at` that isn't in `layout` raises `InputError('node "x" has no position')`.
- `attach`: if |dx| ≥ |dy| it uses the left and right edges at center y, otherwise the top and bottom edges. The lane offset is applied perpendicular to the canonical pair direction (ids sorted), so lanes never flip with arrow direction.
- `lanes`: per unordered node pair, each distinct (direction, kind) gets a lane in order of first appearance. One lane gives 0, two give ±16, three give −24, 0 and +24.

**Tests:**
- `row spacing`, `explicit at wins`, `unplaced node error`, `attach horizontal`, `attach vertical`, `request reply lanes opposite`, `lanes stable across direction`.

### Task 4: Model and state over time

**Files:**
- Create: `src/model.ts`, `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: `place`, `attach`, `lanes`, `seedFor`, `THEME`.
- Produces: `buildModel(input: SceneInput): Model` (geometry in output px, text measured with the registered fonts), `elementsAt(m: Model, t: number): ElementState[]`.

```ts
type ElementState = { id: string;   // "node:browser", "node:browser:label", "send:3", "send:3:label", "badge:5", "caption", ...
  kind: 'node' | 'label' | 'line' | 'badge' | 'group' | 'text' | 'code' | 'caption' | 'title';
  alpha: number; progress: number; bbox: Rect | null; segment: [Pt, Pt] | null; owner: string | null };
```

**Behavior:**
- `hidden` nodes start at alpha 0. `show`/`hide` change alpha linearly over the step duration.
- `send` progress = easeInOutCubic((t−start)/duration), clamped to [0, 1]. The arrow stays at progress 1 until the scene ends. Its label's alpha ramps over progress 0.5→1, and it sits 18 px off the segment on its lane side.
- `badge` progress uses ease-out-back. `code` with `typing` progresses linearly. Everything else is linear.
- The caption is the latest step's `caption` with start ≤ t, crossfading over 0.2 s. The title is always visible.

**Tests:**
- `hidden node alpha 0 before show`, `send progress midpoint` (0.5 at start+duration/2), `label invisible before half`, `caption switches at step start`, `arrow persists`.

### Task 5: Drawing

**Files:**
- Create: `src/draw.ts`
- Test: `test/draw.test.ts`

**Interfaces:**
- Consumes: `elementsAt`, `roughRect`, `roughLine`, `roughEllipse`.
- Produces: `drawFrame(ctx: CanvasRenderingContext2D, m: Model, t: number): void`.

**Behavior:**
- Node: a window box with a rough teal outline, a title bar with two dots on the left, the label centred in the body and `sub` below it in muted color.
- `send`: the stroke is revealed by dash length, with a dot at the head while progress < 1 and an arrowhead at 1, colored by kind.
- `highlight` pulses a glow over its duration, then leaves the outline in reply color. `badge` is drawn 24 px below `near`, in answer color, scaled 0.6→1. `group` is a dashed rounded rect around the nodes' union, padded by 24, with its label at top-left.
- `code` is a dark panel, with a title bar for `lang: shell`. Typed characters follow progress, and `highlight_lines` bands appear after typing ends.
- Background: 120 seeded static stars at alpha 0.15–0.4.

**Tests:**
- `draw is deterministic` (two renders of one frame are byte-equal PNGs), `draft scales geometry` (a 1280×720 node sits at 2/3 of the 1920×1080 coordinates).

### Task 6: Encoding and CLI `render` / `frames`

**Files:**
- Create: `src/encode.ts`, `src/cli.ts`
- Test: `test/encode.test.ts`

**Interfaces:**
- Produces the CLI contract (consumed by Plan C):

```
node dist/cli.js render --scene <file.json> --out <file.mp4> --ffmpeg <path> --encoder '<json>' [--ssaa N]
node dist/cli.js frames --scene <file.json> --t <sec> [--t <sec>...] --out-dir <dir> [--ssaa N]
node dist/cli.js lint   --scene <file.json>
exit: 0 ok · 1 lint issues · 2 bad input · 3 ffmpeg failed
encoder json: { "args": ["-c:v","libx264","-crf","18","-preset","slow"] }
```

**Behavior:**
- `render` spawns `ffmpeg -y -f rawvideo -pix_fmt rgba -s WxH -r fps -i - -an <args> -pix_fmt yuv420p -g <fps> -movflags +faststart <out>.part.mp4`. It writes `round(duration·fps)` frames, then renames to `<out>` only when ffmpeg exits 0. Otherwise it deletes `.part.mp4`, prints the ffmpeg stderr tail and exits 3.
- Backpressure: it awaits `drain` before writing the next frame.
- `--ssaa N` draws at N× and downsamples into the output canvas with high-quality smoothing.
- `frames` writes `<out-dir>/<sceneId>-<t.toFixed(2)>.png`, with t in scene-local seconds, and prints each path on its own line.

**Tests:**
- `frame count matches duration` (ffprobe `nb_frames`), `failed ffmpeg leaves no output` (bad args → exit 3, with no `<out>` and no `.part.mp4`), `frames writes named pngs`.

### Task 7: Linter and CLI `lint`

**Files:**
- Create: `src/lint.ts`
- Modify: `src/cli.ts` (the `lint` subcommand)
- Test: `test/lint.test.ts`, `test/fixtures/lint-*.json`

**Interfaces:**
- Produces: `lintScene(m: Model): { issues: LintIssue[]; densest: { t: number; labels: number }[] }`.
- `LintIssue = { scene: string; t: number; kind: 'label-overlap' | 'label-line' | 'overflow' | 'zone'; elements: string[]; message: string }`.

**Behavior:**
- It samples every 0.25 s from 0 to `duration` plus each step's `start+duration`, and considers elements with alpha > 0.
- `label-overlap`: two label bboxes intersect by more than 4 px² (excluding a node's own label/sub pair).
- `label-line`: an arrow segment crosses a label bbox other than its own label.
- `overflow`: node label or sub wider than box width − 32, text or code lines exceeding their `size`, or any bbox leaving the frame.
- `zone`: a non-caption element enters the caption band, or a non-title element enters the title band.
- Each (kind, elements) pair is reported once, at its first t. `densest` holds the top 3 sample times by visible label count, at least 1 s apart.
- The CLI prints one JSON issue per line, then `{"densest":[…]}`, and exits 1 if there are any issues.

**Tests:**
- One fixture per kind, each asserting the kind, the elements and the first t. Also `clean fixture passes` and `densest spaced`.

### Task 8: Golden frame

**Files:**
- Create: `test/fixtures/intro.json` (1280×720, three nodes, two sends, a caption), `test/golden/intro-2.5.png`
- Test: `test/golden.test.ts`

**Behavior:**
- It renders t = 2.5 and compares it to the golden image. It passes if at most 0.5 % of pixels differ by more than 16 in any channel. `UPDATE_GOLDEN=1` rewrites the PNG.

**Tests:**
- `golden intro 2.5`.

**Gotchas:**
- A Skia or font upgrade can move pixels. Regenerate with `UPDATE_GOLDEN=1` in the same PR and look at the PNG before committing it.

## Coverage

Spec sections: 6 (actions, layout helpers, at semantics), 9 (look, determinism, quality, encoding contract, linter), 12 (renderer tests, golden frame).
