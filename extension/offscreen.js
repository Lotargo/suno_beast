let stream, output, active, auto = false, opts, snapshot, pauseTimer;
let transitions = Promise.resolve(), saves = Promise.resolve(), pendingSaves = 0, queuedBytes = 0;
let ignoredKey = '';
const MAX_BYTES = 256 * 1024 * 1024;
const rpc = async (type, data = {}) => {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (!response?.ok) throw new Error(response?.error || 'Связь с помощником потеряна');
  return response.data;
};
const report = state => rpc('recorder-state', { state }).catch(() => {});
const native = (command, data) => rpc('native', { command, data });
const keyOf = value => value?.sourceKey || value?.track?.id || value?.track?.audio_src || value?.track?.title || '';
const atStart = value => Number.isFinite(value?.currentTime) && value.currentTime <= 0.4;
const complete = value => !!value?.ended || (Number.isFinite(value?.duration) && value.duration > 0 &&
  Number.isFinite(value?.currentTime) && value.currentTime >= value.duration - 0.05);
function base64(bytes) {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
async function deliver(result) {
  if (!result.transfer) return result;
  try {
    if (!Number.isSafeInteger(result.fileSize) || result.fileSize <= 0 || result.fileSize > 512 * 1024 * 1024) throw new Error('Готовый файл слишком велик для передачи в браузер (лимит 512 МБ)');
    const parts = [];
    for (let offset = 0; offset < result.fileSize; offset += 196608) {
      const part = await native('read-output', { transfer: result.transfer, offset });
      const text = atob(part.data);
      if (!text.length) throw new Error('Пустая часть готового файла');
      parts.push(Uint8Array.from(text, c => c.charCodeAt(0)));
    }
    const blob = new Blob(parts, { type: result.fileName.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' });
    if (blob.size !== result.fileSize) throw new Error('Неполный готовый файл');
    const url = URL.createObjectURL(blob);
    try {
      const downloaded = await rpc('download-output', { url, fileName: result.fileName });
      return await native('commit-output', { transfer: result.transfer, filePath: downloaded.filePath });
    } finally { URL.revokeObjectURL(url); }
  } catch (error) {
    const deferred = await native('defer-output', { transfer: result.transfer }).catch(() => ({}));
    throw new Error(`${error.message}${deferred.recoveryPath ? ` Файл: ${deferred.recoveryPath}` : ''}`);
  }
}
async function save(blob, track, options) {
  let job, encoded = false;
  try {
    job = await native('begin', { track, options });
    if (job.duplicate) {
      await report({ notice: job.pending ? 'Этот трек уже сохраняется' : `Уже в коллекции: ${job.fileName}`, error: '' });
      return;
    }
    for (let offset = 0; offset < blob.size; offset += 196608) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 196608).arrayBuffer());
      await native('chunk', { job: job.job, data: base64(bytes) });
    }
    const result = await native('finish', { job: job.job }); encoded = true;
    const saved = await deliver(result);
    await report({ lastFile: saved.fileName, notice: '', error: '' });
  } catch (err) {
    if (encoded) { await report({ error: err.message }); return; }
    if (job) await native('abort', { job: job.job }).catch(() => {});
    // A transport/encoder failure is separate from an intentionally discarded fragment.
    const url = URL.createObjectURL(blob);
    let recovered = false;
    try { await rpc('recover', { url }); recovered = true; } catch {}
    finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
    await report({ error: recovered ? `${err.message}. Исходная запись сохранена в Downloads/Suno Beast.` : `${err.message}. Не удалось сохранить резервную копию.` });
  }
}
function queueSave(blob, track, options) {
  if (queuedBytes + blob.size > MAX_BYTES) {
    report({ error: 'Очередь сохранения переполнена. Запись не сохранена.' }); return;
  }
  queuedBytes += blob.size; pendingSaves++;
  report({ processing: true, pendingSaves });
  // Never await this queue from capture transitions: Suno already plays the next song.
  saves = saves.catch(() => {}).then(() => save(blob, track, options)).catch(err => {
    report({ error: `Ошибка сохранения: ${err.message}` });
  }).finally(() => {
    queuedBytes -= blob.size; pendingSaves--;
    report({ processing: pendingSaves > 0, pendingSaves });
  });
}
function beginRecording(value) {
  if (!stream || active || (ignoredKey && ignoredKey === keyOf(value))) return;
  const media = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 320000 });
  const session = { media, chunks: [], bytes: 0, key: keyOf(value), last: value,
    track: { ...value?.track }, fromStart: atStart(value), options: { ...opts }, keep: false, invalid: false };
  // Each recorder owns its chunks/metadata: an old onstop can run after the next start.
  session.stopped = new Promise(resolve => { session.resolve = resolve; });
  media.ondataavailable = event => {
    if (event.data.size) { session.chunks.push(event.data); session.bytes += event.data.size; }
    if (session.bytes > MAX_BYTES) {
      session.invalid = true;
      transitions = transitions.catch(() => {}).then(() => disarm('limit'));
    }
  };
  media.onstop = () => {
    if (session.keep && !session.invalid && session.bytes) {
      queueSave(new Blob(session.chunks, { type: media.mimeType }), { ...session.track, complete: session.fromStart && complete(session.last) }, session.options);
    }
    session.chunks = []; session.resolve();
  };
  media.onerror = () => {
    session.invalid = true;
    report({ error: 'Ошибка MediaRecorder: незавершённая запись отброшена' });
    transitions = transitions.catch(() => {}).then(() => disarm('error'));
  };
  active = session; media.start(250);
  report({ recording: true, notice: '', error: '' });
  // Start capturing the intro first. Disk/IPC latency cannot hold up autoplay.
  native('check-track', { track: session.track }).then(existing => {
    if (!existing.duplicate || active !== session) return;
    transitions = transitions.catch(() => {}).then(async () => {
      if (active !== session) return;
      ignoredKey = session.key;
      const stopped = endRecording(false, `Уже в коллекции: ${existing.fileName}`);
      if (!auto) { await stopped; await releaseCapture(); }
    });
  }).catch(() => {}); // The authoritative guard runs again before encoding.
}
function endRecording(keep, notice = '') {
  const session = active;
  if (!session) return Promise.resolve();
  active = null; session.keep = keep;
  if (session.media.state !== 'inactive') session.media.stop();
  report({ recording: false, ...(notice ? { notice } : {}) });
  return session.stopped;
}
function cancelPause() { clearTimeout(pauseTimer); pauseTimer = null; }
async function sync(next) {
  snapshot = next;
  const key = keyOf(next);
  if (key && ignoredKey && key !== ignoredKey) ignoredKey = '';
  if (ignoredKey && key === ignoredKey) return;
  if (active && key && active.key && key !== active.key) {
    cancelPause();
    // Stop is synchronous; neither onstop nor FFmpeg holds up the new recorder.
    const stopped = endRecording(complete(active.last), complete(active.last) ? '' : 'Незавершённый трек отброшен');
    if (!auto) { await stopped; await releaseCapture(); return; }
  }
  if (next?.seeking || next?.event === 'seeking') {
    cancelPause(); endRecording(false, 'Запись с перемоткой отброшена');
    return;
  }
  if (active) {
    active.last = next;
    if (next?.track?.title) active.track = { ...active.track, ...next.track };
  }
  if (next?.ended) {
    cancelPause(); endRecording(true);
    if (!auto) await releaseCapture();
    return;
  }
  if (next?.playing) {
    cancelPause();
    if (!active && auto) {
      if (atStart(next)) beginRecording(next);
      else report({ notice: 'Ждём трек с начала: текущий фрагмент не сохраняется' });
    }
  } else if (active && !pauseTimer) {
    const paused = active;
    pauseTimer = setTimeout(() => {
      transitions = transitions.catch(() => {}).then(async () => {
        pauseTimer = null;
        if (active !== paused || snapshot?.playing) return;
        const stopped = endRecording(false, 'Оборванная запись отброшена; ждём трек с начала');
        if (!auto) { await stopped; await releaseCapture(); }
      });
    }, 1200);
  }
}
async function releaseCapture() {
  const previous = stream; stream = null;
  previous?.getTracks().forEach(track => track.stop());
  if (output) await output.close(); output = null;
  auto = false;
  await report({ recording: false, auto: false, released: true });
}
async function disarm(reason = 'user') {
  cancelPause();
  // Manual Stop explicitly saves an excerpt. Stopping Auto-Grab cannot bless a fragment.
  const keep = reason === 'user' && (!auto || complete(active?.last));
  await endRecording(keep, keep ? '' : 'Незавершённая запись отброшена');
  await releaseCapture();
}
async function handle(message) {
  if (message.type === 'arm') {
    if (stream) throw new Error('Захват уже включён');
    opts = message.options; auto = message.auto; snapshot = message.snapshot; ignoredKey = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } }, video: false });
      output = new AudioContext(); output.createMediaStreamSource(stream).connect(output.destination);
      await output.resume();
      stream.getAudioTracks()[0].addEventListener('ended', () => { transitions = transitions.catch(() => {}).then(() => disarm('capture-ended')); });
      if (auto) await sync(snapshot); else beginRecording(snapshot);
    } catch (err) { await disarm('error'); throw err; }
  } else if (message.type === 'enrich') {
    if (active && SunoPolicy.songId(active.track.id) === message.id) active.track = { ...active.track, ...message.metadata };
  } else if (message.type === 'sync') await sync(message.snapshot);
  else if (message.type === 'disarm') await disarm(message.reason || 'user');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  // Delivery also serves direct MP3 downloads and never joins capture transitions.
  const task = message.type === 'deliver' ? deliver(message.result) : (transitions = transitions.catch(() => {}).then(() => handle(message)));
  task.then(data => reply({ ok: true, data }), err => reply({ ok: false, error: err.message }));
  return true;
});
