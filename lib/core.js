// dsh-desktop-app core logic (CommonJS, Electron-free).
//
// Everything in this module is pure Node (fs / child_process / os / path):
// no `electron` import, no `process.resourcesPath` access, no Browser or Tray
// APIs. This keeps the functions unit-testable with plain `node --test` and
// makes main.js a thin Electron shell.
//
// The lightweight shell REUSES an already-installed dsh (it never installs or
// updates one), so this module owns only resolution and one ready-line parser.

const { spawnSync } = require('node:child_process');
const { homedir } = require('node:os');
const { join, dirname } = require('node:path');
const fs = require('node:fs');

// Path of the @deepseek-ai/dsh CLI entry, relative to a package root.
const DSH_BIN_REL = join('@deepseek-ai', 'dsh', 'lib', 'bin.js');

/**
 * Resolve the node executable used to run the dsh CLI: env override first,
 * then a `node` on PATH, then the Electron runtime itself (ELECTRON_RUN_AS_NODE).
 */
function resolveNode() {
  if (process.env.DSH_DESKTOP_NODE && fs.existsSync(process.env.DSH_DESKTOP_NODE)) {
    return { exe: process.env.DSH_DESKTOP_NODE, electronAsNode: false };
  }
  try {
    const r = spawnSync('node', ['--version'], { windowsHide: true, stdio: 'ignore' });
    if (r.status === 0) return { exe: 'node', electronAsNode: false };
  } catch { }
  return { exe: process.execPath, electronAsNode: true };
}

/**
 * Resolve a dsh bin.js bundled inside `home` (legacy managed runtime or the
 * current profile). These two home-relative installs win over every machine-
 * wide location so a dedicated `~/.dsh` copy is always preferred.
 * @param home - the DSH home directory.
 * @returns the bin.js path, or null.
 */
function resolveHomeDshBin(home) {
  const candidates = [
    join(home, 'desktop-runtime', 'node_modules', DSH_BIN_REL),
    join(home, 'profiles', 'web', 'node_modules', DSH_BIN_REL),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { }
  }
  return null;
}

/**
 * Resolve a dsh bin.js left behind by `npx @deepseek-ai/dsh` (the npx cache).
 * The cache lives under the local app-data dir; honour an explicit
 * LOCALAPPDATA override (used by tests and by redirected profiles).
 * @returns the newest matching bin.js, or null.
 */
function resolveNpxDshBin() {
  try {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const npxRoot = join(base, 'npm-cache', '_npx');
    if (!fs.existsSync(npxRoot)) return null;
    const dirs = fs.readdirSync(npxRoot, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => join(npxRoot, d.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const dir of dirs) {
      const p = join(dir, 'node_modules', DSH_BIN_REL);
      if (fs.existsSync(p)) return p;
    }
  } catch { }
  return null;
}

/**
 * Resolve a dsh bin.js from a GLOBAL npm install (`npm install -g
 * @deepseek-ai/dsh`). Candidate scan first (fast, covers the default Windows
 * prefix and a node-install-dir install), then an authoritative `npm root -g`
 * lookup as the final net for custom prefixes.
 * @returns the bin.js path, or null.
 */
function resolveGlobalDshBin() {
  const candidates = [];
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', DSH_BIN_REL));
  if (process.env.npm_config_prefix) candidates.push(join(process.env.npm_config_prefix, 'node_modules', DSH_BIN_REL));
  try {
    const nodeDir = dirname(process.execPath);
    if (nodeDir) candidates.push(join(nodeDir, 'node_modules', DSH_BIN_REL));
  } catch { }
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch { }
  }
  // Authoritative: ask npm for its real global root (best-effort; a missing or
  // un-runnable npm just skips this branch).
  try {
    const r = spawnSync('npm', ['root', '-g'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
      const root = String(r.stdout).trim();
      if (root) {
        const p = join(root, 'node_modules', DSH_BIN_REL);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { }
  return null;
}

/**
 * Resolve a dsh bin.js from a `dsh` shim on PATH (e.g. `dsh.cmd`). Maps the
 * shim's directory back to its sibling package so the shell can still run the
 * bin.js with node (no shell-spawning of the shim). Handles both the npm-global
 * shim layout (`<prefix>/dsh.cmd`) and the npm/npx `.bin` layout
 * (`<root>/node_modules/.bin/dsh.cmd`).
 * @returns the bin.js path, or null.
 */
function resolvePathDshBin() {
  try {
    const r = spawnSync('where', ['dsh'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return null;
    for (const line of String(r.stdout).split(/\r?\n/)) {
      const shim = line.trim();
      if (!shim || !fs.existsSync(shim)) continue;
      const d = dirname(shim);
      const patterns = [
        join(d, 'node_modules', DSH_BIN_REL),      // npm global: <prefix>/dsh.cmd
        join(d, '..', DSH_BIN_REL),                // pnpm/npx .bin: <root>/node_modules/.bin/
        join(d, '..', '..', 'node_modules', '..', DSH_BIN_REL), // defensive
      ];
      for (const p of patterns) {
        try { if (fs.existsSync(p)) return p; } catch { }
      }
    }
  } catch { }
  return null;
}

/**
 * Resolve the @deepseek-ai/dsh CLI bin for an already-installed dsh, in order:
 * legacy managed desktop-runtime, the profile node_modules, the npx cache, a
 * global `npm install -g`, and finally a `dsh` shim on PATH.
 * @param home - the DSH home directory.
 * @returns the bin.js path, or null when no dsh is installed.
 */
function resolveDshBin(home) {
  return resolveHomeDshBin(home) || resolveNpxDshBin() || resolveGlobalDshBin() || resolvePathDshBin();
}

/**
 * Whether the installed dsh web app understands the `--no-open` flag.
 * Newer runtimes open the default browser on `dsh web` unless `--no-open` is
 * passed; older runtimes reject unknown options. Probe the resolved bin's
 * sibling `dsh-web-app` package for the flag instead of guessing by version,
 * so the flag is only passed when safe.
 * @param home - the DSH home directory.
 * @returns true when the resolved web app supports `--no-open`.
 */
function webAppSupportsNoOpen(home) {
  try {
    const bin = resolveDshBin(home);
    if (!bin) return false;
    const startUp = join(bin, '..', '..', '..', '..', '@deepseek-ai', 'dsh-web-app', 'lib', 'startup.js');
    return fs.existsSync(startUp) && /--no-open/.test(fs.readFileSync(startUp, 'utf8'));
  } catch { return false; }
}

/** Kill a process tree by pid (Windows taskkill /T /F). Never throws. */
function taskkillTree(pid) {
  try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
  catch { /* best effort */ }
}

/**
 * Extract the authenticated ready URL from dsh CLI stdout.
 *
 * dsh 0.1.2+ prints the authenticated URL (carrying a launch `?token=...`
 * query) as its ready line, optionally followed by a LAN URL:
 *   dsh web: http://127.0.0.1:3080/?token=<base64url>
 *   dsh web: http://127.0.0.1:3080/?token=<base64url> (LAN: http://192.168.1.5:3080/?token=...)
 * The token mints the browser-session cookie; loading a bare URL without it
 * would be rejected (401), so the FULL first URL after the prefix is returned
 * (never a bare origin). The "opening the default browser" notice line has no
 * URL and is ignored.
 * @param text - one line of dsh stdout.
 * @param prefix - the ready-line prefix, e.g. "dsh web: ".
 * @returns the full authenticated URL string, or null when not found.
 */
function parseDshWebUrl(text, prefix) {
  const s = typeof text === 'string' ? text : String(text || '');
  const p = typeof prefix === 'string' ? prefix : 'dsh web: ';
  const idx = s.indexOf(p);
  if (idx < 0) return null;
  const m = /https?:\/\/[^\s"'<>]+/.exec(s.slice(idx + p.length));
  if (!m) return null;
  // The token is base64url ([A-Za-z0-9_-]) and never ends in punctuation, so a
  // trailing strip only removes a stray closing delimiter, never token bytes.
  const url = m[0].replace(/[),.;]+$/, '');
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Read the web UI's explicit locale preference from the host user-settings
 * document (~/.dsh/settings.yaml, namespace `locale`, field `preference`).
 * The desktop shell follows the web app's language so the tray, context menus
 * and notifications stay in the SAME language as the main program. Absence of
 * the file or the field returns null and the caller falls back to the system
 * locale. A minimal line scan is sufficient (no YAML dependency).
 * @param home - the DSH home directory.
 * @returns 'zh' | 'en' | null (unknown/missing preference -> null).
 */
function readLocalePreference(home) {
  try {
    const text = fs.readFileSync(join(home, 'settings.yaml'), 'utf8');
    const lines = text.split(/\r?\n/);
    let inLocale = false;
    for (const line of lines) {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) continue;
      if (!inLocale) {
        if (t === 'locale:' || t === 'locale') inLocale = true;
        continue;
      }
      if (/^preference:\s*/.test(t)) {
        const v = t.replace(/^preference:\s*/, '').replace(/^["']|["']$/g, '').trim();
        return (v === 'zh' || v === 'en') ? v : null;
      }
      if (/^\S/.test(t)) return null;
    }
  } catch { /* unreadable settings -> system locale fallback */ }
  return null;
}

module.exports = {
  resolveNode,
  resolveHomeDshBin,
  resolveNpxDshBin,
  resolveGlobalDshBin,
  resolvePathDshBin,
  resolveDshBin,
  webAppSupportsNoOpen,
  taskkillTree,
  parseDshWebUrl,
  readLocalePreference,
};