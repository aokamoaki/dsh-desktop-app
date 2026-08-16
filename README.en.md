# DeepSeek Harness Desktop

English | [简体中文](README.md)

[![version](https://img.shields.io/badge/version-1.0.0-blue)](package.json) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![electron](https://img.shields.io/badge/electron-37-47848F)](package.json)

A native desktop client (Electron shell) that wraps `dsh web` in a frameless window + system tray — ready to use out of the box.

## ✨ Features

- 🪟 **Native window**: frameless with a custom titlebar; an isolated `WebContentsView` loads `dsh web` (sandboxed, external links open in the system browser)
- 🗂️ **System tray**: open / Dashboard / start or restart service / quit; clicking × hides to the tray
- 🔄 **Service lifecycle**: attaches an already-running instance (no double-write to `~/.dsh`), port fallback, crash restart with exponential backoff + self-heal notification
- 🛡️ **Pre-boot guard**: runs the [dsh-startup-guard](https://github.com/aokamoaki/dsh-startup-guard) core before spawning dsh, results shown on screen (splash / Dashboard)
- 🔔 **Notification loop**: `dsh-notify://` protocol raises the window; conversation notifications are background-only (ask/approval always fire)
- 📊 **Dashboard**: service status / startup check / dsh version lock·update·rollback / app updates / auto-start toggle / one-click diagnostic export
- 🚀 **Self-update**: baked-in manifest URL, background check on start (`settings.json` can override updateUrl)
- 🎨 **Bilingual, follows the main program**; Dashboard visuals share the main UI's real design tokens
- 📦 **Curated first-run plugins (once only)**; fully missing-safe
- ⌨️ **Shortcuts** + global `Ctrl+Alt+H`; logs at `%APPDATA%\dsh-desktop-app\logs\desktop.log`

> Data fully reuses `%USERPROFILE%\.dsh` — zero migration for existing plugins, credentials, and sessions.

## 🚀 Usage

```bash
npm install            # installs Electron (.npmrc pre-configured with the npmmirror mirror)
npm run provision:npm  # before the first build: generates the shipped offline npm (resources/npm, gitignored)
npm start              # start the client
npm run smoke          # smoke mode: prints SMOKE_OK after attaching, then exits
npm run dist           # build (NSIS installer + portable)
```

## 🏗️ Structure

```
main.js / preload.js / lib/core.js (pure logic, unit-testable) / ui/ / notifier/ / curated.json / guard-runner.mjs
```

Tests: `npm test` (`lib/core` unit tests); UI self-check: `electron.cmd preview.js` offscreen screenshots; build verification: `dist\win-unpacked\dsh-desktop-app.exe --smoke`.

## 📦 Release

```bash
npm run provision:npm && npm run dist   # 1. build the installer
node make-release.mjs --repo=aokamoaki/dsh-desktop-app --version x.y.z  # 2. generate release manifests (dsh-update.json + update-url.json)
gh release create vx.y.z dist-v2\DeepSeek-Harness-Setup-x.y.z.exe dsh-update.json  # 3. upload Release
npm run dist                            # 4. rebuild (bakes the update URL into the app) → distribute
```

> `--repo` must be the real repository or the built-in update URL will 404; the unsigned installer triggers a SmartScreen "unknown publisher" warning on other machines (functionality is unaffected — a code-signing certificate is recommended for real distribution).

## 🔌 Relationship with plugins

The shell itself depends on **no curated plugin** — every integration point is missing-safe: uninstalling `dsh-startup-guard` (startup check) or `dsh-notify` (notifications / foreground) leaves the client fully functional. Curated list (`curated.json`, first-run only): dshmarket, dsh-token-usage, @anionex/dsh-vision-toolkit, dsh-file-upload, dsh-startup-guard. Companion plugin **dsh-desktop-launch** provides a `desktop_launch` tool to raise the desktop client from chat.

## 📄 License

MIT
