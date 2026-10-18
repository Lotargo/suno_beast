(function (root) {
  function create(api, doc = document, win = window) {
    root.__sunoBeastPanelHost?.dispose();
    let host, previousFocus;
    const hostId = 'suno-beast-floating-panel';
    // A previous extension context can leave an orphaned element after reload.
    doc.getElementById(hostId)?.remove();
    function hide() {
      const open = !!host;
      host?.remove(); host = null;
      if (open && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    function toggle(url, forceOpen = false) {
      if (host?.isConnected) { hide(); if (!forceOpen) return { open: false }; }
      const target = new URL(url), allowed = new URL(api.runtime.getURL('popup.html'));
      if (target.origin !== allowed.origin || target.pathname !== allowed.pathname || !target.searchParams.get('panel')) throw new Error('Недопустимая панель');
      previousFocus = doc.activeElement;
      host = doc.createElement('div'); host.id = hostId;
      const shadow = host.attachShadow({ mode: 'closed' });
      // Styles are scoped to this host. Suno's CSS and our document never mix.
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(`
        :host { all: initial !important; display: block !important; position: fixed !important;
          top: 0 !important; right: 20px !important; width: min(400px, calc(100vw - 32px)) !important;
          height: min(600px, calc(100dvh - 20px)) !important; z-index: 2147483000 !important;
          border: 0 !important; border-radius: 22px !important; overflow: hidden !important;
          background: transparent !important; box-shadow: none !important; }
        iframe { display: block; width: 100%; height: 100%; border: 0; margin: 0;
          background: transparent; border-radius: inherit; color-scheme: dark; }
      `);
      shadow.adoptedStyleSheets = [sheet];
      const frame = doc.createElement('iframe');
      frame.title = 'Suno Beast — панель записи'; frame.src = target.href;
      frame.addEventListener('load', () => frame.focus({ preventScroll: true }), { once: true });
      shadow.append(frame); doc.documentElement.append(host);
      return { open: true };
    }
    function onMessage(message, sender, reply) {
      if (sender.id !== api.runtime.id || sender.tab) return;
      if (message.type === 'toggle-panel') {
        try { reply(toggle(message.url, message.forceOpen === true)); } catch (error) { reply({ error: error.message }); }
      } else if (message.type === 'hide-panel') { hide(); reply({ open: false }); }
    }
    function onKey(event) {
      if (event.key === 'Escape' && host) { hide(); event.stopPropagation(); }
    }
    function dispose() {
      hide(); doc.removeEventListener('keydown', onKey, true);
      try { api.runtime.onMessage.removeListener(onMessage); } catch {}
      if (root.__sunoBeastPanelHost?.dispose === dispose) delete root.__sunoBeastPanelHost;
    }
    api.runtime.onMessage.addListener(onMessage); doc.addEventListener('keydown', onKey, true);
    const instance = { toggle, hide, dispose }; root.__sunoBeastPanelHost = instance; return instance;
  }
  const api = { create };
  if (typeof module === 'object') module.exports = api;
  else {
    root.SunoPanelHost = api;
    if (root.SunoPolicy?.isSunoPage(location.href)) create(chrome);
  }
})(typeof globalThis === 'object' ? globalThis : this);
