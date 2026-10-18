/* Shared by the extension and the local helper. No access to Google domains. */
(() => {
  const domain = (host, root) => host === root || host.endsWith(`.${root}`);
  function parse(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password &&
        (!url.port || url.port === '443') ? url : null;
    } catch { return null; }
  }
  function isSunoPage(value) {
    const url = parse(value);
    return !!url && ['suno.com', 'www.suno.com'].includes(url.hostname);
  }
  function isAudioUrl(value) {
    const url = parse(value);
    return !!url && (domain(url.hostname, 'suno.ai') || /^cdn[a-z0-9-]*\.suno\.com$/.test(url.hostname)) &&
      !/\/sil-\d+\.mp3$/i.test(url.pathname) &&
      (/\.(mp3|wav)(?:$|\/)/i.test(url.pathname) || url.hostname === 'audiopipe.suno.ai');
  }
  function songId(value) {
    const match = String(value || '').match(/^(?:https:\/\/(?:www\.)?suno\.com)?\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[/?#]|$)/i);
    return match ? match[1].toLowerCase() : '';
  }
  function isImageUrl(value) {
    const url = parse(value);
    return !!url && (/^cdn[a-z0-9-]*\.suno\.(?:ai|com)$/.test(url.hostname)) && /\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  }
  const policy = { isSunoPage, isAudioUrl, isImageUrl, songId };
  if (typeof module !== 'undefined') module.exports = policy;
  else globalThis.SunoPolicy = policy;
})();
