# DeepSeek Harness Desktop

简体中文 | [English](README.en.md)

![version](https://img.shields.io/badge/version-1.0.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![electron](https://img.shields.io/badge/electron-37-47848F)

原生桌面客户端（Electron 壳）——把 `dsh web` 装进独立窗口 + 系统托盘，开箱即用。

## ✨ 特性

- 🪟 **原生桌面体验**：无边框窗口 + 自绘标题栏，独立 `WebContentsView` 加载 `dsh web`（sandbox 隔离）；系统托盘 + 全局 `Ctrl+Alt+H` 随时唤起，点 × 隐藏后台运行
- 🛡️ **稳定可靠**：spawn 前运行 [dsh-startup-guard](https://github.com/aokamoaki/dsh-startup-guard) 体检；attach 已运行实例防双写 `~/.dsh`；崩溃指数退避自动重启并通知
- 📊 **一站式仪表盘**：服务状态 / 启动体检 / dsh 版本更新·回滚 / 应用更新 / 开机自启 / 一键诊断导出
- 🔔 **通知闭环**：`dsh-notify://` 协议唤起窗口；对话通知仅后台触发（ask/approval 始终提醒）
- 🚀 **自更新**：manifest 内置、启动后台检查（`settings.json` 可覆盖 updateUrl）
- 📦 **开箱即用**：精选插件首启安装一次（缺失安全）；中英双语跟随主程序，数据完全复用 `%USERPROFILE%\.dsh`，既有插件、凭据、会话零迁移

## 🚀 使用

```bash
npm install            # 安装 Electron（.npmrc 已配 npmmirror 镜像）
npm run provision:npm  # 首次构建前：生成随包分发的离线 npm（resources/npm，已 gitignore）
npm start              # 启动客户端
npm run smoke          # 冒烟模式：attach 后打印 SMOKE_OK 退出
npm run dist           # 打包（NSIS 安装版 + 免安装版）
```

## 🏗️ 结构

```
main.js / preload.js / lib/core.js（纯逻辑，可单测）/ ui/ / notifier/ / curated.json / guard-runner.mjs
```

测试：`npm test`（`lib/core` 单元测试）；UI 自检：`npx electron preview.js` 离屏截图；打包验证：`dist\win-unpacked\dsh-desktop-app.exe --smoke`。

## 📦 发布

```bash
npm run provision:npm && npm run dist   # 1. 构建安装包
node make-release.mjs --repo=aokamoaki/dsh-desktop-app --version=x.y.z  # 2. 生成发布 manifest（dsh-update.json + update-url.json；省略 --version= 则读 package.json）
gh release create vx.y.z dist\DeepSeek-Harness-Setup-x.y.z.exe dsh-update.json  # 3. 上传 Release
npm run dist                            # 4. 重新打包（把更新地址打进应用）→ 分发
```

> `--repo` 必须是真实仓库，否则内置更新地址 404；未签名的安装包在其他机器上会触发 SmartScreen「未知发布者」提示（功能不受影响，正式分发建议购买代码签名证书）。

## 🔌 与插件的关系

壳本身**不依赖任何精选插件**，所有集成点缺失安全：`dsh-startup-guard`（启动体检）、`dsh-notify`（通知/前台状态）卸载后客户端照常运行。精选清单（`curated.json`，仅首启安装一次）：dshmarket、dsh-token-usage、@anionex/dsh-vision-toolkit、dsh-file-upload、dsh-startup-guard。配套插件 **dsh-desktop-launch** 提供 `desktop_launch` 工具，可在对话中直接拉起桌面客户端。

## 📄 许可

MIT
