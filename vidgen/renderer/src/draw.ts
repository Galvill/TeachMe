import { Path2D, type CanvasRenderingContext2D } from 'skia-canvas';
import type { BlockModel, CodeModel, Model, Pt, Rect, TextModel } from './model.js';
import { roughEllipse, roughLine, roughRect } from './rough.js';
import { badgeScale, captionAt, elementsAt, highlightAt, type ElementState } from './state.js';
import { font, kindColor, THEME } from './theme.js';

/**
 * Draws one frame of the `sketch-dark` look at scene-local time t, in the model's output px.
 * Pure function of (model, t): rough paths come from per-element seeds and nothing reads the
 * clock or `Math.random()`, so the same frame always gives the same pixels.
 */

const cache = new WeakMap<Model, Map<string, Path2D>>();

function cached(m: Model, key: string, make: () => Path2D): Path2D {
  let c = cache.get(m);
  if (!c) cache.set(m, (c = new Map()));
  let p = c.get(key);
  if (!p) c.set(key, (p = make()));
  return p;
}

function text(ctx: CanvasRenderingContext2D, t: TextModel, color: string, align: 'center' | 'left' = 'center'): void {
  ctx.font = font(t.px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const x = align === 'center' ? t.bbox.x + t.bbox.w / 2 : t.bbox.x;
  ctx.fillText(t.text, x, t.bbox.y + t.bbox.h / 2);
}

function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

function background(ctx: CanvasRenderingContext2D, m: Model): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.colors.bg;
  ctx.fillRect(0, 0, m.width, m.height);
  for (const s of m.stars) {
    ctx.globalAlpha = s.alpha;
    dot(ctx, s, s.r, THEME.colors.text);
  }
  ctx.globalAlpha = 1;
}

function drawGroup(ctx: CanvasRenderingContext2D, m: Model, e: ElementState, i: number): void {
  const g = m.groups[i]!;
  const s = m.scale;
  ctx.globalAlpha = e.alpha * 0.85;
  ctx.strokeStyle = THEME.colors.muted;
  ctx.lineWidth = 2 * s;
  ctx.setLineDash(g.dashed ? [12 * s, 9 * s] : []);
  roundRect(ctx, g.rect, THEME.group.radius * s);
  ctx.stroke();
  ctx.setLineDash([]);
  if (g.label) {
    ctx.globalAlpha = e.alpha;
    text(ctx, g.label, THEME.colors.muted, 'left');
  }
}

function arrowhead(m: Model, key: string, a: Pt, b: Pt, seed: number): Path2D[] {
  const len = THEME.send.head * m.scale;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  return [-1, 1].map((sgn, k) =>
    cached(m, `${key}:head${k}`, () => {
      const th = ang + Math.PI + sgn * 0.45;
      return roughLine(b.x, b.y, b.x + Math.cos(th) * len, b.y + Math.sin(th) * len, { seed: seed + k + 1, roughness: 0.6 });
    }),
  );
}

function drawSend(ctx: CanvasRenderingContext2D, m: Model, e: ElementState, i: number): void {
  const sd = m.sends[i]!;
  const p = e.progress;
  if (e.alpha <= 0 || p <= 0) return;
  const s = m.scale;
  const color = kindColor(sd.kind);
  const key = `send:${sd.index}`;
  const path = cached(m, key, () => roughLine(sd.a.x, sd.a.y, sd.b.x, sd.b.y, { seed: sd.seed }));
  ctx.globalAlpha = e.alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = THEME.stroke * s;
  if (p < 1) {
    // Reveal by dash length; each rough sub-stroke restarts the dash, so they grow together.
    const len = Math.hypot(sd.b.x - sd.a.x, sd.b.y - sd.a.y) * 1.02;
    ctx.setLineDash([len * p, len * 4 + 1000]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    const head = { x: sd.a.x + (sd.b.x - sd.a.x) * p, y: sd.a.y + (sd.b.y - sd.a.y) * p };
    dot(ctx, head, THEME.send.dot * s, color);
  } else {
    ctx.stroke(path);
    for (const h of arrowhead(m, key, sd.a, sd.b, sd.seed)) ctx.stroke(h);
  }
}

function drawNode(ctx: CanvasRenderingContext2D, m: Model, i: number, alpha: number, t: number): void {
  const n = m.nodes[i]!;
  if (alpha <= 0) return;
  const s = m.scale;
  const r = n.box;
  const hl = highlightAt(m, n.id, t);
  const outline = hl.color ?? THEME.colors.teal;

  if (hl.glow > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * hl.glow * 0.9;
    ctx.shadowColor = THEME.colors.reply;
    ctx.shadowBlur = 36 * s * hl.glow;
    ctx.strokeStyle = THEME.colors.reply;
    ctx.lineWidth = 6 * s;
    roundRect(ctx, r, 8 * s);
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = alpha * 0.92;
  ctx.fillStyle = THEME.colors.panel;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = outline;
  ctx.lineWidth = THEME.stroke * s;
  ctx.stroke(cached(m, `node:${n.id}`, () => roughRect(r.x, r.y, r.w, r.h, { seed: n.seed })));
  ctx.lineWidth = 1.8 * s;
  ctx.stroke(
    cached(m, `node:${n.id}:bar`, () =>
      roughLine(r.x, r.y + n.titleBar, r.x + r.w, r.y + n.titleBar, { seed: n.seed + 1, roughness: 0.8 }),
    ),
  );
  const cy = r.y + n.titleBar / 2;
  dot(ctx, { x: r.x + 18 * s, y: cy }, 5 * s, outline);
  dot(ctx, { x: r.x + 36 * s, y: cy }, 5 * s, THEME.colors.muted);

  text(ctx, n.label, THEME.colors.text);
  if (n.sub) text(ctx, n.sub, THEME.colors.muted);
}

function drawBadge(ctx: CanvasRenderingContext2D, m: Model, e: ElementState, i: number): void {
  const b = m.badges[i]!;
  if (e.alpha <= 0) return;
  const s = m.scale;
  const k = badgeScale(e.progress);
  const cx = b.rect.x + b.rect.w / 2;
  const cy = b.rect.y + b.rect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = e.alpha * 0.18;
  ctx.fillStyle = THEME.colors.answer;
  roundRect(ctx, b.rect, b.rect.h / 2);
  ctx.fill();
  ctx.globalAlpha = e.alpha;
  ctx.strokeStyle = THEME.colors.answer;
  ctx.lineWidth = THEME.stroke * s;
  ctx.stroke(
    cached(m, `badge:${b.index}`, () =>
      roughEllipse(cx, cy, b.rect.w + 10 * s, b.rect.h + 6 * s, { seed: b.seed, roughness: 0.9 }),
    ),
  );
  text(ctx, b.text, THEME.colors.answer);
  ctx.restore();
}

function lines(ctx: CanvasRenderingContext2D, b: BlockModel, top: number, x: number, align: 'center' | 'left', visible: number): void {
  ctx.font = font(b.px);
  ctx.fillStyle = THEME.colors.text;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  let left = visible;
  b.lines.forEach((line, k) => {
    if (left <= 0) return;
    const shown = line.slice(0, left);
    left -= line.length + 1;
    ctx.fillText(shown, x, top + b.lineHeight * (k + 0.5));
  });
}

function drawText(ctx: CanvasRenderingContext2D, m: Model, e: ElementState, i: number): void {
  const b = m.texts[i]!;
  if (e.alpha <= 0) return;
  ctx.globalAlpha = e.alpha;
  const top = b.rect.y + (b.rect.h - b.lines.length * b.lineHeight) / 2;
  lines(ctx, b, top, b.rect.x + b.rect.w / 2, 'center', Infinity);
}

function drawCode(ctx: CanvasRenderingContext2D, m: Model, e: ElementState, c: CodeModel): void {
  if (e.alpha <= 0) return;
  const s = m.scale;
  const r = c.rect;
  ctx.globalAlpha = e.alpha;
  ctx.fillStyle = THEME.colors.code;
  roundRect(ctx, r, 10 * s);
  ctx.fill();
  ctx.strokeStyle = THEME.colors.muted;
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  if (c.shell) {
    ctx.save();
    roundRect(ctx, r, 10 * s);
    ctx.clip();
    ctx.fillStyle = '#1f232a';
    ctx.fillRect(r.x, r.y, r.w, c.titleBar);
    ctx.restore();
    const cy = r.y + c.titleBar / 2;
    [THEME.colors.request, THEME.colors.reply, THEME.colors.teal].forEach((col, k) =>
      dot(ctx, { x: r.x + (18 + 18 * k) * s, y: cy }, 5 * s, col),
    );
  }
  const top = r.y + c.titleBar + c.pad;
  if (e.progress >= 1) {
    ctx.fillStyle = THEME.colors.reply;
    for (const ln of c.highlightLines) {
      if (ln < 1 || ln > c.lines.length) continue;
      ctx.globalAlpha = e.alpha * 0.16;
      ctx.fillRect(r.x + 4 * s, top + c.lineHeight * (ln - 1), r.w - 8 * s, c.lineHeight);
    }
    ctx.globalAlpha = e.alpha;
  }
  const total = c.lines.reduce((n, l) => n + l.length + 1, 0);
  const visible = c.typing ? Math.floor(e.progress * total) : total;
  lines(ctx, c, top, r.x + c.pad, 'left', visible);
}

export function drawFrame(ctx: CanvasRenderingContext2D, m: Model, t: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  background(ctx, m);

  const els = new Map(elementsAt(m, t).map((e) => [e.id, e]));
  const get = (id: string): ElementState | undefined => els.get(id);

  m.groups.forEach((g, i) => {
    const e = get(`group:${g.index}`);
    if (e && e.alpha > 0) drawGroup(ctx, m, e, i);
  });
  m.sends.forEach((sd, i) => {
    const e = get(`send:${sd.index}`);
    if (e) drawSend(ctx, m, e, i);
  });
  m.nodes.forEach((n, i) => drawNode(ctx, m, i, get(`node:${n.id}`)?.alpha ?? 0, t));
  for (const sd of m.sends) {
    const e = get(`send:${sd.index}:label`);
    if (sd.label && e && e.alpha > 0) {
      ctx.globalAlpha = e.alpha;
      text(ctx, sd.label, kindColor(sd.kind));
    }
  }
  m.badges.forEach((b, i) => {
    const e = get(`badge:${b.index}`);
    if (e) drawBadge(ctx, m, e, i);
  });
  m.texts.forEach((x, i) => {
    const e = get(`text:${x.id}`);
    if (e) drawText(ctx, m, e, i);
  });
  for (const c of m.codes) {
    const e = get(`code:${c.id}`);
    if (e) drawCode(ctx, m, e, c);
  }

  ctx.globalAlpha = 1;
  text(ctx, m.title, THEME.colors.muted, 'left');
  const cap = captionAt(m, t);
  if (cap.prev && cap.prevAlpha > 0) {
    ctx.globalAlpha = cap.prevAlpha;
    text(ctx, cap.prev.text, THEME.colors.text);
  }
  if (cap.cur && cap.curAlpha > 0) {
    ctx.globalAlpha = cap.curAlpha;
    text(ctx, cap.cur.text, THEME.colors.text);
  }
  ctx.restore();
}
