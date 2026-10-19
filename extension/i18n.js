(function (root) {
  // Source strings are Russian; keep track metadata and file paths out of this catalog.
  const en = {
    'Язык интерфейса': 'Interface language',
    'Закрыть панель': 'Close panel',
    'Закрыть панель · запись продолжится': 'Close panel · recording continues',
    'Панель записи Suno': 'Suno recording panel',
    'Текущий трек и статус записи': 'Current track and recording status',
    'Текущий трек': 'Current track',
    'Ожидание': 'Waiting',
    'Выбери трек в Suno': 'Select a track in Suno',
    'Твоя музыка — в твоих файлах': 'Your music, in your files',
    'Ожидание воспроизведения': 'Waiting for playback',
    'Прогресс воспроизведения': 'Playback progress',
    'Только просмотр · без перемотки': 'Display only · seeking disabled',
    'Проверяем подключение…': 'Checking connection…',
    'Записать': 'Record',
    'Остановить': 'Stop',
    'Сохраняет полные треки. Уже записанные пропускает.': 'Saves complete tracks. Skips tracks already saved.',
    'Сохранить MP3': 'Save MP3',
    'Сначала запусти трек в Suno': 'Start a track in Suno first',
    'Стиль и текст': 'Style & lyrics',
    'Стиль': 'Style',
    'Текст песни': 'Lyrics',
    'Текст не предоставлен в карточке Suno': 'Lyrics are not available on the Suno song page',
    'Инструментальный трек — без текста песни': 'Instrumental track · no lyrics',
    'Обновить сведения': 'Refresh details',
    'Карточка Suno ↗': 'Suno song page ↗',
    'Настройки записи': 'Recording settings',
    'Формат': 'Format',
    'MP3 · 320 кбит/с': 'MP3 · 320 kbps',
    'WAV · 24 бит': 'WAV · 24-bit',
    'Порог тишины, dB': 'Silence threshold, dB',
    'Обрезать тишину по краям': 'Trim leading and trailing silence',
    'Папка сохранения': 'Save location',
    'Стандартные загрузки браузера': 'Default browser downloads',
    'Выбрать папку…': 'Choose folder…',
    'По умолчанию': 'Use default',
    'Дубли определяются по ID Suno. Старую запись без ID можно связать с текущим треком.': 'Duplicates are identified by Suno ID. Link an older recording without an ID to the current track.',
    'Связать с существующим файлом…': 'Link an existing file…',
    'Выбери полный файл именно этого трека. Файл останется на месте.': 'Choose a complete recording of this exact track. The file stays in place.',
    'Мои записи': 'My recordings',
    'Открыть Suno': 'Open Suno',
    'Записи остаются на этом устройстве': 'Recordings stay on this device',
    'Альбом · {album}': 'Album · {album}',
    'Стиль не указан в карточке Suno': 'No style provided on the Suno song page',
    'Загружаем сведения из Suno…': 'Loading details from Suno…',
    'Данные Suno · текст сокращён из-за размера': 'Suno details · lyrics shortened due to size',
    'Данные из карточки Suno': 'Details from the Suno song page',
    'Полные сведения пока недоступны. Можно повторить запрос.': 'Full details are unavailable. Try refreshing.',
    'Помощник не ответил': 'The recording helper did not respond',
    'Помощник записи не подключён. Сведения о треке доступны.': 'Recording helper disconnected. Track details are available.',
    'Идёт запись; предыдущий трек сохраняется': 'Recording; saving the previous track',
    'Идёт запись вкладки': 'Recording tab audio',
    'Обрабатываем и сохраняем…': 'Processing and saving…',
    'Auto-Grab: ждём воспроизведения': 'Auto-Grab: waiting for playback',
    'Сохранено: {file}': 'Saved: {file}',
    'Готов к записи': 'Ready to record',
    'Ошибка': 'Error',
    'Запись': 'Recording',
    'Сохранение': 'Saving',
    'Готово': 'Ready',
    'Нет связи': 'Disconnected',
    'Для ручной записи выключи Auto-Grab': 'Turn off Auto-Grab to record manually',
    'Выключить Auto-Grab': 'Turn off Auto-Grab',
    'Включить Auto-Grab': 'Turn on Auto-Grab',
    'Выключить автоматическую запись': 'Turn off automatic recording',
    'Автоматически записывать полные треки': 'Automatically record complete tracks',
    'Дождись завершения сохранения': 'Wait for saving to finish',
    'Скачать обнаруженный аудиопоток': 'Download the detected audio stream',
    'Прямой MP3-поток пока не найден': 'No direct MP3 stream detected yet',
    'Выполняем…': 'Working…',
    'Не удалось сохранить язык интерфейса': 'Could not save the language preference',
    'Перемотка в Suno': 'Seeking in Suno',
    'Трек завершён': 'Track ended',
    'Воспроизводится': 'Playing',
    'Пауза': 'Paused',
    'Локальный помощник отключился': 'The recording helper disconnected',
    'Помощник не ответил вовремя': 'The recording helper timed out',
    'Не удалось запустить запись': 'Could not start recording',
    'Открой вкладку suno.com и нажми кнопку расширения в ней': 'Open suno.com and click the extension button there',
    'Дождись завершения текущей операции': 'Wait for the current operation to finish',
    'Панель не ответила': 'The panel did not respond',
    'Недопустимый источник': 'Invalid source',
    'Неизвестная команда рекордера': 'Unknown recorder command',
    'Недопустимая страница': 'Invalid page',
    'Сначала останови запись и дождись сохранения': 'Stop recording and wait for saving to finish first',
    'Останови запись и дождись завершения обработки': 'Stop recording and wait for processing to finish',
    'Запусти трек: ссылка на MP3 ещё не обнаружена': 'Start the track: no MP3 link detected yet',
    'Неизвестная команда': 'Unknown command',
    'Связь с помощником потеряна': 'Connection to the recording helper lost',
    'Готовый файл слишком велик для передачи в браузер (лимит 512 МБ)': 'The completed file exceeds the browser transfer limit (512 MB)',
    'Пустая часть готового файла': 'An empty chunk was received for the completed file',
    'Неполный готовый файл': 'The completed file is incomplete',
    'Этот трек уже сохраняется': 'This track is already being saved',
    'Уже в коллекции: {file}': 'Already in your collection: {file}',
    'Очередь сохранения переполнена. Запись не сохранена.': 'The save queue is full. The recording was not saved.',
    'Ошибка MediaRecorder: незавершённая запись отброшена': 'MediaRecorder error: incomplete recording discarded',
    'Незавершённый трек отброшен': 'Incomplete track discarded',
    'Запись с перемоткой отброшена': 'Recording discarded after seeking',
    'Ждём трек с начала: текущий фрагмент не сохраняется': 'Waiting for a track to start: the current excerpt will not be saved',
    'Оборванная запись отброшена; ждём трек с начала': 'Interrupted recording discarded; waiting for a track to start',
    'Незавершённая запись отброшена': 'Incomplete recording discarded',
    'Захват уже включён': 'Audio capture is already active',
    'Эта версия браузера не поддерживает фоновую обработку аудио. Обнови браузер.': 'This browser version does not support background audio processing. Update your browser.',
    'Эта версия браузера не поддерживает запись звука вкладки. Обнови браузер.': 'This browser version does not support tab audio recording. Update your browser.',
    'Недопустимый файл загрузки': 'Invalid download file',
    'Загрузка отменена или прервана. Готовый файл оставлен у помощника.': 'Download cancelled or interrupted. The recording helper has kept the completed file.',
    'Истекло время сохранения. Готовый файл оставлен у помощника.': 'Saving timed out. The recording helper has kept the completed file.',
    'Скрипт Suno не вернул сведения': 'The Suno script did not return track details',
    'Подключение доступно только во вкладке suno.com': 'Connection is available only in a suno.com tab',
    'Нет связи со вкладкой Suno. Проверь доступ расширения к сайту. {detail}': 'Cannot connect to the Suno tab. Check the extension’s site access. {detail}',
    'Ошибка сохранения: {detail}': 'Save error: {detail}',
    '{detail}. Исходная запись сохранена в Downloads/Suno Beast.': '{detail}. The original recording was saved in Downloads/Suno Beast.',
    '{detail}. Не удалось сохранить резервную копию.': '{detail}. Could not save a backup.',
    '{detail} Файл: {path}': '{detail} File: {path}',
    'Помощник не подключён. Перезапусти расширение и попробуй ещё раз.': 'The recording helper is disconnected. Reload the extension and try again.'
  };
  function create(initial = 'ru') {
    let language;
    function setLanguage(value) { language = value === 'en' ? 'en' : 'ru'; return language; }
    function t(source, values = {}) {
      const template = language === 'en' && Object.hasOwn(en, source) ? en[source] : source;
      return template.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
    }
    // Translate only known protocol wrappers, never substrings of titles or paths.
    function message(value, depth = 0) {
      if (!value || language !== 'en' || depth > 8) return value || '';
      if (Object.hasOwn(en, value)) return t(value);
      const wrap = (key, values) => t(key, values);
      for (const prefix of ['Уже в коллекции: ', 'Сохранено: ']) {
        if (value.startsWith(prefix)) return wrap(`${prefix}{file}`, { file: value.slice(prefix.length) });
      }
      const fileAt = value.lastIndexOf(' Файл: ');
      if (fileAt >= 0) return wrap('{detail} Файл: {path}', { detail: message(value.slice(0, fileAt), depth + 1), path: value.slice(fileAt + 7) });
      for (const suffix of ['. Исходная запись сохранена в Downloads/Suno Beast.', '. Не удалось сохранить резервную копию.']) {
        if (value.endsWith(suffix)) return wrap(`{detail}${suffix}`, { detail: message(value.slice(0, -suffix.length), depth + 1) });
      }
      for (const prefix of ['Ошибка сохранения: ', 'Нет связи со вкладкой Suno. Проверь доступ расширения к сайту. ']) {
        if (value.startsWith(prefix)) return wrap(`${prefix}{detail}`, { detail: message(value.slice(prefix.length), depth + 1) });
      }
      return value; // Preserve unknown browser/OS diagnostics verbatim.
    }
    function apply(doc) {
      doc.documentElement.lang = language;
      for (const node of doc.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
      for (const attribute of ['aria-label', 'title']) {
        for (const node of doc.querySelectorAll(`[data-i18n-${attribute}]`)) node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
      }
    }
    setLanguage(initial);
    return { t, message, apply, setLanguage, get language() { return language; } };
  }
  const api = { create, en };
  if (typeof module === 'object') module.exports = api; else root.SunoI18n = api;
})(typeof globalThis === 'object' ? globalThis : this);
