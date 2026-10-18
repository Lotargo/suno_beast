const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { view, time } = require('../extension/playback');

test('playback clock follows actual audio samples, clamps duration, and resets with the next track', () => {
  assert.equal(view({ currentTime: 72.9, duration: 227.96, playing: true }).text, '1:12 / 3:47');
  assert.equal(view({ currentTime: 72.9, duration: 227.96, playing: false }).label, 'Пауза');
  assert.equal(view({ currentTime: 0, duration: 120, playing: true }).text, '0:00 / 2:00');
  assert.equal(view({ currentTime: 121, duration: 120, ended: true }).text, '2:00 / 2:00');
  assert.equal(view({ currentTime: 20, duration: 120, seeking: true }).label, 'Перемотка в Suno');
  assert.equal(time(3607), '1:00:07');
});
test('unknown values are not invented, and progress is a native non-interactive indicator', () => {
  assert.equal(view(null).text, '—:— / —:—');
  assert.equal(view({ currentTime: NaN, duration: Infinity }, { duration: 200 }).text, '—:— / 3:20');
  assert.equal(view({ currentTime: -1 }).position, null);
  assert.equal(view({ currentTime: 10, duration: 0 }).duration, null);
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  assert.match(html, /<progress\b[^>]*id="playback-progress"[^>]*aria-label="Прогресс воспроизведения"/);
  assert.doesNotMatch(html, /type="range"|role="slider"/);
});
