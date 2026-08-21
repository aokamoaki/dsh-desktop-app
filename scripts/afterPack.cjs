// afterPack.cjs - electron-builder hook: restore the bundled npm's own
// node_modules into the packaged app.
//
// WHY: electron-builder's file copier hard-excludes a *root-level* node_modules
// from every extraResources copy (`createFilter` returns false for a relative
// path of exactly "node_modules", regardless of the `filter` patterns). The
// bundled npm under resources/npm is copied gutted - bin/lib/docs present,
// node_modules stripped - so npm-cli.js crashes with MODULE_NOT_FOUND
// (graceful-fs) on first require, and every dashboard dsh update/rollback
// failed before reaching the network. This hook runs after packaging and
// overwrites resources/npm with a complete copy from the source tree.
//
// Hook signature: (context) => Promise<void>
//   context.appOutDir - the win-unpacked / linux-unpacked output dir.
//   context.packager.projectDir - the project root.

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const src = path.join(projectDir, 'resources', 'npm');
  const dest = path.join(context.appOutDir, 'resources', 'npm');
  if (!fs.existsSync(src)) {
    console.warn('[afterPack] bundled npm source missing, skipping:', src);
    return;
  }
  // electron-builder may have already copied a gutted copy (no node_modules);
  // remove it first so stale files never survive, then copy the full tree.
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  const nm = path.join(dest, 'node_modules');
  const ok = fs.existsSync(nm) && fs.existsSync(path.join(nm, 'graceful-fs'));
  if (!ok) {
    throw new Error(`[afterPack] bundled npm still missing graceful-fs after restore: ${dest}`);
  }
  console.log(`[afterPack] bundled npm restored with node_modules -> ${dest}`);
};
