import type { CaptionModel, Model, Pt, Rect } from './model.js';

/** What each element looks like at scene-local time t. The linter and `drawFrame` both read this. */
export type ElementState = {
  /** "node:browser", "node:browser:label", "node:browser:sub", "send:3", "send:3:label", "badge:5", "caption", ... */
  id: string;
  kind: 'node' | 'label' | 'line' | 'badge' | 'group' | 'text' | 'code' | 'caption' | 'title';
  alpha: number;
  progress: number;
  bbox: Rect | null;
  /** For lines: the revealed part of the arrow, from its tail to its moving head. */
  segment: [Pt, Pt] | null;
  /** The element this one belongs to: a label's node or arrow. */
  owner: string | null;
};

export const CAPTION_FADE = 0.2;

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear 0->1 over [start, start + duration]; a zero duration jumps at start. */
export function ramp(t: number, start: number, duration: number): number {
  if (t < start) return 0;
  if (duration <= 0 || t >= start + duration) return 1;
  return clamp01((t - start) / duration);
}

export function easeInOutCubic(x: number): number {
  const p = clamp01(x);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Overshoots slightly past 1 before settling, for the badge pop. */
export function easeOutBack(x: number): number {
  const p = clamp01(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

/** Node alpha: starts at 0 when `hidden`, then each show/hide fades linearly over its step. */
export function nodeAlpha(m: Model, id: string, t: number): number {
  const n = m.nodes.find((x) => x.id === id);
  return visibility(m, id, t, n && n.hidden ? 0 : 1);
}

/**
 * Show/hide factor for any target (a node id, or a text/code element id): starts at `initial`
 * and fades linearly toward 1 (show) or 0 (hide) over each step naming it.
 */
export function visibility(m: Model, id: string, t: number, initial = 1): number {
  let alpha = initial;
  for (const v of m.visibility) {
    if (!v.nodes.includes(id) || t < v.start) continue;
    const target = v.show ? 1 : 0;
    alpha = alpha + (target - alpha) * ramp(t, v.start, v.duration);
  }
  return alpha;
}

/**
 * Highlight state for a node or a text/code element id: `glow` pulses 0->1->0 over the step, and once a highlight has
 * started, `color` is the outline color it leaves behind (the latest highlight wins).
 */
export function highlightAt(m: Model, id: string, t: number): { glow: number; color: string | null } {
  let glow = 0;
  let color: string | null = null;
  for (const h of m.highlights) {
    if (h.node !== id || t < h.start) continue;
    color = h.color;
    const p = ramp(t, h.start, h.duration);
    if (h.pulse && p < 1) glow = Math.max(glow, Math.sin(Math.PI * p));
  }
  return { glow, color };
}

export function sendProgress(start: number, duration: number, t: number): number {
  return easeInOutCubic(ramp(t, start, duration));
}

/** The caption on screen at t and, during the 0.2 s crossfade, the one it replaces. */
export function captionAt(
  m: Model,
  t: number,
): { cur: CaptionModel | null; curAlpha: number; prev: CaptionModel | null; prevAlpha: number } {
  let i = -1;
  for (let k = 0; k < m.captions.length; k++) if (m.captions[k]!.start <= t) i = k;
  if (i < 0) return { cur: null, curAlpha: 0, prev: null, prevAlpha: 0 };
  const cur = m.captions[i]!;
  const curAlpha = ramp(t, cur.start, CAPTION_FADE);
  const prev = i > 0 && curAlpha < 1 ? m.captions[i - 1]! : null;
  return { cur, curAlpha, prev, prevAlpha: prev ? 1 - curAlpha : 0 };
}

function lerp(a: Pt, b: Pt, p: number): Pt {
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

function scaleRect(r: Rect, k: number): Rect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: cx - (r.w * k) / 2, y: cy - (r.h * k) / 2, w: r.w * k, h: r.h * k };
}

export function badgeScale(progress: number): number {
  return 0.6 + 0.4 * progress;
}

export function elementsAt(m: Model, t: number): ElementState[] {
  const out: ElementState[] = [];
  const el = (e: Partial<ElementState> & Pick<ElementState, 'id' | 'kind' | 'alpha'>): void => {
    out.push({ progress: 1, bbox: null, segment: null, owner: null, ...e });
  };

  el({ id: 'title', kind: 'title', alpha: 1, bbox: m.title.bbox });

  for (const n of m.nodes) {
    const id = `node:${n.id}`;
    const alpha = nodeAlpha(m, n.id, t);
    el({ id, kind: 'node', alpha, bbox: n.box });
    el({ id: `${id}:label`, kind: 'label', alpha, bbox: n.label.bbox, owner: id });
    if (n.sub) el({ id: `${id}:sub`, kind: 'label', alpha, bbox: n.sub.bbox, owner: id });
  }

  for (const g of m.groups) {
    const id = `group:${g.index}`;
    const p = ramp(t, g.start, g.duration);
    el({ id, kind: 'group', alpha: p, progress: p, bbox: g.rect });
    if (g.label) el({ id: `${id}:label`, kind: 'label', alpha: p, progress: p, bbox: g.label.bbox, owner: id });
  }

  for (const s of m.sends) {
    const id = `send:${s.index}`;
    const p = sendProgress(s.start, s.duration, t);
    el({ id, kind: 'line', alpha: t >= s.start ? 1 : 0, progress: p, segment: [s.a, lerp(s.a, s.b, p)] });
    if (s.label) {
      el({ id: `${id}:label`, kind: 'label', alpha: clamp01((p - 0.5) / 0.5), progress: p, bbox: s.label.bbox, owner: id });
    }
  }

  for (const b of m.badges) {
    const lin = ramp(t, b.start, b.duration);
    const p = easeOutBack(lin);
    el({ id: `badge:${b.index}`, kind: 'badge', alpha: lin, progress: p, bbox: scaleRect(b.rect, badgeScale(p)) });
  }

  for (const x of m.texts) {
    const p = ramp(t, x.start, x.duration);
    el({ id: `text:${x.id}`, kind: 'text', alpha: p * visibility(m, x.id, t), progress: p, bbox: x.rect });
  }

  for (const c of m.codes) {
    const p = ramp(t, c.start, c.duration);
    const alpha = (c.typing ? ramp(t, c.start, Math.min(0.25, c.duration)) : p) * visibility(m, c.id, t);
    el({ id: `code:${c.id}`, kind: 'code', alpha, progress: p, bbox: c.rect });
  }

  const cap = captionAt(m, t);
  if (cap.prev) el({ id: 'caption:prev', kind: 'caption', alpha: cap.prevAlpha, bbox: cap.prev.text.bbox });
  if (cap.cur) el({ id: 'caption', kind: 'caption', alpha: cap.curAlpha, progress: cap.curAlpha, bbox: cap.cur.text.bbox });

  return out;
}
