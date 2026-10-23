# NeoForge 网络同步参考（1.20.1 / 1.21.1 / 1.21.11 / 26.x）

适用范围：

| MC | NeoForge | ModDevGradle / Gradle | Java | 网络 API |
|---|---|---|---|---|
| 1.20.1 | `47.1.3`（legacyforge） | 2.0.91 / 8.14.5 | 17 | Forge `SimpleChannel`（`net.minecraftforge.*`） |
| 1.21.1 | `21.1.249` | 2.0.144 / 9.2.1 | 21 | `RegisterPayloadHandlersEvent` + `PayloadRegistrar` |
| 1.21.11 | `21.11.45` | 2.0.144 / 9.2.1 | 21 | 同上，`Identifier` |
| 26.2 | `26.2.0.59` | 2.0.144 / 9.2.1 | 25 | 同上，`Identifier` |
| 26.3 | `26.3.0.12-beta` | 2.0.147 / 9.2.1 | 25 | 同上（beta） |

> 核对来源：`neoforged/Documentation` 的 networking 文档（docs.neoforged.net 的 GitHub 源）、NeoForge 各分支 `network/registration/PayloadRegistrar.java` 源码，以及 `Capabilities.java` 的实际分支内容。1.20.1 线与 Forge 47.1.3 同源，见 §2。

## 1. 先判断你的版本线

NeoForge 1.20.1 **不是**“新 API 的早期版本”：它的源码包名仍是 `net.minecraftforge.*`，网络系统就是 Forge 47.1.3 的 `SimpleChannel`。从 1.21.1 起才有 `net.neoforged.neoforge.network` 的 payload 系统。

```text
1.20.1                 → 用 Forge SimpleChannel（本文件 §2）
1.21.1 / 1.21.11 / 26.x → 用 PayloadRegistrar（本文件 §3）
```

## 2. 1.20.1：Forge SimpleChannel

直接复用 Forge 的写法，注意包名是 `net.minecraftforge.network.simple.SimpleChannel`，不是 `net.neoforged.neoforge.network`：

```java
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.simple.SimpleChannel;

public static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
        new ResourceLocation("mymod", "main"),
        () -> "1", "1"::equals, "1"::equals);
```

消息注册、`enqueueWork`、发送目标与 Forge 1.20.1 完全一致，详见 `../../../minecraft-forge-mod/references/api/networking.md`。迁移到 1.21.1 时整段替换，不要试图让同一个类同时兼容两套 API。

## 3. 1.21.1 / 1.21.11 / 26.x：Payload 系统

### 3.1 定义一个 payload

payload 实现 `CustomPacketPayload`，用 `record` 承载不可变数据；`Type` 是通道内的稳定标识，`StreamCodec` 负责序列化。

**1.21.1（`ResourceLocation`）**：

```java
package com.example.mymod.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.neoforge.network.handling.IPayloadContext;

public record SetMachineState(int x, int y, int z, boolean active) implements CustomPacketPayload {
    public static final Type<SetMachineState> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath("mymod", "set_machine_state"));

    public static final StreamCodec<RegistryFriendlyByteBuf, SetMachineState> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.VAR_INT, SetMachineState::x,
                    ByteBufCodecs.VAR_INT, SetMachineState::y,
                    ByteBufCodecs.VAR_INT, SetMachineState::z,
                    ByteBufCodecs.BOOL, SetMachineState::active,
                    SetMachineState::new);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }

    public static void handle(SetMachineState msg, IPayloadContext context) {
        context.enqueueWork(() -> {
            // 主线程：校验来源玩家、距离与 hasChunkAt 后再访问世界
        });
    }
}
```

**1.21.11 / 26.x** 只把 `ResourceLocation` 换成 `Identifier`（包名 `net.minecraft.resources.Identifier`）：

```java
import net.minecraft.resources.Identifier;

public static final Type<SetMachineState> TYPE =
        new Type<>(Identifier.fromNamespaceAndPath("mymod", "set_machine_state"));
```

`StreamCodec.composite` 最多支持 6 个字段；超过时用嵌套 record 或手写 `StreamCodec`。`ByteBufCodecs` 还提供 `STRING_UTF8`、`VAR_INT`、`BOOL`、`optional`、`list`、`map` 等；涉及注册表对象（`Item`、`Block`、`EntityType`）时用 `registry` / `holderRegistry` 编解码器。

### 3.2 注册

```java
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

public final class ModNetwork {
    private ModNetwork() {}

    @SubscribeEvent
    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");
        registrar.playBidirectional(
                SetMachineState.TYPE,
                SetMachineState.STREAM_CODEC,
                SetMachineState::handle);
    }
}
```

- 事件在 **mod bus** 上监听；1.21.1+ 的 `RegisterPayloadHandlersEvent` 属于加载期事件。
- `registrar("1")` 是协议版本；对端版本不一致会拒绝连接（除非 `optional()`）。
- 方向方法：`playToClient`、`playToServer`、`playBidirectional`；配置阶段用 `configuration*`；两阶段都要用 `common*`。
- `executesOn(HandlerThread.NETWORK)` 可让 handler 留在网络线程（默认 `MAIN`；只有在你确认线程安全时才用）。
- 客户端专用 handler 在 `RegisterClientPayloadHandlersEvent` 里注册，避免专用服务器加载客户端类。

### 3.3 发送

```java
// 客户端 → 服务端（只能从客户端调用）
ClientPacketDistributor.sendToServer(new SetMachineState(x, y, z, true));

// 服务端 → 单个玩家
PacketDistributor.sendToPlayer(player, msg);

// 服务端 → 追踪某个区块的玩家
PacketDistributor.sendToPlayersTrackingChunk(level, chunkPos, msg);

// 服务端 → 所有玩家
PacketDistributor.sendToAllPlayers(msg);
```

`ClientPacketDistributor` 在专用服务器上不可用，调用点必须放在客户端专用类里（或用 `DistExecutor`/`FMLEnvironment.dist` 隔离）。

### 3.4 大小限制

NeoForge 官方文档给出的上限：

- clientbound payload ≤ **1 MiB**
- serverbound payload **< 32 KiB**

超过上限会在编码/发送阶段失败。大块数据（例如整张地图）要自己分片，不要塞进单个 payload。

### 3.5 线程与安全

- handler 默认在主线程执行；`enqueueWork` 也是主线程。不要在 handler 里阻塞等待网络或磁盘。
- 服务端 handler 必须把 payload 当作不可信输入：校验坐标距离、维度、`hasChunkAt`、玩家权限；不要用客户端传来的 `BlockPos` 直接加载区块。
- 客户端 handler 不要假设服务端一定发了某个 payload；`optional()` 注册的包可能缺失。

## 4. 迁移对照（1.20.1 / 1.21.1 → 1.21.11 / 26.x）

| 1.20.1（Forge） | 1.21.1 | 1.21.11 / 26.x |
|---|---|---|
| `SimpleChannel` | `PayloadRegistrar` | `PayloadRegistrar` |
| `registerMessage(id, clazz, enc, dec, handler)` | `playBidirectional(TYPE, CODEC, handler)` | 同左 |
| `FriendlyByteBuf` 手写 | `StreamCodec.composite` + `ByteBufCodecs` | 同左 |
| `ResourceLocation` | `ResourceLocation` | `Identifier` |
| `NetworkEvent.Context#enqueueWork` | `IPayloadContext#enqueueWork` | 同左 |
| `PacketDistributor` | `PacketDistributor` / `ClientPacketDistributor` | 同左 |

## 5. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报 `Missing ModLoader` / 类找不到 | 把 1.21.1 的 payload 类写进了 1.20.1 工程 | 1.20.1 用 Forge `SimpleChannel` |
| 连接被拒 `incompatible payload` | 协议版本或注册集合不一致 | 两端同版本；可选包用 `optional()` |
| 客户端类在专用服务器崩溃 | 公共类直接引用 `net.minecraft.client.*` | 客户端 handler 放单独类，`RegisterClientPayloadHandlersEvent` 注册 |
| 包太大发送失败 | 超过 1 MiB / 32 KiB | 分片或改同步粒度 |
| 服务端卡死/区块暴涨 | handler 里加载了未加载区块 | `hasChunkAt` + 距离校验 |
| 1.21.11 编译报 `ResourceLocation` 不存在 | 26.x 已改 `Identifier` | 按目标线替换 import/构造 |

## 6. 参考

- NeoForge 文档源码：<https://github.com/neoforged/Documentation>
- `PayloadRegistrar`（1.21.1）：<https://github.com/neoforged/NeoForge/blob/1.21.1/src/main/java/net/neoforged/neoforge/network/registration/PayloadRegistrar.java>
- `Capabilities`（1.21.1 / 26.2.x）：见 `capabilities-and-energy.md` 的参考链接
- 相邻参考：`../../../minecraft-forge-mod/references/api/networking.md`（1.20.1 legacy 写法）
