// Dashboard UI: status + guard report + versions + app updates + logs.
// Plain JS, bilingual via ?lang= (set by the main process from the web app's
// locale preference so the dashboard speaks the same language as the main UI).
(function () {
  const params = new URLSearchParams(location.search);
  const zh = params.get('lang') === 'zh';
  // Theme follows the MAIN UI: ?theme=light|dark|system is passed by the main
  // process from ~/.dsh/settings.yaml ui-theme.preference; 'system' (default)
  // follows the OS and live-updates on change.
  const themePref = params.get('theme') || 'system';
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const dark = themePref === 'dark' ? true : themePref === 'light' ? false : mq.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // brand logo: black whale on light surfaces, white whale on dark (same
    // pairing the tray icon and the main UI logo use)
    const icon = document.getElementById('badgeIcon');
    if (icon) icon.src = dark ? '../assets/icon-white.png' : '../assets/icon.png';
  }
  applyTheme();
  if (themePref === 'system' && mq.addEventListener) mq.addEventListener('change', applyTheme);
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const U = zh ? {
    dashboard: '仪表盘', service: '服务', status: '状态', addr: '地址', restart: '重启服务', start: '启动服务', browser: '浏览器打开',
    logs: '日志目录', autoLaunch: '登录时启动', diag: '导出诊断', guard: '启动体检', dshVer: 'dsh 版本',
    cur: '当前', latest: '最新', update: '更新 / 回滚', rollback: '回滚目标', appVer: '桌面应用', version: '版本', checkUpdate: '检查更新',
    dlInstall: '下载并安装', logsT: '日志', refresh: '刷新', installing: '正在安装', done: '完成', failed: '失败（见日志）', fetching: '正在下载',
    guardOk: '✓ 启动体检通过', guardAuto: '已自动禁用损坏插件', guardFixed: '自动修复', guardRolled: '已回滚配置',
    guardSkipped: '启动体检跳过', guardNone: '尚无体检记录', updateCheck: '正在检查更新...', updateNone: '已是最新版本',
    updateAvail: '发现新版本', downloading: '正在下载...', ready: '安装包已就绪', installStarted: '安装程序已启动',
    copyUrl: '复制地址', urlCopied: '已复制 ✓', dataDir: '数据目录',
    error: '错误',
  } : {
    dashboard: 'Dashboard', service: 'Service', status: 'Status', addr: 'Address', restart: 'Restart', start: 'Start Server', browser: 'Open in Browser',
    logs: 'Logs Folder', autoLaunch: 'Launch at login', diag: 'Export Diagnostics', guard: 'Startup Guard', dshVer: 'dsh Version',
    cur: 'Current', latest: 'Latest', update: 'Update / Rollback', rollback: 'Rollback target', appVer: 'Desktop App', version: 'Version', checkUpdate: 'Check for Updates',
    dlInstall: 'Download & Install', logsT: 'Logs', refresh: 'Refresh', installing: 'Installing', done: 'Done', failed: 'Failed (see logs)', fetching: 'Fetching',
    guardOk: '✓ Startup check passed', guardAuto: 'Auto-disabled broken plugin', guardFixed: 'Auto-repaired', guardRolled: 'Config rolled back',
    guardSkipped: 'Startup check skipped', guardNone: 'No check recorded yet', updateCheck: 'Checking for updates...', updateNone: 'You are up to date',
    updateAvail: 'Update available', downloading: 'Downloading...', ready: 'Installer ready', installStarted: 'Installer launched',
    copyUrl: 'Copy URL', urlCopied: 'Copied ✓', dataDir: 'Data Folder',
    error: 'Error',
  };
  // Static labels AND interactive controls share one table, so no control can
  // drift back to English in a zh session.
  // The WINDOW title follows the same language: Electron shows the page's
  // <title> (which overrides the BrowserWindow title set by the main process),
  // so the hardcoded English <title> must be replaced here.
  document.title = 'DeepSeek Harness - ' + U.dashboard;
  for (const [id, key] of Object.entries({
    dashTitle: 'dashboard', hService: 'service', lStatus: 'status', lAddr: 'addr', hGuard: 'guard',
    hDshVer: 'dshVer', lCur: 'cur', lLatest: 'latest', hAppVer: 'appVer', lAppVer: 'version',
    restart: 'restart', browser: 'browser', logs: 'logs', diag: 'diag', lAutoLaunch: 'autoLaunch',
    update: 'update', chkUpdate: 'checkUpdate', dlUpdate: 'dlInstall', refresh: 'refresh',
    copyUrl: 'copyUrl', dataDir: 'dataDir',
  })) {
    const el = document.getElementById(id);
    if (el) el.textContent = U[key];
  }
  const logsTitle = document.getElementById('logsTitle');
  if (logsTitle) logsTitle.textContent = U.logsT;
  const versionsSel = document.getElementById('versions');
  if (versionsSel) versionsSel.title = U.rollback;
  const $ = (id) => document.getElementById(id);
  const guardbox = $('guardbox');
  const umsg = $('umsg');

  function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const phaseNames = zh ? { stopped: '已停止', starting: '启动中', installing: '安装中', running: '运行中', error: '错误' } : { stopped: 'Stopped', starting: 'Starting', installing: 'Installing', running: 'Running', error: 'Error' };

  function renderStatus(s) {
    const p = (s && s.phase) || 'stopped';
    const name = phaseNames[p] || p;
    $('phase').textContent = name; // pill and detail row both localized
    const pd = $('phaseDetail');
    if (pd) pd.textContent = name;
    const pill = $('phasePill');
    if (pill) pill.className = 'pill' + (p === 'running' ? ' running' : p === 'error' ? ' error' : (p === 'starting' || p === 'installing') ? ' starting' : '');
    $('url').textContent = (s && s.url) || '-';
    $('appver').textContent = (s && s.appVersion) || '-';
    if (s && typeof s.autoLaunch === 'boolean') $('autoLaunch').checked = s.autoLaunch;
    renderRestartBtn(s);
    renderGuard(s && s.guard);
    renderUpdate(s && s.update);
    renderDshInstall(s && s.dshInstall);
  }

  // dsh update/rollback progress bar: indeterminate shimmer while packages
  // are fetched, determinate width once reify starts, full on success.
  function renderDshInstall(p) {
    const wrap = $('dshProg');
    if (!wrap) return;
    if (!p || !p.version) { wrap.style.display = 'none'; return; }
    const bar = $('dshProgBar');
    const txt = $('dshProgTxt');
    wrap.style.display = 'block';
    const phase = p.phase || 'fetch';
    if (phase === 'done') {
      wrap.classList.remove('indet');
      bar.style.width = '100%';
      txt.textContent = U.done + ' ' + p.version;
    } else if (phase === 'error') {
      wrap.classList.remove('indet');
      bar.style.width = '0%';
      txt.textContent = U.failed;
    } else if (phase === 'reify') {
      wrap.classList.remove('indet');
      bar.style.width = '85%';
      txt.textContent = `${U.installing} ${p.version} ...`;
    } else {
      wrap.classList.add('indet');
      txt.textContent = `${U.fetching} ${p.version} ... (${p.fetched || 0})`;
    }
  }

  // The restart control doubles as a start button while the service is down,
  // mirroring the tray menu's running/stopped switch.
  function renderRestartBtn(s) {
    const btn = $('restart');
    const p = (s && s.phase) || 'stopped';
    btn.textContent = p === 'running' ? U.restart : U.start;
  }

  function renderGuard(g) {
    if (!g) { guardbox.innerHTML = `<div class="guardline" style="color:var(--muted)">${U.guardNone}</div>`; return; }
    const lines = [];
    if (g.skipped) lines.push(`<div class="guardline warn"><span class="ic">◌</span><span>${U.guardSkipped}</span></div>`);
    if (g.repaired > 0) lines.push(`<div class="guardline ok"><span class="ic">✓</span><span>${U.guardFixed}: ${g.repaired}</span></div>`);
    if (g.rolledBack > 0) lines.push(`<div class="guardline warn"><span class="ic">↺</span><span>${U.guardRolled}: ${g.rolledBack}</span></div>`);
    if (g.autoDisabled > 0) lines.push(`<div class="guardline warn"><span class="ic">!</span><span>${U.guardAuto}: ${g.autoDisabled}</span></div>`);
    for (const b of (g.broken || []).slice(0, 4)) {
      lines.push(`<div class="guardline bad"><span class="ic">!</span><span>${esc(b.bundle)}: ${esc(b.reason)}</span></div>`);
    }
    if (lines.length === 0 && !g.skipped) lines.push(`<div class="guardline ok"><span class="ic">✓</span><span>${U.guardOk}</span></div>`);
    if (g.at) lines.push(`<div class="guardline" style="color:var(--muted);font-size:11px">${new Date(g.at).toLocaleString()}</div>`);
    guardbox.innerHTML = lines.join('');
  }

  function renderUpdate(u) {
    const dl = $('dlUpdate');
    if (!u) { dl.style.display = 'none'; return; }
    if (u.checking) { umsg.textContent = U.updateCheck; umsg.className = 'msg'; dl.style.display = 'none'; }
    else if (u.available) { umsg.textContent = `${U.updateAvail}: ${u.version}`; umsg.className = 'msg ok'; dl.style.display = 'inline-block'; }
    else if (u.downloading) { umsg.textContent = U.downloading; umsg.className = 'msg'; dl.style.display = 'none'; }
    else if (u.downloadedPath) { umsg.textContent = `${U.ready}: ${u.version}`; umsg.className = 'msg ok'; dl.style.display = 'inline-block'; }
    else { umsg.textContent = u.version ? `${U.updateNone} (${u.version})` : ''; umsg.className = 'msg'; dl.style.display = 'none'; }
    if (u.error) { umsg.textContent = `${U.error}: ${u.error}`; umsg.className = 'msg err'; }
  }

  function refreshVersions(keepSelection) {
    const sel = $('versions');
    const chosen = keepSelection ? sel.value : null;
    Promise.all([window.dsh.getCurrentVersion(), window.dsh.getLatestVersion(), window.dsh.getVersions()])
      .then(([cur, latest, versions]) => {
        $('cur').textContent = cur || '-';
        $('latest').textContent = latest || '-';
        sel.innerHTML = '';
        const list = (versions && versions.length) ? versions : (cur ? [cur] : []);
        for (const v of list) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          sel.appendChild(opt);
        }
        if (chosen && list.includes(chosen)) sel.value = chosen;
      })
      .catch(() => { });
  }

  function showMsg(text, ok) {
    const m = $('msg');
    m.textContent = text;
    m.className = 'msg ' + (ok ? 'ok' : 'err');
  }
  function refreshLogs() {
    window.dsh.getLogTail(100).then((lines) => { $('logpre').textContent = (lines || []).join('\n'); });
  }

  window.dsh.getStatus().then((s) => { renderStatus(s); refreshVersions(false); refreshLogs(); });
  window.dsh.onStatus(renderStatus);

  // Frameless window controls (the page header is the title bar).
  const W = zh ? { minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭' } : { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' };
  const winMin = $('winMin'), winMax = $('winMax'), winClose = $('winClose');
  // NOTE: title and aria-label must be assigned separately - chained assignment
  // to a getAttribute() call result is a runtime ReferenceError that would
  // abort the whole IIFE and kill every binding below.
  if (winMin) { winMin.title = W.minimize; winMin.setAttribute('aria-label', W.minimize); }
  if (winClose) { winClose.title = W.close; winClose.setAttribute('aria-label', W.close); }
  function renderMax(m) {
    if (!winMax) return;
    document.getElementById('maxIcon').innerHTML = m
      ? '<rect x="3.2" y="3.2" width="6.6" height="6.6" rx="1"/><line x1="2.2" y1="6.8" x2="2.2" y2="9.8"/><line x1="2.2" y1="9.8" x2="5.2" y2="9.8"/>'
      : '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/>';
    winMax.title = m ? W.restore : W.maximize;
    winMax.setAttribute('aria-label', m ? W.restore : W.maximize);
  }
  if (winMin) winMin.addEventListener('click', () => window.dsh.minimize());
  if (winClose) winClose.addEventListener('click', () => window.dsh.close());
  if (winMax) {
    winMax.title = W.maximize;
    winMax.setAttribute('aria-label', W.maximize);
    winMax.addEventListener('click', () => window.dsh.maximize().then(renderMax));
    window.dsh.isMaximized().then(renderMax);
  }
  // Double-click the header (not on a control) toggles maximize, like the
  // main window title bar.
  document.querySelector('header').addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest && e.target.closest('button, .pill, .winctls')) return;
    window.dsh.maximize().then(renderMax);
  });

  $('restart').addEventListener('click', () => {
    // Start when the service is down, restart while it is running.
    window.dsh.getStatus().then((s) => {
      if ((s && s.phase) === 'running') window.dsh.restart();
      else window.dsh.start();
    });
  });
  $('browser').addEventListener('click', () => window.dsh.openBrowser());
  $('logs').addEventListener('click', () => window.dsh.openLogs());
  $('dataDir').addEventListener('click', () => window.dsh.openDataDir());
  $('copyUrl').addEventListener('click', () => {
    window.dsh.copyUrl().then((ok) => {
      const btn = $('copyUrl');
      if (btn && ok) { btn.textContent = U.urlCopied; setTimeout(() => { btn.textContent = U.copyUrl; }, 1500); }
    });
  });
  $('refresh').addEventListener('click', () => { refreshLogs(); refreshVersions(true); });
  $('autoLaunch').addEventListener('change', (e) => { window.dsh.setAutoLaunch(e.target.checked); });
  $('diag').addEventListener('click', () => {
    window.dsh.exportDiagnostics().then((r) => { if (r && r.ok) showMsg(r.path, true); else showMsg((r && r.error) || U.failed, false); });
  });
  $('update').addEventListener('click', () => {
    const target = $('versions').value;
    if (!target) return;
    $('update').disabled = true;
    showMsg(`${U.installing} ${target} ...`, true);
    // Show the progress bar immediately; live updates arrive via onStatus.
    renderDshInstall({ phase: 'fetch', fetched: 0, version: target });
    window.dsh.updateDsh(target).then((ok) => {
      showMsg(ok ? `${U.done}. ${target}` : U.failed, ok);
      setTimeout(() => refreshVersions(true), 500);
    }).catch(() => { showMsg(U.failed, false); })
      .finally(() => { $('update').disabled = false; });
  });
  $('chkUpdate').addEventListener('click', () => { window.dsh.checkUpdate(); });
  $('dlUpdate').addEventListener('click', () => {
    // Immediate feedback: disable + label change so the click never feels dead,
    // even before the async status stream arrives (or if the download fails fast).
    const btn = $('dlUpdate');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = U.downloading;
    umsg.textContent = U.downloading;
    umsg.className = 'msg';
    window.dsh.downloadUpdate().then((r) => {
      if (r && r.ok) { umsg.textContent = U.ready; umsg.className = 'msg ok'; window.dsh.installUpdate(); setTimeout(() => { umsg.textContent = U.installStarted; }, 600); }
      else { umsg.textContent = (r && r.error) || U.failed; umsg.className = 'msg err'; }
    }).catch((e) => { umsg.textContent = (e && e.message) || U.failed; umsg.className = 'msg err'; })
      .finally(() => { btn.disabled = false; btn.textContent = orig; });
  });
})();
