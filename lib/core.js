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
const https = require('node:https');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');

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
 *
 * The bundled copy is only selected when it is actually runnable: its own
 * node_modules must have survived packaging. electron-builder's default
 * extraResources filter excludes node_modules, so a packaged client can ship
 * an npm-cli.js that crashes with MODULE_NOT_FOUND on its first require
 * (graceful-fs) - selecting it would fail every dashboard update/rollback
 * even though a working system npm exists. A gutted bundled copy falls
 * through to the system npm instead.
 *
 * @param resourcesPath - Electron's process.resourcesPath ('' outside Electron).
 */
function resolveNpmCli(resourcesPath) {
  if (process.env.DSH_DESKTOP_NPM && fs.existsSync(process.env.DSH_DESKTOP_NPM)) return process.env.DSH_DESKTOP_NPM;
  const bundled = join(resourcesPath || '', 'npm', 'bin', 'npm-cli.js');
  const bundledDeps = join(resourcesPath || '', 'npm', 'node_modules', 'graceful-fs');
  if (fs.existsSync(bundled) && fs.existsSync(bundledDeps)) return bundled;
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
 * Resolve a runnable standalone `pnpm` for `dsh plugin add` (the runtime
 * forwards plugin requests to `spawnSync("pnpm", ...)`). Prefer an env
 * override, then the self-contained @pnpm/exe binary npm installs under
 * pnpmRoot. The package DIRECTORY holds the embedded-Node binary (pnpm.exe /
 * pnpm); the sibling node_modules/.bin shims require a system `node` and are
 * deliberately NOT returned. Null when neither exists.
 * @param pnpmRoot - the directory `npm install --prefix <dir> @pnpm/exe` targets.
 */
function resolvePnpm(pnpmRoot) {
  if (process.env.DSH_DESKTOP_PNPM && fs.existsSync(process.env.DSH_DESKTOP_PNPM)) return process.env.DSH_DESKTOP_PNPM;
  if (!pnpmRoot) return null;
  // @pnpm/exe ships the embedded-Node binary either directly at its package
  // root or via a platform optional dependency (@pnpm/win-x64 etc.). Probe
  // both; only a native pnpm.exe/pnpm is chosen (the node_modules/.bin shims
  // require a system `node` and would defeat the no-Node guarantee).
  const dirs = [
    join(pnpmRoot, 'node_modules', '@pnpm', 'exe'),
    join(pnpmRoot, 'node_modules', '@pnpm', 'win-x64'),
  ];
  for (const d of dirs) {
    for (const c of [join(d, 'pnpm.exe'), join(d, 'pnpm')]) {
      if (fs.existsSync(c)) return c;
    }
  }
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
 * Whether a string is a dsh version the client may install, e.g. `0.1.0` or
 * `0.1.0-rc.8`. dsh ships ONLY prerelease tags, so a gate that accepts only
 * `x.y.z` silently rejects every selectable version; this is the single
 * validation shared by the dashboard IPC gate and updateDsh so the two can
 * never disagree.
 * @param ver - the candidate version string.
 * @returns true for a strict semver, optionally with a prerelease suffix.
 */
function isValidDshVersion(ver) {
  return typeof ver === 'string' && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ver);
}

/**
 * Parse a line of `npm install --loglevel=http` output into a progress
 * accumulator, so the dashboard can show a live progress bar while dsh is
 * updated/rolled back.
 *
 * npm's http log prints one line per registry request, e.g.:
 *   npm http fetch GET 200 https://registry.npmjs.org/.../-/x-1.0.0.tgz 123ms
 * A line mentioning a `.tgz` URL means one package archive was fetched. The
 * "added N packages" line (printed by npm on completion) flips the phase to
 * 'done', and any "npm error" line flips it to 'error'. The accumulator is
 * mutated in place and returned; unknown lines are ignored.
 *
 * @param line - one output line from npm (no trailing newline required).
 * @param acc - mutable progress accumulator:
 *   { phase: 'fetch'|'reify'|'done'|'error', fetched: number }.
 *   May be omitted; a fresh accumulator is created.
 * @returns the same accumulator object (mutated).
 */
function npmProgressLine(line, acc) {
  const a = acc || { phase: 'fetch', fetched: 0 };
  const s = String(line || '');
  // .tgz fetched -> count it (only HTTP 200s; retries/4xx are not progress).
  if (/npm http fetch GET 200\s+\S+\.tgz/.test(s)) a.fetched += 1;
  else if (/reify:/.test(s)) a.phase = 'reify';
  else if (/^added \d+ packages?/.test(s) || /^changed \d+ packages?/.test(s)) a.phase = 'done';
  else if (/npm error/.test(s)) a.phase = 'error';
  return a;
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

/**
 * Build the npm package metadata URL for a scoped package from a registry
 * override. The override may be '' (npm official registry), a bare host, or a
 * full URL; a trailing slash is normalized away. Pure and unit-testable.
 * @param registry - override value from env/settings ('' => official registry).
 * @param pkg - package name, e.g. '@deepseek-ai/dsh'.
 */
function registryMetadataUrl(registry, pkg) {
  const base = String(registry || '').trim().replace(/\/+$/, '') || 'https://registry.npmjs.org';
  return base.replace(/\/+$/, '') + '/' + String(pkg || '').replace(/^\/+/, '');
}

/**
 * Resolve a proxy URL from an explicit setting, a dedicated DSH override, or
 * the standard proxy env vars. DSH_UPDATE_PROXY is a deliberate, DSH-specific
 * choice, so it wins over the ambient https_proxy/http_proxy.
 *   setting -> DSH_UPDATE_PROXY -> https_proxy/HTTPS_PROXY -> http_proxy/HTTP_PROXY.
 * Returns '' when unset.
 */
function resolveProxy(proxySetting) {
  if (typeof proxySetting === 'string' && proxySetting.trim()) return proxySetting.trim();
  const v = process.env.DSH_UPDATE_PROXY ||
    process.env.https_proxy || process.env.HTTPS_PROXY ||
    process.env.http_proxy || process.env.HTTP_PROXY || '';
  return (v || '').trim();
}

/** Parse a proxy URL with a default http:// scheme. Returns null when unparsable. */
function normalizeProxyUrl(proxy) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : 'http://' + proxy); }
  catch { return null; }
}

/**
 * A minimal HTTPS CONNECT-tunneling agent built on node `net`/`tls` only -
 * no bundled dependency - so proxy support keeps working inside the packaged
 * asar (which ships no node_modules). It connects to the proxy, sends
 * `CONNECT host:port`, then upgrades the socket to TLS so the caller's https
 * layer still handles all parsing (headers / redirects / chunked bodies).
 * This is the same tunneling approach the proxy-agent libraries implement.
 */
class ConnectProxyAgent extends https.Agent {
  constructor(pu) {
    super({ keepAlive: false });
    this.proxy = pu;
    // Assign on the instance AFTER super(): the http.Agent base class may set
    // a default createConnection, and for HTTPS the agent must be the one
    // performing the TLS wrap (a plain net socket is not enough).
    this.createConnection = (options, callback) => this._tunnel(options, callback);
  }
  _tunnel(options, callback) {
    const targetHost = options.host || options.hostname;
    const targetPort = Number(options.port || 443);
    const proxyHost = this.proxy.hostname;
    const proxyPort = Number(this.proxy.port || (this.proxy.protocol === 'https:' ? 443 : 80));
    const auth = (this.proxy.username || this.proxy.password)
      ? 'Proxy-Authorization: Basic ' + Buffer.from(decodeURIComponent(this.proxy.username) + ':' + decodeURIComponent(this.proxy.password)).toString('base64') + '\r\n'
      : '';
    let settled = false;
    const finish = (err, sock) => { if (!settled) { settled = true; callback(err, sock); } };
    let socket;
    try { socket = net.connect(proxyPort, proxyHost); }
    catch (e) { finish(e); return; }
    socket.on('error', finish);
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`);
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      socket.removeListener('data', onData);
      const head = buf.slice(0, idx).toString('utf8');
      const m = /(?:^|\r\n)HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(head);
      const status = m ? Number(m[1]) : 0;
      if (status !== 200) {
        socket.destroy();
        finish(new Error('proxy CONNECT failed (' + status + ')'));
        return;
      }
      const rest = buf.slice(idx + 4);
      if (socket.destroyed) { finish(new Error('proxy CONNECT socket closed')); return; }
      let tlsSocket;
      try {
        tlsSocket = tls.connect({ socket, servername: options.servername || targetHost }, () => {
          if (rest.length && !tlsSocket.destroyed) { try { tlsSocket.unshift(rest); } catch { } }
          finish(null, tlsSocket);
        });
      } catch (e) { finish(e); return; }
      tlsSocket.on('error', finish);
    };
    socket.on('data', onData);
  }
}

/**
 * Open a request to `u` honoring an optional proxy ('' = direct). Uses node
 * built-ins only: an HTTPS CONNECT tunnel for https targets and an
 * absolute-form request for plain http targets. A bad proxy URL degrades to a
 * direct request (never throws).
 */
function request(u, headers, proxy, callback) {
  if (proxy) {
    const pu = normalizeProxyUrl(proxy);
    if (pu) {
      if (u.protocol === 'https:') {
        return https.get(u, { headers, agent: new ConnectProxyAgent(pu) }, callback);
      }
      return http.get({
        host: pu.hostname,
        port: Number(pu.port || 80),
        path: u.toString(),
        headers: { ...headers, Host: u.host },
        agent: false,
      }, callback);
    }
  }
  const mod = u.protocol === 'https:' ? https : http;
  return mod.get(u, { headers }, callback);
}

/**
 * GET a URL and parse the JSON body (http/https, optional proxy, timeout,
 * redirect-following, non-2xx -> null). Replaces the old curl.exe metadata
 * fetcher so version enumeration never depends on curl being present and
 * proxy env vars actually work. Never throws: resolves null on every
 * transport / protocol / parse failure.
 * @param url - absolute http(s) URL.
 * @param opts - { accept, timeoutMs, proxy, maxRedirects }.
 * @returns Promise<object|null>
 */
function fetchJson(url, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const accept = opts.accept || 'application/json';
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 20000;
    const maxRedirects = Number(opts.maxRedirects) >= 0 ? Number(opts.maxRedirects) : 5;
    const proxy = resolveProxy(opts.proxy);
    const attempt = (href, redirects) => {
      let u;
      try { u = new URL(href); } catch { settle(null); return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { settle(null); return; }
      const req = request(u, { accept, 'user-agent': 'dsh-desktop-app' }, proxy, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirects >= maxRedirects) { settle(null); return; }
          let next;
          try { next = new URL(res.headers.location, u).toString(); } catch { settle(null); return; }
          attempt(next, redirects + 1);
          return;
        }
        if (code < 200 || code >= 300) { res.resume(); settle(null); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { settle(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { settle(null); }
        });
      });
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch { } settle(null); });
      req.on('error', () => settle(null));
    };
    attempt(url, 0);
  });
}

/**
 * Stream a URL to a local file (http/https, optional proxy, timeout,
 * redirect-following, non-2xx -> error). Replaces the curl.exe-based installer
 * download. Resolves { ok:true, path, size } on success (size in bytes) or
 * { ok:false, error } with the real reason (never a bare exit-code check).
 */
function downloadTo(url, target, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 30000;
    const maxRedirects = Number(opts.maxRedirects) >= 0 ? Number(opts.maxRedirects) : 5;
    const proxy = resolveProxy(opts.proxy);
    const attempt = (href, redirects) => {
      let u;
      try { u = new URL(href); } catch { settle({ ok: false, error: 'invalid download url' }); return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { settle({ ok: false, error: 'unsupported protocol: ' + u.protocol }); return; }
      const req = request(u, { 'user-agent': 'dsh-desktop-app' }, proxy, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirects >= maxRedirects) { settle({ ok: false, error: 'too many redirects' }); return; }
          let next;
          try { next = new URL(res.headers.location, u).toString(); } catch { settle({ ok: false, error: 'bad redirect location' }); return; }
          attempt(next, redirects + 1);
          return;
        }
        if (code < 200 || code >= 300) { res.resume(); settle({ ok: false, error: 'http ' + code }); return; }
        let size = 0;
        let stream;
        try { stream = fs.createWriteStream(target); }
        catch (e) { res.resume(); settle({ ok: false, error: String(e && e.message || e) }); return; }
        stream.on('error', (e) => { try { res.destroy(); } catch { } settle({ ok: false, error: String(e && e.message || e) }); });
        res.on('data', (c) => { size += c.length; });
        res.on('error', (e) => { try { stream.destroy(); } catch { } settle({ ok: false, error: String(e && e.message || e) }); });
        res.pipe(stream);
        stream.on('finish', () => settle({ ok: true, path: target, size }));
      });
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch { } settle({ ok: false, error: 'download timed out' }); });
      req.on('error', (e) => settle({ ok: false, error: String(e && e.message || e) }));
    };
    attempt(url, 0);
  });
}

/**
 * Stream-hash a file with sha512 and resolve its base64 digest - the same
 * encoding electron-builder writes into latest.yml / dsh-update.json. Async so
 * a ~90MB installer is never buffered. Resolves null on any read error.
 */
function fileSha512(filePath) {
  return new Promise((resolve) => {
    try {
      const hash = crypto.createHash('sha512');
      const s = fs.createReadStream(filePath);
      s.on('data', (c) => hash.update(c));
      s.on('end', () => resolve(hash.digest('base64')));
      s.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * Normalize + validate a self-update manifest document (dsh-update.json).
 * Requires a semver-ish `version` and an absolute http(s) `url`; `sha512`
 * (base64) and `size` (bytes) are optional but preserved for integrity
 * checking when present. Returns the normalized object or null when invalid.
 */
function parseUpdateManifest(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const version = typeof j.version === 'string' ? j.version.trim() : '';
  const url = typeof j.url === 'string' ? j.url.trim() : '';
  if (!version || !/^https?:\/\//i.test(url)) return null;
  const sha512 = typeof j.sha512 === 'string' ? j.sha512.trim() : '';
  const size = Number(j.size);
  return {
    version,
    url,
    sha512,
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
  };
}

/**
 * Args for launching an NSIS installer in silent (/S) mode during self-update.
 * `/S` suppresses the wizard so the update needs no user clicks. The app must
 * already be quitting (its own exe lock released) when the installer is
 * spawned. Extra args (if any) are appended after /S.
 */
function silentInstallArgs(extra) {
  return ['/S'].concat(extra || []);
}

module.exports = {
  semverDesc,
  resolveNode,
  resolveNpmCli,
  resolvePnpm,
  resolveDshBin,
  webAppSupportsNoOpen,
  isValidDshVersion,
  npmProgressLine,
  probe,
  taskkillTree,
  parseDshWebUrl,
  hostEventPayload,
  externalPath,
  readLocalePreference,
  readSettingsValue,
  readThemePreference,
  registryMetadataUrl,
  resolveProxy,
  fetchJson,
  downloadTo,
  fileSha512,
  parseUpdateManifest,
  silentInstallArgs,
};
