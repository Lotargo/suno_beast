const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AudioEngine = require('./audio-engine');

// Set proper app name for clean userData folder
app.name = 'suno-beast-browser';

let mainWindow = null;
let toolbarView = null;
let sunoView = null;

const DEFAULT_DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DEFAULT_DOWNLOAD_DIR)) {
  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });
}

const SETTINGS_FILE = path.join(DEFAULT_DOWNLOAD_DIR, 'suno_settings.json');
let settings = {
  thresholdDb: -45,
  format: 'mp3',
  outputDir: DEFAULT_DOWNLOAD_DIR,
  isAutoCapture: false,
  trimSilence: true
};

try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    settings = { ...settings, ...loaded };
  }
} catch (err) {
  console.warn('Could not read settings file:', err);
}

const audioEngine = new AudioEngine({
  outputDir: settings.outputDir,
  thresholdDb: settings.thresholdDb
});

let currentDetectedTrack = null;
let isCurrentlyRecording = false;

// Google sign-in uses the Chrome/Edge extension, never a spoofed embedded UA.

function saveSettingsToDisk() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function updateLayout() {
  if (!mainWindow) return;
  const bounds = mainWindow.getContentBounds();
  const toolbarHeight = 56;

  if (toolbarView) {
    toolbarView.setBounds({ x: 0, y: 0, width: bounds.width, height: toolbarHeight });
  }
  if (sunoView) {
    sunoView.setBounds({
      x: 0,
      y: toolbarHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - toolbarHeight)
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    title: 'Suno Beast Browser',
    backgroundColor: '#090a0f',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const sunoSession = session.fromPartition('persist:suno_vault', { cache: true });

  // Network Sniffer: Intercept Suno CDN audio streams
  sunoSession.webRequest.onCompleted({
    urls: [
      '*://*.suno.ai/*.mp3*',
      '*://*.suno.ai/*.wav*',
      '*://*.suno.ai/audio/*',
      '*://audiopipe.suno.ai/*'
    ]
  }, (details) => {
    if (details.statusCode === 200 || details.statusCode === 206) {
      console.log('[Sniffer] Caught Suno audio stream:', details.url);
      if (currentDetectedTrack) {
        currentDetectedTrack.audio_src = details.url;
      } else {
        currentDetectedTrack = {
          title: 'Suno Audio Stream',
          artist: 'Suno AI',
          audio_src: details.url
        };
      }
      sendToToolbar('track-detected', currentDetectedTrack);
    }
  });

  // 1. Toolbar View
  toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-toolbar.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  toolbarView.webContents.loadFile(path.join(__dirname, 'ui', 'toolbar.html'));

  // 2. Suno Web View
  sunoView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-suno.js'),
      partition: 'persist:suno_vault',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  const sunoContents = sunoView.webContents;

  // Handle OAuth popups (Google / Discord / Apple login)
  sunoContents.setWindowOpenHandler(({ url }) => {
    const isAuth =
      url.includes('google') ||
      url.includes('discord') ||
      url.includes('apple') ||
      url.includes('suno.com') ||
      url.includes('clerk');

    if (isAuth) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 620,
          height: 750,
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:suno_vault',
            contextIsolation: true
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.contentView.addChildView(toolbarView);
  mainWindow.contentView.addChildView(sunoView);

  updateLayout();
  mainWindow.on('resize', updateLayout);

  // Load Suno
  sunoContents.loadURL('https://suno.com');

  // Page lifecycle events
  sunoContents.on('did-navigate', (_, url) => {
    sendToToolbar('url-changed', url);
  });
  sunoContents.on('did-navigate-in-page', (_, url) => {
    sendToToolbar('url-changed', url);
  });
  sunoContents.on('did-start-loading', () => {
    sendToToolbar('loading-state', true);
  });
  sunoContents.on('did-stop-loading', () => {
    sendToToolbar('loading-state', false);
  });

  sunoContents.on('did-finish-load', () => {
    sunoContents.send('update-auto-capture', settings.isAutoCapture);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToToolbar(channel, data) {
  if (toolbarView && toolbarView.webContents) {
    toolbarView.webContents.send(channel, data);
  }
}

function sendToSuno(channel, data) {
  if (sunoView && sunoView.webContents) {
    sunoView.webContents.send(channel, data);
  }
}

// ----------------------------------------------------
// IPC Event Handlers
// ----------------------------------------------------

// Navigation
ipcMain.on('nav-back', () => sunoView && sunoView.webContents.goBack());
ipcMain.on('nav-forward', () => sunoView && sunoView.webContents.goForward());
ipcMain.on('nav-reload', () => sunoView && sunoView.webContents.reload());
ipcMain.on('nav-home', () => sunoView && sunoView.webContents.loadURL('https://suno.com'));
ipcMain.on('nav-goto', (_, url) => sunoView && sunoView.webContents.loadURL(url));
ipcMain.on('open-devtools', () => {
  if (sunoView) sunoView.webContents.openDevTools({ mode: 'detach' });
});

// Audio Levels
ipcMain.on('audio-level-update', (_, level) => {
  sendToToolbar('audio-level', level);
});

// Track detected from Suno DOM or sniffer
ipcMain.on('suno-track-detected', (_, meta) => {
  currentDetectedTrack = meta;
  sendToToolbar('track-detected', meta);
});

// Recording controls
ipcMain.on('toggle-manual-record', () => {
  if (isCurrentlyRecording) {
    sendToSuno('stop-manual-recording');
  } else {
    sendToSuno('start-manual-recording');
  }
});

ipcMain.on('set-auto-capture', (_, enabled) => {
  settings.isAutoCapture = enabled;
  saveSettingsToDisk();
  sendToSuno('update-auto-capture', enabled);
});

ipcMain.on('recording-started', (_, data) => {
  isCurrentlyRecording = true;
  sendToToolbar('recording-status', {
    isRecording: true,
    triggerType: data.triggerType,
    title: data.metadata ? data.metadata.title : 'Запись'
  });
});

ipcMain.on('recording-error', (_, errMsg) => {
  isCurrentlyRecording = false;
  sendToToolbar('recording-status', { isRecording: false });
  sendToToolbar('show-toast', { message: errMsg, type: 'error' });
});

// Recorded audio ready for silence trimming
ipcMain.on('recorded-audio-ready', async (_, data) => {
  isCurrentlyRecording = false;
  sendToToolbar('recording-status', { isRecording: false });

  sendToToolbar('show-toast', {
    message: '✂️ Обрезаем пустоту на старте и в конце...',
    type: 'info'
  });

  try {
    const tempRawPath = path.join(settings.outputDir, `raw_rec_${Date.now()}.webm`);
    fs.writeFileSync(tempRawPath, Buffer.from(data.buffer));

    const metadata = data.metadata || currentDetectedTrack || {};
    audioEngine.setSettings({
      outputDir: settings.outputDir,
      thresholdDb: settings.thresholdDb
    });

    const result = await audioEngine.processAndTrimAudio(tempRawPath, metadata, {
      format: settings.format
    });

    console.log('[AudioEngine] Successfully processed track:', result.fileName);
    sendToToolbar('show-toast', {
      message: `✅ Сохранен: ${result.fileName} (тишина удалена!)`,
      type: 'success'
    });
  } catch (err) {
    console.error('[AudioEngine] Error trimming audio:', err);
    sendToToolbar('show-toast', {
      message: `Ошибка обработки: ${err.message}`,
      type: 'error'
    });
  }
});

// Lossless stream grab
ipcMain.on('grab-current-stream', async () => {
  if (!currentDetectedTrack || !currentDetectedTrack.audio_src) {
    sendToToolbar('show-toast', {
      message: 'Поток ещё не перехвачен. Запусти воспроизведение трека!',
      type: 'error'
    });
    return;
  }

  sendToToolbar('show-toast', {
    message: '⚡ Скачиваем студийный оригинал MP3...',
    type: 'info'
  });

  try {
    audioEngine.setSettings({
      outputDir: settings.outputDir,
      thresholdDb: settings.thresholdDb
    });
    const result = await audioEngine.grabDirectStream(
      currentDetectedTrack.audio_src,
      currentDetectedTrack,
      settings.trimSilence
    );

    sendToToolbar('show-toast', {
      message: `⚡ Чистый MP3 сохранен: ${result.fileName}`,
      type: 'success'
    });
  } catch (err) {
    console.error('[Sniffer] Grab error:', err);
    sendToToolbar('show-toast', {
      message: `Ошибка скачивания: ${err.message}`,
      type: 'error'
    });
  }
});

// Open output directory in Windows File Explorer
ipcMain.on('open-downloads-folder', () => {
  shell.openPath(settings.outputDir);
});

// Settings IPC
ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.on('save-settings', (_, newSettings) => {
  settings = { ...settings, ...newSettings };
  audioEngine.setSettings({
    outputDir: settings.outputDir,
    thresholdDb: settings.thresholdDb
  });
  saveSettingsToDisk();
});

ipcMain.handle('select-output-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: settings.outputDir
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
