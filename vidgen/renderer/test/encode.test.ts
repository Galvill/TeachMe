import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadImage } from 'skia-canvas';
import { main, type Io } from '../src/cli.js';
import { ffmpegArgs, frameCount, partPath } from '../src/encode.js';
import { buildModel } from '../src/model.js';
import { parseScene } from '../src/scene.js';
import { baseScene } from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'vidgen-renderer-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function capture(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

/** A short draft-size scene so encoding stays fast. */
function writeScene(dir: string): string {
  const j = baseScene();
  j.width = 640;
  j.height = 360;
  j.fps = 30;
  j.scene.duration = 1.0;
  j.scene.steps[0].start = 0.1;
  j.scene.steps[0].duration = 0.6;
  const p = join(dir, 'scene.json');
  writeFileSync(p, JSON.stringify(j));
  return p;
}

/** A `ffmpeg` shell wrapper around test/fixtures/fake-ffmpeg.mjs, so encode runs without ffmpeg. */
function fakeFfmpeg(dir: string): string {
  const script = fileURLToPath(new URL('./fixtures/fake-ffmpeg.mjs', import.meta.url));
  const p = join(dir, 'ffmpeg');
  writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(p, 0o755);
  return p;
}

const X264 =JSON.stringify({ args: ['-c:v', 'libx264', '-crf', '18', '-preset', 'ultrafast'] });

describe('encode helpers', () => {
  it('builds the ffmpeg command line', () => {
    const m = buildModel(parseScene(baseScene()));
    expect(frameCount(m)).toBe(Math.round(6.4333 * 30));
    expect(partPath('/x/intro.mp4')).toBe('/x/intro.part.mp4');
    expect(ffmpegArgs(m, ['-c:v', 'libx264'], '/x/intro.part.mp4')).toEqual([
      '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-r', '30', '-i', '-', '-an',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart', '/x/intro.part.mp4',
    ]);
  });
});

describe('cli render', () => {
  it.skipIf(!hasFfmpeg)('frame count matches duration', async () => {
    const d = tmp();
    const out = join(d, 'scene.mp4');
    const io = capture();
    const code = await main(['render', '--scene', writeScene(d), '--out', out, '--ffmpeg', 'ffmpeg', '--encoder', X264, '--ssaa', '2'], io);
    expect(io.stderr.join('\n')).toBe('');
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(partPath(out))).toBe(false);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,width,height,pix_fmt', '-of', 'json', out,
    ]);
    const stream = JSON.parse(probe.stdout.toString()).streams[0];
    expect(Number(stream.nb_frames)).toBe(30);
    expect([stream.width, stream.height, stream.pix_fmt]).toEqual([640, 360, 'yuv420p']);
  });

  it.skipIf(!hasFfmpeg)('failed ffmpeg leaves no output', async () => {
    const d = tmp();
    const out = join(d, 'scene.mp4');
    const io = capture();
    const bad = JSON.stringify({ args: ['-c:v', 'no-such-encoder'] });
    const code = await main(['render', '--scene', writeScene(d), '--out', out, '--ffmpeg', 'ffmpeg', '--encoder', bad], io);
    expect(code).toBe(3);
    expect(io.stderr.join('\n')).toMatch(/no-such-encoder|Unknown encoder/i);
    expect(readdirSync(d)).toEqual(['scene.json']);
  });

  it.skipIf(process.platform === 'win32')('streams every frame and renames on success (fake ffmpeg)', async () => {
    const d = tmp();
    const out = join(d, 'scene.mp4');
    const io = capture();
    const code = await main(['render', '--scene', writeScene(d), '--out', out, '--ffmpeg', fakeFfmpeg(d), '--encoder', X264], io);
    expect(io.stderr).toEqual([]);
    expect(code).toBe(0);
    expect(io.stdout).toEqual([out]);
    const got = JSON.parse(readFileSync(out, 'utf8'));
    expect(got.frames).toBe(30);
    expect(got.args.at(-1)).toBe(partPath(out));
    expect(existsSync(partPath(out))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('failed encode removes the part file (fake ffmpeg)', async () => {
    const d = tmp();
    const out = join(d, 'scene.mp4');
    const io = capture();
    const bad = JSON.stringify({ args: ['-c:v', 'fail'] });
    const code = await main(['render', '--scene', writeScene(d), '--out', out, '--ffmpeg', fakeFfmpeg(d), '--encoder', bad], io);
    expect(code).toBe(3);
    expect(io.stderr.join('\n')).toMatch(/Unknown encoder fail[\s\S]*exited with code 1/);
    expect(readdirSync(d).sort()).toEqual(['ffmpeg', 'scene.json']);
  });

  it('missing ffmpeg binary exits 3 with no output', async () => {
    const d = tmp();
    const out = join(d, 'scene.mp4');
    const io = capture();
    const code = await main(['render', '--scene', writeScene(d), '--out', out, '--ffmpeg', join(d, 'no-ffmpeg'), '--encoder', X264], io);
    expect(code).toBe(3);
    expect(io.stderr.join('\n')).toMatch(/failed to run/);
    expect(readdirSync(d)).toEqual(['scene.json']);
  });

  it('bad input exits 2', async () => {
    const d = tmp();
    const io = capture();
    expect(await main(['render', '--scene', join(d, 'missing.json'), '--out', join(d, 'x.mp4')], io)).toBe(2);
    const p = join(d, 'bad.json');
    writeFileSync(p, JSON.stringify({ ...baseScene(), version: 9 }));
    expect(await main(['frames', '--scene', p, '--t', '1', '--out-dir', d], io)).toBe(2);
    expect(io.stderr.at(-1)).toMatch(/version: unsupported version 9/);
    expect(await main(['render', '--scene', p, '--out', 'x.mp4', '--encoder', '[]'], io)).toBe(2);
    expect(await main(['frames', '--scene', p, '--bogus', '1'], io)).toBe(2);
    expect(await main(['explode'], io)).toBe(2);
  });
});

describe('cli frames', () => {
  it('frames writes named pngs', async () => {
    const d = tmp();
    const outDir = join(d, 'frames');
    const io = capture();
    const code = await main(['frames', '--scene', writeScene(d), '--t', '0.5', '--t', '1', '--out-dir', outDir, '--ssaa', '2'], io);
    expect(code).toBe(0);
    const want = [join(outDir, 'intro-0.50.png'), join(outDir, 'intro-1.00.png')];
    expect(io.stdout).toEqual(want);
    for (const p of want) {
      const img = await loadImage(p);
      expect([img.width, img.height]).toEqual([640, 360]);
    }
  });
});
