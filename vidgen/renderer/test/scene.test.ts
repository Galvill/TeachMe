import { describe, expect, it } from 'vitest';
import { FontLibrary } from 'skia-canvas';
import { InputError, parseScene } from '../src/scene.js';
import { registerFonts, THEME } from '../src/theme.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../src/model.js';
import { baseScene, type Loose } from './helpers.js';

describe('parseScene', () => {
  it('accepts the contract shape', () => {
    const s = parseScene(baseScene());
    expect(s.scene.id).toBe('intro');
    expect(s.scene.nodes.browser?.label).toBe('Browser');
    const step = s.scene.steps[0];
    expect(step?.action).toBe('send');
    if (step?.action === 'send') expect(step.send.kind).toBe('request');
  });

  it('rejects wrong version', () => {
    const j = baseScene();
    j.version = 2;
    expect(() => parseScene(j)).toThrow(InputError);
    expect(() => parseScene(j)).toThrow(/^version: unsupported version 2/);
  });

  it('rejects missing field path', () => {
    const j = baseScene();
    delete j.scene.nodes.browser.label;
    let err: unknown;
    try {
      parseScene(j);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InputError);
    expect((err as InputError).path).toBe('scene.nodes.browser.label');
    expect((err as InputError).message).toBe('scene.nodes.browser.label: missing field');

    const k = baseScene();
    delete k.scene.steps[0].send.to;
    expect(() => parseScene(k)).toThrow('scene.steps[0].send.to: missing field');
  });

  it('rejects an unknown node reference', () => {
    const j = baseScene();
    j.scene.steps[0].send.to = 'resolvr';
    expect(() => parseScene(j)).toThrow('scene.steps[0].send.to: unknown node "resolvr"');
  });
});

describe('Plan A contract', () => {
  // vidgen core's golden scene JSON, read in place so the two sides can't drift apart.
  const GOLDEN = fileURLToPath(new URL('../../tests/fixtures/dns-mini.intro.scene.json', import.meta.url));
  const golden = (): Loose => JSON.parse(readFileSync(GOLDEN, 'utf8'));

  it('parses the core golden scene JSON', () => {
    const s = parseScene(golden());
    expect(s.scene.id).toBe('intro');
    expect(s.scene.layout).toEqual({ row: ['browser', 'resolver'] });
    expect(s.scene.nodes.root).toMatchObject({ hidden: true, at: [1060, 150] });
    expect(s.scene.steps.map((x) => x.action)).toEqual(['highlight', 'send', 'show']);
    const m = buildModel(s);
    expect(m.nodes.map((n) => n.id)).toEqual(['browser', 'resolver', 'root']);
  });

  function withCode(ref: string, codeFirst = true): Loose {
    const j = golden();
    const code = {
      action: 'code',
      caption: null,
      code: { at: [960, 760], highlight_lines: [1], id: 'dig', lang: 'shell', size: null, text: '$ dig example.com', typing: true },
      duration: 0.7,
      index: 3,
      start: 8.0,
    };
    const hide = { action: 'hide', caption: null, duration: 0.4, hide: [ref], index: 4, start: 8.2 };
    j.scene.steps.push(...(codeFirst ? [code, hide] : [hide, code]));
    return j;
  }

  it('accepts show, hide and highlight of an earlier code element', () => {
    const s = parseScene(withCode('dig'));
    expect(s.scene.steps.map((x) => x.action)).toEqual(['highlight', 'send', 'show', 'code', 'hide']);
    const j = withCode('dig');
    j.scene.steps.push(
      { action: 'highlight', caption: null, duration: 1, highlight: { color: null, node: 'dig', pulse: true }, index: 5, start: 8.3 },
      { action: 'show', caption: null, duration: 0.4, index: 6, show: ['dig'], start: 8.4 },
    );
    expect(() => parseScene(j)).not.toThrow();
  });

  it('rejects an element no earlier step created', () => {
    expect(() => parseScene(withCode('nope'))).toThrow('scene.steps[4].hide[0]: unknown node or element "nope"');
    expect(() => parseScene(withCode('dig', false))).toThrow('scene.steps[3].hide[0]: unknown node or element "dig"');
  });

  it('still requires a node for send, badge and group', () => {
    const j = withCode('dig');
    j.scene.steps.push({
      action: 'send', caption: null, duration: 1, index: 5, start: 8.5,
      send: { from: 'browser', kind: 'request', label: '', to: 'dig' },
    });
    expect(() => parseScene(j)).toThrow('scene.steps[5].send.to: unknown node "dig"');
  });
});

describe('theme', () => {
  it('has the sketch-dark tokens', () => {
    expect(THEME.colors.bg).toBe('#14161a');
    expect(THEME.node.size).toEqual([220, 140]);
    expect(THEME.bands).toEqual({ titleBand: 70, captionBand: 970 });
  });

  it('fonts registered', () => {
    registerFonts();
    expect(FontLibrary.has('Excalifont')).toBe(true);
    expect(FontLibrary.has('Inter')).toBe(true);
  });
});
