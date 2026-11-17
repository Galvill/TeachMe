/**
 * Scene input: the JSON contract written by vidgen core (Plan A, Task 7) and read here.
 * The renderer never reads `script.yaml`; everything it needs is in one scene JSON file.
 * `at` coordinates are box centers in the 1920x1080 design space.
 */

export type Kind = 'request' | 'reply' | 'answer';
export type Action = 'send' | 'highlight' | 'show' | 'hide' | 'badge' | 'group' | 'text' | 'code';
export const ACTIONS: readonly Action[] = ['send', 'highlight', 'show', 'hide', 'badge', 'group', 'text', 'code'];

export type NodeIn = {
  label: string;
  sub: string | null;
  at: [number, number] | null;
  size: [number, number] | null;
  hidden: boolean;
};

export type Layout =
  | { row: string[] }
  | { column: string[] }
  | { grid: { cols: number; nodes: string[] } };

export type SendIn = { from: string; to: string; label: string; kind: Kind };
export type HighlightIn = { node: string; color: string | null; pulse: boolean };
export type BadgeIn = { text: string; near: string };
export type GroupIn = { nodes: string[]; label: string; style: 'dashed' | 'solid' };
export type TextIn = { id: string; text: string; at: [number, number]; size: [number, number] | null };
export type CodeIn = {
  id: string;
  lang: string;
  text: string;
  at: [number, number];
  size: [number, number] | null;
  typing: boolean;
  highlight_lines: number[];
};

type StepBase = { index: number; start: number; duration: number; caption: string | null };
export type StepIn = StepBase &
  (
    | { action: 'send'; send: SendIn }
    | { action: 'highlight'; highlight: HighlightIn }
    | { action: 'show'; show: string[] }
    | { action: 'hide'; hide: string[] }
    | { action: 'badge'; badge: BadgeIn }
    | { action: 'group'; group: GroupIn }
    | { action: 'text'; text: TextIn }
    | { action: 'code'; code: CodeIn }
  );

export type SceneInput = {
  version: 1;
  width: number;
  height: number;
  fps: number;
  design: [1920, 1080];
  seed: number;
  style: 'sketch-dark';
  title: string;
  scene: {
    id: string;
    duration: number;
    nodes: Record<string, NodeIn>;
    layout: Layout | null;
    steps: StepIn[];
  };
};

/** Bad scene input. `path` is the JSON path of the offending value, e.g. `scene.steps[2].send.to`. */
export class InputError extends Error {
  readonly path: string;
  constructor(message: string, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'InputError';
    this.path = path;
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw new InputError('expected an object', path || '$');
  return v;
}

function field(o: Obj, key: string, path: string): unknown {
  if (!(key in o)) throw new InputError('missing field', join(path, key));
  return o[key];
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError('expected a number', path);
  return v;
}

function posNum(v: unknown, path: string): number {
  const n = num(v, path);
  if (n <= 0) throw new InputError('expected a positive number', path);
  return n;
}

function nonNeg(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0) throw new InputError('expected a number >= 0', path);
  return n;
}

function int(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) throw new InputError('expected an integer', path);
  return n;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new InputError('expected a string', path);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new InputError('expected a boolean', path);
  return v;
}

function strOrNull(v: unknown, path: string): string | null {
  return v === null ? null : str(v, path);
}

function pair(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new InputError('expected [x, y]', path);
  return [num(v[0], join(path, 0)), num(v[1], join(path, 1))];
}

function size(v: unknown, path: string): [number, number] {
  const [w, h] = pair(v, path);
  if (w <= 0 || h <= 0) throw new InputError('expected a positive [w, h]', path);
  return [w, h];
}

function pairOrNull(v: unknown, path: string): [number, number] | null {
  return v === null ? null : pair(v, path);
}

function sizeOrNull(v: unknown, path: string): [number, number] | null {
  return v === null ? null : size(v, path);
}

function strList(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) throw new InputError('expected a list of strings', path);
  return v.map((x, i) => str(x, join(path, i)));
}

/** An optional field with a default: absent or null gives the default. */
function opt<T>(o: Obj, key: string, path: string, read: (v: unknown, p: string) => T, dflt: T): T {
  const v = o[key];
  return v === undefined || v === null ? dflt : read(v, join(path, key));
}

function parseNode(v: unknown, path: string): NodeIn {
  const o = obj(v, path);
  return {
    label: str(field(o, 'label', path), join(path, 'label')),
    sub: strOrNull(field(o, 'sub', path), join(path, 'sub')),
    at: pairOrNull(field(o, 'at', path), join(path, 'at')),
    size: sizeOrNull(field(o, 'size', path), join(path, 'size')),
    hidden: bool(field(o, 'hidden', path), join(path, 'hidden')),
  };
}

function parseLayout(v: unknown, path: string): Layout | null {
  if (v === null) return null;
  const o = obj(v, path);
  if ('row' in o) return { row: strList(o.row, join(path, 'row')) };
  if ('column' in o) return { column: strList(o.column, join(path, 'column')) };
  if ('grid' in o) {
    const gp = join(path, 'grid');
    const g = obj(o.grid, gp);
    const cols = int(field(g, 'cols', gp), join(gp, 'cols'));
    if (cols < 1) throw new InputError('expected an integer >= 1', join(gp, 'cols'));
    return { grid: { cols, nodes: strList(field(g, 'nodes', gp), join(gp, 'nodes')) } };
  }
  throw new InputError('expected one of row, column, grid', path);
}

function parseKind(v: unknown, path: string): Kind {
  const s = str(v, path);
  if (s !== 'request' && s !== 'reply' && s !== 'answer') {
    throw new InputError(`unknown kind "${s}" (expected request, reply or answer)`, path);
  }
  return s;
}

function parseStep(v: unknown, path: string): StepIn {
  const o = obj(v, path);
  const base: StepBase = {
    index: int(field(o, 'index', path), join(path, 'index')),
    start: nonNeg(field(o, 'start', path), join(path, 'start')),
    duration: nonNeg(field(o, 'duration', path), join(path, 'duration')),
    caption: strOrNull(field(o, 'caption', path), join(path, 'caption')),
  };
  const action = str(field(o, 'action', path), join(path, 'action'));
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new InputError(`unknown action "${action}"`, join(path, 'action'));
  }
  const p = join(path, action);
  const payload = field(o, action, path);
  switch (action as Action) {
    case 'send': {
      const s = obj(payload, p);
      return {
        ...base,
        action: 'send',
        send: {
          from: str(field(s, 'from', p), join(p, 'from')),
          to: str(field(s, 'to', p), join(p, 'to')),
          label: opt(s, 'label', p, str, ''),
          kind: opt(s, 'kind', p, parseKind, 'request'),
        },
      };
    }
    case 'highlight': {
      if (typeof payload === 'string') {
        return { ...base, action: 'highlight', highlight: { node: payload, color: null, pulse: true } };
      }
      const h = obj(payload, p);
      return {
        ...base,
        action: 'highlight',
        highlight: {
          node: str(field(h, 'node', p), join(p, 'node')),
          color: opt<string | null>(h, 'color', p, str, null),
          pulse: opt(h, 'pulse', p, bool, true),
        },
      };
    }
    case 'show':
      return { ...base, action: 'show', show: strList(payload, p) };
    case 'hide':
      return { ...base, action: 'hide', hide: strList(payload, p) };
    case 'badge': {
      const b = obj(payload, p);
      return {
        ...base,
        action: 'badge',
        badge: { text: str(field(b, 'text', p), join(p, 'text')), near: str(field(b, 'near', p), join(p, 'near')) },
      };
    }
    case 'group': {
      const g = obj(payload, p);
      const style = opt(g, 'style', p, str, 'dashed');
      if (style !== 'dashed' && style !== 'solid') {
        throw new InputError(`unknown style "${style}" (expected dashed or solid)`, join(p, 'style'));
      }
      return {
        ...base,
        action: 'group',
        group: { nodes: strList(field(g, 'nodes', p), join(p, 'nodes')), label: opt(g, 'label', p, str, ''), style },
      };
    }
    case 'text': {
      const t = obj(payload, p);
      return {
        ...base,
        action: 'text',
        text: {
          id: str(field(t, 'id', p), join(p, 'id')),
          text: str(field(t, 'text', p), join(p, 'text')),
          at: pair(field(t, 'at', p), join(p, 'at')),
          size: opt<[number, number] | null>(t, 'size', p, size, null),
        },
      };
    }
    case 'code': {
      const c = obj(payload, p);
      const hp = join(p, 'highlight_lines');
      const hl = c.highlight_lines === undefined || c.highlight_lines === null ? [] : c.highlight_lines;
      if (!Array.isArray(hl)) throw new InputError('expected a list of line numbers', hp);
      return {
        ...base,
        action: 'code',
        code: {
          id: str(field(c, 'id', p), join(p, 'id')),
          lang: opt(c, 'lang', p, str, 'text'),
          text: str(field(c, 'text', p), join(p, 'text')),
          at: pair(field(c, 'at', p), join(p, 'at')),
          size: opt<[number, number] | null>(c, 'size', p, size, null),
          typing: opt(c, 'typing', p, bool, false),
          highlight_lines: hl.map((x, i) => int(x, join(hp, i))),
        },
      };
    }
  }
}

/**
 * References a step makes, with the JSON path of each. `target` refs (highlight, show, hide) may
 * name a node or a text/code element created by an earlier step; the others must name a node.
 * These are the same rules as vidgen core's `need_node` / `need_target` (vidgen/src/vidgen/schema.py).
 */
type Ref = { id: string; path: string; target: boolean };

function stepRefs(s: StepIn, path: string): Ref[] {
  const p = join(path, s.action);
  const node = (id: string, at: string): Ref => ({ id, path: at, target: false });
  const target = (id: string, at: string): Ref => ({ id, path: at, target: true });
  switch (s.action) {
    case 'send':
      return [node(s.send.from, join(p, 'from')), node(s.send.to, join(p, 'to'))];
    case 'highlight':
      return [target(s.highlight.node, join(p, 'node'))];
    case 'show':
      return s.show.map((n, i) => target(n, join(p, i)));
    case 'hide':
      return s.hide.map((n, i) => target(n, join(p, i)));
    case 'badge':
      return [node(s.badge.near, join(p, 'near'))];
    case 'group':
      return s.group.nodes.map((n, i) => node(n, join(join(p, 'nodes'), i)));
    default:
      return [];
  }
}

/** Throws on a reference to an unknown node, or to an element that no earlier step created. */
function checkRefs(nodes: Record<string, NodeIn>, steps: StepIn[]): void {
  const elements = new Set<string>();
  steps.forEach((s, i) => {
    for (const r of stepRefs(s, join('scene.steps', i))) {
      if (r.id in nodes) continue;
      if (!r.target) throw new InputError(`unknown node "${r.id}"`, r.path);
      if (!elements.has(r.id)) throw new InputError(`unknown node or element "${r.id}"`, r.path);
    }
    if (s.action === 'text') elements.add(s.text.id);
    if (s.action === 'code') elements.add(s.code.id);
  });
}

/** Validates and normalizes one scene JSON value. Throws `InputError` naming the JSON path. */
export function parseScene(json: unknown): SceneInput {
  const o = obj(json, '');
  const version = field(o, 'version', '');
  if (version !== 1) throw new InputError(`unsupported version ${JSON.stringify(version)} (expected 1)`, 'version');
  const design = pair(field(o, 'design', ''), 'design');
  if (design[0] !== 1920 || design[1] !== 1080) throw new InputError('expected [1920, 1080]', 'design');
  const style = str(field(o, 'style', ''), 'style');
  if (style !== 'sketch-dark') throw new InputError(`unknown style "${style}" (expected sketch-dark)`, 'style');
  const width = int(field(o, 'width', ''), 'width');
  const height = int(field(o, 'height', ''), 'height');
  if (width <= 0) throw new InputError('expected a positive integer', 'width');
  if (height <= 0) throw new InputError('expected a positive integer', 'height');
  const fps = posNum(field(o, 'fps', ''), 'fps');
  const seed = int(field(o, 'seed', ''), 'seed');
  const title = str(field(o, 'title', ''), 'title');

  const sc = obj(field(o, 'scene', ''), 'scene');
  const id = str(field(sc, 'id', 'scene'), 'scene.id');
  const duration = posNum(field(sc, 'duration', 'scene'), 'scene.duration');
  const rawNodes = obj(field(sc, 'nodes', 'scene'), 'scene.nodes');
  const nodes: Record<string, NodeIn> = {};
  for (const [k, v] of Object.entries(rawNodes)) nodes[k] = parseNode(v, join('scene.nodes', k));
  const layout = parseLayout(field(sc, 'layout', 'scene'), 'scene.layout');
  const rawSteps = field(sc, 'steps', 'scene');
  if (!Array.isArray(rawSteps)) throw new InputError('expected a list', 'scene.steps');
  const steps = rawSteps.map((s, i) => parseStep(s, join('scene.steps', i)));

  checkRefs(nodes, steps);

  return {
    version: 1,
    width,
    height,
    fps,
    design: [1920, 1080],
    seed,
    style: 'sketch-dark',
    title,
    scene: { id, duration, nodes, layout, steps },
  };
}
