import { describe, expect, it } from 'vitest';
import { FontLibrary } from 'skia-canvas';
import { InputError, parseScene } from '../src/scene.js';
import { registerFonts, THEME } from '../src/theme.js';
import { baseScene } from './helpers.js';

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
