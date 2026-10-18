(function (root) {
  function create(api, policy) {
    const connecting = new Map();
    async function read(tabId) {
      const snapshot = await api.tabs.sendMessage(tabId, { type: 'get-track' }, { frameId: 0 });
      if (!snapshot || typeof snapshot.track !== 'object' || !snapshot.track) throw new Error('Скрипт Suno не вернул сведения');
      return snapshot;
    }
    function ensure(tab) {
      if (!tab || !Number.isInteger(tab.id) || !policy.isSunoPage(tab.url)) return Promise.reject(new Error('Подключение доступно только во вкладке suno.com'));
      if (connecting.has(tab.id)) return connecting.get(tab.id);
      const task = (async () => {
        try { return await read(tab.id); } catch { /* Reloaded extension, or a tab opened before installation. */ }
        try {
          await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['policy.js', 'panel-host.js', 'content.js'], world: 'ISOLATED' });
          return await read(tab.id);
        } catch (error) {
          const failure = new Error(`Нет связи со вкладкой Suno. Проверь доступ расширения к сайту. ${error.message || ''}`);
          failure.code = 'SUNO_CONNECTION'; throw failure;
        }
      })().finally(() => connecting.delete(tab.id));
      connecting.set(tab.id, task); return task;
    }
    return { ensure };
  }
  const api = { create };
  if (typeof module === 'object') module.exports = api; else root.SunoConnection = api;
})(typeof globalThis === 'object' ? globalThis : this);
