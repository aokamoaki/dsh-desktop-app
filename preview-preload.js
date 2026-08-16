// Fake dsh bridge for the offscreen dashboard preview (preview.js only).
// Mirrors preload.js's API surface with canned data so dashboard.js renders
// its full states: running phase, guard report with a broken bundle,
// available app update, versions, and log lines.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  getStatus: () => Promise.resolve({
    phase: 'running',
    url: 'http://127.0.0.1:3080/',
    appVersion: '0.1.1',
    autoLaunch: true,
    guard: {
      at: '2026-08-15T20:02:59.277Z',
      skipped: false,
      repaired: 0,
      rolledBack: 0,
      autoDisabled: 1,
      broken: [{ profile: 'web', bundle: 'dsh-notify', reason: 'client bundle does not register its id via __ModuleLoader__.load (unbuilt or stale source)' }],
    },
    update: { available: true, version: '0.2.0', url: 'https://example.com/dsh-update.json' },
  }),
  onStatus: () => () => {},
  getCurrentVersion: () => Promise.resolve('0.1.0-rc.6'),
  getLatestVersion: () => Promise.resolve('0.1.0-rc.7'),
  getVersions: () => Promise.resolve(['0.1.0-rc.7', '0.1.0-rc.6', '0.1.0-rc.5', '0.1.0-rc.4']),
  getLogTail: () => Promise.resolve([
    '[2026-08-15T20:02:59.129Z] session guard: 0 repaired, 0 torn-tail (normal, kept)',
    '[2026-08-15T20:02:59.139Z] preflight complete',
    '[2026-08-15T21:25:19.358Z] startup-guard: {"repaired":0,"autoDisabled":0,"broken":[]}',
    '[2026-08-15T21:25:19.367Z] phase -> running (http://127.0.0.1:3080/)',
  ]),
  restart: () => {},
  start: () => {},
  openBrowser: () => {},
  openLogs: () => {},
  setAutoLaunch: () => Promise.resolve(true),
  exportDiagnostics: () => Promise.resolve({ ok: true, path: 'C:\\Users\\akino\\Downloads\\DSH\\dsh-diagnostics-2026-08-16.zip' }),
  updateDsh: () => Promise.resolve(true),
  checkUpdate: () => {},
  downloadUpdate: () => Promise.resolve({ ok: true }),
  installUpdate: () => true,
  // frameless window controls (dashboard header is the title bar)
  minimize: () => {},
  maximize: () => Promise.resolve(false),
  close: () => {},
  isMaximized: () => Promise.resolve(false),
});
