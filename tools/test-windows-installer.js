'use strict';
// Real installer integration test. Only unique sandbox registry keys are changed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const setup = path.resolve(process.argv[2] || path.join(project, 'dist', `Suno-Beast-v${version}-Windows-x64-Setup.exe`));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-installer-qa-'));
const app = path.join(root, 'Программа с пробелами');
const state = path.join(root, 'state');
const recordings = path.join(root, 'recordings');
const scope = crypto.randomUUID().replaceAll('-', '');
const registry = `HKCU\\Software\\SunoBeastInstallerTests\\${scope}`;
const chromeKey = `${registry}\\Google\\Chrome\\NativeMessagingHosts\\com.sunobeast.audio`;
const edgeKey = `${registry}\\Microsoft\\Edge\\NativeMessagingHosts\\com.sunobeast.audio`;
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const reg = path.join(system32, 'reg.exe');
const env = { ...process.env, PATH: system32, SUNO_BEAST_STATE_DIR: state, SUNO_BEAST_OUTPUT_DIR: recordings };
delete env.NODE_OPTIONS; delete env.NODE_PATH;
const checks = [];
function mark(name) { checks.push({ name, passed: true }); console.log('PASS', name); }
function registration(key) {
  // reg.exe uses an OEM code page; read Unicode values through the registry API.
  const subkey = key.replace(/^HKCU\\/, '').replaceAll("'", "''");
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64);$key=$base.OpenSubKey('${subkey}');if($key){[Console]::Write($key.GetValue('',''));$key.Dispose()};$base.Dispose()`;
  return execFileSync(path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
}
function setRegistration(key, value) { execFileSync(reg, ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f', '/reg:64'], { windowsHide: true }); }
function install(label, directory = app, extra = []) {
  const scopeArgs = extra.some(arg => arg.startsWith('/SBTESTID=')) ? [] : [`/SBTESTID=${scope}`];
  return spawnSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOICONS', `/DIR=${directory}`, ...scopeArgs, `/LOG=${path.join(root, label + '.log')}`, ...extra], { env, windowsHide: true, encoding: 'utf8', timeout: 180000 });
}
async function uninstall(directory, label) {
  const result = spawnSync(path.join(directory, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(root, label + '.log')}`], { env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(result.status, 0, 'Uninstall failed');
  // The uninstaller may hand work to a temporary copy.
  for (let attempt = 0; attempt < 100 && fs.existsSync(path.join(directory, 'runtime/node.exe')); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(path.join(directory, 'runtime/node.exe')), false);
}
function client(origin) {
  const child = spawn(path.join(system32, 'cmd.exe'), ['/d', '/s', '/c', `""${path.join(app, 'native/launch-host.cmd')}" "${origin}""`], { env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let input = Buffer.alloc(0), seq = 0, stderr = '';
  const pending = new Map();
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  child.on('error', err => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); } pending.clear(); });
  child.on('exit', code => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(`Host exited ${code}: ${stderr}`)); } pending.clear(); });
  child.stdout.on('data', chunk => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4 && input.length >= input.readUInt32LE() + 4) {
      const size = input.readUInt32LE(), message = JSON.parse(input.subarray(4, size + 4)); input = input.subarray(size + 4);
      const p = pending.get(message.id); if (!p) continue;
      clearTimeout(p.timer); pending.delete(message.id); message.ok ? p.resolve(message.data) : p.reject(Error(message.error));
    }
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  return { child, call(type, fields = {}) { return new Promise((resolve, reject) => {
    const id = ++seq, bytes = Buffer.from(JSON.stringify({ id, type, ...fields })), header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
    const timer = setTimeout(() => reject(Error(`Host timeout: ${type}; ${stderr}`)), 20000); pending.set(id, { resolve, reject, timer }); child.stdin.write(Buffer.concat([header, bytes]));
  }); }, async close() { child.stdin.end(); await exited; } };
}

async function main() {
  assert.equal(process.platform, 'win32', 'Installer integration tests require Windows');
  assert.ok(fs.existsSync(setup), 'Build the installer first');
  fs.mkdirSync(state); fs.mkdirSync(recordings);
  fs.writeFileSync(path.join(state, 'keep.json'), '{"preserve":true}');
  const foreign = 'C:\\Other application\\native-host.json';
  const legacy = path.join(root, 'Прежняя копия', 'com.sunobeast.audio.json');
  const stale = path.join(root, 'Removed copy', 'com.sunobeast.audio.json');
  fs.mkdirSync(path.dirname(legacy)); fs.writeFileSync(legacy, '{"name":"com.sunobeast.audio"}');
  setRegistration(chromeKey, legacy); setRegistration(edgeKey, stale);
  execFileSync(reg, ['add', chromeKey, '/v', 'KeepMe', '/t', 'REG_SZ', '/d', 'unrelated-value', '/f', '/reg:64'], { windowsHide: true });

  fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'existing-file.txt'), 'preserve');
  let result = install('occupied-folder'); assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(app, 'existing-file.txt'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(path.join(app, 'runtime/node.exe')), false);
  assert.equal(registration(chromeKey), legacy); assert.equal(registration(edgeKey), stale);
  fs.unlinkSync(path.join(app, 'existing-file.txt')); fs.rmdirSync(app);
  mark('unmanaged nonempty directories and existing registrations are preserved before installation');

  result = install('component-check', app, ['/SBTESTFAIL=missing-component']);
  assert.notEqual(result.status, 0, 'Missing staged component must abort setup');
  assert.equal(registration(chromeKey), legacy); assert.equal(registration(edgeKey), stale);
  assert.equal(fs.existsSync(path.join(app, 'runtime/node.exe')), false);
  mark('a missing bundled component aborts setup before changing registrations or copying files');

  result = install('rollback', app, ['/SBTESTFAIL=after-first-registration']);
  assert.notEqual(result.status, 0, 'Injected registration failure must abort setup');
  assert.equal(registration(chromeKey), legacy); assert.equal(registration(edgeKey), stale);
  assert.equal(fs.existsSync(path.join(app, 'runtime/node.exe')), false, 'Failed setup must roll back copied files');
  assert.equal(fs.readFileSync(legacy, 'utf8'), '{"name":"com.sunobeast.audio"}');
  mark('a failure after the first registration restores both previous paths and aborts before installing files');

  result = install('install');
  assert.equal(result.status, 0, `Setup failed: ${result.stderr}; log: ${path.join(root, 'install.log')}`);
  const manifestPath = path.join(app, 'native/com.sunobeast.audio.json');
  assert.equal(registration(chromeKey).toLowerCase(), manifestPath.toLowerCase());
  assert.equal(registration(edgeKey).toLowerCase(), manifestPath.toLowerCase());
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.path, path.join(app, 'native/launch-host.cmd'));
  const backup = fs.readFileSync(path.join(app, 'registration-backup.ini'));
  assert.ok(backup.toString('utf16le').includes(legacy)); assert.ok(backup.toString('utf16le').includes(stale));
  assert.equal(fs.readFileSync(legacy, 'utf8'), '{"name":"com.sunobeast.audio"}');
  assert.match(execFileSync(reg, ['query', chromeKey, '/v', 'KeepMe', '/reg:64'], { encoding: 'utf8', windowsHide: true }), /unrelated-value/);
  mark('existing and stale helper registrations automatically switch to the verified bundle with Unicode backups');
  const origin = manifest.allowed_origins[0];
  const node = path.join(app, 'runtime/node.exe'), ffprobe = path.join(app, 'runtime/ffprobe.exe');
  const selfCheck = JSON.parse(execFileSync(node, [path.join(app, 'native/self-check.js')], { env, windowsHide: true, encoding: 'utf8' }));
  assert.equal(selfCheck.version, version);
  const guide = fs.readFileSync(path.join(app, 'GettingStarted.txt'), 'utf8').replace(/^\uFEFF/, '');
  assert.ok(guide.startsWith('Suno Beast')); assert.ok(guide.includes(path.join(app, 'extension')));
  const powershell = path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe');
  execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(app, 'native/install.ps1'), '-RegistryRoot', `HKCU:\\Software\\SunoBeastInstallerTests\\${scope}`], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(fs.existsSync(path.join(app, 'runtime/npm.cmd')), false);
  for (const file of ['ffmpeg-8.1.3.tar.xz', 'lame-4.0.tar.gz', 'zlib-1.3.2.tar.gz', 'build-ffmpeg.sh']) assert.ok(fs.existsSync(path.join(app, 'licenses/sources', file)), file);
  mark('offline install and bundled component checks pass with system-only PATH');
  mark('Unicode installation paths, exact extension origin and source/license payload are valid');

  const host = client(origin);
  const options = { format: 'mp3', trimSilence: true, thresholdDb: -45 };
  const track = { id: '/song/a15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'Проверка установщика', artist: 'QA', lyrics: 'Первая строка\nВторая строка', tags: 'Synthetic tone', complete: true };
  const fixture = fs.readFileSync(path.join(project, 'tests/fixtures/installer-tone.webm'));
  const probe = file => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { env, windowsHide: true, encoding: 'utf8' }));
  async function record(metadata, opts, data = fixture) {
    const job = await host.call('begin', { track: metadata, options: opts });
    if (job.duplicate) return job;
    await host.call('chunk', { job: job.job, data: data.toString('base64') });
    return host.call('finish', { job: job.job });
  }
  let saved;
  try {
    assert.equal((await host.call('status')).outputDir, recordings);
    saved = await record(track, options);
    const tags = probe(saved.filePath).format.tags;
    assert.equal(tags.title, track.title); assert.equal(tags.lyrics, track.lyrics);
    assert.ok(Number(probe(saved.filePath).format.duration) < 1.2);
    assert.equal((await host.call('check-track', { track })).duplicate, true);
    const wav = await record({ ...track, id: '', complete: false }, { ...options, format: 'wav', trimSilence: false });
    assert.equal(probe(wav.filePath).streams[0].codec_name, 'pcm_s24le');
    await assert.rejects(record({ title: 'Broken recording' }, options, Buffer.from('broken audio')), /Source:/);
    assert.ok(fs.readdirSync(recordings).some(n => n.startsWith('Recovery_')));
    mark('installed native launcher records MP3 and WAV, trims, keeps metadata, deduplicates and recovers broken input');
  } finally { await host.close(); }

  // Exercise cover conversion with an offline replacement for the CDN downloader.
  const coverInput = path.join(root, 'cover-input.webm'); fs.writeFileSync(coverInput, fixture);
  const coverScript = `const fs=require('node:fs');const Engine=require(${JSON.stringify(path.join(app, 'native/audio-engine.js'))});new Engine({outputDir:${JSON.stringify(recordings)},downloadCover:async(_,p)=>fs.copyFileSync(${JSON.stringify(path.join(app, 'extension/assets/icon-128.png'))},p)}).processAndTrimAudio(${JSON.stringify(coverInput)},{title:'Cover test',image_url:'fixture'},{format:'mp3',trimSilence:false}).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e);process.exitCode=1;});`;
  const coverRun = spawnSync(node, ['-e', coverScript], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(coverRun.status, 0, coverRun.stderr);
  const coverOutput = coverRun.stdout;
  const cover = JSON.parse(coverOutput.trim().split('\n').at(-1));
  assert.equal(cover.coverEmbedded, true, coverOutput + coverRun.stderr);
  assert.ok(probe(cover.filePath).streams.some(s => s.disposition?.attached_pic === 1));
  mark('bundled FFmpeg embeds a PNG source cover as an MP3 attached picture');

  fs.writeFileSync(path.join(app, 'keep-user-file.txt'), 'preserve');
  result = install('upgrade'); assert.equal(result.status, 0, 'Reinstall/upgrade failed');
  assert.deepEqual(fs.readFileSync(path.join(app, 'registration-backup.ini')), backup, 'Upgrade must retain the original registration backup');
  assert.equal(fs.readFileSync(path.join(state, 'keep.json'), 'utf8'), '{"preserve":true}');
  const restarted = client(origin);
  try { assert.equal((await restarted.call('check-track', { track })).duplicate, true); } finally { await restarted.close(); }
  mark('reinstall/upgrade preserves original registration backups, settings, recordings, collection and unrelated files');

  result = install('wrong-scope', app, [`/SBTESTID=${crypto.randomUUID().replaceAll('-', '')}`]);
  assert.notEqual(result.status, 0, 'A different test scope must not overwrite the installation');
  assert.equal(registration(chromeKey), manifestPath);
  mark('test scopes cannot overwrite an installation belonging to a different scope');

  // An incomplete bundle must not use a globally installed FFmpeg as fallback.
  fs.renameSync(path.join(app, 'runtime/ffmpeg.exe'), path.join(app, 'runtime/ffmpeg-test-disabled.exe'));
  const incomplete = spawnSync(node, [path.join(app, 'native/self-check.js')], { env, encoding: 'utf8', windowsHide: true });
  assert.notEqual(incomplete.status, 0); assert.match(incomplete.stderr, /Bundled audio tool is missing/);
  fs.renameSync(path.join(app, 'runtime/ffmpeg-test-disabled.exe'), path.join(app, 'runtime/ffmpeg.exe'));
  mark('missing bundled FFmpeg fails clearly without a system fallback');

  await uninstall(app, 'uninstall');
  assert.equal(registration(chromeKey), legacy); assert.equal(registration(edgeKey), '', 'Removed legacy paths must not be restored');
  assert.ok(fs.existsSync(saved.filePath)); assert.ok(fs.existsSync(path.join(state, 'keep.json')));
  assert.equal(fs.readFileSync(path.join(app, 'keep-user-file.txt'), 'utf8'), 'preserve');
  mark('uninstall restores an existing legacy helper, removes a stale registration and preserves user data');

  const replacement = path.join(root, 'Second installation');
  try {
    result = install('second-install', replacement); assert.equal(result.status, 0);
    setRegistration(edgeKey, foreign);
    await uninstall(replacement, 'second-uninstall');
    assert.equal(registration(chromeKey), legacy); assert.equal(registration(edgeKey), foreign);
    mark('uninstall preserves a registration changed by another installation after setup');
  } finally {
    const cleanup = path.join(replacement, 'unins000.exe');
    if (fs.existsSync(cleanup)) spawnSync(cleanup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { env, windowsHide: true, timeout: 120000 });
  }
}

main().then(() => {
  const report = { version, installer: path.basename(setup), installerSha256: crypto.createHash('sha256').update(fs.readFileSync(setup)).digest('hex'), environment: 'Windows; child PATH contains only System32; isolated registry and state; no installation-time network downloads', checks };
  const reportPath = path.join(project, 'dist/windows-installer-validation.json'); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Validated ${checks.length} installer scenarios. Report: ${reportPath}`);
}).catch(error => { console.error(error.stack); console.error('Retained QA files:', root); process.exitCode = 1; }).finally(() => {
  const uninstaller = path.join(app, 'unins000.exe');
  if (fs.existsSync(uninstaller)) spawnSync(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { env, windowsHide: true, timeout: 120000 });
  // This root is generated here and contains only this run's test registrations.
  assert.match(registry, /^HKCU\\Software\\SunoBeastInstallerTests\\[a-f0-9]{32}$/);
  spawnSync(reg, ['delete', registry, '/f', '/reg:64'], { windowsHide: true, stdio: 'ignore' });
});
