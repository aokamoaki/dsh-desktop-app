// preload for the LOCAL windows only (titlebar / splash).
// The remote dsh web view never gets a preload (zero IPC for remote pages).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  start: () => ipcRenderer.invoke('server:start'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openBrowser: () => ipcRenderer.invoke('app:openBrowser'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  getLogTail: (n) => ipcRenderer.invoke('logs:tail', n),
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