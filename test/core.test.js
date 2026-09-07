// dsh-desktop-app core test suite (node:test, zero deps, no Electron).
// Run with:  node --test test/
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../lib/core.js');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-test-')); }

/** Run fn with process.env[key] temporarily set to value, then restore. */
function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  }
}

/** Create a fake dsh bin.js under `<root>/@deepseek-ai/dsh/lib/bin.js`. */
function fakeBin(root) {
  const bin = path.join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '// fake bin');
  return bin;
}

describe('parseDshWebUrl', () => {
  const PREFIX = 'dsh web: ';

  test('extracts the full authenticated URL (dsh 0.1.2+ token form)', () => {
    assert.equal(
      core.parseDshWebUrl('dsh web: http://127.0.0.1:3080/?token=abcDEF123_-456\n', PREFIX),
      'http://127.0.0.1:3080/?token=abcDEF123_-456'
    );
  });

  test('ignores the LAN URL that follows the loopback URL', () => {
    assert.equal(
      core.parseDshWebUrl('dsh web: http://127.0.0.1:3080/?token=loop (LAN: http://192.168.1.5:3080/?token=lan)', PREFIX),
      'http://127.0.0.1:3080/?token=loop'
    );
  });

  test('captures the port when there is no token (legacy runtimes)', () => {
    assert.equal(core.parseDshWebUrl('dsh web: http://127.0.0.1:54321\n', PREFIX), 'http://127.0.0.1:54321');
  });

  test('ignores the "opening the default browser" notice line', () => {
    assert.equal(core.parseDshWebUrl('dsh web: opening the default browser; pass --no-open to disable\n', PREFIX), null);
  });

  test('returns null when the prefix is absent or the URL is malformed', () => {
    assert.equal(core.parseDshWebUrl('starting...', PREFIX), null);
    assert.equal(core.parseDshWebUrl('', PREFIX), null);
    assert.equal(core.parseDshWebUrl(null, PREFIX), null);
  });

  test('does not leak the token into a bare origin (only exact capture)', () => {
    const u = core.parseDshWebUrl('dsh web: http://127.0.0.1:3080/?token=x', PREFIX);
    assert.ok(u.includes('?token=x'));
  });
});

describe('resolveNode', () => {
  test('returns the exe/electronAsNode shape', () => {
    const r = core.resolveNode();
    assert.equal(typeof r.exe, 'string');
    assert.ok(r.exe.length > 0);
    assert.equal(typeof r.electronAsNode, 'boolean');
  });
});

describe('resolveHomeDshBin', () => {
  test('prefers desktop-runtime, then falls back to the profile', () => {
    const home = tmpdir();
    try {
      assert.equal(core.resolveHomeDshBin(home), null);
      const profile = path.join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      fs.mkdirSync(path.dirname(profile), { recursive: true });
      fs.writeFileSync(profile, '// fake bin');
      assert.equal(core.resolveHomeDshBin(home), profile);
      const rt = path.join(home, 'desktop-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      fs.mkdirSync(path.dirname(rt), { recursive: true });
      fs.writeFileSync(rt, '// fake bin');
      assert.equal(core.resolveHomeDshBin(home), rt); // desktop-runtime wins over profile
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('resolveNpxDshBin', () => {
  test('finds the newest npx cache entry via LOCALAPPDATA', () => {
    const base = tmpdir();
    try {
      const older = path.join(base, 'npm-cache', '_npx', 'older', 'node_modules');
      const newer = path.join(base, 'npm-cache', '_npx', 'newer', 'node_modules');
      fakeBin(older); fakeBin(newer);
      fs.utimesSync(path.join(base, 'npm-cache', '_npx', 'older'), new Date('2019-01-01T00:00:00Z'), new Date('2019-01-01T00:00:00Z'));
      fs.utimesSync(path.join(base, 'npm-cache', '_npx', 'newer'), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
      withEnv('LOCALAPPDATA', base, () => {
        assert.equal(core.resolveNpxDshBin(), path.join(newer, '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
      });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
  test('returns null when the cache is empty/absent', () => {
    const base = tmpdir();
    try {
      withEnv('LOCALAPPDATA', base, () => {
        assert.equal(core.resolveNpxDshBin(), null);
      });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

describe('resolveGlobalDshBin', () => {
  test('finds a global npm install via APPDATA', () => {
    const appdata = tmpdir();
    try {
      const bin = fakeBin(path.join(appdata, 'npm', 'node_modules'));
      withEnv('APPDATA', appdata, () => {
        assert.equal(core.resolveGlobalDshBin(), bin);
      });
    } finally { fs.rmSync(appdata, { recursive: true, force: true }); }
  });
  test('returns null when no global install exists', () => {
    withEnv('APPDATA', tmpdir(), () => {
      const r = core.resolveGlobalDshBin();
      assert.ok(r === null || typeof r === 'string');
    });
  });
});

describe('resolvePathDshBin', () => {
  // `where` is a Windows built-in; resolvePathDshBin is a graceful no-op (it
  // returns null) on POSIX, so the shim-mapping behaviour is Windows-only.
  test('maps a PATH dsh.cmd shim back to its sibling bin.js', { skip: process.platform !== 'win32' }, () => {
    const dir = tmpdir();
    try {
      const bin = fakeBin(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'dsh.cmd'), '@echo off');
      const prev = process.env.PATH;
      process.env.PATH = dir + path.delimiter + (prev || '');
      try {
        const got = core.resolvePathDshBin();
        assert.ok(typeof got === 'string');
        // Canonicalize: GitHub's Windows runner reports `where` results with
        // 8.3 short names (RUNNER~1) that differ from os.tmpdir()'s long form.
        assert.equal(fs.realpathSync.native(got), fs.realpathSync.native(bin));
      } finally { process.env.PATH = prev; }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('returns null when dsh is not on PATH', () => {
    const r = core.resolvePathDshBin();
    assert.ok(r === null || typeof r === 'string');
  });
});

describe('resolveDshBin', () => {
  test('home-relative install wins over machine-wide locations', () => {
    const home = tmpdir();
    try {
      const bin = path.join(home, 'desktop-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(bin, '// fake bin');
      assert.equal(core.resolveDshBin(home), bin);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns a string or null overall', () => {
    const r = core.resolveDshBin(tmpdir());
    assert.ok(r === null || typeof r === 'string');
  });
});

describe('webAppSupportsNoOpen', () => {
  function homeWith(startupBody) {
    const home = tmpdir();
    const bin = path.join(home, 'desktop-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '// fake bin');
    const startup = path.join(home, 'desktop-runtime', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'lib', 'startup.js');
    if (startupBody !== null) {
      fs.mkdirSync(path.dirname(startup), { recursive: true });
      fs.writeFileSync(startup, startupBody);
    }
    return home;
  }
  test('true when the runtime web app declares --no-open', () => {
    const home = homeWith('.option("--no-open", "do not open the Web UI in the default browser")');
    try { assert.equal(core.webAppSupportsNoOpen(home), true); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('false when the web app predates --no-open', () => {
    const home = homeWith('.option("--port <port>", "listen port")');
    try { assert.equal(core.webAppSupportsNoOpen(home), false); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('false when no web app sits next to the resolved bin', () => {
    const a = homeWith(null);
    try { assert.equal(core.webAppSupportsNoOpen(a), false); } finally { fs.rmSync(a, { recursive: true, force: true }); }
  });
  test('returns a boolean for an empty home (may resolve a real npx-cache dsh)', () => {
    const b = tmpdir();
    try { assert.equal(typeof core.webAppSupportsNoOpen(b), 'boolean'); } finally { fs.rmSync(b, { recursive: true, force: true }); }
  });
});

describe('readLocalePreference', () => {
  function homeWith(yamlText) {
    const home = tmpdir();
    fs.writeFileSync(path.join(home, 'settings.yaml'), yamlText);
    return home;
  }
  test('reads zh / en preference', () => {
    const zh = homeWith('locale:\n  preference: zh\n');
    const en = homeWith('locale:\n  preference: en\n');
    try {
      assert.equal(core.readLocalePreference(zh), 'zh');
      assert.equal(core.readLocalePreference(en), 'en');
    } finally { fs.rmSync(zh, { recursive: true, force: true }); fs.rmSync(en, { recursive: true, force: true }); }
  });
  test('accepts quoted values and stops at the next top-level namespace', () => {
    const home = homeWith('locale:\n  preference: "zh"\npet:\n  enabled: true\n');
    try { assert.equal(core.readLocalePreference(home), 'zh'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns null when absent, unknown, or outside the locale block', () => {
    const absent = homeWith('pet:\n  enabled: false\n');
    const unknown = homeWith('locale:\n  preference: fr\n');
    const outside = homeWith('other:\n  preference: en\n');
    try {
      assert.equal(core.readLocalePreference(absent), null);
      assert.equal(core.readLocalePreference(unknown), null);
      assert.equal(core.readLocalePreference(outside), null);
      assert.equal(core.readLocalePreference(tmpdir()), null);
    } finally { [absent, unknown, outside].forEach(h => fs.rmSync(h, { recursive: true, force: true })); }
  });
});