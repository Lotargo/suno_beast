const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const id = execFileSync(process.execPath, [path.join(root, 'native/extension-id.js')], { encoding: 'utf8' });
function client(outputDir, launcher = false, stateDir = path.join(outputDir, '.state')) {
  const executable = launcher ? 'cmd.exe' : process.execPath;
  const args = launcher ? ['/d', '/c', path.join(root, 'native/launch-host.cmd'), `chrome-extension://${id}/`] : [path.join(root, 'native/host.js'), `chrome-extension://${id}/`];
  const env = { ...process.env, SUNO_BEAST_STATE_DIR: stateDir };
  if (outputDir) env.SUNO_BEAST_OUTPUT_DIR = outputDir; else delete env.SUNO_BEAST_OUTPUT_DIR;
  const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = Buffer.alloc(0), seq = 0; const pending = new Map();
  child.stderr.resume();
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
      const size = buffer.readUInt32LE(); const value = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
      const task = pending.get(value.id); pending.delete(value.id);
      clearTimeout(task.timer); value.ok ? task.resolve(value.data) : task.reject(new Error(value.error));
    }
  });
  return { child, call(type, data = {}, split = false) {
    return new Promise((resolve, reject) => {
      const messageId = ++seq; const body = Buffer.from(JSON.stringify({ id: messageId, type, ...data })); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      const timer = setTimeout(() => reject(new Error('Host timeout')), 20000); pending.set(messageId, { resolve, reject, timer });
      const packet = Buffer.concat([header, body]);
      if (split) { child.stdin.write(packet.subarray(0, 2)); child.stdin.write(packet.subarray(2, 11)); child.stdin.write(packet.subarray(11)); }
      else child.stdin.write(packet);
    });
  }, close() { child.stdin.end(); return new Promise(resolve => child.on('exit', resolve)); } };
}
function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8', windowsHide: true }));
}
test('native framing, real FFmpeg trimming, no-trim, and recovery on encode failure', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-beast-test-')); const host = client(dir);
  t.after(async () => { await host.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'fixture.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5', '-af', 'adelay=700,apad=pad_dur=0.8', '-c:a', 'libopus', source], { windowsHide: true });
  assert.equal((await host.call('status', {}, true)).outputDir, dir);
  const raw = fs.readFileSync(source);
  async function record(options, bytes = raw, metadata = {}) {
    const job = await host.call('begin', { track: { title: 'Synthetic test', artist: 'QA', ...metadata }, options });
    for (let start = 0; start < bytes.length; start += 2048) await host.call('chunk', { job: job.job, data: bytes.subarray(start, start + 2048).toString('base64') });
    return host.call('finish', { job: job.job });
  }
  const trimmed = await record({ format: 'mp3', thresholdDb: -45, trimSilence: true });
  const trimmedSeconds = duration(trimmed.filePath);
  assert.ok(trimmedSeconds > 1.4 && trimmedSeconds < 1.9, `Trimmed duration: ${trimmedSeconds}`);
  const full = await record({ format: 'wav', thresholdDb: -45, trimSilence: false });
  assert.ok(duration(full.filePath) > 2.95 && duration(full.filePath) < 3.1);
  const lyrics = 'Строка песни 🙂\n'.repeat(100), tags = 'Detailed style, '.repeat(100);
  const rich = await record({ format: 'mp3', thresholdDb: -45, trimSilence: false }, raw, { lyrics, tags, model: 'V6-MINI', album: 'Suno test album' });
  const richProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', rich.filePath], { encoding: 'utf8', windowsHide: true }));
  assert.equal(richProbe.format.tags.genre, tags);
  assert.equal(richProbe.format.tags.lyrics, lyrics);
  assert.equal(richProbe.format.tags.model, 'V6-MINI');
  assert.equal(richProbe.format.tags.album, 'Suno test album');
  await assert.rejects(record({ format: 'mp3', thresholdDb: -45, trimSilence: true }, Buffer.from('broken audio')), /Source:/);
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith('Recovery_') && fs.readFileSync(path.join(dir, name)).equals(Buffer.from('broken audio'))));
  await assert.rejects(host.call('grab', { track: { audio_src: 'http://127.0.0.1/secret.mp3' }, options: { format: 'mp3', thresholdDb: -45 } }), /Only HTTPS Suno/);
  await assert.rejects(host.call('begin', { options: { format: '../bad', thresholdDb: -45 } }), /Unsupported/);
  await assert.rejects(host.call('chunk', { job: '../../bad', data: 'YQ==' }), /Unknown recording/);
});
test('native host rejects callers outside the single configured extension origin', async () => {
  const child = spawn(process.execPath, [path.join(root, 'native/host.js'), 'chrome-extension://untrusted/'], { stdio: 'ignore', windowsHide: true });
  const code = await new Promise(resolve => child.on('exit', resolve)); assert.equal(code, 1);
});
test('registered Windows launcher works from a Unicode project directory', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(root, 'native/launch-host.cmd')), timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-launch-test-')); const host = client(dir, true);
  t.after(async () => { await host.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await host.call('status')).outputDir, dir);
});

test('browser default output is staged until acknowledged; exact-ID dedupe survives restart and permits deleted files and excerpts', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-library-test-'));
  const stateDir = path.join(dir, 'state'), browserDir = path.join(dir, 'Browser downloads');
  fs.mkdirSync(browserDir); let host = client('', false, stateDir);
  t.after(async () => { if (host) await host.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const fixture = path.join(dir, 'source.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', '-c:a', 'libopus', fixture], { windowsHide: true });
  const raw = fs.readFileSync(fixture), options = { format: 'mp3', thresholdDb: -45, trimSilence: false };
  const first = { id: '/song/a15e6b08-0f21-4623-9f6b-5928eef0c260', title: 'Same title', artist: 'QA', complete: true };
  const second = { ...first, id: '/song/b15e6b08-0f21-4623-9f6b-5928eef0c260' };
  async function record(track, bytes = raw) {
    const begin = await host.call('begin', { track, options });
    if (begin.duplicate) return begin;
    await host.call('chunk', { job: begin.job, data: bytes.toString('base64') });
    return host.call('finish', { job: begin.job });
  }
  async function receive(result, name = result.fileName) {
    const parts = [];
    for (let offset = 0; offset < result.fileSize; offset += 196608) parts.push(Buffer.from((await host.call('read-output', { transfer: result.transfer, offset })).data, 'base64'));
    const filePath = path.join(browserDir, name); fs.writeFileSync(filePath, Buffer.concat(parts)); return filePath;
  }
  assert.equal((await host.call('status')).outputMode, 'browser');
  assert.equal((await host.call('status')).outputDir, '');
  await assert.rejects(record(first, Buffer.from('invalid audio')), /Source:/);
  assert.equal((await host.call('check-track', { track: first })).duplicate, false, 'failed encode is not catalogued and releases its reservation');
  const result = await record(first); assert.ok(result.transfer); assert.equal(result.filePath, undefined);
  assert.equal((await host.call('check-track', { track: first })).duplicate, false, 'staged output is not an existing collection file');
  assert.equal((await record(first)).pending, true, 'inflight reservation prevents duplicate output');
  const filePath = await receive(result);
  const badPath = path.join(browserDir, 'bad.mp3'); fs.writeFileSync(badPath, 'bad');
  await assert.rejects(host.call('commit-output', { transfer: result.transfer, filePath: badPath }), /does not match/);
  await host.call('commit-output', { transfer: result.transfer, filePath });
  const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', filePath], { encoding: 'utf8', windowsHide: true })).format.tags;
  assert.equal(tags.suno_id, first.id); assert.equal(tags.suno_complete, '1');
  assert.equal((await record(first)).duplicate, true);
  assert.equal((await host.call('grab', { track: { ...first, audio_src: 'http://127.0.0.1/unused' }, options })).duplicate, true, 'direct download also skips existing IDs before fetching');
  const other = await record(second); assert.ok(other.transfer, 'same title, different Suno ID must be allowed');
  const deferred = await host.call('defer-output', { transfer: other.transfer });
  assert.ok(fs.existsSync(deferred.recoveryPath));
  assert.equal((await host.call('check-track', { track: second })).duplicate, false, 'cancelled delivery is not catalogued');
  await host.close(); host = client('', false, stateDir);
  assert.equal((await record(first)).duplicate, true, 'collection persists across host restart');
  fs.unlinkSync(filePath);
  const excerpt = await record({ ...first, complete: false });
  const excerptPath = await receive(excerpt, 'excerpt.mp3');
  await host.call('commit-output', { transfer: excerpt.transfer, filePath: excerptPath });
  assert.equal((await host.call('check-track', { track: first })).duplicate, false, 'manual excerpt does not block a complete recording');
  const again = await record(first); assert.ok(again.transfer, 'deleted full recording can be recorded again');
  await host.call('defer-output', { transfer: again.transfer });
  await host.close(); host = null;
  const chosen = path.join(dir, 'Custom folder'); fs.mkdirSync(chosen);
  fs.writeFileSync(path.join(stateDir, 'settings.json'), JSON.stringify({ mode: 'custom', outputDir: chosen }));
  host = client('', false, stateDir);
  assert.equal((await host.call('status')).outputDir, chosen);
  const custom = await record(second); assert.equal(path.dirname(custom.filePath), chosen); assert.equal(custom.transfer, undefined);
  assert.equal((await record(second)).duplicate, true);
  await host.call('reset-folder'); await host.close(); host = client('', false, stateDir);
  assert.equal((await host.call('status')).outputMode, 'browser', 'reset persists and returns delivery to Chrome');
});
