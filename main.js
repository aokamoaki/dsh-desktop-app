// ============================================================
//  DeepSeek Harness desktop client - main process (S3)
//  ASCII only. Plain CommonJS (Electron main).
//
//  S2: tray state icons (raw RGBA), window bounds memory,
//      settings.json (atomic), theme-aware background.
//  S3: managed dsh runtime in ~/.dsh/desktop-runtime (version
//      lock / update / rollback), Dashboard window, semver
//      update check, npm-cli resolution (bundled -> system).
// ============================================================

const { app, BrowserWindow, WebContentsView, Tray, Menu, nativeImage, nativeTheme, shell, ipcMain, Notification, clipboard, screen, globalShortcut } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const { homedir } = require('node:os');
const { join, basename } = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const core = require('./lib/core.js');

const SMOKE = process.argv.includes('--smoke');
const DEMO = process.argv.includes('--demo');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'web');
const RUNTIME_DIR = join(DSH_HOME, 'desktop-runtime');
const PORT = Number(process.env.DSH_DESKTOP_PORT || 3080);
const INDEX_MARKER = 'DeepSeek Harness';
const URL_PREFIX = 'dsh web: http://127.0.0.1:';
const READY_TIMEOUT_MS = 60000;
// Crash-restart policy: exponential backoff (1s, 2s, 4s, 8s), then give up
// and surface the error instead of restart-looping forever.
const MAX_RESTARTS = 5;
// Frameless titlebar height; the web view sits below it.
const TITLEBAR_H = 36;
const PROTOCOL = 'dsh-notify';

// --- i18n (follows the MAIN PROGRAM's language) --------------
// The shell follows the web app's explicit locale (settings.yaml
// locale.preference, written by the dsh web settings UI) so tray, dashboard,
// context menus and notifications stay in the same language as the web UI.
// Without an explicit web preference it falls back to the Windows display
// language - the same chain the web side uses (explicit -> browser locale).
const WEB_LOCALE = core.readLocalePreference(DSH_HOME);
const IS_ZH = WEB_LOCALE ? WEB_LOCALE === 'zh' : app.getLocale().toLowerCase().startsWith('zh');
// Separators: zh uses full-width, en keeps ASCII spacing.
const SEP = IS_ZH ? { colon: '：', open: '（', close: '）' } : { colon: ': ', open: ' (', close: ')' };
const L = {
  zh: {
    open: '打开 DeepSeek Harness', dashboard: '仪表盘', browser: '浏览器打开', restart: '重启服务', start: '启动服务',
    logs: '打开日志目录', checkUpdate: '检查更新', quit: '退出', settings: '设置',
    file: '文件', edit: '编辑', view: '查看', help: '帮助', reload: '重新加载', exit: '退出',
    actualSize: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullScreen: '全屏',
    about: '关于 DeepSeek Harness', version: '版本', updateAvailable: '发现新版本',
    serviceError: '服务异常', restarting: '自动重启中', serviceFailed: '服务启动失败',
    downloaded: '已下载', downloadFailed: '下载失败', downloadReady: '安装包已就绪',
    installing: '正在安装', installed: '已安装', installFailed: '安装失败',
    crashN: '崩溃', secLater: '秒后自动重启', crashAfter: '次重启后仍失败',
    diagExported: '诊断包已导出', diagExportFailed: '诊断包导出失败',
    curInstall: '正在安装精选插件', curDone: '精选插件安装完成', curSkip: '精选插件已就绪',
    guardOk: '启动体检通过', guardAuto: '已自动禁用损坏插件', guardFixed: '自动修复',
    attach: '已连接运行中的服务', starting: '正在启动服务...', installingRuntime: '正在安装 dsh 运行时...',
    ready: '就绪', failedToStart: '启动失败', retry: '重试',
    runtimeInstallFailed: 'dsh 运行时安装失败', binNotFound: '未找到 dsh 运行时（未安装或安装失败，可点“重试”重新安装）',
    cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    openLink: '在浏览器中打开链接', copyLink: '复制链接地址', openImage: '在浏览器中打开图片', copyImage: '复制图片地址',
    newWindow: '在新窗口中打开链接', saveLink: '链接另存为…', saveImage: '图片另存为…', copyImageBitmap: '复制图片',
    hideToTray: '隐藏到托盘', screenshot: '网页截图', screenshotSaved: '截图已保存', screenshotFailed: '截图失败', inspect: '检查元素',
    find: '页内查找',
    updateUrlMissing: '未配置更新地址（settings.json 的 updateUrl）',
    checkFailed: '检查更新失败',
    phaseStopped: '已停止', phaseStarting: '启动中', phaseInstalling: '安装中', phaseRunning: '运行中', phaseError: '错误',
  },
  en: {
    open: 'Open DeepSeek Harness', dashboard: 'Dashboard', browser: 'Open in Browser', restart: 'Restart Server', start: 'Start Server',
    logs: 'Open Logs Folder', checkUpdate: 'Check for Updates', quit: 'Quit', settings: 'Settings',
    file: 'File', edit: 'Edit', view: 'View', help: 'Help', reload: 'Reload', exit: 'Exit',
    actualSize: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullScreen: 'Full Screen',
    about: 'About DeepSeek Harness', version: 'Version', updateAvailable: 'Update available',
    serviceError: 'Service error', restarting: 'restarting', serviceFailed: 'Service failed to start',
    downloaded: 'Downloaded', downloadFailed: 'Download failed', downloadReady: 'Installer ready',
    installing: 'Installing', installed: 'Installed', installFailed: 'Install failed',
    crashN: 'crash', secLater: 's · auto-restarting in', crashAfter: 'after restarts',
    diagExported: 'Diagnostics exported', diagExportFailed: 'Failed to export diagnostics',
    curInstall: 'Installing curated plugins', curDone: 'Curated plugins installed', curSkip: 'Curated plugins ready',
    guardOk: 'Startup check passed', guardAuto: 'Auto-disabled broken plugin', guardFixed: 'Auto-repaired',
    attach: 'Attached to a running server', starting: 'Starting server...', installingRuntime: 'Installing dsh runtime...',
    ready: 'Ready', failedToStart: 'Failed to start', retry: 'Retry',
    runtimeInstallFailed: 'Failed to install the dsh runtime', binNotFound: 'dsh runtime not found (not installed or install failed - press Retry to reinstall)',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    openLink: 'Open Link in Browser', copyLink: 'Copy Link Address', openImage: 'Open Image in Browser', copyImage: 'Copy Image Address',
    newWindow: 'Open Link in New Window', saveLink: 'Save Link As…', saveImage: 'Save Image As…', copyImageBitmap: 'Copy Image',
    hideToTray: 'Hide to Tray', screenshot: 'Capture Page', screenshotSaved: 'Screenshot saved', screenshotFailed: 'Screenshot failed', inspect: 'Inspect Element',
    find: 'Find in Page',
    updateUrlMissing: 'updateUrl not configured (settings.json)',
    checkFailed: 'Update check failed',
    phaseStopped: 'Stopped', phaseStarting: 'Starting', phaseInstalling: 'Installing', phaseRunning: 'Running', phaseError: 'Error',
  },
};
const T = L[IS_ZH ? 'zh' : 'en'];
/** Localized service-phase name for tray tooltips. */
function phaseName(p) {
  const names = { stopped: T.phaseStopped, starting: T.phaseStarting, installing: T.phaseInstalling, running: T.phaseRunning, error: T.phaseError };
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
let serverUrl = null;
let phase = 'stopped';
let lastError = null;
let mainWindow = null; // frameless shell window hosting titlebar + web view
let webView = null;   // WebContentsView rendering the dsh web UI
let splashWindow = null;
let dashWindow = null;
let tray = null;
let logFile = null;
let settings = {};
let settingsPath = null;
let lastGuard = null;      // latest startup-guard result (shown in splash/dashboard)
let curatedState = null;   // { active, index, total, current, results } for first-run progress
let updateState = null;    // { checking, available, version, url, downloading, downloadedPath }
let dshInstallProgress = null; // { phase, fetched, version } live dsh update/rollback progress

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
  // A broken stdout pipe (parent launcher closed) must never crash the shell.
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

// --- service notifications -----------------------------------
// Shares the dsh-notify config file (~/.dsh/dsh-notify.json): the
// "serviceNotify" toggle in the web General Settings controls these.
// The toast uses the same design as dsh-notify (whale icon + title +
// detail + attribution) via a bundled copy of notify.ps1.
// NOTIFIER_PS1 must be the UNPACKED path: powershell.exe is an external
// process and cannot read files inside app.asar (see asarUnpack in
// package.json build config).
function unpacked(rel) { return core.externalPath(join(__dirname, rel), process.resourcesPath || ''); }
const NOTIFIER_PS1 = unpacked('notifier/notify.ps1');
let notifyCfgCache = null;
let notifyCfgAt = 0;
function readNotifyConfig() {
  const now = Date.now();
  if (notifyCfgCache && now - notifyCfgAt < 30000) return notifyCfgCache;
  try {
    notifyCfgCache = JSON.parse(fs.readFileSync(join(DSH_HOME, 'dsh-notify.json'), 'utf8'));
  } catch { notifyCfgCache = {}; }
  notifyCfgAt = now;
  return notifyCfgCache;
}
/**
 * True while ANY app window (main / dashboard / splash / standalone) holds
 * focus - the correct "user is watching" signal. The old mainWindow-only
 * check misjudged the dashboard-focused state as background.
 * A minimized or hidden window is NOT "watching": on Windows a minimized
 * window can still report isFocused() true, so require both visible and
 * not-minimized.
 */
function anyWindowFocused() {
  try {
    return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused());
  }
  catch { return false; }
}
/**
 * Report the shell's foreground state to the dsh-notify host so conversation
 * completion notifications stay quiet while any app window is focused. The
 * host merges this with the web page's own visibility report (browser
 * sessions). Fire-and-forget; the dsh server may be down or still starting.
 */
function reportShellFocus() {
  if (!serverUrl || SMOKE || DEMO) return;
  const payload = JSON.stringify({ shell: anyWindowFocused() });
  try {
    const req = http.request(new URL('/dsh-notify/foreground', serverUrl), {
      method: 'POST', timeout: 3000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => { res.resume(); });
    req.on('error', () => { });
    req.on('timeout', () => { try { req.destroy(); } catch { } });
    req.end(payload);
  } catch { }
}
/** Watch every BrowserWindow's focus and re-report the merged shell state. */
function installFocusReporting() {
  const rereport = () => setTimeout(reportShellFocus, 0);
  app.on('browser-window-focus', rereport);
  app.on('browser-window-blur', rereport);
  // Minimize / restore / show do NOT emit browser-window-focus/blur, so the
  // shell state would stay stuck at the last focused value: a minimized app
  // would keep reporting foreground=true and swallow completion
  // notifications. Re-report on every visibility transition.
  app.on('browser-window-minimize', rereport);
  app.on('browser-window-restore', rereport);
  app.on('browser-window-show', rereport);
}
function notifyService(title, detail, always = false) {
  if (SMOKE || DEMO) return;
  try {
    const cfg = readNotifyConfig();
    if (cfg.serviceNotify === false) return;
    if (!always && anyWindowFocused()) return; // quiet when the user is watching
    const args = ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', NOTIFIER_PS1,
      '-Name', title, '-Detail', detail,
      '-Tag', 'dsh-service',
      '-Url', serverUrl || 'http://127.0.0.1:3080',
      '-NoSound'];
    if (cfg.toast === false) args.push('-NoToast'); // honor the "System toast" toggle
    spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
  } catch (e) {
    // fallback: Electron notification
    try {
      const n = new Notification({ title, body: detail });
      n.on('click', () => showMain());
      n.show();
    } catch (e2) { log('notification failed:', e2.message); }
  }
}
let notifiedUpdate = false;
function runtimeBin() { return join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'); }
function safeOpen(url) {
  // Only http(s) may leave the app; anything else (file:, custom schemes) is dropped.
  if (/^https?:\/\//i.test(String(url || ''))) { try { shell.openExternal(url); } catch { } }
}
// "Open Link in New Window": a standalone sandboxed window for an http(s) URL.
// No preload, no node integration, and it may never leave http(s) navigation -
// the same isolation posture as the workbench view.
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
function runNpm(args) {
  const node = core.resolveNode();
  const cli = core.resolveNpmCli(process.resourcesPath || '');
  if (!cli) return { status: -1, error: 'npm-cli not found' };
  const env = { ...process.env, DSH_HOME };
  if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  log('npm:', node.exe, cli, ...args);
  const r = spawnSync(node.exe, [cli, ...args], { cwd: PROFILE_DIR, env, windowsHide: true, timeout: 600000 });
  return { status: r.status, out: (r.stdout || '').toString().trim(), err: (r.stderr || '').toString().trim() };
}
function runNpmAsync(args, timeoutMs = 600000, onLine) {
  return new Promise((resolve) => {
    const node = core.resolveNode();
    const cli = core.resolveNpmCli(process.resourcesPath || '');
    if (!cli) { resolve({ status: -1, error: 'npm-cli not found' }); return; }
    const env = { ...process.env, DSH_HOME };
    if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    log('npm(background):', node.exe, cli, ...args);
    const proc = spawn(node.exe, [cli, ...args], { cwd: PROFILE_DIR, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false, timedOut = false;
    // npm's http log emits one line per registry request; forward each line
    // to the caller (dashboard progress) as it arrives.
    const onChunk = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line === '') continue;
        try { if (onLine) onLine(line); } catch { }
      }
    };
    // npm (a node script) can hang on a stalled network; never let the
    // dashboard's update promise dangle forever. Kill the whole tree so no
    // npm child process survives the timeout.
    const timer = setTimeout(() => {
      timedOut = true;
      log('npm(background) timed out after', timeoutMs, 'ms; killing tree', proc.pid);
      core.taskkillTree(proc.pid);
      try { proc.kill(); } catch { }
    }, timeoutMs);
    const settle = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    proc.stdout.on('error', () => { });
    proc.stderr.on('error', () => { });
    proc.stdout.on('data', (d) => { out += d.toString(); onChunk(d); });
    proc.stderr.on('data', (d) => { err += d.toString(); onChunk(d); });
    proc.on('error', (e) => settle({ status: -1, error: String(e && e.message || e), out, err }));
    proc.on('exit', (code) => {
      settle({
        status: timedOut ? -2 : code,
        error: timedOut ? 'npm install timed out after ' + (timeoutMs / 1000) + 's' : undefined,
        out: out.trim(),
        err: err.trim(),
      });
    });
  });
}
function curlJsonAsync(url) {
  // Node http/https fetch with proxy/timeout/redirect support replaces the old
  // curl.exe spawn: metadata fetching no longer depends on curl being present
  // (missing/blocked curl used to silently empty the dsh version list and the
  // app update check). Resolves null on any failure, exactly like before.
  return core.fetchJson(url, { accept: 'application/vnd.npm.install-v1+json', timeoutMs: 20000 });
}
function semverDesc(a, b) { return core.semverDesc(a, b); }
/** Directory holding the shipped first-run seed (package.json + package-lock.json). */
function runtimeSeedDir() {
  // Packaged client: extraResources copy under resources/runtime. Dev (`npm
  // start`, resourcesPath === ''): the repo copy next to this file.
  return process.resourcesPath
    ? join(process.resourcesPath, 'runtime')
    : join(__dirname, 'resources', 'runtime');
}
/** dsh version pinned by the seeded package-lock.json ('' when absent/invalid). */
function lockedDshVersion() {
  try {
    const lock = JSON.parse(fs.readFileSync(join(RUNTIME_DIR, 'package-lock.json'), 'utf8'));
    const p = lock.packages && lock.packages['node_modules/@deepseek-ai/dsh'];
    return (p && typeof p.version === 'string') ? p.version : '';
  } catch { return ''; }
}
async function ensureRuntimeDsh() {
  if (fs.existsSync(runtimeBin())) return { ok: true };
  const ver = settings.dshVersion || 'latest';
  log('installing managed dsh runtime:', ver);
  // The SAME registry resolution as dashboard update/rollback: env override ->
  // settings.json npmRegistry -> zh users default to the npmmirror mirror.
  // First-run auto-install against the official registry hangs on slow CN
  // routes (tarball downloads stall and npm times out), which is how fresh
  // installs end up stuck on "dsh bin not found".
  const registry = npmRegistryOverride();
  // Seed a known-good package.json + package-lock.json when desktop-runtime is
  // missing. WITHOUT a lock, npm 11 spends 10+ minutes (usually past the app's
  // install timeout) resolving this ~500-package, peer-dense dsh tree and then
  // stalls CPU-bound before downloading a single tarball; WITH the seeded lock
  // the identical tree installs in under a minute (measured ~30s on a mirror).
  const seed = runtimeSeedDir();
  const lockPath = join(RUNTIME_DIR, 'package-lock.json');
  if (!fs.existsSync(lockPath) && fs.existsSync(join(seed, 'package-lock.json'))) {
    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      fs.copyFileSync(join(seed, 'package.json'), join(RUNTIME_DIR, 'package.json'));
      fs.copyFileSync(join(seed, 'package-lock.json'), lockPath);
      log('seeded dsh runtime manifest (package.json + package-lock.json) from app resources');
    } catch (e) { log('dsh runtime seed failed:', e && e.message); }
  }
  // --ignore-scripts: koffi / node-pty ship platform prebuilds (verified), and
  // their postinstall steps invoke a bare `node` - which does not exist on a
  // machine without Node (the app runs npm under Electron-as-Node there), so
  // running lifecycle scripts would fail the whole install.
  const common = ['--prefix', RUNTIME_DIR, '--no-audit', '--no-fund', '--ignore-scripts', '--fetch-timeout=120000', '--fetch-retries=1', '--loglevel=http'];
  const registryArgs = [];
  if (registry) { registryArgs.push('--registry=' + registry); log('dsh auto-install using npm registry:', registry); }
  else log('dsh auto-install using npm registry: official (default)');
  // `npm ci` installs exactly the seeded lock - deterministic and fast. It is
  // used when no explicit version is pinned ('latest' means "what the shipped
  // manifest provides" for first boot; the dashboard update path moves to
  // newer versions afterwards). An explicit pinned version outside the lock
  // falls back to `npm install @deepseek-ai/dsh@<ver>`.
  const locked = lockedDshVersion();
  const useCi = fs.existsSync(lockPath) && (ver === 'latest' || ver === locked);
  const npmArgs = (useCi ? ['ci'] : ['install'])
    .concat(common).concat(registryArgs)
    .concat(useCi ? [] : ['@deepseek-ai/dsh@' + ver]);
  log('dsh runtime install mode:', useCi ? 'npm ci (seeded lock, locked ' + locked + ')' : 'npm install @' + ver);
  // Live progress for the first-boot install too (not just dashboard update):
  // parse npm's http log line by line and broadcast the same dshInstallProgress
  // channel the dashboard renders, throttled to 150ms.
  const acc = { phase: 'fetch', fetched: 0 };
  let lastPush = 0;
  const push = (force) => {
    const now = Date.now();
    if (force || now - lastPush > 150) {
      lastPush = now;
      dshInstallProgress = { phase: acc.phase, fetched: acc.fetched, version: ver };
      broadcastStatus();
    }
  };
  // 20 min headroom: the seeded fast path normally finishes in ~1 min, but a
  // cold mirror cache on a slow connection (or a genuine re-resolution) needs
  // room; npm's own fetch attempts are bounded above.
  const r = await runNpmAsync(npmArgs, 1200000, (line) => { core.npmProgressLine(line, acc); push(false); });
  dshInstallProgress = null;
  broadcastStatus();
  log('managed dsh install exit', r.status, r.error || r.err || '');
  if (fs.existsSync(runtimeBin())) return { ok: true };
  // A real, actionable reason for the error card: npm-cli missing / install
  // timeout / npm exit code with the tail of its stderr - never a bare
  // "bin not found" that hides what actually failed.
  let errText = '';
  if (r && r.error) errText = String(r.error);
  else if (r && typeof r.status === 'number' && r.status !== 0) {
    const tail = String(r.err || '').trim().split('\n').slice(-4).join(' ').slice(0, 200);
    errText = 'npm exit ' + r.status + (tail ? ': ' + tail : '');
  } else errText = 'unknown error (see desktop.log)';
  return { ok: false, error: errText };
}
/**
 * Make sure the managed dsh runtime bin exists before the server is spawned:
 * first run installs it, and a FAILED install (network timeout, npm-cli
 * missing, unreachable mirror...) is retried here instead of looping on the
 * bare "bin not found" spawn error. Sets phase/error itself; returns true
 * only when the bin is available afterwards.
 */
async function ensureRuntimeReady() {
  if (core.resolveDshBin(DSH_HOME)) return true;
  setPhase('installing');
  const r = await ensureRuntimeDsh();
  if (r.ok) return true;
  lastError = `${T.runtimeInstallFailed}${SEP.colon}${r.error}`;
  setPhase('error');
  return false;
}
/** Start the server; when the runtime bin is missing, install it first. */
async function startServerSafely() {
  if (await ensureRuntimeReady()) startServer();
}
function currentDshVersion() {
  try { return JSON.parse(fs.readFileSync(join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version; }
  catch { return null; }
}
/**
 * Metadata URL for the dsh package, mirror-aware. Previously hardcoded to the
 * official registry, which ignored the npm mirror toggle (env > settings >
 * zh-default npmmirror) and made version list/latest fail or time out for
 * mirror users. The exact URL construction lives in lib/core.js (pure,
 * unit-tested) so the mirror switch and metadata enum can never drift apart.
 */
function dshMetadataUrl() {
  return core.registryMetadataUrl(npmRegistryOverride(), '@deepseek-ai/dsh');
}
async function latestDshVersion() {
  // The bare /latest endpoint is unreliable; derive it from the metadata
  // document (same source as listDshVersions). The package only ships
  // prerelease tags (0.1.0-rc.x), so no "-" filtering: semverDesc ordering
  // handles stable-vs-prerelease precedence by itself.
  const j = await curlJsonAsync(dshMetadataUrl());
  if (!j || !j.versions) {
    log('dsh metadata fetch failed (offline/unreachable registry); latest version unknown');
    return null;
  }
  const keys = Object.keys(j.versions);
  return keys.length > 0 ? keys.sort(semverDesc)[0] : null;
}
async function listDshVersions() {
  const j = await curlJsonAsync(dshMetadataUrl());
  if (!j || !j.versions) {
    log('dsh metadata fetch failed (offline/unreachable registry); version list unavailable');
    return [];
  }
  return Object.keys(j.versions).sort(semverDesc);
}
async function updateDsh(ver) {
  // Defense in depth: only a strict semver string (optionally with a
  // prerelease suffix like -rc.6) may reach the install command, whatever
  // the caller (IPC or future UI) passes in.
  if (!core.isValidDshVersion(ver)) {
    log('dsh version change rejected (invalid version):', ver);
    return false;
  }
  log('dsh version change requested:', ver);
  // Live progress for the dashboard: parse npm's http log (--loglevel=http)
  // line by line and broadcast throttled updates via the status channel.
  const acc = { phase: 'fetch', fetched: 0 };
  let lastPush = 0;
  const push = (force) => {
    const now = Date.now();
    if (force || now - lastPush > 150) {
      lastPush = now;
      dshInstallProgress = { phase: acc.phase, fetched: acc.fetched, version: ver };
      broadcastStatus();
    }
  };
  // npm registry override: the official registry's tarball downloads can be
  // near-unusable behind slow CN routes while metadata responds fine, which
  // made updates time out at 600s. Honor an explicit registry from env
  // (DSH_NPM_REGISTRY) or settings.json (npmRegistry, editable in the
  // dashboard) so users can point at a mirror without touching .npmrc.
  const registry = npmRegistryOverride();
  // --ignore-scripts: koffi / node-pty ship platform prebuilds; their
  // postinstall steps call a bare `node`, absent on machines without Node
  // (the app itself drives npm via Electron-as-Node there). Running scripts
  // would fail every update on such machines.
  // A fixed --cache plus --prefer-offline lets npm reuse already-downloaded
  // tarballs across update/rollback (and after a wiped runtime dir), so a
  // second update or a rollback no longer re-resolves the whole ~500-package
  // tree from scratch. fetch-timeout/retries align the net-failure feedback
  // with the first-install path instead of waiting for the 900s outer timeout.
  const npmArgs = ['install', '--prefix', RUNTIME_DIR, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=http',
    '--cache', join(DSH_HOME, 'npm-cache'), '--prefer-offline', '--fetch-timeout=120000', '--fetch-retries=1'];
  if (registry) { npmArgs.push('--registry=' + registry); log('dsh update using npm registry:', registry); }
  npmArgs.push('@deepseek-ai/dsh@' + ver);
  const r = await runNpmAsync(npmArgs, 900000, (line) => { core.npmProgressLine(line, acc); push(false); });
  dshInstallProgress = null;
  log('dsh version change exit', r.status, r.error || r.err || '');
  if (r.status === 0) {
    settings.dshVersion = ver; saveSettings();
    // npm >=7 always writes/updates <prefix>/package-lock.json, but verify and
    // record it: a persisted lock is what makes the next reinstall/rollback
    // take the fast `npm ci` path in ensureRuntimeDsh (lockedDshVersion scan).
    if (fs.existsSync(join(RUNTIME_DIR, 'package-lock.json'))) {
      log('dsh version change: package-lock.json persisted at', ver, '(fast reinstall/rollback enabled)');
    } else {
      log('dsh version change: package-lock.json missing after install (npm did not write a lock; slow path on next reinstall)');
    }
    if (phase === 'running') restartServer();
  }
  broadcastStatus();
  return r.status === 0;
}

// --- npm registry override -----------------------------------
// Which registry drives `npm install` for the dsh runtime - first-run
// auto-install AND dashboard update/rollback. The official registry's
// tarball route is near-unusable behind slow CN networks (installs hang and
// time out at 600s), so precedence is:
//   1. env DSH_NPM_REGISTRY
//   2. settings.json npmRegistry (editable from the dashboard); '' = official
//   3. zh users (web locale preference / Windows display language) default to
//      the npmmirror mirror; everyone else defaults to the official registry
// The returned value is passed to npm as --registry=<url>; '' means "npm's
// default (official)" and the flag is omitted.
const DEFAULT_NPM_MIRROR = 'https://registry.npmmirror.com';
function npmRegistryOverride() {
  const envR = (process.env.DSH_NPM_REGISTRY || '').trim();
  if (envR) return envR;
  if (Object.prototype.hasOwnProperty.call(settings, 'npmRegistry')) {
    // Explicit choice (persisted by the dashboard toggle): '' means official.
    return (typeof settings.npmRegistry === 'string' ? settings.npmRegistry : '').trim();
  }
  return IS_ZH ? DEFAULT_NPM_MIRROR : '';
}

// --- phase / status ------------------------------------------
function setPhase(p) {
  phase = p;
  log('phase ->', p, serverUrl ? '(' + serverUrl + ')' : '');
  broadcastStatus();
  updateTrayMenu();
}
function broadcastStatus() {
  const payload = { phase, url: serverUrl, error: lastError, guard: lastGuard, curated: curatedState, update: updateState, dshInstall: dshInstallProgress };
  for (const win of [splashWindow, dashWindow]) {
    try { if (win && !win.isDestroyed()) win.webContents.send('status:changed', payload); } catch { }
  }
}

// --- server lifecycle ----------------------------------------
let crashCount = 0;
let restartTimer = null;
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
    // Keep a more specific error already on record (e.g. "dsh 运行时安装失败:
    // <reason>"); only fall back to the generic message otherwise. Without
    // this, a failed runtime install would be masked as a bare bin-not-found.
    if (!lastError) lastError = T.binNotFound;
    setPhase('error');
    return null;
  }
  const env = { ...process.env, DSH_HOME };
  if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  const args = [bin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)];
  // Newer dsh runtimes hand off to the default browser on `dsh web` unless
  // --no-open is passed. The shell renders the UI in its own embedded view,
  // so the external browser must stay closed; the tray/menu "Open in
  // Browser" item remains the explicit escape hatch. Older runtimes reject
  // the unknown option, so only pass it when the installed runtime supports
  // it (probed from the resolved dsh-web-app package).
  if (core.webAppSupportsNoOpen(DSH_HOME)) args.push('--no-open');
  log('spawn:', node.exe, args.join(' '));
  const proc = spawn(node.exe, args, {
    cwd: PROFILE_DIR, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.on('error', (e) => {
    // Missing cwd / bad node binary must not take down the main process.
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
      const u = core.parseDshWebUrl(text, URL_PREFIX);
      if (u) { serverUrl = u; crashCount = 0; setPhase('running'); reportShellFocus(); }
    }
  });
  proc.stderr.on('data', (d) => log('[dsh:err]', d.toString().trim()));
  // Record a crash so the next boot's startup-guard forces a full host smoke
  // sweep and auto-disables the bundle that caused it.
  const recordCrash = () => {
    try {
      fs.writeFileSync(join(DSH_HOME, 'dsh-crash-state.json'),
        JSON.stringify({ crashedAt: new Date().toISOString(), restarts: crashCount + 1 }));
    } catch { /* best effort */ }
  };
  proc.on('exit', (code) => {
    log('server exited, code', code, 'phase', phase);
    serverProc = null;
    if (wantQuit) {
      // Clean quit, not a crash: clear the guard's boot marker so the next boot
      // does not misread the force-kill as a crashed previous run.
      try { fs.rmSync(join(DSH_HOME, 'dsh-boot-state.json'), { force: true }); } catch { /* best effort */ }
      setPhase('stopped'); return;
    }
    if (phase === 'starting' && code !== null && code !== 0 && port !== 0) {
      recordCrash();
      log('early exit, retrying with port 0');
      serverUrl = null;
      spawnServer(0);
      return;
    }
    if (phase === 'running' && crashCount < MAX_RESTARTS) {
      // Exponential backoff (1s, 2s, 4s, 8s, ...) instead of a single
      // fixed-delay retry: survive transient crashes without restart-looping.
      crashCount += 1;
      recordCrash();
      const delay = Math.min(8000, 1000 * (2 ** (crashCount - 1)));
      log(`crash detected (${crashCount}/${MAX_RESTARTS}), auto-restarting in ${delay}ms`);
      notifyService(T.serviceError, `${T.crashN} ${crashCount} · ${Math.round(delay / 1000)} ${T.secLater}`);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        serverUrl = null;
        setPhase('starting');
        spawnServer(PORT);
      }, delay);
      return;
    }
    lastError = `server exited (code ${code})` + (crashCount > 0 ? ` after ${crashCount} restart(s)` : '');
    setPhase('error');
    notifyService(T.serviceFailed, lastError);
  });
  return proc;
}
// The startup guard runs in a CHILD process: a native crash inside the guard
// (zstd session scan under the Electron runtime) must never take down the app.
async function runGuardOutOfProcess() {
  const guardPath = join(PROFILE_DIR, 'node_modules', 'dsh-startup-guard', 'lib', 'guard-core.mjs');
  if (!fs.existsSync(guardPath)) return null;
  const runner = unpacked('guard-runner.mjs');
  if (!fs.existsSync(runner)) return null;
  return new Promise((resolve) => {
    const node = core.resolveNode();
    const env = { ...process.env, DSH_HOME };
    if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    const proc = spawn(node.exe, [runner, guardPath, DSH_HOME], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    let out = '', err = '';
    proc.stdout.on('error', () => { });
    proc.stderr.on('error', () => { });
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { log('startup-guard spawn failed:', e.message); resolve(null); });
    proc.on('exit', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(out)); } catch { log('startup-guard bad output:', String(out).slice(0, 200)); resolve(null); }
      } else {
        log('startup-guard exit', code, String(err).slice(0, 300));
        resolve(null);
      }
    });
  });
}
async function startServer() {
  setPhase('starting');
  serverUrl = null;
  const guardResult = await runGuardOutOfProcess();
  lastGuard = guardResult || { skipped: true, at: new Date().toISOString() };
  if (lastGuard) lastGuard.at = new Date().toISOString();
  if (guardResult) {
    log('startup-guard:', JSON.stringify({ repaired: guardResult.repaired, rolledBack: guardResult.rolledBack, autoDisabled: guardResult.autoDisabled, broken: guardResult.broken, fixNeeded: guardResult.fixNeeded }));
  }
  broadcastStatus();
  const probeUrl = `http://127.0.0.1:${PORT}/`;
  if (await core.probe(probeUrl, 2500, INDEX_MARKER)) { serverUrl = probeUrl; crashCount = 0; setPhase('running'); log('attached to existing server'); reportShellFocus(); return; }
  serverProc = spawnServer(PORT);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!serverUrl && Date.now() < deadline) {
    if (phase === 'error') break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!serverUrl) {
    // Keep a more specific error (e.g. spawn failure) if one was already set.
    if (phase !== 'error') { lastError = 'server did not become ready within ' + (READY_TIMEOUT_MS / 1000) + 's'; setPhase('error'); }
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
    // Splash "Retry" lands here after a failed start; when the runtime bin is
    // missing (failed first install / wiped runtime dir) re-run the install
    // instead of looping on "bin not found" forever.
    if (!(await ensureRuntimeReady())) return;
    startServer();
  }, 700);
}

// --- first-run curated plugins -------------------------------
// Two-phase provisioning:
//   Phase 1 (awaited BEFORE the server starts): direct-install the
//     bootstrap entry (dshmarket) via `dsh plugin add`. The market itself
//     must exist before the server boots because it is a bundle layer.
//   Phase 2 (after the server is ready): install every remaining entry
//     through the market's own /dsh-market/install API - a same-origin
//     POST carrying an explicit Origin header (the market's gate requires
//     Origin host to match Host; a loopback process is the browser's
//     same-origin equivalent). That buys error classification, pnpm
//     recovery and hot-mounting (no restart) for free. When the market is
//     unreachable (offline, or its registry snapshot lacks the entry) the
//     item falls back to a direct `dsh plugin add`.
// Entries: { name (npm package name for the dependency check), url
//   (curated-registry entry URL the market matches on), spec
//   (direct-install pnpm target), bootstrap? (installed before the server
//   starts) }.
// After a successful pass `curatedDone` is set and the shell never
// reinstalls them: the user may uninstall curated plugins afterwards and
// the client stays fully functional (the shell itself depends on none of
// them - guard and notify integration are missing-safe by design).
function curatedList() {
  const curatedPath = join(__dirname, 'curated.json');
  if (!fs.existsSync(curatedPath)) return [];
  try { return JSON.parse(fs.readFileSync(curatedPath, 'utf8')).plugins || []; } catch { return []; }
}
function curatedMissing() {
  const pkgPath = join(PROFILE_DIR, 'package.json');
  let deps = {};
  try { deps = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies || {}; } catch { }
  return curatedList().filter(p => !deps[p.name]);
}
function runDirectInstall(item) {
  return new Promise((resolve) => {
    const node = core.resolveNode();
    const bin = core.resolveDshBin(DSH_HOME);
    if (!bin) { log('curated direct install skipped:', item.name, 'dsh bin not found'); resolve(false); return; }
    const env = { ...process.env, DSH_HOME };
    if (node.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    const spec = item.spec || item.url;
    const proc = spawn(node.exe, [bin, 'plugin', '--profile', 'web', 'add', spec], { cwd: PROFILE_DIR, env, windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => { log('curated direct install', item.name, 'exit', code); resolve(code === 0); });
  });
}
/** Install one entry through the market API; the response arrives only when the pnpm run finishes. */
function marketInstall(item) {
  return new Promise((resolve) => {
    const base = (serverUrl || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
    const body = JSON.stringify({ url: item.url });
    const req = http.request(base + '/dsh-market/install', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        origin: base,
      },
      timeout: 600000, // pnpm can take minutes; the market caps its own run at 15min
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(data); } catch { }
        const ok = res.statusCode === 200 && !!j && !!j.ok;
        log('curated market install', item.name, 'http', res.statusCode, ok ? ('hot=' + !!j.hot) : ((j && j.error) || data.slice(0, 160)));
        resolve(ok);
      });
    });
    req.on('timeout', () => { req.destroy(); log('curated market install', item.name, 'timed out'); resolve(false); });
    req.on('error', (e) => { log('curated market install', item.name, 'network error:', e.code || e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}
/** Phase 1: ensure the bootstrap (the market itself) exists before the server starts. */
async function ensureCuratedBootstrap() {
  if (settings.curatedDone) {
    log('curated plugins: already provisioned (first-run only)');
    return;
  }
  const boot = curatedMissing().find(p => p.bootstrap);
  if (!boot) return;
  log('curated bootstrap install:', boot.name, boot.spec || boot.url);
  curatedState = { active: true, index: 0, total: 1, current: boot.name, results: [] };
  broadcastStatus();
  const ok = await runDirectInstall(boot);
  curatedState = { active: false, index: ok ? 1 : 0, total: 1, current: null, results: [{ name: boot.name, ok }] };
  broadcastStatus();
  if (!ok) log('curated bootstrap install failed:', boot.name, '(will retry on next launch)');
}
/** Phase 2: install every remaining curated entry through the market. */
async function installCuratedViaMarket() {
  if (settings.curatedDone) return;
  const missing = curatedMissing();
  if (missing.length === 0) {
    log('curated plugins: all present');
    settings.curatedDone = true;
    saveSettings();
    curatedState = { active: false, index: 0, total: 0, current: null, results: [] };
    broadcastStatus();
    return;
  }
  log('curated plugins missing (installing via market):', missing.map(m => m.name).join(', '));
  curatedState = { active: true, index: 0, total: missing.length, current: missing[0].name, results: [] };
  broadcastStatus();
  let allOk = true;
  for (let i = 0; i < missing.length; i++) {
    const item = missing[i];
    curatedState = { active: true, index: i, total: missing.length, current: item.name, results: curatedState.results };
    broadcastStatus();
    let ok = false;
    if (item.url) ok = await marketInstall(item);
    if (!ok) ok = await runDirectInstall(item); // offline / no-url fallback
    curatedState.results.push({ name: item.name, ok });
    if (!ok) allOk = false;
  }
  curatedState = { active: false, index: missing.length, total: missing.length, current: null, results: curatedState.results };
  broadcastStatus();
  // Mark provisioned only when every curated plugin installed cleanly; a
  // failed pass is retried on the next launch.
  if (allOk) {
    settings.curatedDone = true;
    saveSettings();
    log('curated plugins: first-run provisioning complete');
  } else {
    log('curated plugins: some installs failed; will retry on next launch');
  }
}

// --- tray ----------------------------------------------------
const TRAY_COLORS = { stopped: [128, 128, 128], installing: [77, 110, 254], starting: [77, 110, 254], running: [52, 199, 89], error: [229, 72, 77] };
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
// Brand whale tray icon: black on light taskbars, white on dark taskbars.
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
    // No tray -> the window must not hide on close (it would become unreachable).
    log('tray creation failed:', e.message);
    wantQuit = true;
    app.quit();
  }
}
function updateTrayMenu() {
  if (!tray) return;
  try { tray.setImage(trayImage()); } catch { }
  tray.setToolTip('DeepSeek Harness - ' + phaseName(phase));
  // Tray stays a lightweight launcher: full management (browser, logs,
  // update check, diagnostics, versions) lives in the Dashboard, so the
  // tray menu does not duplicate it.
  const menu = Menu.buildFromTemplate([
    { label: T.open, click: showMain },
    { label: T.dashboard, click: showDashboard },
    { type: 'separator' },
    { label: phase === 'running' ? T.restart : T.start, click: () => { if (phase === 'running') restartServer(); else startServerSafely(); } },
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
  // hide() has no browser-window-hide event; report the transition so the
  // notify host stops suppressing completion notifications immediately.
  reportShellFocus();
}
/** Global hotkey Ctrl+Alt+H (WeChat/QQ style): toggle the main window. */
function toggleMainFromGlobal() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) hideToTray();
  else showMain();
}
/** Keep the web view filling the window below the titlebar. */
function layoutWebView() {
  if (!mainWindow || !webView) return;
  const [w, h] = mainWindow.getContentSize();
  try { webView.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H) }); } catch { }
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
      // Closing the window hides to the tray (the app keeps running in the
      // background; use the tray "Quit" item to exit).
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
    if (serverUrl && (url === serverUrl || url.startsWith(serverUrl + '/'))) return;
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
    else applyUiPolish(wc);
  });
  mainWindow.once('ready-to-show', () => { if (SMOKE) mainWindow.show(); else showMain(); });
  // Web-native experience (VS Code style)
  installApplicationMenu();
  installContextMenu();
  installDownloads();
  installZoomMemory();
  // Browser-habit keys that must not become menu accelerators (they would
  // then fire even when DevTools or another window has focus): F5 reload,
  // F12 DevTools. Only the workbench view is affected.
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
// UI polish: the dsh Menu component mounts without animation and leaves a
// double-clicked menu open. A tiny injected CSS/JS layer (desktop window
// only) adds a subtle open animation and closes on double-click. The web
// page itself is never modified on disk.
function applyUiPolish(wc) {
  try {
    const css = fs.readFileSync(join(__dirname, 'ui', 'polish.css'), 'utf8');
    const js = fs.readFileSync(join(__dirname, 'ui', 'polish.js'), 'utf8');
    wc.insertCSS(css);
    wc.executeJavaScript(js, true).catch(() => { });
  } catch (e) { log('ui polish skipped:', e.message); }
}
function installApplicationMenu() {
  const template = [
    {
      label: T.file,
      submenu: [
        { label: T.reload, accelerator: 'Ctrl+R', click: () => { const wc = webContents(); if (wc) wc.reload(); } },
        { label: T.restart, accelerator: 'Ctrl+Shift+R', click: () => { if (phase === 'running') restartServer(); } },
        { type: 'separator' },
        { label: T.browser, click: () => { if (serverUrl) shell.openExternal(serverUrl); } },
        { label: T.settings, accelerator: 'Ctrl+,', click: showDashboard },
        { label: T.dashboard, accelerator: 'Ctrl+Shift+D', click: showDashboard },
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
        { label: T.checkUpdate, click: () => { checkForUpdate(true); } },
        { type: 'separator' },
        { label: T.about, click: () => { const d = app.getVersion(); notifyService('DeepSeek Harness', `${T.version} ${d}`, true); } },
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
    if (img.isEmpty()) { notifyService('DeepSeek Harness', T.screenshotFailed, true); return; }
    const dir = join(app.getPath('downloads'), 'DSH');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = join(dir, `dsh-shot-${stamp}.png`);
    fs.writeFileSync(out, img.toPNG());
    notifyService('DeepSeek Harness', `${T.screenshotSaved}${SEP.colon}${out}`, true);
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
        // Save through the session so the existing will-download handler
        // routes it into Downloads/DSH with the completion toast.
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
              // Copy the actual bitmap to the clipboard (Chrome-style);
              // fall back to the URL when the fetch fails.
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
        notifyService('DeepSeek Harness', `${T.downloaded}${SEP.colon}${item.getFilename()}${SEP.open}${dir}${SEP.close}`);
      } else if (state === 'interrupted') {
        notifyService('DeepSeek Harness', `${T.downloadFailed}${SEP.colon}${item.getFilename()}`);
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
  if (SMOKE || DEMO) return;
  splashWindow = new BrowserWindow({
    width: 400, height: 300, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(join(__dirname, 'ui', 'index.html'), { query: { lang: IS_ZH ? 'zh' : 'en' } });
  splashWindow.on('closed', () => { splashWindow = null; });
}
function showDashboard() {
  if (dashWindow && !dashWindow.isDestroyed()) { dashWindow.show(); dashWindow.focus(); return; }
  // Frameless like the main window: the dashboard page's own header (brand
  // icon + title) IS the title bar, so there is no native title to mismatch.
  dashWindow = new BrowserWindow({
    width: 760, height: 620, minWidth: 640, minHeight: 520,
    frame: false,
    title: `DeepSeek Harness - ${T.dashboard}`, resizable: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  dashWindow.loadFile(join(__dirname, 'ui', 'dashboard.html'), { query: { lang: IS_ZH ? 'zh' : 'en', theme: core.readThemePreference(DSH_HOME) || 'system' } });
  dashWindow.on('closed', () => { dashWindow = null; });
}

// --- dsh-notify:// deep link ---------------------------------
// Toast clicks carry `dsh-notify://open/<base64url(url)>`; the protocol is
// registered to this app so the click raises the desktop window instead of
// leaving for the browser (activate.ps1 hands off to us when we are running).
function registerProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
    log('protocol registered:', PROTOCOL);
  } catch (e) { log('protocol registration failed:', e.message); }
}
function decodeNotifyUrl(raw) {
  // dsh-notify://open/<base64url(url)>
  try {
    const m = /^dsh-notify:\/\/open\/([A-Za-z0-9_-]+)$/.exec(String(raw || ''));
    if (!m) return null;
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const url = Buffer.from(padded, 'base64').toString('utf8');
    return /^https?:\/\//i.test(url) ? url : null;
  } catch { return null; }
}
function handleNotifyUrl(raw) {
  const url = decodeNotifyUrl(raw);
  log('deep link:', raw, '->', url || '(ignored)');
  showMain();
  if (url && webContents()) {
    const wc = webContents();
    if (serverUrl && (url === serverUrl || url.startsWith(serverUrl + '/'))) return; // already showing it
    wc.loadURL(url);
  }
}

// --- app self-update (lightweight) ---------------------------
// The manifest URL is BAKED IN at release time by make-release.mjs
// (update-url.json, added to the asar), so end users never configure
// anything. An advanced override stays possible via settings.json:
// `"updateUrl": "https://.../dsh-update.json"`.
// Manifest shape: { "version": "x.y.z", "url": "https://.../Setup.exe",
// "sha512": "<base64>", "size": <bytes> }. sha512/size are written by
// make-release.mjs and verified on download in downloadUpdate().
let builtinUpdateUrl = '';
try { builtinUpdateUrl = JSON.parse(fs.readFileSync(join(__dirname, 'update-url.json'), 'utf8')).url || ''; } catch { }
let pendingInstallExe = null; // set when a downloaded update is cleared to install on quit
async function checkForUpdate(manual) {
  const manifestUrl = (typeof settings.updateUrl === 'string' && settings.updateUrl) ? settings.updateUrl : (builtinUpdateUrl || null);
  if (!manifestUrl) {
    if (manual) notifyService('DeepSeek Harness', T.updateUrlMissing, true);
    return;
  }
  updateState = { ...(updateState || {}), checking: true, error: null };
  broadcastStatus();
  const j = await curlJsonAsync(manifestUrl); // core.fetchJson: proxy/timeout/redirect, no curl.exe
  const m = core.parseUpdateManifest(j);
  const ver = m ? m.version : null;
  const url = m ? m.url : null;
  // core.fetchJson (and thus curlJsonAsync) resolves null on transport failure,
  // timeout, or non-2xx. That must NOT masquerade as "you are on the latest".
  const fetchFailed = j === null || j === undefined;
  updateState = {
    ...(updateState || {}), checking: false,
    available: !!(m && semverDesc(ver, app.getVersion()) < 0),
    version: ver, url: url,
    sha512: m ? m.sha512 : '', size: m ? m.size : 0,
    error: fetchFailed ? T.checkFailed : ((j && !m) ? 'invalid update manifest' : null),
  };
  broadcastStatus();
  if (m && semverDesc(ver, app.getVersion()) < 0) {
    // Manual check -> user asked, always report; background check -> quiet
    // while the user is watching (foreground suppression applies).
    notifyService('DeepSeek Harness', `${T.updateAvailable}${SEP.colon}${app.getVersion()} → ${ver}`, manual);
  } else if (manual) {
    if (fetchFailed || !m) notifyService('DeepSeek Harness', T.checkFailed, true);
    else notifyService('DeepSeek Harness', `${T.version} ${app.getVersion()}`, true);
  }
}
function downloadUpdate() {
  const u = updateState;
  if (!u || !u.url) return Promise.resolve({ ok: false, error: 'no update url' });
  const dir = join(app.getPath('downloads'), 'DSH');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { }
  let name = 'dsh-desktop-setup.exe';
  try { name = basename(new URL(u.url).pathname) || name; } catch { }
  const target = join(dir, name);
  updateState = { ...u, downloading: true, error: null };
  broadcastStatus();
  // Node streaming downloader replaces the old curl.exe spawn: honors proxy
  // env vars, follows redirects, and returns the real reason on non-2xx /
  // timeout / transport failure instead of a bare "download failed".
  return core.downloadTo(u.url, target, { timeoutMs: 900000, proxy: core.resolveProxy() }).then(async (r) => {
    if (!r.ok) {
      updateState = { ...updateState, downloading: false, error: r.error };
      broadcastStatus();
      return { ok: false, error: r.error };
    }
    // Integrity BEFORE we offer to install: refuse a corrupted / tampered
    // payload when the manifest carries size and/or sha512 (new manifest
    // fields produced by make-release.mjs). Delete the bad file so a stale
    // partial download can never be installed later.
    let integrityError = null;
    if (u.size > 0 && r.size !== u.size) {
      integrityError = `size mismatch (expected ${u.size}, got ${r.size})`;
    } else if (u.sha512) {
      const actual = await core.fileSha512(target);
      if (!actual) integrityError = 'could not compute sha512';
      else if (actual !== u.sha512) integrityError = 'sha512 mismatch';
    }
    if (integrityError) {
      try { fs.rmSync(target, { force: true }); } catch { }
      updateState = { ...updateState, downloading: false, error: integrityError };
      broadcastStatus();
      return { ok: false, error: integrityError };
    }
    updateState = { ...updateState, downloading: false, downloadedPath: target, error: null };
    broadcastStatus();
    notifyService('DeepSeek Harness', `${T.downloadReady}${SEP.colon}${target}`);
    shell.showItemInFolder(target);
    return { ok: true, path: target };
  });
}
function installUpdate() {
  const p = updateState && updateState.downloadedPath;
  if (!p || !fs.existsSync(p)) return false;
  // Never spawn the installer while this app still holds the exe lock. Mark a
  // pending install and QUIT: the existing wantQuit + single-instance-lock
  // quit path winds down the windows/server, then will-quit spawns the NSIS
  // installer with /S (silent wizard). No second app instance is created, no
  // zombie is left behind, and the update needs no manual clicks.
  log('update: scheduling silent install on quit:', p);
  pendingInstallExe = p;
  updateState = { ...(updateState || {}), error: null };
  broadcastStatus();
  wantQuit = true;
  app.quit();
  return true;
}

// --- diagnostics export --------------------------------------
function exportDiagnostics() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(app.getPath('temp'), 'dsh-diag-' + stamp);
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    const addFile = (src, dst) => { try { if (fs.existsSync(src)) { fs.copyFileSync(src, join(dir, dst)); files.push(dst); } } catch { } };
    addFile(join(app.getPath('userData'), 'logs', 'desktop.log'), 'desktop.log');
    addFile(join(app.getPath('userData'), 'logs', 'desktop.log.1'), 'desktop.log.1');
    addFile(join(DSH_HOME, 'dsh-preflight.log'), 'dsh-preflight.log');
    addFile(join(DSH_HOME, 'dsh-preflight-state.json'), 'dsh-preflight-state.json');
    try {
      const snaps = fs.readdirSync(join(DSH_HOME, 'plugin-snapshots')).sort().reverse();
      if (snaps[0]) addFile(join(DSH_HOME, 'plugin-snapshots', snaps[0], 'web', 'package.json'), 'snapshot-package.json');
    } catch { }
    const info = { appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, phase, serverUrl, dshVersion: currentDshVersion(), guard: lastGuard };
    fs.writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2));
    files.push('info.json');
    const outDir = join(app.getPath('downloads'), 'DSH');
    fs.mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `dsh-diagnostics-${stamp}.zip`);
    const ps = `Compress-Archive -Path '${files.map(f => join(dir, f)).join("','")}' -DestinationPath '${out}' -Force`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 60000 });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
    if (r.status === 0 && fs.existsSync(out)) {
      notifyService('DeepSeek Harness', `${T.diagExported}${SEP.colon}${out}`, true);
      shell.showItemInFolder(out);
      return { ok: true, path: out };
    }
    return { ok: false, error: r.stderr ? r.stderr.toString().slice(0, 200) : 'compress failed' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// --- launch at login -----------------------------------------
function getAutoLaunch() {
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
}
function setAutoLaunch(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on }); return true; } catch { return false; }
}

// --- IPC -----------------------------------------------------
// Only the local splash/dashboard/titlebar windows (file:// UI with the
// preload bridge) may call these handlers. The remote dsh web view has no
// preload and gets zero IPC access; this check is defense in depth.
function trustedSender(event) {
  const id = event.sender.id;
  return (splashWindow && !splashWindow.isDestroyed() && splashWindow.webContents.id === id) ||
    (dashWindow && !dashWindow.isDestroyed() && dashWindow.webContents.id === id) ||
    (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === id);
}
function statusPayload() {
  return { phase, url: serverUrl, error: lastError, guard: lastGuard, curated: curatedState, update: updateState, dshInstall: dshInstallProgress, autoLaunch: getAutoLaunch(), locale: IS_ZH ? 'zh' : 'en', appVersion: app.getVersion() };
}
function registerIpc() {
  ipcMain.handle('status:get', (e) => trustedSender(e) ? statusPayload() : null);
  ipcMain.handle('server:start', async (e) => {
    if (trustedSender(e) && (phase === 'stopped' || phase === 'error')) {
      // A missing runtime bin (failed first install) is reinstalled first, so
      // "start" never dead-ends on the "bin not found" error card.
      await startServerSafely();
    }
  });
  ipcMain.handle('server:restart', (e) => { if (trustedSender(e)) restartServer(); });
  ipcMain.handle('app:openBrowser', (e) => { if (trustedSender(e) && serverUrl) safeOpen(serverUrl); });
  ipcMain.handle('app:openLogs', (e) => { if (trustedSender(e)) { try { shell.openPath(join(app.getPath('userData'), 'logs')); } catch { } } });
  ipcMain.handle('app:copyUrl', (e) => { if (!trustedSender(e) || !serverUrl) return false; clipboard.writeText(serverUrl); return true; });
  ipcMain.handle('app:openDataDir', (e) => { if (!trustedSender(e)) return false; try { shell.openPath(DSH_HOME); return true; } catch { return false; } });
  ipcMain.handle('logs:tail', (e, n) => trustedSender(e) ? logTail(Number(n) || 20) : []);
  ipcMain.handle('dsh:current', (e) => trustedSender(e) ? currentDshVersion() : null);
  ipcMain.handle('dsh:latest', (e) => trustedSender(e) ? latestDshVersion() : null);
  ipcMain.handle('dsh:versions', (e) => trustedSender(e) ? listDshVersions() : null);
  ipcMain.handle('dsh:update', (e, ver) => {
    if (!trustedSender(e)) return null;
    // dsh ships ONLY prerelease tags (0.1.0-rc.x), so the gate must accept the
    // same semver shape updateDsh validates internally (shared core helper);
    // the stricter /^\d+\.\d+\.\d+$/ rejected every version the dashboard
    // could select, silently breaking update/rollback.
    if (!core.isValidDshVersion(ver)) return false;
    return updateDsh(ver);
  });
  ipcMain.handle('app:autoLaunch', (e, on) => {
    if (!trustedSender(e)) return null;
    if (on === undefined || on === null) return getAutoLaunch();
    return setAutoLaunch(on);
  });
  // npm mirror toggle: get current override ('' = official), set and persist.
  ipcMain.handle('npm:getRegistry', (e) => trustedSender(e) ? npmRegistryOverride() : null);
  ipcMain.handle('npm:setRegistry', (e, url) => {
    if (!trustedSender(e)) return null;
    const v = typeof url === 'string' ? url.trim() : '';
    settings.npmRegistry = v;
    saveSettings();
    return v;
  });
  ipcMain.handle('app:exportDiagnostics', (e) => trustedSender(e) ? exportDiagnostics() : null);
  ipcMain.handle('app:checkUpdate', (e) => { if (trustedSender(e)) return checkForUpdate(true); });
  ipcMain.handle('app:downloadUpdate', (e) => trustedSender(e) ? downloadUpdate() : null);
  ipcMain.handle('app:installUpdate', (e) => trustedSender(e) ? installUpdate() : null);
  // window controls for ANY frameless local window (main titlebar + dashboard
  // header): the target is the window that sent the IPC.
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
  app.on('second-instance', (_e, argv) => {
    log('second-instance argv:', JSON.stringify(argv));
    const url = (argv || []).find(a => a.startsWith(PROTOCOL + '://'));
    if (url) handleNotifyUrl(url);
    else showMain();
  });
  app.whenReady().then(async () => {
    ensureLog();
    loadSettings();
    // The profile dir must exist before anything spawns with it as cwd
    // (dsh itself scaffolds the profile contents on first boot).
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    registerProtocol();
    registerIpc();
    installFocusReporting();
    createTray();
    createSplash();
    createMainWindow();
    // Global hotkey (WeChat Ctrl+Alt+W / QQ Ctrl+Alt+Z style): summon or
    // hide the main window from anywhere. Registration can fail when another
    // app owns the chord - log and continue without it.
    try {
      const ok = globalShortcut.register('CommandOrControl+Alt+H', toggleMainFromGlobal);
      log('global hotkey Ctrl+Alt+H registered:', ok);
    } catch (e) { log('global hotkey registration failed:', e.message); }
    // First run (no dsh bin anywhere): install the managed runtime and WAIT -
    // the server cannot start without a bin. Later runs skip this instantly.
    // On failure the REAL reason (registry timeout / npm-cli missing / exit
    // code) stays on the error card - the spawnServer "bin not found" guard
    // only fires when no better error is on record - and splash "Retry"
    // re-runs this install via ensureRuntimeReady().
    if (!core.resolveDshBin(DSH_HOME)) {
      const ready = await ensureRuntimeReady();
      if (!ready) log('dsh runtime missing after install attempt; error card shown (Retry reinstalls)');
    }
    // Phase 1 of curated provisioning: the bootstrap (dshmarket) must be
    // installed BEFORE the server boots (it is a bundle layer). Skipped
    // instantly when already provisioned or already present.
    await ensureCuratedBootstrap();
    await startServer();
    // Phase 2: remaining curated plugins go through the market API, which
    // is now loaded with the server.
    installCuratedViaMarket();
    if (serverUrl && webContents()) {
      webContents().loadURL(serverUrl);
      if (splashWindow && !splashWindow.isDestroyed()) setTimeout(() => splashWindow.close(), 800);
    } else if (!SMOKE && !DEMO) {
      log('server unavailable; splash shows the error card');
    }
    // deep link arriving on first launch (second-instance covers later ones)
    const bootUrl = process.argv.find(a => a.startsWith(PROTOCOL + '://'));
    if (bootUrl) handleNotifyUrl(bootUrl);
    // background update check (silent; configured via settings.updateUrl)
    if (!SMOKE && !DEMO) checkForUpdate(false);
    // one-shot dsh runtime update notification
    if (!notifiedUpdate && !SMOKE && !DEMO) {
      const cur = currentDshVersion();
      const latest = await latestDshVersion();
      if (cur && latest && semverDesc(latest, cur) < 0) {
        notifiedUpdate = true;
        notifyService('DeepSeek Harness', `${T.updateAvailable}${SEP.colon}${cur} → ${latest}`);
      }
    }
    if (DEMO) {
      log('demo mode: auto-quit in 8s');
      setTimeout(() => { wantQuit = true; app.quit(); }, 8000);
    }
  });
  app.on('before-quit', () => { wantQuit = true; });
  app.on('will-quit', () => {
    stopServer();
    try { globalShortcut.unregisterAll(); } catch { }
    // Self-update: the quit has now wound down the windows/server, so our own
    // exe lock is about to be released. Spawn the NSIS installer SILENTLY
    // ("/S") detached+unref: it survives this process exit (no zombie) and the
    // installer's runAfterFinish (electron-builder default) relaunches the app
    // at the new version.
    if (pendingInstallExe) {
      const p = pendingInstallExe;
      pendingInstallExe = null;
      log('update: running silent installer (/S):', p);
      try {
        spawn(p, core.silentInstallArgs(), { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } catch (e) {
        log('update: silent installer spawn failed:', e && e.message);
      }
    }
  });
  app.on('window-all-closed', () => { /* tray-resident */ });
}
