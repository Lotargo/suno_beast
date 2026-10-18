// Isolated content script, restricted to suno.com and www.suno.com. No page bridge.
(() => {
  // Also guard a navigation that happens between tab validation and injection.
  if (typeof location !== 'undefined' && !SunoPolicy.isSunoPage(location.href)) return;
  // Reinjection after a failed handshake must not duplicate timers/listeners.
  globalThis.__sunoBeastTelemetry?.dispose();
  let previous = '', inactive = false, pollTimer;
  const audioEvents = ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata', 'timeupdate', 'seeking', 'seeked'];
  function dispose() {
    if (inactive) return;
    inactive = true;
    clearInterval(pollTimer);
    for (const name of audioEvents) document.removeEventListener(name, onAudio, true);
    // Chrome may already have destroyed this API when the extension reloads.
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    if (globalThis.__sunoBeastTelemetry?.dispose === dispose) delete globalThis.__sunoBeastTelemetry;
  }
  function available() {
    if (inactive) return false;
    try { if (chrome.runtime?.id) return true; } catch {}
    dispose(); return false;
  }
  function messagingError(error) {
    if (/extension context invalidated/i.test(error?.message || '') || !available()) dispose();
    else previous = ''; // A temporary missing receiver must not disable telemetry.
  }
  const lastByAudio = new WeakMap();
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  function mediaInfo(title, trackId) {
    try {
      const info = navigator.mediaSession?.metadata;
      if (!info || (title && clean(info.title) !== clean(title))) return null;
      const id = SunoPolicy.songId(trackId);
      const artwork = [...(info.artwork || [])].filter(a => SunoPolicy.isImageUrl(a.src));
      // Suno can update the DOM and Media Session at different moments. In
      // particular, equal titles do not mean that two generations are identical.
      const coverIds = artwork.map(a => a.src.match(/(?:image(?:_large)?_)([a-f\d-]{36})(?:\.|_)/i)?.[1]?.toLowerCase()).filter(Boolean);
      if (id && coverIds.length && !coverIds.includes(id)) return null;
      return { title: clean(info.title), artist: clean(info.artist), album: clean(info.album), image_url: artwork[0]?.src || '' };
    } catch { return null; }
  }
  function snapshot(event = '', eventAudio = null) {
    const candidates = [...document.querySelectorAll('audio')].filter(a => !/\/sil-\d+\.mp3(?:\?|$)/i.test(a.currentSrc || a.src));
    const audio = eventAudio || candidates.find(a => !a.paused) || candidates[0];
    const player = document.querySelector('footer, [data-testid="player"], [class*="player"], [class*="Player"]');
    const panelLinks = [...document.querySelectorAll('a[aria-label^="Панель: название"], a[aria-label^="Player: Title"], a[aria-label^="Player: title"]')];
    const titleLink = panelLinks.find(a => a.textContent.trim()) || player?.querySelector('a[href*="/song/"]');
    const title = titleLink?.textContent?.trim() || player?.querySelector('h3, h4, [class*="title"]')?.textContent?.trim();
    const trackId = titleLink?.getAttribute('href') || '';
    const media = mediaInfo(title, trackId);
    const cover = panelLinks.map(a => a.querySelector?.('img')).find(Boolean);
    const state = {
      event,
      playing: !!audio && !audio.paused && !audio.ended,
      ended: !!audio?.ended || event === 'ended',
      seeking: !!audio?.seeking,
      currentTime: Number.isFinite(audio?.currentTime) ? audio.currentTime : null,
      duration: Number.isFinite(audio?.duration) ? audio.duration : null,
      sourceKey: audio?.currentSrc || audio?.src || '',
      track: {
        id: trackId,
        title: title || media?.title || document.title.replace(/\s*[|–-]\s*Suno.*$/i, '') || 'Suno Track',
        artist: media?.artist || document.querySelector('a[aria-label^="Панель: исполнитель"], a[aria-label^="Player: Artist"], a[aria-label^="Player: artist"]')?.textContent?.trim() || player?.querySelector('a[href*="/@"]')?.textContent?.trim() || 'Suno AI',
        album: media?.album || '',
        audio_src: audio?.currentSrc || audio?.src || '',
        image_url: cover && SunoPolicy.isImageUrl(cover.currentSrc || cover.src) ? cover.currentSrc || cover.src : media?.image_url || ''
      }
    };
    // The title in Suno's UI may already point at the next song on the ended event.
    const last = audio && lastByAudio.get(audio);
    if (state.ended && last && last.sourceKey === state.sourceKey) state.track = last.track;
    if (audio) lastByAudio.set(audio, state);
    return state;
  }
  function report(event = '', audio = null) {
    if (!available()) return;
    const state = snapshot(event, audio); const value = JSON.stringify(state);
    if (event || value !== previous) {
      previous = value;
      // An invalidated context can throw synchronously, before a Promise exists.
      try { Promise.resolve(chrome.runtime.sendMessage({ target: 'background', type: 'track-state', ...state })).catch(messagingError); }
      catch (error) { messagingError(error); }
    }
  }
  function onAudio(event) {
    if (inactive) return;
    if (event.target?.tagName === 'AUDIO' && !/\/sil-\d+\.mp3(?:\?|$)/i.test(event.target.currentSrc || event.target.src)) report(event.type, event.target);
  }
  function onMessage(message, _, reply) {
    if (available() && message.type === 'get-track') reply(snapshot());
  }
  if (!available()) return;
  globalThis.__sunoBeastTelemetry = { dispose };
  for (const name of audioEvents) document.addEventListener(name, onAudio, true);
  try { chrome.runtime.onMessage.addListener(onMessage); }
  catch { dispose(); return; }
  pollTimer = setInterval(() => report(), 250); report('initial');
})();
