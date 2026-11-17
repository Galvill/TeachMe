import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Canvas, loadImage, type Canvas as CanvasT } from 'skia-canvas';
import { FrameRenderer } from '../src/encode.js';
import { buildModel } from '../src/model.js';
import { parseScene } from '../src/scene.js';
import { fixture } from './helpers.js';

/**
 * Renders the intro fixture at t = 2.5 and compares it with the committed PNG. It passes when at
 * most 0.5 % of pixels differ by more than 16 in any channel, which absorbs anti-aliasing drift
 * but not a moved box, a changed color or a different font. `UPDATE_GOLDEN=1 npm test` rewrites it;
 * look at the new PNG before committing it.
 */

const GOLDEN = fileURLToPath(new URL('./golden/intro-2.5.png', import.meta.url));
const T = 2.5;
const CHANNEL_TOLERANCE = 16;
const MAX_DIFF_FRACTION = 0.005;

function pixels(c: CanvasT): Uint8ClampedArray {
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}

describe('golden frame', () => {
  it('golden intro 2.5', async () => {
    const m = buildModel(parseScene(fixture('intro.json')));
    const frame = new FrameRenderer(m).render(T);

    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, await frame.toBuffer('png'));
    }
    expect(existsSync(GOLDEN), `missing ${GOLDEN}; run UPDATE_GOLDEN=1 npm test`).toBe(true);

    const img = await loadImage(GOLDEN);
    expect([img.width, img.height]).toEqual([m.width, m.height]);
    const ref = new Canvas(img.width, img.height);
    ref.gpu = false;
    ref.getContext('2d').drawImage(img, 0, 0);

    const a = pixels(frame);
    const b = pixels(ref);
    let differing = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i]! - b[i]!) > CHANNEL_TOLERANCE ||
        Math.abs(a[i + 1]! - b[i + 1]!) > CHANNEL_TOLERANCE ||
        Math.abs(a[i + 2]! - b[i + 2]!) > CHANNEL_TOLERANCE ||
        Math.abs(a[i + 3]! - b[i + 3]!) > CHANNEL_TOLERANCE
      ) {
        differing++;
      }
    }
    const fraction = differing / (a.length / 4);
    expect(fraction, `${(fraction * 100).toFixed(3)} % of pixels differ`).toBeLessThanOrEqual(MAX_DIFF_FRACTION);
  });
});
