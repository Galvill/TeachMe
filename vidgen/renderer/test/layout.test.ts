import { describe, expect, it } from 'vitest';
import { attach, lanes, place, type Box } from '../src/layout.js';
import { InputError, type Kind, type NodeIn, type StepIn } from '../src/scene.js';

function node(at: [number, number] | null = null, size: [number, number] | null = null): NodeIn {
  return { label: 'x', sub: null, at, size, hidden: false };
}

function send(index: number, from: string, to: string, kind: Kind): StepIn {
  return { index, start: index, duration: 1, caption: null, action: 'send', send: { from, to, label: '', kind } };
}

describe('place', () => {
  it('row spacing', () => {
    const boxes = place({ a: node(), b: node(), c: node(), d: node() }, { row: ['a', 'b', 'c', 'd'] });
    const xs = ['a', 'b', 'c', 'd'].map((k) => boxes[k]!.cx);
    expect(xs).toEqual([360, 760, 1160, 1560]);
    for (const k of ['a', 'b', 'c', 'd']) expect(boxes[k]!.cy).toBe(470);
    expect(boxes.a).toMatchObject({ w: 220, h: 140 });
    const one = place({ a: node() }, { row: ['a'] });
    expect(one.a).toMatchObject({ cx: 960, cy: 470 });
  });

  it('column and grid fill the area', () => {
    const col = place({ a: node(), b: node() }, { column: ['a', 'b'] });
    expect(col.a).toMatchObject({ cx: 960, cy: 330 });
    expect(col.b).toMatchObject({ cx: 960, cy: 710 });
    const grid = place({ a: node(), b: node(), c: node() }, { grid: { cols: 2, nodes: ['a', 'b', 'c'] } });
    expect(grid.a).toMatchObject({ cx: 560, cy: 330 });
    expect(grid.b).toMatchObject({ cx: 1360, cy: 330 });
    expect(grid.c).toMatchObject({ cx: 560, cy: 710 });
  });

  it('explicit at wins', () => {
    const boxes = place({ a: node([100, 200], [300, 120]), b: node() }, { row: ['a', 'b'] });
    expect(boxes.a).toEqual({ cx: 100, cy: 200, w: 300, h: 120 });
    expect(boxes.b!.cx).toBe(1360);
  });

  it('unplaced node error', () => {
    expect(() => place({ a: node(), x: node() }, { row: ['a'] })).toThrow(InputError);
    expect(() => place({ a: node(), x: node() }, { row: ['a'] })).toThrow('node "x" has no position');
    expect(() => place({ x: node() }, null)).toThrow('node "x" has no position');
  });
});

describe('attach', () => {
  const a: Box = { cx: 300, cy: 470, w: 220, h: 140 };
  const b: Box = { cx: 960, cy: 520, w: 260, h: 140 };
  const c: Box = { cx: 340, cy: 800, w: 220, h: 140 };

  it('attach horizontal', () => {
    expect(attach(a, b, 0)).toEqual({ from: { x: 410, y: 470 }, to: { x: 830, y: 520 } });
    expect(attach(b, a, 0)).toEqual({ from: { x: 830, y: 520 }, to: { x: 410, y: 470 } });
    expect(attach(a, b, -16)).toEqual({ from: { x: 410, y: 454 }, to: { x: 830, y: 504 } });
  });

  it('attach vertical', () => {
    expect(attach(a, c, 0)).toEqual({ from: { x: 300, y: 540 }, to: { x: 340, y: 730 } });
    expect(attach(c, a, 16)).toEqual({ from: { x: 356, y: 730 }, to: { x: 316, y: 540 } });
  });
});

describe('lanes', () => {
  it('single lane is centered', () => {
    expect(lanes([send(0, 'a', 'b', 'request'), send(1, 'a', 'b', 'request')])).toEqual(
      new Map([[0, 0], [1, 0]]),
    );
  });

  it('request reply lanes opposite', () => {
    const l = lanes([send(0, 'browser', 'resolver', 'request'), send(1, 'resolver', 'browser', 'reply')]);
    expect(l.get(0)).toBe(-16);
    expect(l.get(1)).toBe(16);
    const a: Box = { cx: 300, cy: 470, w: 220, h: 140 };
    const b: Box = { cx: 960, cy: 470, w: 220, h: 140 };
    const req = attach(a, b, l.get(0)!);
    const rep = attach(b, a, l.get(1)!);
    expect(Math.sign(req.from.y - 470)).toBe(-Math.sign(rep.from.y - 470));
  });

  it('three lanes', () => {
    const l = lanes([send(0, 'a', 'b', 'request'), send(1, 'b', 'a', 'reply'), send(2, 'a', 'b', 'answer')]);
    expect([l.get(0), l.get(1), l.get(2)]).toEqual([-24, 0, 24]);
  });

  it('lanes stable across direction', () => {
    // The reply comes back first in one scene and second in the other, and node ids sort the
    // other way round; the request keeps its side of the pair in both cases.
    const a: Box = { cx: 300, cy: 470, w: 220, h: 140 };
    const b: Box = { cx: 960, cy: 470, w: 220, h: 140 };
    const l1 = lanes([send(0, 'x', 'y', 'request'), send(1, 'y', 'x', 'reply')]);
    const l2 = lanes([send(0, 'y', 'x', 'request'), send(1, 'x', 'y', 'reply')]);
    expect(l1.get(0)).toBe(l2.get(0));
    // A given lane offset lands on the same side whichever way the arrow points.
    expect(attach(a, b, 16).from.y).toBe(attach(b, a, 16).from.y);
    expect(attach(a, b, -16).to.y).toBe(attach(b, a, -16).to.y);
    // Repeating a (direction, kind) reuses its lane rather than adding one.
    const l3 = lanes([send(0, 'x', 'y', 'request'), send(1, 'y', 'x', 'reply'), send(2, 'x', 'y', 'request')]);
    expect(l3.get(2)).toBe(l3.get(0));
  });
});
