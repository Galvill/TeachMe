import { InputError, type Layout, type NodeIn, type StepIn } from './scene.js';
import { THEME } from './theme.js';

/** Everything here is in 1920x1080 design px. `Box` is centered: `cx, cy` is the `at` point. */
export type Pt = { x: number; y: number };
export type Box = { cx: number; cy: number; w: number; h: number };

const AREA = { x0: 160, x1: 1760, y0: 140, y1: 900 };
const ROW_Y = 470;
const COLUMN_X = 960;

/** Center of slot `i` of `n` equal slots spanning [a, b]. */
function slot(a: number, b: number, i: number, n: number): number {
  return a + ((b - a) * (i + 0.5)) / n;
}

function layoutPositions(layout: Layout | null): Map<string, [number, number]> {
  const pos = new Map<string, [number, number]>();
  if (!layout) return pos;
  if ('row' in layout) {
    layout.row.forEach((id, i) => pos.set(id, [slot(AREA.x0, AREA.x1, i, layout.row.length), ROW_Y]));
  } else if ('column' in layout) {
    layout.column.forEach((id, i) => pos.set(id, [COLUMN_X, slot(AREA.y0, AREA.y1, i, layout.column.length)]));
  } else {
    const { cols, nodes } = layout.grid;
    const rows = Math.max(1, Math.ceil(nodes.length / cols));
    nodes.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      pos.set(id, [slot(AREA.x0, AREA.x1, c, cols), slot(AREA.y0, AREA.y1, r, rows)]);
    });
  }
  return pos;
}

/**
 * Resolves every node to a box. A node's own `at` wins; otherwise `layout` places it:
 * `row` over x in [160, 1760] at y 470, `column` over y in [140, 900] at x 960, and
 * `grid` row-major over that area.
 */
export function place(nodes: Record<string, NodeIn>, layout: Layout | null): Record<string, Box> {
  const auto = layoutPositions(layout);
  for (const id of auto.keys()) {
    if (!(id in nodes)) throw new InputError(`layout names unknown node "${id}"`, 'scene.layout');
  }
  const out: Record<string, Box> = {};
  for (const [id, n] of Object.entries(nodes)) {
    const at = n.at ?? auto.get(id);
    if (!at) throw new InputError(`node "${id}" has no position`);
    const [w, h] = n.size ?? THEME.node.size;
    out[id] = { cx: at[0], cy: at[1], w, h };
  }
  return out;
}

/** True when an arrow between these boxes uses the left/right edges (|dx| >= |dy|). */
export function horizontal(a: Box, b: Box): boolean {
  return Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
}

/**
 * Edge points for an arrow from `a` to `b`: facing left/right edges at center y when
 * |dx| >= |dy|, otherwise facing top/bottom edges at center x. The lane offset shifts both
 * points along the fixed perpendicular axis (+y for horizontal, +x for vertical), which does not
 * depend on arrow direction, so a lane keeps its side when the arrow is reversed.
 */
export function attach(a: Box, b: Box, laneOffset: number): { from: Pt; to: Pt } {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (horizontal(a, b)) {
    const s = dx >= 0 ? 1 : -1;
    return {
      from: { x: a.cx + (s * a.w) / 2, y: a.cy + laneOffset },
      to: { x: b.cx - (s * b.w) / 2, y: b.cy + laneOffset },
    };
  }
  const s = dy >= 0 ? 1 : -1;
  return {
    from: { x: a.cx + laneOffset, y: a.cy + (s * a.h) / 2 },
    to: { x: b.cx + laneOffset, y: b.cy - (s * b.h) / 2 },
  };
}

/** Lane offsets for `n` lanes: 0; -16, +16; -24, 0, +24; then 24 px apart, centered. */
function laneOffsets(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-16, 16];
  return Array.from({ length: n }, (_, i) => 24 * (i - (n - 1) / 2));
}

/**
 * Lane offset (design px) per `send` step index. Per unordered node pair, each distinct
 * (direction, kind) gets a lane in order of first appearance. Direction is relative to the
 * canonical pair (ids sorted), so the same arrow always lands in the same lane.
 */
export function lanes(steps: StepIn[]): Map<number, number> {
  const pairs = new Map<string, { keys: string[]; steps: [number, string][] }>();
  for (const s of steps) {
    if (s.action !== 'send') continue;
    const { from, to, kind } = s.send;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const pairKey = JSON.stringify([lo, hi]);
    const laneKey = `${from === lo ? 'fwd' : 'rev'}:${kind}`;
    let p = pairs.get(pairKey);
    if (!p) pairs.set(pairKey, (p = { keys: [], steps: [] }));
    if (!p.keys.includes(laneKey)) p.keys.push(laneKey);
    p.steps.push([s.index, laneKey]);
  }
  const out = new Map<number, number>();
  for (const p of pairs.values()) {
    const offs = laneOffsets(p.keys.length);
    for (const [index, key] of p.steps) out.set(index, offs[p.keys.indexOf(key)] ?? 0);
  }
  return out;
}
