'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { executable } = require('./runtime');

function check() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const run = (name, args) => execFileSync(executable(name), args, { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const ffmpeg = run('ffmpeg', ['-version']).split('\n')[0].trim();
  const ffprobe = run('ffprobe', ['-version']).split('\n')[0].trim();
  const encoders = run('ffmpeg', ['-hide_banner', '-encoders']);
  for (const codec of ['libmp3lame', 'pcm_s24le', 'mjpeg', 'png']) {
    if (!new RegExp(`\\b${codec}\\b`).test(encoders)) throw new Error(`Missing audio/image encoder: ${codec}`);
  }
  // Covers arrive under a generic .img name; verify actual probing, not just codec lists.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-runtime-check-'));
  try {
    const input = path.join(scratch, 'cover.img');
    fs.copyFileSync(path.join(root, 'extension/assets/icon-128.png'), input);
    run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-frames:v', '1', '-c:v', 'mjpeg', path.join(scratch, 'cover.jpg')]);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return { version: manifest.version, node: process.version, ffmpeg, ffprobe };
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(check()) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { check };
