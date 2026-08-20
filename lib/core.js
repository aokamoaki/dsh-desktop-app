// dsh-desktop-app core logic (CommonJS, Electron-free).
//
// Everything in this module is pure Node (fs / child_process / http / os /
// path): no `electron` import, no `process.resourcesPath` access, no Browser
// or Tray APIs. Electron values that these functions need are passed in as
// parameters (resourcesPath, home, marker text, URL prefix). This makes the
// functions unit-testable with plain `node --test` and keeps main.js a thin
// Electron shell.

const { spawnSync } = require('node:child_process');
const { homedir } = require('node:os');
const { join, dirname } = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

/** Parse a semver string with an optional prerelease suffix (e.g. 0.1.0-rc.6). */
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : null };
}

/**
 * Descending semver comparison (x.y.z with optional prerelease, e.g. -rc.6).
 * Missing numeric parts read as 0. Semver precedence: a stable release is
 * newer than any prerelease of the same x.y.z; prereleases compare
 * identifier-by-identifier (numeric identifiers numerically).
 * @returns positive when b is newer, negative when a is newer, 0 when equal.
 */
function semverDesc(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0; // malformed -> treat as equal (never breaks sorting)
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pb[k] - pa[k];
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return -1; // a is stable, b is prerelease -> a newer
  if (!pb.pre) return 1;  // b is stable, a is prerelease -> b newer
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return 1;  // a shorter prerelease -> a older ("-alpha" < "-alpha.1")
    if (y === undefined) return -1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(y) - Number(x);
    if (xn) return 1;  // numeric identifiers have lower precedence than alphanumeric
    if (yn) return -1;
    return y.localeCompare(x);
  }
  return 0;
}

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
 * Resolve the npm CLI to drive: env override -> bundled copy under
 * resourcesPath/npm -> system npm.cmd sibling -> global npm package.
 * @param resourcesPath - Electron's process.resourcesPath ('' outside Electron).
 */
function resolveNpmCli(resourcesPath) {
  if (process.env.DSH_DESKTOP_NPM && fs.existsSync(process.env.DSH_DESKTOP_NPM)) return process.env.DSH_DESKTOP_NPM;
  const bundled = join(resourcesPath || '', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(bundled)) return bundled;
  // where npm.cmd -> sibling <nodejs>/node_modules/npm/bin/npm-cli.js
  try {
    const where = spawnSync('where.exe', ['npm.cmd'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const first = where.stdout.toString().trim().split('\n')[0];
    if (first) {
      const p = join(dirname(first), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (fs.existsSync(p)) return p;
    }
  } catch { }
  // last resort: npm package installed as a global package
  try {
    const root = spawnSync('cmd.exe', ['/c', 'npm root -g'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const g = root.stdout.toString().trim();
    if (g) { const p = join(g, 'npm', 'bin', 'npm-cli.js'); if (fs.existsSync(p)) return p; }
  } catch { }
  return null;
}

/**
 * Resolve the @deepseek-ai/dsh CLI bin: managed desktop runtime ->
 * profile node_modules -> newest npx cache entry.
 * @param home - the DSH home directory.
 */
function resolveDshBin(home) {
  const RUNTIME_DIR = join(home, 'desktop-runtime');
  const PROFILE_DIR = join(home, 'profiles', 'web');
  const runtimeBin = () => join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const rt = runtimeBin();
  if (fs.existsSync(rt)) return rt;
  const local = join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(local)) return local;
  try {
    const npxRoot = join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
    if (fs.existsSync(npxRoot)) {
      const dirs = fs.readdirSync(npxRoot, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => join(npxRoot, d.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      for (const dir of dirs) {
        const p = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { }
  return null;
}

/**
 * Whether the installed dsh web app understands the `--no-open` flag.
 * Newer runtimes open the default browser on `dsh web` unless `--no-open` is
 * passed; older runtimes (pre-rc.7) reject unknown options and would exit on
 * it. Probe the resolved bin's sibling `dsh-web-app` package for the flag
 * instead of guessing by version, so the flag is only passed when safe.
 * @param home - the DSH home directory.
 * @returns true when the resolved web app supports `--no-open`.
 */
function webAppSupportsNoOpen(home) {
  try {
    const bin = resolveDshBin(home);
    if (!bin) return false;
    // bin: <root>/node_modules/@deepseek-ai/dsh/lib/bin.js
    const root = join(bin, '..', '..', '..', '..');
    const startup = join(root, '@deepseek-ai', 'dsh-web-app', 'lib', 'startup.js');
    return fs.existsSync(startup) && /--no-open/.test(fs.readFileSync(startup, 'utf8'));
  } catch { return false; }
}

/**
 * HTTP probe: fetch the URL and report whether the body contains the marker.
 * Resolves false on any transport error or timeout - never throws.
 */
function probe(url, timeoutMs = 2500, marker = '') {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').includes(marker)));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** Kill a process tree by pid (Windows taskkill /T /F). Never throws. */
function taskkillTree(pid) {
  try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
  catch { /* best effort */ }
}

/**
 * Extract the ready URL from dsh CLI stdout: `dsh web: http://127.0.0.1:<port>`.
 * @returns the full URL string, or null when not found.
 */
function parseDshWebUrl(text, prefix) {
  const idx = text.indexOf(prefix);
  if (idx < 0) return null;
  const m = text.slice(idx + prefix.length).match(/^\d+/);
  return m ? `http://127.0.0.1:${m[0]}` : null;
}

/** Parse one /api/events.host frame into its payload (never throws). */
function hostEventPayload(raw) {
  try {
    const frame = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    return frame && typeof frame === 'object' ? frame.payload : undefined;
  } catch { return undefined; }
}

/**
 * Map a path inside app.asar to its unpacked sibling, so files executed by
 * EXTERNAL processes (node child, powershell) resolve outside the archive.
 * Paths that are not under app.asar (dev mode, plain node) pass through.
 * Accepts both separators so the mapping is stable regardless of the host
 * separator (Windows '\' at runtime, '/' in cross-platform CI).
 * @param p - the asar-virtual path (e.g. C:\\...\\resources\\app.asar\\notifier\\notify.ps1).
 * @param resourcesPath - Electron's process.resourcesPath ('' outside Electron).
 * @returns the external path the child process can read.
 */
function externalPath(p, resourcesPath) {
  const back = p.indexOf('app.asar\\');
  const fwd = p.indexOf('app.asar/');
  let idx = -1;
  if (back !== -1 && fwd !== -1) idx = Math.min(back, fwd);
  else if (back !== -1) idx = back;
  else idx = fwd;
  if (idx === -1 || !resourcesPath) return p;
  const markerLen = 'app.asar'.length + 1; // include the single separator
  return join(resourcesPath, 'app.asar.unpacked', p.slice(idx + markerLen));
}

/**
 * Read the web UI's explicit locale preference from the host user-settings
 * document (~/.dsh/settings.yaml, namespace `locale`, field `preference`).
 * The desktop shell follows the web app's language so the tray, dashboard,
 * context menus and notifications stay in the SAME language as the main
 * program. Absence of the file or the field returns null and the caller
 * falls back to the system locale (the web side does the same).
 *
 * The settings document is small, written by the dsh host with simple
 * indentation, and the locale block looks like:
 *   locale:
 *     preference: zh
 * A minimal line scan is sufficient (no YAML dependency).
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
        // The block header is the bare namespace at column 0.
        if (t === 'locale:' || t === 'locale') inLocale = true;
        continue;
      }
      if (/^preference:\s*/.test(t)) {
        const v = t.replace(/^preference:\s*/, '').replace(/^["']|["']$/g, '').trim();
        return (v === 'zh' || v === 'en') ? v : null;
      }
      // A non-indented line (next top-level namespace) ends the locale block.
      if (/^\S/.test(t)) return null;
    }
  } catch { /* unreadable settings -> system locale fallback */ }
  return null;
}

/**
 * Generic reader for one field of one namespace in the host user-settings
 * document (~/.dsh/settings.yaml), e.g. namespace `locale` field `preference`
 * or namespace `ui-theme` field `preference`. Line-scan based (no YAML
 * dependency); returns null when the file, namespace or field is absent.
 * @param home - the DSH home directory.
 * @param namespace - the settings namespace (top-level key), e.g. 'locale'.
 * @param field - the field name inside the namespace block.
 * @returns the trimmed scalar string, or null.
 */
function readSettingsValue(home, namespace, field) {
  try {
    const text = fs.readFileSync(join(home, 'settings.yaml'), 'utf8');
    const lines = text.split(/\r?\n/);
    let inNs = false;
    const re = new RegExp('^' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*');
    for (const line of lines) {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) continue;
      if (!inNs) {
        if (t === namespace + ':' || t === namespace) inNs = true;
        continue;
      }
      if (re.test(t)) {
        return t.replace(re, '').replace(/^["']|["']$/g, '').trim() || null;
      }
      // A non-indented line (next top-level namespace) ends this block.
      if (/^\S/.test(t)) return null;
    }
  } catch { /* unreadable settings -> null */ }
  return null;
}

/**
 * Read the web UI's explicit theme preference from the host user-settings
 * document (~/.dsh/settings.yaml, namespace `ui-theme`, field `preference`),
 * so the dashboard follows the main UI's theme (light/dark/system).
 * @param home - the DSH home directory.
 * @returns 'light' | 'dark' | 'system' | null (absent -> null, caller uses 'system').
 */
function readThemePreference(home) {
  const v = readSettingsValue(home, 'ui-theme', 'preference');
  return (v === 'light' || v === 'dark' || v === 'system') ? v : null;
}

module.exports = {
  semverDesc,
  resolveNode,
  resolveNpmCli,
  resolveDshBin,
  webAppSupportsNoOpen,
  probe,
  taskkillTree,
  parseDshWebUrl,
  hostEventPayload,
  externalPath,
  readLocalePreference,
  readSettingsValue,
  readThemePreference,
};
