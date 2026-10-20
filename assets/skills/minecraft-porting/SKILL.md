# 跨版本与加载器移植（minecraft-porting）

> 前置：配合 minecraft-java-build（目标版本的 JDK/Gradle/插件配对、生态状态）与对应平台技能（minecraft-forge-mod / minecraft-neoforge-mod / minecraft-fabric-mod / minecraft-paper-plugin / minecraft-spigot-legacy）一起用。本技能只给「从 A 迁到 B」的判定、工序与差异表，不重复平台技能里的完整 API 教程。
> 核对日期：2026-10。仓库内事实源：lib/versions.js（19 个钉死组合）、assets/skills/minecraft-java-build/SKILL.md 的版本时代表、各平台技能及其 references/api/。外部核对（2026-10-21）：Fabric 官方 Migrating Mappings / Networking / Custom Data Components / Custom Creative Tabs 页，以及 minecraft.wiki 的 Identifier、Pack_format、Data component 页；docs.neoforged.net 与 maven.neoforged.net 本机 10s 超时仍不可达。未确证条目统一写成 `UNVERIFIED（原因）`，原因写具体来源或验证缺口（如加载器官方源不可达 / 无可达官方页 / 需真机验证）；写代码前查 javadoc / IDE 补全。

## 0. 铁律

1. **先定源版本与目标版本，再动手。** 记录「源：MC 版本 + 加载器 + 加载器版本 + 构建插件 + Gradle wrapper + 映射 + JDK」和「目标：同一组字段」。两边有一边写不出来，先回 minecraft-intake 把版本与加载器问清（默认值见 assets/skills/minecraft-intake/references/api/intake-matrix.md）。
2. **先升构建链，再升 API。** 顺序固定：JDK → Gradle wrapper → 构建插件（FG / moddev / loom）→ 加载器坐标 → 映射 → 代码。构建脚本没跑通就改 Java 代码，等于在流沙上盖楼。
3. **每一步用 mc_gradle build 当闸门。** 一个模块编译不过，不进入下一个模块；构建通过才 runClient/runServer，再 runData。构建失败先读第一条编译错误，别先怀疑环境。
4. **不臆造签名。** 目标版本的方法名、参数、包名一律查本技能 references/api/ 与目标平台技能的 references/api/；没有就查 javadoc / IDE / `javap`。带原因的未核实标记不是免责声明，是待办。
5. **目标版本生态状态先查 java-build 的表。** 26.3 的 NeoForge 只有 `-beta`、Paper 只有 `-alpha`；1.20.1 的 NeoForge 是 legacyforge 分支（`RegistryObject`，不是 `DeferredHolder`）。生产项目先选有正式版的线。

## 1. 定位与触发

用户说下面任何一句，就进入本技能：

- 「把模组/插件从 1.20.1 升到 1.21」「迁到 26.2」「升级到 NeoForge」「Forge 换 NeoForge」「从 CraftBukkit 迁 Paper」。
- 「这个 API 在新版本怎么写」「1.20.5 之后 NBT 怎么办」「ResourceLocation 怎么 new 不出来了」。
- 构建能过但一运行就 `NoSuchMethodError` / `NoClassDefFoundError` / `InjectionError`，且代码来自旧版本工程。

与相邻技能的分工：

| 场景 | 走哪个技能 |
| --- | --- |
| 目标版本/加载器都没定 | 先 minecraft-intake（批量提问，默认值见 assets/skills/minecraft-intake/references/api/intake-matrix.md） |
| 已定目标，但要新建工程 | 平台技能（forge / neoforge / fabric / paper / spigot）的「项目搭建」节 |
| 已定目标，要把旧工程搬过去 | 本技能（判定 + 工序 + 差异表），API 细节回平台技能 |
| 只缺 JDK/Gradle 配对或构建报错 | minecraft-java-build |
| 只缺某个 API 在目标版本的真实签名 | 平台技能的 references/api/ + 本技能 references/api/api-renames.md |

跨加载器（Forge→NeoForge、Spigot→Paper、Forge↔Fabric）不只是改名：注册模型、事件总线、元数据、数据生成全都变。先按第 4 节判定「就地改」还是「再生骨架」，再选路线。

## 2. 默认工序：再生骨架 + 逐模块移植

默认走「新目录生成目标骨架，源码逐模块搬」，因为旧工程的构建脚本、元数据、资源布局往往同时过期，就地改会一次面对三类错误。6 步：

1. **定基线。** 写一张 from→to 表（源/目标各一行）：MC 版本、加载器与版本、构建插件与版本、Gradle wrapper、映射、元数据文件、JDK。数字抄 lib/versions.js 与 java-build 的表，不凭记忆。验收：这张表里没有空格子。
2. **生成骨架。** 用 `mc_scaffold` 在**空目录**生成目标版本工程；`platform` 与 `minecraftVersion` 必须命中 lib/versions.js 的钉选组合（fabric / forge / neoforge 严格匹配，传近似版本会报错并列出可用值）。验收：`mc_gradle build` 在零改动状态下通过。
3. **搬 `src/main/java`，逐模块。** 顺序：入口/主类 → 注册类 → 事件与命令 → 网络/数据 → 客户端隔离类。一次只搬一个模块，搬完立刻删掉目标版本不存在的注解、接口与 import，不要整包复制后一次编译。验收：该模块单独编译通过。
4. **按 references 校对签名。** 每个搬过来的类，对照目标平台技能的 references/api/ 与本技能 references/api/api-renames.md；映射名对照 references/api/mappings-and-lookup.md。标了未核实原因的调用先查 javadoc/IDE。验收：该模块没有「猜出来的」API 调用。
5. **`mc_gradle build` 当闸门。** 每模块后跑一次；非 0 退出先修编译，不进入下一模块。全部模块编译过后再 `runClient`/`runServer`（首次运行要下资源、接受 EULA，耗时属正常）。验收：build 退出码 0；runClient 到主菜单；runServer 到 `Done`。
6. **搬 `resources` 与元数据，最后数据生成。** 元数据按目标加载器重写（`mods.toml`→`neoforge.mods.toml`、`mcmod.info`→`mods.toml`、`pack.mcmeta` 的 `pack_format`、`fabric.mod.json` 的 depends）；资源目录名保持 `assets/<modid>`、`data/<modid>`；注册名不变。数据生成最后跑 `runData`，生成物进 `src/generated/resources`，不手改。验收：进世界无 missing texture/model；`runData` 通过；`modid:name` 注册名集合与迁移前一致（有意增删的单独记录）。

## 3. 版本族与破坏点速查

坐标以 lib/versions.js 为准；本表只列「迁移动手点」，完整动作清单见 references/api/version-migration.md，API 改名见 references/api/api-renames.md。

| 族 | Java | Gradle（模板钉选） | 映射 | 元数据文件 | 主要破坏点 |
| --- | --- | --- | --- | --- | --- |
| 1.7.10 | 8 | 7.4.2（FG 1.2 fork） | MCP | `mcmod.info` | 无 `runClient/runServer`；`GameRegistry.registerBlock/registerItem` + `setTextureName` + `CreativeTabs.tabMisc`；`cpw.mods.fml` 包；JDK 必须真 8 |
| 1.12.2 | 8 | 4.9（FG 3.0.197） | MCP snapshot 20171003-1.12 | `mcmod.info` + `pack.mcmeta`（3） | FML 三阶段生命周期；`RegistryEvent.Register<T>` + `setRegistryName`；`GameRegistry.register` 已废弃；Gradle 4.9 只能配 Java 8~10 |
| 1.16.5 | 8（运行时与模板 toolchain） | 7.3.3（FG 5.1.77） | official 1.16.5 | `mods.toml` + `pack.mcmeta`（6） | `@Mod("modid")` 单参；mod bus 出现（`FMLJavaModLoadingContext`）；`AbstractBlock.Properties`；注册前手动 `setRegistryName` |
| 1.20.1 | 17 | 8.8（FG 6.0.54）/ 8.14.5（NeoForge legacyforge） | official 1.20.1 | `mods.toml` | Forge 最后一次发版；Forge↔NeoForge 分叉；NeoForge 1.20.1 线仍是 `RegistryObject`（不是 `DeferredHolder`） |
| 1.20.4 | 17 | 8.x（无钉选模板） | official 1.20.4 | NeoForge 20.2+ 用 `neoforge.mods.toml` | Forge 已停更；NeoForge 20.2~20.4 坐标本仓库未钉选（已核实：lib/versions.js 的 19 个组合无 1.20.2~1.20.4 条目）；该线本身与 `neoforge.mods.toml` 切换点 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |
| 1.20.5+ | 21 | 8.5+（本仓库无 1.20.5 模板；1.21 线模板钉 9.2.1） | official | `neoforge.mods.toml` | Java 21 分界；`ItemStack` NBT→`DataComponents`；网络 `SimpleChannel`→payload；NeoForge 20.6 起 `DeferredHolder`（本仓库已核实 1.20.6 统一） |
| 1.21.x | 21 | 9.2.1（NeoForge 21.11.45）/ 9.5.1（Fabric loom 1.17.19） | official（1.21.11 mojmap 改 `Identifier`；Fabric 历史工程多为 Yarn） | `neoforge.mods.toml` / `fabric.mod.json` | 1.21.2 起 `new ResourceLocation` 不可用（构造器私有）；`CreativeModeTab.TAB_*` 移除；1.21.2+ 物品创建要求 `Item.Properties().setId(...)`；1.21.11 起 mojmap `ResourceLocation`→`Identifier` |
| 26.x | 25 | 9.2.1（NeoForge 26.2.0.59 / 26.3.0.12-beta）/ 9.5.1（Fabric 26.3） | 26.1 起不混淆（无映射） | `neoforge.mods.toml` / `fabric.mod.json` | 26.1 起官方名 + 参数名直用；Yarn 工程必须先迁 mojmap；26.3 的 NeoForge 仅 `-beta`、Paper 仅 `-alpha` |

> 「1.20.5+ 网络改 payload」与「DataComponents 具体签名」：前者的边界与签名 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核）；后者的 1.20.5 边界已核实（minecraft.wiki Pack_format：1.20.5~1.20.6 起物品堆的松散 NBT 改为结构化组件；Fabric Custom Data Components 页确认 1.20.5 起用新组件系统），具体 Java 签名以目标版本 javadoc 为准。详细行见 references/api/api-renames.md。

## 4. 迁移判定：就地改还是再生骨架

先回答一个问题：**目标与源是不是同一个加载器、同一条构建链？** 不是，默认再生骨架（第 2 节）；是，再按下面判。

| 条件 | 就地改暴露 `build.gradle` | 再生骨架 |
| --- | --- | --- |
| 同加载器、只差 1~2 个 minor（如 1.21.1→1.21.11、26.2→26.3） | 优 | 可，但迁移收益小 |
| 构建链换代（FG→moddev、MCP→official、Java 8→17/21/25） | 劣（脚本要整体重写） | 优 |
| 跨加载器（Forge→NeoForge、Spigot→Paper、Forge↔Fabric） | 不可行 | 必须 |
| 源工程已失修（旧 Gradle 跑不动、插件坐标下线、无 wrapper） | 先修构建再谈 | 直接生成目标骨架 |
| 资源/数据生成/CI/发布链已接好且要保留 | 优 | 需重建这些配置 |
| 代码量 < 骨架成本（小模组、单类插件） | 可 | 通常更快 |

就地改的最小改法（同加载器小版本）：只动 `build.gradle` 的 MC 版本、映射版本、加载器/插件版本，然后 `mc_gradle build` 闸门 → 逐个修编译错误 → `runClient`/`runData`。不要顺手升级 Gradle wrapper，除非版本表要求。

**存档/注册名兼容**（两种路线都适用）：

- `modid` 不改。改 modid 等于换模组，旧存档的注册项全部丢失。
- 注册名（`namespace:path`）是存档契约：物品/方块/实体/维度/配方/标签的 id 一旦发布就固定。迁移只改 API 写法，不改短名。
- 删除注册项前想清楚：已放置方块变空气/未知方块，物品引用变 missing item。要下线的内容保留注册项、只停用功能。
- 语言键、模型/方块状态路径、配方 JSON 里的物品 id 都跟注册名绑定；改名等于资源缺失 + 配方失效。
- 1.20.5+ 的 NBT→DataComponents 迁移要处理存档里的旧数据：1.20.5 起物品堆 NBT 已改结构化组件（已核实：minecraft.wiki Pack_format 的 1.20.5~1.20.6 行）；旧存档逐键升级的具体机制 UNVERIFIED（需真机验证，2026-10-21 未跑对应版本），用存档副本实测。
- 新版存档不能被旧版读取；迁移测试一律用存档副本。

## 5. 迁移完成判据

- 源/目标 from→to 表齐全；目标版本在 lib/versions.js 有钉选组合，或明确记录了例外理由。
- `mc_gradle build` 退出码 0，且零改动骨架与迁移后代码两次都过。
- `runClient` 到主菜单、`runServer` 到 `Done`，日志里没有 `NoSuchMethodError` / `InjectionError` / missing texture。
- 注册名集合与迁移前一致（`modid:name` 逐项 diff），存档副本能进世界。
- `runData` 通过，生成物没有被手改。
- 所有未核实条目要么已补证据、要么带具体原因登记进 references/api/forge-to-neoforge.md 第 7 节待复核清单，没有「先这样」的猜测。

## 6. 参考文件索引

| 文件 | 用途 |
| --- | --- |
| `references/api/version-migration.md` | 版本族边界表（含 lib/versions.js 钉选坐标）、每族从上一族迁来的动作清单、工序与每步验收标准 |
| `references/api/api-renames.md` | 重命名/替换五行表：注册、网络、数据、方块物品、事件总线、资源定位、26.x 专项；关键行标「本仓库已核实 / 未核实（含原因）」 |
| `references/api/mappings-and-lookup.md` | MCP / SRG / official(mojmap) / Yarn / Intermediary 的关系，各线查名字入口，批量改名工作流 |
| `references/api/forge-to-neoforge.md` | Forge 1.20.1（FG6）→ NeoForge 1.21.x（moddev）对照：构建、包名、事件总线、DeferredRegister、元数据、左右代码 |
