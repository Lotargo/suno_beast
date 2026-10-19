const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../extension/policy');

test('toolbar action opens an authenticated panel bound to its Suno tab; closing the panel leaves capture running', async () => {
  let listener, onAction;
  const calls = [], hook = { addListener() {} }, tab = { id: 7, url: 'https://suno.com/me' };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy,
    SunoEnrichment: { createEnricher: () => ({ peek() {}, load: () => new Promise(() => {}) }) },
    chrome: {
      action: { onClicked: { addListener(fn) { onAction = fn; } }, async setTitle() {}, async setBadgeText() {} },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}` },
      tabs: { onRemoved: hook, onUpdated: hook, async get(id) { assert.equal(id, 7); return tab; }, async query() { return [{ id: 99 }]; },
        async sendMessage(id, message) {
          calls.push(message); assert.equal(id, 7);
          if (message.type === 'get-track') return { playing: true, currentTime: 42, track: { title: 'Own tab song' } };
          return { open: message.type === 'toggle-panel' };
        }
      }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  onAction(tab); await vm.runInContext('actions', context);
  const url = calls.find(c => c.type === 'toggle-panel').url;
  const sender = { tab, frameId: 2, documentId: 'panel-document', url };
  const send = (type, source = sender) => new Promise(resolve => listener({ target: 'background', type }, source, resolve));
  const status = await send('playback-status'); assert.equal(status.data.track.title, 'Own tab song'); assert.equal(status.data.playback.currentTime, 42);
  assert.equal((await send('playback-status', { ...sender, documentId: 'another-frame' })).ok, false);
  vm.runInContext('capturedTab = 7; state.recording = true; state.auto = true;', context);
  assert.equal((await send('close-panel')).ok, true);
  assert.equal(vm.runInContext('state.recording && state.auto && capturedTab === 7', context), true);
  assert.equal(calls.at(-1).type, 'hide-panel'); assert.equal((await send('playback-status')).ok, false);
});

test('opening the popup repairs missing Suno telemetry and returns current title and time', async () => {
  let listener, portListener, injected = false, injections = 0;
  const hook = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy, setTimeout, clearTimeout,
    SunoEnrichment: { createEnricher: () => ({ peek() {}, load: () => new Promise(() => {}) }) },
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { return {
        onMessage: { addListener(fn) { portListener = fn; } }, onDisconnect: hook,
        postMessage(message) { queueMicrotask(() => portListener({ id: message.id, ok: true, data: { outputMode: 'browser' } })); }
      }; } },
      tabs: { onRemoved: hook, onUpdated: hook, async query() { return [{ id: 7, url: 'https://suno.com/me' }]; },
        async sendMessage() {
          if (!injected) throw new Error('No receiving end');
          return { playing: true, currentTime: 42, duration: 120, track: { id: '/song/a15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'Restored song' } };
        }, reload() { throw new Error('Must not reload Suno'); }
      },
      scripting: { async executeScript() { injected = true; injections++; } }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const send = type => new Promise(resolve => listener({ target: 'background', type }, { url: 'chrome-extension://test/popup.html' }, resolve));
  const result = await send('status');
  assert.equal(result.ok, true); assert.equal(result.data.track.title, 'Restored song'); assert.equal(result.data.playback.currentTime, 42); assert.equal(injections, 1);
  await send('status'); assert.equal(injections, 1);
});

test('Auto-Grab cannot silently arm without a functioning content handshake', async () => {
  let listener, connections = 0, captures = 0;
  const hook = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy,
    SunoEnrichment: { createEnricher: () => ({ peek() {} }) },
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { connections++; throw new Error('Unexpected helper access'); } },
      tabs: { onRemoved: hook, onUpdated: hook, async query() { return [{ id: 7, url: 'https://suno.com/me' }]; }, async sendMessage() { throw new Error('No receiver'); } },
      scripting: { async executeScript() { throw new Error('Site access denied'); } },
      tabCapture: { async getMediaStreamId() { captures++; } }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const sender = { url: 'chrome-extension://test/popup.html' };
  const send = type => new Promise(resolve => listener({ target: 'background', type }, sender, resolve));
  const start = await send('toggle-auto'); assert.equal(start.ok, false); assert.match(start.error, /Нет связи со вкладкой Suno/);
  const status = await send('playback-status'); assert.equal(status.data.auto, false); assert.equal(captures, 0); assert.equal(connections, 0);
  assert.match(status.data.pageError, /Нет связи со вкладкой Suno/); assert.equal(status.data.error, '', 'recovered page errors must not become sticky encoder errors');
});

test('missing browser recording APIs fail clearly before helper access or capture', async () => {
  for (const missing of ['tabCapture', 'offscreen', 'getContexts']) {
    let listener, helperCalls = 0, captureCalls = 0;
    const hook = { addListener() {} };
    const chrome = {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`,
        connectNative() { helperCalls++; throw new Error('Unexpected helper access'); }, async getContexts() { return []; } },
      tabs: { onRemoved: hook, onUpdated: hook, async query() { return [{ id: 7, url: 'https://suno.com/me' }]; },
        async sendMessage() { return { playing: true, currentTime: 0, track: { title: 'Synthetic song' } }; } },
      offscreen: { async createDocument() { throw new Error('Unexpected offscreen creation'); } },
      tabCapture: { async getMediaStreamId() { captureCalls++; } }, webRequest: { onCompleted: hook }
    };
    if (missing === 'getContexts') delete chrome.runtime.getContexts; else delete chrome[missing];
    const context = vm.createContext({ importScripts() {}, chrome, SunoPanelSessions: require('../extension/panel-session'),
      SunoConnection: require('../extension/connection'), SunoPolicy: policy,
      SunoEnrichment: { createEnricher: () => ({ peek() {}, load: () => new Promise(() => {}) }) } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
    const sender = { url: 'chrome-extension://test/popup.html' };
    const send = type => new Promise(resolve => listener({ target: 'background', type }, sender, resolve));
    const result = await send('toggle-auto');
    assert.equal(result.ok, false, missing);
    assert.match(result.error, /Эта версия браузера не поддерживает/);
    assert.equal(helperCalls, 0); assert.equal(captureCalls, 0);
    assert.equal((await send('playback-status')).data.auto, false);
    if (missing !== 'tabCapture') {
      const direct = await send('grab');
      assert.equal(direct.ok, false); assert.match(direct.error, /фоновую обработку аудио/);
      assert.equal(helperCalls, 0);
    }
  }
});

test('folder action opens the browser default Downloads folder or the custom native folder according to saved mode', async () => {
  let listener, portListener, mode = 'browser', browserOpens = 0, helperOpens = 0;
  const hook = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy, SunoEnrichment: require('../extension/enrichment'), setTimeout, clearTimeout,
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { return {
        onMessage: { addListener(fn) { portListener = fn; } }, onDisconnect: hook,
        postMessage(message) {
          if (message.type === 'folder') helperOpens++;
          queueMicrotask(() => portListener({ id: message.id, ok: true, data: { outputMode: mode, outputDir: mode === 'custom' ? 'D:\\Music' : '' } }));
        }
      }; } },
      downloads: { showDefaultFolder() { browserOpens++; } },
      tabs: { onRemoved: hook, onUpdated: hook }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const open = () => new Promise(resolve => listener({ target: 'background', type: 'folder' }, { url: 'chrome-extension://test/popup.html' }, resolve));
  assert.equal((await open()).ok, true); assert.equal(browserOpens, 1); assert.equal(helperOpens, 0);
  mode = 'custom'; assert.equal((await open()).ok, true); assert.equal(browserOpens, 1); assert.equal(helperOpens, 1);
});
test('page scripts cannot invoke privileged native commands, even on Suno', async () => {
  let listener, connections = 0;
  const hook = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy, SunoEnrichment: require('../extension/enrichment'), setTimeout, clearTimeout, URL,
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { connections++; throw new Error('Unexpected native access'); } },
      tabs: { onRemoved: hook, onUpdated: hook }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const send = (message, sender) => new Promise(resolve => listener({ target: 'background', ...message }, sender, resolve));
  for (const type of ['native', 'grab', 'toggle-record', 'folder', 'choose-folder', 'reset-folder', 'link-existing', 'download-output', 'playback-status', 'recorder-state', 'recover']) {
    const result = await send({ type, command: 'folder' }, { tab: { id: 1 }, url: 'https://suno.com/create' });
    assert.equal(result.ok, false); assert.match(result.error, /источник/);
  }
  const lookalike = await send({ type: 'track-state' }, { tab: { id: 1 }, url: 'https://suno.com.evil.test' });
  assert.equal(lookalike.ok, false); assert.equal(connections, 0);
});

test('live playback status reads cached telemetry without native RPC and follows the captured tab across autoplay', async () => {
  let listener, connections = 0;
  const hook = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy, SunoEnrichment: { createEnricher: () => ({ peek() {}, load() { return new Promise(() => {}); } }) },
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { connections++; throw new Error('Clock cannot depend on native host'); } },
      tabs: { onRemoved: hook, onUpdated: hook, async query() { return [{ id: 99 }]; } }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  vm.runInContext('capturedTab = 7', context);
  const send = (message, sender) => new Promise(resolve => listener({ target: 'background', ...message }, sender, resolve));
  const sender = { tab: { id: 7 }, url: 'https://suno.com/me' };
  // No offscreen in this harness: update the cache, then read it while capture is selected.
  vm.runInContext('capturedTab = null', context);
  await send({ type: 'track-state', currentTime: 42.4, duration: 200, playing: true, track: { id: '/song/a15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'First', album: 'Album one' } }, sender);
  vm.runInContext('capturedTab = 7', context);
  const first = await send({ type: 'playback-status' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(first.data.playback.currentTime, 42.4); assert.equal(first.data.track.album, 'Album one');
  vm.runInContext('capturedTab = null', context);
  await send({ type: 'track-state', currentTime: 0, duration: 240, playing: true, track: { id: '/song/b15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'Second', album: '' } }, sender);
  vm.runInContext('capturedTab = 7', context);
  const second = await send({ type: 'playback-status' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(second.data.playback.currentTime, 0); assert.equal(second.data.track.title, 'Second'); assert.equal(second.data.track.album, '');
  assert.equal(connections, 0);
});
test('slow metadata does not block track transitions and stale responses cannot overwrite the next song', async () => {
  let listener, portListener;
  const waiting = new Map(), hook = { addListener() {} };
  const first = 'a15e6b08-0f21-4623-9f6b-5928eef0c260', second = 'b15e6b08-0f21-4623-9f6b-5928eef0c260';
  const context = vm.createContext({
    importScripts() {}, SunoPanelSessions: require('../extension/panel-session'), SunoConnection: require('../extension/connection'), SunoPolicy: policy, setTimeout, clearTimeout, URL,
    SunoEnrichment: { createEnricher() { return { peek() {}, load(id) { return new Promise(resolve => waiting.set(id, resolve)); } }; } },
    chrome: {
      action: { onClicked: hook },
      runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://test/${file}`, connectNative() { return {
        onMessage: { addListener(fn) { portListener = fn; } }, onDisconnect: hook,
        postMessage(message) { queueMicrotask(() => portListener({ id: message.id, ok: true, data: { outputDir: 'test' } })); }
      }; } },
      tabs: { onRemoved: hook, onUpdated: hook, async query() { return [{ id: 1 }]; } }, webRequest: { onCompleted: hook }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const send = (message, sender) => new Promise(resolve => listener({ target: 'background', ...message }, sender, resolve));
  const sender = { tab: { id: 1 }, url: 'https://suno.com/create' };
  await send({ type: 'track-state', track: { id: `/song/${first}`, title: 'First' } }, sender);
  await send({ type: 'track-state', track: { id: `/song/${second}`, title: 'Second' } }, sender);
  assert.equal(waiting.size, 2, 'both transitions completed while metadata fetches are unresolved');
  waiting.get(first)({ title: 'Wrong stale title', metadata_status: 'ready' }); await new Promise(setImmediate);
  const status = await send({ type: 'status' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(status.data.track.title, 'Second');
  waiting.get(second)({ title: 'Enriched second', tags: 'Second style', metadata_status: 'ready' }); await new Promise(setImmediate);
  const enriched = await send({ type: 'status' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(enriched.data.track.title, 'Enriched second'); assert.equal(enriched.data.track.tags, 'Second style');
});
