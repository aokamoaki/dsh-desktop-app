// Offscreen render of ui/dashboard.html with a fake dsh bridge, for visual
// review and iteration. Run:  node_modules\.bin\electron.cmd preview.js --lang=zh --theme=light --out=preview-zh-light.png
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const lang = process.argv.includes('--lang=en') ? 'en' : 'zh';
const theme = process.argv.includes('--theme=dark') ? 'dark' : process.argv.includes('--theme=light') ? 'light' : 'system';
const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice(6) : 'preview.png';

app.whenReady().then(async () => {
  nativeTheme.themeSource = theme === 'system' ? 'light' : theme;
  const win = new BrowserWindow({
    width: 760, height: 620, show: false,
    backgroundColor: theme === 'dark' ? '#151517' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preview-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, 'ui', 'dashboard.html'), { query: { lang, theme } });
  // let the bridge promise chain and fonts settle before capturing
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
  }, 1400);
});
