# Forge Capability / 能量 / 流体参考（1.12.2 / 1.16.5 / 1.20.1）

适用范围：

| MC | Forge | Java | Capability API 形态 |
|---|---|---|---|
| 1.12.2 | `14.23.5.2860` | 8 | `Capability` + `CapabilityManager` + `@CapabilityInject` |
| 1.16.5 | `36.2.39` | 8 | `CapabilityManager.get` + `ForgeCapabilities` + `LazyOptional` |
| 1.20.1 | `47.3.0` | 17 | 同 1.16.5 |

> 核对来源：Forge 官方文档 [The Capability System (1.20.1)](https://docs.minecraftforge.net/en/1.20.1/datastorage/capabilities/)、Forge MDK / javadoc；1.12.2 与 1.16.5 的类名按各自 MDK 核对。坐标与 `lib/versions.js` 一致。

## 1. Forge 提供的三个能力

| 能力 | 接口 | 用途 |
|---|---|---|
| 物品 | `IItemHandler` | 机器/箱子/背包的槽位，替代 `Container`/`WorldlyContainer`，自动化友好 |
| 流体 | `IFluidHandler` | 流体罐/管道/桶 |
| 能量 | `IEnergyStorage` | FE 能量容器，接口源自 TeamCoFH 的 RedstoneFlux API |

三者都可以挂在 **BlockEntity、Entity、ItemStack** 上；`Level`/`LevelChunk` 也可以作为附加能力的宿主。

## 2. 1.12.2：旧 Capability 系统

1.12.2 的查询是**直接返回能力对象**，没有 `LazyOptional`：

```java
// 1.12.2 结构示意（不是 1.20.1 可编译代码）
@CapabilityInject(IItemHandler.class)
public static final Capability<IItemHandler> ITEM_HANDLER = null;

// 查询
IItemHandler handler = stack.getCapability(ITEM_HANDLER, null);
if (handler != null) {
    // 使用
}

// 注册自定义能力
CapabilityManager.INSTANCE.register(IHeatStorage.class, new HeatStorage(), HeatStorage::new);
```

要点：

- `@CapabilityInject` 字段必须是 `public static`，且类型为 `Capability<T>`；Forge 在加载期注入。
- `ICapabilityProvider#getCapability(Capability<T>, EnumFacing)` 返回 `T` 或 `null`；`null` 侧表示无侧面语义。
- 内置的 `IItemHandler`/`IFluidHandler`/`IEnergyStorage` 已由 Forge 注册，**不要**重复 `CapabilityManager.register`。
- 1.12.2 的 `ItemStackHandler` 在 `net.minecraftforge.items`，可以直接作为 `IItemHandler` 实现；`FluidTank` 在 `net.minecraftforge.fluids.capability.templates`，`EnergyStorage` 在 `net.minecraftforge.energy`。

## 3. 1.16.5 / 1.20.1：现代 Capability

### 3.1 查询

```java
import net.minecraftforge.common.capabilities.Capability;
import net.minecraftforge.common.capabilities.CapabilityManager;
import net.minecraftforge.common.capabilities.CapabilityToken;
import net.minecraftforge.common.capabilities.ForgeCapabilities;
import net.minecraftforge.common.util.LazyOptional;
import net.minecraftforge.items.IItemHandler;

// 内置能力直接用 ForgeCapabilities
LazyOptional<IItemHandler> items = blockEntity.getCapability(ForgeCapabilities.ITEM_HANDLER, side);

// 自己声明能力引用（自定义能力）
public static final Capability<IHeatStorage> HEAT =
        CapabilityManager.get(new CapabilityToken<>() {});
```

`getCapability(cap, side)` 的语义：

| `side` | 含义 |
|---|---|
| `Direction.UP/DOWN/NORTH/...` | 请求该面的能力实例 |
| `null` | 无侧面语义（内部访问、跨维度等），返回通用实例 |

返回值是 `LazyOptional<T>`：能力不存在时是**空 Optional**，不会返回 `null`。用 `isPresent()`、`ifPresent()`、`orElse(...)` 判断；不要在字段里长期缓存一个可能失效的 `LazyOptional`。

### 3.2 暴露能力（BlockEntity）

```java
import org.jetbrains.annotations.Nullable;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.common.capabilities.Capability;
import net.minecraftforge.common.capabilities.ForgeCapabilities;
import net.minecraftforge.common.util.LazyOptional;
import net.minecraftforge.items.IItemHandler;
import net.minecraftforge.items.ItemStackHandler;

public class MachineBlockEntity extends BlockEntity {
    private final ItemStackHandler inventory = new ItemStackHandler(9) {
        @Override
        protected void onContentsChanged(int slot) {
            setChanged(); // 让 BlockEntity 标脏，世界保存时写盘
        }
    };

    // 惰性：第一次查询时才创建
    private final LazyOptional<IItemHandler> itemHandler = LazyOptional.of(() -> inventory);

    public MachineBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state) {
        super(type, pos, state);
    }

    @Override
    public <T> LazyOptional<T> getCapability(Capability<T> cap, @Nullable Direction side) {
        if (cap == ForgeCapabilities.ITEM_HANDLER) {
            return itemHandler.cast();
        }
        return super.getCapability(cap, side); // 必须回退，否则附加能力全部失效
    }

    @Override
    public void invalidateCaps() {
        super.invalidateCaps();
        itemHandler.invalidate(); // BlockEntity 卸载/销毁时释放
    }
}
```

只暴露单个能力时可以简写：

```java
@Override
public <T> LazyOptional<T> getCapability(Capability<T> cap, @Nullable Direction side) {
    return ForgeCapabilities.ITEM_HANDLER.orEmpty(cap, itemHandler);
}
```

### 3.3 能量与流体

```java
import net.minecraftforge.energy.EnergyStorage;
import net.minecraftforge.fluids.capability.templates.FluidTank;

// 100,000 FE 容量；最大输入/输出各 1,000 FE/t
private final EnergyStorage energy = new EnergyStorage(100_000, 1_000, 1_000);
private final FluidTank tank = new FluidTank(4_000);

private final LazyOptional<EnergyStorage> energyHandler = LazyOptional.of(() -> energy);
private final LazyOptional<FluidTank> fluidHandler = LazyOptional.of(() -> tank);

// getCapability 中：
if (cap == ForgeCapabilities.ENERGY) return energyHandler.cast();
if (cap == ForgeCapabilities.FLUID_HANDLER) return fluidHandler.cast();
```

- `EnergyStorage` 的 `receiveEnergy(amount, simulate)` / `extractEnergy(amount, simulate)` 是纯数值接口，不做副作用；机器每 tick 自己决定收/发。
- FE 与 RF 在多数实现里按 1:1 对接，但跨模组传输要按对方的 `IEnergyStorage`/转换器处理，不要假设所有模组都同单位。
- `FluidTank` 的 `fill`/`drain` 返回实际变化量；模拟操作用 `FluidAction.SIMULATE`。

### 3.4 给已有对象附加能力

```java
@SubscribeEvent
public static void attachCapabilities(AttachCapabilitiesEvent<BlockEntity> event) {
    if (event.getObject() instanceof MachineBlockEntity machine) {
        event.addCapability(
                new ResourceLocation("mymod", "heat"),
                new HeatCapabilityProvider(machine));
    }
}
```

`AttachCapabilitiesEvent` 的泛型只有五种：`Entity`、`BlockEntity`、`ItemStack`、`Level`、`LevelChunk`；要更具体的类型（例如 `Player`），在 `Entity` 事件里自行 `instanceof` 判断。

Provider 至少实现 `ICapabilityProvider`；需要持久化时实现 `ICapabilitySerializable<CompoundTag>`（1.20.1 的 NBT 类型是 `CompoundTag`）：

```java
public class HeatCapabilityProvider implements ICapabilityProvider, ICapabilitySerializable<CompoundTag> {
    private final LazyOptional<IHeatStorage> capability;

    public HeatCapabilityProvider(IHeatStorage storage) {
        this.capability = LazyOptional.of(() -> storage);
    }

    @Override
    public <T> LazyOptional<T> getCapability(Capability<T> cap, @Nullable Direction side) {
        return cap == ModCapabilities.HEAT ? capability.cast() : LazyOptional.empty();
    }

    @Override
    public CompoundTag serializeNBT() { /* 写入 storage */ return new CompoundTag(); }

    @Override
    public void deserializeNBT(CompoundTag nbt) { /* 读回 storage */ }
}
```

### 3.5 注册自定义能力

```java
@SubscribeEvent
public static void registerCapabilities(RegisterCapabilitiesEvent event) {
    event.register(IHeatStorage.class);
}
```

或在接口上加 `@AutoRegisterCapability`。内置的 `IItemHandler`/`IFluidHandler`/`IEnergyStorage` 已注册，不要重复注册。

### 3.6 物品能力

`Item` 的能力通过 `Item#initCapabilities(ItemStack, CompoundTag)` 暴露：

```java
@Override
public ICapabilityProvider initCapabilities(ItemStack stack, @Nullable CompoundTag nbt) {
    return new ItemHeatProvider(stack);
}
```

物品能力随 `ItemStack` 生命周期存在；不要在 `initCapabilities` 里假设只有一个堆叠实例（每个 stack 都可能拿到独立 provider，除非你刻意共享）。

## 4. 持久化、同步与死亡

| 问题 | 规则 |
|---|---|
| BlockEntity 能力数据什么时候写盘？ | 变更时 `setChanged()`；`ItemStackHandler#onContentsChanged` 是常用钩子 |
| 能力数据会自动同步客户端吗？ | **不会**。需要自己发包，或用 `Menu`/`ContainerData` 同步界面相关值 |
| BlockEntity 被卸载/破坏 | `invalidateCaps()` 里 `LazyOptional#invalidate()` |
| 附加能力何时失效 | 用 `AttachCapabilitiesEvent#addListener` 注册清理回调（非自有对象） |
| 玩家死亡后保留数据 | `PlayerEvent.Clone` 中从 `getOriginal()` 复制到新实体；用 `isWasDeath()` 区分死亡与从末地返回 |
| 能力返回空 | `LazyOptional` 为空；不要 `get()` 强取，也不要把空 Optional 缓存给别的对象 |

## 5. 迁移对照（1.12.2 → 1.16.5/1.20.1）

| 1.12.2 | 1.16.5 / 1.20.1 |
|---|---|
| `@CapabilityInject` 注入 | `CapabilityManager.get(new CapabilityToken<>(){})` |
| `getCapability(cap, side)` 返回 `T`/`null` | 返回 `LazyOptional<T>`（可能为空） |
| `CapabilityManager.INSTANCE.register(...)` | `RegisterCapabilitiesEvent#register(...)` 或 `@AutoRegisterCapability` |
| 无标准失效机制 | `LazyOptional#invalidate()` + `invalidateCaps()` |
| 能力直接挂在对象字段 | 通过 `AttachCapabilitiesEvent` 附加，provider 分离 |

## 6. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 能力查询永远是空 | 没有覆写 `getCapability`，或没有回退 `super` | 对照 §3.2；附加能力必须回退 |
| 附加能力把原有能力顶掉 | `getCapability` 没有 `return super...` | 所有分支最后都要回退 |
| `ClassCastException: cannot cast to LazyOptional` | 把 1.12.2 的返回类型照搬到 1.16+ | 1.16+ 返回 `LazyOptional<T>` |
| 机器重启后物品丢失 | 只改了 `ItemStackHandler`，没 `setChanged()` | 在 `onContentsChanged` 里标脏 |
| 客户端看不到能量/流体 | 能力不同步 | 自己发包或走 Menu 数据槽 |
| 玩家死亡后数据清空 | 没有处理 `PlayerEvent.Clone` | 复制数据，注意 `isWasDeath()` |
| 专用服务器崩在客户端类 | Provider 里直接引用客户端类 | 能力实现保持双端安全 |

## 7. 参考

- Forge 官方文档：<https://docs.minecraftforge.net/en/1.20.1/datastorage/capabilities/>
- Forge 1.20.1 MDK：`maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/`
- 仓库内相邻参考：`forge-modern-api.md`（注册/总线）、`networking.md`（能力同步要用的包）
