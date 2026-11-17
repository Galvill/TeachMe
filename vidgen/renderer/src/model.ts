import { Canvas, type CanvasRenderingContext2D } from 'skia-canvas';
import { attach, horizontal, lanes, place, type Box, type Pt } from './layout.js';
import { seedFor } from './rough.js';
import type { Kind, SceneInput } from './scene.js';
import { font, registerFonts, THEME } from './theme.js';

/**
 * The resolved scene: every position and size in OUTPUT px (design px x `scale`), every text
 * measured with the bundled fonts, and every rough seed derived. `elementsAt` and `drawFrame`
 * read only this.
 */

export type { Pt } from './layout.js';
export type Rect = { x: number; y: number; w: number; h: number };

/** A single line of text with its measured width; `bbox` is where it is drawn. */
export type TextModel = { text: string; px: number; width: number; bbox: Rect };

type Timed = { index: number; start: number; duration: number };

export type NodeModel = {
  id: string;
  box: Rect;
  titleBar: number;
  label: TextModel;
  sub: TextModel | null;
  hidden: boolean;
  seed: number;
};

export type SendModel = Timed & {
  from: string;
  to: string;
  kind: Kind;
  a: Pt;
  b: Pt;
  horizontal: boolean;
  /** Which side of the segment the label sits on: -1 above/left, +1 below/right. */
  side: -1 | 1;
  label: TextModel | null;
  seed: number;
};

export type HighlightModel = Timed & { node: string; color: string; pulse: boolean };
export type VisibilityModel = Timed & { nodes: string[]; show: boolean };
export type BadgeModel = Timed & { near: string; text: TextModel; rect: Rect; seed: number };
export type GroupModel = Timed & { nodes: string[]; rect: Rect; label: TextModel | null; dashed: boolean; seed: number };

export type BlockModel = Timed & {
  id: string;
  lines: string[];
  lineWidths: number[];
  px: number;
  lineHeight: number;
  pad: number;
  rect: Rect;
  /** Height of the terminal title bar above the lines (0 for plain text and code). */
  titleBar: number;
  /** True when the author fixed the size; lines can then overflow it. */
  fixed: boolean;
  seed: number;
};
export type TextBoxModel = BlockModel;
export type CodeModel = BlockModel & { lang: string; shell: boolean; typing: boolean; highlightLines: number[] };

export type CaptionModel = { start: number; text: TextModel };
export type Star = { x: number; y: number; r: number; alpha: number };

export type Model = {
  sceneId: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  scale: number;
  seed: number;
  title: TextModel;
  nodes: NodeModel[];
  sends: SendModel[];
  highlights: HighlightModel[];
  visibility: VisibilityModel[];
  badges: BadgeModel[];
  groups: GroupModel[];
  texts: TextBoxModel[];
  codes: CodeModel[];
  captions: CaptionModel[];
  /** Step end times (start + duration): the settled states the linter also samples. */
  stepEnds: number[];
  stars: Star[];
  bands: { title: number; caption: number };
};

let scratch: CanvasRenderingContext2D | null = null;

function measure(text: string, px: number): number {
  if (!scratch) {
    registerFonts();
    scratch = new Canvas(16, 16).getContext('2d');
  }
  scratch.font = font(px);
  return scratch.measureText(text).width;
}

const LINE = 1.25;

/** Text centered on (cx, cy). */
function textAt(text: string, px: number, cx: number, cy: number): TextModel {
  const width = measure(text, px);
  const h = px * LINE;
  return { text, px, width, bbox: { x: cx - width / 2, y: cy - h / 2, w: width, h } };
}

/** Text with its left edge at x, centered vertically on cy. */
function textLeft(text: string, px: number, x: number, cy: number): TextModel {
  const t = textAt(text, px, 0, cy);
  t.bbox.x = x;
  return t;
}

function boxRect(b: Box, s: number): Rect {
  return { x: (b.cx - b.w / 2) * s, y: (b.cy - b.h / 2) * s, w: b.w * s, h: b.h * s };
}

function union(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** mulberry32: a tiny seeded PRNG for the star field. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveColor(c: string | null): string {
  if (c === null) return THEME.colors.reply;
  const named = (THEME.colors as Record<string, string>)[c];
  return named ?? c;
}

function block(
  s: number,
  step: Timed,
  id: string,
  text: string,
  at: [number, number],
  size: [number, number] | null,
  sizes: { size: number; lineHeight: number; pad: number },
  titleBar: number,
  seed: number,
): BlockModel {
  const px = sizes.size * s;
  const lineHeight = px * sizes.lineHeight;
  const pad = sizes.pad * s;
  const lines = text.split('\n');
  const lineWidths = lines.map((l) => measure(l, px));
  const w = size ? size[0] * s : Math.max(0, ...lineWidths) + 2 * pad;
  const h = size ? size[1] * s : titleBar + lines.length * lineHeight + 2 * pad;
  const rect = { x: at[0] * s - w / 2, y: at[1] * s - h / 2, w, h };
  return { ...step, id, lines, lineWidths, px, lineHeight, pad, rect, titleBar, fixed: size !== null, seed };
}

export function buildModel(input: SceneInput): Model {
  registerFonts();
  const s = input.width / THEME.design.width;
  const sc = input.scene;
  const seedOf = (el: string): number => seedFor(input.seed, sc.id, el);
  const boxes = place(sc.nodes, sc.layout);

  const nodes: NodeModel[] = Object.entries(sc.nodes).map(([id, n]) => {
    const box = boxRect(boxes[id]!, s);
    const titleBar = THEME.node.titleBar * s;
    const bodyCy = box.y + titleBar + (box.h - titleBar) / 2;
    const lpx = THEME.node.labelSize * s;
    const spx = THEME.node.subSize * s;
    const gap = 4 * s;
    const total = lpx * LINE + (n.sub ? gap + spx * LINE : 0);
    const top = bodyCy - total / 2;
    const label = textAt(n.label, lpx, box.x + box.w / 2, top + (lpx * LINE) / 2);
    const sub = n.sub ? textAt(n.sub, spx, box.x + box.w / 2, top + lpx * LINE + gap + (spx * LINE) / 2) : null;
    return { id, box, titleBar, label, sub, hidden: n.hidden, seed: seedOf(`node:${id}`) };
  });

  const laneOf = lanes(sc.steps);
  const sends: SendModel[] = [];
  const highlights: HighlightModel[] = [];
  const visibility: VisibilityModel[] = [];
  const badges: BadgeModel[] = [];
  const groups: GroupModel[] = [];
  const texts: TextBoxModel[] = [];
  const codes: CodeModel[] = [];
  const captions: CaptionModel[] = [];
  const nodeRect = (id: string): Rect => nodes.find((n) => n.id === id)!.box;

  for (const step of sc.steps) {
    const timed: Timed = { index: step.index, start: step.start, duration: step.duration };
    if (step.caption !== null) {
      captions.push({
        start: step.start,
        text: textAt(step.caption, THEME.caption.size * s, (THEME.design.width / 2) * s, THEME.caption.y * s),
      });
    }
    switch (step.action) {
      case 'send': {
        const { from, to, kind, label } = step.send;
        const off = laneOf.get(step.index) ?? 0;
        const ba = boxes[from]!;
        const bb = boxes[to]!;
        const hz = horizontal(ba, bb);
        const { from: pa, to: pb } = attach(ba, bb, off);
        const a = { x: pa.x * s, y: pa.y * s };
        const b = { x: pb.x * s, y: pb.y * s };
        const side: -1 | 1 = hz ? (off > 0 ? 1 : -1) : off < 0 ? -1 : 1;
        let lbl: TextModel | null = null;
        if (label) {
          const px = THEME.send.labelSize * s;
          const gap = THEME.send.labelGap * s;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const w = measure(label, px);
          const h = px * LINE;
          const cx = hz ? mid.x : mid.x + side * (gap + w / 2);
          const cy = hz ? mid.y + side * (gap + h / 2) : mid.y;
          lbl = textAt(label, px, cx, cy);
        }
        sends.push({ ...timed, from, to, kind, a, b, horizontal: hz, side, label: lbl, seed: seedOf(`send:${step.index}`) });
        break;
      }
      case 'highlight':
        highlights.push({
          ...timed,
          node: step.highlight.node,
          color: resolveColor(step.highlight.color),
          pulse: step.highlight.pulse,
        });
        break;
      case 'show':
        visibility.push({ ...timed, nodes: step.show, show: true });
        break;
      case 'hide':
        visibility.push({ ...timed, nodes: step.hide, show: false });
        break;
      case 'badge': {
        const near = nodeRect(step.badge.near);
        const px = THEME.badge.size * s;
        const w = measure(step.badge.text, px) + 2 * THEME.badge.padX * s;
        const h = THEME.badge.height * s;
        const rect = { x: near.x + near.w / 2 - w / 2, y: near.y + near.h + THEME.badge.gap * s, w, h };
        badges.push({
          ...timed,
          near: step.badge.near,
          text: textAt(step.badge.text, px, rect.x + w / 2, rect.y + h / 2),
          rect,
          seed: seedOf(`badge:${step.index}`),
        });
        break;
      }
      case 'group': {
        const pad = THEME.group.pad * s;
        const u = union(step.group.nodes.map(nodeRect));
        const rect = { x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad };
        const px = THEME.group.labelSize * s;
        const label = step.group.label
          ? textLeft(step.group.label, px, rect.x + 12 * s, rect.y - 6 * s - (px * LINE) / 2)
          : null;
        groups.push({
          ...timed,
          nodes: step.group.nodes,
          rect,
          label,
          dashed: step.group.style === 'dashed',
          seed: seedOf(`group:${step.index}`),
        });
        break;
      }
      case 'text': {
        const t = step.text;
        texts.push(block(s, timed, t.id, t.text, t.at, t.size, THEME.text, 0, seedOf(`text:${t.id}`)));
        break;
      }
      case 'code': {
        const c = step.code;
        const shell = c.lang === 'shell';
        const titleBar = shell ? THEME.code.titleBar * s : 0;
        const b = block(s, timed, c.id, c.text, c.at, c.size, THEME.code, titleBar, seedOf(`code:${c.id}`));
        codes.push({ ...b, lang: c.lang, shell, typing: c.typing, highlightLines: c.highlight_lines });
        break;
      }
    }
  }

  const rnd = prng(seedFor(input.seed, 'background', 'stars'));
  const stars: Star[] = Array.from({ length: THEME.stars.count }, () => ({
    x: rnd() * input.width,
    y: rnd() * input.height,
    r: (0.8 + rnd() * 1.0) * s,
    alpha: THEME.stars.alphaMin + rnd() * (THEME.stars.alphaMax - THEME.stars.alphaMin),
  }));

  return {
    sceneId: sc.id,
    width: input.width,
    height: input.height,
    fps: input.fps,
    duration: sc.duration,
    scale: s,
    seed: input.seed,
    title: textLeft(input.title, THEME.title.size * s, THEME.title.x * s, THEME.title.y * s),
    nodes,
    sends,
    highlights,
    visibility,
    badges,
    groups,
    texts,
    codes,
    captions,
    stepEnds: sc.steps.map((st) => st.start + st.duration),
    stars,
    bands: { title: THEME.bands.titleBand * s, caption: THEME.bands.captionBand * s },
  };
}
