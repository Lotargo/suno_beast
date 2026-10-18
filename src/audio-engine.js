const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');
const { downloadSunoImage } = require('./suno-image');

class AudioEngine {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(__dirname, '..', 'downloads');
    this.thresholdDb = options.thresholdDb || -45; // Silence threshold in dB
    this.silenceLeadDuration = options.silenceLeadDuration || 0.03; // Seconds above threshold to trigger start
    this.silenceTrailDuration = options.silenceTrailDuration || 0.08; // Seconds of silence at end to cut
    this.fadeDuration = options.fadeDuration || 0.02; // Seconds of anti-pop fade in/out
    this.audioBitrate = options.audioBitrate || '320k'; // MP3 bitrate
    this.downloadCover = options.downloadCover || downloadSunoImage;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  setSettings(settings = {}) {
    if (settings.outputDir) {
      this.outputDir = settings.outputDir;
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
    }
    if (settings.thresholdDb !== undefined) this.thresholdDb = Number(settings.thresholdDb);
    if (settings.audioBitrate) this.audioBitrate = settings.audioBitrate;
  }

  sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return 'Suno_Track_' + Date.now();
    return name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  /**
   * Process raw recorded audio (WAV/WebM/PCM) with FFmpeg:
   * 1. Trim leading silence (front empty gap)
   * 2. Trim trailing silence (end empty gap)
   * 3. Apply smooth anti-click micro fades (15-20ms)
   * 4. Encode to 320kbps MP3 or 24-bit WAV
   * 5. Embed ID3 metadata (Title, Artist, Genre, Prompt, Cover)
   */
  async processAndTrimAudio(inputPath, metadata = {}, options = {}) {
    const format = options.format || 'mp3';
    if (!['mp3', 'wav'].includes(format)) throw new Error('Unsupported audio format');
    const title = metadata.title || 'Untitled Track';
    const artist = metadata.artist || 'Suno AI';
    const genre = metadata.tags || metadata.style || 'AI Generated';
    const lyrics = metadata.lyrics || metadata.prompt || '';
    const safeTitle = this.sanitizeFilename(title);
    const safeArtist = this.sanitizeFilename(artist);
    const baseName = `${safeArtist} - ${safeTitle}`;

    // Make filename unique if already exists
    let outputPath = path.join(this.outputDir, `${baseName}.${format}`);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
      outputPath = path.join(this.outputDir, `${baseName} (${counter}).${format}`);
      counter++;
    }

    const threshold = this.thresholdDb;
    // Dual-pass silence removal:
    // 1. Cut start silence + fade in
    // 2. Reverse + cut start silence (was end) + fade in + reverse back
    const filterChain = [
      `silenceremove=start_periods=1:start_duration=${this.silenceLeadDuration}:start_silence=${this.silenceLeadDuration + this.fadeDuration}:start_threshold=${threshold}dB:detection=peak`,
      `afade=t=in:ss=0:d=${this.fadeDuration}`,
      'areverse',
      `silenceremove=start_periods=1:start_duration=${this.silenceTrailDuration}:start_silence=${this.silenceTrailDuration + this.fadeDuration}:start_threshold=${threshold}dB:detection=peak`,
      `afade=t=in:ss=0:d=${this.fadeDuration}`,
      'areverse'
    ].join(',');

    const ffmpegArgs = [
      '-nostdin',
      '-y',
      '-protocol_whitelist', 'file,pipe',
      '-i', inputPath
    ];
    // Download cover image if available
    let tempCoverPath = null;
    let coverDir = null, coverEmbedded = false;
    if (metadata.image_url && format === 'mp3') {
      try {
        coverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-cover-'));
        tempCoverPath = path.join(coverDir, 'cover.img');
        await this.downloadCover(metadata.image_url, tempCoverPath);
        ffmpegArgs.push('-i', tempCoverPath);
        ffmpegArgs.push('-map', '0:a:0', '-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
        coverEmbedded = true;
      } catch (err) {
        console.warn('Could not fetch cover image for ID3 tag:', err.message);
        ffmpegArgs.push('-map', '0:a');
      }
    }

    if (options.trimSilence !== false) ffmpegArgs.push('-af', filterChain);

    if (format === 'mp3') {
      ffmpegArgs.push(
        '-c:a', options.copyAudio ? 'copy' : 'libmp3lame',
        '-metadata', `title=${title}`,
        '-metadata', `artist=${artist}`,
        '-metadata', `album=${metadata.album || 'Suno Generations'}`,
        '-metadata', `genre=${genre}`,
        '-metadata', `comment=${lyrics}`,
        '-metadata', `lyrics=${lyrics}`
      );
      if (metadata.model) ffmpegArgs.push('-metadata', `model=${metadata.model}`);
      if (metadata.source_url) ffmpegArgs.push('-metadata', `source_url=${metadata.source_url}`);
      if (metadata.id) ffmpegArgs.push('-metadata', `suno_id=${metadata.id}`, '-metadata', `suno_complete=${metadata.complete === true ? '1' : '0'}`);
      if (metadata.created_at) ffmpegArgs.push('-metadata', `date=${metadata.created_at}`);
      if (!options.copyAudio) ffmpegArgs.push('-b:a', this.audioBitrate);
    } else if (format === 'wav') {
      ffmpegArgs.push('-c:a', 'pcm_s24le', '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, '-metadata', `genre=${genre}`, '-metadata', `comment=${lyrics}`);
    }

    ffmpegArgs.push(outputPath);

    return new Promise((resolve, reject) => {
      console.log('[AudioEngine] Encoding audio:', { format, trimSilence: options.trimSilence !== false, coverEmbedded });
      const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
      const timeout = setTimeout(() => proc.kill(), 240000);
      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        // Clean up temporary cover image
        if (tempCoverPath && fs.existsSync(tempCoverPath)) {
          try { fs.unlinkSync(tempCoverPath); } catch (_) {}
        }
        if (coverDir) { try { fs.rmdirSync(coverDir); } catch (_) {} }
        // Remove the source only after a successful encode. Failures are recoverable.
        if (code === 0 && fs.existsSync(outputPath) && fs.existsSync(inputPath)) {
          try { fs.unlinkSync(inputPath); } catch (_) {}
        }

        if (code === 0 && fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          resolve({
            success: true,
            filePath: outputPath,
            fileName: path.basename(outputPath),
            fileSize: stats.size,
            coverEmbedded,
            title,
            artist,
            genre
          });
        } else {
          // An optional cover must never turn valid audio into a failed recording.
          if (fs.existsSync(outputPath)) { try { fs.unlinkSync(outputPath); } catch (_) {} }
          if (coverEmbedded && !options.withoutCoverRetry) {
            this.processAndTrimAudio(inputPath, { ...metadata, image_url: '' }, { ...options, withoutCoverRetry: true }).then(resolve, reject);
            return;
          }
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Directly download lossless stream from Suno CDN with metadata & optional silence trimming
   */
  async grabDirectStream(streamUrl, metadata = {}, trimSilence = false) {
    const tempInput = path.join(this.outputDir, `temp_stream_${Date.now()}.mp3`);
    await this.downloadFile(streamUrl, tempInput);

    if (trimSilence) {
      return await this.processAndTrimAudio(tempInput, metadata, { format: 'mp3', trimSilence: true });
    } else {
      // Just tag & save original file
      return await this.processAndTrimAudio(tempInput, metadata, { format: 'mp3', trimSilence: false, copyAudio: true });
    }
  }

  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const client = url.startsWith('https') ? https : http;

      const request = client.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Referer': 'https://suno.com/'
        }
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Handle redirect
          file.close();
          return this.downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(destPath));
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    });
  }
}

module.exports = AudioEngine;
