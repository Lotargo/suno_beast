const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executable } = require('../native/runtime');

test('installed tools stay inside the bundle; incomplete bundles never fall back to system tools', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(executable('ffmpeg', root), 'ffmpeg');
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'runtime/node.exe'), 'fixture');
  assert.throws(() => executable('ffmpeg', root), /Bundled audio tool is missing/);
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = path.join(root, 'runtime', `${name}.exe`);
    fs.writeFileSync(file, 'fixture');
    assert.equal(executable(name, root), file);
  }
  assert.throws(() => executable('../other', root), /Unknown audio tool/);
});
