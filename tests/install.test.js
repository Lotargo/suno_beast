const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

test('macOS installer registers Chromium browsers and launches from a quoted path', { skip: process.platform === 'win32' }, t => {
  const { home, hostDir, bin } = fixture(t);
  const { extensionId, destinations } = installMac({ home, hostDir, environment: { PATH: bin } });
  assert.equal(destinations.length, 3);
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

test('macOS installer registers Yandex and checks its conflicts before writing any registration', t => {
  const { home, hostDir, bin } = fixture(t);
  const { destinations } = installMac({ home, hostDir, environment: { PATH: bin } });
  const yandex = path.join(home, 'Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts/com.sunobeast.audio.json');
  assert.ok(destinations.includes(yandex));
  const chromeBefore = fs.readFileSync(destinations[0]);
  const launcherBefore = fs.readFileSync(path.join(hostDir, 'launch-host.sh'));
  fs.writeFileSync(yandex, JSON.stringify({ path: '/different/yandex/host' }));
  assert.throws(() => installMac({ home, hostDir, environment: { PATH: bin } }), /different host/);
  assert.deepEqual(fs.readFileSync(destinations[0]), chromeBefore);
  assert.deepEqual(fs.readFileSync(path.join(hostDir, 'launch-host.sh')), launcherBefore);
  assert.equal(JSON.parse(fs.readFileSync(yandex, 'utf8')).path, '/different/yandex/host');
});

test('Windows installer registers the shared Chrome host and uninstall preserves foreign registrations', { skip: process.platform !== 'win32' }, t => {
  const { hostDir } = fixture(t);
  for (const file of ['install.ps1', 'uninstall.ps1']) fs.copyFileSync(path.join(__dirname, '../native', file), path.join(hostDir, file));
  const key = `Software\\SunoBeastInstallTests\\${require('node:crypto').randomUUID()}`;
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const script = path.join(hostDir, 'test-registration.ps1');
  fs.writeFileSync(script, `
$ErrorActionPreference = 'Stop'
$root = ${quote(`HKCU:\\${key}`)}
$hostDir = ${quote(hostDir)}
try {
    & (Join-Path $hostDir 'install.ps1') -RegistryRoot $root
    $manifest = Join-Path $hostDir 'com.sunobeast.audio.json'
    foreach ($vendor in @('Google\\Chrome', 'Microsoft\\Edge')) {
        $registered = (Get-Item -LiteralPath "$root\\$vendor\\NativeMessagingHosts\\com.sunobeast.audio").GetValue('')
        if ($registered -ne $manifest) { throw "Missing registration: $vendor" }
    }
    $shared = "$root\\Google\\Chrome\\NativeMessagingHosts\\com.sunobeast.audio"
    Set-Item -LiteralPath $shared -Value 'C:\\other\\host.json'
    $rejected = $false
    try { & (Join-Path $hostDir 'install.ps1') -RegistryRoot $root } catch { $rejected = $_.Exception.Message -like '*different host*' }
    if (-not $rejected) { throw 'Installer did not protect a different shared Chrome host' }
    & (Join-Path $hostDir 'uninstall.ps1') -RegistryRoot $root
    if ((Get-Item -LiteralPath $shared).GetValue('') -ne 'C:\\other\\host.json') { throw 'Uninstall changed another host' }
    foreach ($vendor in @('Microsoft\\Edge')) {
        if (Test-Path -LiteralPath "$root\\$vendor\\NativeMessagingHosts\\com.sunobeast.audio") { throw "Owned registration remains: $vendor" }
    }
} finally {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(${quote(key)}, $false)
}
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('installer rejects unsupported platforms before changing files', () => {
  assert.throws(() => main('linux'), /unsupported platform: linux/);
});
