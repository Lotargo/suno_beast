importScripts('policy.js', 'metadata.js', 'enrichment.js', 'downloads.js', 'connection.js', 'panel-session.js');
const panels = SunoPanelSessions.create(file => chrome.runtime.getURL(file));
const pageConnection = SunoConnection.create(chrome, SunoPolicy);
const pageErrors = new Map();
const enricher = SunoEnrichment.createEnricher();
const enrichingTabs = new Map();
const HOST = 'com.sunobeast.audio';
let port, nextId = 0, capturedTab = null, creatingOffscreen;
const pending = new Map(), tracks = new Map();
const state = { recording: false, auto: false, processing: false, helperConnected: true, error: '', lastFile: '', outputDir: '' };
let actions = Promise.resolve();
function native(type, data = {}) {
  if (!port) {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(message => {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      message.ok ? entry.resolve(message.data) : entry.reject(new Error(message.error));
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Локальный помощник отключился';
      port = null;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(error)); }
      pending.clear();
    });
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Помощник не ответил вовремя')); }, 300000);
    pending.set(id, { resolve, reject, timer });
    try { port.postMessage({ id, type, ...data }); }
    catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
  });
}
function requireOffscreen() {
  if (typeof chrome.runtime.getContexts !== 'function' || typeof chrome.offscreen?.createDocument !== 'function') {
    throw new Error('Эта версия браузера не поддерживает фоновую обработку аудио. Обнови браузер.');
  }
}
async function offscreen(type, data = {}) {
  requireOffscreen();
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!contexts.length) {
    creatingOffscreen ||= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'Record and save audio from a user-selected Suno tab' }).finally(() => { creatingOffscreen = null; });
    await creatingOffscreen;
  }
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  if (!response?.ok) throw new Error(response?.error || 'Не удалось запустить запись');
  return response.data;
}
function options(value = {}) {
  return {
    format: value.format === 'wav' ? 'wav' : 'mp3',
    thresholdDb: Math.max(-60, Math.min(-20, Number(value.thresholdDb) || -45)),
    trimSilence: value.trimSilence !== false
  };
}
async function activeSuno(tabId) {
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !SunoPolicy.isSunoPage(tab.url)) throw new Error('Открой вкладку suno.com и нажми кнопку расширения в ней');
  let snapshot;
  try { snapshot = await pageConnection.ensure(tab); }
  catch (error) { pageErrors.set(tab.id, error.message); throw error; }
  rememberTrack(tab.id, snapshot); pageErrors.delete(tab.id);
  return tab;
}
function rememberTrack(tabId, snapshot) {
  const old = tracks.get(tabId);
  let track = { ...snapshot.track };
  if (!SunoPolicy.isAudioUrl(track.audio_src)) track.audio_src = old?.track?.id === track.id ? old?.track?.audio_src || '' : '';
  const cached = enricher.peek(SunoPolicy.songId(track.id));
  if (cached) track = mergeMetadata(track, cached);
  tracks.set(tabId, { ...snapshot, track });
  requestMetadata(tabId);
}
function mergeMetadata(track, metadata) {
  return { ...track, ...metadata, title: metadata.title || track.title, artist: metadata.artist || track.artist, image_url: metadata.image_url || track.image_url || '' };
}
function requestMetadata(tabId, force = false) {
  const current = tracks.get(tabId), id = SunoPolicy.songId(current?.track?.id);
  if (!id) return;
  if (!force && ['ready', 'unavailable'].includes(current.track.metadata_status)) return;
  if (enrichingTabs.get(tabId)?.id === id) return;
  const entry = { id }; enrichingTabs.set(tabId, entry);
  current.track = { ...current.track, metadata_status: 'loading' };
  // Metadata I/O must never enter the serialized capture transition queue.
  entry.task = enricher.load(id, force).then(metadata => {
    const latest = tracks.get(tabId);
    if (!latest || SunoPolicy.songId(latest.track.id) !== id) return;
    latest.track = mergeMetadata(latest.track, metadata);
    if (capturedTab === tabId) offscreen('enrich', { id, metadata: latest.track }).catch(() => {});
  }).catch(() => {
    const latest = tracks.get(tabId);
    if (latest && SunoPolicy.songId(latest.track.id) === id) latest.track = { ...latest.track, metadata_status: 'unavailable' };
  }).finally(() => { if (enrichingTabs.get(tabId) === entry) enrichingTabs.delete(tabId); });
}
async function start(auto, opts, tabId) {
  if (capturedTab !== null || state.processing || state.settingsBusy) throw new Error('Дождись завершения текущей операции');
  const tab = await activeSuno(tabId);
  if (typeof chrome.tabCapture?.getMediaStreamId !== 'function') {
    throw new Error('Эта версия браузера не поддерживает запись звука вкладки. Обнови браузер.');
  }
  requireOffscreen();
  const status = await native('status'); Object.assign(state, status);
  if (!auto) {
    const existing = await native('check-track', { track: tracks.get(tab.id)?.track });
    if (existing.duplicate) { state.notice = `Уже в коллекции: ${existing.fileName}`; state.error = ''; return; }
  }
  // A real action click grants tabCapture; capture is never started from page code.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await offscreen('arm', { streamId, auto, options: opts, snapshot: tracks.get(tab.id) });
  capturedTab = tab.id; state.auto = auto; state.error = '';
}
async function stop() {
  await offscreen('disarm'); capturedTab = null; state.auto = false;
}
function isUI(sender) {
  return (SunoPolicy.isSunoPage(sender.tab?.url) && panels.accepts(sender)) || (!sender.tab && sender.url === chrome.runtime.getURL('popup.html'));
}
async function togglePanel(tab) {
  if (!SunoPolicy.isSunoPage(tab?.url)) { await chrome.tabs.create({ url: 'https://suno.com' }); return; }
  await activeSuno(tab.id);
  const forceOpen = !panels.has(tab.id);
  const session = panels.open(tab.id);
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel', url: session.url, forceOpen }, { frameId: 0 });
    if (result?.error || !result) throw new Error(result?.error || 'Панель не ответила');
    if (!result.open) panels.close(tab.id);
  } catch (error) { panels.close(tab.id); throw error; }
}
chrome.action.onClicked.addListener(tab => {
  actions = actions.catch(() => {}).then(async () => {
    await togglePanel(tab);
    await chrome.action.setTitle({ title: 'Suno Beast — открыть панель' });
    await chrome.action.setBadgeText({ text: state.recording ? 'REC' : state.auto ? 'AUTO' : '' });
  }).catch(async error => {
    pageErrors.set(tab?.id, error.message);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: `Suno Beast — ${error.message}` });
  });
});
async function handle(message, sender) {
  if (message.type === 'track-state') {
    if (!sender.tab || !SunoPolicy.isSunoPage(sender.url)) throw new Error('Недопустимый источник');
    rememberTrack(sender.tab.id, message);
    if (sender.tab.id === capturedTab) await offscreen('sync', { snapshot: tracks.get(sender.tab.id) });
    return;
  }
  const fromUI = isUI(sender);
  if ((!fromUI && sender.tab) || !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Недопустимый источник');
  if (!sender.tab && sender.url === chrome.runtime.getURL('offscreen.html')) {
    if (message.type === 'native') return native(message.command, message.data);
    if (message.type === 'recorder-state') {
      Object.assign(state, message.state);
      if (message.state.released) { capturedTab = null; state.auto = false; }
      await chrome.action.setBadgeText({ text: state.recording ? 'REC' : state.auto ? 'AUTO' : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#ab3030' });
      return;
    }
    if (message.type === 'recover') {
      return chrome.downloads.download({ url: message.url, filename: `Suno Beast/Recovery_${Date.now()}.webm`, saveAs: false });
    }
    if (message.type === 'download-output') return SunoDownloads.save(chrome.downloads, message.url, message.fileName);
    throw new Error('Неизвестная команда рекордера');
  }
  if (!fromUI) throw new Error('Недопустимая страница');
  const uiTabId = sender.tab?.id;
  if (message.type === 'close-panel') {
    if (uiTabId !== undefined) {
      await chrome.tabs.sendMessage(uiTabId, { type: 'hide-panel' }, { frameId: 0 }); panels.close(uiTabId);
    }
    return;
  }
  if (message.type === 'status' || message.type === 'playback-status') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const watchedId = capturedTab ?? uiTabId ?? tab?.id;
    if (message.type === 'status') {
      await Promise.all([
        (async () => {
          try { const host = await native('status'); Object.assign(state, host); state.helperConnected = true; }
          catch { state.helperConnected = false; }
        })(),
        (async () => {
          try {
            const watched = watchedId === tab?.id ? tab : await chrome.tabs.get(watchedId);
            if (!SunoPolicy.isSunoPage(watched?.url)) return;
            const snapshot = await pageConnection.ensure(watched);
            rememberTrack(watched.id, snapshot); pageErrors.delete(watched.id);
          } catch (error) { pageErrors.set(watchedId, error.message); }
        })()
      ]);
    }
    const snapshot = tracks.get(watchedId);
    return { ...state, pageError: pageErrors.get(watchedId) || '', track: snapshot?.track, playback: snapshot ? {
      currentTime: snapshot.currentTime, duration: snapshot.duration,
      playing: !!snapshot.playing, ended: !!snapshot.ended, seeking: !!snapshot.seeking
    } : null };
  }
  const opts = options(message.options);
  if (message.type === 'toggle-record') return capturedTab !== null ? stop() : start(false, opts, uiTabId);
  if (message.type === 'toggle-auto') return state.auto ? stop() : start(true, opts, uiTabId);
  if (message.type === 'folder') {
    const host = await native('status');
    return host.outputMode === 'custom' ? native('folder') : chrome.downloads.showDefaultFolder();
  }
  if (['choose-folder', 'reset-folder', 'link-existing'].includes(message.type)) {
    if (capturedTab !== null || state.processing || state.settingsBusy) throw new Error('Сначала останови запись и дождись сохранения');
    state.settingsBusy = true;
    try {
      const track = message.type === 'link-existing' ? tracks.get((await activeSuno(uiTabId)).id)?.track : undefined;
      const result = await native(message.type, { track });
      if (message.type === 'link-existing' && result.fileName) state.notice = `Уже в коллекции: ${result.fileName}`;
      return result;
    } finally { state.settingsBusy = false; }
  }
  if (message.type === 'refresh-metadata') {
    if (capturedTab !== null) requestMetadata(capturedTab, true);
    else { const tab = await activeSuno(uiTabId); requestMetadata(tab.id, true); }
    return;
  }
  if (message.type === 'grab') {
    if (state.processing || state.settingsBusy || capturedTab !== null) throw new Error('Останови запись и дождись завершения обработки');
    requireOffscreen();
    const tab = await activeSuno(uiTabId); const track = tracks.get(tab.id)?.track;
    if (!SunoPolicy.isAudioUrl(track?.audio_src)) throw new Error('Запусти трек: ссылка на MP3 ещё не обнаружена');
    state.processing = true; state.error = '';
    try {
      const result = await native('grab', { track, options: opts });
      if (result.duplicate) state.notice = result.pending ? 'Этот трек уже сохраняется' : `Уже в коллекции: ${result.fileName}`;
      else {
        const saved = result.transfer ? await offscreen('deliver', { result }) : result;
        state.lastFile = saved.fileName; state.notice = '';
      }
    }
    catch (err) { state.error = err.message; throw err; }
    finally { state.processing = false; }
    return;
  }
  throw new Error('Неизвестная команда');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'background') return;
  // Serialize capture transitions; native RPCs and state updates must stay independent.
  const transition = ['toggle-record', 'toggle-auto', 'track-state', 'close-panel'].includes(message.type);
  const run = () => handle(message, sender);
  const task = transition ? (actions = actions.catch(() => {}).then(run)) : run();
  task.then(data => reply({ ok: true, data }), err => {
    if (isUI(sender) && message.type !== 'status' && err.code !== 'SUNO_CONNECTION') state.error = err.message;
    reply({ ok: false, error: err.message });
  });
  return true;
});
chrome.webRequest.onCompleted.addListener(details => {
  if (details.tabId < 0 || !SunoPolicy.isAudioUrl(details.url) || ![200, 206].includes(details.statusCode)) return;
  const old = tracks.get(details.tabId) || { playing: false, track: { title: 'Suno Track', artist: 'Suno AI' } };
  tracks.set(details.tabId, { ...old, track: { ...old.track, audio_src: details.url } });
}, { urls: ['https://*.suno.ai/*', 'https://*.suno.com/*'] });
chrome.tabs.onRemoved.addListener(tabId => {
  panels.close(tabId);
  tracks.delete(tabId);
  pageErrors.delete(tabId);
  enrichingTabs.delete(tabId);
  if (tabId === capturedTab) actions = actions.catch(() => {}).then(() => offscreen('disarm', { reason: 'tab-closed' })).catch(err => { state.error = err.message; });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && !SunoPolicy.isSunoPage(change.url)) {
    panels.close(tabId);
    tracks.delete(tabId);
    pageErrors.delete(tabId);
    if (tabId === capturedTab) actions = actions.catch(() => {}).then(() => offscreen('disarm', { reason: 'navigation' })).catch(err => { state.error = err.message; });
  }
});
