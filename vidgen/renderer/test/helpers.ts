import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Test fixtures are deliberately loose JSON so tests can break them in any way. */
export type Loose = any;

/** A minimal valid scene JSON in the Plan A Task 7 shape. */
export function baseScene(): Loose {
  return {
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    design: [1920, 1080],
    seed: 7,
    style: 'sketch-dark',
    title: 'How a DNS lookup works',
    scene: {
      id: 'intro',
      duration: 6.4333,
      nodes: {
        browser: { label: 'Browser', sub: 'own + OS cache', at: [300, 470], size: null, hidden: false },
        resolver: { label: 'Resolver', sub: null, at: [960, 470], size: null, hidden: false },
      },
      layout: null,
      steps: [
        {
          index: 0,
          start: 1.2,
          duration: 1.4,
          caption: '1  Browser asks the resolver',
          action: 'send',
          send: { from: 'browser', to: 'resolver', label: 'example.com ?', kind: 'request' },
        },
      ],
    },
  };
}

export function fixture(name: string): Loose {
  const p = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8'));
}
