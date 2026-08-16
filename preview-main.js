// Offscreen capture of the real dsh web main UI, as the visual reference for
// the dashboard restyle. Run: node_modules\.bin\electron.cmd preview-main.js --theme=dark --out=main-ui-dark.png
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');

const theme = process.argv.includes('--theme=light') ? 'light' : 'dark';
const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice(6) : 'main-ui.png';

app.whenReady().then(async () => {
  nativeTheme.themeSource = theme;
  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    backgroundColor: theme === 'dark' ? '#1e2227' : '#eef0f4',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL('http://127.0.0.1:3080/');
  // give the web UI time to boot and render
  setTimeout(async () => {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(out, img.toPNG());
      console.log('saved', out, img.getSize());
    } catch (e) {
      console.error('capture failed:', e.message);
      process.exitCode = 1;
    }
    app.exit(0);
  }, 5000);
});
