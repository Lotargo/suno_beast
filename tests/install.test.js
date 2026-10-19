const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installMac, main } = require('../native/install');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "suno install's test "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const hostDir = path.join(root, 'project', 'native');
  const extensionDir = path.join(root, 'project', 'extension');
  const bin = path.join(root, 'bin');
  for (const directory of [home, hostDir, extensionDir, bin]) fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../native/extension-id.js'), path.join(hostDir, 'extension-id.js'));
  fs.copyFileSync(path.join(__dirname, '../extension/manifest.json'), path.join(extensionDir, 'manifest.json'));
  fs.writeFileSync(path.join(hostDir, 'host.js'), 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),path:process.env.PATH}))');
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binary = path.join(bin, name);
    fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  }
  return { home, hostDir, bin };
}

test('macOS installer registers Chrome and Edge and launches from a quoted path', { skip: process.platform === 'win32' }, t => {
  const { home, hostDir, bin } = fixture(t);
  const { extensionId, destinations } = installMac({ home, hostDir, environment: { PATH: bin } });
  assert.equal(destinations.length, 2);
  for (const destination of destinations) {
    const manifest = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(manifest.path, path.join(hostDir, 'launch-host.sh'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
  }
  const output = JSON.parse(execFileSync(path.join(hostDir, 'launch-host.sh'), [`chrome-extension://${extensionId}/`], { encoding: 'utf8' }));
  assert.deepEqual(output.args, [`chrome-extension://${extensionId}/`]);
  assert.ok(output.path.split(path.delimiter).includes(bin));
});

test('macOS installer preserves a different native host registration', t => {
  const { home, hostDir, bin } = fixture(t);
  const destination = path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sunobeast.audio.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify({ path: '/other/host' }));
  assert.throws(() => installMac({ home, hostDir, environment: { PATH: bin } }), /different host/);
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).path, '/other/host');
  assert.equal(fs.existsSync(path.join(hostDir, 'launch-host.sh')), false);
});

test('installer rejects unsupported platforms before changing files', () => {
  assert.throws(() => main('linux'), /unsupported platform: linux/);
});
