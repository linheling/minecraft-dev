# Paper 服务端插件开发（minecraft-paper-plugin）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build。本技能覆盖现代线（MC 1.20.x / 1.21.x / 26.x）；1.7.10~1.12.2 老线见 minecraft-spigot-legacy（v0.3 提供）。
> **铁律：API 签名一律 `read_file` 查 `references/api/`，禁止凭记忆写签名。** 参考里没有的，用 web 工具查官方文档（docs.papermc.io 或 javadoc.io），不要编。
> 核对日期：2026-10-21（Paper 26.3 已有 `-stable` 构建，实测最新 `26.3.build.209-stable`；26.2 最新 `26.2.build.134-stable`；1.21 线上游已到 `1.21.11-R0.1-SNAPSHOT`，本仓库钉选 `1.21.8`；Java 25）。

## 1. 定位与家族

- Paper 是 Spigot/Bukkit 的延续，API 兼容 Bukkit 插件：为 Paper 写的插件一般也能跑在 Spigot 上（除非用了 Paper 专属 API）。
- 家族成员：**Paper**（主流推荐）、**Purpur**/Pufferfish（Paper 衍生，额外配置）、**Folia**（Paper 的分区调度分支，API 基本兼容但调度模型完全不同——Folia 上不能用 Bukkit 的同步调度器；RegionizedServerInitEvent / GlobalRegionScheduler / EntityScheduler / RegionizedData 与 api-version ≥1.19.4 标记机制详见 `references/api/folia.md`）。写通用插件默认目标 Paper。

## 2. 版本对应（现代线）

| MC | Paper 支持 | Java |
|---|---|---|
| 1.20.x | 支持；1.20.6 的 paper-api 以 Java 21 字节码发布，脚手架默认 toolchain 21（目标 1.20.1 时显式传 `javaVersion=17`） | 21 |
| 1.21.x | 支持，**当前稳定主流线**（本仓库钉选 1.21.8；上游已发布 1.21.11） | 21 |
| 26.x（26.2） | 已支持，有 `-stable` 构建（最新 `26.2.build.134-stable`） | 25 |
| 26.x（**26.3，当前正式版**，2026-09-15 发布） | **已有 `-stable` 构建**（实测最新 `26.3.build.209-stable`）；新正式线，上生产前按目标构建号复核 | 25 |

- 26.3 在 2026-09 还是 alpha 阶段，2026-10 已转入 `-stable`（2026-10-21 实测 `26.3.build.209-stable`）；26.2 同样有 `-stable`。生产选型仍建议先 26.2 或 1.21.x，26.3 需按目标服实际构建号复核。
- 家族其他分支（Purpur / Pufferfish / Folia）的 26.3 构建状态**未核实**（各自发布渠道，与本文件的 repo.papermc.io 实测不同源）——用之前逐一确认。

paper-api 坐标（仓库 `https://repo.papermc.io/repository/maven-public/`）：
- 1.x 时代：`io.papermc.paper:paper-api:<mc版本>-R0.1-SNAPSHOT`（如 `1.21.8-R0.1-SNAPSHOT`）
- 26.x 时代：`io.papermc.paper:paper-api:26.<次版本>.build.+`（如 `26.2.build.+` / `26.3.build.+`，动态范围滚动取该线最新构建）。26.3 的范围现在解析到 `-stable`（2026-10-21 实测 `26.3.build.209-stable`）；需要更保守可按 `26.2.build.+` 钉选。核对源：`https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml`。

## 3. 项目骨架

**新项目一律优先用 `mc_scaffold` 工具**（platform=paper），它会生成配好 shadow 打包 + toolchain + wrapper 的完整项目。已有项目按下面核对：

`build.gradle.kts` 两条路线（二选一）：
- **轻量路线（默认）**：`compileOnly("io.papermc.paper:paper-api:...")` + shadow 插件打 fat jar。绝大多数插件用这个。
- **重型路线**：`io.papermc.paperweight.userdev` 插件——需要反混淆服务器类（改 NMS）时才用；会拖慢构建，不推荐新手。

## 4. plugin.yml 必填字段

```yaml
name: my-plugin          # 小写，与 jar 名一致
version: 0.1.0
main: com.example.MyPlugin   # 主类全限定名，写错服务器直接拒绝加载
api-version: "1.21"      # 声明目标 API 级别：1.x 写主次版本（"1.21"）；26.x 写主次完整版本（"26.2" / "26.3"）——实测 26.2 服务端拒绝裸 "26"（IllegalArgumentException），必须 major.minor；26.3 已有 stable 构建，按同样规则写 "26.3"
author: name
description: 一句话说明
# 可选：commands / permissions / depend / softdepend / libraries
```

- **元数据二选一**：除 `plugin.yml` 外还有 Paper 专属的 `paper-plugin.yml`（无 `commands`/`libraries`/`depend` 字段，命令走 Brigadier、库走 `loader:`），同一 JAR 只该保留一种；两者差异、依赖三键语义与 `PluginBootstrap` 见 `references/api/paper-plugin-yml-and-libraries.md`。

## 5. API 要点（签名查 references/api/）

- **生命周期**：`JavaPlugin` 子类 + `onEnable()`/`onDisable()`；`getLogger()` 输出日志。
- **事件**：`@EventHandler` 监听器类 + `getServer().getPluginManager().registerEvents(listener, this)` → 详见 `references/api/events.md`
- **命令**：plugin.yml 声明 + `CommandExecutor`/`TabCompleter` → `references/api/commands.md`
- **玩家/物品**：`Player`、`ItemStack`、`Inventory`、`ItemMeta` → `references/api/player-and-inventory.md`
- **调度/配置**：`BukkitRunnable`、`getConfig()` → `references/api/scheduler-and-config.md`
- **世界/方块**：`World`、`Block`、`Location`、`Material` → `references/api/world-and-block.md`
- **文本/Component**：Adventure `Component`/`Audience`、MiniMessage、旧格式互转、标题/动作栏 → `references/api/text-and-components.md`
- **持久化/生态**：`PersistentDataContainer`、Vault 经济/权限、PlaceholderAPI、BossBar、Scoreboard → `references/api/data-and-ecosystem.md`
- **元数据进阶**：`paper-plugin.yml` 与 `libraries:`、依赖声明、`PluginBootstrap` → `references/api/paper-plugin-yml-and-libraries.md`

## 6. 常见坑

1. **main 类全限定名写错**：`plugin.yml` 的 `main:` 与真实类路径不一致 → 加载报 `Invalid plugin.yml` 或 `ClassNotFound`。
2. **api-version 缺失/过旧**：新 MC 上加载老声明会警告甚至拒绝；声明了就按新行为解析 Material 等枚举。
3. **异步代码触碰主线程 API**：异步任务里改方块/物品栏/传送到主线程 API → 用 `Bukkit.getScheduler().runTask(plugin, ...)` 切回主线程（Folia 例外）。
4. **依赖打进 fat jar**：paper-api 是 compileOnly，只有真正需要的运行时库才该被 shadow 打包，否则类冲突。
5. **慎用 `/reload`**：会破坏插件状态，测试时尽量重启服务器；热重载插件用 PlugMan 类插件也要小心。
6. **物品比较用 `ItemStack.isSimilar()`** 而不是 `equals()`；Material 对比不要用字符串。

## 7. 构建 / 测试 / 热重载流程

1. `gradlew build`（Windows: `cmd /c "gradlew.bat build"`）→ 产物 `build/libs/<name>-0.1.0.jar`
2. 拷入测试服的 `plugins/` 目录，重启服务器
3. 观察控制台：`[name] enabled` 出现即加载成功；报错看堆栈第一行
4. 改代码 → 重新 build → 重新拷贝重启（迭代期可配 `gradlew build -x test` 加速）
5. 本地起 Paper 测试服：从 papermc.io 下载对应版本 server jar，`java -jar paper.jar` 首次生成 eula.txt，同意后启动

## 8. 开工前核对（intake）

- 必问：**MC 版本**（1.20.x / 1.21.x / 26.2 / 26.3）、**核心**（Paper / Spigot / Purpur / Pufferfish / **Folia**——Folia 无 Bukkit 同步调度器，api-version 需 ≥1.19.4 标记，细节见 references/api/folia.md）、兼容插件（softdepend，如 MMOItems / WorldGuard）。
- 用户信息不足先批量提问（minecraft-intake），禁止猜着开工；"你决定"→ 默认 Paper + 1.21.x 最新稳定线（26.3 已有 stable，但默认仍保守取 1.21.x / 26.2）。
