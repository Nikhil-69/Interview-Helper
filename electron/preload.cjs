const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),

  // Screen-capture protection / stealth
  getCaptureStatus: () => ipcRenderer.invoke('capture:getStatus'),
  scanForCaptureApps: () => ipcRenderer.invoke('capture:scan'),
  toggleStealth: (forceState) => ipcRenderer.invoke('stealth:toggle', forceState),
  moveToNextDisplay: () => ipcRenderer.invoke('window:moveToNextDisplay'),
  setCompactMode: (compact) => ipcRenderer.invoke('window:setCompact', compact),
  setCollapsed: (collapsed, expandedSize) => ipcRenderer.invoke('window:setCollapsed', collapsed, expandedSize),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onStealthChanged: (cb) => {
    const listener = (_e, visible) => cb(visible);
    ipcRenderer.on('stealth-changed', listener);
    return () => ipcRenderer.removeListener('stealth-changed', listener);
  },

  // Auto-update
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.send('updater:install'),
  onUpdateStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});
