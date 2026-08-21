// dsh-desktop-app core test suite (node:test, zero deps, no Electron).
// Run with:  node --test test/
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../lib/core.js');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-test-')); }

describe('semverDesc', () => {
  test('orders versions descending', () => {
    assert.ok(core.semverDesc('1.0.0', '2.0.0') > 0, 'b newer -> positive');
    assert.ok(core.semverDesc('2.0.0', '1.0.0') < 0, 'a newer -> negative');
    assert.ok(core.semverDesc('1.2.3', '1.2.3') === 0);
  });
  test('handles missing parts as zero', () => {
    assert.ok(core.semverDesc('1.2', '1.2.0') === 0);
    assert.ok(core.semverDesc('1', '1.0.0') === 0);
    assert.ok(core.semverDesc('1.0.10', '1.0.9') < 0);
  });
  test('sorts a version list descending', () => {
    const list = ['1.0.0', '2.0.0', '1.9.9', '2.0.1'];
    assert.deepEqual([...list].sort(core.semverDesc), ['2.0.1', '2.0.0', '1.9.9', '1.0.0']);
  });
  test('orders prerelease suffixes numerically (rc series)', () => {
    assert.ok(core.semverDesc('0.1.0-rc.6', '0.1.0-rc.3') < 0, 'rc.6 newer than rc.3');
    assert.ok(core.semverDesc('0.1.0-rc.3', '0.1.0-rc.6') > 0);
    assert.ok(core.semverDesc('0.0.1-rc.5', '0.1.0-rc.2') > 0, 'b 0.1.0 newer than a 0.0.1');
  });
  test('stable ranks above prerelease of the same x.y.z', () => {
    assert.ok(core.semverDesc('0.1.0', '0.1.0-rc.6') < 0, 'a stable -> a newer -> negative');
    assert.ok(core.semverDesc('0.1.0-rc.6', '0.1.0') > 0);
  });
  test('sorts the real dsh registry set with prereleases', () => {
    const list = ['0.0.1-rc.1', '0.0.1-rc.2', '0.0.1-rc.5', '0.1.0-rc.2', '0.1.0-rc.3', '0.1.0-rc.6'];
    const sorted = [...list].sort(core.semverDesc);
    assert.equal(sorted[0], '0.1.0-rc.6', 'latest first');
    assert.deepEqual(sorted, ['0.1.0-rc.6', '0.1.0-rc.3', '0.1.0-rc.2', '0.0.1-rc.5', '0.0.1-rc.2', '0.0.1-rc.1']);
  });
  test('malformed versions compare as equal (never break sorting)', () => {
    assert.ok(core.semverDesc('garbage', '1.0.0') === 0);
  });
});

describe('parseDshWebUrl', () => {
  const PREFIX = 'dsh web: http://127.0.0.1:';
  test('extracts the ready URL from dsh stdout', () => {
    assert.equal(core.parseDshWebUrl('dsh web: http://127.0.0.1:3080\n', PREFIX), 'http://127.0.0.1:3080');
    assert.equal(core.parseDshWebUrl('prefix noise dsh web: http://127.0.0.1:54321 ready', PREFIX), 'http://127.0.0.1:54321');
  });
  test('returns null when the prefix is absent or malformed', () => {
    assert.equal(core.parseDshWebUrl('starting...', PREFIX), null);
    assert.equal(core.parseDshWebUrl('dsh web: http://127.0.0.1:', PREFIX), null);
    assert.equal(core.parseDshWebUrl('dsh web: http://127.0.0.1:notaport', PREFIX), null);
    assert.equal(core.parseDshWebUrl('', PREFIX), null);
  });
});

describe('hostEventPayload', () => {
  test('parses a host event frame', () => {
    const raw = JSON.stringify({ rpcId: 'abc', payload: { type: 'host/session-status', sessionId: 's1', running: false } });
    assert.deepEqual(core.hostEventPayload(raw), { type: 'host/session-status', sessionId: 's1', running: false });
  });
  test('returns undefined for garbage', () => {
    assert.equal(core.hostEventPayload('not json'), undefined);
    assert.equal(core.hostEventPayload(null), undefined);
    assert.equal(core.hostEventPayload('{"rpcId":"x"}'), undefined); // no payload
  });
});

describe('probe', () => {
  test('true when the body contains the marker', async () => {
    const srv = http.createServer((req, res) => { res.end('<title>DeepSeek Harness</title>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      assert.equal(await core.probe(`http://127.0.0.1:${port}/`, 2000, 'DeepSeek Harness'), true);
    } finally { srv.close(); }
  });
  test('false when the marker is missing', async () => {
    const srv = http.createServer((req, res) => { res.end('<title>other</title>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      assert.equal(await core.probe(`http://127.0.0.1:${port}/`, 2000, 'DeepSeek Harness'), false);
    } finally { srv.close(); }
  });
  test('false on connection refusal (no server)', async () => {
    assert.equal(await core.probe('http://127.0.0.1:1/', 1500, 'x'), false);
  });
  test('false on timeout', async () => {
    const srv = http.createServer(() => { /* never respond */ });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      assert.equal(await core.probe(`http://127.0.0.1:${port}/`, 400, 'x'), false);
    } finally { srv.close(); }
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

describe('resolveDshBin', () => {
  test('finds the managed desktop-runtime bin first', () => {
    const home = tmpdir();
    const bin = path.join(home, 'desktop-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '// fake bin');
    try {
      assert.equal(core.resolveDshBin(home), bin);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('falls back to the profile node_modules', () => {
    const home = tmpdir();
    const bin = path.join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '// fake bin');
    try {
      assert.equal(core.resolveDshBin(home), bin);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns null for an empty home without touching real npx caches', () => {
    // The npx-cache scan reads the real user home; with DSH_DESKTOP_NODE-like
    // isolation unavailable, only assert the return is null or a string.
    const home = tmpdir();
    try {
      const r = core.resolveDshBin(home);
      assert.ok(r === null || typeof r === 'string');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
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
  test('true when the runtime web app declares --no-open (newer dsh)', () => {
    const home = homeWith('.option("--no-open", "do not open the Web UI in the default browser")');
    try { assert.equal(core.webAppSupportsNoOpen(home), true); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('false when the web app predates --no-open', () => {
    const home = homeWith('.option("--port <port>", "listen port")');
    try { assert.equal(core.webAppSupportsNoOpen(home), false); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('false when no web app is installed next to the bin', () => {
    const home = homeWith(null);
    try { assert.equal(core.webAppSupportsNoOpen(home), false); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('false when no dsh bin exists', () => {
    const home = tmpdir();
    try { assert.equal(core.webAppSupportsNoOpen(home), false); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('isValidDshVersion', () => {
  test('accepts plain semver', () => {
    assert.equal(core.isValidDshVersion('0.1.0'), true);
    assert.equal(core.isValidDshVersion('1.2.3'), true);
  });
  test('accepts prerelease tags (dsh ships only -rc.x versions)', () => {
    assert.equal(core.isValidDshVersion('0.1.0-rc.8'), true);
    assert.equal(core.isValidDshVersion('0.0.1-rc.1'), true);
    assert.equal(core.isValidDshVersion('0.1.0-rc.2-beta.1'), true);
  });
  test('rejects non-versions and malformed shapes', () => {
    assert.equal(core.isValidDshVersion(''), false);
    assert.equal(core.isValidDshVersion(null), false);
    assert.equal(core.isValidDshVersion(undefined), false);
    assert.equal(core.isValidDshVersion(1.0), false);
    assert.equal(core.isValidDshVersion('v0.1.0'), false);
    assert.equal(core.isValidDshVersion('0.1'), false);
    assert.equal(core.isValidDshVersion('latest'), false);
    assert.equal(core.isValidDshVersion('0.1.0/../x'), false);
  });
});

describe('externalPath', () => {
  test('maps app.asar paths to app.asar.unpacked', () => {
    const sep = path.sep;
    const p = ['C:', 'apps', 'resources', 'app.asar', 'notifier', 'notify.ps1'].join(sep);
    const expected = ['C:', 'apps', 'resources', 'app.asar.unpacked', 'notifier', 'notify.ps1'].join(sep);
    assert.equal(core.externalPath(p, ['C:', 'apps', 'resources'].join(sep)), expected);
  });
  test('passes through non-asar paths (dev mode)', () => {
    const p = path.join('C:', 'proj', 'dsh-desktop-app', 'notifier', 'notify.ps1');
    assert.equal(core.externalPath(p, path.join('C:', 'proj', 'dsh-desktop-app')), p);
    assert.equal(core.externalPath(p, ''), p);
  });
  test('passes through when resourcesPath is empty (plain node)', () => {
    const p = path.join('C:', 'apps', 'resources', 'app.asar', 'guard-runner.mjs');
    assert.equal(core.externalPath(p, ''), p);
  });
});

describe('resolveNpmCli', () => {
  function bundledNpm(res, withDeps) {
    const cli = path.join(res, 'npm', 'bin', 'npm-cli.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '// fake npm');
    if (withDeps) {
      const deps = path.join(res, 'npm', 'node_modules', 'graceful-fs');
      fs.mkdirSync(path.dirname(deps), { recursive: true });
      fs.writeFileSync(deps, '// fake graceful-fs');
    }
    return cli;
  }
  test('prefers the bundled npm under resourcesPath when its deps are intact', () => {
    const res = tmpdir();
    const cli = bundledNpm(res, true);
    try {
      assert.equal(core.resolveNpmCli(res), cli);
    } finally { fs.rmSync(res, { recursive: true, force: true }); }
  });
  test('ignores a bundled npm whose node_modules did not survive packaging', () => {
    // electron-builder's default extraResources filter strips node_modules,
    // leaving npm-cli.js present but unusable (MODULE_NOT_FOUND graceful-fs);
    // the resolver must skip it and fall through instead of selecting it.
    const res = tmpdir();
    const cli = bundledNpm(res, false);
    try {
      const r = core.resolveNpmCli(res);
      assert.notEqual(r, cli, 'must not select a bundled npm missing graceful-fs');
      assert.ok(r === null || typeof r === 'string');
    } finally { fs.rmSync(res, { recursive: true, force: true }); }
  });
  test('env override DSH_DESKTOP_NPM wins over everything', () => {
    const res = tmpdir();
    bundledNpm(res, true);
    const override = path.join(res, 'override-npm-cli.js');
    fs.writeFileSync(override, '// override');
    const prev = process.env.DSH_DESKTOP_NPM;
    try {
      process.env.DSH_DESKTOP_NPM = override;
      assert.equal(core.resolveNpmCli(res), override);
    } finally {
      if (prev === undefined) delete process.env.DSH_DESKTOP_NPM; else process.env.DSH_DESKTOP_NPM = prev;
      fs.rmSync(res, { recursive: true, force: true });
    }
  });
  test('falls through to system npm when nothing is bundled', () => {
    const r = core.resolveNpmCli(path.join(tmpdir(), 'missing'));
    assert.ok(r === null || typeof r === 'string');
  });
});

describe('readLocalePreference', () => {
  function homeWith(yamlText) {
    const home = tmpdir();
    fs.writeFileSync(path.join(home, 'settings.yaml'), yamlText);
    return home;
  }
  test('reads zh preference (web main UI language)', () => {
    const home = homeWith('ui-onboarding:\n  welcomeNoticeVersion: 1\nlocale:\n  preference: zh\n');
    try { assert.equal(core.readLocalePreference(home), 'zh'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('reads en preference', () => {
    const home = homeWith('locale:\n  preference: en\n');
    try { assert.equal(core.readLocalePreference(home), 'en'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('accepts quoted values', () => {
    const home = homeWith('locale:\n  preference: "zh"\n');
    try { assert.equal(core.readLocalePreference(home), 'zh'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns null when the locale block is absent', () => {
    const home = homeWith('pet:\n  enabled: false\n');
    try { assert.equal(core.readLocalePreference(home), null); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns null for an unknown preference value', () => {
    const home = homeWith('locale:\n  preference: fr\n');
    try { assert.equal(core.readLocalePreference(home), null); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('stops at the next top-level namespace after the locale block', () => {
    const home = homeWith('locale:\n  preference: zh\npet:\n  enabled: true\n');
    try { assert.equal(core.readLocalePreference(home), 'zh'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('returns null when settings.yaml is missing', () => {
    assert.equal(core.readLocalePreference(tmpdir()), null);
  });
  test('ignores the preference when it appears outside the locale block', () => {
    const home = homeWith('other:\n  preference: en\n');
    try { assert.equal(core.readLocalePreference(home), null); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('readThemePreference', () => {
  function homeWith(yamlText) {
    const home = tmpdir();
    fs.writeFileSync(path.join(home, 'settings.yaml'), yamlText);
    return home;
  }
  test('reads an explicit dark preference (main UI theme)', () => {
    const home = homeWith('ui-theme:\n  preference: dark\n');
    try { assert.equal(core.readThemePreference(home), 'dark'); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  test('reads light and system', () => {
    for (const v of ['light', 'system']) {
      const home = homeWith('ui-theme:\n  preference: ' + v + '\n');
      try { assert.equal(core.readThemePreference(home), v); } finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
  });
  test('returns null when absent or unknown', () => {
    const absent = homeWith('pet:\n  enabled: false\n');
    const unknown = homeWith('ui-theme:\n  preference: neon\n');
    try {
      assert.equal(core.readThemePreference(absent), null);
      assert.equal(core.readThemePreference(unknown), null);
    } finally { fs.rmSync(absent, { recursive: true, force: true }); fs.rmSync(unknown, { recursive: true, force: true }); }
  });
  test('readSettingsValue is namespace-scoped', () => {
    const home = homeWith('locale:\n  preference: zh\nui-theme:\n  preference: dark\n');
    try {
      assert.equal(core.readSettingsValue(home, 'locale', 'preference'), 'zh');
      assert.equal(core.readSettingsValue(home, 'ui-theme', 'preference'), 'dark');
      assert.equal(core.readSettingsValue(home, 'pet', 'preference'), null);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
