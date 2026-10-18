const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../extension/connection');
const policy = require('../extension/policy');
const tab = { id: 7, url: 'https://suno.com/me' };
const snapshot = { playing: true, currentTime: 42, duration: 120, track: { id: '/song/a15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'Current song' } };

test('a stale or absent content context is reconnected in the Suno main frame without reloading or changing playback', async () => {
  let reads = 0;
  const injections = [];
  const connection = create({ tabs: {
    async sendMessage(id, message, options) {
      assert.equal(id, tab.id); assert.equal(message.type, 'get-track'); assert.equal(options.frameId, 0);
      if (++reads === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return snapshot;
    }, reload() { throw new Error('Must not reload a playing page'); }
  }, scripting: { async executeScript(options) { injections.push(options); } } }, policy);
  assert.equal(await connection.ensure(tab), snapshot);
  assert.deepEqual(injections, [{ target: { tabId: 7, frameIds: [0] }, files: ['policy.js', 'panel-host.js', 'content.js'], world: 'ISOLATED' }]);
  assert.equal(reads, 2);
});

test('concurrent popup/start handshakes share one reinjection; healthy scripts are left running', async () => {
  let injected = false, injections = 0;
  const connection = create({ tabs: { async sendMessage() { return injected ? snapshot : undefined; } }, scripting: { async executeScript() { injections++; injected = true; } } }, policy);
  const [first, second] = await Promise.all([connection.ensure(tab), connection.ensure(tab)]);
  assert.equal(first, snapshot); assert.equal(second, snapshot); assert.equal(injections, 1);
  assert.equal(await connection.ensure(tab), snapshot); assert.equal(injections, 1);
});

test('repair never injects into Google, lookalike hosts, or arbitrary tabs; permission failures remain visible', async () => {
  let injections = 0;
  const connection = create({ tabs: { async sendMessage() { throw new Error('No receiver'); } }, scripting: { async executeScript() { injections++; throw new Error('Cannot access contents of url'); } } }, policy);
  for (const url of ['https://accounts.google.com/', 'https://suno.com.evil.test/', 'chrome://extensions/']) {
    await assert.rejects(connection.ensure({ ...tab, url }), /только во вкладке suno.com/);
  }
  assert.equal(injections, 0);
  await assert.rejects(connection.ensure(tab), /Нет связи со вкладкой Suno.*Cannot access/);
  assert.equal(injections, 1);
});
