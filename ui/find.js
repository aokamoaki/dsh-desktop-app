// In-page find bar (lightweight injected version, Ctrl+F).
// Self-contained: creates its own <style> and floating bar, uses the legacy
// window.find() API (highlight + direction + wrap). Idempotent: when the bar
// already exists it only refocuses the input. Removed on Esc / close button.
// '__LOCALE__' is substituted by main.js with 'zh' or 'en'.
(() => {
  const ZH = '__LOCALE__' === 'zh';
  const U = ZH
    ? { placeholder: '查找', prev: '上一个', next: '下一个', close: '关闭（Esc）', none: '未找到', endWrap: '已到末尾，从开头继续', topWrap: '已到开头，从末尾继续' }
    : { placeholder: 'Find', prev: 'Previous', next: 'Next', close: 'Close (Esc)', none: 'No results', endWrap: 'Reached end, continuing from top', topWrap: 'Reached top, continuing from end' };

  const existing = document.getElementById('dsh-find-bar');
  if (existing) {
    const input = existing.querySelector('input');
    if (input) { input.focus(); input.select(); }
    return;
  }

  const style = document.createElement('style');
  style.textContent = [
    '#dsh-find-bar{position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:4px;padding:6px 8px;border-radius:8px;background:#fff;color:#232a3a;box-shadow:0 4px 16px rgba(20,30,60,.18),0 0 0 1px rgba(20,30,60,.08);font:12px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}',
    '@media (prefers-color-scheme:dark){#dsh-find-bar{background:#2a2e37;color:#d6dbe7;box-shadow:0 4px 16px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.07)}}',
    '#dsh-find-bar input{width:160px;padding:3px 8px;border-radius:5px;border:1px solid rgba(20,30,60,.15);background:rgba(20,30,60,.06);color:inherit;font:inherit;outline:none}',
    '@media (prefers-color-scheme:dark){#dsh-find-bar input{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.08)}}',
    '#dsh-find-bar .dsh-find-btn,#dsh-find-bar .dsh-find-close{border:none;background:transparent;color:inherit;opacity:.8;width:24px;height:22px;border-radius:5px;cursor:default;font-size:13px;line-height:1}',
    '#dsh-find-bar .dsh-find-btn:hover,#dsh-find-bar .dsh-find-close:hover{background:rgba(20,30,60,.1);opacity:1}',
    '@media (prefers-color-scheme:dark){#dsh-find-bar .dsh-find-btn:hover,#dsh-find-bar .dsh-find-close:hover{background:rgba(255,255,255,.1)}}',
    '#dsh-find-bar .dsh-find-status{min-width:96px;text-align:right;color:#e5484d;font-size:11px;padding:0 2px;white-space:nowrap}',
  ].join('\n');
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'dsh-find-bar';
  bar.innerHTML =
    '<input type="text" spellcheck="false" autocomplete="off" placeholder="' + U.placeholder + '">' +
    '<button class="dsh-find-btn" title="' + U.prev + '">&#8593;</button>' +
    '<button class="dsh-find-btn" title="' + U.next + '">&#8595;</button>' +
    '<span class="dsh-find-status"></span>' +
    '<button class="dsh-find-close" title="' + U.close + '">&#215;</button>';
  document.body.appendChild(bar);

  const input = bar.querySelector('input');
  const status = bar.querySelector('.dsh-find-status');
  const buttons = bar.querySelectorAll('.dsh-find-btn');
  const closeBtn = bar.querySelector('.dsh-find-close');
  let lastQuery = '';

  const collapseTo = (end) => {
    try {
      const sel = window.getSelection();
      sel.collapse(document.body, end ? (document.body.childNodes.length || 0) : 0);
    } catch { }
  };
  const run = (backwards) => {
    const q = input.value;
    if (!q) { status.textContent = ''; return; }
    const fresh = q !== lastQuery;
    lastQuery = q;
    if (fresh) collapseTo(false); // a new query always starts from the top
    const found = window.find(q, false, backwards, false, false);
    if (found) { status.textContent = ''; return; }
    if (fresh) { status.textContent = U.none; return; }
    // no more matches in this direction: wrap around
    collapseTo(backwards);
    window.find(q, false, backwards, false, false);
    status.textContent = backwards ? U.topWrap : U.endWrap;
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  input.addEventListener('input', debounce(() => run(false), 180));
  input.addEventListener('keydown', (e) => {
    // keep the page's own hotkeys (palette etc.) from reacting while typing
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); run(e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  buttons[0].addEventListener('click', () => run(true));
  buttons[1].addEventListener('click', () => run(false));
  closeBtn.addEventListener('click', close);

  function close() {
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    if (style.parentNode) style.parentNode.removeChild(style);
  }

  input.focus();
})();
