import type { BlockModel, Model, Pt, Rect } from './model.js';
import { elementsAt } from './state.js';

/**
 * Lints a scene for layout problems the author can't see without rendering: overlapping labels,
 * arrows through labels, text overflowing its box or the frame, and elements in the title or
 * caption bands. Geometry and font metrics come from the same model the renderer draws.
 */

export type LintKind = 'label-overlap' | 'label-line' | 'overflow' | 'zone';
export type LintIssue = { scene: string; t: number; kind: LintKind; elements: string[]; message: string };
export type LintResult = { issues: LintIssue[]; densest: { t: number; labels: number }[] };

export const SAMPLE_STEP = 0.25;
/** Overlap below this many px² is anti-aliasing noise, not a collision. */
const MIN_OVERLAP = 4;
/** Node labels need this much horizontal room inside the box (design px). */
const LABEL_MARGIN = 32;

function round(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Every 0.25 s from 0 to the scene end, plus each step's settled time (start + duration). */
export function sampleTimes(m: Model): number[] {
  const ts = new Set<number>();
  for (let k = 0; k * SAMPLE_STEP <= m.duration + 1e-9; k++) ts.add(round(k * SAMPLE_STEP));
  for (const e of m.stepEnds) if (e <= m.duration + 1e-9) ts.add(round(e));
  return [...ts].sort((a, b) => a - b);
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Liang-Barsky: does segment p-q pass through the interior of r (shrunk by 1 px)? */
function segmentHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  const x0 = r.x + 1;
  const y0 = r.y + 1;
  const x1 = r.x + r.w - 1;
  const y1 = r.y + r.h - 1;
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let lo = 0;
  let hi = 1;
  const edges: [number, number][] = [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const u = qk / pk;
    if (pk < 0) lo = Math.max(lo, u);
    else hi = Math.min(hi, u);
    if (lo > hi) return false;
  }
  return true;
}

function px(n: number): string {
  return `${Math.round(n)} px`;
}

export function lintScene(m: Model): LintResult {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const report = (t: number, kind: LintKind, elements: string[], message: string): void => {
    const key = `${kind}|${elements.join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ scene: m.sceneId, t, kind, elements, message });
  };

  const textBlocks = new Map<string, BlockModel>([
    ...m.texts.map((b): [string, BlockModel] => [`text:${b.id}`, b]),
    ...m.codes.map((b): [string, BlockModel] => [`code:${b.id}`, b]),
  ]);
  const samples: { t: number; labels: number }[] = [];
  const margin = LABEL_MARGIN * m.scale;

  for (const t of sampleTimes(m)) {
    const visible = elementsAt(m, t).filter((e) => e.alpha > 0);
    const byId = new Map(visible.map((e) => [e.id, e]));
    const labels = visible.filter((e) => e.kind === 'label' && e.bbox);
    samples.push({ t, labels: labels.length });

    // label-overlap
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        if (a.owner !== null && a.owner === b.owner && a.owner.startsWith('node:')) continue;
        const area = overlapArea(a.bbox!, b.bbox!);
        if (area > MIN_OVERLAP) {
          const els = [a.id, b.id].sort();
          report(t, 'label-overlap', els, `"${els[0]}" and "${els[1]}" overlap by ${Math.round(area)} px²`);
        }
      }
    }

    // label-line
    for (const line of visible) {
      if (line.kind !== 'line' || !line.segment) continue;
      for (const l of labels) {
        if (l.owner === line.id) continue;
        if (segmentHitsRect(line.segment[0], line.segment[1], l.bbox!)) {
          report(t, 'label-line', [line.id, l.id], `arrow "${line.id}" crosses label "${l.id}"`);
        }
      }
    }

    // overflow
    for (const e of visible) {
      if (!e.bbox) continue;
      const b = e.bbox;
      if (e.kind === 'label' && e.owner?.startsWith('node:')) {
        const box = byId.get(e.owner)?.bbox;
        if (box && b.w > box.w - margin) {
          report(t, 'overflow', [e.id], `"${e.id}" is ${px(b.w)} wide; "${e.owner}" fits ${px(box.w - margin)}`);
        }
      }
      const blk = textBlocks.get(e.id);
      if (blk && blk.fixed) {
        const room = blk.rect.w - 2 * blk.pad;
        const k = blk.lineWidths.findIndex((w) => w > room);
        const tall = blk.lines.length * blk.lineHeight + 2 * blk.pad + blk.titleBar;
        if (k >= 0) {
          report(t, 'overflow', [e.id], `"${e.id}" line ${k + 1} is ${px(blk.lineWidths[k]!)} wide; its size fits ${px(room)}`);
        } else if (tall > blk.rect.h + 0.5) {
          report(t, 'overflow', [e.id], `"${e.id}" needs ${px(tall)} of height; its size is ${px(blk.rect.h)}`);
        }
      }
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > m.width + 0.5 || b.y + b.h > m.height + 0.5) {
        report(t, 'overflow', [e.id], `"${e.id}" leaves the ${m.width}x${m.height} frame`);
      }
    }

    // zone
    for (const e of visible) {
      if (!e.bbox) continue;
      if (e.kind !== 'caption' && e.bbox.y + e.bbox.h > m.bands.caption) {
        report(t, 'zone', [e.id], `"${e.id}" enters the caption band (y > ${px(m.bands.caption)})`);
      }
      if (e.kind !== 'title' && e.bbox.y < m.bands.title) {
        report(t, 'zone', [e.id], `"${e.id}" enters the title band (y < ${px(m.bands.title)})`);
      }
    }
  }

  return { issues, densest: densest(samples) };
}

/** The 3 sample times with the most visible labels, at least 1 s apart. */
function densest(samples: { t: number; labels: number }[]): { t: number; labels: number }[] {
  const ranked = [...samples].sort((a, b) => b.labels - a.labels || a.t - b.t);
  const out: { t: number; labels: number }[] = [];
  for (const s of ranked) {
    if (out.length === 3) break;
    if (out.every((o) => Math.abs(o.t - s.t) >= 1 - 1e-9)) out.push(s);
  }
  return out;
}

