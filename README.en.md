# DeepSeek Harness Desktop

English | [简体中文](README.md)

[![version](https://img.shields.io/badge/version-2.0.0-blue)](package.json) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![electron](https://img.shields.io/badge/electron-37-47848F)](package.json)

A lightweight desktop shell (Electron) that wraps an **already-installed** `dsh web` in a native frameless window + system tray. It no longer ships a managed runtime, bundles npm/pnpm, or installs any curated plugin on first run.

## ✅ Prerequisites

DeepSeek Harness (`@deepseek-ai/dsh`, `0.1.2+`) must be installed. Either:

```bash
npm install -g @deepseek-ai/dsh   # A: global install (recommended; needs Node + npm)
npx @deepseek-ai/dsh --version     # B: npx pull (no global install; populates the npx cache)
```

The shell **locates** an installed dsh in this order (locate and spawn only — never installs or updates):

1. `~/.dsh/desktop-runtime/...`, `~/.dsh/profiles/web/...` (legacy desktop-client / profile installs)
2. the npx cache (`%LOCALAPPDATA%\npm-cache\_npx\...`)
3. the global npm prefix (under `npm root -g`)
4. a `dsh` / `dsh.cmd` on PATH

Shortest path for a new user: **install Node.js → `npm i -g @deepseek-ai/dsh` → run the installer**.

## 🚀 Usage

```bash
npm install   # installs Electron (.npmrc pre-configured with the npmmirror mirror)
npm start     # start the client
npm run smoke # smoke mode: prints SMOKE_OK after load, then exits
npm run dist  # build (NSIS installer + portable)
```

## 🎯 Capabilities

- Native frameless window + a separate `WebContentsView` loading `dsh web` (sandbox-isolated, zero preload, external links to the system browser)
- System tray (status dot + double-click to raise / hide to tray / clean exit)
- Service lifecycle: spawn / restart / crash auto-restart with exponential backoff (up to 5)
- dsh 0.1.2+ compatible: parses and loads the `?token=`-carrying ready URL (no lost-token 401)
- Application menu / context menu / in-page find (Ctrl+F) / page screenshot (Ctrl+Shift+S)
- Window bounds and page-zoom memory
- Bilingual, following the main program's language preference

## 🔌 Relationship with plugins

The shell **neither depends on nor installs** any plugin — the first-run curated install (dshmarket, dsh-startup-guard, dsh-notify, …) and all in-shell coupling to them have been removed. Notifications now use Electron's native API, and crash restart is shell-owned.

## 📄 License

MIT