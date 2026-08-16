// dsh-desktop-app UI polish - injected into the dsh web page after load.
// Fixes: double-clicking a menu trigger leaves the menu open (the Menu
// component toggles per click, so two clicks net back to open). A dblclick
// that ends with the menu open gets one more toggle click to close it.
(() => {
  if (window.__dshUiPolish) return;
  window.__dshUiPolish = true;
  document.addEventListener('dblclick', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('button[aria-haspopup="menu"]') : null;
    if (t && t.getAttribute('aria-expanded') === 'true') {
      setTimeout(() => { t.click(); }, 0);
    }
  }, true);
})();
