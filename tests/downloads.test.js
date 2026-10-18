const test = require('node:test');
const assert = require('node:assert/strict');
const { save } = require('../extension/downloads');

function api() {
  const listeners = new Set(), calls = [];
  let item = { id: 4, state: 'in_progress', filename: 'D:\\My browser downloads\\Music (1).mp3' };
  return { calls, listeners,
    onChanged: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
    async download(options) { calls.push(options); return 4; },
    async search() { return [item]; }, async cancel() {},
    change(state) { item = { ...item, state }; for (const fn of listeners) fn({ id: 4, state: { current: state } }); }
  };
}
test('browser delivery uses a basename, waits for completion, and reports the actual conflict-renamed destination', async () => {
  const mock = api(); let done = false;
  const result = save(mock, 'blob:chrome-extension://test/audio', 'Music.mp3').then(value => { done = true; return value; });
  await new Promise(setImmediate); assert.equal(done, false);
  assert.deepEqual(mock.calls[0], { url: 'blob:chrome-extension://test/audio', filename: 'Music.mp3', conflictAction: 'uniquify', saveAs: false });
  mock.change('complete');
  assert.deepEqual(await result, { fileName: 'Music (1).mp3', filePath: 'D:\\My browser downloads\\Music (1).mp3' });
  assert.equal(mock.listeners.size, 0);
});
test('cancelled browser downloads reject without claiming a saved collection file', async () => {
  const mock = api(), result = save(mock, 'blob:test', 'Music.mp3');
  await new Promise(setImmediate); mock.change('interrupted');
  await assert.rejects(result, /отменена/); assert.equal(mock.listeners.size, 0);
  await assert.rejects(save(mock, 'https://example.com/audio', 'Music.mp3'), /Недопустимый/);
  await assert.rejects(save(mock, 'blob:test', '../escape.mp3'), /Недопустимый/);
});
