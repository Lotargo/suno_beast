(function (root) {
  const valid = value => Number.isFinite(value) && value >= 0;
  function time(value) {
    if (!valid(value)) return '—:—';
    const seconds = Math.floor(value), hours = Math.floor(seconds / 3600);
    return hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function view(playback, track = {}) {
    const duration = valid(playback?.duration) && playback.duration > 0 ? playback.duration : valid(track?.duration) && track.duration > 0 ? track.duration : null;
    const position = valid(playback?.currentTime) ? (duration ? Math.min(playback.currentTime, duration) : playback.currentTime) : null;
    return { duration, position, text: `${time(position)} / ${time(duration)}`,
      label: position === null ? 'Ожидание воспроизведения' : playback?.seeking ? 'Перемотка в Suno' : playback?.ended ? 'Трек завершён' : playback?.playing ? 'Воспроизводится' : 'Пауза' };
  }
  const api = { time, view };
  if (typeof module === 'object') module.exports = api; else root.SunoPlayback = api;
})(typeof globalThis === 'object' ? globalThis : this);
