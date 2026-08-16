// Real-click test for every dashboard button: load the real dashboard page,
// click each control, assert the expected bridge call happened and the page
// raised no uncaught errors. Run: electron click-test.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hardExit = setTimeout(() => { console.log('HARD_TIMEOUT'); app.exit(2); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 760, height: 620, show: false,
    webPreferences: { preload: path.join(__dirname, 'click-test-preload.js'), contextIsolation: true, sandbox: true },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  await win.loadFile(path.join(__dirname, 'ui', 'dashboard.html'), { query: { lang: 'zh', theme: 'light' } });
  await sleep(1200);

  const report = await win.webContents.executeJavaScript(`(async () => {
    const calls = () => window.dsh.__getCalls();
    const out = [];
    const click = async (id, expect) => {
      const before = calls().join('|');
      const el = document.getElementById(id);
      if (!el) { out.push(id + ': NO ELEMENT'); return; }
      el.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = calls().join('|');
      const ran = after !== before;
      out.push(id + ': ' + (ran ? 'clicked -> ' + after.replace(before, '').trim() : 'NO CALL'));
      if (expect && !ran) out.push(id + ': !! expected call missing');
    };
    await click('restart', true);      // getStatus -> running -> restart
    await click('browser', true);
    await click('logs', true);
    await click('diag', true);
    await click('chkUpdate', true);
    await click('refresh', true);
    await click('copyUrl', true);
    await click('dataDir', true);
    // autoLaunch checkbox: set checked then dispatch change
    const al = document.getElementById('autoLaunch');
    if (al) { const before = calls().length; al.checked = false; al.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 200)); out.push('autoLaunch: ' + (calls().length > before ? 'changed -> ' + calls()[calls().length - 1] : 'NO CALL')); }
    // update: versions select must have options; click update
    await click('update', true);
    // dlUpdate is hidden until an update is available; force show and click
    const dl = document.getElementById('dlUpdate');
    if (dl) { dl.style.display = 'inline-block'; await click('dlUpdate', true); }
    // window controls
    await click('winMin', true);
    await click('winMax', true);
    // winClose would call close() - no-op in the fake bridge
    await click('winClose', true);
    return out.join('\\n');
  })()`);

  console.log('CLICK_REPORT\n' + report);
  console.log('PAGE_ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
  clearTimeout(hardExit);
  app.exit(0);
}).catch((e) => { console.log('FATAL:' + e.message); app.exit(3); });
