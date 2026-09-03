# DeepSeek Harness Desktop

English | [简体中文](README.md)

[![version](https://img.shields.io/badge/version-1.0.8-blue)](package.json) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![electron](https://img.shields.io/badge/electron-37-47848F)](package.json)

A native desktop client (Electron shell) that wraps `dsh web` in a frameless window + system tray — ready to use out of the box.

## 🚀 Usage

```bash
npm install            # installs Electron (.npmrc pre-configured with the npmmirror mirror)
npm run provision:npm  # before the first build: generates the shipped offline npm (resources/npm, gitignored)
npm start              # start the client
npm run smoke          # smoke mode: prints SMOKE_OK after attaching, then exits
npm run dist           # build (NSIS installer + portable)
```

## 🔌 Relationship with plugins

The shell itself depends on **no curated plugin** — every integration point is missing-safe: uninstalling `dsh-startup-guard` (startup check) or `dsh-notify` (notifications / foreground) leaves the client fully functional. Curated list (`curated.json`, first-run only): dshmarket, dsh-token-usage, @anionex/dsh-vision-toolkit, dsh-file-upload, dsh-startup-guard, dsh-notify, dsh-chat-timeline. Companion plugin **dsh-desktop-launch** provides a `desktop_launch` tool to raise the desktop client from chat.

## 📄 License

MIT