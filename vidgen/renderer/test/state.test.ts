import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model.js';
import { parseScene } from '../src/scene.js';
import { easeInOutCubic, elementsAt, highlightAt, type ElementState } from '../src/state.js';
import { baseScene, type Loose } from './helpers.js';

function scene(): Loose {
  const j = baseScene();
  j.scene.nodes.root = { label: 'Root', sub: null, at: [1500, 300], size: null, hidden: true };
  j.scene.steps.push(
    { index: 1, start: 3.0, duration: 0.4, caption: '2  Root appears', action: 'show', show: ['root'] },
    {
      index: 2,
      start: 3.6,
      duration: 1.0,
      caption: null,
      action: 'send',
      send: { from: 'resolver', to: 'root', label: 'who has .com?', kind: 'request' },
    },
    { index: 3, start: 4.8, duration: 0.6, caption: null, action: 'badge', badge: { text: '93.184.216.34', near: 'browser' } },
    { index: 4, start: 5.0, duration: 1.0, caption: null, action: 'highlight', highlight: { node: 'resolver', color: null, pulse: true } },
  );
  return j;
}

const model = buildModel(parseScene(scene()));

function at(t: number, id: string): ElementState {
  const e = elementsAt(model, t).find((x) => x.id === id);
  if (!e) throw new Error(`no element ${id} at ${t}`);
  return e;
}

describe('elementsAt', () => {
  it('hidden node alpha 0 before show', () => {
    expect(at(0, 'node:root').alpha).toBe(0);
    expect(at(2.99, 'node:root').alpha).toBe(0);
    expect(at(2.99, 'node:root:label').alpha).toBe(0);
    expect(at(3.2, 'node:root').alpha).toBeCloseTo(0.5, 6);
    expect(at(3.4, 'node:root').alpha).toBe(1);
    expect(at(0, 'node:browser').alpha).toBe(1);
  });

  it('send progress midpoint', () => {
    expect(at(1.2 + 0.7, 'send:0').progress).toBeCloseTo(0.5, 9);
    expect(at(1.2 + 0.35, 'send:0').progress).toBeCloseTo(easeInOutCubic(0.25), 9);
    expect(at(1.0, 'send:0').alpha).toBe(0);
    expect(at(1.0, 'send:0').progress).toBe(0);
    const seg = at(1.9, 'send:0').segment!;
    const full = model.sends[0]!;
    expect(seg[1].x).toBeCloseTo((full.a.x + full.b.x) / 2, 6);
  });

  it('label invisible before half', () => {
    expect(at(1.2 + 0.6, 'send:0:label').alpha).toBe(0);
    expect(at(1.2 + 0.7, 'send:0:label').alpha).toBeCloseTo(0, 9);
    expect(at(1.2 + 0.9, 'send:0:label').alpha).toBeGreaterThan(0);
    expect(at(2.6, 'send:0:label').alpha).toBe(1);
    // 18 px above the segment (request is the only lane, so it sits on the default upper side).
    const lbl = model.sends[0]!.label!.bbox;
    expect(lbl.y + lbl.h).toBeCloseTo(model.sends[0]!.a.y - 18, 6);
  });

  it('caption switches at step start', () => {
    expect(elementsAt(model, 1.19).some((e) => e.kind === 'caption')).toBe(false);
    expect(at(1.25, 'caption').alpha).toBeCloseTo(0.25, 6);
    expect(at(2.99, 'caption').bbox).toEqual(model.captions[0]!.text.bbox);
    expect(at(3.01, 'caption').bbox).toEqual(model.captions[1]!.text.bbox);
    expect(at(3.1, 'caption:prev').alpha).toBeCloseTo(0.5, 6);
    expect(elementsAt(model, 3.3).some((e) => e.id === 'caption:prev')).toBe(false);
    // A step with no caption keeps the previous one.
    expect(at(4.0, 'caption').bbox).toEqual(model.captions[1]!.text.bbox);
  });

  it('arrow persists', () => {
    const end = model.duration;
    for (const id of ['send:0', 'send:2']) {
      expect(at(end, id).progress).toBe(1);
      expect(at(end, id).alpha).toBe(1);
    }
    expect(at(end, 'send:0:label').alpha).toBe(1);
  });

  it('title is always visible', () => {
    for (const t of [0, 2, model.duration]) expect(at(t, 'title').alpha).toBe(1);
  });

  it('badge pops and highlight leaves an outline', () => {
    expect(at(4.7, 'badge:3').alpha).toBe(0);
    expect(at(5.4, 'badge:3').alpha).toBe(1);
    expect(at(5.2, 'badge:3').progress).toBeGreaterThan(1); // ease-out-back overshoot
    expect(highlightAt(model, 'resolver', 4.9)).toEqual({ glow: 0, color: null });
    expect(highlightAt(model, 'resolver', 5.5).glow).toBeCloseTo(1, 6);
    expect(highlightAt(model, 'resolver', 6.2)).toEqual({ glow: 0, color: '#f2c14e' });
  });
});
