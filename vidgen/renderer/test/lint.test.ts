import { describe, expect, it } from 'vitest';
import { main, type Io } from '../src/cli.js';
import { lintScene, sampleTimes } from '../src/lint.js';
import { buildModel } from '../src/model.js';
import { parseScene } from '../src/scene.js';
import { baseScene, fixture } from './helpers.js';
import { fileURLToPath } from 'node:url';

function lint(name: string) {
  return lintScene(buildModel(parseScene(fixture(name))));
}

function only(name: string) {
  const { issues } = lint(name);
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('lintScene', () => {
  it('samples every 0.25 s plus each settled step', () => {
    const m = buildModel(parseScene(baseScene()));
    const ts = sampleTimes(m);
    expect(ts.slice(0, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ts).toContain(2.6); // the send settles at 1.2 + 1.4
    expect(ts.at(-1)).toBe(6.25);
  });

  it('clean fixture passes', () => {
    const r = lint('lint-clean.json');
    expect(r.issues).toEqual([]);
  });

  it('label-overlap', () => {
    const i = only('lint-label-overlap.json');
    expect(i).toMatchObject({ scene: 'overlap', kind: 'label-overlap', t: 1.75, elements: ['node:cache:label', 'send:0:label'] });
    expect(i.message).toMatch(/overlap by \d+ px²/);
  });

  it('label-line', () => {
    const i = only('lint-label-line.json');
    expect(i).toMatchObject({ scene: 'crossing', kind: 'label-line', t: 2, elements: ['send:0', 'node:mid:label'] });
  });

  it('overflow', () => {
    const i = only('lint-overflow.json');
    expect(i).toMatchObject({ scene: 'overflow', kind: 'overflow', t: 0, elements: ['node:resolver:label'] });
    expect(i.message).toMatch(/fits 188 px/);
  });

  it('overflow: fixed-size text and the frame edge', () => {
    const j = fixture('lint-clean.json');
    j.scene.steps.push(
      { index: 4, start: 1, duration: 0.4, caption: null, action: 'text', text: { id: 'tight', text: 'a long line of text', at: [960, 800], size: [80, 60] } },
      { index: 5, start: 2, duration: 0.4, caption: null, action: 'text', text: { id: 'edge', text: 'edge', at: [1900, 700], size: null } },
    );
    const issues = lintScene(buildModel(parseScene(j))).issues;
    expect(issues.map((x) => [x.kind, x.elements, x.t])).toEqual([
      ['overflow', ['text:tight'], 1.25],
      ['overflow', ['text:edge'], 2.25],
    ]);
  });

  it('zone', () => {
    const i = only('lint-zone.json');
    expect(i).toMatchObject({ scene: 'zone', kind: 'zone', t: 2.25, elements: ['text:note'] });
    expect(i.message).toMatch(/caption band/);
  });

  it('reports each issue once at its first time', () => {
    const { issues } = lint('lint-label-overlap.json');
    // The overlap persists to the end of the scene but is reported once.
    expect(issues.filter((x) => x.kind === 'label-overlap')).toHaveLength(1);
  });

  it('densest spaced', () => {
    const { densest } = lint('lint-clean.json');
    expect(densest).toHaveLength(3);
    for (let a = 0; a < densest.length; a++) {
      for (let b = a + 1; b < densest.length; b++) {
        expect(Math.abs(densest[a]!.t - densest[b]!.t)).toBeGreaterThanOrEqual(1);
      }
    }
    const counts = densest.map((d) => d.labels);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
    // Once the 4th arrow's label shows: 3 node labels + 2 subs + 4 arrow labels.
    expect(counts[0]).toBe(9);
  });
});

describe('cli lint', () => {
  function capture(): Io & { stdout: string[] } {
    const stdout: string[] = [];
    return { stdout, out: (l) => stdout.push(l), err: () => {} };
  }
  const path = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

  it('prints issues as JSON lines and exits 1', async () => {
    const io = capture();
    expect(await main(['lint', '--scene', path('lint-zone.json')], io)).toBe(1);
    expect(io.stdout).toHaveLength(2);
    expect(JSON.parse(io.stdout[0]!)).toMatchObject({ kind: 'zone', elements: ['text:note'] });
    expect(Object.keys(JSON.parse(io.stdout[1]!))).toEqual(['densest']);
  });

  it('exits 0 on a clean scene', async () => {
    const io = capture();
    expect(await main(['lint', '--scene', path('lint-clean.json')], io)).toBe(0);
    expect(io.stdout).toHaveLength(1);
    expect(JSON.parse(io.stdout[0]!).densest).toHaveLength(3);
  });
});
