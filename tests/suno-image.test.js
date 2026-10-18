const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { downloadSunoImage } = require('../src/suno-image');
test('cover fetch checks every redirect and rejects non-images before writing a file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-image-test-')), target = path.join(dir, 'cover.jpg');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(downloadSunoImage('https://cdn2.suno.ai/cover.jpg', target, async (_, options) => {
    calls++; assert.equal(options.credentials, 'omit'); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private.jpg' } });
  }), /Only Suno/);
  assert.equal(calls, 1); assert.equal(fs.existsSync(target), false);
  await assert.rejects(downloadSunoImage('https://cdn2.suno.ai/cover.jpg', target, async () => new Response('<html>fail</html>', { headers: { 'content-type': 'text/html' } })), /content type/);
  assert.equal(fs.existsSync(target), false);
});
