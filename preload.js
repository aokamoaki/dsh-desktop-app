// preload for the LOCAL windows only (titlebar / splash / dashboard).
// The remote dsh web view never gets a preload (zero IPC for remote pages).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  start: () => ipcRenderer.invoke('server:start'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openBrowser: () => ipcRenderer.invoke('app:openBrowser'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  copyUrl: () => ipcRenderer.invoke('app:copyUrl'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  getLogTail: (n) => ipcRenderer.invoke('logs:tail', n),
  getCurrentVersion: () => ipcRenderer.invoke('dsh:current'),
  getLatestVersion: () => ipcRenderer.invoke('dsh:latest'),
  getVersions: () => ipcRenderer.invoke('dsh:versions'),
  updateDsh: (v) => ipcRenderer.invoke('dsh:update', v),
  getAutoLaunch: () => ipcRenderer.invoke('app:autoLaunch'),
  setAutoLaunch: (on) => ipcRenderer.invoke('app:autoLaunch', !!on),
  exportDiagnostics: () => ipcRenderer.invoke('app:exportDiagnostics'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  // titlebar window controls
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onStatus: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on('status:changed', handler);
    return () => ipcRenderer.removeListener('status:changed', handler);
  },
});
