// One-shot UI capture helper (diagnostics only, not shipped).
// Usage: electron capture-ui.js <out1.png> [out2.png]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const out1 = process.argv[2] || 'capture.png';
const out2 = process.argv[3] || null;

app.whenReady().then(async () => {
  console.log('[capture] ready, loading...');
  const win = new BrowserWindow({
    width: 1280, height: 820, show: true,
    webPreferences: { partition: 'capture-tmp', contextIsolation: true, sandbox: true },
  });
  const loaded = await Promise.race([
    win.loadURL('http://127.0.0.1:3080/').then(() => true).catch((e) => { console.log('[capture] load error:', e.message); return false; }),
    new Promise((r) => setTimeout(() => { console.log('[capture] load timeout'); r(false); }, 30000)),
  ]);
  console.log('[capture] loaded =', loaded);
  await new Promise((r) => setTimeout(r, 10000));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out1, img.toPNG());
  console.log('[capture] saved', out1, JSON.stringify(img.getSize()));
  if (out2) {
    win.setSize(1680, 1000);
    await new Promise((r) => setTimeout(r, 4000));
    const img2 = await win.webContents.capturePage();
    fs.writeFileSync(out2, img2.toPNG());
    console.log('[capture] saved', out2, JSON.stringify(img2.getSize()));
  }
  app.exit(0);
}).catch((e) => {
  console.log('[capture] fatal:', e.message);
  app.exit(3);
});
