import rough from 'roughjs';
import { Path2D } from 'skia-canvas';

/**
 * Seeded rough.js strokes mapped onto skia-canvas paths. All wobble comes from `seedFor`, so a
 * shape's look depends only on (script seed, scene id, element id): editing one element never
 * re-wobbles another. Nothing here touches `Math.random()` or the clock.
 */

export type RoughOpts = { seed: number; roughness?: number; bowing?: number };

type Op = { op: 'move' | 'bcurveTo' | 'lineTo'; data: number[] };
type OpSet = { type: string; ops: Op[] };
type Generator = {
  rectangle(x: number, y: number, w: number, h: number, o: object): { sets: OpSet[] };
  line(x1: number, y1: number, x2: number, y2: number, o: object): { sets: OpSet[] };
  ellipse(cx: number, cy: number, w: number, h: number, o: object): { sets: OpSet[] };
};

// rough.js's types reference DOM canvas types; the generator itself is DOM-free.
const gen = (rough as unknown as { generator(): Generator }).generator();

/** FNV-1a 32-bit over UTF-8 `seed \0 sceneId \0 elementId`. Never 0, because rough.js treats 0 as "random". */
export function seedFor(seed: number, sceneId: string, elementId: string): number {
  const bytes = new TextEncoder().encode(`${seed}\u0000${sceneId}\u0000${elementId}`);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 1 : h;
}

function options(o: RoughOpts): object {
  if (!Number.isInteger(o.seed) || o.seed === 0) throw new Error('rough: seed must be a non-zero integer');
  return { seed: o.seed, roughness: o.roughness ?? 1.2, bowing: o.bowing ?? 1 };
}

function toPath(sets: OpSet[]): Path2D {
  const p = new Path2D();
  for (const set of sets) {
    if (set.type !== 'path') continue;
    for (const { op, data } of set.ops) {
      if (op === 'move') p.moveTo(data[0]!, data[1]!);
      else if (op === 'lineTo') p.lineTo(data[0]!, data[1]!);
      else p.bezierCurveTo(data[0]!, data[1]!, data[2]!, data[3]!, data[4]!, data[5]!);
    }
  }
  return p;
}

export function roughRect(x: number, y: number, w: number, h: number, opts: RoughOpts): Path2D {
  return toPath(gen.rectangle(x, y, w, h, options(opts)).sets);
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, opts: RoughOpts): Path2D {
  return toPath(gen.line(x1, y1, x2, y2, options(opts)).sets);
}

export function roughEllipse(cx: number, cy: number, w: number, h: number, opts: RoughOpts): Path2D {
  return toPath(gen.ellipse(cx, cy, w, h, options(opts)).sets);
}
