// make-release.mjs - generate the auto-update manifest for a GitHub Release.
//
// Usage:
//   node make-release.mjs --repo=<user>/<repo> [--version=x.y.z]
//
// Reads the app version from package.json (or --version=), locates the latest
// Setup artifact in dist, computes its sha512 (base64) and size (bytes), and
// writes dsh-update.json with { version, url, sha512, size }. The client
// verifies size + sha512 after download so a corrupted or tampered installer
// can never be installed. Then upload BOTH files to the release:
//
//   gh release create v0.1.7 dist/DeepSeek-Harness-Setup-*.exe dsh-update.json
//
// and configure the desktop app's Update URL (dashboard -> Desktop App ->
// Update URL) to:
//   https://github.com/<user>/<repo>/releases/latest/download/dsh-update.json
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

const repoArg = process.argv.find((a) => a.startsWith('--repo='));
const verArg = process.argv.find((a) => a.startsWith('--version='));
if (!repoArg) {
  console.error('usage: node make-release.mjs --repo=<user>/<repo> [--version=x.y.z]');
  process.exit(1);
}
const repo = repoArg.slice(7).replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '');
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = verArg ? verArg.slice(10) : pkg.version;

const dist = new URL('./dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const setups = existsSync(dist)
  ? readdirSync(dist).filter((f) => /^DeepSeek-Harness-Setup-[\d.]+\.exe$/.test(f)).sort()
  : [];
if (setups.length === 0) {
  console.error('no Setup artifact found in dist - run: npm run dist');
  process.exit(1);
}
const setup = setups[setups.length - 1];
const setupPath = join(dist, setup);
const size = statSync(setupPath).size;
const sha512 = createHash('sha512').update(readFileSync(setupPath)).digest('base64');

const manifest = {
  version,
  url: `https://github.com/${repo}/releases/latest/download/${basename(setup)}`,
  sha512,
  size,
};
const builtin = {
  url: `https://github.com/${repo}/releases/latest/download/dsh-update.json`,
};
const appDir = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(join(appDir, 'dsh-update.json'), JSON.stringify(manifest, null, 2) + '\n');
// update-url.json is the BUILT-IN manifest URL: it gets packaged into the app
// (see package.json build.files), so end users never configure updates.
// Rebuild the installer AFTER generating it.
writeFileSync(join(appDir, 'update-url.json'), JSON.stringify(builtin, null, 2) + '\n');

console.log('manifest written: dsh-update.json (release asset, with sha512 + size)');
console.log(JSON.stringify(manifest, null, 2));
console.log('builtin written: update-url.json (packaged into the app)');
console.log(JSON.stringify(builtin, null, 2));
console.log('');
console.log(`integrity: sha512=${sha512.slice(0, 16)}... size=${size}`);
console.log('');
console.log('Upload to the release, e.g.:');
console.log(`  gh release create v${version} ${join('dist', setup)} dsh-update.json`);
console.log('');
console.log('IMPORTANT: rebuild the installer AFTER this step so update-url.json');
console.log('is baked in:  npm run dist');
