// Diagnose en+dark dashboard styling: dump data-theme, token values and the
// computed color of real buttons. Run: node_modules\.bin\electron.cmd preview-diag.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 760, height: 620, show: false,
    webPreferences: { preload: path.join(__dirname, 'preview-preload.js'), contextIsolation: true, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, 'ui', 'dashboard.html'), { query: { lang: 'en', theme: 'dark' } });
  setTimeout(async () => {
    try {
      const diag = await win.webContents.executeJavaScript(`(() => {
        const html = document.documentElement;
        const cs = getComputedStyle(html);
        const btn = document.getElementById('restart');
        const bcs = getComputedStyle(btn);
        const lbl = document.querySelector('.row .lbl');
        const lcs = getComputedStyle(lbl);
        return {
          dataTheme: html.dataset.theme,
          rootLabelPrimary: cs.getPropertyValue('--dsw-alias-label-primary').trim(),
          rootBgBase: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
          bodyColor: getComputedStyle(document.body).color,
          restartText: btn.textContent,
          restartColor: bcs.color,
          restartBorder: bcs.borderColor,
          labelText: lbl.textContent,
          labelColor: lcs.color,
        };
      })()`);
      console.log(JSON.stringify(diag, null, 2));
    } catch (e) {
      console.error('diag failed:', e.message);
      process.exitCode = 1;
    }
    app.exit(0);
  }, 1400);
});
