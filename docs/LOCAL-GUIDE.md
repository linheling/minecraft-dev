# minecraft-dev 本地导读（改代码前先读这一页）

> 适用版本：**0.17.0**（`package.json:3`），默认分支 `master`。
> 本文件是「本地副本」的导航，不随 npm 包发布范围约束（`package.json:14-25` 的 `files` 白名单包含 `docs/`，本文件在包内，但只是文档）。
> 事实基线：2026-11-03，本地 `npm test` 360 例全过。

---

## 0. 一句话定位

这是一个 **DSH 插件**（不是独立应用）：往 DeepSeek Harness 里注入 11 个 Minecraft 开发技能、5 个工具、2 个用户预设和 4 个团队角色，让 agent 能脚手架、构建、移植审计 Paper / Fabric / Forge / NeoForge / Spigot 项目（MC 1.7.10 ~ 26.3）。

它**不包含**任何 Minecraft 服务端或 mod 运行时，全部产物都是「生成项目 / 跑 Gradle / 读文件审计」。

---

## 1. 本地现状（先确认你在改哪一份）

| 项 | 值 |
| --- | --- |
| 工作目录 | `D:\C\MC\minecraft-dev` |
| git 基线 | `a658559` baseline（上游 master 快照，260 个 tracked 文件） |
| 上游 | `linheling/minecraft-dev`，是 `sikadi233-hub/minecraft-dev` 的 **fork** |
| 版本关系 | 本地 fork = **0.17.0**；upstream master = **0.11.0**（两条独立功能线，勿盲目 merge） |
| Node | v24.22.1 / npm 11.19.1（`node ^22.19 \|\| >=24`） |
| dsh | **0.2.1-rc.5**（不在 PATH；CLI 见下） |
| 已装 profile | `desktop` 里 `minecraft-dev@0.17.0` 已安装，内容与本地快照一致（仅少了 .github / test / scripts 等 dev 文件） |
| 依赖 | 已 `npm install`，`node_modules` 在 `.gitignore` 里 |

`dsh` CLI 的实际路径（App 自带，非全局）：

```bat
"C:\Users\lenovo\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
```

它是个 shim，最终跑 `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`。

---

## 2. 60 秒自检（改任何东西之前/之后都跑）

```bat
cd /d D:\C\MC\minecraft-dev
npm test                       :: 360 例 / 34 个测试文件，1~2 秒
npm run check:syntax           :: 68 个 JS 文件语法
npm run check:state            :: docs/STATE.md 与 lib/versions.js 的 19 条版本线双向一致
npm run check:unverified       :: 未验证条目棘轮（上限 60）
npm run check:links            :: 文档相对链接
npm run check:versions         :: 版本矩阵 vs 生态（需要网络，会失败在离线）
```

想让「入口模块真实加载」而不是默认 skip：

```bat
set REQUIRE_PLUGIN_DEPS=1
node --test test/modules.test.js
```

> `test/modules.test.js` 在没有 peer 依赖时会 skip 掉 `ERR_MODULE_NOT_FOUND`；本机已装 peer 包，所以能真加载。CI 里用 `REQUIRE_PLUGIN_DEPS=1` 硬失败。

---

## 3. 文件地图（按「改哪里」组织）

### 3.1 插件入口（4 个 JS，全部是 Cordis 插件）

| 文件 | 作用 | 关键点 |
| --- | --- | --- |
| `skills.js`（109 行） | 注册 11 个技能 | `SKILLS` 数组 `:22-67` 硬编码 name+description；`:69-83` 组 candidate；`:96` get() 时才 readFile 正文 |
| `tools.js`（45 行） | 合并注册 3 个工具 | `:41-45` 注册 scaffold / gradle / audit；Config 默认 600000ms / 12000 字符 |
| `codex.js` | 架构师专用 Codex 工具 | 私有技能 provider `:83-101`；`mc_codex` 工具 `:108`；默认 app-server 模式 |
| `preset.js`（116 行） | 注册 / 安装预设 | `:94-116` **先注册（0.1.7+），失败才落盘目录（0.1.5/0.1.6）** |

### 3.2 声明式装配

| 文件 | 作用 |
| --- | --- |
| `cordis.patch.yml`（108 行） | bundle patch：向用户 profile 的 bundle 追加行。顶层唯一 `- insert:`，全部插在根层 |
| `preset/minecraft/agent.cordis.yml`（480 行） | 「Minecraft 专家」预设真源，18 个顶层 row |
| `preset/minecraft/rows.js` | 同一预设的 **JS 镜像**（供 0.1.7+ 注册）——手改，无生成脚本 |
| `preset/minecraft-architect/*` | 「架构师」= 专家 + persona 尾部 Astra 段 + 末尾 `codex-architect` 行 |
| `preset/roles.js`（440 行） | 4 个角色预设 mc-plan / mc-skeleton / mc-content / mc-verify |
| `preset/*/preset.yml` | 预设元数据（name / description / order） |

`cordis.patch.yml` 插入的行（按出现顺序）：

1. `minecraft-skills` — 技能 provider
2. `minecraft-tools` — 合并工具（gradleTimeoutMs / outputTailChars）
3. `minecraft-tool-scaffold` / `-gradle` / `-audit` / `-smoke` — **默认 `disabled: true`** 的单工具组件
4. `minecraft-preset` — 预设注册/安装
5. `subagent-mc-plan` / `-skeleton` / `-content` / `-verify` — 4 个 subagent 工具（`agentPreset` 指向角色预设）

### 3.3 运行时 `lib/`

| 文件 | 职责 | 备注 |
| --- | --- | --- |
| `run-process.js` | 统一 spawn / 超时 / 取消 | 输出**头尾各半、中段丢弃** `:55-60`；win32 `taskkill /T /F` `:87-112` |
| `cmd-quote.js` | cmd.exe 参数垫片 | 拒 `"`、CRLF、NUL；`%VAR%` 不转义 `:24-27` |
| `versions.js`（254 行） | **唯一版本真源** `PLATFORM_LINES` `:38-111` | 5 平台 19 条线；`resolveLine` 对 mod 平台只收 pin 版本 `:142-175` |
| `validate.js` | 项目名 / 包名 / MC 版本 / Java 级别校验 | Java 只允许 8、17、21、25 |
| `templates.js` | `{{key}}` 模板渲染 | 未定义即抛；`gradle-wrapper.jar` 走二进制 |
| `scaffold.js` | 生成项目 | 目标目录必须空；失败只清本次写入 |
| `gradle.js` | 跑 wrapper + 预检 + 锁 | 取锁→preflight→执行→finally 释放 |
| `build-lock.js` | **进程内** Map 防并发 | `:8-10` 明确不是文件锁 |
| `preflight.js` | wrapper / Gradle / Java 兼容性告警 | Java×Gradle 下限 `:25-30` |
| `smoke.js` | 起 `runServer` 做冒烟 | 证据写 `.dsh/smoke/`；只扫 512KB 滚动窗 |
| `port-audit.js`（1243 行） | 只读移植审计 | 手写 TOML/正则；`ok = 无 blocker` `:257-340` |
| `next-steps.js` | 按结果给「下一步」 | 超时/取消/非零/异常分支 `:104-234` |
| `present.js` | 纯视图函数 | 无退出标记视为 0 `:48-59` |
| `descriptions.js`（86 行） | 5 个工具描述 | 四段式：Use when / Do not use for / Constraints / After a failure |
| `architect-brief.js` | 给 Codex 渲染 brief | 残留占位符直接抛 |
| `preset-install.js` | 目录形态安装预设 | 目标 `$DSH_HOME/.agent-presets/<id>`；**已有 composition 就跳过** `:60-90` |
| `preset-register.js` | 0.1.7+ 注册预设 | 以 `register` 函数判版本；失败只 warn `:48-77` |
| `lib/tools/*.js` | 工具定义 + 单工具组件 | `*-component.js` 是独立 Cordis 插件 |

### 3.4 资产与模板

- `assets/skills/<name>/SKILL.md` — 11 个技能的正文（技能正文**不**注入 prompt，由 `skill` 工具按需读取）
- `assets/skills/<name>/references/` — 技能引用资料
- `assets/codex-architect/SKILL.md` — 仅架构师预设可见
- `templates/<platform>/<line>/` — 14 个平台×线模板目录 + `templates/common/`，共 96 个模板文件
- `assets/skills/<name>/references/api-index/<MC 版本>.md` — 平台 API 离线签名索引（18 条线，`javap -public` 从钉选工件生成，每份带 `PROVENANCE` 头与可能出现的 `TRUNCATED` 标记）

### 3.5 测试 / 脚本 / 文档

- `test/` 34 个测试文件，360 例：schema、描述四段式、模板渲染、preset parity、persona 变量、subagent 行等
- `scripts/` 有 check-syntax / check-links / check-state / check-versions / check-unverified / coverage / smoke
- `docs/STATE.md` — 19 条版本线台账（**不是**自动生成，需手改）
- `docs/` 其余：架构、路线图、`next-steps` 等

---

## 4. 五条数据流（改代码时对照）

### 4.1 技能：只注册元数据，正文按需读

```
skills.js  SKILLS[] → candidate{provider:'minecraft-dev', source:'bundled', rank:BUNDLED_SKILL_RANK,
                                resourceBase:'assets/skills/<name>/', locator:'SKILL.md'}
   ↓ ctx.skills.registerProvider
模型调用 skill 工具 → provider.get() → readFile(SKILL.md) → 正文进上下文
```

改技能：改 `assets/skills/<name>/SKILL.md` **和** `skills.js:22-67` 的 description（两处都要动，description 是发现层的唯一入口）。

### 4.2 工具：合并组件 vs 单工具组件

```
profile cordis bundle
  ├─ minecraft-tools        → tools.js → mc_scaffold / mc_gradle / mc_port_audit
  └─ minecraft-tool-smoke   → lib/tools/smoke-component.js → mc_smoke（默认 disabled）
```

**不要同时挂合并组件和同名单工具**——会重复注册直接抛错。开单工具的正确姿势：先在你的 profile patch 里把合并行 `disabled: true`，再开对应单行。

### 4.3 脚手架

```
mc_scaffold(platform, targetDir, name, packageName, minecraftVersion, javaVersion)
  → scaffold.js：校验目标为空 → versions.resolveLine 定版 → 填 name/pkg/pkgPath/MainClass
  → templates 复制 + wrapper → 返回 buildCommand / wrapperReady / next[]
```

### 4.4 构建

```
mc_gradle(projectDir, tasks, timeoutMs)
  → gradle.js：校验参数（拒 cmd 元字符）→ build-lock 取锁 → preflight
  → run-process 跑 ./gradlew（win32 走 cmd shim）
  → 头尾各半截断 → present 视图 + next-steps
```

### 4.5 预设：0.1.7+ 注册，0.1.5/0.1.6 落盘

```
preset.js apply
  ├─ registerPresetDefinitions(...) 成功 → return（dsh >= 0.1.7：只注册，不写文件）
  └─ 失败且 autoInstallPreset !== false → ensurePresetInstalled()
        → $DSH_HOME/.agent-presets/minecraft/{preset.yml, agent.cordis.yml}
        → 已有 agent.cordis.yml 就跳过（绝不覆盖）
```

所以：**改了 `preset/**` 后，已存在的 `.agent-presets/<id>` 不会自动更新**，要手动删目录（或改 `DSH_HOME`）再让插件重装。

### 4.6 子代理

`cordis.patch.yml` 的 4 行 subagent 把 `agentPreset` 指向 `mc-plan/mc-skeleton/mc-content/mc-verify`，串行 A→B→C→D，唯一共享工件是 `PLAN.md`。`maxDepth: 1`（子代理不能再派子代理）。

---

## 5. 修改指引（改什么 → 同步什么 → 跑什么）

### 5.1 提升 / 新增一条 MC 版本线

1. 改 `lib/versions.js:38-111` 的 `PLATFORM_LINES`（默认 MC、Java、Gradle、loader 坐标）
2. **同步** `docs/STATE.md`（19 条表格，一条不能多、一条不能少）
3. 改 `templates/<platform>/<line>/` 模板（如需要）
4. 跑：`npm run check:state`、`npm run check:syntax`、`npm test`

### 5.2 新增一个技能

1. `assets/skills/<new>/SKILL.md`（+ 可选 `references/`）
2. `skills.js:22-67` 加 name + description（description 决定模型是否发现它）
3. 跑：`npm test`（`test/metadata-consistency.test.js` 会锁技能元数据）
4. 注意本机 `~/.dsh/skills` 下同名用户技能 rank < 600 会**覆盖** bundled 技能

### 5.3 新增一个工具

1. `lib/tools/<x>.js`（defineTool）+ `lib/descriptions.js` 风格的四段式描述
2. 合并入口：`tools.js` 注册
3. 单工具形态（可选）：`lib/tools/<x>-component.js` + `package.json` exports `./tools-<x>` + `cordis.patch.yml` 加 `disabled: true` 行
4. 跑：`test/tools-schema.test.js`、`test/tool-descriptions.test.js`、`test/tool-components.test.js`

### 5.4 改人设（专家 / 架构师）

1. 改 `preset/minecraft/agent.cordis.yml` 的 `persona`（`:33` 起，到 `:252` 附近）与 `agent-instructions`（`:254`）
2. **同步** `preset/minecraft/rows.js`（pairity 测试会双向校验：id/name 顺序、标量叶子、块标量逐字节、preset.yml 元数据）
3. 架构师特有段：yml `:254-283` ↔ `rows.js:24-54`（`ASTRA_SECTION`）
4. 跑：`node --test test/preset-rows-parity.test.js test/preset-parity.test.js test/persona-variables.test.js`

> 人设模板只认 `{{model}}` 和 `{{provider}}`。写 `{{cwd}}` 会在发请求前直接抛 `unknown prompt variable`。

### 5.5 改团队角色

1. `preset/roles.js`（人设 `:45/:133/:224/:307`，`rolePreset()` `:33`，order 91-94）
2. `cordis.patch.yml` 的 4 行 subagent（`toolName` / `agentPreset` 要一致）
3. 跑：`test/subagent-rows.test.js`

### 5.6 改安装 / 升级行为

1. `lib/preset-install.js`（目录形态）或 `lib/preset-register.js`（0.1.7+ 注册）
2. `preset.js:94-116` 决定「先注册、失败再落盘」的顺序
3. 跑：`test/preset-install.test.js`、`test/preset-registration.test.js`
4. 全量：`npm test`

---

### 5.7 更新 / 新增 API 索引

1. 生成器直接读 `lib/versions.js` 的 `PLATFORM_LINES`——**先改版本线，再重新生成**，不要手写线清单
2. 全量：`npm run fetch-api-index`（在 PowerShell / cmd 下跑；Git Bash 的 GNU `tar` 会把 `C:\...` 当远程主机）
3. 单线加深：`node scripts/fetch-mc-api-index.mjs --platform paper --line 1.20.6`
4. 离线校验：`npm run check-api-index`
5. 跑 `test/api-index.test.js`：PROVENANCE 字段完整、标题与 `TRUNCATED` 双向一致、单文件 ≤320 KB、语料 ≤3 MB、每个带索引的技能都必须提到 `references/api-index/`

## 6. 改完怎么让它生效

### 6.1 三种安装方式

```bat
:: A. npm 包（发布后）
dsh plugin --profile desktop add minecraft-dev

:: B. 本地 tarball
npm pack
dsh plugin --profile desktop add .\minecraft-dev-0.17.0.tgz

:: C. 源码直连（开发用，最推荐）
dsh plugin --profile desktop add D:\C\MC\minecraft-dev
```

`dsh` 用第 1 节那个 `dsh.cmd` 全路径。装完**必须重启 dsh**（插件在启动时装配）。

### 6.2 profile 布局（desktop）

```
C:\Users\lenovo\.dsh\profiles\desktop\
  package.json          "minecraft-dev": "git+https://github.com/linheling/minecraft-dev.git"
  node_modules\minecraft-dev\    ← 实际加载的代码（当前 = 本地 0.17.0 快照）
```

源码直连安装后，`node_modules/minecraft-dev` 会变成指向本地目录的链接（npm `file:` 语义）。改完源码**重启 dsh** 即可，不需要重新装；但如果你改的是 `preset/**` 且已存在 `.agent-presets` 副本，仍要删副本。

### 6.3 预设副本

```
C:\Users\lenovo\.dsh\.agent-presets\
  minecraft\             agent.cordis.yml + preset.yml
  minecraft-architect\   agent.cordis.yml + preset.yml
```

删除整个目录，重启 dsh，插件会重新拷一份（只拷顶层普通文件，子目录会静默跳过）。

---

## 7. 坑（README 告警 + 本地实测）

1. **dsh 0.2.1 删了 `persona` / `toolFilter`**：bundle 行里写了直接抛错；角色信息必须移进 Agent Preset。`backgroundMode` 已失效。
2. **peer 声明是硬门禁**（0.2.0 起）：不匹配 = 整包拒绝导入。node-semver 无法用一条范围覆盖多条预发布线，只能逐条枚举（现在写了 3 条 `||`）。兜底：
   `dsh plugin --profile desktop allow-version minecraft-dev@0.17.0 --dsh-version 0.2.1-rc.5 --accept-risk`
3. **preset 双形态必须同时维护**：`agent.cordis.yml`（0.1.5/0.1.6 目录）和 `rows.js`（0.1.7+ 注册）。parity 测试只查「JS→YAML 有对应」，**抓不到 YAML 独有标量、也抓不到键序**——YAML 里多写一个键不会报错。
4. **`preset.yml` 是严格 YAML**：`name` / `description` 含 `[`、`]`、`: ` 必须加引号，否则元数据整块丢失且不报错。
5. **`backgroundMode` 失效 + `taskkill` 不彻底**：win32 杀进程树用 `taskkill /PID <pid> /T /F`，失败才回退 SIGKILL（只杀根进程，可能留下 Gradle daemon）。
6. **输出中段被丢弃**（`run-process.js:55-60`）：长编译日志里真正的报错可能在第 3000 行，被截掉了。要看全量得自己跑 Gradle 或调 `outputTailChars`。
7. **build-lock 只在进程内**：两个 dsh 实例 / 手工 Gradle 能同时写同一个项目目录，后果是 wrapper 或构建产物被写坏。
8. **审计不是编译级**：`port-audit.js` 用手写 TOML 解析 + 正则，可能误报/漏报。真结论要 `mc_gradle` 编译。
9. **Windows 全局 `~/.gradle/init.gradle`** 如果插了不可达仓库，首次构建会「假死」（没有输出、不超时）。先临时改名再跑。
10. **模板 `{{key}}` 未定义即抛**：新增模板变量必须同步 `scaffold` 的 fill 表，否则生成阶段直接失败。
11. **smoke 只扫 512KB 滚动窗**：早期报错可能已滚出去，判定为 pass。长日志要人工看 `.dsh/smoke/`。
12. **用户技能覆盖 bundled 技能**：`~/.dsh/skills` 下同名 rank < 600 会抢占。调试技能时先确认没被覆盖。
13. **26.3 生态不完整**：Paper 已有 `-stable`，NeoForge 只有 `-beta`（`26.3.0.12-beta`）；`docs/STATE.md` 里 17 条线「未验证」。
14. **fabric loom 锁在 1.17 线**：loom 1.18.2 要求 Gradle JVM 为 Java 25，跨线升级会破。别「顺手升级」。
15. **fork ≠ 上游**：本地 0.17.0 与 upstream 0.11.0 是两条线（本地加了 smoke / 单工具组件 / STATE / next-steps / preflight；上游走「平台 API 离线签名索引」）。merge 前先看两边 README 功能表。
16. **索引是生成物，不要手改**：`references/api-index/*.md` 由脚本产出，手改会被 `check-api-index` / `test/api-index.test.js` 抓出来；要改内容请改生成器并重跑。
17. **生成器要在 PowerShell/cmd 跑**：Git Bash 里的 GNU `tar` 会把 `C:\Users\...` 当成远程主机（报 `Cannot connect to C: resolve failed`）；`--check` 模式不联网、不受影响。

---

## 8. 已知边界 / 未做的事

- `docs/STATE.md` 19 条线里只有 2 条有最近验证日期，17 条未验证；`check:unverified` 是棘轮（上限 60），只能慢慢降。
- CI 的 smoke workflow 需要真实 JDK + 网络（Maven 中央 / Fabric / NeoForge 仓库），本地离线跑不了完整 4 条构建腿。
- `check:versions` 要访问生态元数据，离线必失败（不是代码坏了）。
- 没有 preset 生成脚本：YAML ↔ rows.js 靠手改 + parity 测试兜底。
- `mc_codex` 只存在于架构师预设，且要求本机装了 Codex CLI；没装时工具会报「找不到可执行文件」。

---

## 9. 快速索引（按行号）

| 想改 | 打开 |
| --- | --- |
| 版本矩阵 | `lib/versions.js:38-111` |
| 版本解析规则（pin 校验） | `lib/versions.js:142-175` |
| 工具描述四段式 | `lib/descriptions.js:15-86` |
| 技能注册表 | `skills.js:22-67` |
| 技能正文加载 | `skills.js:96` |
| 合并工具注册 | `tools.js:41-45` |
| bundle 插入行 | `cordis.patch.yml:1` 起 |
| 预设注册/落盘分叉 | `preset.js:94-116` |
| 注册失败回退 | `lib/preset-register.js:48-77` |
| 目录安装 / 跳过规则 | `lib/preset-install.js:60-90` |
| 进程执行 / 截断 | `lib/run-process.js:55-112` |
| 构建锁 | `lib/build-lock.js:8-41` |
| 移植审计入口 | `lib/port-audit.js:257-340` |
| API 索引生成器 | `scripts/fetch-mc-api-index.mjs` |
| API 索引离线校验 | `scripts/fetch-mc-api-index.mjs --check` |
| 台账 | `docs/STATE.md` |

---

## 10. 提交前检查清单

- [ ] `npm test` 全绿（360/360）
- [ ] `npm run check:syntax`
- [ ] 改了版本线 → `npm run check:state`
- [ ] 改了 preset → `preset-rows-parity` + `preset-parity` + `persona-variables` 三个测试
- [ ] 改了工具 → `tools-schema` + `tool-descriptions` + `tool-components`
- [ ] 改了 `assets/**/*.md` 里的链接 → `npm run check:links`
- [ ] 新增的「未验证」条目没有超过棘轮上限（`check:unverified`）
- [ ] 如果改了 `preset/**`：本地 `.agent-presets` 副本已删 / 或确认走注册路径
- [ ] 如果改了运行时：`REQUIRE_PLUGIN_DEPS=1 node --test test/modules.test.js` 真加载通过
- [ ] 如果改了 `references/api-index/**` 或版本线：`npm run check-api-index` + `test/api-index.test.js`

---

*本导读由本地调研生成；与 README.md（对外使用说明）互补：README 讲「怎么用」，本文件讲「怎么改」。*
