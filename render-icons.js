// Render an SVG into a SQUARE icon canvas at multiple sizes.
// Usage: electron render-icons.js <svg-path> <out-dir> <size1,size2,...>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svgPath = process.argv[2];
const outDir = process.argv[3];
const sizes = process.argv[4] ? process.argv[4].split(',').map(Number) : [256, 128, 64, 48, 32, 24, 16];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const match = svg.match(/<svg[^>]*>/);
  const attrs = match ? match[0] : '<svg>';
  const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
        ${attrs.replace('>', ' style="width:' + Math.round(size * 0.8) + 'px;height:auto;display:block">')}${inner}</svg>
      </div></body></html>`;
    const win = new BrowserWindow({
      width: size, height: size, show: false,
      webPreferences: { partition: 'icon-render-tmp', contextIsolation: true, sandbox: true },
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    const out = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(out, img.toPNG());
    win.destroy();
    console.log('rendered', out, JSON.stringify(img.getSize()));
  }
  app.exit(0);
}).catch((e) => { console.log('failed', e.message); app.exit(2); });
