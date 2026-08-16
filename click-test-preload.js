// Click-test fake bridge: same surface as preview-preload.js, but records
// every call into window.__dshCalls so the click test can assert what ran.
const { contextBridge } = require('electron');

const calls = [];
function rec(name, ...args) {
  calls.push({ name, args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))) });
}

contextBridge.exposeInMainWorld('dsh', {
  getStatus: () => { rec('getStatus'); return Promise.resolve({ phase: 'running', url: 'http://127.0.0.1:3080/', appVersion: '0.1.6', autoLaunch: true, guard: null, update: { available: true, version: '0.2.0' } }); },
  onStatus: (cb) => { rec('onStatus'); return () => {}; },
  getCurrentVersion: () => { rec('getCurrentVersion'); return Promise.resolve('0.1.0-rc.6'); },
  getLatestVersion: () => { rec('getLatestVersion'); return Promise.resolve('0.1.0-rc.7'); },
  getVersions: () => { rec('getVersions'); return Promise.resolve(['0.1.0-rc.7', '0.1.0-rc.6']); },
  getLogTail: (n) => { rec('getLogTail', n); return Promise.resolve(['line1', 'line2']); },
  restart: () => { rec('restart'); return Promise.resolve(); },
  start: () => { rec('start'); return Promise.resolve(); },
  openBrowser: () => { rec('openBrowser'); },
  openLogs: () => { rec('openLogs'); },
  copyUrl: () => { rec('copyUrl'); return Promise.resolve(true); },
  openDataDir: () => { rec('openDataDir'); return Promise.resolve(true); },
  setAutoLaunch: (on) => { rec('setAutoLaunch', on); return Promise.resolve(true); },
  exportDiagnostics: () => { rec('exportDiagnostics'); return Promise.resolve({ ok: true, path: 'C:\\diag.zip' }); },
  updateDsh: (v) => { rec('updateDsh', v); return Promise.resolve(true); },
  checkUpdate: () => { rec('checkUpdate'); return Promise.resolve(); },
  downloadUpdate: () => { rec('downloadUpdate'); return Promise.resolve({ ok: true }); },
  installUpdate: () => { rec('installUpdate'); return true; },
  minimize: () => { rec('minimize'); },
  maximize: () => { rec('maximize'); return Promise.resolve(false); },
  close: () => { rec('close'); },
  isMaximized: () => { rec('isMaximized'); return Promise.resolve(false); },
  // contextBridge copies exposed values, so a live array cannot be shared;
  // a function returns the current snapshot on every call.
  __getCalls: () => calls.map((c) => c.name + (c.args.length ? '(' + c.args.join(',') + ')' : '')),
});
