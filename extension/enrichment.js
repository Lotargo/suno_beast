(() => {
  const metadata = typeof module !== 'undefined' ? require('./metadata') : globalThis.SunoMetadata;
  const policy = typeof module !== 'undefined' ? require('./policy') : globalThis.SunoPolicy;
  function createEnricher(fetcher = fetch) {
    const cache = new Map(), inflight = new Map();
    async function load(id, refresh = false) {
      if (!policy.songId(`/song/${id}`)) throw new Error('Invalid Suno song ID');
      const saved = cache.get(id);
      if (!refresh && saved && saved.until > Date.now()) return saved.data;
      if (inflight.has(id)) return inflight.get(id);
      const task = (async () => {
        const response = await fetcher(`https://suno.com/song/${id}`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Suno: HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('Song page is too large');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5 * 1024 * 1024) throw new Error('Song page is too large'); chunks.push(value); }
        } catch (err) { await reader.cancel(); throw err; } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data = metadata.parseSong(new TextDecoder().decode(bytes), id);
        if (!data) throw new Error('Suno did not provide metadata for this song');
        cache.set(id, { data, until: Date.now() + 15 * 60 * 1000 });
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        return data;
      })().catch(err => {
        cache.set(id, { data: { metadata_status: 'unavailable' }, until: Date.now() + 60000 });
        throw err;
      }).finally(() => inflight.delete(id));
      inflight.set(id, task); return task;
    }
    return { load, peek: id => { const entry = cache.get(id); return entry?.until > Date.now() ? entry.data : undefined; } };
  }
  if (typeof module !== 'undefined') module.exports = { createEnricher }; else globalThis.SunoEnrichment = { createEnricher };
})();
