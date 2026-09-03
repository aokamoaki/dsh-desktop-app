# DeepSeek Harness Desktop

简体中文 | [English](README.en.md)

![version](https://img.shields.io/badge/version-1.0.8-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![electron](https://img.shields.io/badge/electron-37-47848F)

原生桌面客户端（Electron 壳）——把 `dsh web` 装进独立窗口 + 系统托盘，开箱即用。

## 🚀 使用

```bash
npm install            # 安装 Electron（.npmrc 已配 npmmirror 镜像）
npm run provision:npm  # 首次构建前：生成随包分发的离线 npm（resources/npm，已 gitignore）
npm start              # 启动客户端
npm run smoke          # 冒烟模式：attach 后打印 SMOKE_OK 退出
npm run dist           # 打包（NSIS 安装版 + 免安装版）
```

## 🔌 与插件的关系

壳本身**不依赖任何精选插件**，所有集成点缺失安全：`dsh-startup-guard`（启动体检）、`dsh-notify`（通知/前台状态）卸载后客户端照常运行。精选清单（`curated.json`，仅首启安装一次）：dshmarket、dsh-token-usage、@anionex/dsh-vision-toolkit、dsh-file-upload、dsh-startup-guard、dsh-notify、dsh-chat-timeline。配套插件 **dsh-desktop-launch** 提供 `desktop_launch` 工具，可在对话中直接拉起桌面客户端。

## 📄 许可

MIT