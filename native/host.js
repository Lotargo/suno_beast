'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const Library = require('./library');
const { isAudioUrl, isImageUrl, songId } = require('../extension/policy');
const AudioEngine = require('./audio-engine');
const { executable } = require('./runtime');
const MAX_FILE = 256 * 1024 * 1024;
const MAX_MESSAGE = 512 * 1024;
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const extensionId = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
// Chrome also enforces allowed_origins in the registered host manifest.
if (process.argv[2] !== `chrome-extension://${extensionId}/`) process.exit(1);
// stdout is exclusively the native messaging protocol, including AudioEngine logs.
console.log = (...args) => console.error(...args);
const defaultStateRoot = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const stateDir = process.env.SUNO_BEAST_STATE_DIR || path.join(defaultStateRoot, 'SunoBeast');
fs.mkdirSync(stateDir, { recursive: true });
const settingsFile = path.join(stateDir, 'settings.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
// Empty outputDir selects browser delivery; a custom folder must be explicit.
let outputDir = process.env.SUNO_BEAST_OUTPUT_DIR || (config.mode === 'custom' && path.isAbsolute(config.outputDir || '') ? config.outputDir : '');
const library = new Library(path.join(stateDir, 'collection'));
const staging = path.join(stateDir, 'pending');
fs.mkdirSync(staging, { recursive: true });
const deliveries = new Map();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-beast-'));
const jobs = new Map();
function reply(message) {
  const payload = Buffer.from(JSON.stringify(message)); const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length); process.stdout.write(Buffer.concat([header, payload]));
}
function metadata(value = {}) {
  const result = {};
  for (const [key, limit] of Object.entries({ title: 1000, artist: 1000, album: 1000, tags: 12000, prompt: 60000, lyrics: 60000, model: 100, created_at: 100 })) result[key] = typeof value[key] === 'string' ? value[key].slice(0, limit) : '';
  result.image_url = isImageUrl(value.image_url) ? value.image_url : '';
  const id = library.id(value);
  result.id = id ? `/song/${id}` : '';
  result.source_url = id ? `https://suno.com/song/${id}` : '';
  result.complete = value.complete === true;
  return result;
}
function status() { return { outputDir, outputMode: outputDir ? 'custom' : 'browser', version: 2 }; }
function setFolder(directory) {
  if (directory && !path.isAbsolute(directory)) throw new Error('Expected an absolute folder');
  if (directory) fs.mkdirSync(directory, { recursive: true });
  const next = { mode: directory ? 'custom' : 'browser', outputDir: directory };
  const temporary = `${settingsFile}.tmp`; fs.writeFileSync(temporary, JSON.stringify(next)); fs.renameSync(temporary, settingsFile);
  outputDir = directory; return status();
}
async function choose(kind) {
  if (process.platform === 'darwin') {
    const script = kind === 'file' ? 'POSIX path of (choose file)' : 'POSIX path of (choose folder)';
    try {
      const { stdout } = await runFile('osascript', ['-e', script], { encoding: 'utf8', timeout: 300000 });
      return stdout.trim();
    } catch (error) {
      if (error.code === 1 && /User canceled|(-128)/.test(error.stderr || '')) return '';
      throw error;
    }
  }
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'choose-path.ps1'), '-Kind', kind, '-Initial', outputDir || ''], { windowsHide: true, encoding: 'utf8', timeout: 300000 });
  return stdout.trim();
}
function recoveryDir(job) { const directory = job?.outputDir || path.join(stateDir, 'recovery'); fs.mkdirSync(directory, { recursive: true }); return directory; }
function options(value = {}) {
  if (!['mp3', 'wav'].includes(value.format)) throw new Error('Unsupported audio format');
  if (!Number.isFinite(value.thresholdDb) || value.thresholdDb < -60 || value.thresholdDb > -20) throw new Error('Invalid silence threshold');
  return { format: value.format, thresholdDb: value.thresholdDb, trimSilence: value.trimSilence !== false };
}
async function download(url, destination) {
  const deadline = AbortSignal.timeout(120000);
  // Validate every redirect; never fetch localhost, cookies or arbitrary page URLs.
  for (let hop = 0; hop < 6; hop++) {
    if (!isAudioUrl(url)) throw new Error('Only HTTPS Suno audio CDN URLs are allowed');
    const response = await fetch(url, { redirect: 'manual', signal: deadline });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Audio CDN: HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length')) > MAX_FILE) { await response.body?.cancel(); throw new Error('Audio exceeds 256 MB'); }
    const descriptor = fs.openSync(destination, 'wx'); let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_FILE) throw new Error('Audio exceeds 256 MB');
        fs.writeSync(descriptor, chunk);
      }
    } finally { fs.closeSync(descriptor); }
    return;
  }
  throw new Error('Too many audio CDN redirects');
}
async function encode(job) {
  const directory = job.outputDir || path.join(staging, job.id);
  try {
    const engine = new AudioEngine({ outputDir: directory, thresholdDb: job.options.thresholdDb });
    const result = await engine.processAndTrimAudio(job.file, job.track, job.options);
    if (job.outputDir) {
      if (job.track.complete) library.add(job.track, result.filePath);
      library.release(job.track); return result;
    }
    deliveries.set(job.id, { ...job, result });
    return { ...result, filePath: undefined, transfer: job.id };
  } catch (err) {
    // Preserve the source even if FFmpeg is missing or the host later exits.
    library.release(job.track);
    let directory;
    try { directory = recoveryDir(job); } catch { directory = recoveryDir(); }
    const recovery = path.join(directory, `Recovery_${job.id}${path.extname(job.file)}`);
    if (fs.existsSync(job.file)) fs.copyFileSync(job.file, recovery);
    throw new Error(`Audio processing failed. Source: ${recovery}. ${err.message.slice(0, 500)}`);
  }
}
async function handle(message) {
  if (message.type === 'status') return status();
  if (message.type === 'check-track') return library.check(metadata(message.track));
  if (message.type === 'choose-folder') { const selected = await choose('folder'); return selected ? setFolder(selected) : status(); }
  if (message.type === 'reset-folder') return setFolder('');
  if (message.type === 'link-existing') {
    const track = metadata(message.track);
    if (!track.id) throw new Error('Точный ID Suno пока недоступен');
    const selected = await choose('file'); if (!selected) return { cancelled: true };
    const { stdout } = await runFile(executable('ffprobe'), ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'json', selected], { windowsHide: true, timeout: 15000 });
    if (!JSON.parse(stdout).streams?.length) throw new Error('В выбранном файле нет аудио');
    const existing = library.reserve(track);
    if (existing.pending) throw new Error('Этот трек уже сохраняется. Дождись завершения.');
    if (existing.duplicate) return existing;
    try { library.add(track, selected); return { fileName: path.basename(selected) }; }
    finally { library.release(track); }
  }
  if (['read-output', 'commit-output', 'defer-output'].includes(message.type)) {
    const job = deliveries.get(message.transfer); if (!job) throw new Error('Unknown output transfer');
    if (message.type === 'read-output') {
      if (!Number.isSafeInteger(message.offset) || message.offset < 0 || message.offset > job.result.fileSize) throw new Error('Invalid output offset');
      const descriptor = fs.openSync(job.result.filePath, 'r');
      try { const bytes = Buffer.alloc(Math.min(196608, job.result.fileSize - message.offset)); const size = fs.readSync(descriptor, bytes, 0, bytes.length, message.offset); return { data: bytes.subarray(0, size).toString('base64') }; }
      finally { fs.closeSync(descriptor); }
    }
    if (message.type === 'defer-output') {
      library.release(job.track); deliveries.delete(job.id);
      return { recoveryPath: job.result.filePath };
    }
    if (typeof message.filePath !== 'string' || !path.isAbsolute(message.filePath)) throw new Error('Expected downloaded file path');
    const stat = fs.statSync(message.filePath);
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (!stat.isFile() || stat.size !== job.result.fileSize || hash(message.filePath) !== hash(job.result.filePath)) throw new Error('Downloaded file does not match encoded audio');
    if (job.track.complete) library.add(job.track, message.filePath);
    library.release(job.track); deliveries.delete(job.id);
    fs.rmSync(path.dirname(job.result.filePath), { recursive: true, force: true });
    return { fileName: path.basename(message.filePath), filePath: message.filePath };
  }
  if (message.type === 'folder') {
    if (!outputDir) throw new Error('Use the browser Downloads folder');
    const child = process.platform === 'darwin'
      ? spawn('open', [outputDir], { stdio: 'ignore' })
      : spawn('explorer.exe', [outputDir], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref(); return {};
  }
  if (message.type === 'begin') {
    if (jobs.size >= 2) throw new Error('Too many active recordings');
    const id = crypto.randomUUID(); const file = path.join(scratch, `${id}.webm`);
    const opts = options(message.options);
    const track = metadata(message.track);
    const duplicate = track.complete ? library.reserve(track) : library.check(track);
    if (duplicate.duplicate) return duplicate;
    try { fs.writeFileSync(file, Buffer.alloc(0), { flag: 'wx' }); }
    catch (err) { library.release(track); throw err; }
    jobs.set(id, { id, file, track, outputDir, options: opts, size: 0 });
    return { job: id };
  }
  if (['chunk', 'finish', 'abort'].includes(message.type)) {
    const job = jobs.get(message.job); if (!job) throw new Error('Unknown recording');
    if (message.type === 'abort') {
      jobs.delete(job.id);
      library.release(job.track);
      if (job.size) fs.copyFileSync(job.file, path.join(recoveryDir(job), `Recovery_${job.id}.webm`));
      fs.rmSync(job.file, { force: true }); return {};
    }
    if (message.type === 'chunk') {
      if (typeof message.data !== 'string' || message.data.length > 262144 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw new Error('Invalid audio chunk');
      const chunk = Buffer.from(message.data, 'base64');
      if (job.size + chunk.length > MAX_FILE) throw new Error('Recording exceeds 256 MB');
      fs.appendFileSync(job.file, chunk); job.size += chunk.length; return { bytes: job.size };
    }
    if (!job.size) { library.release(job.track); jobs.delete(job.id); fs.rmSync(job.file, { force: true }); throw new Error('Empty recording'); }
    try { return await encode(job); } finally { jobs.delete(job.id); }
  }
  if (message.type === 'grab') {
    const opts = options(message.options); const id = crypto.randomUUID();
    const track = metadata({ ...message.track, complete: true });
    const duplicate = library.reserve(track); if (duplicate.duplicate) return duplicate;
    const file = path.join(scratch, `${id}.mp3`);
    try {
      await download(message.track?.audio_src, file);
      const isMp3 = /\.mp3$/i.test(new URL(message.track.audio_src).pathname);
      return await encode({ id, file, track, outputDir, options: { ...opts, format: 'mp3', copyAudio: !opts.trimSilence && isMp3 } });
    } catch (err) { library.release(track); throw err; }
  }
  throw new Error('Unknown command');
}
let input = Buffer.alloc(0), queue = Promise.resolve();
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const size = input.readUInt32LE(0);
    if (!size || size > MAX_MESSAGE) process.exit(2);
    if (input.length < size + 4) break;
    const bytes = input.subarray(4, size + 4); input = input.subarray(size + 4);
    let message;
    try { message = JSON.parse(bytes); } catch { process.exit(2); }
    const run = async () => {
      try { reply({ id: message.id, ok: true, data: await handle(message) }); }
      catch (err) { reply({ id: message.id, ok: false, error: err.message }); }
    };
    // Status queries should not wait for a long FFmpeg encode.
    if (['status', 'check-track'].includes(message.type)) run(); else queue = queue.then(run);
  }
});
process.stdin.on('end', () => { queue.finally(() => process.exit()); });
process.on('exit', () => {
  // A browser crash must not silently discard an unfinished recording.
  for (const job of jobs.values()) {
    try { if (job.size) fs.copyFileSync(job.file, path.join(recoveryDir(job), `Recovery_${job.id}.webm`)); } catch {}
  }
  library.close();
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
});
