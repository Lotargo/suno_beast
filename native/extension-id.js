const crypto = require('node:crypto');
const manifest = require('../extension/manifest.json');
process.stdout.write(crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16))));
