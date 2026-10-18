const { ipcRenderer } = require('electron');

// CRITICAL: Only run on Suno domains! Never touch Google, Discord, Apple, or other auth domains!
const currentHost = window.location.hostname;
if (!['suno.com', 'www.suno.com'].includes(currentHost)) {
  return;
}

console.log('[SunoBeast] Preload activated on Suno page:', currentHost);

let activeMediaRecorder = null;
let recordedChunks = [];
let audioContext = null;
let mediaSourceNode = null;
let analyserNode = null;
let visualizerInterval = null;
let activeAudioElement = null;
let isAutoCaptureEnabled = false;
let isRecording = false;

// Receive settings / state updates from main process
ipcRenderer.on('update-auto-capture', (_, enabled) => {
  isAutoCaptureEnabled = enabled;
  console.log('[SunoBeast] Auto-capture state:', isAutoCaptureEnabled);
});

ipcRenderer.on('start-manual-recording', () => {
  startAudioRecording('manual');
});

ipcRenderer.on('stop-manual-recording', () => {
  stopAudioRecording('manual');
});

/**
 * Extract track metadata from Suno DOM
 */
function scrapeTrackMetadata() {
  const meta = {
    title: 'Suno Generation',
    artist: 'Suno AI',
    tags: '',
    prompt: '',
    image_url: '',
    audio_src: activeAudioElement ? (activeAudioElement.currentSrc || activeAudioElement.src) : ''
  };

  try {
    // 1. Look in the player footer/bar (bottom fixed area)
    const playerBar = document.querySelector('footer') ||
                      document.querySelector('[data-testid="player"]') ||
                      document.querySelector('div[class*="player"]') ||
                      document.querySelector('div[class*="Player"]');

    if (playerBar) {
      // Find title
      const titleEl = playerBar.querySelector('a[href*="/song/"]') ||
                      playerBar.querySelector('h3, h4, h5') ||
                      playerBar.querySelector('div[class*="title"], span[class*="title"]') ||
                      playerBar.querySelector('button[aria-label*="Play"]');

      if (titleEl && titleEl.textContent) {
        meta.title = titleEl.textContent.trim();
      }

      // Find artist / username
      const userEl = playerBar.querySelector('a[href*="/@"]') ||
                     playerBar.querySelector('span[class*="creator"], div[class*="creator"]');
      if (userEl && userEl.textContent) {
        meta.artist = userEl.textContent.trim().replace(/^@/, '');
      }

      // Find cover art
      const imgEl = playerBar.querySelector('img[src*="suno"], img[src*="cdn"]');
      if (imgEl && imgEl.src) {
        meta.image_url = imgEl.src;
      }
    }

    // 2. Fallback: check currently active row/item
    const activeRow = document.querySelector('[data-is-playing="true"]') ||
                      document.querySelector('.playing') ||
                      document.querySelector('tr[class*="active"], div[class*="active"]');
    if (activeRow) {
      const rowTitle = activeRow.querySelector('a[href*="/song/"], span[class*="title"]');
      if (rowTitle && rowTitle.textContent) {
        meta.title = rowTitle.textContent.trim();
      }
      const rowTags = activeRow.querySelector('span[class*="style"], div[class*="tag"]');
      if (rowTags && rowTags.textContent) {
        meta.tags = rowTags.textContent.trim();
      }
      const rowImg = activeRow.querySelector('img');
      if (rowImg && rowImg.src && !meta.image_url) {
        meta.image_url = rowImg.src;
      }
    }
  } catch (err) {
    console.warn('[SunoBeast] Error scraping metadata:', err);
  }

  return meta;
}

/**
 * Setup live visualizer analyzer from audio element
 */
function setupAudioAnalyser(audioEl) {
  if (activeAudioElement === audioEl && analyserNode) return;
  activeAudioElement = audioEl;

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    try {
      if (!mediaSourceNode) {
        mediaSourceNode = audioContext.createMediaElementSource(audioEl);
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 64;
        mediaSourceNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
      }
    } catch (e) {
      // Audio element might already be connected
      console.log('[SunoBeast] MediaElementSource notice:', e.message);
    }

    if (!visualizerInterval) {
      const dataArray = new Uint8Array(32);
      visualizerInterval = setInterval(() => {
        if (!analyserNode || !isRecording) {
          ipcRenderer.send('audio-level-update', 0);
          return;
        }
        analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalizedLevel = Math.min(100, Math.round((avg / 255) * 100));
        ipcRenderer.send('audio-level-update', normalizedLevel);
      }, 60);
    }
  } catch (err) {
    console.warn('[SunoBeast] WebAudio setup error:', err);
  }
}

/**
 * Start recording audio stream
 */
function startAudioRecording(triggerType = 'manual') {
  if (isRecording) return;
  if (!activeAudioElement) {
    activeAudioElement = document.querySelector('audio');
  }

  if (!activeAudioElement) {
    console.warn('[SunoBeast] No audio element found to record!');
    ipcRenderer.send('recording-error', 'Не найден аудиоплеер Suno. Запусти трек в Suno!');
    return;
  }

  try {
    let stream = null;
    if (typeof activeAudioElement.captureStream === 'function') {
      stream = activeAudioElement.captureStream();
    } else if (typeof activeAudioElement.mozCaptureStream === 'function') {
      stream = activeAudioElement.mozCaptureStream();
    }

    if (!stream) {
      console.warn('[SunoBeast] captureStream() not available on audio element!');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    recordedChunks = [];
    activeMediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 320000 });

    activeMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    activeMediaRecorder.onstop = async () => {
      isRecording = false;
      const metadata = scrapeTrackMetadata();
      const blob = new Blob(recordedChunks, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      console.log(`[SunoBeast] Recording stopped. Sending ${buffer.length} bytes to main process...`);
      ipcRenderer.send('recorded-audio-ready', {
        buffer,
        mimeType,
        metadata,
        triggerType
      });
    };

    activeMediaRecorder.start(250);
    isRecording = true;
    console.log(`[SunoBeast] Recording started (${triggerType})`);
    ipcRenderer.send('recording-started', {
      triggerType,
      metadata: scrapeTrackMetadata()
    });
  } catch (err) {
    console.error('[SunoBeast] Failed to start MediaRecorder:', err);
    ipcRenderer.send('recording-error', err.message);
  }
}

/**
 * Stop recording audio stream
 */
function stopAudioRecording(triggerType = 'manual') {
  if (!isRecording || !activeMediaRecorder) return;
  try {
    activeMediaRecorder.stop();
  } catch (err) {
    console.error('[SunoBeast] Error stopping recorder:', err);
  }
}

/**
 * Listen to audio elements via DOM events (clean, native, undetectable)
 */
function handleAudioPlay(audioEl) {
  activeAudioElement = audioEl;

  setTimeout(() => {
    const meta = scrapeTrackMetadata();
    meta.audio_src = audioEl.currentSrc || audioEl.src;
    ipcRenderer.send('suno-track-detected', meta);

    // Auto-capture behavior
    if (isAutoCaptureEnabled && !isRecording) {
      startAudioRecording('auto');
    }
  }, 200);

  audioEl.addEventListener('ended', () => {
    console.log('[SunoBeast] Audio ended event fired');
    if (isAutoCaptureEnabled && isRecording) {
      stopAudioRecording('auto');
    }
  }, { once: true });

  audioEl.addEventListener('pause', () => {
    console.log('[SunoBeast] Audio paused event fired');
    if (isAutoCaptureEnabled && isRecording) {
      setTimeout(() => {
        if (audioEl.paused && isRecording) {
          stopAudioRecording('auto');
        }
      }, 1200);
    }
  });

  setupAudioAnalyser(audioEl);
}

// Global DOM capture of all 'play' events on any audio element
document.addEventListener('play', (e) => {
  if (e.target && e.target.tagName === 'AUDIO') {
    handleAudioPlay(e.target);
  }
}, true);

// Periodic check for existing audio elements
setInterval(() => {
  const audio = document.querySelector('audio');
  if (audio && audio !== activeAudioElement) {
    activeAudioElement = audio;
    if (!audio.paused && isAutoCaptureEnabled && !isRecording) {
      handleAudioPlay(audio);
    }
  }
}, 1500);
