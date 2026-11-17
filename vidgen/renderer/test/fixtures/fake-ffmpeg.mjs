// A stand-in for ffmpeg in tests: reads raw RGBA frames from stdin, slowly enough to exercise
// backpressure, and writes {"frames": n} to its output path (the last argument). With
// `-c:v fail` it writes a partial output, prints an error and exits 1.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.at(-1);
const [w, h] = args[args.indexOf('-s') + 1].split('x').map(Number);
const fail = args[args.indexOf('-c:v') + 1] === 'fail';
let bytes = 0;
let chunks = 0;

process.stdin.on('data', (d) => {
  bytes += d.length;
  if (++chunks % 8 === 0) {
    process.stdin.pause();
    setTimeout(() => process.stdin.resume(), 2);
  }
});
process.stdin.on('end', () => {
  writeFileSync(out, JSON.stringify({ frames: bytes / (w * h * 4), args }));
  if (fail) {
    process.stderr.write('Unknown encoder fail\n');
    process.exit(1);
  }
  process.exit(0);
});
