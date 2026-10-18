'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { songId } = require('../extension/policy');

// One record per exact Suno ID; titles are deliberately never used as identity.
class Library {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.locks = new Map();
  }
  id(track = {}) { return songId(track.id) || songId(track.source_url) || songId(`/song/${track.clip_id || ''}`); }
  entry(id) { return path.join(this.directory, `${id}.json`); }
  check(track) {
    const id = this.id(track); if (!id) return { duplicate: false, identified: false };
    try {
      const entry = JSON.parse(fs.readFileSync(this.entry(id), 'utf8'));
      const stat = fs.statSync(entry.filePath);
      if (stat.isFile() && stat.size === entry.size && stat.mtimeMs === entry.mtimeMs) return { duplicate: true, fileName: path.basename(entry.filePath), filePath: entry.filePath };
    } catch {}
    return { duplicate: false, identified: true };
  }
  reserve(track) {
    const existing = this.check(track); if (existing.duplicate) return existing;
    const id = this.id(track); if (!id) return existing;
    const file = path.join(this.directory, `${id}.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(file, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
        this.locks.set(id, file);
        // Another host may have published between the first check and this lock.
        const late = this.check(track);
        if (late.duplicate) { this.release(track); return late; }
        return existing;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
          try { process.kill(owner.pid, 0); return { duplicate: true, pending: true }; }
          catch (error) { if (error.code !== 'ESRCH') return { duplicate: true, pending: true }; }
          fs.rmSync(file, { force: true });
        } catch { return { duplicate: true, pending: true }; }
      }
    }
    return { duplicate: true, pending: true };
  }
  release(track) {
    const id = this.id(track), file = this.locks.get(id);
    if (file) { fs.rmSync(file, { force: true }); this.locks.delete(id); }
  }
  add(track, filePath) {
    const id = this.id(track); if (!id) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || !stat.size) throw new Error('Audio file is missing or empty');
    const file = this.entry(id), temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ id, filePath: path.resolve(filePath), size: stat.size, mtimeMs: stat.mtimeMs }));
    fs.renameSync(temporary, file);
  }
  close() { for (const id of [...this.locks.keys()]) this.release({ id: `/song/${id}` }); }
}
module.exports = Library;
