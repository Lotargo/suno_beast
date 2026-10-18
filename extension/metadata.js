// Read Suno's server-rendered clip data as JSON/text. Never execute page scripts.
(() => {
  const policy = typeof module !== 'undefined' ? require('./policy') : globalThis.SunoPolicy;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  function jsonEnd(text, start) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { if (--depth === 0) return i + 1; }
    }
    return -1;
  }
  function flightParts(html) {
    const parts = [], objects = [];
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const script = match[1]; let offset = 0;
      if (/^\s*[{[]/.test(script)) { try { objects.push(JSON.parse(script)); } catch {} }
      while ((offset = script.indexOf('self.__next_f.push(', offset)) !== -1) {
        const start = offset + 'self.__next_f.push('.length;
        offset = start;
        const end = jsonEnd(script, start);
        if (end < 0) break;
        try { const row = JSON.parse(script.slice(start, end)); if (row[0] === 1 && typeof row[1] === 'string') parts.push(row[1]); } catch {}
        offset = end;
      }
    }
    return { parts, objects };
  }
  function records(stream) {
    // Flight T rows count UTF-8 bytes, not JavaScript UTF-16 characters.
    const bytes = encoder.encode(stream), result = new Map(); let cursor = 0;
    while (cursor < bytes.length) {
      while (bytes[cursor] === 10 || bytes[cursor] === 13) cursor++;
      const start = cursor;
      while (cursor < bytes.length && bytes[cursor] !== 58 && bytes[cursor] !== 10) cursor++;
      if (bytes[cursor] !== 58) { cursor++; continue; }
      const id = decoder.decode(bytes.subarray(start, cursor++));
      if (!/^[\da-f]+$/i.test(id)) { while (cursor < bytes.length && bytes[cursor++] !== 10) {} continue; }
      if (bytes[cursor] === 84) {
        const lengthStart = ++cursor;
        while (cursor < bytes.length && bytes[cursor] !== 44 && cursor - lengthStart < 10) cursor++;
        const hex = decoder.decode(bytes.subarray(lengthStart, cursor));
        if (bytes[cursor] !== 44 || !/^[\da-f]+$/i.test(hex)) break;
        const length = parseInt(hex, 16); cursor++;
        if (length > 1024 * 1024 || cursor + length > bytes.length) break;
        result.set(id, decoder.decode(bytes.subarray(cursor, cursor + length))); cursor += length;
      } else {
        const body = cursor;
        while (cursor < bytes.length && bytes[cursor] !== 10) cursor++;
        try { result.set(id, JSON.parse(decoder.decode(bytes.subarray(body, cursor)))); } catch {}
        cursor++;
      }
    }
    return result;
  }
  function parseSong(html, id) {
    if (!/^[a-f0-9-]{36}$/i.test(id) || typeof html !== 'string' || html.length > 5 * 1024 * 1024) return null;
    const { parts, objects } = flightParts(html), rows = records(parts.join(''));
    const resolve = value => typeof value === 'string' && /^\$[\da-f]+$/i.test(value) ? rows.get(value.slice(1)) : value;
    const stack = [...objects, ...rows.values()]; let clip, count = 0;
    while (stack.length && count++ < 100000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      if (value.id?.toLowerCase?.() === id.toLowerCase() && value.metadata && typeof value.metadata === 'object') { clip = value; break; }
      for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
    }
    if (!clip) return null;
    const meta = clip.metadata;
    const string = (value, limit) => { value = resolve(value); return typeof value === 'string' ? (value.startsWith('$$') ? value.slice(1) : value).slice(0, limit) : ''; };
    const image = clip.image_large_url || clip.image_url;
    const lyricsValue = resolve(clip.display_lyrics) || resolve(meta.display_lyrics) || resolve(meta.prompt);
    return {
      id: `/song/${id.toLowerCase()}`, clip_id: id.toLowerCase(),
      title: string(clip.title, 1000), artist: string(clip.display_name || clip.handle, 1000),
      image_url: policy.isImageUrl(image) ? image : '',
      tags: string(meta.tags, 12000), lyrics: meta.make_instrumental === true ? '' : string(lyricsValue, 60000),
      instrumental: typeof meta.make_instrumental === 'boolean' ? meta.make_instrumental : null,
      duration: typeof meta.duration === 'number' && Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : null,
      model: string(meta.model_badges?.songrow?.display_name || clip.major_model_version || clip.model_name, 100),
      created_at: string(clip.created_at, 100), source_url: `https://suno.com/song/${id.toLowerCase()}`,
      metadata_status: 'ready', metadata_source: 'suno-song-page',
      lyrics_truncated: typeof lyricsValue === 'string' && lyricsValue.length > 60000
    };
  }
  const api = { parseSong };
  if (typeof module !== 'undefined') module.exports = api; else globalThis.SunoMetadata = api;
})();
