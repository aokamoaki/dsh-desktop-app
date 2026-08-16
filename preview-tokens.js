// Read the REAL computed token values from the running dsh web UI, so the
// dashboard can replicate the exact palette. Run:
//   node_modules\.bin\electron.cmd preview-tokens.js --theme=dark
const { app, BrowserWindow, nativeTheme } = require('electron');

const theme = process.argv.includes('--theme=light') ? 'light' : 'dark';
const TOKENS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
  '--dsw-alias-hover-l2', '--dsw-alias-label-tertiary',
];

app.whenReady().then(async () => {
  nativeTheme.themeSource = theme;
  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL('http://127.0.0.1:3080/');
  setTimeout(async () => {
    try {
      const values = await win.webContents.executeJavaScript(`(() => {
        const s = getComputedStyle(document.body);
        const out = {};
        for (const t of ${JSON.stringify(TOKENS)}) out[t] = s.getPropertyValue(t).trim() || null;
        return out;
      })()`);
      console.log(JSON.stringify({ theme, values }, null, 2));
    } catch (e) {
      console.error('token read failed:', e.message);
      process.exitCode = 1;
    }
    app.exit(0);
  }, 5000);
});
