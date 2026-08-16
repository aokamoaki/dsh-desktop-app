// Splash UI (local window only). Plain JS, bilingual via ?lang=.
(function () {
  const zh = new URLSearchParams(location.search).get('lang') === 'zh';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const U = zh ? {
    starting: '正在启动服务...', installing: '正在安装 dsh 运行时...', ready: '就绪 - 正在打开窗口...',
    failed: '启动失败', retry: '重试', browser: '浏览器打开', logs: '日志', showLogs: '查看日志',
    guardOk: '启动体检通过', guardAuto: '已自动禁用损坏插件', guardFixed: '自动修复',
    guardSkipped: '启动体检跳过', curInstall: '正在安装精选插件', curDone: '精选插件安装完成',
    error: '错误',
  } : {
    starting: 'Starting server...', installing: 'Installing dsh...', ready: 'Ready - opening window...',
    failed: 'Failed to start', retry: 'Retry', browser: 'Open in Browser', logs: 'Logs', showLogs: 'Show logs',
    guardOk: 'Startup check passed', guardAuto: 'Auto-disabled broken plugin', guardFixed: 'Auto-repaired',
    guardSkipped: 'Startup check skipped', curInstall: 'Installing curated plugins', curDone: 'Curated plugins installed',
    error: 'Error',
  };
  const el = (id) => document.getElementById(id);
  const phaseEl = el('phase');
  const errEl = el('err');
  const btns = el('btns');
  const spinner = el('spinner');
  const logbox = el('logbox');
  const logpre = el('logpre');
  const guardEl = el('guard');
  const curatedEl = el('curated');
  const curtext = el('curtext');
  const curfill = el('curfill');
  el('retry').textContent = U.retry;
  el('browser').textContent = U.browser;
  el('logs').textContent = U.logs;

  function renderGuard(g) {
    if (!g) return;
    const parts = [];
    if (g.skipped) parts.push(`<div class="warn"><span class="ic">◌</span><span>${U.guardSkipped}</span></div>`);
    if (g.repaired > 0) parts.push(`<div class="ok"><span class="ic">✓</span><span>${U.guardFixed} ${g.repaired}</span></div>`);
    const bad = g.broken && g.broken.length > 0;
    if (bad) {
      for (const b of (g.broken || []).slice(0, 3)) {
        parts.push(`<div class="bad"><span class="ic">!</span><span>${U.guardAuto}: <b>${escapeHtml(b.bundle)}</b></span></div>`);
      }
    } else if (!g.skipped && g.repaired === 0) {
      parts.push(`<div class="ok"><span class="ic">✓</span><span>${U.guardOk}</span></div>`);
    }
    if (parts.length > 0) { guardEl.innerHTML = parts.join(''); guardEl.classList.add('show'); }
  }
  /** Boot stage indicator: installing / guard / starting / running. */
  function renderSteps(s) {
    const steps = [el('step0'), el('step1'), el('step2'), el('step3')];
    const p = (s && s.phase) || 'stopped';
    const n = p === 'installing' ? 1 : p === 'starting' ? 2 : p === 'running' ? 4 : (s && s.guard) ? 2 : 0;
    steps.forEach((st, i) => { if (st) st.className = 'step' + (i < n ? ' on' : ''); });
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function renderCurated(c) {
    if (!c) return;
    if (c.active) {
      curatedEl.classList.add('show');
      const pct = c.total > 0 ? Math.round((c.index / c.total) * 100) : 0;
      curtext.textContent = `${U.curInstall}: ${c.current || ''} (${c.index + 1}/${c.total})`;
      curfill.style.width = pct + '%';
    } else if (c.total > 0) {
      curatedEl.classList.add('show');
      curtext.textContent = U.curDone;
      curfill.style.width = '100%';
    }
  }
  function render(s) {
    const p = (s && s.phase) || 'stopped';
    renderGuard(s && s.guard);
    renderCurated(s && s.curated);
    renderSteps(s);
    if (p === 'starting' || p === 'installing') {
      spinner.style.display = 'block';
      btns.classList.remove('show');
      errEl.classList.remove('show');
      phaseEl.textContent = p === 'installing' ? U.installing : U.starting;
      logbox.classList.remove('show');
    } else if (p === 'error') {
      spinner.style.display = 'none';
      btns.classList.add('show');
      errEl.classList.add('show');
      errEl.textContent = (s && s.error) ? `${U.error}: ${s.error}` : U.failed;
      phaseEl.textContent = U.failed;
    } else if (p === 'running') {
      phaseEl.textContent = U.ready;
      spinner.style.display = 'none';
    } else {
      phaseEl.textContent = p;
    }
  }
  function showLogs() {
    logbox.classList.toggle('show');
    if (logbox.classList.contains('show')) {
      window.dsh.getLogTail(30).then((lines) => { logpre.textContent = (lines || []).join('\n'); });
    }
  }
  window.dsh.getStatus().then(render);
  window.dsh.onStatus(render);
  el('retry').addEventListener('click', () => { errEl.classList.remove('show'); btns.classList.remove('show'); window.dsh.restart(); });
  el('browser').addEventListener('click', () => window.dsh.openBrowser());
  el('logs').addEventListener('click', showLogs);
})();
