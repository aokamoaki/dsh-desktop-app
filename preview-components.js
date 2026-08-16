// Extract REAL component styles from the running dsh web UI (buttons, select,
// checkbox/toggle), so the dashboard restyle copies the actual look instead of
// guessing from tokens. Run: node_modules\.bin\electron.cmd preview-components.js --theme=dark
const { app, BrowserWindow, nativeTheme } = require('electron');

const theme = process.argv.includes('--theme=light') ? 'light' : 'dark';

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
        const gs = (el) => { if (!el) return null; const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, border: s.borderColor + ' ' + s.borderWidth, radius: s.borderRadius, pad: s.padding, font: s.fontSize + '/' + s.fontWeight, shadow: s.boxShadow }; };
        const visible = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
        const round = visible.find((b) => getComputedStyle(b).borderRadius.includes('50%'));
        const sel = document.querySelector('select');
        return {
          buttons: visible.slice(0, 5).map((b) => ({ text: (b.textContent || '').trim().slice(0, 24), style: gs(b) })),
          roundButton: round ? { text: (round.textContent || '').trim().slice(0, 12), style: gs(round) } : null,
          select: gs(sel),
        };
      })()`);
      console.log(JSON.stringify({ theme, values }, null, 2));
    } catch (e) {
      console.error('read failed:', e.message);
      process.exitCode = 1;
    }
    app.exit(0);
  }, 5000);
});
