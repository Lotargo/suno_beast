const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Navigation
  goBack: () => ipcRenderer.send('nav-back'),
  goForward: () => ipcRenderer.send('nav-forward'),
  reload: () => ipcRenderer.send('nav-reload'),
  goHome: () => ipcRenderer.send('nav-home'),
  navigateTo: (url) => ipcRenderer.send('nav-goto', url),
  openDevTools: () => ipcRenderer.send('open-devtools'),

  // Audio Recording & Sniffer
  toggleManualRecord: () => ipcRenderer.send('toggle-manual-record'),
  setAutoCapture: (enabled) => ipcRenderer.send('set-auto-capture', enabled),
  grabCurrentStream: () => ipcRenderer.send('grab-current-stream'),
  openDownloadsFolder: () => ipcRenderer.send('open-downloads-folder'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),

  // Events from main process
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (_, url) => callback(url)),
  onLoadingState: (callback) => ipcRenderer.on('loading-state', (_, loading) => callback(loading)),
  onRecordingStatus: (callback) => ipcRenderer.on('recording-status', (_, data) => callback(data)),
  onTrackDetected: (callback) => ipcRenderer.on('track-detected', (_, data) => callback(data)),
  onAudioLevel: (callback) => ipcRenderer.on('audio-level', (_, level) => callback(level)),
  onToast: (callback) => ipcRenderer.on('show-toast', (_, toast) => callback(toast))
});
