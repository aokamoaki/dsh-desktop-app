# Changelog

本应用的版本历史。语义化版本（[SemVer](https://semver.org/lang/zh-CN/)）。发布流程见 README「发布流程」：每个发布版本由 `make-release.mjs` 生成 `dsh-update.json` 并随 GitHub Release 上传。

## [1.0.3] - 2026-08-20

- 修复：新版 dsh 运行时（`dsh --profile web`）启动时会自动调用默认浏览器打开网页，导致桌面客户端每次启动都弹浏览器。现在壳内嵌视图渲染 UI，启动时不再弹出浏览器；托盘/菜单「浏览器打开」仍是显式出口
- 兼容旧版 dsh：`--no-open` 仅在运行时支持时传入（探测已安装 `dsh-web-app` 的 startup.js），旧运行时不会被未知参数拒绝
- 修复：仪表盘「更新 / 回滚」失效——dsh 只发布预发布版本（`0.1.0-rc.x`），但 IPC 层校验 `/^\d+\.\d+\.\d+$/` 拒绝所有带 `-rc` 后缀的版本，下拉框里每个可选版本都会被拦截。版本校验统一收敛到 `core.isValidDshVersion()`（IPC 层与 `updateDsh` 共用），`0.1.0-rc.8` 等预发布版本现在可正常更新/回滚

## [1.0.2] - 2026-08-16

- 精选插件清单加入 **dsh-chat-timeline**（DeepSeek 网页版右侧对话导航栏 1:1 移植）
- 修复：自更新下载自动使用代理（`https_proxy`/`http_proxy`/`DSH_UPDATE_PROXY`）—— 直连 GitHub 超时导致「下载并安装」失效；超时提到 900s
- 修复：「下载并安装」按钮点击即时反馈（禁用 + 「正在下载...」标签 + 消息），不再无响应感

## [1.0.1] - 2026-08-16

- 精选插件清单加入 **dsh-notify**（通知/前台状态），首启安装一次
- 修复：壳前台上报覆盖最小化/隐藏/恢复（`browser-window-minimize/restore/show` + `hideToTray` 重报，`anyWindowFocused` 排除不可见窗口）—— 最小化后不再吞掉"完成"通知

## [1.0.0] - 2026-08-16

**首次公开发布**。桌面壳达到正式发布标准：原生窗口 + 托盘、服务生命周期管理、启动前守卫、通知闭环、自更新、仪表盘、双语，S0–S4 路线图全部落地。

### Added / Changed（相对 0.1.x 的正式发布整理）

- 原生无边框窗口 + 独立 WebContentsView 加载 `dsh web`（sandbox 隔离、零 preload、外链转系统浏览器）
- 系统托盘（状态图标随系统主题）、窗口 × 隐藏到托盘、托盘退出清理进程树
- 服务生命周期：attach 已运行实例（防双写）、端口自动回退、崩溃指数退避重启（最多 5 次）+ 自愈通知
- 启动前守卫（dsh-startup-guard 核心）+ 体检结果上屏（splash / 仪表盘）
- 通知闭环（`dsh-notify://` 协议唤起窗口）+ 仅后台触发规则 + 壳侧窗口焦点上报 `/dsh-notify/foreground`
- 应用自更新（内置 manifest URL，启动后台检查 + 手动检查）
- 仪表盘：服务状态 / 启动体检 / dsh 版本锁定·更新·回滚 / 应用更新 / 开机自启 / 一键诊断导出
- 中英双语跟随主程序语言偏好；仪表盘视觉与主界面同源（真实设计 token）
- 精选插件首启安装（仅一次，`curated.json`）；对精选插件完全缺失安全
- 快捷键（含全局 `Ctrl+Alt+H`）、离屏视觉预览、日志轮转
- 修复：服务通知默认 `always=false` + `anyWindowFocused()` 判定（仅后台触发）；崩溃时写 `dsh-crash-state.json`、正常退出清除 `dsh-boot-state.json`（与 dsh-startup-guard 崩溃隔离协同）

## [0.1.x] - 2026-08-14 ~ 2026-08-16（内部预发布）

- 0.1.11：崩溃标记 / boot 标记协同、服务通知后台触发修正、仪表盘细节
- 0.1.8：内置 npm 资源、NSIS/portable 分发、发布流程（make-release.mjs）
- 0.1.7：自更新 manifest 初版（dsh-update.json）
- 0.1.3：窗口 / 托盘 / 单实例 / spawn-attach / 启动前守卫 / 崩溃自愈 / 精选插件首启骨架
