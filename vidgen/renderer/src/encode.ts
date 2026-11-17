import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Canvas, type CanvasRenderingContext2D } from 'skia-canvas';
import { drawFrame } from './draw.js';
import type { Model } from './model.js';

/**
 * Draws frames at output size. With `ssaa` N > 1 each frame is drawn at N x and downsampled
 * into the output canvas with high-quality smoothing.
 */
export class FrameRenderer {
  readonly canvas: Canvas;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hi: { canvas: Canvas; ctx: CanvasRenderingContext2D } | null;

  constructor(
    readonly model: Model,
    readonly ssaa = 1,
  ) {
    if (!Number.isInteger(ssaa) || ssaa < 1) throw new Error(`ssaa must be an integer >= 1, got ${ssaa}`);
    this.canvas = new Canvas(model.width, model.height);
    this.canvas.gpu = false;
    this.ctx = this.canvas.getContext('2d');
    if (ssaa > 1) {
      const canvas = new Canvas(model.width * ssaa, model.height * ssaa);
      canvas.gpu = false;
      this.hi = { canvas, ctx: canvas.getContext('2d') };
    } else {
      this.hi = null;
    }
  }

  /** Draws scene-local time t and returns the output canvas (reused between calls). */
  render(t: number): Canvas {
    if (!this.hi) {
      drawFrame(this.ctx, this.model, t);
      return this.canvas;
    }
    const { canvas, ctx } = this.hi;
    ctx.setTransform(this.ssaa, 0, 0, this.ssaa, 0, 0);
    drawFrame(ctx, this.model, t);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(canvas, 0, 0, this.model.width, this.model.height);
    return this.canvas;
  }

  /** Raw unpremultiplied RGBA bytes of time t, as ffmpeg's `-pix_fmt rgba` expects. */
  rgba(t: number): Buffer {
    return this.render(t).toBufferSync('raw', { colorType: 'rgba' });
  }
}

export function frameCount(m: Model): number {
  return Math.round(m.duration * m.fps);
}

/** `<out>.part.mp4`: `scene.mp4` writes `scene.part.mp4`, so ffmpeg still sees an .mp4 name. */
export function partPath(out: string): string {
  return `${out.replace(/\.mp4$/i, '')}.part.mp4`;
}

export function ffmpegArgs(m: Model, encoderArgs: string[], part: string): string[] {
  return [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${m.width}x${m.height}`,
    '-r', String(m.fps),
    '-i', '-',
    '-an',
    ...encoderArgs,
    '-pix_fmt', 'yuv420p',
    '-g', String(Math.round(m.fps)),
    '-movflags', '+faststart',
    part,
  ];
}

export type EncodeResult = { ok: true; frames: number } | { ok: false; stderrTail: string };

const TAIL_BYTES = 8192;

function tail(s: string, lines = 25): string {
  return s.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
}

/**
 * Pipes `round(duration * fps)` raw frames into ffmpeg, writing `<out>.part.mp4`, and renames it
 * to `out` only when ffmpeg exits 0. On any failure the part file is removed and `out` is left
 * untouched.
 */
export async function encodeScene(
  m: Model,
  opts: { out: string; ffmpeg: string; encoderArgs: string[]; ssaa?: number },
): Promise<EncodeResult> {
  const part = partPath(opts.out);
  const renderer = new FrameRenderer(m, opts.ssaa ?? 1);
  const n = frameCount(m);
  const child = spawn(opts.ffmpeg, ffmpegArgs(m, opts.encoderArgs, part), { stdio: ['pipe', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    stderr = (stderr + d).slice(-TAIL_BYTES);
  });
  let spawnError: Error | null = null;
  child.on('error', (e) => {
    spawnError = e;
  });
  let done = false;
  const closed = new Promise<number | null>((resolve) =>
    child.on('close', (code) => {
      done = true;
      resolve(code);
    }),
  );
  // ffmpeg may exit early (bad args); writes then fail with EPIPE, which the exit code reports.
  child.stdin.on('error', () => {});

  for (let i = 0; i < n && !done; i++) {
    const frame = renderer.rgba(i / m.fps);
    if (!child.stdin.write(frame)) {
      await Promise.race([once(child.stdin, 'drain').catch(() => undefined), closed]);
    }
  }
  child.stdin.end();
  const code = await closed;

  if (code === 0 && !spawnError) {
    await rename(part, opts.out);
    return { ok: true, frames: n };
  }
  await rm(part, { force: true });
  const why = spawnError ? `failed to run ${opts.ffmpeg}: ${(spawnError as Error).message}` : `ffmpeg exited with code ${code}`;
  return { ok: false, stderrTail: [tail(stderr), why].filter(Boolean).join('\n') };
}

/** Writes `<outDir>/<sceneId>-<t.toFixed(2)>.png` for each t and returns the paths in order. */
export async function writeFrames(m: Model, times: number[], outDir: string, ssaa = 1): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const renderer = new FrameRenderer(m, ssaa);
  const paths: string[] = [];
  for (const t of times) {
    const p = join(outDir, `${m.sceneId}-${t.toFixed(2)}.png`);
    await writeFile(p, await renderer.render(t).toBuffer('png'));
    paths.push(p);
  }
  return paths;
}
