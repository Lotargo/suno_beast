'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hostName = 'com.sunobeast.audio';
const vendors = ['Google/Chrome', 'Microsoft Edge'];

function executable(name, env = process.env) {
  for (const directory of (env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; }
    catch {}
  }
  throw new Error(`${name} is required in PATH`);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function installMac({ home = os.homedir(), node = process.execPath, environment = process.env, hostDir = __dirname } = {}) {
  const ffmpeg = executable('ffmpeg', environment);
  const ffprobe = executable('ffprobe', environment);
  const extensionIdResult = spawnSync(node, [path.join(hostDir, 'extension-id.js')], { encoding: 'utf8' });
  if (extensionIdResult.error || extensionIdResult.status !== 0) throw new Error('cannot determine extension ID');
  const extensionId = extensionIdResult.stdout.trim();
  const launcher = path.join(hostDir, 'launch-host.sh');
  const manifest = {
    name: hostName,
    description: 'Suno Beast local audio processing',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
  const destinations = vendors.map(vendor => path.join(home, 'Library', 'Application Support', vendor, 'NativeMessagingHosts', `${hostName}.json`));
  for (const destination of destinations) {
    if (!fs.existsSync(destination)) continue;
    let registered;
    try { registered = JSON.parse(fs.readFileSync(destination, 'utf8')); }
    catch (error) { throw new Error(`cannot read existing registration ${destination}: ${error.message}`); }
    if (registered.path !== launcher) throw new Error(`a different host is already registered: ${destination}`);
  }
  const binaryPaths = [...new Set([path.dirname(node), path.dirname(ffmpeg), path.dirname(ffprobe)])];
  const body = `#!/bin/sh\nexport PATH=${shellQuote(binaryPaths.join(':'))}:"$PATH"\nexec ${shellQuote(node)} ${shellQuote(path.join(hostDir, 'host.js'))} "$@"\n`;
  fs.writeFileSync(launcher, body, { mode: 0o700 });
  fs.chmodSync(launcher, 0o700);
  for (const destination of destinations) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + '\n');
  }
  return { extensionId, destinations };
}

function main(platform = process.platform) {
  if (platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install.ps1')], { stdio: 'inherit' });
    if (result.error) throw new Error(`cannot start Windows installer: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Windows installer exited with code ${result.status}`);
    return;
  }
  if (platform === 'darwin') {
    const result = installMac();
    process.stdout.write(`Local audio helper registered for Chrome and Edge.\nExtension ID: ${result.extensionId}\nLoad ${path.join(__dirname, '..', 'extension')} using Load unpacked, then restart the browser.\n`);
    return;
  }
  throw new Error(`unsupported platform: ${platform}; supported platforms are Windows and macOS`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { installMac, main };
