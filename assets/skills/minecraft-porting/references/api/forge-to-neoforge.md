# Forge 1.20.1 → NeoForge 1.21.x 迁移对照（D 方案）

> 核对日期：2026-10。范围：Forge 1.20.1（FG `6.0.54` + Forge `47.3.0`，Java 17，Gradle `8.8`，official 1.20.1，`mods.toml`）→ NeoForge 1.21.x（moddev `2.0.144` + NeoForge `21.11.45`，Java 21，Gradle `9.2.1`，`neoforge.mods.toml`）。1.21.1 是例外线（`21.1.249`，元数据必须显式 `modLoader`，见 assets/skills/minecraft-neoforge-mod/SKILL.md:11）；26.x 与 1.21.x 同构，只是 Java 25 与加载器版本不同。
> 事实源：assets/skills/minecraft-forge-mod/（1.20.1 形态）、assets/skills/minecraft-neoforge-mod/（21.x 形态）、lib/versions.js。标 UNVERIFIED 的条目写代码前查 docs.neoforged.net 或 javadoc（本次抓取该站超时，未取得原文）。
> 为什么叫 D 方案：Forge 在 1.20.2 之后不再发版（见 assets/skills/minecraft-forge-mod/SKILL.md:21），1.21+ 只有 NeoForge；所以 Forge 1.20.1 → 1.21.x 必然同时跨「加载器 + 大版本」。1.20.1 的 NeoForge 线（legacyforge `2.0.91` + `47.1.3`）只是 Forge 47 的分支，解决不了 1.21+ 需求。

## 1. 构建对照

| 项 | Forge 1.20.1 | NeoForge 1.21.x |
| --- | --- | --- |
| Gradle 插件 | `net.minecraftforge.gradle` `6.0.54` | `net.neoforged.moddev` `2.0.144` |
| Gradle wrapper | `8.8` | `9.2.1` |
| Java | 17（toolchain + foojay） | 21（toolchain + foojay） |
| 映射 | official `1.20.1` | NeoForm 管线自动处理（官方映射） |
| 加载器坐标 | Forge `47.3.0` | NeoForge `21.11.45`（1.21.1 用 `21.1.249`） |
| 元数据 | `META-INF/mods.toml` | `META-INF/neoforge.mods.toml` |
| 数据生成 | `runData` → `src/generated/resources` | 同左（`GatherDataEvent` 包名变） |
| 发布前处理 | `jar.finalizedBy('reobfJar')` | moddev 模板无 reobfJar 步骤（机制细节 UNVERIFIED） |

Forge 1.20.1 的 `build.gradle` 关键行（形状，版本号按 lib/versions.js）：

```groovy
plugins {
    id 'net.minecraftforge.gradle' version '6.0.54'
}
minecraft {
    mappings channel: 'official', version: '1.20.1'
}
dependencies {
    minecraft 'net.minecraftforge:forge:1.20.1-47.3.0'
}
```

NeoForge 1.21.x 的 `build.gradle` 关键行（形状）：

```groovy
plugins {
    id 'net.neoforged.moddev' version '2.0.144'
}
neoForge {
    version = '21.11.45'
}
```

> 两段都只是「形状」：完整块（run 配置、parchment、datagen、jarJar）以 `mc_scaffold` 生成的目标模板为准，不要手抄旧教程。moddev 2.0.147 是当前最新（26.3 线），1.21.x 模板用 `2.0.144`。

## 2. 包名对照

| Forge 1.20.1 | NeoForge 1.21.x | 说明 |
| --- | --- | --- |
| `net.minecraftforge.fml.common.Mod` | `net.neoforged.fml.common.Mod` | `@Mod` 注解 |
| `net.minecraftforge.fml.common.EventBusSubscriber` | `net.neoforged.fml.common.EventBusSubscriber` | 枚举 `Bus.FORGE`→`Bus.GAME`，`Bus.MOD` 保留 |
| `net.minecraftforge.eventbus.api.IEventBus` | `net.neoforged.bus.api.IEventBus` | 总线接口 |
| `net.minecraftforge.eventbus.api.SubscribeEvent` | `net.neoforged.bus.api.SubscribeEvent` | 监听注解 |
| `net.minecraftforge.common.MinecraftForge` | `net.neoforged.neoforge.common.NeoForge` | game bus 字段是 `NeoForge.EVENT_BUS` |
| `net.minecraftforge.registries.DeferredRegister` | `net.neoforged.neoforge.registries.DeferredRegister` | 注册器 |
| `net.minecraftforge.registries.RegistryObject` | `net.neoforged.neoforge.registries.DeferredHolder` | NeoForge 20.6 起统一（见 deferred-register.md:30-34） |
| `net.minecraftforge.registries.ForgeRegistries` | `net.minecraft.core.registries.Registries` | 注册表常量改用原版；如 `ForgeRegistries.ITEMS`→`Registries.ITEM` |
| `net.minecraftforge.registries.RegisterEvent` | `net.neoforged.neoforge.registries.RegisterEvent` | 注册事件 |
| `net.minecraftforge.event.*`（`ServerStartingEvent` 等） | `net.neoforged.neoforge.event.*` | 事件类整体换包 |
| `net.minecraftforge.fml.event.lifecycle.*` | `net.neoforged.fml.event.lifecycle.*` | `FMLCommonSetupEvent` 等 |
| `net.minecraftforge.data.event.GatherDataEvent` | `net.neoforged.neoforge.data.event.GatherDataEvent` | mod bus 数据生成事件（NeoForge 侧已核实，见 data-generation.md:20） |
| `net.minecraftforge.api.distmarker.Dist` / `OnlyIn` | `net.neoforged.api.distmarker.Dist` / `OnlyIn` | 客户端隔离（NeoForge 侧已核实，见 mod-bus-events.md:78） |
| `net.minecraftforge.fml.DistExecutor` | 目标版本等价写法（UNVERIFIED） | NeoForge 21.x 是否保留 `DistExecutor` 本仓库未核实 |
| `net.minecraftforge.fml.ModLoadingContext` | 移除；配置改 `@Mod` 构造器注入 `ModContainer`（UNVERIFIED） | 具体替代写法查 NeoForge 配置文档 |
| `net.minecraftforge.network.*` | `net.neoforged.neoforge.network.*` | `SimpleChannel`→payload（签名 UNVERIFIED） |

批量做法：用 IDE 的包名重构逐类改，不要全局文本替换；`net.minecraftforge` 出现在资源路径/字符串里的情况极少，但 `modId="forge"` 这类元数据字符串必须人工改。

## 3. `@Mod` 与事件总线

Forge 1.20.1：

```java
@Mod("examplemod")
public final class ExampleMod {
    public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(ForgeRegistries.ITEMS, "examplemod");

    public ExampleMod() {
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        ITEMS.register(modBus);
        modBus.addListener(this::commonSetup);
        MinecraftForge.EVENT_BUS.register(this);
    }

    private void commonSetup(FMLCommonSetupEvent event) { }
}
```

NeoForge 1.21.x：

```java
@Mod("examplemod")
public final class ExampleMod {
    public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(Registries.ITEM, "examplemod");

    public ExampleMod(IEventBus modBus) {
        ITEMS.register(modBus);
        modBus.addListener(this::commonSetup);
        NeoForge.EVENT_BUS.register(this);
    }

    private void commonSetup(FMLCommonSetupEvent event) { }
}
```

差异点：

1. **mod bus 的获取方式**：Forge 用全局上下文 `FMLJavaModLoadingContext.get().getModEventBus()`；NeoForge 移除该上下文，改为 `@Mod` 构造器参数注入 `IEventBus`（已核实，见 mod-bus-events.md:24-27）。
2. **game bus**：`MinecraftForge.EVENT_BUS` → `NeoForge.EVENT_BUS`（已核实，见 mod-bus-events.md:39）。
3. **`@EventBusSubscriber`**：包换 `net.neoforged.fml.common`；`bus = Bus.FORGE` → `bus = Bus.GAME`；`bus = Bus.MOD` 保留（已核实，见 mod-bus-events.md:36-50）。
4. **静态订阅**：不想用构造器参数的项目，可在 `@EventBusSubscriber(bus = Bus.MOD)` 类里收 mod bus 事件；`FMLJavaModLoadingContext` 的其他全局访问点是否还有替代（UNVERIFIED，查目标版本 javadoc）。
5. **生命周期事件**：`FMLCommonSetupEvent` 等仍在 mod bus 上，包变 `net.neoforged.fml.event.lifecycle`；`GatherDataEvent` 在 `net.neoforged.neoforge.data.event`（已核实）。

## 4. DeferredRegister 与注册差异

| 项 | Forge 1.20.1 | NeoForge 1.21.x |
| --- | --- | --- |
| 创建方式 | `DeferredRegister.create(ForgeRegistries.ITEMS, MODID)`（2 参） | `DeferredRegister.create(Registries.ITEM, MODID)`（2 参） |
| 旧构造器写法 | `new DeferredRegister<>(ForgeRegistries.ITEMS, MODID)`（2 参，已弃用） | 不再使用构造器；用静态 `create` |
| 第一参类型 | `IForgeRegistry<T>` | `Registry<T>` / `ResourceKey<Registry<T>>` |
| `register(...)` 返回 | `RegistryObject<T>` | `DeferredHolder<Registry<T>, T>` 形态（以 javadoc 为准） |
| 注册名 | 1.20.1 起由 DeferredRegister 自动拼 `modid:name` | 同左；不要双写 `setRegistryName` |
| 3 参 `create` | 本仓库未见 | 本仓库未见（UNVERIFIED）；若某版本提供，以 javadoc 为准 |

Forge 1.20.1 注册类：

```java
public final class ModItems {
    public static final RegistryObject<Item> RUBY =
        ExampleMod.ITEMS.register("ruby", () -> new Item(new Item.Properties()));
}
```

NeoForge 1.21.x 注册类：

```java
public final class ModItems {
    public static final DeferredHolder<Item, Item> RUBY =
        ExampleMod.ITEMS.register("ruby", () -> new Item(new Item.Properties()));
}
```

注意：

- 1.21.2+ vanilla `Item.Properties` 要求 `setId(ResourceKey)`（Fabric 侧已核实，见 registries-and-items.md:40-46）；NeoForge 的 DeferredRegister 是否代劳 UNVERIFIED，生成骨架后照模板写。
- 1.21 起 `CreativeModeTab.TAB_MISC` 等常量移除（见 forge-modern-api.md:104），创造栏条目改走注册；替代写法 UNVERIFIED。
- `block` / `item` / `entity` 等注册表常量名改成原版 `Registries.*`，不是简单把 `ForgeRegistries` 换成 `Registries` 就完事（`ITEMS` 是复数、`ITEM` 是单数这类差异逐个对）。

## 5. 元数据对照

| 项 | `mods.toml`（Forge 47.x） | `neoforge.mods.toml`（NeoForge 21.x） |
| --- | --- | --- |
| 路径 | `src/main/resources/META-INF/mods.toml` | `src/main/resources/META-INF/neoforge.mods.toml` |
| `modLoader` | 必填 `"javafml"` | 1.21.1 必填；21.11+/26.x 不写 |
| `loaderVersion` | 必填（如 `"[47,)"`） | 1.21.1 必填；21.11+/26.x 不写 |
| `license` | 必填 | 必填 |
| `[[mods]]` | 必填：`modId`、`version`、`displayName`、`description` | 同左；`authors` 可选 |
| 依赖块 | `[[dependencies]]` 声明 `modId="forge"` + `modId="minecraft"` | 声明 `modId="neoforge"` + `modId="minecraft"`（`type="required"` 等字段照目标模板） |
| 版本占位 | `${mod_version}` 由 `processResources` 展开 | 同左（模板已配） |
| `pack.mcmeta` | `pack_format` 15 | 数值按目标版本抄模板（1.21.x 具体值 UNVERIFIED） |

Forge 1.20.1 最小形状：

```toml
modLoader = "javafml"
loaderVersion = "[47,)"
license = "MIT"

[[mods]]
modId = "examplemod"
version = "${mod_version}"
displayName = "Example Mod"
description = '''Example.'''
```

NeoForge 21.11+ 最小形状：

```toml
license = "MIT"

[[mods]]
modId = "examplemod"
version = "${mod_version}"
displayName = "Example Mod"
description = '''Example.'''

[[dependencies.examplemod]]
modId = "neoforge"
type = "required"
versionRange = "[21.11,)"
ordering = "NONE"
side = "BOTH"
```

> 1.21.1 目标要在文件头补 `modLoader = "javafml"` 与 `loaderVersion`（值抄 `mc_scaffold` 生成的 1.21.1 模板，本仓库未给具体值）。21.11+ 不要写这两个字段。

## 6. 迁移动作清单

1. 用 `mc_scaffold` 在空目录生成 NeoForge 1.21.x 骨架（1.21.1 注意显式 modLoader；26.x 换版本号）。
2. 把 `build.gradle` 换成 moddev 形状（第 1 节），wrapper 换 `9.2.1`，toolchain 换 21。
3. IDE 包名重构：`net.minecraftforge.*`→`net.neoforged.*`（第 2 节表），`MinecraftForge`→`NeoForge`。
4. 主类改造：构造器注入 `IEventBus`，删掉 `FMLJavaModLoadingContext`（第 3 节）。
5. 注册类改造：`ForgeRegistries`→`Registries`，`RegistryObject`→`DeferredHolder`（第 4 节）。
6. 元数据重写：`mods.toml`→`neoforge.mods.toml`，`forge` 依赖改 `neoforge`（第 5 节）。
7. 数据与网络：1.20.5+ 的 DataComponents 与 payload 网络单独排期（见 references/api/api-renames.md 第 2、3 节）。
8. 资源路径不变（`assets/<modid>`、`data/<modid>`）；`pack.mcmeta` 按目标模板。
9. 闸门：`mc_gradle build` → `runClient` 进世界 → `runData` 通过。

## 7. 无法确证清单（UNVERIFIED）

- NeoForge 21.x 的 `DistExecutor` / `ModLoadingContext` 替代写法。
- `DeferredRegister.create` 是否存在 3 参形态（本仓库与已抓取来源均未见）。
- NeoForge DeferredRegister 是否自动为 1.21.2+ 的 `Item.Properties` 补 `setId`。
- 1.21 移除 `CreativeModeTab.TAB_*` 后的推荐替代写法。
- 网络层 `SimpleChannel`→payload 的版本边界与全部签名。
- `GatherDataEvent` 在 Forge 1.16.5 的包名（NeoForge 侧已核实为 `net.neoforged.neoforge.data.event`）。
- 1.20.5+ 数据组件的 `CustomData` 具体方法名与存档迁移机制。
- NeoForge 21.x 的 `pack_format` 数值。
- moddev 模板是否完全没有 reobf 等价步骤（模板里没有 `reobfJar` 任务，机制未核实）。
