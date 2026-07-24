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
  onStealthChanged: (cb) => {
    const listener = (_e, visible) => cb(visible);
    ipcRenderer.on('stealth-changed', listener);
    return () => ipcRenderer.removeListener('stealth-changed', listener);
  },
});
