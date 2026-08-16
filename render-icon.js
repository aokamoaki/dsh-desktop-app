// Render an SVG via <img> into a deterministic 256x256 PNG (forced light scheme).
// Usage: electron render-icon.js <svg-path> <out-png>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const b64 = Buffer.from(svg).toString('base64');
  const html = `<!doctype html><html><head><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${b64}" width="256" height="256" style="display:block"></body></html>`;
  const win = new BrowserWindow({
    width: 256, height: 256, show: true, useContentSize: true,
    webPreferences: { partition: 'icon3-tmp', contextIsolation: true, sandbox: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 1000));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(process.argv[3], img.toPNG());
  console.log('saved', process.argv[3], JSON.stringify(img.getSize()));
  app.exit(0);
}).catch((e) => { console.log('failed', e.message); app.exit(2); });
