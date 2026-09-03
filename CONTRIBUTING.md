# Contributing

Thanks for taking a look. Small fixes and clear bug reports are very welcome.

Before opening a pull request:

1. Keep `main.js` / `preload.js` ASCII-only CommonJS (Electron main/preload constraints).
2. Keep logic in `lib/core.js` **Electron-free** so it stays unit-testable (`node:test`, no Electron).
3. Run the checks:

   ```sh
   node --check main.js
   node --check preload.js
   npm test
   ```

4. UI changes: self-check with the offscreen previews (`npx electron preview.js`).
5. Update `CHANGELOG.md` for user-visible changes.

## Report a bug

Include: app version, `%APPDATA%\dsh-desktop-app\logs\desktop.log` (last lines), and the Dashboard diagnostic export if available. If a startup check auto-disabled a plugin, include the reason comment in the profile's `cordis.patch.yml` and the `repair-backups/` backup.
