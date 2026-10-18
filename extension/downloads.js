(function (root) {
  // Relative filename intentionally honors the browser's own configured folder.
  async function save(api, url, fileName) {
    if (!/^blob:/.test(url) || !fileName || /[\\/\x00-\x1f]/.test(fileName)) throw new Error('Недопустимый файл загрузки');
    let id, timer, changed;
    let settled = false;
    return new Promise((resolve, reject) => {
      const done = (error, item) => {
        if (settled) return; settled = true;
        clearTimeout(timer); api.onChanged.removeListener(changed);
        error ? reject(error) : resolve({ fileName: item.filename.split(/[\\/]/).pop(), filePath: item.filename });
      };
      const inspect = async () => {
        try {
          const [item] = await api.search({ id });
          if (item?.state === 'complete' && item.filename) done(null, item);
          else if (!item || item.state === 'interrupted') done(new Error('Загрузка отменена или прервана. Готовый файл оставлен у помощника.'));
        } catch (error) { done(error); }
      };
      changed = delta => { if (delta.id === id) inspect(); };
      api.onChanged.addListener(changed);
      timer = setTimeout(() => {
        if (id !== undefined) api.cancel(id).catch(() => {});
        done(new Error('Истекло время сохранения. Готовый файл оставлен у помощника.'));
      }, 240000);
      api.download({ url, filename: fileName, conflictAction: 'uniquify', saveAs: false }).then(value => { id = value; inspect(); }, done);
    });
  }
  root.SunoDownloads = { save };
  if (typeof module === 'object') module.exports = { save };
})(typeof globalThis === 'object' ? globalThis : this);
