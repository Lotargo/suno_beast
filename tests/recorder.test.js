const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Blob } = require('node:buffer');
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
function song(id, extra = {}) {
  return { playing: true, ended: false, currentTime: 0, duration: 10, sourceKey: `blob:${id}`, track: { id, title: id }, ...extra };
}
function harness({ delayedStop = false, blockFinish = false, checkTrack = async () => ({}), beginDuplicate = false, transfer = false, cancelDownload = false } = {}) {
  let listener, connections = 0, mediaStops = 0;
  const states = [], records = [], jobs = [], calls = [], stopped = [], timers = new Map();
  let unlock;
  const finishGate = blockFinish ? new Promise(resolve => { unlock = resolve; }) : Promise.resolve();
  class Recorder {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.index = records.length + 1; records.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const fire = () => { this.ondataavailable({ data: new Blob([`audio-${this.index}`]) }); this.onstop(); };
      if (delayedStop) stopped.push(fire); else fire();
    }
  }
  const context = vm.createContext({
    MediaRecorder: Recorder, Blob, Uint8Array, URL, SunoPolicy: require('../extension/policy'), btoa: text => Buffer.from(text, 'binary').toString('base64'), atob: text => Buffer.from(text, 'base64').toString('binary'),
    setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    AudioContext: class { createMediaStreamSource() { return { connect() { connections++; } }; } get destination() { return {}; } async resume() {} async close() {} },
    navigator: { mediaDevices: { async getUserMedia() { const track = { stop() { mediaStops++; }, addEventListener() {} }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) {
      calls.push(message);
      if (message.type === 'recorder-state') states.push(message.state);
      if (message.command === 'check-track') return { ok: true, data: await checkTrack(message.data.track) };
      if (message.command === 'begin') {
        if (beginDuplicate) return { ok: true, data: { duplicate: true, fileName: 'Existing.mp3' } };
        const job = { id: jobs.length + 1, track: message.data.track, options: message.data.options, chunks: [], finished: false }; jobs.push(job);
        return { ok: true, data: { job: job.id } };
      }
      if (message.command === 'chunk') jobs.find(j => j.id === message.data.job).chunks.push(Buffer.from(message.data.data, 'base64').toString());
      if (message.command === 'finish') {
        await finishGate;
        const job = jobs.find(j => j.id === message.data.job); job.finished = true;
        return { ok: true, data: { fileName: `${job.track.title}.mp3`, ...(transfer ? { transfer: job.id, fileSize: 5 } : {}) } };
      }
      if (message.command === 'read-output') return { ok: true, data: { data: Buffer.from('audio').toString('base64') } };
      if (message.type === 'download-output') return cancelDownload ? { ok: false, error: 'Загрузка отменена' } : { ok: true, data: { filePath: 'C:\\Downloads\\audio.mp3' } };
      if (message.command === 'commit-output') return { ok: true, data: { fileName: 'audio.mp3' } };
      if (message.command === 'defer-output') return { ok: true, data: { recoveryPath: 'C:\\State\\pending\\audio.mp3' } };
      return { ok: true, data: {} };
    } } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/offscreen.js'), 'utf8'), context);
  const send = data => new Promise(resolve => listener({ target: 'offscreen', ...data }, { id: 'test' }, resolve));
  return { send, records, jobs, states, calls, stopped, unlock: () => unlock?.(),
    arm: (snapshot = song('one', { playing: false }), auto = true) => send({ type: 'arm', streamId: 'id', auto, options: { format: 'mp3' }, snapshot }),
    sync: snapshot => send({ type: 'sync', snapshot }),
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    get connections() { return connections; }, get mediaStops() { return mediaStops; }
  };
}
test('autoplay starts the next recorder before old onstop or slow FFmpeg finishes; chunks and titles stay separate', async () => {
  const h = harness({ delayedStop: true, blockFinish: true });
  await h.arm(); assert.equal(h.connections, 1);
  await h.sync(song('one')); assert.equal(h.records[0].state, 'recording');
  await h.sync(song('one', { playing: false, ended: true, event: 'ended', currentTime: 10 }));
  await h.sync(song('two'));
  assert.equal(h.records.length, 2); assert.equal(h.records[1].state, 'recording');
  assert.equal(h.jobs.length, 0, 'the old stop callback has not even run');
  h.stopped.shift()(); await tick();
  assert.equal(h.jobs.length, 1); assert.equal(h.jobs[0].finished, false, 'FFmpeg is deliberately blocked');
  assert.equal(h.records[1].state, 'recording', 'second intro must already be captured');
  await h.sync(song('two', { playing: false, ended: true, currentTime: 10 }));
  h.stopped.shift()(); await tick();
  await h.sync(song('three'));
  assert.equal(h.records[2].state, 'recording', 'the third track also ignores the save queue');
  h.unlock(); await tick();
  assert.equal(h.jobs.length, 2);
  assert.equal(h.jobs[0].track.title, 'one'); assert.deepEqual(h.jobs[0].chunks, ['audio-1']);
  assert.equal(h.jobs[1].track.title, 'two'); assert.deepEqual(h.jobs[1].chunks, ['audio-2']);
  const disarmed = h.send({ type: 'disarm' }); await tick(); h.stopped.shift()(); await disarmed; await tick();
  assert.equal(h.jobs.length, 2, 'turning Auto-Grab off discards the unfinished third song');
  assert.equal(h.mediaStops, 1);
});
test('manual skip discards an incomplete track and starts the next track immediately', async () => {
  const h = harness(); await h.arm(); await h.sync(song('one'));
  await h.sync(song('one', { currentTime: 3 })); await h.sync(song('two')); await tick();
  assert.equal(h.jobs.length, 0); assert.equal(h.records.length, 2);
  await h.sync(song('two', { ended: true, playing: false, currentTime: 10 })); await tick();
  assert.equal(h.jobs.length, 1); assert.equal(h.jobs[0].track.title, 'two');
});
test('pause discards the fragment even when repeated paused snapshots arrive; resume in the middle is ignored', async () => {
  const h = harness(); await h.arm(); await h.sync(song('one'));
  await h.sync(song('one', { playing: false, event: 'pause', currentTime: 3 }));
  await h.sync(song('one', { playing: false, currentTime: 3 }));
  h.flushTimers(); await tick();
  assert.equal(h.jobs.length, 0); assert.equal(h.records[0].state, 'inactive');
  assert.ok(h.states.some(s => s.notice?.includes('Оборванная')));
  assert.equal(h.calls.filter(c => c.type === 'recover' || c.command === 'begin').length, 0, 'no broken output or Recovery artifact is created');
  await h.sync(song('one', { currentTime: 3.1 })); assert.equal(h.records.length, 1);
  await h.sync(song('one')); assert.equal(h.records.length, 2, 'restart from zero can create a full recording');
});
test('seeking invalidates a recording, while explicit manual Stop can save an intentional excerpt', async () => {
  const h = harness(); await h.arm(); await h.sync(song('one'));
  await h.sync(song('one', { event: 'seeking', seeking: true, currentTime: 5 }));
  await h.sync(song('one', { currentTime: 6 })); await tick();
  assert.equal(h.jobs.length, 0); assert.equal(h.records.length, 1);
  const manual = harness(); await manual.arm(song('one', { currentTime: 2 }), false);
  await manual.send({ type: 'disarm' }); await tick();
  assert.equal(manual.jobs.length, 1); assert.equal(manual.mediaStops, 1);
  assert.equal(manual.jobs[0].track.complete, false);
});

test('a slow duplicate lookup never delays the next intro; a known duplicate is discarded once', async () => {
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const h = harness({ checkTrack: track => track.title === 'one' ? gate : Promise.resolve({}) });
  await h.arm(); await h.sync(song('one'));
  await h.sync(song('one', { ended: true, currentTime: 10, playing: false }));
  await h.sync(song('two')); assert.equal(h.records[1].state, 'recording');
  unlock({ duplicate: true, fileName: 'Old one.mp3' }); await tick();
  assert.equal(h.records[1].state, 'recording', 'stale duplicate response cannot stop the next song');
  assert.equal(h.jobs[0].track.complete, true);
  const duplicate = harness({ checkTrack: async () => ({ duplicate: true, fileName: 'Existing.mp3' }) });
  await duplicate.arm(); await duplicate.sync(song('one')); await tick();
  for (let i = 0; i < 4; i++) await duplicate.sync(song('one', { currentTime: 0.1 }));
  assert.equal(duplicate.records.length, 1); assert.equal(duplicate.records[0].state, 'inactive');
  assert.equal(duplicate.jobs.length, 0);
  assert.ok(duplicate.states.some(state => state.notice?.includes('Уже в коллекции')));
  const delayed = harness({ delayedStop: true, checkTrack: async track => track.title === 'one' ? { duplicate: true, fileName: 'Existing.mp3' } : {} });
  await delayed.arm(); await delayed.sync(song('one')); await tick();
  await delayed.sync(song('two'));
  assert.equal(delayed.records[1].state, 'recording', 'discarding a duplicate must not wait for its onstop either');
  delayed.stopped.shift()();
});

test('authoritative duplicate guard skips without recovery; browser cancellation keeps staged audio without duplicate raw recovery', async () => {
  const duplicate = harness({ beginDuplicate: true }); await duplicate.arm(); await duplicate.sync(song('one'));
  await duplicate.sync(song('one', { ended: true, currentTime: 10, playing: false })); await tick();
  assert.equal(duplicate.jobs.length, 0); assert.equal(duplicate.calls.some(call => call.type === 'recover'), false);
  const cancelled = harness({ transfer: true, cancelDownload: true }); await cancelled.arm(); await cancelled.sync(song('one'));
  await cancelled.sync(song('one', { ended: true, currentTime: 10, playing: false })); await cancelled.sync(song('two')); await tick();
  assert.equal(cancelled.records[1].state, 'recording');
  assert.equal(cancelled.calls.some(call => call.command === 'defer-output'), true);
  assert.equal(cancelled.calls.some(call => call.command === 'commit-output' || call.type === 'recover'), false);
  assert.ok(cancelled.states.some(state => state.error?.includes('pending')));
});
test('closing the Suno tab discards an unfinished manual recording too', async () => {
  const h = harness(); await h.arm(song('one'), false);
  await h.send({ type: 'disarm', reason: 'tab-closed' }); await tick();
  assert.equal(h.jobs.length, 0); assert.equal(h.mediaStops, 1);
});
test('late enrichment updates the matching recording only and survives later playback samples', async () => {
  const h = harness(), id = 'a15e6b08-0f21-4623-9f6b-5928eef0c260', path = `/song/${id}`;
  await h.arm(); await h.sync(song(path));
  await h.send({ type: 'enrich', id: 'b15e6b08-0f21-4623-9f6b-5928eef0c260', metadata: { lyrics: 'Wrong song' } });
  await h.send({ type: 'enrich', id, metadata: { lyrics: 'Correct lyrics', tags: 'Style', image_url: 'https://cdn2.suno.ai/cover.jpg' } });
  await h.sync(song(path, { currentTime: 8 }));
  await h.sync(song(path, { ended: true, playing: false, currentTime: 10 })); await tick();
  assert.equal(h.jobs.length, 1); assert.equal(h.jobs[0].track.lyrics, 'Correct lyrics');
  assert.equal(h.jobs[0].track.tags, 'Style');
});
