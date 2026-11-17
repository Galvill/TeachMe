import { fileURLToPath } from 'node:url';
import { FontLibrary } from 'skia-canvas';
import type { Kind } from './scene.js';

/** `sketch-dark` tokens. Sizes are in 1920x1080 design px; drawing scales them by `width / 1920`. */
export type Theme = {
  colors: {
    bg: string;
    teal: string;
    request: string;
    reply: string;
    answer: string;
    text: string;
    muted: string;
    /** Box body fill, a shade above the background. */
    panel: string;
    /** Code panel fill, a shade below the background. */
    code: string;
  };
  /** CSS font family list: the handwriting face, then the fallback. */
  font: string;
  design: { width: 1920; height: 1080 };
  node: { size: [number, number]; titleBar: number; labelSize: number; subSize: number; padX: number };
  /** Title band is y < `titleBand`; caption band is y > `captionBand`. */
  bands: { titleBand: number; captionBand: number };
  title: { size: number; x: number; y: number };
  caption: { size: number; y: number };
  send: { labelSize: number; labelGap: number; dot: number; head: number };
  badge: { size: number; gap: number; padX: number; height: number };
  group: { pad: number; labelSize: number; radius: number };
  text: { size: number; lineHeight: number; pad: number };
  code: { size: number; lineHeight: number; pad: number; titleBar: number };
  stroke: number;
  stars: { count: number; alphaMin: number; alphaMax: number };
};

export const THEME: Theme = {
  colors: {
    bg: '#14161a',
    teal: '#3fb7a8',
    request: '#ff6fa5',
    reply: '#f2c14e',
    answer: '#a98bff',
    text: '#e8e6e3',
    muted: '#8a8f98',
    panel: '#1a1d22',
    code: '#0d0f12',
  },
  font: 'Excalifont, Inter',
  design: { width: 1920, height: 1080 },
  node: { size: [220, 140], titleBar: 34, labelSize: 30, subSize: 20, padX: 16 },
  bands: { titleBand: 70, captionBand: 970 },
  title: { size: 26, x: 48, y: 38 },
  caption: { size: 34, y: 1022 },
  send: { labelSize: 24, labelGap: 18, dot: 7, head: 18 },
  badge: { size: 26, gap: 24, padX: 18, height: 46 },
  group: { pad: 24, labelSize: 22, radius: 18 },
  text: { size: 26, lineHeight: 1.3, pad: 12 },
  code: { size: 22, lineHeight: 1.45, pad: 18, titleBar: 34 },
  stroke: 2.5,
  stars: { count: 120, alphaMin: 0.15, alphaMax: 0.4 },
};

export function kindColor(kind: Kind): string {
  return THEME.colors[kind];
}

/** CSS font shorthand for a size in output px. */
export function font(px: number): string {
  return `${px}px ${THEME.font}`;
}

const FONT_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

/** Registers the bundled fonts (idempotent). Family `Excalifont`, with `Inter` as fallback. */
export function registerFonts(): void {
  if (FontLibrary.has('Excalifont') && FontLibrary.has('Inter')) return;
  FontLibrary.use('Excalifont', [`${FONT_DIR}Excalifont-Regular.woff2`]);
  FontLibrary.use('Inter', [`${FONT_DIR}Inter-Regular.ttf`]);
}
