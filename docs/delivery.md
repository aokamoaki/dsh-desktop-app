# 交付说明：1.0.7 安装 / 运行时更新 / 应用自更新

> 面向发布与运维的收口文档。实现细节与代码位置见
> [`update-root-cause.md`](update-root-cause.md)（根因与修复点）。

## 1. 版本锁定

| 文件 | 字段 | 值 |
| --- | --- | --- |
| `package.json` | `version` | `1.0.7` |
| `dsh-update.json` | `version` | `1.0.7` |
| `update-url.json` | `url` | `.../releases/latest/download/dsh-update.json`（无版本号，恒指向 latest） |

本版本**不 bump**。`dsh-update.json` 与 `update-url.json` 由
`make-release.mjs` 在每次发布时重新生成，属于 `.gitignore` 忽略的产物，不进库。

## 2. dsh 运行时首次安装

- 全新机器首次启动时，`main.js` 检查 `~/.dsh/desktop-runtime` 下的 dsh 运行时可执行文件。
- 安装走 npm，命令为固定 `install`/`ci` + 硬编码参数（`--ignore-scripts`、
  `--no-audit`、`--no-fund`、`--loglevel=http`、`--fetch-timeout=120000`、
  `--fetch-retries=1`、`--cache .../npm-cache`、`--prefer-offline`），**不拼接任何
  用户可控的 shell 命令**。
- 首装使用种子锁 `resources/runtime/package.json` + `package-lock.json`（**已入库**，
  `.gitignore` 只忽略 `resources/npm/`）走 `npm ci` 快路径，约 30s；缺失才退化为
  全量解析。`resources/npm/` 是随包离线缓存，构建前由 `npm run provision:npm` 生成。
- 首装期间依赖仍不可用，通过 npm `--loglevel=http` 逐行解析下载进度，经状态通道
  广播 `dshInstallProgress`（与仪表盘更新/回滚同一通道），以真实原因上屏错误，
  失败后 Splash「重试」真正重投安装，而非锁死静态 spinner。

## 3. dsh 运行时更新 / 回滚

- npm 镜像优先级（更新/回滚与版本枚举共用）：环境变量 `DSH_NPM_REGISTRY` >
  设置 `settings.npmRegistry`（仪表盘「npm 镜像」开关）> 中文环境默认
  `https://registry.npmmirror.com` > `https://registry.npmjs.org`。
- 版本枚举 `latestDshVersion` / `listDshVersions` 与 `update`/`rollback` 都通过
  `core.registryMetadataUrl(...)` 拿 metadata，并显式 `--registry=` 传给 npm，
  无硬编码官方源；镜像用户在界面上能正确看到 latest 与版本下拉。
- 更新/回滚固定 `--cache` + `--prefer-offline` + `--fetch-timeout=120000` +
  `--fetch-retries=1`；成功后持久化 `package-lock.json`，后续重装/回滚走 `npm ci`
  快路径，二次操作复用已缓存 tarball、不再每次全量解析。
- 版本标签经白名单正则 `^[0-9][A-Za-z0-9._~+-]*$` 校验后才拼进 npm 包说明符。

## 4. 应用自更新

- **后台检查策略**：启动时静默 `checkForUpdate(false)` 拉取
  `update-url.json` → `dsh-update.json`；仅在发现新版本时通知（**不自动下载、
  不自动安装**），托盘/状态栏不打扰。下载与安装都是用户显式触发。
- **手动下载并安装**：仪表盘「Desktop App → 检查更新」看到新版本后点「下载并安装」。
  下载用 `core.downloadTo`（Node 内置 http/https，支持代理 env、超时、重定向、
  非 2xx），**不依赖 curl.exe**；下载完成后先按 manifest 的 `size`（字节数）再按
  `sha512`（base64）流式校验，任一不符即删除安装包并返回真实错误，绝不安装。
  `make-release.mjs` 从 `dist/*Setup-*.exe` 计算并写入这两个字段。
- **安装编排**：安装器以 `core.silentInstallArgs()` = `['/S']` 静默运行。为避免运行中
  exe 被占用导致安装失败，流程是「下载校验 → 置 `pendingInstallExe` + `wantQuit` →
  `app.quit()` → `will-quit` 先停服务、卸载全局快捷键 → 以
  `spawn(..., {detached:true, stdio:'ignore', windowsHide:true}).unref()` 启动安装器」。
  NSIS 静默安装完成后由 electron-builder 的 `runAfterFinish` 自动重启到新版本，
  全程不产生第二实例，也不留僵尸进程。
- **SmartScreen 未签名提示**：安装包未做代码签名，在其他机器上首次运行时 Windows
  SmartScreen 会提示「Windows 已保护你的电脑 / 未知发布者」。点「更多信息 → 仍要运行」
  即可继续，功能不受影响；正式公开分发建议购买代码签名证书消除该提示。

## 5. npm 镜像设置

三种方式，优先级从高到低：

1. 环境变量：`DSH_NPM_REGISTRY=https://registry.npmmirror.com`（对 dsh 运行时
   安装/更新/回滚与版本枚举均生效）。
2. 设置项：`settings.npmRegistry` —— 仪表盘「dsh Version」卡片的「npm 镜像」开关，
   填镜像地址（如 `https://registry.npmmirror.com`）。
3. 默认：中文环境（`zh-CN`）回落到 `https://registry.npmmirror.com`，否则
   `https://registry.npmjs.org`。

> 应用自更新 manifest 走 `update-url.json` 里的固定 URL（GitHub Release），与上面的
> npm 镜像无关。

## 6. 升级后自证方法

代码与纯逻辑自证（无需网络/应用）：

```bash
node --check lib/core.js
node --check main.js
# 本沙箱内用进程内模式规避 node:test 子进程隔离限制；无沙箱本机直接 node --test：
node --test --test-isolation=none test/core.test.js   # 期望 65 通过
```

运行态自证：

- dsh 运行时版本枚举：仪表盘「dsh Version」下拉应出现 remote 列表与 latest（镜像设置
  生效时不再是空列表/`null`）。
- dsh 运行时更新/回滚：点「更新」/回滚，观察进度条推进、结束后版本变化；断开重连后
  再次操作应命中 `npm ci` 快路径（明显变快）。
- 应用自更新：`make-release.mjs` 重新生成 manifest（含 `sha512`+`size`）并上传
  Release 后，点「检查更新」应看到新版本；「下载并安装」应静默安装并重启到新版本；
  故意改坏 manifest 的 `sha512` 字段则应看到校验失败、不会安装。

## 7. 已知限制 / 后续优化

代码审查记录的 **low 级非阻塞** 改进项中，1–3 已在本轮修复（见 CHANGELOG
`[1.0.7]`）：`checkForUpdate` 拉取失败改为报真实错误、版本枚举断网写诊断日志、
`DSH_UPDATE_PROXY` 优先级提前。以下 1 项仍留待后续：

1. `ConnectProxyAgent` 仅支持 http(s) 代理的 CONNECT 隧道，不支持 `https://` 形式的
   代理地址（低优先级，影响面小——绝大多数代理为 http 明文端口，属后续优化）。

## 8. Git 交付准备（待确认后执行）

分支 `main`。`.gitignore` 已确认忽略：`node_modules/`、`dist/`、`dist-v2/`、
`resources/npm/`、`dsh-update.json`、`update-url.json` 与日志/临时文件；
`resources/runtime/`（首装种子锁）**不在**忽略范围、必须入库。

建议按语义分为 3 个提交（Conventional Commits，英文小写祈使句，与仓库历史一致）：

```bash
# 1) 实现：运行时安装/更新 + 应用自更新加固（含单测）
git add dsh-desktop-app/main.js dsh-desktop-app/lib/core.js dsh-desktop-app/preview-preload.js dsh-desktop-app/ui/dashboard.js dsh-desktop-app/make-release.mjs dsh-desktop-app/package.json dsh-desktop-app/test/core.test.js
git commit -m "fix: harden dsh runtime install/update and app self-update (registry mirror, curl-free metadata, sha512 verify, silent /S install)"

# 2) 文档：README / CHANGELOG / docs
git add dsh-desktop-app/README.md dsh-desktop-app/CHANGELOG.md dsh-desktop-app/docs/
git commit -m "docs: document install/self-update flows, release runbook, and delivery notes"

# 3) 首装种子锁：resources/runtime 入库
git add dsh-desktop-app/resources/runtime/
git commit -m "chore: add first-install runtime seed manifest for npm ci fast path"
```

推送（**执行前须向队长/用户确认**）：

```bash
git push origin main
```

提交前自检：`git status --short` 应只列出上述要提交的文件（`dsh-update.json` 与
`update-url.json` 不应出现，二者被忽略；无凭据/密钥/私钥等敏感文件）。

## 9. 精选插件安装与 pnpm 供给

精选插件（`curated.json`）**不是**随包绑定的，而是首启联网现装：Phase 1 直装
`dshmarket`（bootstrap），Phase 2 经 market API（dshmarket 的 `/dsh-market/install`）
装其余插件，失败回退直装。两者最终都落到 `dsh plugin add`，而它在 dsh 运行时里是
**pnpm 转发器**（`spawnSync("pnpm", ...)`）。

- 全新（无 Node）机器既无 pnpm 也无可安装 pnpm 的环境，所有插件安装秒退 `127`
  （`pnpm not found on PATH`）且静默重试——即「别人下载后插件不装」的根因。
- **修复**（`main.js`）：启动时 `ensurePnpm()` 用内置 npm + 镜像链把独立版
  `@pnpm/exe`（内嵌 Node）装进 `~/.dsh/pnpm`，前置其目录到 `process.env.PATH`，并把
  镜像写入 `process.env.npm_config_registry`；`dsh` server 进程与市场内 pnpm 一并继承。
- 直装加 10 分钟超时（杀进程树），失败写 desktop.log 尾部并弹一次通知；
  `curatedDone` 仅在全部成功时置位（否则下次启动重试）。

> 尚待处理：`curated.json` 里 `dsh-notify` / `dsh-token-usage` /
> `dsh-chat-timeline` 为 `github:` spec（需 git + 直连 GitHub），无 git / 无法直连
> GitHub 的环境仍会失败；后续可改走 gh 代理或 npm 发布版。