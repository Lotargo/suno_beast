'use strict';
const fs = require('node:fs');
const path = require('node:path');

// An installed bundle always uses its own tools, even if a system copy exists.
function executable(name, root = path.resolve(__dirname, '..')) {
  if (!['ffmpeg', 'ffprobe'].includes(name)) throw new Error('Unknown audio tool');
  const directory = path.join(root, 'runtime');
  if (!fs.existsSync(path.join(directory, 'node.exe'))) return name;
  const file = path.join(directory, `${name}.exe`);
  if (!fs.existsSync(file)) throw new Error(`Bundled audio tool is missing: ${name}. Reinstall Suno Beast.`);
  return file;
}
module.exports = { executable };
