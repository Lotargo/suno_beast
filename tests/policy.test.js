const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../extension/policy');
const manifest = require('../extension/manifest.json');
test('Suno content scripts never match authentication or lookalike sites', () => {
  for (const url of ['https://suno.com/create', 'https://www.suno.com']) assert.equal(policy.isSunoPage(url), true);
  for (const url of ['https://suno.com.evil.test', 'https://evil-suno.com', 'https://accounts.google.com', 'https://accounts.suno.com', 'http://suno.com', 'file:///suno.com', 'https://user:pass@suno.com', 'https://suno.com:444']) assert.equal(policy.isSunoPage(url), false, url);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://suno.com/*', 'https://www.suno.com/*']);
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(!manifest.host_permissions.some(value => value.includes('google') || value === '<all_urls>'));
  assert.equal(manifest.action.default_popup, undefined, 'floating UI must not open a native rectangular popup');
  assert.deepEqual(manifest.web_accessible_resources, [{ resources: ['popup.html'], matches: ['https://suno.com/*', 'https://www.suno.com/*'] }]);
});
test('audio allowlist accepts real CDN variants and rejects silence, local files and redirect escapes', () => {
  for (const url of ['https://cdn1.suno.ai/track.mp3', 'https://cdn-o.suno.com/id.mp3?token=x', 'https://audiopipe.suno.ai/stream/id']) assert.equal(policy.isAudioUrl(url), true, url);
  for (const url of ['http://cdn1.suno.ai/x.mp3', 'https://cdn1.suno.ai.evil.test/x.mp3', 'https://127.0.0.1/x.mp3', 'file:///C:/secret.mp3', 'https://suno.com/x.mp3', 'https://cdn-o.suno.com/sil-100.mp3', 'https://accounts.google.com/audio.mp3']) assert.equal(policy.isAudioUrl(url), false, url);
});
