# 版本族迁移参考（构建 → 注册 → 网络/数据 → 资源）

> 核对日期：2026-10。坐标唯一来源：lib/versions.js（19 个钉选组合，`mc_scaffold` 直接注入；fabric / forge / neoforge 严格匹配）。本文件未列的组合（1.20.2~1.20.4、1.20.1 以外的 Forge 线、1.20.1 之前的 NeoForge）本仓库没有钉选坐标，按未核实处理并写明原因。Java/Gradle 配对规则见 assets/skills/minecraft-java-build/SKILL.md 第 1 节（Java 25 需 Gradle ≥ 9.1、Java 24 ≥ 8.14、Java 21 ≥ 8.5、Java 17 ≥ 7.3）。

## 1. 版本族边界表

### 1.1 模组加载器线

| 族 | 代表 MC | Java | Gradle | 构建插件 / 加载器 | 映射 | 元数据 | lib/versions.js 钉选 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.7.x | 1.7.10 | 8 | 7.4.2 | FG fork `1.2-1.1.+` / Forge `10.13.4.1614-1.7.10` | MCP `stable_12` | `mcmod.info` | 有（`forge` 的 `1.7`） |
| 1.12.x | 1.12.2 | 8 | 4.9 | FG `3.0.197` / Forge `14.23.5.2860`，MCP `snapshot_20171003-1.12` | MCP | `mcmod.info` + `pack.mcmeta`（3） | 有（`1.12`） |
| 1.16.x | 1.16.5 | 8（运行时与模板 toolchain） | 7.3.3 | FG `5.1.77` / Forge `36.2.39` | official `1.16.5` | `mods.toml` + `pack.mcmeta`（6） | 有（`1.16`） |
| 1.20.1 Forge | 1.20.1 | 17 | 8.8 | FG `6.0.54` / Forge `47.3.0` | official `1.20.1` | `mods.toml` | 有（`forge` 的 `1.20`） |
| 1.20.1 NeoForge | 1.20.1 | 17 | 8.14.5 | moddev `2.0.91`（legacyforge）/ NeoForge `47.1.3` | official `1.20.1` | `mods.toml` | 有（`neoforge` 的 `1.20`） |
| 1.21.1 | 1.21.1 | 21 | 9.2.1 | moddev `2.0.144` / NeoForge `21.1.249` | official | `neoforge.mods.toml`（**必须显式 `modLoader="javafml"`**，见 assets/skills/minecraft-neoforge-mod/SKILL.md:11） | 有（`neoforge` 的 `1.21.1`） |
| 1.21.x 主线 | 1.21.11 | 21 | 9.2.1（NeoForge）/ 9.5.1（Fabric） | moddev `2.0.144` / NeoForge `21.11.45`；loom `1.17.19` / loader `0.19.3` / Fabric API `0.141.6+1.21.11` | official（mojmap 已改用 `Identifier`） | `neoforge.mods.toml` / `fabric.mod.json` | 有（`1.21`） |
| 26.x 现行 | 26.2 | 25 | 9.2.1 / 9.5.1 | moddev `2.0.144` / NeoForge `26.2.0.59`；loom `1.17.19` / loader `0.19.3` / Fabric API `0.157.0+26.2` | 26.1 起不混淆 | 同上 | 有（`26`） |
| 26.3 | 26.3 | 25 | 9.2.1 / 9.5.1 | moddev `2.0.147` / NeoForge `26.3.0.12-beta`；loom `1.17.21` / loader `0.19.5` / Fabric API `0.161.0+26.3` | 不混淆 | 同上 | 有（`26.3`） |
| 1.20.2~1.20.4 | 1.20.4 | 17 | 8.x（无钉选） | Forge 已停更；NeoForge 20.2~20.4 | official 1.20.4 | `neoforge.mods.toml`（NeoForge 20.2 起） | 无（已核实：lib/versions.js 的 19 个组合无 1.20.2~1.20.4 条目）；该线存在性与元数据切换点 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |

### 1.2 服务端插件线（Paper / Spigot）

| 族 | 平台 | Java | 坐标（由 lib/versions.js 推导） | 钉选 |
| --- | --- | --- | --- | --- |
| 1.7.10 | Spigot | 8 | `org.spigotmc:spigot-api:1.7.10-R0.1-SNAPSHOT`（无公共 maven，模板用 vendored jar） | 有 |
| 1.12.2 | Spigot | 8 | `org.spigotmc:spigot-api:1.12.2-R0.1-SNAPSHOT`（Spigot hub nexus） | 有 |
| 1.20.6 | Paper | 21 | `io.papermc.paper:paper-api:1.20.6-R0.1-SNAPSHOT` | 有（paper `1.20`，Gradle 8.14.3） |
| 1.21.8 | Paper | 21 | `io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT` | 有（`1.21`） |
| 26.2 | Paper | 25 | `io.papermc.paper:paper-api:26.2.build.+` | 有（`26`） |
| 26.3 | Paper | 25 | `io.papermc.paper:paper-api:26.3.build.+`（2026-10 起为 `-stable`，实测 `26.3.build.209-stable`） | 有（`26.3`） |

Paper 坐标由 lib/versions.js 的 `paperApiVersion` 生成：1.x 版本线返回 `<mc>-R0.1-SNAPSHOT`，26.x 返回 `<line>.build.+`。

## 2. 每族「从上一族迁来的动作清单」

### 2.1 1.7.10 → 1.12.2

- 构建：wrapper `7.4.2`→`4.9`；FG `1.2-1.1.+`→`3.0.197`；MCP `stable_12`→`snapshot_20171003-1.12`；JDK 保持 8（Gradle 4.9 只支持 Java 8~10，见 assets/skills/minecraft-java-build/SKILL.md 第 5 节）。
- 注册：`GameRegistry.registerBlock/registerItem` → `RegistryEvent.Register<Block/Item>` + `setRegistryName`（1.12.2 必须设注册名）；`GameRegistry.register` 在 1.12.2 已废弃（见 assets/skills/minecraft-forge-mod/references/api/forge-1.12.2-api.md:41）；`registerTileEntity` / `registerWorldGenerator` 仍可用（同文件 :75）。
- 生命周期：`@Mod` 形态不变，仍是 FML 三阶段（preInit/init/postInit）+ `@Mod.EventHandler`。
- 方块/物品：`setTextureName` 删除（只有 1.7.10 有）；`setUnlocalizedName` 保留（1.12.2 见 :53）；`CreativeTabs.tabMisc` → `CreativeTabs.MISC`（:77）。
- 事件：包 `cpw.mods.fml.common.eventhandler` → `net.minecraftforge.fml.common.eventhandler`；`@SidedProxy` 保留。
- 元数据：`mcmod.info` 保留；新增 `pack.mcmeta`（`pack_format: 3`）；`reobfJar` 成为独立任务，jar 需要 `jar.finalizedBy('reobfJar')`（见 assets/skills/minecraft-forge-mod/SKILL.md:47）。
- 验收：`mc_gradle build` 退出码 0；`runClient` 到主菜单；`runServer` 到 `Done`；注册名集合与 1.7.10 一致。

### 2.2 1.12.2 → 1.16.5

- 构建：Gradle `4.9`→`7.3.3`；FG `3.0.197`→`5.1.77`；MCP → official `1.16.5`；Java 8 不变（模板 toolchain 也是 8，见 java-build 表）。
- 主类：`@Mod(modid=..., name=..., version=...)` 属性形态 → `@Mod("modid")` 单参；FML 三阶段 → 构造器初始化 + mod bus 事件（`FMLCommonSetupEvent` 等）。
- 注册：`RegistryEvent.Register<T>` → `DeferredRegister.create(ForgeRegistries.X, MODID)` + `RegistryObject<T>`（1.16.5 形态见 assets/skills/minecraft-forge-mod/references/api/forge-modern-api.md:72-102）；1.16.5 仍要注册前 `setRegistryName`。
- 事件：`SubscribeEvent` 包变 `net.minecraftforge.eventbus.api`；game bus 仍是 `MinecraftForge.EVENT_BUS`；`@SidedProxy` → `DistExecutor` / `@OnlyIn`。
- 命令：`CommandRegistryEvent` → `RegisterCommandsEvent` + Brigadier。
- 资源：物品纹理从代码指定改为 JSON 模型 + 方块状态；`pack_format` 6。
- 元数据：`mcmod.info` → `META-INF/mods.toml`（`modLoader="javafml"`、`loaderVersion="[36,)"`、`[[mods]]`、`[[dependencies]]` 的 forge/minecraft；见 forge-modern-api.md:167-182）。
- 验收：build 0；`runClient` 进世界；无 missing texture；注册名不变。

### 2.3 1.16.5 → 1.20.1

- 构建：Gradle `7.3.3`→`8.8`；FG `5.1.77`→`6.0.54`；Java 8→17（toolchain + foojay 自动下载 JDK 17）。
- 方块：`AbstractBlock.Properties.of(...)` → `BlockBehaviour.Properties.of(...)`（1.17+ 改名，见 forge-modern-api.md:103）；`Material` 用法按 1.20.1 javadoc 核对。
- 注册：DeferredRegister + `RegistryObject` 不变；注册名仍由 DeferredRegister 自动生成（1.20.1 不再手动 `setRegistryName`）。
- 数据生成：`GatherDataEvent` 包在 1.20.1 是 `net.minecraftforge.data.event`（1.16.5 的包名不同，迁移时以 IDE 跳转为准）；`runData` 输出 `src/generated/resources`。
- 事件：`TickEvent` 等拆 Pre/Post（1.20.1 形态查 javadoc）；`RegisterCommandsEvent` 保留。
- 元数据：`mods.toml` 的 `loaderVersion="[47,)"`、`pack_format` 15（见 assets/skills/minecraft-forge-mod/SKILL.md:15）。
- 验收：build 0；`runData` 生成成功；`runClient` 进世界；注册名不变。

### 2.4 1.20.1 Forge → 1.21.x NeoForge（跨加载器）

同时跨「加载器 + 大版本」，用再生骨架，按 references/api/forge-to-neoforge.md 的对照表逐项改。

- 构建：FG6 → `net.neoforged.moddev` `2.0.144`；Gradle `8.8`→`9.2.1`；Java 17→21；元数据 `mods.toml`→`neoforge.mods.toml`。
- 包名：`net.minecraftforge.*` → `net.neoforged.*`（完整对照见 forge-to-neoforge.md 第 2 节）。
- 总线：`FMLJavaModLoadingContext` 移除 → `@Mod` 构造器注入 `IEventBus`；game bus → `NeoForge.EVENT_BUS`；`@EventBusSubscriber` 的 `Bus.FORGE` 改 `Bus.GAME`。
- 注册：`RegistryObject`→`DeferredHolder`；`ForgeRegistries.ITEMS`→`Registries.ITEM`。
- 数据：1.20.5+ 的 `ItemStack` NBT→`DataComponents`（边界已核实：minecraft.wiki Pack_format 的 1.20.5~1.20.6 行；方法签名以 javadoc 为准）；网络 `SimpleChannel`→payload，签名 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核），见 api-renames.md。
- 验收：build 0；`runClient` 进世界；同 `modid` + 同注册名的旧存档可进；物品/方块/配方都在。

### 2.5 1.20.1 → 1.20.5 / 1.21.1（Java 21 + 数据组件）

- 构建：Java toolchain 17→21（Gradle 需 ≥ 8.5；模板给 `9.2.1`）；NeoForge 定到 `21.1.249`（1.21.1）或 `21.11.45`（1.21.11），moddev `2.0.144`。
- 注册：NeoForge 20.6 起 `DeferredRegister.register` 返回 `DeferredHolder`，`RegistryObject` 不再存在（见 assets/skills/minecraft-neoforge-mod/references/api/deferred-register.md:30-34）。
- 物品数据：`ItemStack.getTag()` / `getOrCreateTag()` 移除 → `get(DataComponents.X)` / `set(...)`（组件系统与 1.20.5 边界已核实：Fabric Custom Data Components 页、minecraft.wiki Pack_format）；自定义数据用 `CustomData`，其具体方法名 UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核），查 1.20.5+ javadoc。
- 物品创建：1.21.2+ vanilla 要求 `Item.Properties().setId(ResourceKey)`（Fabric 侧已核实，见 assets/skills/minecraft-fabric-mod/references/api/registries-and-items.md:40-46）；NeoForge 的 DeferredRegister 是否代劳 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核），生成骨架后先看模板写法。
- 网络：`SimpleChannel` 体系移除，改 `CustomPacketPayload` + `PayloadRegistrar`，签名 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核），见 api-renames.md 第 2 节。
- 创造栏：`CreativeModeTab.TAB_*` 在 1.21 移除（见 forge-modern-api.md:104）；Fabric / vanilla 替代写法已核实（`FabricCreativeModeTab.builder()` + `Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, key, tab)`）；NeoForge 侧替换写法 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核），查目标版本 `CreativeModeTab` 注册示例。
- 元数据：1.21.1 必须写 `modLoader="javafml"`；21.11+ 该字段不再需要（见 assets/skills/minecraft-neoforge-mod/SKILL.md:11）。
- 数据包：`pack.mcmeta` 的 `pack_format` 按目标线抄模板；minecraft.wiki Pack_format 已核实：1.20.5~1.20.6 资源包 32、1.21.7~1.21.8 为 64、1.21.9~1.21.10 为 69.0、1.21.11 为 75.0、26.2 为 88.0、26.3 为 97.1。
- 验收：build 0；`runData` 通过；`runClient` 进世界；旧存档物品的 NBT 数据能读到（或明确迁移策略）。

### 2.6 1.21.11 → 26.1 / 26.2 / 26.3（不混淆）

- 构建：Java 21→25（Gradle ≥ 9.1，模板 `9.2.1`）；NeoForge `21.11.45`→`26.2.0.59`（26.2）或 `26.3.0.12-beta`（26.3）；Fabric 侧 loom `1.17.19`→`1.17.21`（26.3）、loader `0.19.3`→`0.19.5`。
- 映射：26.1 起 Minecraft 不再混淆，无 Yarn / Intermediary / mojmap 之分，官方名 + 参数名直用（Fabric 官方 Migrating Mappings 页，2026-10 抓取）。Yarn 工程必须先迁到 mojmap 再上 26.x（见 2.7）。
- mixin：`method`/`target` 里的 Yarn 名全部要换成官方名；26.1 起没有映射层兜底，写错就是注入失败（见 assets/skills/minecraft-fabric-mod/references/api/mixins.md:91）。
- 生态：26.3 的 NeoForge 只有 `-beta`、Paper 只有 `-alpha`（见 assets/skills/minecraft-java-build/SKILL.md:21,28）；生产项目优先 26.2 或 1.21.11。
- 若工程用 Architectury：26.2→26.3 有 API 21.1→22 的移植变更（`LootEvent`、`ExtendedMenuDataProvider`、`BlockTransformerHooks`、`FuelRegistry`、`BiomeHooks` 等），见 assets/skills/minecraft-neoforge-mod/references/api/changes-26.3.md；该文件来源是 Architectury 移植指南，不是 NeoForge 核心变更清单。
- 验收：build 0；`runClient` 无 `InjectionError`；`runData` 通过；注册名不变；对照 26.3 的 beta/alpha 风险决定是否发版。

### 2.7 Fabric：Yarn → official mojmap → 26.x

- 先确认当前映射：Fabric 模板用 official Mojang mappings（见 assets/skills/minecraft-fabric-mod/SKILL.md:28）；老工程可能还是 Yarn。
- Yarn → mojmap：用 Loom 的 `migrateMappings`（不支持 Kotlin 工程）或 IntelliJ 的 Ravel 插件（支持 Kotlin），迁移后逐文件 review（Fabric 官方 Migrating Mappings 页，2026-10 抓取）。
- 26.1+：不再需要映射配置；官方名带参数名、无 Javadoc 的问题消失（26.1 之前 official 名无参数名与 Javadoc，需 Parchment 叠加）。
- mixin 的 `method`/`target` 字符串不会被 IDE 重命名覆盖，必须手工逐个改（见 mixins.md:91）。
- 验收：build 0；`runClient` 无注入错误；行为与迁移前一致（抽样对比）。

## 3. 工序与验收标准（先构建 → 注册 API → 网络/数据 → 资源）

固定顺序，任何一步不过不进下一步。每步结束后留一个可回滚的快照（提交或复制目录），回滚点就是闸门。

| 步 | 做什么 | 证据/命令 | 验收判据 |
| --- | --- | --- | --- |
| 0 基线 | 写 from→to 表：版本/加载器/插件/wrapper/映射/JDK/元数据 | lib/versions.js、java-build 表 | 表无空格；目标线是稳定线（26.3 要确认可接受 beta/alpha） |
| 1 构建链 | JDK、wrapper、构建插件、加载器坐标、映射 | `mc_gradle build`（零改动骨架） | 退出码 0；`runClient` 到主菜单 |
| 2 注册 API | DeferredRegister/RegistryEvent、注册名、物品/方块类、创造栏 | `mc_gradle build` | 编译通过；注册名集合与源工程一致 |
| 3 网络/数据 | 网络通道、NBT/DataComponents、存档数据、命令 | `mc_gradle build` → `runClient`/`runServer` | 编译通过；启动无 `NoSuchMethodError`；旧存档能进；收发包无异常 |
| 4 资源/元数据 | mods 元数据、pack.mcmeta、assets/data 路径、语言键、模型 | `runClient` 看日志 + 资源加载 | 无 missing texture/model；语言键不空；配方能加载 |
| 5 数据生成/配方 | `runData` 重新生成 models/blockstates/recipes/lang/tags | `mc_gradle runData` | 生成目录更新；生成物与手写内容不冲突；进游戏抽样验证 |

> 「能编译」只证明签名对上了；「能启动」才证明注册与总线对上了；「能进世界」才证明数据/资源对上了。三级闸门都过才算迁移完成。

## 4. 常见顺序错误

- 先改 Java 代码、最后才动 Gradle：满屏编译错误里分不清是「API 旧」还是「构建旧」，返工率最高。
- 一次复制整个 `src` 再编译：错误没有模块边界，修一个带出十个；按第 2 节逐模块搬。
- 用全局文本替换改包名/类名：资源路径、语言键、mixin 的 `method`/`target` 字符串会被误改，且 IDE 不会提示。
- 跳过 `runData` 手改生成物：下次 `runData` 直接覆盖；生成物只读、不手改。
- 只验证 `build` 就宣布完成：注册总线错误与资源缺失只在 `runClient`/`runServer` 阶段暴露。
