import { describe, expect, it } from 'vitest';
import { roughEllipse, roughLine, roughRect, seedFor } from '../src/rough.js';

describe('rough', () => {
  it('same seed same path', () => {
    const s = seedFor(7, 'intro', 'node:browser');
    expect(roughRect(10, 20, 220, 140, { seed: s }).d).toBe(roughRect(10, 20, 220, 140, { seed: s }).d);
    expect(roughLine(0, 0, 300, 40, { seed: s }).d).toBe(roughLine(0, 0, 300, 40, { seed: s }).d);
    expect(roughEllipse(50, 50, 80, 40, { seed: s }).d).toBe(roughEllipse(50, 50, 80, 40, { seed: s }).d);
    expect(roughRect(10, 20, 220, 140, { seed: s }).d.length).toBeGreaterThan(20);
  });

  it('element id changes path', () => {
    const a = seedFor(7, 'intro', 'node:browser');
    const b = seedFor(7, 'intro', 'node:resolver');
    expect(a).not.toBe(b);
    expect(roughRect(10, 20, 220, 140, { seed: a }).d).not.toBe(roughRect(10, 20, 220, 140, { seed: b }).d);
    expect(seedFor(7, 'intro', 'x')).not.toBe(seedFor(7, 'outro', 'x'));
    expect(seedFor(7, 'intro', 'x')).not.toBe(seedFor(8, 'intro', 'x'));
  });

  it('seed never zero', () => {
    for (let i = 0; i < 5000; i++) {
      const s = seedFor(i, 'scene', `el-${i}`);
      expect(s).not.toBe(0);
      expect(Number.isInteger(s) && s > 0 && s <= 0xffffffff).toBe(true);
    }
    expect(() => roughLine(0, 0, 1, 1, { seed: 0 })).toThrow();
  });

  it('defaults roughness 1.2 and bowing 1', () => {
    const s = seedFor(1, 'a', 'b');
    expect(roughLine(0, 0, 300, 0, { seed: s }).d).toBe(roughLine(0, 0, 300, 0, { seed: s, roughness: 1.2, bowing: 1 }).d);
    expect(roughLine(0, 0, 300, 0, { seed: s }).d).not.toBe(roughLine(0, 0, 300, 0, { seed: s, roughness: 3 }).d);
  });
});
