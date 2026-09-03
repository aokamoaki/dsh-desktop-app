# dsh 桌面端 安装 / 自更新 根因分析报告

- 目标版本基线：仓库 HEAD = `1.0.6`（commit `fb26e37`）；工作树已有未提交的 `1.0.7` 运行时安装/更新修复（`main.js` / `package.json` / `CHANGELOG.md` 已改），`resources/runtime`（首装种子锁）尚未入库。
- 本报告覆盖两条更新路径：
  1. **dsh 运行时首次安装 + 更新/回滚**（`main.js:376-516`、`main.js:461-475`、`lib/core.js:57-107`）
  2. **应用自更新**（`main.js:1286-1362`）及其发布联动（`make-release.mjs`、`update-url.json`、`dsh-update.json`、`dist/latest.yml`）
- 禁止修改范围：本报告只取证，不改 `dist/`、`node_modules/`、`resources/`。
- 每条根因格式：**现象 / 证据(file:line) / 根因 / 最小修复**。

---

## 0. 结论摘要

| 优先级 | 结论 |
| --- | --- |
| P1 首次安装 | 1.0.7 工作树已把“全新机器装不上”的主根因修掉（registry 统一、种子锁 + `npm ci`、`--ignore-scripts`、fetch 超时、真实错误上屏、Retry 真重装）。**剩余缺口**：(d) 首装无 onLine 实时进度；**发布阻断项**：`resources/runtime`（种子锁）未入库、`resources/npm` 需在打包前 `npm run provision:npm` 生成。 |
| P2 运行时更新 | **(a) 确认 BUG**：`latestDshVersion`/`listDshVersions` 硬编码 `https://registry.npmjs.org`，忽略 `npmRegistryOverride()`——镜像用户版本列表/最新版仍走官方源，可能失败/超时。**(b) 确认脆弱性**：两者及应用自更新依赖 `curl.exe`（`main.js:347`），缺失/被墙时版本列表空、最新版 null。**(c) 确认已知限制**：更新/回滚到锁外版本触发 npm 全量解析。 |
| P3 应用自更新 | **(f) 确认多个 BUG**：`installUpdate` 无 `/S`、未先退出 App、运行中 exe 被锁装不上；`downloadUpdate`/`checkForUpdate` 依赖 `curl.exe`；`dsh-update.json` 无 `sha512`/`size`；`dist/latest.yml` 已生成但未使用；后台检查仅通知不下载。 |
| 方案选型 | **推荐采用 electron-updater**（理由/风险/落地见 §7）；后台自动安装策略见 §8。 |

---

## 1. P1 — dsh 运行时首次安装链路（新机器：无 Node / 无 npm / 慢网 / 国内直连）

### 1.1 已修复项（1.0.7 工作树，需随版本一起入库并打包，勿回退）

| # | 现象 | 证据 | 根因 | 现状 |
| --- | --- | --- | --- | --- |
| 1.1a | 首启打官方源，慢网卡死 | `main.js:382-385`（注释）、`main.js:405-408`、`main.js:530-538` | 安装用 registry 与仪表盘更新/回滚不一致；官方 tarball 在国内直连极慢 | ✅ 已统一走 `npmRegistryOverride()`（env > settings > zh 默认 npmmirror） |
| 1.1b | npm 11 无锁全量解析 10+ 分钟 | `main.js:386-400`（种子播种）、`main.js:414-419`（`npm ci`） | 约 500 包 peer 密集树全量解析 CPU 忙循环 | ✅ 从 `resources/runtime` 播种子 `package.json + package-lock.json`，锁内走 `npm ci`（实测 ~30s） |
| 1.1c | 原生包 postinstall 调裸 `node` 失败 | `main.js:401-405` | 无 Node 机器上裸 `node` 不存在 | ✅ `--ignore-scripts`（koffi/node-pty 随包带预编译产物） |
| 1.1d | 失败真实原因被 `bin not found` 覆盖 | `main.js:426-435`、`main.js:444-451`、`main.js:566-576` | 旧版只报 `bin not found` | ✅ `ensureRuntimeDsh` 返回真实原因（npm-cli 缺失 / 超时 / 退出码+stderr 尾部），`spawnServer` 仅在无更具体错误时才回退泛化文案 |
| 1.1e | Retry 从不重装运行时 | `main.js:706-720`（`restartServer` 先 `ensureRuntimeReady`）、`main.js:1423-1428`（`server:start` 先 `startServerSafely`）、`ui/index.html:150` + `ui/app.js:103`（Retry → `restart`） | 旧版 Retry 只重启服务 | ✅ Retry 与「启动服务」在 bin 缺失时先重装再启动 |

### 1.2 剩余缺口（新修复需叠加）

**1.2a 首装无实时进度（疑点 d）**

- 现象：`ensureRuntimeDsh` 调用 `runNpmAsync` 没有传 `onLine`，首装（尤其首次大安装 30s~数分钟）只有静态 spinner，没有已下载包数/阶段反馈；对比 `updateDsh` 有实时进度条。
- 证据：`main.js:423`（`const r = await runNpmAsync(npmArgs, 1200000);`，无第三参数）；对比 `main.js:510`（`runNpmAsync(npmArgs, 900000, (line) => { core.npmProgressLine(line, acc); push(false); })`）；`main.js:487-496`（updateDsh 的 push）；`main.js:547-552`（`broadcastStatus` 已含 `dshInstall` 字段，splash 也能收到）；`ui/app.js:71-94`（splash 只读 phase，未渲染 `dshInstall`）。
- 根因：首装路径漏传进度回调，splash UI 也未渲染进度。
- 最小修复：
  1. `main.js:423` 改为传 `onLine`：累加 `core.npmProgressLine`，写入 `dshInstallProgress = { phase, fetched, version }` 并 `broadcastStatus()`（节流 150ms，复用 `updateDsh` 的 push 逻辑，抽成共享 helper）。
  2. `ui/app.js` 增加 `renderDshInstall`（从 `s.dshInstall` 渲染进度条/已下载数，样式可复用 dashboard 的 `dshProg` 模式），并在 `ui/index.html` 加入进度条容器。
  3. 安装结束清理 `dshInstallProgress = null` 并再广播一次。

**1.2b 发布阻断：`resources/runtime` 种子未入库**

- 现象：种子锁只有在 `resources/runtime/package.json + package-lock.json` 被打进安装包时，1.1b 的 `npm ci` 快速路径才生效。当前它未入库，`git clone` 后打包会丢失，首装退化为 10+ 分钟全量解析（正好是 1.0.7 要修的问题）。
- 证据：`git status --short` 显示 `?? resources/`（`resources/runtime` 未跟踪）；`.gitignore` 仅忽略 `resources/npm/`（第 4 行），**未**忽略 `resources/runtime/`——说明它本应入库；`package.json:42-51` 的 `extraResources` 把 `resources/runtime` → `runtime` 拷贝进包。
- 根因：种子锁是手工生成的工作树文件，未提交。
- 最小修复：把 `resources/runtime/package.json` 与 `resources/runtime/package-lock.json` 加入 git（注意不属本次“禁止修改 resources/”的研究范围，但要作为发布前提写进任务）；种子内容已锁 `@deepseek-ai/dsh: ^0.1.1-rc.2`（`resources/runtime/package.json:3`）。

**1.2c 发布阻断：`resources/npm` 需在打包前生成**

- 现象：全新机器没有 npm 时，`resolveNpmCli` 依赖打包自带的 `resources/npm`；若不在 `npm run dist` 前运行 `npm run provision:npm`，安装包没有可用 npm，`resolveNpmCli` 返回 null → `runNpmAsync` 报 `npm-cli not found`，首装必失败。
- 证据：`package.json:13`（`provision:npm`）、`package.json:42-46`（`extraResources: resources/npm → npm`）、`lib/core.js:86-107`（`resolveNpmCli` 依次 env → bundled（校验 graceful-fs）→ 系统 npm.cmd → 全局 npm）、`.gitignore:4`、`scripts/afterPack.cjs`（打包后补全 npm 的 node_modules）。
- 根因：npm 是构建期产物，不是源码；发布漏跑 `provision:npm` 就会带病发布。
- 最小修复：发布清单固定化（`npm run provision:npm && npm run dist`），并在 `afterPack.cjs` 已有断言（`graceful-fs` 存在）基础上，可选加运行时首装前对 `resolveNpmCli()===null` 的显式日志。

### 1.3 P1 结论
全新机器首装的可装性**已由 1.0.7 工作树修复**；要把修复真正交付到用户，必须（1）提交 `resources/runtime` 种子、（2）打包前生成 `resources/npm`、（3）补首装实时进度（1.2a）。这三项不落地，P1 仍会复发或体验照旧。

---

## 2. P2 — dsh 运行时更新/回滚链路（`updateDsh`、版本枚举）

### 2.1 疑点 (a) —— 版本枚举硬编码官方 registry（确认 BUG）

- 现象：仪表盘切到镜像（npmmirror）后，`dsh:latest` / `dsh:versions` 仍请求 `registry.npmjs.org`。国内直连该域名在 curl 20s 上限内可能超时/被墙 → `latest = null`、`versions = []`，下拉框只剩当前版本（无法更新/回滚），控制台无任何报错提示。
- 证据：
  - `main.js:461-470`：`latestDshVersion()` → `curlJsonAsync('https://registry.npmjs.org/@deepseek-ai/dsh')`（硬编码于 `main.js:466`）。
  - `main.js:471-475`：`listDshVersions()` → 同样硬编码 `main.js:472`。
  - `main.js:530-538`：`npmRegistryOverride()` 只被 `ensureRuntimeDsh`(`:385`)、`updateDsh`(`:502`) 调用，**未被**两个版本枚举函数调用。
  - `ui/dashboard.js:151-169`：`refreshVersions` 用 `getLatestVersion/getVersions` 结果；`versions` 为空时回退到 `[cur]`（`:159`）——静默降级。
  - `main.js:1540-1547`：启动后一次性“发现新版本”通知同样走 `latestDshVersion()`，镜像用户也受影响。
- 根因：registry 覆盖逻辑只接到 `npm install`，漏接 metadata 枚举。
- 最小修复：
  1. 新增 `function npmRegistryBase() { return (npmRegistryOverride() || 'https://registry.npmjs.org').replace(/\/+$/,''); }`。
  2. `latestDshVersion`/`listDshVersions` 改为 `curlJsonAsync(npmRegistryBase() + '/@deepseek-ai/dsh')`（保留 `Accept: application/vnd.npm.install-v1+json` 头，npmmirror 兼容）。
  3. 单测补 `core` 层：把“构造 metadata URL”抽到 `lib/core.js`（纯函数，可 `node --test`），断言官方/镜像/en 设置三分支。

### 2.2 疑点 (b) —— `curl.exe` 依赖（确认脆弱性）

- 现象：`curl.exe` 缺失或被墙时，版本列表空、最新版 null，用户连更新入口都没有；且 `curlJsonAsync` 没有走 `downloadUpdate` 已实现的代理解析（`https_proxy/http_proxy/DSH_UPDATE_PROXY`）。
- 证据：
  - `main.js:347-358`：`curlJsonAsync` 用 `spawn('curl.exe', ['-sS','-L','--max-time','20',...])`，无代理参数，`proc.on('error')` 与 JSON 解析失败都静默 `resolve(null)`。
  - 对比 `main.js:1330-1337`：`downloadUpdate` 已解析 `https_proxy/HTTPS_PROXY/http_proxy/HTTP_PROXY/DSH_UPDATE_PROXY` 并 `curl -x`。
- 根因：metadata 拉取硬编码系统工具 + 无代理 + 静默失败。
- 最小修复（与 §7 的 curl 替换统一）：
  - 在 `lib/core.js` 提供 `fetchJson(url, { timeout, accept, proxyEnv })` 纯实现（`http`/`https` + 有代理时用 `https-proxy-agent`），复用 `downloadUpdate` 的代理 env 优先级；`main.js` 的 `curlJsonAsync` 改为调用它，失败同样 `resolve(null)` 但写 `log()`。
  - 若引入 electron-updater，其内部 `net` 栈自带 Chrome 代理/系统代理，应用自更新侧不再需要 curl；dsh metadata 侧仍需上述 `fetchJson`。

### 2.3 疑点 (c) —— 锁外版本全量解析（确认已知限制，评估两项优化）

- 现象：仪表盘更新/回滚到种子锁（`0.1.1-rc.2`）之外的版本时，npm 重新全量解析约 500 包树；1.0.7 CHANGELOG 已标注“已知限制”。二次更新/回滚每次都想重解析，慢。
- 证据：
  - `main.js:507-509`：`updateDsh` 用 `npm install @deepseek-ai/dsh@<ver>`（不带 `npm ci`、不带 `--prefer-offline`、不带固定 `--cache`）。
  - `main.js:414-419`：首装 `useCi` 仅当 `ver==='latest'||ver===locked`；一旦 `settings.dshVersion` 被 `updateDsh` 写成新版本（`main.js:513`），后续“运行时目录被清空重装”会走 `npm install @<ver>` 全量解析。
  - `main.js:507`：`updateDsh` 无 `--fetch-timeout/--fetch-retries`，与首装的 `main.js:405`（120s×重试1）不一致，失败反馈更慢。
- 根因：锁只服务于首装，更新/回滚每次都重新解析且 npm 缓存目录不固定。
- 最小修复（评估结论）：
  1. **持久化 package-lock.json + 固定 npm 缓存**：`updateDsh` 与 `ensureRuntimeDsh` 统一加 `--cache <DSH_HOME/npm-cache>`（或 `app.getPath('userData')` 下），并加 `--prefer-offline`；让 npm 复用已下载 tarball。这是**低成本高收益**：二次更新/回滚、以及“清空运行时后重装已装过版本”都走缓存快路径。
  2. 顺手对齐 `--fetch-timeout=120000 --fetch-retries=1`（`main.js:507`），把 net 失败更早暴露给 900s 外层超时。
  3. （可选增强，非本轮必须）为“回滚到种子锁版本”走 `npm ci`：若 `ver === lockedDshVersion()`，直接 `npm ci` 秒级恢复。若做多版本锁存档（per-version lock archive），复杂度上升，建议后续评估。

### 2.4 疑点 (e) —— 首装失败真实错误上屏 / Retry 真重装（已验证：1.0.7 修复完整）

- 结论：**完整**，仅两处可忽略的小瑕疵。
  - 真实错误上屏：`ensureRuntimeReady`（`main.js:444-451`）失败时写入 `lastError = runtimeInstallFailed + r.error`，`statusPayload`（`main.js:1418-1420`）与 `broadcastStatus`（`main.js:547-552`）带 `error`，splash（`ui/app.js:86`）与 dashboard（`ui/dashboard.js:72-87` 走 `s.error`）展示；`spawnServer`（`main.js:566-576`）仅在 `!lastError` 时回退泛化文案。
  - Retry 真重装：splash Retry（`ui/app.js:103`）→ `server:restart`（`main.js:1430`）→ `restartServer`（`main.js:706-720`）内 `ensureRuntimeReady()` 重新走 `ensureRuntimeDsh`；dashboard「启动」→ `server:start`（`main.js:1423-1428`）→ `startServerSafely`（`main.js:454-456`）同样重装。
  - 小瑕疵（非阻断）：① splash 显示会是「错误：dsh 运行时安装失败：npm exit …」双重前缀（`main.js:449` 已带前缀，`ui/app.js:86` 再拼 `U.error:`）；② `restartServer` 在 700ms 延迟里先 `setPhase('stopped')`，splash 会短暂显示字面量 `stopped`（`ui/app.js:92` 兜底分支）。可改为延迟期间仍显 `starting`。

### 2.5 P2 结论
镜像切换后“最新版/版本列表”确实会失败或超时（2.1），curl 依赖放大该问题（2.2）；两者是本轮强必改项。更新/回滚慢是已知限制（2.3），用持久锁 + 固定缓存 + `--prefer-offline` 可低成本缓解。首装错误/重试已修好（2.4）。

---

## 3. P3 — 应用自更新（`main.js:1286-1362`）与发布联动

### 3.1 疑点 (f) —— `installUpdate` 静默安装/退出重装（确认 BUG）

- 现象：点击“下载并安装”后 Download 成功，但安装很可能失败——安装器无 `/S`、主进程未先退出，运行中的 exe 被文件锁占用，NSIS 无法覆盖自身。
- 证据：
  - `main.js:1357-1362`：`installUpdate()` 仅 `spawn(p, [], { detached:true, stdio:'ignore' }).unref()`——**无 `/S`**、**无 `app.quit()`**、**无重启动**、`catch` 静默返回 false。
  - `package.json:60-65`：`nsis.oneClick = false`（非一键安装、可改目录）——非一键 NSIS 与“运行中覆盖自身”冲突更明显。
  - `ui/dashboard.js:284-289`：`downloadUpdate().then(ok => { ...; window.dsh.installUpdate(); setTimeout(=>'install launched',600) })`——不检查 `installUpdate` 返回，600ms 后无条件显示“安装程序已启动”，失败则静默误导。
- 根因：手工流程缺少“静默安装参数 + 退出后再装 + 装完重启动”编排，且失败无反馈。
- 最小修复（若不迁移 electron-updater）：
  1. `installUpdate`：`app.on('before-quit', ...)` 内 `spawn(p, ['/S'], { detached, unref })`；主流程 `wantQuit = true; app.quit()`（`will-quit` 已 `stopServer`，`main.js:1554`），App 退出释放 exe 锁后安装器执行。
  2. 安装器登录项/开机重启：NSIS 装完后重启 App，需在安装器参数传 `--updated` + `/S` 且保持 `app.setLoginItemSettings` 不清；或安装完成后由 NSIS 的 `runAfterFinish` 拉起（electron-builder 默认支持 `--updated` 场景）。至少先实现“退出→静默装”，重启动可由用户/开机自启完成，再补“装完自动拉起”。
  3. `ui/dashboard.js` 检查 `installUpdate()` 返回值，false 时显示失败而非“已启动”。
  4. 明确 oneClick:false 的 admin 风险：若用户装在 Program Files，`/S` 静默升级需要提权，静默失败需上屏（见 §7 风险）。

### 3.2 `downloadUpdate` / `checkForUpdate` 依赖 `curl.exe`（与 2.2 同源）

- 证据：`main.js:1302`（`checkForUpdate` → `curlJsonAsync`）、`main.js:1338`（`downloadUpdate` → `spawn('curl.exe', ...)`）。
- 根因/修复：同 §2.2。`checkForUpdate` 走 manifest URL（非 npm registry），但其 `curlJsonAsync` 无代理；`downloadUpdate` 有代理但依赖 curl 可执行文件。用 `lib/core.js` 的 `fetchJson`/`downloadTo` 替换，并入 §7 决策。

### 3.3 `dsh-update.json` 无完整性信息（确认缺口）

- 现象：`dsh-update.json` 只有 `version` + `url`，下载完成后只判 `code===0 && fs.existsSync(target)`（`main.js:1346`），**不校验 sha512/大小**；交付物可被篡改/损坏而不可知。
- 证据：
  - `dsh-update.json:1-4`：仅版本+url。
  - `make-release.mjs:38-41`：`manifest = { version, url }`，没有读 `dist/latest.yml`。
  - `dist/latest.yml:1-8`：electron-builder **已生成** `sha512` 与 `size`（`DeepSeek-Harness-Setup-1.0.7.exe`，`size: 95853235`），但发布脚本弃之不用。
  - `main.js:1345-1353`：下载成功判定不含校验。
- 根因：发布脚本未把 electron-builder 已产出的完整性信息写进 manifest，客户端也不校验。
- 最小修复：
  1. `make-release.mjs` 读取 `dist/latest.yml`（或直接 `crypto.createHash('sha512')` 对 Setup 计算），把 `{ version, url, sha512, size }` 写进 `dsh-update.json`。
  2. `downloadUpdate` 完成后比对新文件 `size`；再用 `crypto`（Node 内置）流式算 `sha512`（base64）比对，不一致则删除并报错。
  3. 若走 electron-updater，`sha512` 校验由其内置（§7）；`dsh-update.json` 可保留为回退或直接废弃。

### 3.4 `dist/latest.yml` 已生成但未使用 + 发布流程联动

- 现象：electron-builder 已产出标准 electron-updater 元数据（`latest.yml` + blockmap），但发布与客户端都用自研 `dsh-update.json`，未接 electron-updater，重复造轮子且漏了完整性/差分。
- 证据：`dist/latest.yml:1-8` 存在；`make-release.mjs:8-14`、`README.md:36-43`（发布流程）只传 `dsh-update.json`，未上传 `latest.yml`/`.exe.blockmap`。
- 根因：发布流程停留在自研 manifest，未拥抱 electron-builder 产出的标准更新元数据。
- 最小修复（按选型）：
  - 若**加固手工流程**：`make-release.mjs` 把 `sha512`+`size` 落入 `dsh-update.json`（3.3），README 增加“上传前校验 sha512”说明。
  - 若**迁移 electron-updater**：`make-release.mjs`/README 改为上传 `dist/latest.yml` + `dist/*.exe.blockmap`，`update-url.json` 指向 `https://.../latest/download/latest.yml`（electron-updater 会自动找 blockmap），并移除/废弃 `dsh-update.json`。

### 3.5 后台检查仅通知不下载（当前设计，选型后需改）

- 证据：`main.js:1538`：`checkForUpdate(false)`；`main.js:1311-1317`：后台命中只 `notifyService(..., manual=false)`（前台静默），不下不装。
- 结论：这是“低打扰”设计，但对“桌面端无法成功自动更新”的诉求而言，后台只打铃不做事。落地策略见 §8。

### 3.6 P3 结论
应用自更新当前无法可靠“静默自动更新”：安装步骤（/S、退出、锁、重启）没做（3.1）、传输依赖 curl（3.2）、无完整性校验（3.3）、发布元数据未使用（3.4）、后台只通知（3.5）。这五条共同构成“无法成功自动更新 dsh（桌面端）”的 P3 侧根因。

---

## 4. 按优先级排序的根因清单（现象 / 证据 file:line / 根因 / 最小修复）

> 【P】= 优先级；【必改】= 本轮实现任务须落地；【建议】= 可降级。

1. **【P2 必改】(a) 版本枚举硬编码官方 registry** — 现象：镜像用户 latest/列表失败或超时、下拉只剩当前版。证据：`main.js:466`、`main.js:472`（硬编码）vs `main.js:530-538`（`npmRegistryOverride` 未被调用）vs `ui/dashboard.js:159`（静默回退）。根因：registry 覆盖漏接 metadata 枚举。修复：抽 `npmRegistryBase()`，两函数拼接 registry 前缀；抽到 `lib/core.js` 加单测。

2. **【P2 必改】(b) metadata 依赖 `curl.exe` + 无代理 + 静默失败** — 现象：curl 缺失/被墙时最新版 null、版本列表空、无入口。证据：`main.js:347-358`（spawn curl，无 `-x`，全部静默 null）vs `main.js:1330-1337`（已有代理解析）。根因：硬编码外部工具、无代理、静默。修复：`lib/core.js` 加 `fetchJson`（http/https + 代理），取代 `curlJsonAsync`，失败写日志。

3. **【P3 必改】(f) `installUpdate` 无 `/S`、未先退出、无重启** — 现象：安装器静默/半静默无法覆盖运行中 exe，装不上。证据：`main.js:1357-1362`、`package.json:60-65`（oneClick:false）、`ui/dashboard.js:285`（不看返回值）。根因：缺静默+退出+重装编排。修复：退出→`/S` 静默装→拉起重启；UI 检查返回值并上屏失败。

4. **【P3 必改】`dsh-update.json` 无 sha512/size、下载不校验** — 现象：可篡改/损坏无感知。证据：`dsh-update.json:1-4`、`make-release.mjs:38-41`、`main.js:1345-1353`、`dist/latest.yml:3-7`（sha512/size 已被生成但不用）。根因：发布未落完整性、客户端不校验。修复：make-release 写入 sha512/size，downloadUpdate 校验并失败即删。

5. **【P1 必改(发布前提)】`resources/runtime` 种子锁未入库 / `resources/npm` 需生成** — 现象：新 clone 打包丢种子→首装退化为 10min 全量解析；漏 provision:npm→首装必失败。证据：`git status`（`?? resources/`）、`.gitignore:4`（只忽略 npm）、`package.json:13/42-51`、`lib/core.js:86-107`、`scripts/afterPack.cjs`。根因：发布物未规范入库/生成。修复：提交 `resources/runtime`；发布固定 `npm run provision:npm && npm run dist`。

6. **【P2 建议】(c) 更新/回滚到锁外版本全量解析慢** — 现象：二次更新/回滚每次都慢。证据：`main.js:507-509`（无 ci/prefer-offline/固定 cache）、`main.js:405` vs `main.js:507`（fetch 参数不一致）。根因：锁只服务首装。修复：固定 `--cache` + `--prefer-offline` + 对齐 fetch 超时；可选回滚到锁定版走 `npm ci`。

7. **【P3 建议】后台检查只通知不下载** — 现象：无法“自动”更新。证据：`main.js:1538`、`main.js:1311-1317`。根因：后台策略只打铃。修复：按 §8 改为后台静默下载 + 退出时安装。

8. **【P1 建议】(d) 首装无实时进度** — 现象：首装只有静态 spinner。证据：`main.js:423` vs `main.js:510`、`ui/app.js:71-94`。根因：漏传 onLine、splash 未渲染。修复：同 1.2a。

9. **【P3 建议】`dist/latest.yml`/blockmap 未使用，发布流程未上传** — 现象：重复造自研 manifest，漏差分/完整性。证据：`dist/latest.yml`、`make-release.mjs:8-14`、`README.md:36-43`。根因：未拥抱 electron-builder 标准元数据。修复：随选型更新 make-release/README（§7）。可并入第 4 条。

---

## 5. 修复 spec（最小可执行，按实现顺序）

> 版本保持 `1.0.7`；新修复叠加在既有 1.0.7 工作树之上；改动仅限 in-scope 文件。

### 5.0 统一 npm 镜像解析
- 新增 `npmRegistryBase()`（main.js 内私有，或抽 `lib/core.js` 纯函数 `registryMetadataUrl(registry, pkg)`）。
- `latestDshVersion`/`listDshVersions` 改走 `npmRegistryBase() + '/@deepseek-ai/dsh'`。
- 保持 env > settings.npmRegistry(''=官方) > zh·npmmirror 优先级不变。

### 5.1 摆脱 curl.exe
- `lib/core.js`：新增 `fetchJson(url, opts)`（http/https，`opts.accept`、`opts.timeoutMs=20000`、`opts.proxy`），有代理时用 `https-proxy-agent`/`http-proxy-agent`；返回 JSON 或 null，永不 throw。
- `main.js`：`curlJsonAsync` 改为调用 `core.fetchJson`（proxy 取自 `process.env.https_proxy||HTTPS_PROXY||http_proxy||HTTP_PROXY||DSH_UPDATE_PROXY`）。
- `main.js`：`downloadUpdate` 保留现有 curl 分支或同换 Node 流式下载；至少保证 `checkForUpdate`/metadata 不再依赖 curl。

### 5.2 应用自更新（若加固手工流程——暂定，最终按 §7 选型）
1. `installUpdate` 改为「退出→静默装」：`before-quit` 里 `spawn(p, ['/S'], { detached:true, stdio:'ignore' }).unref()` + `wantQuit=true; app.quit()`；`/S` 后接 `--updated`（若沿用 electron-builder NSIS 的 restart 逻辑）。
2. 下载校验：`downloadUpdate` 完成后 `size` 比对 + `crypto` 流式 `sha512`（base64）比对 manifest，失败删除文件并写 `updateState.error`。
3. `ui/dashboard.js:285` 检查 `installUpdate()` 返回值，false → `umsg = failed`。
4. `make-release.mjs`：读 `dist/latest.yml` 的 `sha512/size`（不存在则对 Setup 现算），写入 `dsh-update.json`。
5. README 发布流程同步增加 sha512/size 与上传说明。

### 5.3 dsh 运行时更新
1. `updateDsh` npmArgs 追加 `--cache`（指向 `DSH_HOME/npm-cache`）、`--prefer-offline`、`--fetch-timeout=120000 --fetch-retries=1`；成功后让 npm 持久化 lockfile（默认行为，确认不手动删 `RUNTIME_DIR/package-lock.json`）。
2. 可选：`ver === lockedDshVersion()` 时走 `npm ci` 秒级回滚。
3. 首装进度：同 1.2a。

### 5.4 测试
- `lib/core.js` 新增 `registryMetadataUrl`/`fetchJson` 后，补 `test/core.test.js` 用例（registry 三分支、URL 拼接）。
- 运行 `node --test dsh-desktop-app/test/core.test.js`（工作区根执行）。
- ⚠️ 本沙箱内实测该命令报 **`spawn EPERM`**（详见 §10），属执行环境限制，非代码失败：请在无沙箱/本机环境复跑确认。

---

## 6. 对任务指定疑点的逐条回答

- (a) **是 BUG**：`latestDshVersion`/`listDshVersions` 硬编码 `https://registry.npmjs.org`（`main.js:461-470`/`471-475`），忽略 `npmRegistryOverride()`（`main.js:530-538`）。镜像用户版本枚举仍走官方源，可能失败/超时。修复点：`main.js:466`、`main.js:472` 改走 `npmRegistryBase()`。
- (b) **属实**：`curlJsonAsync`（`main.js:347-358`）依赖 curl.exe 且无代理、静默失败；curl 缺失/被墙时版本列表空、最新版 null，更新入口消失。修复：`lib/core.js` 的 `fetchJson` 替代。
- (c) **属实的已知限制**：更新/回滚到锁外版本 npm 全量解析慢（`main.js:507-509`）。持久化 `package-lock.json` + 固定 `--cache` + `--prefer-offline` 能让二次更新与回滚走缓存快路径，建议落地；多版本锁存档可后续评估。
- (d) **属实**：`ensureRuntimeDsh`（`main.js:423`）无 onLine 进度回调（对比 `updateDsh` `main.js:510`），首装无进度反馈；修复见 1.2a。
- (e) **1.0.7 修复完整**：真实错误上屏与 Retry 真重装均已实现并验证（2.4），仅存双重前缀/短暂 `stopped` 两处小瑕疵。
- (f) **多为 BUG**：`installUpdate` 无 `/S`、未先 `app.quit()`、oneClick:false + 运行中 exe 被锁装不上；`downloadUpdate`/`checkForUpdate` 依赖 curl.exe；`dsh-update.json` 无 sha512/size；`dist/latest.yml` 已生成未使用；后台 `checkForUpdate(false)`（`main.js:1538`）仅通知不下载。详见 §3。

---

## 7. 应用自更新选型：electron-updater vs 加固现有手工流程

### 结论：**推荐迁移到 electron-updater**（对 dsh 运行时更新不用改，仍走 npm；此处只替换“应用自身”的更新）

### 7.1 理由
1. **元数据已就绪**：`electron-builder` 已在 `dist/` 免费产出 `latest.yml` + `*.exe.blockmap`（含 `sha512`+`size`，`dist/latest.yml:1-8`），electron-updater 直接消费，无需自研 manifest。
2. **完整性校验内置**：`sha512` 校验是 electron-updater 的默认行为，直接满足“补 manifest 完整性校验”；差分 blockmap 还能显著减小 91MB 安装包的更新流量。
3. **自动解决 3.1 的退出/锁/重装编排**：electron-updater 的 `quitAndInstall()` 会退出应用并以正确参数拉起 NSIS（`/S` + `--updated`），处理“运行中 exe 被锁”“装完重启”这整类 bug；风险远低于自写 detached spawn。
4. **脱离 curl.exe**：electron-updater 走 Chromium 网络栈（系统代理/证书），连带解决 3.2 的应用侧 curl 依赖。
5. **代码更少、更可测**：删除约 70 行自研 `checkForUpdate/downloadUpdate/installUpdate` 拼装逻辑，状态/进度/错误由库统一提供。

### 7.2 风险与对策
1. **发布仓库必须先传 `latest.yml` + blockmap**：`make-release.mjs`/README 要改为上传 `dist/latest.yml` + `dist/DeepSeek-Harness-Setup-*.exe.blockmap`；`update-url.json` 指向 `https://.../latest/download/latest.yml`。→ 已纳入 §5.4 的联动。
2. **代码签名/安全**：未签名仍触发 SmartScreen（README 已提示）；electron-updater 默认强校验签名，未签名需配置 `publish`/`verifyUpdateCodeSignature:false` 供测试，正式仍建议签。无签名不是 electron-updater 引入的新问题。
3. **oneClick:false + perMachine 提权**：静默安装装在 Program Files 需管理员权限，非提权进程会静默失败。需在 NSIS 配 `perMachine:false`（用户目录安装）或接受“提权弹窗”，并在 UI 把失败上屏。
4. **`.gitignore` 已忽略但需改发布清单**：`dsh-update.json`/`update-url.json` 是生成物（`.gitignore:10-11`），切到 electron-updater 后 `update-url.json` 仍要随 `build.files` 进包（`package.json:36`），只是内容从 `dsh-update.json` 换成 `latest.yml` 地址。

### 7.3 可执行落地方案（electron-updater）
1. `npm i electron-updater`；`main.js` 引入 `autoUpdater`，`updateUrl` 取现有 `builtinUpdateUrl`/`settings.updateUrl` 逻辑。
2. `checkForUpdate` → `autoUpdater.checkForUpdates()`；`downloadUpdate` → `autoUpdater.downloadUpdate()`；`installUpdate` → `autoUpdater.quitAndInstall(false, true)`。
3. progress/available/error 事件 → 映射到现有 `updateState`/`broadcastStatus`（dashboard/`preload.js` 的 `checkUpdate/downloadUpdate/installUpdate` 桥接保持不变）。
4. `make-release.mjs`/`README.md` 改为上传 `latest.yml` + `blockmap`；`update-url.json` 指向 `latest.yml`。

### 7.4 若坚持加固手工流程（备选）
- 必须补齐：`/S`、退出后安装、装完重启（3.1）、Node 下载器替代 curl（3.2）、sha512/size 校验（3.3）、失败上屏。
- 代价：仍要自写退出/锁/重启编排与差分缺失，维护面大于 electron-updater，且 blockmap 差分几乎无法手工实现（91MB 全量下载）。

---

## 8. 后台自动安装策略（推荐）

1. **后台静默下载，绝不运行中安装**：启动后 `checkForUpdate(false)` 命中 → 用 electron-updater 后台 `downloadUpdate()`（差分 + sha512 校验），下载完成仅通知“将在退出时应用”。
2. **退出时安装**：`before-quit`/`will-quit` 时机调用 `quitAndInstall()`（NSIS `/S`），避免打断正在运行的服务/会话；一次性解决“运行中 exe 被锁”。
3. **配置开关**：settings 增加 `autoUpdate: 'off' | 'download' | 'install-on-quit'`，默认 `download`（仅静默下载+提示），稳定后再开放 `install-on-quit`；保留手动“下载并安装（立即退出安装）”通道。
4. **失败可观测**：下载/校验/安装任一失败写入 `updateState.error` 并通知/日志，禁止静默（与 §2.2 的静默失败原则一致）。

---

## 9. 发布联动清单（make-release + README + dsh-update.json）

| 选型 | `make-release.mjs` | `README.md` 发布流程 | `dsh-update.json` | `update-url.json` |
| --- | --- | --- | --- | --- |
| electron-updater（推荐） | 校验 `dist/latest.yml` + blockmap 存在；上传 `latest.yml` + `*.exe.blockmap` | 改 `gh release create` 为上传 `Setup.exe` + `latest.yml` + `blockmap`；步骤 4 重打包 | 废弃或保留为回溯 | 指向 `latest/download/latest.yml` |
| 加固手工流程 | 读 `latest.yml` 或现算 `sha512`+`size`，写入 `dsh-update.json` | 增加“上传前校验 sha512”说明 | 增加 `sha512`+`size` | 保持指向 `dsh-update.json` |

---

## 10. 验证记录

- `node --test dsh-desktop-app/test/core.test.js`：本会话沙箱执行返回 **`spawn EPERM`**（`errno -4048`, `syscall spawn`）。这是本环境“禁止捕获子进程 piped stdio”的已知限制（如 `core.resolveNpmCli`/`resolveNode` 的 `where.exe`/`node` 探测），**不是代码回归**。需在无沙箱本机复跑确认基线通过，并追加 §5.4 新用例。
- 取证文件（已读）：`main.js`（全 1556 行关键段）、`lib/core.js`（全 363 行）、`make-release.mjs`、`update-url.json`、`dsh-update.json`、`dist/latest.yml`、`package.json`、`.gitignore`、`scripts/afterPack.cjs`、`preload.js`、`preview-preload.js`、`ui/index.html`、`ui/app.js`、`ui/dashboard.js`、`test/core.test.js`、`CHANGELOG.md`、`README.md`、`resources/runtime/package.json`。