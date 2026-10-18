const fs = require('fs');
const { isImageUrl } = require('../extension/policy');
async function downloadSunoImage(url, destination, fetcher = fetch) {
  const signal = AbortSignal.timeout(10000), limit = 5 * 1024 * 1024;
  for (let hop = 0; hop < 5; hop++) {
    if (!isImageUrl(url)) throw new Error('Only Suno CDN cover images are allowed');
    const response = await fetcher(url, { redirect: 'manual', credentials: 'omit', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Cover: HTTP ${response.status}`); }
    if (!/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('Invalid cover image content type'); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Cover image exceeds 5 MB'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('Cover image exceeds 5 MB'); chunks.push(Buffer.from(chunk)); }
    fs.writeFileSync(destination, Buffer.concat(chunks)); return destination;
  }
  throw new Error('Too many cover redirects');
}
module.exports = { downloadSunoImage };
