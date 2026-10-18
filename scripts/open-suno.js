const { spawn } = require('child_process');
// Use the OS HTTPS association, with no automation flags or profile changes.
const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', 'https://suno.com'], { windowsHide: true, stdio: 'ignore', detached: true });
child.on('error', err => { console.error(err.message); process.exitCode = 1; });
child.unref();
