// ============================================================
//  DeepSeek Harness desktop client - main process (lightweight shell)
//  ASCII only. Plain CommonJS (Electron main).
//
//  Purpose: a thin native window + tray shell around an ALREADY-
//  installed `dsh web`. It spawns (or restarts) dsh on a loopback
//  port, loads the authenticated ready URL (dsh 0.1.2+ prints a
//  `?token=` launch URL) into a sandboxed WebContentsView, and
//  survives crashes with exponential backoff. It does NOT install
//  or update a dsh runtime, bundle npm/pnpm, or depend on any
//  curated plugin (market / startup-guard / notify are gone).
// ============================================================

const { app, BrowserWindow, WebContentsView, Tray, Menu, nativeImage, nativeTheme, shell, ipcMain, clipboard, screen, Notification } = require('electron');
const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const { join, basename } = require('node:path');
const fs = require('node:fs');
const core = require('./lib/core.js');

const SMOKE = process.argv.includes('--smoke');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'web');
const PORT = Number(process.env.DSH_DESKTOP_PORT || 3080);
const READY_PREFIX = 'dsh web: ';
const READY_TIMEOUT_MS = 60000;
// Crash-restart policy: exponential backoff (1s, 2s, 4s, 8s), then give up
// and surface the error instead of restart-looping forever.
const MAX_RESTARTS = 5;
// Frameless titlebar height; the web view sits below it.
const TITLEBAR_H = 36;

// --- i18n (follows the MAIN PROGRAM's language) --------------
// The shell follows the web app's explicit locale (settings.yaml
// locale.preference, written by the dsh web settings UI) so tray, context
// menus and notifications stay in the same language as the web UI. Without an
// explicit web preference it falls back to the Windows display language.
const WEB_LOCALE = core.readLocalePreference(DSH_HOME);
const IS_ZH = WEB_LOCALE ? WEB_LOCALE === 'zh' : app.getLocale().toLowerCase().startsWith('zh');
const SEP = IS_ZH ? { colon: '：', open: '（', close: '）' } : { colon: ': ', open: ' (', close: ')' };
const L = {
  zh: {
    open: '打开 DeepSeek Harness', browser: '浏览器打开', restart: '重启服务', start: '启动服务',
    logs: '打开日志目录', quit: '退出',
    file: '文件', edit: '编辑', view: '查看', help: '帮助', reload: '重新加载', exit: '退出',
    actualSize: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullScreen: '全屏',
    about: '关于 DeepSeek Harness', version: '版本',
    serviceError: '服务异常', serviceFailed: '服务启动失败',
    crashN: '崩溃', secLater: '秒后自动重启',
    binNotFound: '未找到已安装的 dsh（请先安装 @deepseek-ai/dsh，然后点“重试”）',
    failedToStart: '服务未能就绪',
    cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    openLink: '在浏览器中打开链接', copyLink: '复制链接地址', openImage: '在浏览器中打开图片', copyImage: '复制图片地址',
    newWindow: '在新窗口中打开链接', saveLink: '链接另存为…', saveImage: '图片另存为…', copyImageBitmap: '复制图片',
    hideToTray: '隐藏到托盘', screenshot: '网页截图', screenshotSaved: '截图已保存', screenshotFailed: '截图失败', inspect: '检查元素',
    find: '页内查找', downloaded: '已下载', downloadFailed: '下载失败',
    phaseStopped: '已停止', phaseStarting: '启动中', phaseRunning: '运行中', phaseError: '错误',
  },
  en: {
    open: 'Open DeepSeek Harness', browser: 'Open in Browser', restart: 'Restart Server', start: 'Start Server',
    logs: 'Open Logs Folder', quit: 'Quit',
    file: 'File', edit: 'Edit', view: 'View', help: 'Help', reload: 'Reload', exit: 'Exit',
    actualSize: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullScreen: 'Full Screen',
    about: 'About DeepSeek Harness', version: 'Version',
    serviceError: 'Service error', serviceFailed: 'Service failed to start',
    crashN: 'crash', secLater: 's · auto-restarting in',
    binNotFound: 'No installed dsh found (install @deepseek-ai/dsh first, then press Retry)',
    failedToStart: 'Server did not become ready',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    openLink: 'Open Link in Browser', copyLink: 'Copy Link Address', openImage: 'Open Image in Browser', copyImage: 'Copy Image Address',
    newWindow: 'Open Link in New Window', saveLink: 'Save Link As…', saveImage: 'Save Image As…', copyImageBitmap: 'Copy Image',
    hideToTray: 'Hide to Tray', screenshot: 'Capture Page', screenshotSaved: 'Screenshot saved', screenshotFailed: 'Screenshot failed', inspect: 'Inspect Element',
    find: 'Find in Page', downloaded: 'Downloaded', downloadFailed: 'Download failed',
    phaseStopped: 'Stopped', phaseStarting: 'Starting', phaseRunning: 'Running', phaseError: 'Error',
  },
};
const T = L[IS_ZH ? 'zh' : 'en'];
/** Localized service-phase name for tray tooltips. */
function phaseName(p) {
  const names = { stopped: T.phaseStopped, starting: T.phaseStarting, running: T.phaseRunning, error: T.phaseError };
  return names[p] || p;
}

// --- resilience guards ---------------------------------------
// The shell must survive a broken stdout/stderr pipe (EPIPE when the parent
// launcher closes) and any other main-process exception: record it, keep
// running, and never surface Electron's crash dialog for these.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => { });
}
process.on('uncaughtException', (err) => {
  try {
    if (logFile) fs.appendFileSync(logFile, `[${new Date().toISOString()}] [uncaught] ${(err && err.stack) || err}\n`);
  } catch { }
});

let wantQuit = false;
let serverProc = null;
let serverUrl = null;     // full authenticated URL (with ?token=) for loading
let serverOrigin = null;  // derived origin, used for same-origin navigation
let workbenchLoaded = false; // whether the web view has already loaded a session
let phase = 'stopped';
let lastError = null;
let crashCount = 0;
let restartTimer = null;
let mainWindow = null; // frameless shell window hosting titlebar + web view
let webView = null;    // WebContentsView rendering the dsh web UI
let splashWindow = null;
let tray = null;
let logFile = null;
let settings = {};
let settingsPath = null;

// --- logging -------------------------------------------------
function ensureLog() {
  if (logFile) return;
  try {
    const dir = join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = join(dir, 'desktop.log');
    // rotate at ~1MB: keep the previous file as desktop.log.1
    try {
      const st = fs.statSync(logFile);
      if (st.size > 1024 * 1024) {
        fs.copyFileSync(logFile, logFile + '.1');
        fs.writeFileSync(logFile, '');
      }
    } catch { }
  } catch { logFile = null; }
}
function log(...parts) {
  ensureLog();
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch { } }
  try { console.log(line); } catch { }
}
function logTail(n) {
  if (!logFile || !fs.existsSync(logFile)) return [];
  try { return fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-n); } catch { return []; }
}

// --- settings -------------------------------------------------
function loadSettings() {
  try {
    settingsPath = join(app.getPath('userData'), 'settings.json');
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch { settings = {}; }
}
function saveSettings() {
  if (!settingsPath) return;
  try {
    const tmp = settingsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, settingsPath);
  } catch { }
}

// --- native notification (shell-owned, no dsh-notify plugin) --
// Shell feedback only; no notify.ps1, no dsh-notify:// protocol, no reading of
// ~/.dsh/dsh-notify.json. Uses Electron's built-in notification.
function notify(title, body, onClick) {
  if (SMOKE) return;
  try {
    const n = new Notification({ title, body });
    if (onClick) n.on('click', onClick);
    n.show();
  } catch (e) { log('notification failed:', e.message); }
}

function safeOpen(url) {
  // Only http(s) may leave the app; anything else (file:, custom schemes) is dropped.
  if (/^https?:\/\//i.test(String(url || ''))) { try { shell.openExternal(url); } catch { } }
}

// --- phase / status ------------------------------------------
function setPhase(p) {
  phase = p;
  log('phase ->', p, serverUrl ? '(' + serverUrl + ')' : '');
  broadcastStatus();
  updateTrayMenu();
}
function broadcastStatus() {
  const payload = { phase, url: serverUrl, error: lastError };
  // Both the titlebar (mainWindow.webContents) and the splash subscribe; push
  // to both so the phase dot / splash stay live without polling.
  for (const win of [splashWindow, mainWindow]) {
    try { if (win && !win.isDestroyed()) win.webContents.send('status:changed', payload); } catch { }
  }
}

// --- server lifecycle ----------------------------------------
function stopServer() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (serverProc && serverProc.exitCode === null && serverProc.signalCode === null) {
    log('stopping server tree, pid', serverProc.pid);
    core.taskkillTree(serverProc.pid);
    try { serverProc.kill(); } catch { }
  }
  serverProc = null;
}
function spawnServer(port) {
  const node = core.resolveNode();
  const bin = core.resolveDshBin(DSH_HOME);
  if (!bin) {
    if (!lastError) lastError = T.binNotFound;
    setPhase('error');
    return null;
  }
  const env = { ...process.env, DSH_HOME };
  if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  const args = [bin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)];
  // dsh hands off to the default browser on `dsh web` unless --no-open is
  // passed; the shell renders in its own view, so keep the browser closed.
  if (core.webAppSupportsNoOpen(DSH_HOME)) args.push('--no-open');
  log('spawn:', node.exe, args.join(' '));
  const proc = spawn(node.exe, args, {
    cwd: PROFILE_DIR, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.on('error', (e) => {
    log('server spawn failed:', e.message);
    serverProc = null;
    lastError = 'server failed to start: ' + e.message;
    setPhase('error');
  });
  proc.stdout.on('error', () => { }); // child died -> pipe break is expected
  proc.stderr.on('error', () => { });
  proc.stdout.on('data', (d) => {
    const text = d.toString();
    log('[dsh]', text.trim().split('\n').join(' | '));
    if (!serverUrl) {
      const u = core.parseDshWebUrl(text, READY_PREFIX);
      if (u) {
        serverUrl = u;
        try { serverOrigin = new URL(u).origin; } catch { serverOrigin = null; }
        crashCount = 0;
        setPhase('running');
        // On a crash/early-exit restart the view already shows a dead session;
        // reload it with the NEW authenticated URL (fresh launch token).
        if (workbenchLoaded) loadWorkbench();
      }
    }
  });
  proc.stderr.on('data', (d) => log('[dsh:err]', d.toString().trim()));
  proc.on('exit', (code) => {
    log('server exited, code', code, 'phase', phase);
    serverProc = null;
    if (wantQuit) { setPhase('stopped'); return; }
    if (phase === 'starting' && code !== null && code !== 0 && port !== 0) {
      log('early exit, retrying with port 0');
      serverUrl = null; serverOrigin = null;
      serverProc = spawnServer(0);
      return;
    }
    if (phase === 'running' && crashCount < MAX_RESTARTS) {
      // Exponential backoff (1s, 2s, 4s, 8s, ...) instead of a single fixed-
      // delay retry: survive transient crashes without restart-looping.
      crashCount += 1;
      const delay = Math.min(8000, 1000 * (2 ** (crashCount - 1)));
      log(`crash detected (${crashCount}/${MAX_RESTARTS}), auto-restarting in ${delay}ms`);
      notify(T.serviceError, `${T.crashN} ${crashCount} · ${Math.round(delay / 1000)} ${T.secLater}`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        serverUrl = null; serverOrigin = null;
        setPhase('starting');
        serverProc = spawnServer(PORT);
      }, delay);
      return;
    }
    lastError = `server exited (code ${code})` + (crashCount > 0 ? ` (${crashCount} restarts)` : '');
    setPhase('error');
    notify(T.serviceFailed, lastError);
  });
  return proc;
}
async function startServer() {
  setPhase('starting');
  serverUrl = null;
  serverOrigin = null;
  serverProc = spawnServer(PORT);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!serverUrl && Date.now() < deadline) {
    if (phase === 'error') break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!serverUrl && phase !== 'error') {
    lastError = T.failedToStart;
    setPhase('error');
  }
}
function restartServer() {
  log('restart requested');
  wantQuit = false;
  lastError = null;
  crashCount = 0; // a manual restart is a fresh start: reset the backoff budget
  stopServer();
  setTimeout(async () => {
    setPhase('stopped');
    startServer();
  }, 700);
}

// --- tray ----------------------------------------------------
const TRAY_COLORS = { stopped: [128, 128, 128], starting: [77, 110, 254], running: [52, 199, 89], error: [229, 72, 77] };
function makeDotIcon(rgb) {
  const size = 16, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
    const i = (y * size + x) * 4;
    if (d <= 6.5) { buf[i] = rgb[2]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[0]; buf[i + 3] = 255; }
    else if (d <= 7.5) { buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = 255; }
    else { buf[i + 3] = 0; }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}
function trayImage() {
  try {
    const dark = nativeTheme.shouldUseDarkColors;
    const p = join(__dirname, 'assets', dark ? 'icon-white.png' : 'icon.png');
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  } catch { }
  return makeDotIcon(TRAY_COLORS[phase] || TRAY_COLORS.stopped);
}
function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip('DeepSeek Harness - ' + phaseName(phase));
    tray.on('double-click', showMain);
    updateTrayMenu();
    nativeTheme.on('updated', () => { if (tray) { try { tray.setImage(trayImage()); } catch { } } });
  } catch (e) {
    log('tray creation failed:', e.message);
    wantQuit = true;
    app.quit();
  }
}
function updateTrayMenu() {
  if (!tray) return;
  try { tray.setImage(trayImage()); } catch { }
  tray.setToolTip('DeepSeek Harness - ' + phaseName(phase));
  const menu = Menu.buildFromTemplate([
    { label: T.open, click: showMain },
    { type: 'separator' },
    { label: phase === 'running' ? T.restart : T.start, click: () => { if (phase === 'running') restartServer(); else startServer(); } },
    { label: T.browser, click: () => { if (serverUrl) safeOpen(serverUrl); } },
    { label: T.logs, click: () => { try { shell.openPath(join(app.getPath('userData'), 'logs')); } catch { } } },
    { type: 'separator' },
    { label: 'DeepSeek Harness - ' + phaseName(phase), enabled: false },
    { type: 'separator' },
    { label: T.quit, click: () => { wantQuit = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// --- windows ------------------------------------------------
function restoreBounds() {
  const w = settings.window;
  if (!w || typeof w.x !== 'number') return null;
  const onScreen = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return w.x < a.x + a.width && w.x + w.width > a.x && w.y < a.y + a.height && w.y + w.height > a.y;
  });
  return onScreen ? w : null;
}
function webContents() { return webView ? webView.webContents : null; }
/** Load the authenticated ready URL into the workbench view (fire-and-forget). */
function loadWorkbench() {
  const wc = webContents();
  if (wc && serverUrl) {
    wc.loadURL(serverUrl).catch(() => { });
    workbenchLoaded = true;
  }
}
function themeBackground() { return nativeTheme.shouldUseDarkColors ? '#1e2227' : '#eef0f4'; }
function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setOpacity(0);
  mainWindow.show();
  mainWindow.focus();
  let o = 0;
  const step = () => { o = Math.min(1, o + 0.2); mainWindow.setOpacity(o); if (o < 1) setTimeout(step, 16); };
  step();
}
/** Fade the main window out and hide it to the tray (same path as the close button). */
function hideToTray() {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  settings.window = { x: b.x, y: b.y, width: b.width, height: b.height };
  saveSettings();
  let o = 1;
  const step = () => { o -= 0.2; mainWindow.setOpacity(Math.max(0, o)); if (o > 0) setTimeout(step, 16); else mainWindow.hide(); };
  step();
}
/** Keep the web view filling the window below the titlebar. */
function layoutWebView() {
  if (!mainWindow || !webView) return;
  const [w, h] = mainWindow.getContentSize();
  try { webView.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H) }); } catch { }
}
// "Open Link in New Window": a standalone sandboxed window for an http(s) URL.
function openNewWindow(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 640, minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: themeBackground(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => { safeOpen(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => {
    if (/^https?:\/\//i.test(u)) return;
    e.preventDefault();
    safeOpen(u);
  });
  try { win.loadURL(url); } catch { }
}
function createMainWindow() {
  const b = restoreBounds();
  mainWindow = new BrowserWindow({
    x: b ? b.x : undefined, y: b ? b.y : undefined,
    width: b ? b.width : 1280, height: b ? b.height : 820,
    minWidth: 960, minHeight: 640,
    title: 'DeepSeek Harness',
    show: false,
    frame: false, // frameless: the local titlebar hosts the window controls
    icon: join(__dirname, 'assets', 'icon.png'),
    backgroundColor: themeBackground(),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Local titlebar (preload bridge only, trusted file:// UI).
  mainWindow.loadFile(join(__dirname, 'ui', 'titlebar.html'), { query: { lang: IS_ZH ? 'zh' : 'en' } });
  // The remote dsh web UI lives in a separate view below the titlebar with
  // NO preload and NO IPC access (same isolation posture as before).
  webView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.contentView.addChildView(webView);
  layoutWebView();
  mainWindow.on('resize', layoutWebView);
  mainWindow.on('close', (e) => {
    if (!wantQuit) {
      e.preventDefault();
      hideToTray();
    }
  });
  const wc = webContents();
  wc.setWindowOpenHandler(({ url }) => {
    safeOpen(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    // Only the managed server origin may navigate the workbench view.
    let allowed = false;
    if (serverOrigin) {
      try { const u = new URL(url); allowed = u.origin === serverOrigin && (u.protocol === 'http:' || u.protocol === 'https:'); } catch { }
    }
    if (allowed) return;
    e.preventDefault();
    safeOpen(url);
  });
  wc.on('did-finish-load', () => {
    if (SMOKE) {
      // Exit hard: app.quit() walks the window-close/fade/stopServer path and
      // can leave Electron child processes behind in smoke mode (observed),
      // which then locks dist/ for the next build.
      console.log('SMOKE_OK', wc.getURL());
      app.exit(0);
    }
  });
  mainWindow.once('ready-to-show', () => { if (SMOKE) mainWindow.show(); else showMain(); });
  // Web-native experience (VS Code style)
  installApplicationMenu();
  installContextMenu();
  installDownloads();
  installZoomMemory();
  // Browser-habit keys that must not become menu accelerators.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const plain = !input.control && !input.alt && !input.meta && !input.shift;
    if (plain && input.key === 'F5') { event.preventDefault(); wc.reload(); }
    else if (plain && input.key === 'F12') { event.preventDefault(); wc.toggleDevTools(); }
  });
  if (process.env.DSH_DEVTOOLS === '1') {
    wc.openDevTools({ mode: 'detach' });
  }
  nativeTheme.on('updated', () => { try { mainWindow.setBackgroundColor(themeBackground()); } catch { } });
}

// --- web-native experience (VS Code style) --------------------
function installApplicationMenu() {
  const template = [
    {
      label: T.file,
      submenu: [
        { label: T.reload, accelerator: 'Ctrl+R', click: () => { const wc = webContents(); if (wc) wc.reload(); } },
        { label: T.restart, accelerator: 'Ctrl+Shift+R', click: () => { if (phase === 'running') restartServer(); } },
        { type: 'separator' },
        { label: T.browser, click: () => { if (serverUrl) shell.openExternal(serverUrl); } },
        { type: 'separator' },
        { label: T.hideToTray, accelerator: 'Ctrl+W', click: hideToTray },
        { role: 'quit', label: T.exit, accelerator: 'Ctrl+Q' },
      ],
    },
    {
      label: T.edit,
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: T.find, accelerator: 'Ctrl+F', click: openFindBar },
      ],
    },
    {
      label: T.view,
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { label: T.screenshot, accelerator: 'Ctrl+Shift+S', click: captureScreenshot },
        { label: T.inspect, accelerator: 'Ctrl+Shift+C', click: inspectElementMode },
        { type: 'separator' },
        { role: 'resetZoom', label: T.actualSize },
        { role: 'zoomIn', label: T.zoomIn },
        { role: 'zoomOut', label: T.zoomOut },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' },
        { role: 'togglefullscreen', label: T.fullScreen },
      ],
    },
    {
      label: T.help,
      submenu: [
        { label: T.logs, click: () => { try { shell.openPath(join(app.getPath('userData'), 'logs')); } catch { } } },
        { type: 'separator' },
        { label: T.about, click: () => { const d = app.getVersion(); notify('DeepSeek Harness', `${T.version} ${d}`); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
/** Ctrl+Shift+S (Edge "web capture" habit): snapshot the workbench viewport. */
async function captureScreenshot() {
  const wc = webContents();
  if (!wc) return;
  try {
    const img = await wc.capturePage();
    if (img.isEmpty()) { notify('DeepSeek Harness', T.screenshotFailed); return; }
    const dir = join(app.getPath('downloads'), 'DSH');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = join(dir, `dsh-shot-${stamp}.png`);
    fs.writeFileSync(out, img.toPNG());
    notify('DeepSeek Harness', `${T.screenshotSaved}${SEP.colon}${out}`);
    shell.showItemInFolder(out);
  } catch (e) { log('screenshot failed:', e.message); }
}
/** Ctrl+Shift+C (Chrome habit): pick an element, then DevTools opens on it. */
function inspectElementMode() {
  const wc = webContents();
  if (!wc) return;
  wc.executeJavaScript(`new Promise((resolve) => {
    const done = (x, y) => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      resolve({ x, y });
    };
    const onClick = (e) => { e.preventDefault(); e.stopPropagation(); done(e.clientX, e.clientY); };
    const onKey = (e) => { if (e.key === 'Escape') done(-1, -1); };
    const timer = setTimeout(() => done(-1, -1), 10000);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'crosshair';
  })`, true).then((p) => {
    if (p && p.x >= 0 && p.y >= 0) wc.inspectElement(p.x, p.y);
    else wc.openDevTools({ mode: 'detach' });
  }).catch(() => { try { wc.openDevTools({ mode: 'detach' }); } catch { } });
}
/** Ctrl+F: inject the lightweight find bar into the workbench view. */
function openFindBar() {
  const wc = webContents();
  if (!wc) return;
  try {
    const findJs = fs.readFileSync(join(__dirname, 'ui', 'find.js'), 'utf8');
    wc.executeJavaScript(findJs.replace('__LOCALE__', IS_ZH ? 'zh' : 'en'), true).catch(() => { });
  } catch (e) { log('find bar failed:', e.message); }
}
function installContextMenu() {
  const wc = webContents();
  if (!wc) return;
  wc.on('context-menu', (_e, params) => {
    const menu = [];
    const isEditable = params.isEditable;
    const { selectionText, linkURL, srcURL } = params;
    if (isEditable) {
      menu.push({ role: 'cut', label: T.cut }, { role: 'copy', label: T.copy }, { role: 'paste', label: T.paste }, { role: 'selectAll', label: T.selectAll });
    } else if (selectionText && selectionText.trim() !== '') {
      menu.push({ role: 'copy', label: T.copy }, { role: 'selectAll', label: T.selectAll });
    }
    if (linkURL) {
      if (menu.length > 0) menu.push({ type: 'separator' });
      menu.push(
        { label: T.openLink, click: () => safeOpen(linkURL) },
        { label: T.newWindow, click: () => openNewWindow(linkURL) },
      );
      if (/^https?:\/\//i.test(linkURL)) {
        menu.push({ label: T.saveLink, click: () => { try { wc.session.downloadURL(linkURL); } catch { } } });
      }
      menu.push({ label: T.copyLink, click: () => clipboard.writeText(linkURL) });
    }
    if (srcURL && !linkURL) {
      if (menu.length > 0) menu.push({ type: 'separator' });
      menu.push({ label: T.openImage, click: () => safeOpen(srcURL) });
      if (/^https?:\/\//i.test(srcURL)) {
        menu.push(
          { label: T.saveImage, click: () => { try { wc.session.downloadURL(srcURL); } catch { } } },
          {
            label: T.copyImageBitmap,
            click: () => {
              nativeImage.createFromURL(srcURL).then((img) => {
                if (!img.isEmpty()) clipboard.writeImage(img);
                else clipboard.writeText(srcURL);
              }).catch(() => clipboard.writeText(srcURL));
            },
          },
        );
      }
      menu.push({ label: T.copyImage, click: () => clipboard.writeText(srcURL) });
    }
    if (menu.length === 0) {
      menu.push({ role: 'copy', label: T.copy }, { role: 'selectAll', label: T.selectAll });
    }
    Menu.buildFromTemplate(menu).popup({ window: mainWindow });
  });
}
function installDownloads() {
  const wc = webContents();
  if (!wc) return;
  wc.session.on('will-download', (e, item) => {
    const dir = join(app.getPath('downloads'), 'DSH');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const name = basename(String(item.getFilename() || '')).replace(/^\.+/, '') || 'download';
    const path = join(dir, name);
    item.setSavePath(path);
    item.once('done', (_ev, state) => {
      if (state === 'completed') {
        notify('DeepSeek Harness', `${T.downloaded}${SEP.colon}${item.getFilename()}${SEP.open}${dir}${SEP.close}`);
      } else if (state === 'interrupted') {
        notify('DeepSeek Harness', `${T.downloadFailed}${SEP.colon}${item.getFilename()}`);
      }
    });
  });
}
function installZoomMemory() {
  const wc = webContents();
  if (!wc) return;
  if (typeof settings.zoomFactor === 'number' && settings.zoomFactor > 0) {
    wc.setZoomFactor(settings.zoomFactor);
  }
  wc.on('zoom-changed', (_e, direction) => {
    if (direction === 'in' || direction === 'out') {
      const z = wc.getZoomFactor();
      const next = direction === 'in' ? Math.min(3, z + 0.1) : Math.max(0.5, z - 0.1);
      settings.zoomFactor = Math.round(next * 100) / 100;
      saveSettings();
    }
  });
  wc.on('did-finish-load', () => { wc.setZoomFactor(settings.zoomFactor || 1); });
}
function createSplash() {
  if (SMOKE) return;
  splashWindow = new BrowserWindow({
    width: 400, height: 300, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(join(__dirname, 'ui', 'index.html'), { query: { lang: IS_ZH ? 'zh' : 'en' } });
  splashWindow.on('closed', () => { splashWindow = null; });
}

// --- IPC -----------------------------------------------------
// Only the local splash/titlebar windows (file:// UI with the preload bridge)
// may call these handlers. The remote dsh web view has no preload and gets
// zero IPC access; this check is defense in depth.
function trustedSender(event) {
  const id = event.sender.id;
  return (splashWindow && !splashWindow.isDestroyed() && splashWindow.webContents.id === id) ||
    (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === id);
}
function statusPayload() {
  return { phase, url: serverUrl, error: lastError, locale: IS_ZH ? 'zh' : 'en', appVersion: app.getVersion() };
}
function registerIpc() {
  ipcMain.handle('status:get', (e) => trustedSender(e) ? statusPayload() : null);
  ipcMain.handle('server:start', async (e) => {
    if (trustedSender(e) && (phase === 'stopped' || phase === 'error')) await startServer();
  });
  ipcMain.handle('server:restart', (e) => { if (trustedSender(e)) restartServer(); });
  ipcMain.handle('app:openBrowser', (e) => { if (trustedSender(e) && serverUrl) safeOpen(serverUrl); });
  ipcMain.handle('app:openLogs', (e) => { if (trustedSender(e)) { try { shell.openPath(join(app.getPath('userData'), 'logs')); } catch { } } });
  ipcMain.handle('logs:tail', (e, n) => trustedSender(e) ? logTail(Number(n) || 20) : []);
  // window controls for ANY frameless local window (titlebar + splash header).
  ipcMain.handle('win:minimize', (e) => { if (trustedSender(e)) { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); } });
  ipcMain.handle('win:maximize', (e) => {
    if (!trustedSender(e)) return null;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return null;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('win:close', (e) => { if (trustedSender(e)) { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); } });
  ipcMain.handle('win:isMaximized', (e) => { if (!trustedSender(e)) return null; const w = BrowserWindow.fromWebContents(e.sender); return w ? w.isMaximized() : false; });
}

// --- app lifecycle -------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(async () => {
    ensureLog();
    loadSettings();
    // The profile dir must exist before anything spawns with it as cwd.
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    registerIpc();
    createTray();
    createSplash();
    createMainWindow();
    await startServer();
    if (serverUrl) {
      loadWorkbench();
      if (splashWindow && !splashWindow.isDestroyed()) setTimeout(() => splashWindow.close(), 800);
    } else if (!SMOKE) {
      log('server unavailable; splash shows the error card');
    }
  });
  app.on('before-quit', () => { wantQuit = true; });
  app.on('will-quit', () => { stopServer(); });
  app.on('window-all-closed', () => { /* tray-resident */ });
}