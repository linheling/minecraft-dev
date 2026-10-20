# API 重命名与替换对照（跨版本）

> 核对日期：2026-10。四列含义：旧写法（源版本可用）→ 新写法（目标版本写法）→ 首次变化版本 → 备注。备注里的「本仓库已核实」指仓库内已有技能 references 写明，可直接引用；`UNVERIFIED（原因）` 指本机可达的仓库与外部来源均未确证，括号里写具体来源或验证缺口（如加载器官方源不可达 / 无可达官方页 / 需真机验证）；写代码前查 javadoc / 官方文档 / IDE 补全。本表给的是「写法形状」，不是可粘贴的完整签名，泛型与重载以目标版本 javadoc 为准。
> 已抓取的外部来源（2026-10-21）：Fabric 官方 Migrating Mappings、Networking、Custom Data Components、Custom Creative Tabs 页，以及 minecraft.wiki 的 Identifier / Pack_format / Data component 页；docs.neoforged.net 与 maven.neoforged.net 本机 10s 超时仍不可达，NeoForge 21.x 的行只信本仓库 references 或按上面格式标原因。

## 1. 注册

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `GameRegistry.registerBlock(...)` / `registerItem(...)`（1.7.10） | `RegistryEvent.Register<Block/Item>` + `setRegistryName(...)`（1.12.2） | 1.12.2（本仓库已核实已废弃） | 1.12.2 的 `GameRegistry.register` 已废弃；`registerTileEntity` / `registerWorldGenerator` 仍可用（本仓库已核实，见 assets/skills/minecraft-forge-mod/references/api/forge-1.12.2-api.md:41,75） |
| `RegistryEvent.Register<T>` + `setRegistryName` | `DeferredRegister.create(ForgeRegistries.X, MODID)` + `RegistryObject<T>` | 1.16.5 | 1.16.5 仍要注册前 `setRegistryName`；1.20.1 起名称由 DeferredRegister 自动生成（本仓库已核实，见 forge-modern-api.md:72-102） |
| `net.minecraftforge.registries.RegistryObject` | `net.neoforged.neoforge.registries.DeferredHolder` | NeoForge 20.6（1.20.6） | 1.20.1 legacyforge 线仍是 `RegistryObject`；21.x 的 `register` 返回 `DeferredHolder<Registry<T>, I>`（本仓库已核实，见 assets/skills/minecraft-neoforge-mod/references/api/deferred-register.md:30-34） |
| `DeferredRegister.create(ForgeRegistries.ITEMS, MODID)` | `DeferredRegister.create(Registries.ITEM, MODID)` | NeoForge 1.21.x | 参数量同为 2，第一参从 `IForgeRegistry` 换成原版 `Registry<T>` / `ResourceKey`；本仓库只列 2 参两种重载（已核实：deferred-register.md:15-17）；3 参形态是否存在 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核）；若目标版本提供，以 javadoc 为准 |
| `FMLJavaModLoadingContext.get().getModEventBus()` | `@Mod` 构造器参数 `IEventBus modEventBus` | NeoForge 1.21.x | mod bus 构造器注入在 NeoForge 侧已核实（见 mod-bus-events.md:24-27）；1.20.1 Forge 仍是上下文取 bus；该上下文移除的具体版本 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |
| `@Mod.EventBusSubscriber(modid = MODID, bus = Mod.EventBusSubscriber.Bus.FORGE)` | `@EventBusSubscriber(modid = MODID, bus = EventBusSubscriber.Bus.GAME)` | NeoForge 1.21.x | 枚举 `Bus.FORGE`→`Bus.GAME`、`Bus.MOD` 保留；包 `net.neoforged.fml.common.EventBusSubscriber`（NeoForge 侧已核实，见 mod-bus-events.md:36-50） |
| 手动 `setRegistryName("modid:name")` | DeferredRegister 的 `register("name", ...)` 自动拼 `modid:name` | 1.20.1（Forge） | 迁移时不要双写：DeferredRegister 已自动拼 `modid:name`（本仓库已核实，见 forge-modern-api.md:72-102），再手动 setRegistryName 会重复前缀 |
| `Item.Properties().tab(CreativeModeTab.TAB_MISC)`（1.20.1） | 1.21 起 `TAB_*` 移除，走创造栏注册 / 目标版本写法 | 1.21 | 1.20.1 有、1.21 移除已核实（见 forge-modern-api.md:104）；Fabric / vanilla 替代写法已核实（`FabricCreativeModeTab.builder()` + `Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, key, tab)`，docs.fabricmc.net/develop/items/custom-creative-tabs）；NeoForge 侧替代写法 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |
| `new Item.Properties()` 直接注册 | 1.21.2+ `new Item.Properties().setId(ResourceKey)` | 1.21.2 | vanilla / Fabric 侧已核实（见 assets/skills/minecraft-fabric-mod/references/api/registries-and-items.md:40-46）；NeoForge DeferredRegister 是否代劳 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |

## 2. 网络

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `SimpleNetworkWrapper` + `IMessage` / `IMessageHandler`（1.7.10 / 1.12.2） | `SimpleChannel` + `SimpleChannel.MessageBuilder` | 1.13 前后 | 本仓库未收录网络 API；这一行的版本边界 UNVERIFIED（Forge 1.13 网络页本机无正文，2026-10-21，待 CI/联网复核） |
| `NetworkRegistry.newSimpleChannel(...)` / `SimpleChannel`（1.16.5 / 1.20.1） | `CustomPacketPayload` + `PayloadRegistrar`（NeoForge 侧 `RegisterPayloadHandlersEvent`） | 1.20.5 | 本仓库未收录；Fabric 侧 payload 体系已核实（`CustomPacketPayload` + `PayloadTypeRegistry`，docs.fabricmc.net/develop/networking）；`SimpleChannel` 的废弃/移除版本与 1.20.5 边界 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核）；NeoForge 侧 `PayloadRegistrar` / `RegisterPayloadHandlersEvent` 类名同样待复核（同因） |
| `PacketByteBuf` 手写 encode/decode | payload record/class + `StreamCodec` | 1.20.5 | `StreamCodec` 用法已核实（Fabric networking 页示例）；1.20.5 边界 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核）；不要从旧工程直译网络层 |
| Fabric：`PacketByteBuf` + `ClientPlayNetworking.send` | Fabric：`CustomPacketPayload` + `PayloadTypeRegistry` + `StreamCodec` | 1.20.5 | 已核实（docs.fabricmc.net/develop/networking）：payload 类型用 `PayloadTypeRegistry.clientboundPlay().register(...)` / `serverboundPlay().register(...)` 注册，发送用 `ServerPlayNetworking.send(player, payload)` / `ClientPlayNetworking.send(payload)`，接收用 `registerGlobalReceiver(TYPE, handler)`；注意类名是 `CustomPacketPayload`，不要写成 `CustomPayload`。1.20.5 首次变化边界 UNVERIFIED（1.20.5+ 加载器官方源 2026-10-21 本机不可达，待 CI/联网复核） |

> 网络层是本次核对最薄的一节：Fabric 侧已拿到官方文档证据，NeoForge / Forge 侧仍只有本仓库 references。迁移网络代码时，标了未核实原因的行照目标平台官方文档的 networking 示例逐行写，写完 `runClient` + 双端发包验证，不要复用旧版教程。

## 3. 数据（ItemStack NBT → DataComponents）

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `stack.getTag()`（返回 `CompoundTag`，可能为 null） | `stack.get(DataComponents.CUSTOM_DATA)` | 1.20.5 | `DataComponents` 类与 1.20.5 边界已核实（Fabric Custom Data Components 页、minecraft.wiki Pack_format 的 1.20.5~1.20.6 行）；`get` 返回 `CustomData` 的方法签名以目标版本 javadoc 为准 |
| `stack.getOrCreateTag()` | `stack.set(DataComponents.X, ...)` / `stack.update(...)` / `CustomData.of(tag)` | 1.20.5 | ItemStack `get`/`set` 组件方向已核实（Fabric Custom Data Components 页）；`CustomData` 的 `of` / `copyTag` 等方法名 UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核） |
| `stack.hasTag()` | `stack.has(DataComponents.CUSTOM_DATA)` | 1.20.5 | `ItemStack.has(DataComponentType)` 的签名 UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核）；空组件与 null 语义不同，注意判空逻辑 |
| 自定义 NBT 键 + `getInteger` / `getString` | 自定义 `DataComponentType` / `Codec` 组件 | 1.20.5 | 自定义组件类型需要注册（已核实：Fabric Custom Data Components 页给出 `DataComponentType` 注册示例）；`CustomData` 与旧 NBT 数据的兼容写法 UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核） |
| `ItemStack` 的 NBT 复制/比较（`copy()`、`areTagsEqual`） | 组件比较 / `ItemStack.matches` | 1.20.5 | 迁移时逐个替换；组件比较的具体 API UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核） |

## 4. 方块 / 物品类

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `new Block(Material.ROCK)` + `setUnlocalizedName` / `setCreativeTab`（1.7.10 / 1.12.2） | `new Block(AbstractBlock.Properties.of(...))` | 1.16.5（1.13+ 逐步成型） | 1.12.2 形态见 forge-1.12.2-api.md:53-56；1.16.5 用 `AbstractBlock.Properties`（本仓库已核实，见 forge-modern-api.md:89） |
| `AbstractBlock.Properties.of(...)` | `BlockBehaviour.Properties.of(...)` | 1.17 | 类改名已核实（见 forge-modern-api.md:103） |
| `BlockBase` 之类自定义基类（社区教程常见，非官方类） | 直接继承 `Block`，属性走 `BlockBehaviour.Properties` | 随 1.13+ | 官方并无 `BlockBase`（本仓库其它技能 references 均未出现该类）；迁移时按目标工程实际类名改；类名本身 UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核） |
| `setTextureName("modid:name")`（1.7.10） | 资源包 JSON 模型 + 方块状态（1.8+） | 1.8 | `setTextureName` 仅 1.7.10 有（本仓库已核实，见 assets/skills/minecraft-forge-mod/SKILL.md:99） |
| `setUnlocalizedName("name")` | `setTranslationKey` / 语言键 + JSON 模型 | 1.13（flattening） | 1.12.2 仍可用（forge-1.12.2-api.md:53）；1.13 flattening 的具体破坏点（注册名、元数据、模型/方块状态引用）UNVERIFIED（无可达官方页覆盖，2026-10-21，待 CI/联网复核） |
| `CreativeTabs.tabMisc`（1.7.10 小写字段） | `CreativeTabs.MISC`（1.12.2 大写常量）→ `CreativeModeTab.TAB_MISC`（1.16.5/1.20.1）→ 1.21 移除 | 1.8 / 1.21 | 1.7.10 与 1.12.2 常量见 SKILL.md:99 与 forge-1.12.2-api.md:77；1.21 移除见 forge-modern-api.md:104 |

## 5. 事件总线

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `cpw.mods.fml.common.eventhandler.SubscribeEvent` + `@Mod.EventHandler` + FML*Event | `net.minecraftforge.fml.common.eventhandler.SubscribeEvent` + 三阶段 | 1.8~1.12.2 | 1.7.10 形态见 assets/skills/minecraft-forge-mod/SKILL.md:68,74（本仓库已核实） |
| `net.minecraftforge.fml.common.eventhandler.SubscribeEvent`（1.12.2） | `net.minecraftforge.eventbus.api.SubscribeEvent` | 1.13 起（1.16.5 形态已核实） | 1.16.5/1.20.1 用 `eventbus.api`；`MinecraftForge.EVENT_BUS` 仍是 game bus（本仓库已核实，见 forge-modern-api.md:26-46） |
| `FMLJavaModLoadingContext.get().getModEventBus()`（1.16.5/1.20.1） | `@Mod` 构造器注入 `IEventBus`（NeoForge） | NeoForge 1.21.x | 构造器注入已核实（mod-bus-events.md:24-27）；该上下文移除的具体版本 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |
| `MinecraftForge.EVENT_BUS` | `NeoForge.EVENT_BUS` | NeoForge 21.x | 字段名已核实（mod-bus-events.md:39）；包 `net.neoforged.neoforge.common.NeoForge` |
| `@EventBusSubscriber(bus = Bus.FORGE)` | `@EventBusSubscriber(bus = Bus.GAME)` | NeoForge 21.x | 枚举与包已核实（mod-bus-events.md:36-50） |
| `bus.register(Object)` / `bus.post(Event)` / `bus.addListener(...)` | 同一套 `IEventBus` API，类换 `net.neoforged.bus.api.IEventBus` | NeoForge 21.x | `IEventBus` 的方法名两个时代一致（1.16.5 已核实），NeoForge 侧同名方法 UNVERIFIED（NeoForge 官方源 2026-10-21 本机不可达，待 CI/联网复核） |
| `TickEvent.ServerTickEvent` 单类 | 1.20.1 起 Pre/Post 子类拆分 | 1.20.x | 拆分条目见 forge-modern-api.md:68（已核实有改动）；具体子类名查 javadoc |
| `net.minecraftforge.fml.common.event.FMLServerStartingEvent`（1.12.2） | `RegisterCommandsEvent` + Brigadier（1.16.5+） | 1.13+ | `RegisterCommandsEvent` 在 1.16.5/1.20.1 形态已核实（forge-modern-api.md:63） |

## 6. 资源定位（ResourceLocation / Identifier）

| 旧写法 | 新写法 | 首次变化版本 | 备注 |
| --- | --- | --- | --- |
| `new ResourceLocation("modid", "path")` | `ResourceLocation.fromNamespaceAndPath("modid", "path")` / `ResourceLocation.parse("modid:path")` / `withDefaultNamespace("path")` | 1.21.2 | 构造器私有、类改 final，已核实（见 assets/skills/minecraft-fabric-mod/references/api/registries-and-items.md:67-70） |
| `new ResourceLocation("modid:path")` 单串构造 | `ResourceLocation.parse("modid:path")` | 1.21.2 | 同上；`tryParse` 等变体按目标版本 javadoc |
| `ResourceLocation`（mojmap，≤1.21.11） | `Identifier`（mojmap 1.21.11 起） | 1.21.11 | mojmap 改名已核实（registries-and-items.md:20,70；entrypoints-and-lifecycle.md:111,117）；Yarn 里一直叫 `Identifier`，是同一概念的不同映射名 |
| `ResourceLocation` 常量（如 `ResourceLocation.withDefaultNamespace`） | 1.21.11 起按 `Identifier` 的类型改；工厂方法名以 javadoc 为准 | 1.21.11 | 迁移时把类型与调用一起换，别只换 import |

## 7. 26.x 专项（按已抓取来源与仓库提醒，不过度推断）

- **26.1 起不混淆**：Minecraft 官方 jar 直接带可读名与参数名，Yarn / Intermediary / mojmap 体系退场，构建配置里不再需要映射（Fabric 官方 Migrating Mappings 页，2026-10 抓取）。
- **Yarn 工程先迁 mojmap**：Loom 的 `migrateMappings` 不支持 Kotlin 工程，Kotlin 用 Ravel 插件；迁移后逐文件 review（同上）。
- **mixin 手工修复**：`method` / `target` 里的 Yarn 名不会被 IDE 重命名覆盖；26.1 起无映射层兜底，写错直接注入失败（见 assets/skills/minecraft-fabric-mod/references/api/mixins.md:91）。
- **`ResourceLocation` 与 `Identifier`**：1.21.11 起 mojmap 统一叫 `Identifier`；26.x 沿用该命名。26.2 / 26.3 没有官方文档页可对照，具体到 26.3 的注册 API 本仓库未复核（见 registries-and-items.md:8），以反编译目标 jar 为准。
- **26.3 生态**：NeoForge 26.3 仅 `-beta`、Paper 26.3 仅 `-alpha`（见 assets/skills/minecraft-java-build/SKILL.md:21,28）；26.3 的 Architectury 移植变更清单见 assets/skills/minecraft-neoforge-mod/references/api/changes-26.3.md，该清单不等于 NeoForge 核心 API 变更。

## 8. 使用纪律

1. 关键行都标了核实状态；标了未核实原因的行写代码前必须查 javadoc / 官方文档 / IDE 补全，查完回来把结论补进代码注释或待办。
2. 同一功能跨多个大版本时，按本表先改「注册 → 事件 → 数据 → 资源」的顺序，再按 references/api/version-migration.md 第 3 节的验收表逐项过。
3. 不要从旧版教程直译网络/数据组件代码：这两块版本间改动最大，且本仓库证据最少。
4. 改名时优先用 IDE 的重构（Rename / Find Usages），不要全局文本替换；字符串里的名字（mixin、语言键、模型路径）单独人工处理。
