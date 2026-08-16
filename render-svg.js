// Render an SVG to a PNG at a given size using a hidden Electron window.
// Usage: electron render-svg.js <svg-path> <out-png> <size>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svgPath = process.argv[2];
const outPng = process.argv[3];
const size = Number(process.argv[4] || 256);

app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace(/<svg/, `<svg width="${size}" height="${size}"`)}</div></body></html>`;
  const win = new BrowserWindow({
    width: size, height: size, show: false,
    webPreferences: { partition: 'svg-render-tmp', contextIsolation: true, sandbox: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(outPng, img.toPNG());
  console.log('saved', outPng, JSON.stringify(img.getSize()));
  app.exit(0);
}).catch((e) => { console.log('failed', e.message); app.exit(2); });
