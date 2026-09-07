# Changelog

本应用的版本历史。语义化版本（[SemVer](https://semver.org/lang/zh-CN/)）。

## [2.0.0] - 2026-09-07

**轻量重写**：从"托管运行时 + 精选插件"的完整客户端，重构为只依赖**已安装 dsh** 的纯壳。保留原生窗口 + 托盘、应用菜单、右键菜单、页内查找、网页截图、窗口位置与缩放记忆、崩溃退避重启与中英双语。

### Changed

- 适配 dsh 0.1.2：重写 `parseDshWebUrl`，捕获完整的带 `?token=` 认证就绪地址并加载（旧实现只抠端口、丢 token，会在 0.1.2 下加载裸 `/` 被 401）；标题栏只展示 `host:port`，不泄露 token
- dsh 定位扩展：新增全局 `npm install -g` 前缀（`npm root -g`）与 PATH 上 `dsh`/`dsh.cmd` 的定位，npx 缓存改遵 `LOCALAPPDATA`；新用户只需 `npm i -g @deepseek-ai/dsh` 即可被壳找到
- 打包瘦身：移除 `extraResources`/`asarUnpack`/`afterPack`，`build.files` 收敛到 `main.js`/`preload.js`/`lib`/`assets`/`ui`/`package.json`

### Removed

- 去除托管运行时：删除 `~/.dsh/desktop-runtime` 自动安装/更新/回滚、内置 npm（`resources/npm`）、runtime seed（`resources/runtime`）、pnpm 自举（`ensurePnpm`）；壳改为仅从 desktop-runtime / profile `node_modules` / npx 缓存 / 全局前缀**定位并 spawn** 已装 dsh
- 去除自带插件依赖：删除 `curated.json` 首启安装（dshmarket bootstrap + market API + 直装回退）、`dsh-startup-guard` 集成（`runGuardOutOfProcess` + `guard-runner.mjs` + crash/boot 标记）、`dsh-notify` 集成（protocol / `notify.ps1`/`activate.ps1` / `/dsh-notify/foreground` 上报 / `dsh-notify.json` 读取）；通知改用 Electron 原生通知，崩溃重启改为壳自身退避逻辑
- 删除仪表盘、自更新（`make-release.mjs` / `dsh-update.json` / `update-url.json`）、诊断导出、开机自启、全局热键、UI polish 注入、离屏预览

### Fixed

- 修复启动即空白（"app 打不开"）：`startServer()` 是异步却在 `app.whenReady` 中漏掉 `await`，导致 dsh 就绪前就调用 `loadURL`、网页视图从未加载；改为 `await startServer()` 并固化崩溃重启后以新 token 重载视图

## [1.0.8] - 2026-09-03

- 修复：精选插件首启自动安装与手动 `dsh plugin add` 在全新（无 Node）机器上全部失败——dsh 运行时的 `plugin add` 是 pnpm 转发器（`spawnSync("pnpm", ...)`），而安装包只内置 npm、未内置 pnpm，普通用户机器既无 pnpm 也无 Node，导致 dshmarket bootstrap 与其余精选插件全部秒退（exit 127 `pnpm not found`）、且每次启动静默重试
  - 首启 `ensurePnpm()`：用内置 npm（Electron-as-Node）+ 同一镜像链（`DSH_NPM_REGISTRY` > `settings.npmRegistry` > 中文默认 npmmirror）把独立版 `@pnpm/exe`（内嵌 Node、无需系统 Node）装进 `~/.dsh/pnpm`，再把其目录前置进 `process.env.PATH`——首启自动装、market 内部 pnpm、以及凡经 App 拉起的 `dsh plugin add` 均能找到 pnpm
  - 镜像下放：镜像链结果写入 `process.env.npm_config_registry`，pnpm 与 market 内部安装同样走镜像，不再回落到官方源
  - 精选插件直装加 10 分钟超时并杀进程树（不再因网络卡死无限阻塞启动）；stderr 尾部记入 desktop.log，可见 `pnpm not found` 等真实原因，而非一句 `exit 127`
  - 精选插件自动装失败时弹一次通知，不再完全静默

## [1.0.7] - 2026-09-03

- 修复：全新机器首次运行即报「dsh bin not found」且无法恢复——首启自动安装 dsh 运行时打官方 registry，在慢速/受限网络（如国内直连）下 tarball 下载卡死，npm 超时被杀，安装失败；随后真实原因又被误导性的 `dsh bin not found` 覆盖，「重试」又只重启服务、从不重装运行时，用户永久卡在错误页
  - 首启自动安装与仪表盘更新/回滚统一走同一 registry 解析（此前镜像开关只对仪表盘生效）：中文用户未显式配置时默认使用 `https://registry.npmmirror.com`；优先级不变：环境变量 `DSH_NPM_REGISTRY` > 设置 `npmRegistry`（仪表盘可改，空 = 官方源）> 中文默认镜像 / 其他地区官方源
  - **首装预置锁文件**：实测发现 npm 11 对 dsh 这套约 500 包、peer 依赖密集的依赖树做无锁全量解析会 CPU 忙循环 10 分钟以上（远超安装超时，与网络无关）。客户端随包分发已知良好的 `package.json + package-lock.json`（resources/runtime，512 包锁定 0.1.1-rc.2），首次安装自动播种并走 `npm ci`：镜像实测 **26 秒**装完
  - **安装跳过 lifecycle 脚本**（`--ignore-scripts`）：koffi / node-pty 等原生包的 postinstall 会调用裸 `node`，而无 Node 环境的小白机器上（应用以 Electron-as-Node 驱动 npm）这一步必然失败——实测二者均随包携带平台预编译产物，跳过脚本后加载正常、dsh 服务可正常启动
  - 首装 npm 显式限制 fetch 超时（120s × 重试 1 次），断网/被墙时几分钟内即报 npm 真实错误，不再 10 分钟干等后超时；安装整体超时放宽到 20 分钟（正常镜像+锁约 1 分钟内）
  - 安装失败保留真实原因（超时 / npm-cli 缺失 / npm 退出码 + stderr 尾部）上屏，不再被 `dsh bin not found` 覆盖
  - 「重试」与「启动服务」在 bin 缺失时先重新安装 dsh 运行时再启动，失败可一键重装恢复
  - 已知限制：仪表盘「更新/回滚」到锁文件之外的新版本（dsh 全家桶随 rc 同步升版）仍会触发 npm 全量解析，可能耗时较长——有进度条与 15 分钟超时兜底，属后续优化项
- 修复：dsh 版本枚举（「最新」/「版本列表」）硬编码官方 registry、忽略 npm 镜像开关——镜像用户拉取 `@deepseek-ai/dsh` metadata 仍直连 registry.npmjs.org，超时/被墙后最新版为 null、版本列表为空、更新/回滚入口消失。现将 registry 解析统一到同一覆盖链（环境变量 > settings.npmRegistry > 中文默认 npmmirror），metadata 拉取与 `npm install` 共用镜像，随仪表盘镜像开关即时切换
- 摆脱 curl.exe 依赖：dsh metadata、应用更新 manifest 检查、安装包下载全部改用 Node 内置 http/https（支持代理 env、超时、重定向、非 2xx 拒绝），curl 缺失或被墙不再导致版本列表空、最新版 null、下载失败
- 应用自更新加固：`installUpdate` 先退出应用（复用 `wantQuit` + 单实例锁生命周期，避免运行中 exe 被占、不产生僵尸/双实例）再以 `/S` 静默运行 NSIS 安装器并在装完后自动重启到新版本；下载完成后按 manifest 的 `sha512`+`size` 校验完整性（`make-release.mjs` 现写入这两个字段，篡改/损坏的安装包会被拒绝并删除）
- dsh 更新/回滚固定 `--cache` + `--prefer-offline` 并对齐 fetch 超时（120s × 1），二次更新/回滚复用已缓存 tarball、不再每次全量解析；成功后持久化 `package-lock.json`，后续重装/回滚走 `npm ci` 快路径
- 首装实时进度：全新机器首次安装 dsh 运行时同样解析 npm http 日志并经状态通道推送 `dshInstallProgress`（与仪表盘「更新/回滚」同一进度通道），不再只有静态 spinner
- 修复（reviewer low 项 1–3，本版一并解决）：
  - `checkForUpdate` 在 manifest 拉取失败（断网/超时/非 2xx）或解析非法时，状态记为真实错误并通知用户，不再误报为「已是当前版本」
  - 版本枚举 `latestDshVersion`/`listDshVersions` 拉取失败时写诊断日志（desktop.log）；仪表盘版本下拉在列表为空时回退显示当前版本，不再完全静默
  - `resolveProxy` 把显式指定的 `DSH_UPDATE_PROXY` 优先级提到环境代理 `https_proxy`/`http_proxy` 之前，专用代理优先
- 已知限制（reviewer low 项 4，留待后续）：`ConnectProxyAgent` 仅支持 http(s) 代理的 CONNECT 隧道，`https://` 形式的代理地址暂不支持

## [1.0.6] - 2026-08-22

- 新增：仪表盘「npm 镜像」开关——官方 registry 在部分网络（如国内直连）下 tarball 下载极慢导致 dsh 更新 600s 超时，现可在 dsh Version 卡片开启镜像并填写地址（默认建议 https://registry.npmmirror.com），更新/回滚时自动附加 `--registry=`。同时支持环境变量 `DSH_NPM_REGISTRY` 与 settings.json 的 `npmRegistry`，优先级：环境变量 > 设置 > 官方源

## [1.0.5] - 2026-08-22

- 新增：仪表盘「更新 / 回滚 dsh」实时进度条——安装时以 `--loglevel=http` 运行 npm，逐行解析输出（已下载包数 / reify / 完成 / 错误），经状态通道 150ms 节流推送，进度条在下载阶段流动动画、安装阶段定格 85%、成功 100%、失败归零

## [1.0.4] - 2026-08-21

- 修复：仪表盘「更新 / 回滚」再次失败——客户端自带 npm 被打包时被 electron-builder 默认过滤器（`!**/node_modules/**`）剥掉了 `node_modules`，npm 一启动就报 `MODULE_NOT_FOUND: graceful-fs`（退出码 7），更新/回滚在真正下载前就失败。`extraResources` 的 `resources/npm` 拷贝现在显式包含全部文件（filter: **/*），自带 npm 恢复完整依赖
- 加固：`core.resolveNpmCli()` 只有在自带 npm 的 `node_modules/graceful-fs` 存在（即依赖确实进了包）时才选用它；被打包剥空的 npm 会自动跳过、回退系统 npm，旧安装包也能正常更新

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
