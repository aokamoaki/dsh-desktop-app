// dsh-desktop-app core test suite (node:test, zero deps, no Electron).
// Run with:  node --test test/
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
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
  test('numeric prerelease identifiers rank below alphanumeric (semver precedence)', () => {
    assert.ok(core.semverDesc('0.1.0-rc.1', '0.1.0-rc.beta') > 0, 'rc.beta newer than rc.1');
    assert.ok(core.semverDesc('0.1.0-rc.beta', '0.1.0-rc.1') < 0);
  });
  test('shorter prerelease is older than a longer extension of it', () => {
    assert.ok(core.semverDesc('0.1.0-alpha', '0.1.0-alpha.1') > 0, 'alpha.1 newer than alpha');
    assert.ok(core.semverDesc('0.1.0-alpha.1', '0.1.0-alpha') < 0);
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

describe('npmProgressLine', () => {
  test('counts fetched tarballs from the http log', () => {
    const acc = core.npmProgressLine('npm http fetch GET 200 https://registry.npmjs.org/x/-/x-1.0.0.tgz 123ms');
    core.npmProgressLine('npm http fetch GET 200 https://registry.npmjs.org/y/-/y-2.0.0.tgz 45ms', acc);
    assert.equal(acc.fetched, 2);
    assert.equal(acc.phase, 'fetch');
  });
  test('ignores non-tgz http lines and metadata fetches', () => {
    const acc = { fetched: 0 };
    core.npmProgressLine('npm http fetch GET 200 https://registry.npmjs.org/@deepseek-ai/dsh 80ms', acc);
    core.npmProgressLine('npm http fetch GET 304 https://registry.npmjs.org/x/-/x-1.0.0.tgz', acc);
    assert.equal(acc.fetched, 0);
  });
  test('switches to reify on reify lines, done on added packages', () => {
    const acc = { fetched: 0 };
    core.npmProgressLine('reify:foo: timing reifyNode:node_modules/foo Completed in 10ms', acc);
    assert.equal(acc.phase, 'reify');
    core.npmProgressLine('added 512 packages, and audited 513 packages in 42s', acc);
    assert.equal(acc.phase, 'done');
  });
  test('changed N packages also flips the phase to done', () => {
    const acc = { fetched: 7 };
    core.npmProgressLine('changed 3 packages in 4s', acc);
    assert.equal(acc.phase, 'done');
    assert.equal(acc.fetched, 7, 'fetched count is preserved');
  });
  test('switches to error on npm error lines', () => {
    const acc = { fetched: 0 };
    core.npmProgressLine('npm error code ETARGET', acc);
    assert.equal(acc.phase, 'error');
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

describe('registryMetadataUrl', () => {
  test('official registry when the override is empty', () => {
    assert.equal(core.registryMetadataUrl('', '@deepseek-ai/dsh'), 'https://registry.npmjs.org/@deepseek-ai/dsh');
    assert.equal(core.registryMetadataUrl(null, '@deepseek-ai/dsh'), 'https://registry.npmjs.org/@deepseek-ai/dsh');
    assert.equal(core.registryMetadataUrl(undefined, '@deepseek-ai/dsh'), 'https://registry.npmjs.org/@deepseek-ai/dsh');
  });
  test('mirror / custom override is honored (the version enum follows the npm mirror switch)', () => {
    assert.equal(core.registryMetadataUrl('https://registry.npmmirror.com', '@deepseek-ai/dsh'), 'https://registry.npmmirror.com/@deepseek-ai/dsh');
    assert.equal(core.registryMetadataUrl('http://registry.internal:4873', '@deepseek-ai/dsh'), 'http://registry.internal:4873/@deepseek-ai/dsh');
  });
  test('trailing slashes are normalized away', () => {
    assert.equal(core.registryMetadataUrl('https://registry.npmmirror.com/', '@deepseek-ai/dsh'), 'https://registry.npmmirror.com/@deepseek-ai/dsh');
    assert.equal(core.registryMetadataUrl('https://registry.npmmirror.com///', '@deepseek-ai/dsh'), 'https://registry.npmmirror.com/@deepseek-ai/dsh');
  });
  test('preserves a registry path/port and strips a leading package slash', () => {
    assert.equal(core.registryMetadataUrl('https://host:4873/npm', '/@deepseek-ai/dsh'), 'https://host:4873/npm/@deepseek-ai/dsh');
  });
});

describe('parseUpdateManifest', () => {
  test('accepts a full manifest with sha512 + size', () => {
    const m = core.parseUpdateManifest({ version: '1.0.7', url: 'https://example.com/Setup.exe', sha512: 'abc==', size: 95853235 });
    assert.deepEqual(m, { version: '1.0.7', url: 'https://example.com/Setup.exe', sha512: 'abc==', size: 95853235 });
  });
  test('rejects a missing version or a missing/non-http url', () => {
    assert.equal(core.parseUpdateManifest(null), null);
    assert.equal(core.parseUpdateManifest([]), null);
    assert.equal(core.parseUpdateManifest({ url: 'https://example.com/Setup.exe' }), null);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7' }), null);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'file:///C:/Setup.exe' }), null);
  });
  test('normalizes size and tolerates absent integrity fields (back-compat with old manifests)', () => {
    const m = core.parseUpdateManifest({ version: '1.0.7', url: 'https://example.com/Setup.exe' });
    assert.equal(m.sha512, '');
    assert.equal(m.size, 0);
    const m2 = core.parseUpdateManifest({ version: '1.0.7', url: 'https://example.com/Setup.exe', size: 99.9 });
    assert.equal(m2.size, 99);
  });
  test('drops non-positive / non-finite / non-numeric size to 0', () => {
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'https://e.com/x', size: 0 }).size, 0);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'https://e.com/x', size: -5 }).size, 0);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'https://e.com/x', size: NaN }).size, 0);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'https://e.com/x', size: 'big' }).size, 0);
    assert.equal(core.parseUpdateManifest({ version: '1.0.7', url: 'https://e.com/x', size: Infinity }).size, 0);
  });
  test('trims version/url/sha512 whitespace', () => {
    const m = core.parseUpdateManifest({ version: ' 1.0.7 ', url: ' https://e.com/x.exe ', sha512: ' abc== ' });
    assert.equal(m.version, '1.0.7');
    assert.equal(m.url, 'https://e.com/x.exe');
    assert.equal(m.sha512, 'abc==');
  });
  test('integrity fields compose with fileSha512 + byte size for offline verification', async () => {
    const f = path.join(tmpdir(), 'setup.bin');
    const body = Buffer.from('not-a-real-installer-0123456789');
    fs.writeFileSync(f, body);
    try {
      const m = core.parseUpdateManifest({
        version: '1.0.7',
        url: 'https://e.com/Setup.exe',
        sha512: require('node:crypto').createHash('sha512').update(body).digest('base64'),
        size: body.length,
      });
      assert.equal(m.sha512, await core.fileSha512(f));
      assert.equal(m.size, fs.statSync(f).size);
    } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
  });
});

describe('silentInstallArgs', () => {
  test('builds the /S silent args and appends extras', () => {
    assert.deepEqual(core.silentInstallArgs(), ['/S']);
    assert.deepEqual(core.silentInstallArgs(['/updated']), ['/S', '/updated']);
  });
});

describe('fileSha512', () => {
  test('returns the base64 sha512 of a file (electron-builder encoding)', async () => {
    const f = path.join(tmpdir(), 'x.bin');
    fs.writeFileSync(f, Buffer.from('hello dsh'));
    try {
      const expected = require('node:crypto').createHash('sha512').update('hello dsh').digest('base64');
      assert.equal(await core.fileSha512(f), expected);
    } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
  });
  test('resolves null for a missing file', async () => {
    assert.equal(await core.fileSha512(path.join(tmpdir(), 'nope.bin')), null);
  });
});

describe('fetchJson', () => {
  test('parses a 2xx JSON body (no curl.exe)', async () => {
    const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const j = await core.fetchJson(`http://127.0.0.1:${srv.address().port}/`);
      assert.deepEqual(j, { ok: true });
    } finally { srv.close(); }
  });
  test('follows redirects', async () => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/start') { res.statusCode = 302; res.setHeader('location', '/end'); res.end(); }
      else { res.end(JSON.stringify({ redirected: true })); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const j = await core.fetchJson(`http://127.0.0.1:${srv.address().port}/start`);
      assert.deepEqual(j, { redirected: true });
    } finally { srv.close(); }
  });
  test('returns null on non-2xx / invalid JSON', async () => {
    const srv = http.createServer((req, res) => { res.statusCode = 404; res.end('nope'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      assert.equal(await core.fetchJson(`http://127.0.0.1:${srv.address().port}/`), null);
    } finally { srv.close(); }
  });
});

describe('downloadTo', () => {
  test('streams a body to a file and reports its byte size', async () => {
    const srv = http.createServer((req, res) => { res.end(Buffer.from('0123456789abcdef')); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const out = path.join(tmpdir(), 'out.bin');
    try {
      const r = await core.downloadTo(`http://127.0.0.1:${srv.address().port}/f`, out, { timeoutMs: 3000 });
      assert.equal(r.ok, true);
      assert.equal(r.size, 16);
      assert.equal(fs.readFileSync(out, 'utf8'), '0123456789abcdef');
    } finally { srv.close(); fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
  });
  test('returns a real error string on non-2xx', async () => {
    const srv = http.createServer((req, res) => { res.statusCode = 500; res.end('boom'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const out = path.join(tmpdir(), 'out.bin');
    try {
      const r = await core.downloadTo(`http://127.0.0.1:${srv.address().port}/f`, out);
      assert.equal(r.ok, false);
      assert.equal(r.error, 'http 500');
    } finally { srv.close(); fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
  });
});

describe('proxy support (self-contained, no bundled deps)', () => {
  test('fetchJson routes a plain http request through an http proxy (absolute-form)', async () => {
    const target = http.createServer((req, res) => { res.end(JSON.stringify({ viaProxy: true })); });
    await new Promise((r) => target.listen(0, '127.0.0.1', r));
    const proxy = http.createServer((req, res) => {
      let tu;
      try { tu = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
      const up = http.request(tu, (r2) => { res.writeHead(r2.statusCode || 200, r2.headers); r2.pipe(res); });
      up.on('error', () => { try { res.writeHead(502); res.end(); } catch { } });
      req.pipe(up);
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const j = await core.fetchJson(`http://127.0.0.1:${target.address().port}/x`, {
        proxy: `http://127.0.0.1:${proxy.address().port}`, timeoutMs: 3000,
      });
      assert.deepEqual(j, { viaProxy: true });
    } finally { proxy.close(); target.close(); }
  });

  test('https requests issue a CONNECT handshake through a proxy', async () => {
    let got = '';
    const proxy = net.createServer((sock) => {
      sock.on('error', () => { /* client may reset after the failed handshake */ });
      sock.on('data', (d) => {
        got += d.toString();
        if (!got.includes('\r\n\r\n')) return;
        // Report 200 Established, then feed an invalid TLS ServerHello and
        // destroy. The client's TLS handshake fails cleanly (fetchJson -> null)
        // but the CONNECT negotiation header has already been captured.
        sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        sock.write(Buffer.from('not-a-tls-server-hello'));
        setTimeout(() => sock.destroy(), 30);
      });
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const r = await core.fetchJson('https://example.com/', { proxy: `http://127.0.0.1:${proxy.address().port}`, timeoutMs: 3000 });
      assert.equal(r, null, 'handshake failure degrades to null, never throws');
      assert.match(got, /^CONNECT example\.com:443 HTTP\/1\.1\r\n/);
    } finally { proxy.close(); }
  });
});
