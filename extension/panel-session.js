(function (root) {
  function create(getURL, token = () => crypto.randomUUID()) {
    const sessions = new Map();
    return {
      has(tabId) { return sessions.has(tabId); },
      open(tabId) {
        const url = new URL(getURL('popup.html'));
        url.searchParams.set('panel', token()); url.searchParams.set('tab', tabId);
        const session = { url: url.href }; sessions.set(tabId, session); return session;
      },
      accepts(sender) {
        const session = sessions.get(sender.tab?.id);
        if (!session || sender.frameId <= 0 || !Number.isInteger(sender.frameId) || sender.url !== session.url || !sender.documentId) return false;
        if (session.documentId && (sender.documentId !== session.documentId || sender.frameId !== session.frameId)) return false;
        session.documentId = sender.documentId; session.frameId = sender.frameId;
        return true;
      },
      close(tabId) { sessions.delete(tabId); }
    };
  }
  const api = { create };
  if (typeof module === 'object') module.exports = api; else root.SunoPanelSessions = api;
})(typeof globalThis === 'object' ? globalThis : this);
