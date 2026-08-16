// screenshot-ui.js - capture local UI windows for visual review (dev tool, not shipped).
// Usage: electron screenshot-ui.js [titlebar|splash|dashboard]*
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');

app.whenReady().then(async () => {
  const args = process.argv.slice(2);
  const names = args.length ? args : ['titlebar', 'splash', 'dashboard'];
  const SIZES = { titlebar: [800, 40], splash: [400, 330], dashboard: [760, 680] };
  for (const name of names) {
    const [w, h] = SIZES[name] || [600, 400];
    const win = new BrowserWindow({
      width: w, height: h, show: false, frame: false,
      backgroundColor: name === 'titlebar' ? '#12151c' : '#12151c',
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    const file = name === 'titlebar' ? 'titlebar.html' : name === 'splash' ? 'index.html' : 'dashboard.html';
    try {
      await win.loadFile(join(__dirname, 'ui', file), { query: { lang: 'zh' } });
      await new Promise((r) => setTimeout(r, 700));
      const img = await win.webContents.capturePage();
      const out = join(__dirname, `shot-${name}.png`);
      fs.writeFileSync(out, img.toPNG());
      console.log('saved', out, JSON.stringify(img.getSize()));
    } catch (e) { console.log('FAIL', name, e.message); }
    win.destroy();
  }
  app.exit(0);
}).catch((e) => { console.log('fatal', e.message); app.exit(3); });
