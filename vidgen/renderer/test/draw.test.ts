import { describe, expect, it } from 'vitest';
import { Canvas } from 'skia-canvas';
import { drawFrame } from '../src/draw.js';
import { buildModel, type Model } from '../src/model.js';
import { parseScene } from '../src/scene.js';
import { baseScene, type Loose } from './helpers.js';

function richScene(width = 1920, height = 1080): Loose {
  const j = baseScene();
  j.width = width;
  j.height = height;
  j.scene.steps.push(
    { index: 1, start: 2.7, duration: 1, caption: null, action: 'send', send: { from: 'resolver', to: 'browser', label: '93.184.216.34', kind: 'reply' } },
    { index: 2, start: 3.0, duration: 1, caption: null, action: 'highlight', highlight: { node: 'resolver', color: null, pulse: true } },
    { index: 3, start: 3.2, duration: 0.6, caption: 'done', action: 'badge', badge: { text: 'cached', near: 'browser' } },
    { index: 4, start: 3.4, duration: 0.6, caption: null, action: 'group', group: { nodes: ['browser', 'resolver'], label: 'your side', style: 'dashed' } },
    { index: 5, start: 3.5, duration: 0.4, caption: null, action: 'text', text: { id: 'note', text: 'TTL 300', at: [1500, 760], size: null } },
    {
      index: 6,
      start: 3.6,
      duration: 1.2,
      caption: null,
      action: 'code',
      code: { id: 'dig', lang: 'shell', text: '$ dig example.com\n;; ANSWER\nexample.com. 300 IN A', at: [600, 800], size: null, typing: true, highlight_lines: [3] },
    },
  );
  return j;
}

async function png(m: Model, t: number): Promise<Buffer> {
  const c = new Canvas(m.width, m.height);
  c.gpu = false;
  drawFrame(c.getContext('2d'), m, t);
  return c.toBuffer('png');
}

describe('drawFrame', () => {
  it('draw is deterministic', async () => {
    for (const t of [1.9, 3.3, 5.5]) {
      const a = await png(buildModel(parseScene(richScene())), t);
      const b = await png(buildModel(parseScene(richScene())), t);
      expect(a.equals(b)).toBe(true);
    }
  });

  it('frames change over time', async () => {
    const m = buildModel(parseScene(richScene()));
    expect((await png(m, 1.0)).equals(await png(m, 2.0))).toBe(false);
  });

  it('draft scales geometry', async () => {
    const full = buildModel(parseScene(richScene(1920, 1080)));
    const draft = buildModel(parseScene(richScene(1280, 720)));
    expect(draft.scale).toBeCloseTo(2 / 3, 12);
    for (const k of [0, 1]) {
      const f = full.nodes[k]!.box;
      const d = draft.nodes[k]!.box;
      expect(d.x).toBeCloseTo((f.x * 2) / 3, 9);
      expect(d.y).toBeCloseTo((f.y * 2) / 3, 9);
      expect(d.w).toBeCloseTo((f.w * 2) / 3, 9);
      expect(d.h).toBeCloseTo((f.h * 2) / 3, 9);
    }
    expect(draft.sends[0]!.a.x).toBeCloseTo((full.sends[0]!.a.x * 2) / 3, 9);
    // The browser node (design center 300, 470) is drawn at 200, 313.3 in the draft frame.
    const b = draft.nodes[0]!.box;
    expect(b.x + b.w / 2).toBeCloseTo(200, 9);
    expect(b.y + b.h / 2).toBeCloseTo(470 * (2 / 3), 9);
    const c = new Canvas(1280, 720);
    c.gpu = false;
    const ctx = c.getContext('2d');
    drawFrame(ctx, draft, 5);
    // The node body is filled with the panel color, not the background.
    const px = ctx.getImageData(Math.round(b.x + 10), Math.round(b.y + b.h - 10), 1, 1).data;
    [0x1a, 0x1d, 0x22].forEach((v, k) => expect(Math.abs(px[k]! - v)).toBeLessThanOrEqual(2));
  });
});
