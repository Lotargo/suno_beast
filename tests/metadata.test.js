const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSong } = require('../extension/metadata');
const { createEnricher } = require('../extension/enrichment');
const { isImageUrl, songId } = require('../extension/policy');
const ID = 'a15e6b08-0f21-4623-9f6b-5928eef0c260';
function page(lyrics = 'Текст 🙂\n[Verse]\nПродолжение') {
  const clip = { id: ID, title: 'Track', display_name: 'Artist', image_large_url: 'https://cdn2.suno.ai/image_large_test.jpeg', metadata: { tags: 'witch house, deep bass', prompt: '$bb', duration: 207.2, model_badges: { songrow: { display_name: 'V6-MINI' } }, make_instrumental: false } };
  const stream = `1:${JSON.stringify({ children: [{ clip }] })}\nbb:T${Buffer.byteLength(lyrics).toString(16)},${lyrics}\n2:{"next":"value"}\n`;
  const split = Math.floor(stream.length / 2);
  return [stream.slice(0, split), stream.slice(split)].map(part => `<script>self.__next_f.push(${JSON.stringify([1, part]).replace(/</g, '\\u003c')})</script>`).join('');
}
test('reads exact-song Flight data and full referenced Unicode lyrics without executing scripts', () => {
  const lyrics = 'Текст 🙂\n'.repeat(400) + '</script> $string [end]';
  const metadata = parseSong(page(lyrics) + '<script>globalThis.neverExecuteThis = true</script>', ID);
  assert.equal(metadata.lyrics, lyrics); assert.equal(metadata.tags, 'witch house, deep bass');
  assert.equal(metadata.model, 'V6-MINI'); assert.equal(metadata.duration, 207.2);
  assert.equal(metadata.image_url, 'https://cdn2.suno.ai/image_large_test.jpeg');
  assert.equal(globalThis.neverExecuteThis, undefined);
  assert.equal(parseSong(page(), 'b15e6b08-0f21-4623-9f6b-5928eef0c260'), null);
  assert.equal(parseSong('<html>Sign in required</html>', ID), null);
});
test('cover and song addresses reject arbitrary hosts, credentials, files and spoofed domains', () => {
  for (const value of ['https://cdn2.suno.ai/image.jpeg', 'https://cdn-o.suno.com/image.webp?width=400']) assert.equal(isImageUrl(value), true);
  for (const value of ['https://cdn2.suno.ai.evil.test/image.jpg', 'http://cdn2.suno.ai/image.jpg', 'file:///cover.jpg', 'https://user:pass@cdn2.suno.ai/image.jpg']) assert.equal(isImageUrl(value), false);
  assert.equal(songId(`https://suno.com/song/${ID}`), ID);
  assert.equal(songId(`https://suno.com.evil.test/song/${ID}`), '');
});
test('enrichment deduplicates requests, uses no credentials or audio fetch, and caches failures with manual retry', async () => {
  let calls = 0, fail = false;
  const enrichment = createEnricher(async (url, options) => {
    calls++; assert.equal(url, `https://suno.com/song/${ID}`); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    await new Promise(setImmediate);
    return new Response(fail ? 'unavailable' : page(), { status: fail ? 503 : 200 });
  });
  const [a, b] = await Promise.all([enrichment.load(ID), enrichment.load(ID)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await enrichment.load(ID); assert.equal(calls, 1);
  fail = true; await assert.rejects(enrichment.load(ID, true), /503/);
  assert.equal((await enrichment.load(ID)).metadata_status, 'unavailable'); assert.equal(calls, 2);
  fail = false; assert.equal((await enrichment.load(ID, true)).metadata_status, 'ready'); assert.equal(calls, 3);
});
module.exports = { page, ID };
