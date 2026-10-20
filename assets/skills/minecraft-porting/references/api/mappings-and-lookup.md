# 映射体系与查询工作流（MCP / SRG / official / Yarn）

> 核对日期：2026-10。外部来源：Fabric 官方「Migrating Mappings」页（https://docs.fabricmc.net/develop/porting/mappings/ ，2026-10 抓取）——Intermediary / Yarn / Mojang mappings 三套名字、Mojang 映射缺参数名与 Javadoc、Parchment 叠加、26.1 起不混淆、Loom `migrateMappings` 与 Ravel 工具。仓库来源：assets/skills/minecraft-forge-mod、minecraft-neoforge-mod、minecraft-fabric-mod 的 SKILL.md 与 references/api/。标 UNVERIFIED 的工具/结论写代码前以官方文档为准。

## 1. 三代映射的关系

同一个符号在三个层次上有不同的名字：**混淆名**（Minecraft 官方 jar 里的 `a`、`b`、`func_12345_a`）↔ **中间名**（SRG / Intermediary，跨版本稳定的过渡名）↔ **源码名**（MCP / Yarn / official，给人读的名字）。迁移时先搞清目标版本处在这三层的哪一层，再决定「改代码」还是「只改构建」。

| 名称 | 谁维护 | 用途 | 出现线 |
| --- | --- | --- | --- |
| MCP | 社区（Mod Coder Pack） | 1.7.10 / 1.12.2 Forge 的源码名（`func_xxx` → 语义名） | 1.7.10、1.12.2（Forge） |
| SRG | Forge（Searge） | Forge 运行时稳定中间名；dev jar 经 reobf 转 SRG | 1.16.5 及以前 |
| official（Mojang mappings / mojmap） | Mojang | 官方名；1.16.5 起 Forge 可选用，1.17+ 直接用于运行时 | 1.16.5 起，1.17+ 为主 |
| Intermediary | Fabric | Fabric 的稳定中间名（`class_1548` 之类），编译产物跨版本稳定 | Fabric 全线（≤ 1.21.11） |
| Yarn | Fabric 社区 | Fabric 的可读源码名；2025 年起弃用 | Fabric ≤ 1.21.11 |
| 无（不混淆） | Mojang | 官方名 + 参数名直接就是源码名 | 26.1 起 |

| 概念 | 1.12.2 Forge | 1.16.5 Forge | 1.17~1.21.11 Forge/NeoForge | Fabric（≤1.21.11） | 26.1+ |
| --- | --- | --- | --- | --- | --- |
| 源码名 | MCP | official | official | Yarn（历史默认）或 official | official |
| 中间名 | SRG | SRG | 无（official 直用） | Intermediary | 无 |
| 运行时名 | SRG | SRG | official | Intermediary | official |
| 发布前处理 | reobfJar | reobfJar | 无（official 直用） | remap（loom 负责） | 无 |

> 「1.17+ 运行时 official 直用」是生态通行说法，本仓库未对 1.17+ 的 jar 逐个 `javap` 核对（UNVERIFIED 风险可控）：迁移前抽验一个类（如 `net.minecraft.world.item.Item`）即可确认名字形态。

### 读名字时的三个自问

| 自问 | 为什么重要 | 怎么查 |
| --- | --- | --- |
| 这个名字是源码名还是中间名？ | SRG / Intermediary 名不能直接写进源码，写错要么编译不过、要么运行时炸 | IDE 跳转；`javap` 看真实类名/方法名 |
| 这个名字属于哪个版本线？ | 教程混用 1.12.2 的 MCP 名与 1.20.1 的 official 名，是最常见的编译错误来源 | 先看工程 `build.gradle` 的 mappings 行 |
| 它有没有被改名或换包？ | 类改名（`AbstractBlock`→`BlockBehaviour`）、包改名（`net.minecraftforge`→`net.neoforged`）不会以「旧名不存在」的直观方式报错 | 本技能 references/api/api-renames.md 与 references/api/forge-to-neoforge.md |

判断顺序建议：先确认「目标版本有没有这个类」→ 再确认「类的包名」→ 最后确认「方法签名」。三步都过再写代码，能省掉一半返工。


## 2. 各线「查名字」的入口

| 线 | 源码名从哪来 | 反编译 / 查看入口 | 备注 |
| --- | --- | --- | --- |
| 1.7.10 / 1.12.2 Forge | MCP 名（构建时生成） | FG 的生成源码任务；`javap -p -s`；老 javadoc（URL 以官方为准，UNVERIFIED） | 1.7.10 没有 `runClient/runServer`，用 `setupDevWorkspace` + `build`（见 assets/skills/minecraft-forge-mod/SKILL.md 第 6 节） |
| 1.16.5 / 1.20.1 Forge | official 名（FG5/FG6 自动反编译） | IDEA 跳转；`javap` | 1.16.5 模板已是 official；老工程若残留 MCP 名会编译不过（1.16.5 是否仍可选 MCP 映射，UNVERIFIED） |
| 1.21.x / 26.x NeoForge | official 名（NeoForm 管线） | IDEA 跳转；`javap`；Mojang 官方名 | 21.x 可选 Parchment 补参数名（见 assets/skills/minecraft-neoforge-mod/SKILL.md:29） |
| Fabric（≤1.21.11） | Yarn 或 official | loom 生成源码（`gradlew genSources`，任务名以 loom 文档为准，UNVERIFIED）；IDEA；`javap` | 模板用 official Mojang mappings（见 assets/skills/minecraft-fabric-mod/SKILL.md:28） |
| 26.1+ | 官方名（无混淆） | 直接反编译 jar / IDEA | 不需要映射配置（Fabric 官方页，2026-10 抓取） |

## 3. 查询工具

| 工具 | 用途 | 状态 |
| --- | --- | --- |
| IntelliJ IDEA + Gradle 导入 | 跳转、补全、重命名重构；最可靠的一手入口 | 通用，推荐 |
| `javap -p -s` / `javap -c` | 看 class 的真实签名、描述符、字节码；核对「方法到底在不在」 | 通用，仓库内验证 API 也用它 |
| Linkie | 在线映射查询（MCP / Yarn / mojmap 互查） | UNVERIFIED：本次未抓取，URL 与可用性以官方文档为准 |
| Parchment | 在 official 上叠加参数名 / Javadoc | 仓库已核实模板含 Parchment 块（neoforge SKILL.md:29）；具体版本号查官网 |
| misode | 数据包 / 配方 / 模型 JSON 生成 | UNVERIFIED：本次未抓取 |
| Loom `migrateMappings` / Ravel（IntelliJ 插件） | Yarn → mojmap 批量迁移；Ravel 支持 Kotlin | Fabric 官方页已核实（2026-10 抓取） |
| Minecraft Wiki 版本页 / 官方 primer | 逐版本破坏点清单与数据格式变更 | UNVERIFIED：本次未抓取，作为交叉验证来源 |

## 4. 批量改名工作流

1. **先定映射**：目标版本是 official（1.17+）、Yarn（Fabric ≤1.21.11）、还是无映射（26.1+）。映射版本号必须等于 MC 版本（见 assets/skills/minecraft-forge-mod/SKILL.md:92）。
2. **生成/反编译源码**：NeoForm（moddev）、FG、loom 各自的反编译任务跑通，确认 IDE 能跳转到目标类。
3. **IDE 重构逐符号改**：Rename、Find Usages、Change Signature。不要全局文本替换——同名不同义的类很多，字符串里的名字会被误伤。
4. **单独处理字符串与注解里的名字**：mixin 的 `method` / `target`、`@Mod` 的 modid、`ResourceLocation` 路径、语言键、模型/配方路径。IDE 不会重命名这些。
5. **每改一批跑 `mc_gradle build`**：编译错误按「类 → 方法 → 字段」的顺序消灭；同一批不要混两个模块。
6. **编译过后跑 `runClient`**：mixin、反射、服务端专用类的错误只在启动期暴露（示例：`InjectionError`、`NoSuchMethodError`）。
7. **最后 `runData` + 注册名核对**：生成物更新，`modid:name` 集合与迁移前一致（有意增删的单独列）。

## 5. 映射相关踩坑

- **映射版本 ≠ MC 版本**：`mappings` 行必须与目标 MC 对齐；1.12.2 用 `snapshot_20171003-1.12`，1.16.5 用 `official 1.16.5`（见 lib/versions.js）。
- **Yarn / mojmap 混抄**：教程示例多为 Yarn 名，mojmap 工程直接抄会编译不过——`Registries`→`BuiltInRegistries`、`Item.Settings`→`Item.Properties`、`ServerCommandSource`→`CommandSourceStack`、`Identifier`（1.20.1 mojmap 是 `ResourceLocation`）（见 assets/skills/minecraft-fabric-mod/SKILL.md:138）。
- **SRG 时代必须 reobf**：1.12.2 / 1.16.5 发版前 `jar.finalizedBy('reobfJar')`（1.7.10 自动）；把 dev jar 发出去会在别人客户端炸 `NoSuchMethodError`（见 assets/skills/minecraft-forge-mod/SKILL.md:47,93）。
- **26.x 无映射 ≠ 不用管映射**：源码里的 Yarn 名全部要换，mixin 字符串尤其（见 assets/skills/minecraft-fabric-mod/references/api/mixins.md:91）。
- **26.3 没有官方文档页**：Fabric 文档只覆盖到 26.1.2（见 assets/skills/minecraft-fabric-mod/references/api/registries-and-items.md:8）；26.3 报错以反编译目标 jar 为准，别照 1.21 教程猜。
- **dev jar 与生产 jar 行为不同**：验证注册/资源用 `runClient`，发布验证用构建产物（1.12.2/1.16.5 还要确认 reobf 过）。

## 6. 迁移前最小核对清单

- [ ] 目标映射类型与版本号已确定（official / Yarn / 无），并写进构建脚本。
- [ ] IDE 能跳转到目标版本的核心类（`Item`、`Block`、`ResourceLocation`）。
- [ ] 反编译源码已生成（NeoForm / FG / loom 对应任务跑通）。
- [ ] 用 `javap` 抽验至少 3 个要用的 API（方法名、参数类型、返回类型）。
- [ ] mixin / 反射 / 注解字符串里的名字已经列成清单，准备手工改。
- [ ] 若用 Yarn 工程迁 26.x：确认迁移工具（Loom `migrateMappings` 或 Ravel）对工程语言的支持。
