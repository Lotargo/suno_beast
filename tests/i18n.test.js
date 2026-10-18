const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create, en } = require('../extension/i18n');
const html = fs.readFileSync(require.resolve('../extension/popup.html'), 'utf8');

test('RU/EN translates only UI templates, preserving metadata, paths and unknown diagnostics', () => {
  const i = create('en');
  assert.equal(i.t('Альбом · {album}', { album: 'Пауза {album}' }), 'Album · Пауза {album}');
  assert.equal(i.message('Уже в коллекции: Сохранено: Запись.mp3'), 'Already in your collection: Сохранено: Запись.mp3');
  assert.equal(i.message('Ошибка сохранения: Неполный готовый файл Файл: D:\\Музыка\\Запись.mp3'), 'Save error: The completed file is incomplete File: D:\\Музыка\\Запись.mp3');
  assert.equal(i.message('Ошибка сохранения: Захват уже включён. Не удалось сохранить резервную копию.'), 'Save error: Audio capture is already active. Could not save a backup.');
  assert.equal(i.message('Unknown OS error 42'), 'Unknown OS error 42');
  assert.equal(i.setLanguage('de'), 'ru');
  assert.equal(i.t('Записать'), 'Записать');
  assert.equal(i.message('Уже в коллекции: Запись.mp3'), 'Уже в коллекции: Запись.mp3');
  for (const match of html.matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)) assert.ok(Object.hasOwn(en, match[1]), match[1]);
  assert.doesNotMatch(html, /id="connection"|connection-dot|Локально/);
});

function panel(state, storage = {}) {
  const nodes = [], ids = new Map(), commands = [], writes = [], polls = [];
  for (const match of html.matchAll(/<([a-z][\w-]*)([^<>]*)>/g)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const node = { attrs, dataset: {}, textContent: '', value: '', hidden: false, checked: false, listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; }, addEventListener(k, fn) { this.listeners[k] = fn; }, reportValidity() { return true; } };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    nodes.push(node); if (attrs.id) ids.set(attrs.id, node);
  }
  const doc = { documentElement: {}, body: { dataset: {} }, addEventListener() {}, getElementById: id => ids.get(id),
    querySelectorAll: selector => nodes.filter(node => Object.hasOwn(node.attrs, selector.slice(1, -1))) };
  const context = {
    document: doc, URL, location: { href: 'https://preview.test/popup.html?panel=test' },
    SunoI18n: { create }, SunoPolicy: require('../extension/policy'), SunoPlayback: require('../extension/playback'),
    setInterval: fn => polls.push(fn), chrome: {
      runtime: { async sendMessage({ type }) { commands.push(type); return { ok: true, data: structuredClone(state) }; } },
      tabs: { create() {} }, storage: { local: {
        async get(defaults) { return { ...defaults, ...storage }; },
        async set(value) { writes.push(value); Object.assign(storage, value); }
      } }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8'), context);
  return { doc, ids, commands, writes, polls, storage, click: lang => nodes.find(n => n.dataset.language === lang).listeners.click(), nodes };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('switching language during recording preserves capture, controls, metadata and saved preference on reopening', async () => {
  const state = { recording: true, auto: true, processing: true, track: {
    id: '/song/11111111-1111-4111-8111-111111111111', title: 'Запись', artist: 'Пауза', album: 'Ошибка', lyrics: 'Текст песни', tags: 'Стиль', metadata_status: 'ready'
  }, playback: { playing: true, currentTime: 12, duration: 120 } };
  const p = panel(state); await settle();
  assert.equal(p.doc.documentElement.lang, 'ru');
  const commandCount = p.commands.length;
  p.click('en'); await settle();
  assert.equal(p.doc.documentElement.lang, 'en');
  assert.equal(p.ids.get('mode').textContent, 'Recording');
  assert.equal(p.ids.get('playback-state').textContent, 'Playing');
  assert.equal(p.ids.get('status').textContent, 'Recording; saving the previous track');
  assert.equal(p.ids.get('auto').attrs['aria-label'], 'Turn off Auto-Grab');
  assert.equal(p.ids.get('record').disabled, true);
  assert.equal(p.ids.get('auto').attrs['aria-pressed'], 'true');
  assert.equal(p.ids.get('track').textContent, 'Запись');
  assert.equal(p.ids.get('artist').textContent, 'Пауза');
  assert.equal(p.ids.get('album').textContent, 'Album · Ошибка');
  assert.equal(p.ids.get('lyrics').textContent, 'Текст песни');
  assert.equal(p.ids.get('style-full').textContent, 'Стиль');
  assert.equal(p.commands.length, commandCount);
  assert.equal(p.storage.language, 'en');
  const reopened = panel(state, p.storage); await settle();
  assert.equal(reopened.doc.documentElement.lang, 'en');
  assert.equal(reopened.ids.get('status').textContent, 'Recording; saving the previous track');
  p.click('ru'); p.click('en'); p.click('ru'); await settle(); await settle();
  assert.equal(p.storage.language, 'ru');
  assert.equal(p.ids.get('mode').textContent, 'Запись');
  assert.equal(p.commands.length, commandCount);
});

test('saved English also covers missing metadata, helper failure and recorder notices after polling', async () => {
  const state = { helperConnected: false, track: null, playback: null };
  const p = panel(state, { language: 'en' }); await settle();
  assert.equal(p.ids.get('status').textContent, 'Recording helper disconnected. Track details are available.');
  assert.equal(p.ids.get('track').textContent, 'Select a track in Suno');
  assert.equal(p.ids.get('playback-state').textContent, 'Waiting for playback');
  state.helperConnected = true;
  await p.polls[0]();
  assert.equal(p.ids.get('status').textContent, '', 'idle status must stay empty in English');
  p.click('ru'); await settle();
  assert.equal(p.ids.get('status').textContent, '', 'idle status must stay empty in Russian');
  p.click('en'); await settle();
  state.notice = 'Оборванная запись отброшена; ждём трек с начала';
  await p.polls[0]();
  assert.equal(p.ids.get('status').textContent, 'Interrupted recording discarded; waiting for a track to start');
  state.notice = ''; state.lastFile = 'Запись.mp3';
  await p.polls[0]();
  assert.equal(p.ids.get('status').textContent, 'Saved: Запись.mp3');
});
