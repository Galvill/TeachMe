import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { encodeScene, writeFrames } from './encode.js';
import { lintScene } from './lint.js';
import { buildModel, type Model } from './model.js';
import { InputError, parseScene } from './scene.js';

export const USAGE = `usage:
  node dist/cli.js render --scene <file.json> --out <file.mp4> --ffmpeg <path> --encoder '<json>' [--ssaa N]
  node dist/cli.js frames --scene <file.json> --t <sec> [--t <sec>...] --out-dir <dir> [--ssaa N]
  node dist/cli.js lint   --scene <file.json>
exit: 0 ok · 1 lint issues · 2 bad input · 3 ffmpeg failed
encoder json: { "args": ["-c:v","libx264","-crf","18","-preset","slow"] }`;

export const EXIT = { ok: 0, lint: 1, input: 2, ffmpeg: 3 } as const;

export type Io = { out(line: string): void; err(line: string): void };
const stdio: Io = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
};

class UsageError extends Error {}

type Opts = Map<string, string[]>;

const KNOWN: Record<string, string[]> = {
  render: ['scene', 'out', 'ffmpeg', 'encoder', 'ssaa'],
  frames: ['scene', 't', 'out-dir', 'ssaa'],
  lint: ['scene'],
};

function parseOpts(cmd: string, args: string[]): Opts {
  const opts: Opts = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument "${a}"`);
    let key = a.slice(2);
    let val: string | undefined;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else {
      val = args[++i];
    }
    if (!KNOWN[cmd]!.includes(key)) throw new UsageError(`unknown option --${key} for ${cmd}`);
    if (val === undefined) throw new UsageError(`--${key} needs a value`);
    opts.set(key, [...(opts.get(key) ?? []), val]);
  }
  return opts;
}

function one(opts: Opts, key: string, dflt?: string): string {
  const v = opts.get(key);
  if (!v) {
    if (dflt !== undefined) return dflt;
    throw new UsageError(`--${key} is required`);
  }
  if (v.length > 1) throw new UsageError(`--${key} given more than once`);
  return v[0]!;
}

function ssaaOf(opts: Opts): number {
  const raw = one(opts, 'ssaa', '1');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new UsageError(`--ssaa must be an integer from 1 to 8, got "${raw}"`);
  return n;
}

function encoderArgsOf(raw: string): string[] {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new UsageError('--encoder is not valid JSON');
  }
  const args = (j as { args?: unknown } | null)?.args;
  if (!Array.isArray(args) || !args.every((x) => typeof x === 'string')) {
    throw new UsageError('--encoder must be {"args": [<string>, ...]}');
  }
  return args as string[];
}

async function loadModel(path: string): Promise<Model> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new InputError(`cannot read scene file: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new InputError(`${path}: invalid JSON: ${(e as Error).message}`);
  }
  return buildModel(parseScene(json));
}

async function render(opts: Opts, io: Io): Promise<number> {
  const out = one(opts, 'out');
  const ffmpeg = one(opts, 'ffmpeg', 'ffmpeg');
  const encoderArgs = encoderArgsOf(one(opts, 'encoder', '{"args":["-c:v","libx264","-crf","18","-preset","slow"]}'));
  const ssaa = ssaaOf(opts);
  const m = await loadModel(one(opts, 'scene'));
  const r = await encodeScene(m, { out, ffmpeg, encoderArgs, ssaa });
  if (!r.ok) {
    io.err(r.stderrTail);
    return EXIT.ffmpeg;
  }
  io.out(out);
  return EXIT.ok;
}

async function frames(opts: Opts, io: Io): Promise<number> {
  const times = (opts.get('t') ?? []).map((raw) => {
    const t = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(t) || t < 0) throw new UsageError(`--t must be a number >= 0, got "${raw}"`);
    return t;
  });
  if (times.length === 0) throw new UsageError('--t is required');
  const outDir = one(opts, 'out-dir');
  const ssaa = ssaaOf(opts);
  const m = await loadModel(one(opts, 'scene'));
  for (const p of await writeFrames(m, times, outDir, ssaa)) io.out(p);
  return EXIT.ok;
}

/** One JSON issue per line, then `{"densest":[...]}`; exit 1 when there is any issue. */
async function lint(opts: Opts, io: Io): Promise<number> {
  const m = await loadModel(one(opts, 'scene'));
  const { issues, densest } = lintScene(m);
  for (const i of issues) io.out(JSON.stringify(i));
  io.out(JSON.stringify({ densest }));
  return issues.length > 0 ? EXIT.lint : EXIT.ok;
}

/** Runs one CLI invocation (`argv` without node and script) and returns the exit code. */
export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === undefined || cmd === '-h' || cmd === '--help') {
      (cmd === undefined ? io.err : io.out)(USAGE);
      return cmd === undefined ? EXIT.input : EXIT.ok;
    }
    if (!(cmd in KNOWN)) throw new UsageError(`unknown command "${cmd}"`);
    const opts = parseOpts(cmd, rest);
    if (cmd === 'render') return await render(opts, io);
    if (cmd === 'frames') return await frames(opts, io);
    return await lint(opts, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}\n${USAGE}`);
      return EXIT.input;
    }
    if (e instanceof InputError) {
      io.err(`error: ${e.message}`);
      return EXIT.input;
    }
    throw e;
  }
}

async function isEntry(): Promise<boolean> {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(await realpath(script)).href;
  } catch {
    return false;
  }
}

if (await isEntry()) {
  process.exitCode = await main(process.argv.slice(2));
}
