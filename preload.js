const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('primeAPI', {
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  chooseFolder: kind => ipcRenderer.invoke('choose-folder', kind),
  chooseLogo: () => ipcRenderer.invoke('choose-logo'),
  scanFolder: folder => ipcRenderer.invoke('scan-folder', folder),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  openOutput: folder => ipcRenderer.invoke('open-output', folder),
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  previewFrame: video => ipcRenderer.invoke('preview-frame', video),
  processVideos: payload => ipcRenderer.invoke('process-videos', payload),
  onProgress: callback => ipcRenderer.on('process-progress', (_event, data) => callback(data))
});
