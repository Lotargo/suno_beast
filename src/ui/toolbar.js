const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnReload = document.getElementById('btnReload');
const btnHome = document.getElementById('btnHome');
const urlInput = document.getElementById('urlInput');
const loadingSpinner = document.getElementById('loadingSpinner');

const vuMeter = document.getElementById('vuMeter');
const trackTitle = document.getElementById('trackTitle');
const trackMeta = document.getElementById('trackMeta');

const btnRecord = document.getElementById('btnRecord');
const recText = document.getElementById('recText');
const recTimer = document.getElementById('recTimer');
const autoCaptureToggle = document.getElementById('autoCaptureToggle');
const btnGrabStream = document.getElementById('btnGrabStream');

const btnOpenFolder = document.getElementById('btnOpenFolder');
const btnSettings = document.getElementById('btnSettings');
const btnDevTools = document.getElementById('btnDevTools');

const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const modalBackdrop = document.getElementById('modalBackdrop');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const thresholdInput = document.getElementById('thresholdInput');
const thresholdValue = document.getElementById('thresholdValue');
const formatSelect = document.getElementById('formatSelect');
const outputDirInput = document.getElementById('outputDirInput');
const btnBrowseDir = document.getElementById('btnBrowseDir');

const toastContainer = document.getElementById('toastContainer');

let isRecording = false;
let recordStartTime = null;
let recordTimerInterval = null;
let currentDetectedTrack = null;

// Navigation
btnBack.addEventListener('click', () => window.api.goBack());
btnForward.addEventListener('click', () => window.api.goForward());
btnReload.addEventListener('click', () => window.api.reload());
btnHome.addEventListener('click', () => window.api.goHome());

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    let url = urlInput.value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    window.api.navigateTo(url);
  }
});

btnDevTools.addEventListener('click', () => window.api.openDevTools());
btnOpenFolder.addEventListener('click', () => window.api.openDownloadsFolder());

// Record toggle
btnRecord.addEventListener('click', () => {
  window.api.toggleManualRecord();
});

// Auto Capture Toggle
autoCaptureToggle.addEventListener('change', (e) => {
  const enabled = e.target.checked;
  window.api.setAutoCapture(enabled);
  showToast(
    enabled ? '🤖 Автозахват включен: запись стартует вместе с музыкой' : 'Автозахват выключен',
    enabled ? 'success' : 'info'
  );
});

// Lossless Grab button
btnGrabStream.addEventListener('click', () => {
  if (btnGrabStream.classList.contains('disabled')) return;
  window.api.grabCurrentStream();
  showToast('⚡ Захватываем оригинальный MP3 напрямую из сети...', 'info');
});

// Audio level from preload
window.api.onAudioLevel((level) => {
  vuMeter.style.height = `${Math.min(100, Math.max(0, level))}%`;
});

// URL & Loading updates
window.api.onUrlChanged((url) => {
  urlInput.value = url;
});

window.api.onLoadingState((loading) => {
  if (loading) {
    loadingSpinner.classList.remove('hidden');
  } else {
    loadingSpinner.classList.add('hidden');
  }
});

// Track detected event
window.api.onTrackDetected((data) => {
  currentDetectedTrack = data;
  trackTitle.textContent = data.title || 'Безымянный трек';
  trackMeta.textContent = `${data.artist || 'Suno'} ${data.tags ? '• ' + data.tags : ''}`;

  if (data.audio_src) {
    btnGrabStream.classList.remove('disabled');
    btnGrabStream.title = `Скачать оригинал потока: ${data.title}`;
  }
});

// Recording status updates
window.api.onRecordingStatus((status) => {
  isRecording = status.isRecording;

  if (isRecording) {
    btnRecord.classList.add('recording');
    recText.textContent = 'STOP';
    recTimer.classList.remove('hidden');
    recordStartTime = Date.now();
    updateTimerDisplay();
    clearInterval(recordTimerInterval);
    recordTimerInterval = setInterval(updateTimerDisplay, 500);

    showToast(
      status.triggerType === 'auto'
        ? `🔴 Авто-запись: ${status.title || 'Трек'}`
        : '🔴 Идёт запись... Нажми STOP для завершения и обрезки тишины',
      'info'
    );
  } else {
    btnRecord.classList.remove('recording');
    recText.textContent = 'REC';
    recTimer.classList.add('hidden');
    clearInterval(recordTimerInterval);
  }
});

function updateTimerDisplay() {
  if (!recordStartTime) return;
  const elapsedSec = Math.floor((Date.now() - recordStartTime) / 1000);
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  recTimer.textContent = `${mins}:${secs}`;
}

// Toast notification
window.api.onToast((data) => {
  showToast(data.message, data.type || 'info');
});

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Settings Modal
btnSettings.addEventListener('click', async () => {
  const settings = await window.api.getSettings();
  thresholdInput.value = settings.thresholdDb || -45;
  thresholdValue.textContent = `${thresholdInput.value} dB`;
  formatSelect.value = settings.format || 'mp3';
  outputDirInput.value = settings.outputDir || '';
  settingsModal.classList.remove('hidden');
});

btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
modalBackdrop.addEventListener('click', () => settingsModal.classList.add('hidden'));

thresholdInput.addEventListener('input', (e) => {
  thresholdValue.textContent = `${e.target.value} dB`;
});

btnBrowseDir.addEventListener('click', async () => {
  const selectedPath = await window.api.selectOutputDirectory();
  if (selectedPath) {
    outputDirInput.value = selectedPath;
  }
});

btnSaveSettings.addEventListener('click', () => {
  const newSettings = {
    thresholdDb: Number(thresholdInput.value),
    format: formatSelect.value,
    outputDir: outputDirInput.value
  };
  window.api.saveSettings(newSettings);
  settingsModal.classList.add('hidden');
  showToast('Настройки сохранены!', 'success');
});
