# DeepSeek Harness Desktop

简体中文 | [English](README.en.md)

![version](https://img.shields.io/badge/version-2.0.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![electron](https://img.shields.io/badge/electron-37-47848F)

轻量桌面壳（Electron）——把**已安装**的 `dsh web` 装进原生无边框窗口 + 系统托盘。不再自带运行时、不再内置 npm/pnpm、不再首启安装任何精选插件。

## ✅ 前提

本机需已安装 DeepSeek Harness（`@deepseek-ai/dsh`，`0.1.2+`）。装法二选一：

```bash
npm install -g @deepseek-ai/dsh   # 方式 A：全局安装（推荐，需 Node + npm）
npx @deepseek-ai/dsh --version     # 方式 B：npx 拉取（无需全局安装，会进 npx 缓存）
```

壳按以下顺序**定位**已装 dsh（只定位并 spawn，不安装、不更新）：

1. `~/.dsh/desktop-runtime/...`、`~/.dsh/profiles/web/...`（旧版桌面客户端 / 手动装进 profile）
2. npx 缓存（`%LOCALAPPDATA%\npm-cache\_npx\...`）
3. 全局 npm 前缀（`npm root -g` 下）
4. PATH 上的 `dsh` / `dsh.cmd`

新用户最简路径：**安装 Node.js → `npm i -g @deepseek-ai/dsh` → 双击安装包**。

## 🚀 使用

```bash
npm install   # 安装 Electron（.npmrc 已配 npmmirror 镜像）
npm start     # 启动客户端
npm run smoke # 冒烟模式：加载后打印 SMOKE_OK 退出
npm run dist  # 打包（NSIS 安装版 + 免安装版）
```

## 🎯 能力

- 原生无边框窗口 + 独立 `WebContentsView` 加载 `dsh web`（sandbox 隔离、零 preload、外链转系统浏览器）
- 系统托盘（状态点 + 双击唤起 / 隐藏到托盘 / 退出清理进程树）
- 服务生命周期：spawn / restart / 崩溃指数退避自动重启（最多 5 次）
- dsh 0.1.2+ 兼容：解析带 `?token=` 的就绪地址并加载（不会丢 token 导致 401）
- 应用菜单 / 右键菜单 / 页内查找（Ctrl+F）/ 网页截图（Ctrl+Shift+S）
- 窗口位置与页面缩放记忆
- 中英双语跟随主程序语言偏好

## 🔌 与插件的关系

壳**完全不依赖也不安装**任何插件（dshmarket、dsh-startup-guard、dsh-notify 等首启安装与壳内耦合均已移除）。通知改为 Electron 原生通知，崩溃重启改为壳自身逻辑。

## 📄 许可

MIT