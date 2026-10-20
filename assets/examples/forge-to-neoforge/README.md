# Forge 1.20.1 → NeoForge 1.21.11 迁移对照样例

> 用途：给 `minecraft-porting` 技能的 `references/api/forge-to-neoforge.md` 配一份**可逐行对照**的真实生成物。
> 来源：本目录两份工程均由 `mc_scaffold`（v0.11.0）用仓库模板生成，只保留了「迁移会改动」的 5 个文件（构建脚本、settings、gradle.properties、元数据、主类），wrapper / gradlew / pack.mcmeta 等未收录。
> 核对日期：2026-10。坐标与 `lib/versions.js` 一致；未在本机执行过完整 `gradlew build`，首次构建需下载依赖。

## 1. 重新生成完整工程

```text
mc_scaffold platform: "forge"    minecraftVersion: "1.20.1"  targetDir: "D:/tmp/forge-1.20.1"
mc_scaffold platform: "neoforge" minecraftVersion: "1.21.11" targetDir: "D:/tmp/neoforge-1.21.11"
```

参数：`name: "example-mod"`、`packageName: "com.example.examplemod"`，其余默认（forge 1.20.1 → Java 17，neoforge 1.21.11 → Java 21）。

## 2. 逐文件对照

| 关注点 | `forge-1.20.1/` | `neoforge-1.21.11/` |
|---|---|---|
| 构建插件 | `net.minecraftforge.gradle` **6.0.54** | `net.neoforged.moddev` **2.0.144** |
| Gradle wrapper | **8.8** | **9.2.1** |
| Java 级别 | **17**（`JavaLanguageVersion.of(17)`） | **21**（`JavaLanguageVersion.of(21)`） |
| 元数据文件 | `src/main/resources/META-INF/mods.toml` | `src/main/resources/META-INF/neoforge.mods.toml` |
| 加载器声明 | `modLoader="javafml"` + `loaderVersion="${loader_version_range}"` | 21.11 起可省略（走默认 `javafml`），`license` 必填 |
| 依赖段 modId | `forge` / `minecraft` | `neoforge` / `minecraft` |
| 版本区间来源 | `gradle.properties` 的 `forge_version_range` / `minecraft_version_range` / `loader_version_range` | `neo_version_range` / `minecraft_version_range` |
| 主类入口 | 无参构造：`FMLJavaModLoadingContext.get().getModEventBus()` | 构造器注入：`public ExampleMod(IEventBus modEventBus)` |
| 游戏事件总线 | `MinecraftForge.EVENT_BUS` | `NeoForge.EVENT_BUS`（`@SubscribeEvent` 对象需先 `register`） |
| 包名 | `net.minecraftforge.*` | `net.neoforged.*` |
| 映射 | `mappings channel: mapping_channel, version: mapping_version`（official） | NeoForm + 可选 Parchment（`parchment { }` 块） |
| 运行任务 | `runs { client / server / gameTestServer / data }` | `neoForge { runs { client / server / data } }` |
| 重混淆 | `jar { finalizedBy 'reobfJar' }` | 不需要 |
| 占位符展开 | `filesMatching(['META-INF/mods.toml', 'pack.mcmeta']) { expand replaceProperties }` | `filesMatching('META-INF/neoforge.mods.toml') { expand project.properties }` |

## 3. 迁移步骤（再生骨架 + 逐模块）

1. **留痕**：先建分支/备份，确认旧工程可构建（否则改坏了分不清是谁的错）。
2. **审计**：`mc_port_audit`（只读）输入源工程目录 + 目标 `neoforge 1.21.11`，先清 blocker（Gradle 过旧、Java 级别、元数据版本区间、已移除 API）。
3. **生骨架**：`mc_scaffold` 在**新目录**生成目标版本工程（目标必须是 19 个支持组合之一；`mc_scaffold` 要求空目录，不要覆盖旧工程）。
4. **搬 Java**：先主类（入口从无参构造 + `FMLJavaModLoadingContext` 换成构造器注入 `IEventBus`），再注册类（`DeferredRegister` 的工厂方法签名、`RegistryObject` → `DeferredHolder` 逐处编译验证），最后事件/网络/数据。
5. **搬资源**：`mods.toml` → `neoforge.mods.toml`（依赖段字段不同，不能只改名），语言文件/模型/配方原样搬。
6. **闸门**：每搬完一个模块跑一次 `mc_gradle`（`build` 或 `runServer`），blocker 清零再进下一模块。

## 4. 不要照搬的地方

- 1.20.1 的 `FMLJavaModLoadingContext.get().getModEventBus()` 在 NeoForge **不存在**，改构造器注入。
- `mods.toml` 不能直接改名为 `neoforge.mods.toml` 继续用：`[[dependencies]]` 的 modId 与区间字段都变了。
- `RegistryObject`（Forge）与 `DeferredHolder`（NeoForge）不是同一接口，`DeferredRegister.create` 签名也不同，逐处看目标版本 javadoc。
- 26.x 线没有 Parchment 块（见 `minecraft-neoforge-mod` 技能的 `references/api/changes-26.3.md`），别把 1.21.x 的配置抄到 26.x。

## 5. 边界声明

- 两份样例的构建脚本与元数据来自本仓库模板（模板本身有测试与真实构建记录）；主类中 `// TODO` 之后的业务 API 用法**以目标版本 javadoc 为准**。
- 本目录文件是静态生成物，裁剪时去掉了 `gradle/wrapper/`（样例只需要看构建脚本与元数据的差异），因此对两份样例跑 `mc_port_audit` 的结果是 **0 blocker、1 warning（`GRADLE_WRAPPER_MISSING`）**——这是裁剪造成的预期结果；真实工程用 `mc_scaffold` 生成时 wrapper 是齐的。
- `mc_port_audit` 已对这两份样例实跑验证（2026-10，`forge 1.20.1` 与 `neoforge 1.21.11` 均为 0 blocker）。
