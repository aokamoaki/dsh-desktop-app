// Splash UI (local window only). Plain JS, bilingual via ?lang=.
(function () {
  const zh = new URLSearchParams(location.search).get('lang') === 'zh';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const U = zh ? {
    starting: '正在启动服务...', ready: '就绪 - 正在打开窗口...',
    failed: '启动失败', retry: '重试', browser: '浏览器打开', logs: '日志', showLogs: '查看日志',
    error: '错误',
  } : {
    starting: 'Starting server...', ready: 'Ready - opening window...',
    failed: 'Failed to start', retry: 'Retry', browser: 'Open in Browser', logs: 'Logs', showLogs: 'Show logs',
    error: 'Error',
  };
  const el = (id) => document.getElementById(id);
  const phaseEl = el('phase');
  const errEl = el('err');
  const btns = el('btns');
  const spinner = el('spinner');
  const logbox = el('logbox');
  const logpre = el('logpre');
  el('retry').textContent = U.retry;
  el('browser').textContent = U.browser;
  el('logs').textContent = U.logs;

  function render(s) {
    const p = (s && s.phase) || 'stopped';
    if (p === 'starting') {
      spinner.style.display = 'block';
      btns.classList.remove('show');
      errEl.classList.remove('show');
      phaseEl.textContent = U.starting;
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