# NeoForge Capability / 能量 / 流体 / DataComponent 参考

适用范围：

| MC | NeoForge | Java | 能力 API | DataComponent |
|---|---|---|---|---|
| 1.20.1 | `47.1.3`（legacyforge） | 17 | Forge `ForgeCapabilities` + `LazyOptional` | 无（NBT） |
| 1.21.1 | `21.1.249` | 21 | `Capabilities.ItemHandler/EnergyStorage/FluidHandler` + `I*` | 有 |
| 1.21.11 | `21.11.45` | 21 | `Capabilities.Item/Fluid/Energy` + `ResourceHandler`/`EnergyHandler` | 有 |
| 26.2 | `26.2.0.59` | 25 | 同 1.21.11 | 有 |
| 26.3 | `26.3.0.12-beta` | 25 | 同 1.21.11 | 有 |

> 核对来源：NeoForge 各分支源码 `capabilities/Capabilities.java`、`transfer/ResourceHandler.java`、`transfer/transaction/Transaction.java`、`transfer/energy/EnergyHandler.java`、`registries/DeferredRegister.java`；NeoForge 文档（GitHub `neoforged/Documentation`）。坐标与 `lib/versions.js` 一致。

## 1. 版本线先分清

```text
1.20.1                 → Forge 47.1.3 的 API（net.minecraftforge.*），见 Forge 参考
1.21.1                 → 旧能力接口（IItemHandler / IEnergyStorage / IFluidHandler）
1.21.11 / 26.x         → 新 Transfer API（ResourceHandler<ItemResource> / EnergyHandler / ResourceHandler<FluidResource>）
```

1.20.1 的能力写法与 Forge 1.20.1 完全相同，见 `../../../minecraft-forge-mod/references/api/capabilities-and-energy.md`。**不要**在 1.20.1 里 import `net.neoforged.neoforge.capabilities`，那个包在 1.20.1 线不存在。

## 2. 1.21.1：旧能力接口

### 2.1 查询

```java
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.items.IItemHandler;

public static IItemHandler getInventory(Level level, BlockPos pos, Direction side) {
    return level.getCapability(Capabilities.ItemHandler.BLOCK, pos, side);
}
```

`getCapability` 返回能力对象或 `null`；`side` 可以是 `null`（无侧面语义）。

### 2.2 暴露给 BlockEntity

```java
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.items.ItemStackHandler;

public class MachineBlockEntity extends BlockEntity {
    public final ItemStackHandler inventory = new ItemStackHandler(9) {
        @Override
        protected void onContentsChanged(int slot) {
            setChanged();
        }
    };
}

@SubscribeEvent
public static void registerCapabilities(RegisterCapabilitiesEvent event) {
    event.registerBlockEntity(Capabilities.ItemHandler.BLOCK,
            ModBlockEntities.MACHINE.get(),
            (be, side) -> be.inventory);
}
```

`registerBlockEntity(capability, BlockEntityType, provider)` 的 provider 是 `(blockEntity, context) -> capability`；返回 `null` 表示该面不提供。注册在 **mod bus** 的 `RegisterCapabilitiesEvent`。

### 2.3 能量与流体

```java
import net.neoforged.neoforge.energy.IEnergyStorage;
import net.neoforged.neoforge.fluids.capability.IFluidHandler;

IEnergyStorage energy = level.getCapability(Capabilities.EnergyStorage.BLOCK, pos, side);
IFluidHandler fluid = level.getCapability(Capabilities.FluidHandler.BLOCK, pos, side);
```

1.21.1 的三组常量：

| 常量 | 类型 |
|---|---|
| `Capabilities.ItemHandler.BLOCK` | `BlockCapability<IItemHandler, Direction>` |
| `Capabilities.EnergyStorage.BLOCK` | `BlockCapability<IEnergyStorage, Direction>` |
| `Capabilities.FluidHandler.BLOCK` | `BlockCapability<IFluidHandler, Direction>` |

物品能力在 1.21.1 的 `ITEM` 上下文是 `Void`（`ItemCapability<IItemHandler, Void>`）；查询 `stack.getCapability(Capabilities.ItemHandler.ITEM)`。

## 3. 1.21.11 / 26.x：Transfer API

### 3.1 三组新能力

| 常量 | 类型 |
|---|---|
| `Capabilities.Item.BLOCK` | `BlockCapability<ResourceHandler<ItemResource>, Direction>` |
| `Capabilities.Fluid.BLOCK` | `BlockCapability<ResourceHandler<FluidResource>, Direction>` |
| `Capabilities.Energy.BLOCK` | `BlockCapability<EnergyHandler, Direction>` |
| `Capabilities.Item.ITEM` | `ItemCapability<ResourceHandler<ItemResource>, ItemAccess>` |

`ResourceHandler<T>` 是**事务化**的资源容器：

```java
int size();
T getResource(int index);
long getAmountAsLong(int index);
long getCapacityAsLong(int index, T resource);
boolean isValid(int index, T resource);
int insert(T resource, int amount, TransactionContext transaction);
int extract(T resource, int amount, TransactionContext transaction);
```

`ItemResource`/`FluidResource` 是**不可变**的资源描述（只描述“是什么”，不携带数量）；数量由 handler 单独存。`EnergyHandler` 是单值的 `long` 能量接口。

### 3.2 查询与事务

```java
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.transfer.ResourceHandler;
import net.neoforged.neoforge.transfer.item.ItemResource;
import net.neoforged.neoforge.transfer.transaction.Transaction;

ResourceHandler<ItemResource> handler =
        level.getCapability(Capabilities.Item.BLOCK, pos, side);

if (handler != null) {
    try (Transaction transaction = Transaction.openRoot()) {
        int inserted = handler.insert(ItemResource.of(stack), stack.getCount(), transaction);
        if (inserted == stack.getCount()) {
            transaction.commit(); // 不 commit 就会在 close 时自动回滚
        }
    }
}
```

规则：

- 所有会改状态的 `insert`/`extract` 都必须带 `TransactionContext`。
- `try (Transaction tx = Transaction.openRoot())` 结束时会自动回滚；成功必须显式 `commit()`。
- 嵌套事务用 `Transaction.open(parent)`；内层 commit 后仍可能被外层回滚。
- 事务只能在打开它的线程使用。

### 3.3 暴露 BlockEntity 能力

```java
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.transfer.item.ItemStacksResourceHandler;

public class MachineBlockEntity extends BlockEntity {
    public final ItemStacksResourceHandler inventory = new ItemStacksResourceHandler(9) {
        @Override
        protected void onContentsChanged(int index, ItemStack previousContents) {
            setChanged();
        }
    };
}

@SubscribeEvent
public static void registerCapabilities(RegisterCapabilitiesEvent event) {
    event.registerBlockEntity(Capabilities.Item.BLOCK,
            ModBlockEntities.MACHINE.get(),
            (be, side) -> be.inventory);
}
```

`ItemStacksResourceHandler` 是 `ResourceHandler<ItemResource>` 的 `ItemStack` 后端实现；流体用 `FluidStacksResourceHandler`。`SimpleEnergyHandler(100_000)` 可用于简单能量容器（按目标版本核对类名/构造器）。

### 3.4 缓存与失效

高频查询（每 tick 的管道/机器）用 `BlockCapabilityCache`，不要每次 `level.getCapability`：

```java
BlockCapabilityCache<ResourceHandler<ItemResource>, Direction> cache =
        BlockCapabilityCache.create(Capabilities.Item.BLOCK, serverLevel, pos, side);
ResourceHandler<ItemResource> handler = cache.getCapability();
```

（`BlockCapabilityCache.create` 只接受 `ServerLevel`；客户端不要用这个缓存。）

能力变化（方块替换、BE 卸载、面配置改变）后必须调用 `level.invalidateCapabilities(pos)`，否则缓存会继续返回旧 handler。

## 4. DataComponent（1.21.1+）

DataComponent 从 MC 1.20.5 引入；1.20.1 线没有，物品数据仍用 NBT。NeoForge 1.21.1 与 26.x 都支持。

### 4.1 定义组件类型

**1.21.1**：

```java
import com.mojang.serialization.Codec;
import net.minecraft.core.Registry;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.codec.ByteBufCodecs;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

public static final DeferredRegister.DataComponents DATA_COMPONENTS =
        DeferredRegister.createDataComponents(Registries.DATA_COMPONENT_TYPE, MyMod.MODID);

public static final DeferredHolder<DataComponentType<?>, DataComponentType<Integer>> CHARGE =
        DATA_COMPONENTS.registerComponentType("charge", builder -> builder
                .persistent(Codec.INT)          // 存档/数据包持久化
                .networkSynchronized(ByteBufCodecs.VAR_INT)); // 同步到客户端
```

**1.21.11 / 26.x** 的 `DeferredRegister.createDataComponents` 只接受 `(ResourceKey<Registry<DataComponentType<?>>>, String)` 两个参数；1.21.1 还有已弃用的单参 `createDataComponents(String)`。新代码统一写双参形式：

```java
DeferredRegister.createDataComponents(Registries.DATA_COMPONENT_TYPE, MyMod.MODID);
```

规则：

- 每个组件类型至少要有一个 codec（`persistent` 或 `networkSynchronized`）；只做网络同步、不落盘的组件只写 `networkSynchronized`。
- `cacheEncoding()` 适合高频读取的复杂组件；`ignoreSwapAnimation()` 用于避免创造模式物品栏的交换动画刷屏。
- 组件值必须是不可变对象（record/不可变集合），不要在组件里放可变 `ItemStack` 引用。

### 4.2 给物品设置组件

```java
// Item.Properties 里设置默认值
public static final DeferredItem<Item> BATTERY = ITEMS.register("battery",
        () -> new Item(new Item.Properties().component(ModComponents.CHARGE.get(), 0)));

// 延迟组件（delayedComponent）的签名随 1.21.x/26.x 演进，使用时以对应 javadoc 为准。
```

修改原版物品的默认组件用 `ModifyDefaultComponentsEvent`（mod bus）：

```java
@SubscribeEvent
public static void modifyDefaults(ModifyDefaultComponentsEvent event) {
    event.modify(Items.DIAMOND_SWORD, builder -> builder.set(ModComponents.CHARGE.get(), 100));
}
```

### 4.3 读写组件

```java
int charge = stack.getOrDefault(ModComponents.CHARGE.get(), 0);
stack.set(ModComponents.CHARGE.get(), charge + 1);
stack.remove(ModComponents.CHARGE.get());
```

`ItemStack` 的组件存储是 `PatchedDataComponentMap`：`get` 返回组件值或 `null`，`getOrDefault` 给默认值；直接改 `stack` 会触发同步/比较逻辑。批量修改用 `DataComponentPatch`（`DataComponentPatch.builder().set(...).build()`），避免逐项复制。

## 5. 迁移对照

### 5.1 1.21.1 → 1.21.11 / 26.x

| 1.21.1 | 1.21.11 / 26.x |
|---|---|
| `Capabilities.ItemHandler.BLOCK` + `IItemHandler` | `Capabilities.Item.BLOCK` + `ResourceHandler<ItemResource>` |
| `Capabilities.EnergyStorage.BLOCK` + `IEnergyStorage` | `Capabilities.Energy.BLOCK` + `EnergyHandler` |
| `Capabilities.FluidHandler.BLOCK` + `IFluidHandler` | `Capabilities.Fluid.BLOCK` + `ResourceHandler<FluidResource>` |
| `stack.getCapability(Capabilities.ItemHandler.ITEM)` | `stack.getCapability(Capabilities.Item.ITEM)`（context `ItemAccess`） |
| 直接 `insert/extract` | 必须包在 `Transaction` 里，成功显式 `commit()` |
| `ResourceLocation` | `Identifier` |

旧的 `IItemHandler`/`IEnergyStorage`/`IFluidHandler` 类在新版本源码里仍然存在，但**不再由 `Capabilities` 暴露**；新代码不要继续用它们做跨模组能力查询。

### 5.2 1.20.1 → 1.21.1

| 1.20.1（Forge） | 1.21.1 |
|---|---|
| `ForgeCapabilities.ITEM_HANDLER` + `LazyOptional` | `Capabilities.ItemHandler.BLOCK`（直接返回能力或 `null`） |
| `getCapability` 覆写 | `RegisterCapabilitiesEvent#registerBlockEntity` |
| `ResourceLocation` | `ResourceLocation`（1.21.1 仍用） |

## 6. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 1.20.1 编译报 `net.neoforged.neoforge.capabilities` 不存在 | 把 1.21+ 的包名套到 1.20.1 | 用 `net.minecraftforge` 的 `ForgeCapabilities` |
| 1.21.11 编译报 `Capabilities.ItemHandler` 不存在 | 26.x 常量改名为 `Capabilities.Item` | 按 §3.1 替换 |
| `insert` 改了物品但服务器重启后丢失 | 没有 `commit()`，事务回滚了 | 成功路径显式 commit |
| 管道每 tick 拿到旧 handler | 没有 `invalidateCapabilities` | 能力变化时失效缓存 |
| 组件读取永远是默认值 | 没写 `persistent`/`networkSynchronized`，或没注册 | 检查 codec 与 `DeferredRegister` 注册 |
| 客户端看不到组件变化 | 只写了 `persistent` 没写 `networkSynchronized` | 加网络 codec，或自己发包 |
| `ResourceHandler` 的 `getResource` 返回空但 amount 非 0 | 违反接口契约 | 空资源时 amount 必须为 0 |

## 7. 参考

- NeoForge 源码 `Capabilities.java`（1.21.1）：<https://github.com/neoforged/NeoForge/blob/1.21.1/src/main/java/net/neoforged/neoforge/capabilities/Capabilities.java>
- NeoForge 源码 `Capabilities.java`（26.2.x）：<https://github.com/neoforged/NeoForge/blob/26.2.x/src/main/java/net/neoforged/neoforge/capabilities/Capabilities.java>
- `ResourceHandler`（26.2.x）：<https://github.com/neoforged/NeoForge/blob/26.2.x/src/main/java/net/neoforged/neoforge/transfer/ResourceHandler.java>
- `Transaction`（26.2.x）：<https://github.com/neoforged/NeoForge/blob/26.2.x/src/main/java/net/neoforged/neoforge/transfer/transaction/Transaction.java>
- `DeferredRegister`（26.2.x）：<https://github.com/neoforged/NeoForge/blob/26.2.x/src/main/java/net/neoforged/neoforge/registries/DeferredRegister.java>
- 相邻参考：`../../../minecraft-forge-mod/references/api/capabilities-and-energy.md`（1.20.1 legacy）
