const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function lifecycle(send, href = 'https://suno.com/me') {
  const events = new Map(), timers = new Set();
  let poll, messageListener, id = 'test', reads = 0, sends = 0, nextTimer = 0;
  const runtime = { get id() { return id; }, onMessage: {
    addListener(fn) { messageListener = fn; }, removeListener(fn) { if (fn === messageListener) messageListener = null; }
  }, sendMessage() { sends++; return send(); } };
  const document = { title: 'Suno', querySelectorAll() { reads++; return []; }, querySelector() { return null; },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); }
  };
  const context = { document, location: { href }, SunoPolicy: require('../extension/policy'), chrome: { runtime },
    setInterval(fn) { poll = fn; const id = ++nextTimer; timers.add(id); return id; }, clearInterval(id) { timers.delete(id); }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
  vm.runInContext(source, context);
  return { events, timers, poll: () => poll(), invalidate() { id = undefined; },
    reinject() { vm.runInContext(source, context); },
    get reads() { return reads; }, get sends() { return sends; }, get messageListener() { return messageListener; }
  };
}

test('extension reload stops stale content timers and listeners after a synchronous sendMessage exception', () => {
  const h = lifecycle(() => { throw new Error('Extension context invalidated.'); });
  assert.equal(h.sends, 1); assert.equal(h.timers.size, 0); assert.equal(h.events.size, 0); assert.equal(h.messageListener, null);
  const reads = h.reads;
  h.poll(); h.poll();
  assert.equal(h.sends, 1); assert.equal(h.reads, reads, 'stale callbacks stop reading the page as well as sending messages');
});

test('telemetry does not install if the tab navigated away from Suno before injection', () => {
  const h = lifecycle(() => Promise.resolve(), 'https://accounts.google.com/');
  assert.equal(h.sends, 0); assert.equal(h.timers.size, 0); assert.equal(h.events.size, 0); assert.equal(h.reads, 0);
});

test('reinjection replaces telemetry instead of doubling timers or keeping old callbacks alive', () => {
  const h = lifecycle(() => Promise.resolve());
  const oldCallback = h.events.get('timeupdate');
  h.reinject();
  assert.equal(h.timers.size, 1); assert.equal(h.events.size, 9);
  assert.notEqual(h.events.get('timeupdate'), oldCallback);
  const reads = h.reads;
  oldCallback({ type: 'timeupdate', target: { tagName: 'AUDIO' } });
  assert.equal(h.reads, reads);
  assert.ok(h.messageListener);
});

test('asynchronous invalidation and a vanished runtime ID also dispose stale telemetry', async () => {
  const rejected = lifecycle(() => Promise.reject(new Error('Extension context invalidated.')));
  await new Promise(setImmediate);
  assert.equal(rejected.timers.size, 0); assert.equal(rejected.events.size, 0); assert.equal(rejected.messageListener, null);
  const h = lifecycle(() => Promise.resolve());
  assert.ok(h.events.size > 0); h.invalidate(); h.poll();
  assert.equal(h.sends, 1); assert.equal(h.timers.size, 0); assert.equal(h.events.size, 0);
});

test('a temporary missing receiver is retried without disabling valid content telemetry', async () => {
  let attempt = 0;
  const h = lifecycle(() => ++attempt === 1 ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) : Promise.resolve());
  await new Promise(setImmediate); h.poll(); await new Promise(setImmediate);
  assert.equal(h.sends, 2); assert.equal(h.timers.size, 1); assert.ok(h.events.size > 0);
});
test('content telemetry ignores silent helper audio and preserves ended song identity when Suno changes the title early', () => {
  const events = new Map(), messages = [];
  const audio = { tagName: 'AUDIO', paused: false, ended: false, seeking: false, currentTime: 0, duration: 120, currentSrc: 'blob:first' };
  const silence = { tagName: 'AUDIO', paused: false, ended: false, currentTime: 0, duration: 100, currentSrc: 'https://cdn-o.suno.com/sil-100.mp3' };
  let title = 'First', href = '/song/first';
  const titleLink = { get textContent() { return title; }, getAttribute() { return href; } };
  const document = {
    title: 'Suno',
    querySelectorAll(selector) { return selector === 'audio' ? [silence, audio] : [titleLink]; },
    querySelector() { return null; },
    addEventListener(name, handler) { events.set(name, handler); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8'), {
    document, SunoPolicy: require('../extension/policy'), setInterval() {}, chrome: { runtime: { id: 'test', onMessage: { addListener() {} }, sendMessage(value) { messages.push(value); return Promise.resolve(); } } }
  });
  assert.equal(messages[0].sourceKey, 'blob:first');
  assert.equal(messages[0].duration, 120);
  title = 'Second'; href = '/song/second'; audio.currentTime = 120; audio.ended = true; audio.paused = true;
  events.get('ended')({ type: 'ended', target: audio });
  assert.equal(messages.at(-1).ended, true);
  assert.equal(messages.at(-1).track.title, 'First');
  assert.equal(messages.at(-1).track.id, '/song/first');
  assert.equal(messages.at(-1).currentTime, 120);
  const count = messages.length; events.get('play')({ target: silence });
  assert.equal(messages.length, count, 'the silence placeholder never starts a capture');
  audio.currentSrc = 'blob:second'; audio.currentTime = 0; audio.ended = false; audio.paused = false;
  events.get('playing')({ target: audio });
  assert.equal(messages.at(-1).track.title, 'Second');
  assert.equal(messages.at(-1).sourceKey, 'blob:second');
});

test('Media Session supplies live artist, album and artwork, while stale data from another generation is ignored without controlling audio', () => {
  const events = new Map(), messages = [];
  const first = 'a15e6b08-0f21-4623-9f6b-5928eef0c260', second = 'b15e6b08-0f21-4623-9f6b-5928eef0c260';
  let title = 'Same title', href = `/song/${first}`, wroteTime = 0;
  const audio = { tagName: 'AUDIO', paused: false, ended: false, duration: 120, currentSrc: 'blob:first',
    get currentTime() { return 12.4; }, set currentTime(_) { wroteTime++; },
    play() { throw new Error('Must not play'); }, pause() { throw new Error('Must not pause'); }
  };
  const titleLink = { get textContent() { return title; }, getAttribute() { return href; } };
  const mediaSession = { metadata: { title, artist: 'Real artist', album: 'Real album', artwork: [{ src: `https://cdn2.suno.ai/image_${first}.jpeg` }] },
    setActionHandler() { throw new Error('Must not register media controls'); }, setPositionState() { throw new Error('Must not change playback'); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8'), {
    navigator: { mediaSession }, document: { title: 'Suno', querySelectorAll: selector => selector === 'audio' ? [audio] : [titleLink], querySelector: () => null, addEventListener: (name, fn) => events.set(name, fn) },
    SunoPolicy: require('../extension/policy'), setInterval() {}, chrome: { runtime: { id: 'test', onMessage: { addListener() {} }, sendMessage(value) { messages.push(value); return Promise.resolve(); } } }
  });
  assert.equal(messages[0].track.album, 'Real album'); assert.equal(messages[0].track.artist, 'Real artist');
  assert.equal(messages[0].track.image_url, `https://cdn2.suno.ai/image_${first}.jpeg`); assert.equal(messages[0].currentTime, 12.4);
  href = `/song/${second}`; audio.currentSrc = 'blob:second'; events.get('playing')({ target: audio });
  assert.equal(messages.at(-1).track.album, '', 'same title does not authorize stale artwork/album from the previous generation');
  mediaSession.metadata = { title, artist: 'Next artist', album: '', artwork: [{ src: `https://cdn2.suno.ai/image_${second}.jpeg` }] };
  events.get('timeupdate')({ target: audio }); assert.equal(messages.at(-1).track.artist, 'Next artist'); assert.equal(messages.at(-1).track.album, '');
  mediaSession.metadata = { title: 'Previous title', artist: 'Wrong artist', album: 'Wrong album', artwork: [] };
  events.get('timeupdate')({ target: audio }); assert.equal(messages.at(-1).track.album, '');
  assert.equal(wroteTime, 0);
});
