const i18n = SunoI18n.create();
const t = (source, values) => i18n.t(source, values);
let lastState, feedback = null, disconnected = false, languageRevision = 0;
let savingLanguage = Promise.resolve();
const $ = (id) => document.getElementById(id);
function text(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
let busy = false;
let coverUrl = '';
let requestNumber = 0, appliedRequest = 0;
if (new URL(location.href).searchParams.has('panel')) {
  $('close-panel').hidden = false;
  $('close-panel').addEventListener('click', () => send('close-panel').catch(() => {}));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Let the native select close its picker before Escape closes the panel.
    // Older Chromium versions do not support :open and keep their OS picker.
    if (event.target?.tagName === 'OPTION') return;
    try { if ($('format').matches(':open')) return; } catch {}
    event.preventDefault(); send('close-panel').catch(() => {});
  });
}
function renderPlayback(state) {
  const view = SunoPlayback.view(state.playback, state.track);
  text('playback-time', view.text); text('playback-state', t(view.label));
  const progress = $('playback-progress');
  progress.hidden = view.duration === null || view.position === null;
  progress.max = view.duration || 1; progress.value = view.position ?? 0;
}
function renderTrack(track) {
  const id = SunoPolicy.songId(track?.id), image = SunoPolicy.isImageUrl(track?.image_url) ? track.image_url : '';
  if (image !== coverUrl) {
    coverUrl = image; const cover = $('cover');
    cover.hidden = true; $('cover-fallback').hidden = false;
    cover.onload = () => { if (coverUrl === image) { cover.hidden = false; $('cover-fallback').hidden = true; } };
    cover.onerror = () => { cover.hidden = true; $('cover-fallback').hidden = false; };
    if (image) cover.src = image; else cover.removeAttribute('src');
  }
  text('album', track?.album ? t('Альбом · {album}', { album: track.album }) : ''); $('album').hidden = !track?.album;
  text('track-facts', track?.model || ''); $('track-facts').hidden = !$('track-facts').textContent;
  text('style-preview', track?.tags || ''); $('style-preview').hidden = !track?.tags;
  text('style-full', track?.tags || t('Стиль не указан в карточке Suno')); $('style-section').hidden = !track?.tags && track?.metadata_status !== 'ready';
  text('lyrics', track?.lyrics || ''); $('lyrics-section').hidden = !track?.lyrics;
  $('instrumental').hidden = track?.instrumental !== true;
  $('lyrics-missing').hidden = !!track?.lyrics || track?.instrumental === true || track?.metadata_status !== 'ready';
  text('metadata-status', !id ? t('Выбери трек в Suno') : track?.metadata_status === 'loading' ? t('Загружаем сведения из Suno…') : track?.metadata_status === 'ready' ?
    (track.lyrics_truncated ? t('Данные Suno · текст сокращён из-за размера') : t('Данные из карточки Suno')) : t('Полные сведения пока недоступны. Можно повторить запрос.'));
  $('refresh-metadata').disabled = !id || track?.metadata_status === 'loading';
  $('track-link').hidden = !id;
  if (id) $('track-link').href = `https://suno.com/song/${id}`; else $('track-link').removeAttribute('href');
}
async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'background', type, ...extra });
  if (!result?.ok) throw new Error(result?.error || 'Помощник не ответил');
  return result.data;
}
function renderState(state) {
  const message = state.error || state.pageError || (state.helperConnected === false ? t('Помощник записи не подключён. Сведения о треке доступны.') : state.recording ? (state.processing ? t('Идёт запись; предыдущий трек сохраняется') : t('Идёт запись вкладки')) :
    state.processing ? t('Обрабатываем и сохраняем…') : state.notice || (state.auto ? t('Auto-Grab: ждём воспроизведения') :
    state.lastFile ? t('Сохранено: {file}', { file: state.lastFile }) : ''));
  text('status', i18n.message(message));
  text('track', state.track?.title || t('Выбери трек в Suno'));
  $('track').title = state.track?.title || '';
  text('artist', state.track?.artist || t('Твоя музыка — в твоих файлах'));
  renderTrack(state.track);
  renderPlayback(state);
  text('mode', state.error || state.pageError ? t('Ошибка') : state.recording ? t('Запись') : state.auto ? 'Auto-Grab' : state.processing ? t('Сохранение') : t('Готово'));
  document.body.dataset.state = state.error || state.pageError ? 'error' : state.recording ? 'recording' : 'ready';
  text('record-label', state.recording && !state.auto ? t('Остановить') : t('Записать'));
  $('record').setAttribute('aria-pressed', String(!!state.recording && !state.auto));
  $('record').disabled = !!state.auto || (!!state.processing && !state.recording);
  $('record').title = state.auto ? t('Для ручной записи выключи Auto-Grab') : '';
  text('auto-label', 'Auto-Grab');
  $('auto').setAttribute('aria-label', state.auto ? t('Выключить Auto-Grab') : t('Включить Auto-Grab'));
  $('auto').title = state.auto ? t('Выключить автоматическую запись') : t('Автоматически записывать полные треки');
  $('auto').setAttribute('aria-pressed', String(!!state.auto));
  $('auto').disabled = (!state.auto && !!state.processing) || (!!state.recording && !state.auto);
  $('grab').disabled = !state.track?.audio_src || !!state.processing || !!state.recording || !!state.auto;
  text('grab-hint', state.processing ? t('Дождись завершения сохранения') : state.track?.audio_src ? t('Скачать обнаруженный аудиопоток') : t('Прямой MP3-поток пока не найден'));
  text('directory', state.outputMode === 'custom' ? state.outputDir : t('Стандартные загрузки браузера'));
  const locked = !!state.recording || !!state.auto || !!state.processing || !!state.settingsBusy;
  $('choose-folder').disabled = locked;
  $('reset-folder').disabled = locked || state.outputMode !== 'custom';
  $('link-existing').disabled = locked || !SunoPolicy.songId(state.track?.id);
}
function setLanguage(value) {
  i18n.setLanguage(value); i18n.apply(document);
  for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === i18n.language));
  if (lastState) renderState(lastState);
  if (feedback !== null) text('status', i18n.message(feedback));
  if (disconnected) text('mode', t('Нет связи'));
  if (disconnected) document.body.dataset.state = 'error';
}
async function refresh(checkHelper = false) {
  if (busy) return;
  const request = ++requestNumber;
  try {
    const state = await send(checkHelper ? 'status' : 'playback-status');
    if (request < appliedRequest) return;
    appliedRequest = request;
    lastState = state; feedback = null; disconnected = false; renderState(state);
  } catch (err) {
    if (request < appliedRequest) return;
    appliedRequest = request;
    disconnected = true; feedback = err.message; text('status', i18n.message(feedback)); text('mode', t('Нет связи'));
    document.body.dataset.state = 'error';
  }
}
async function act(type) {
  if (busy) return;
  if (['toggle-record', 'toggle-auto', 'grab'].includes(type) && !$('threshold').reportValidity()) return;
  busy = true;
  if (type === 'refresh-metadata') coverUrl = '';
  try {
    feedback = 'Выполняем…'; text('status', t(feedback));
    await send(type, { options: {
      format: $('format').value, thresholdDb: Number($('threshold').value), trimSilence: $('trim').checked
    } });
  } catch (err) { feedback = err.message; text('status', i18n.message(feedback)); return; }
  finally { busy = false; }
  await refresh(true);
}
for (const [id, type] of Object.entries({ record: 'toggle-record', auto: 'toggle-auto', grab: 'grab', folder: 'folder', 'refresh-metadata': 'refresh-metadata', 'choose-folder': 'choose-folder', 'reset-folder': 'reset-folder', 'link-existing': 'link-existing' })) {
  $(id).addEventListener('click', () => act(type));
}
$('open').addEventListener('click', () => chrome.tabs.create({ url: 'https://suno.com' }));
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => {
  ++languageRevision; setLanguage(button.dataset.language);
  const language = i18n.language;
  // Serialize rapid clicks so an older storage write cannot win after a newer one.
  savingLanguage = savingLanguage.catch(() => {}).then(() => chrome.storage.local.set({ language })).catch(() => {
    feedback = 'Не удалось сохранить язык интерфейса'; text('status', t(feedback));
  });
});
async function initialize() {
  try {
    const { options, language } = await chrome.storage.local.get({ language: 'ru', options: { format: 'mp3', thresholdDb: -45, trimSilence: true } });
    $('format').value = options.format; $('threshold').value = options.thresholdDb; $('trim').checked = options.trimSilence;
    if (!languageRevision) setLanguage(language);
  } catch { if (!languageRevision) setLanguage('ru'); }
  refresh(true); setInterval(() => refresh(), 500); setInterval(() => refresh(true), 5000);
}
for (const id of ['format', 'threshold', 'trim']) $(id).addEventListener('change', () => {
  chrome.storage.local.set({ options: { format: $('format').value, thresholdDb: Number($('threshold').value), trimSilence: $('trim').checked } });
});
// The clock reads cached page telemetry; it never waits for native FFmpeg work.
initialize();
