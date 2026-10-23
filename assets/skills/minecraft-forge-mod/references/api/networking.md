# Forge 网络同步参考（1.12.2 / 1.16.5 / 1.20.1）

适用范围：

| MC | Forge | ForgeGradle / Gradle | Java | 网络 API |
|---|---|---|---|---|
| 1.12.2 | `14.23.5.2860` | ForgeGradle 3.0.197 / 4.9 | 8 | `SimpleNetworkWrapper` |
| 1.16.5 | `36.2.39` | ForgeGradle 5.1.77 / 7.3.3 | 8 | `SimpleChannel` |
| 1.20.1 | `47.3.0` | ForgeGradle 6.0.54 / 8.8 | 17 | `SimpleChannel` |

> 核对来源：Forge 官方文档 [SimpleImpl (1.20.1)](https://docs.minecraftforge.net/en/1.20.1/networking/simpleimpl/)、Forge MDK 与 javadoc；1.12.2/1.16.5 的类名与签名按各自时代 MDK 核对。代码片段的坐标与 `lib/versions.js` 一致。

## 1. 三代 API 速查

| 项目 | 1.12.2 | 1.16.5 / 1.20.1 |
|---|---|---|
| 通道类 | `SimpleNetworkWrapper` | `SimpleChannel` |
| 创建通道 | `NetworkRegistry.INSTANCE.newSimpleChannel("mymod")` | `NetworkRegistry.newSimpleChannel(...)` |
| 注册消息 | `registerMessage(handler, msg, id, Side)` | `registerMessage(id, msg, encoder, decoder, handler)` |
| 消息基类 | `IMessage`（`toBytes` / `fromBytes`） | 普通类 + `FriendlyByteBuf` |
| 处理器 | `IMessageHandler<REQ, REPLY>` | `BiConsumer<MSG, Supplier<NetworkEvent.Context>>` |
| 主线程切换 | `Minecraft.getMinecraft().addScheduledTask(...)`（客户端） | `ctx.get().enqueueWork(...)` |

## 2. 1.12.2：SimpleNetworkWrapper

```java
// 仅 1.12.2 项目
public final class ModNetwork {
    public static final SimpleNetworkWrapper CHANNEL =
            NetworkRegistry.INSTANCE.newSimpleChannel("mymod");

    public static void init() {
        CHANNEL.registerMessage(SetStateHandler.class, SetStateMessage.class, 0, Side.SERVER);
    }
}

public class SetStateMessage implements IMessage {
    private int x, y, z;

    public SetStateMessage() {}

    public SetStateMessage(int x, int y, int z) { this.x = x; this.y = y; this.z = z; }

    @Override
    public void fromBytes(ByteBuf buf) {
        this.x = buf.readInt();
        this.y = buf.readInt();
        this.z = buf.readInt();
    }

    @Override
    public void toBytes(ByteBuf buf) {
        buf.writeInt(x);
        buf.writeInt(y);
        buf.writeInt(z);
    }
}

public class SetStateHandler implements IMessageHandler<SetStateMessage, IMessage> {
    @Override
    public IMessage onMessage(SetStateMessage msg, MessageContext ctx) {
        // 1.12.2 没有 enqueueWork；服务端使用 MinecraftServer#addScheduledTask
        MinecraftServer server = FMLCommonHandler.instance().getMinecraftServerInstance();
        server.addScheduledTask(() -> {
            EntityPlayerMP player = ctx.getServerHandler().player;
            // 校验坐标/距离后再访问世界
        });
        return null;
    }
}
```

要点：

- 1.12.2 的通道名是字符串，不是 `ResourceLocation`。
- `registerMessage` 的第二个参数是**请求消息类**，第三个参数才是处理器类；顺序与 1.16+ 相反。
- `IMessageHandler#onMessage` 返回 `REPLY` 类型；不需要回复时返回 `null`。
- 不要在网络线程直接访问世界，`addScheduledTask` 切回主线程。

## 3. 1.16.5 / 1.20.1：SimpleChannel

### 3.1 通道与注册

```java
package com.example.mymod.network;

import java.util.function.Supplier;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.simple.SimpleChannel;

public final class ModNetwork {
    private static final String PROTOCOL_VERSION = "1";
    private static int nextMessageId = 0;

    public static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
            new ResourceLocation("mymod", "main"),
            () -> PROTOCOL_VERSION,
            PROTOCOL_VERSION::equals,
            PROTOCOL_VERSION::equals);

    private ModNetwork() {}

    public static void register() {
        CHANNEL.registerMessage(nextMessageId++, SetMachineState.class,
                SetMachineState::encode,
                SetMachineState::decode,
                SetMachineState::handle);
    }

    public static void sendToServer(SetMachineState msg) {
        CHANNEL.sendToServer(msg);
    }

    public static void sendToPlayer(ServerPlayer player, SetMachineState msg) {
        CHANNEL.send(PacketDistributor.PLAYER.with(player), msg);
    }

    public static final class SetMachineState {
        private final int x;
        private final int y;
        private final int z;
        private final boolean active;

        public SetMachineState(int x, int y, int z, boolean active) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.active = active;
        }

        public void encode(FriendlyByteBuf buf) {
            buf.writeVarInt(x);
            buf.writeVarInt(y);
            buf.writeVarInt(z);
            buf.writeBoolean(active);
        }

        public static SetMachineState decode(FriendlyByteBuf buf) {
            return new SetMachineState(buf.readVarInt(), buf.readVarInt(), buf.readVarInt(), buf.readBoolean());
        }

        public static void handle(SetMachineState msg, Supplier<NetworkEvent.Context> ctxSupplier) {
            NetworkEvent.Context ctx = ctxSupplier.get();
            ctx.enqueueWork(() -> {
                ServerPlayer sender = ctx.getSender();
                if (sender == null) {
                    return; // 客户端侧收到的包没有 sender
                }
                // 先做距离/权限校验；访问方块前确认 sender.serverLevel().hasChunkAt(pos)
            });
            ctx.setPacketHandled(true);
        }
    }
}
```

注册必须在 mod 初始化阶段完成（`FMLJavaModLoadingContext.get().getModEventBus()` 上监听 `FMLCommonSetupEvent`，或直接在 mod 构造器里调用 `ModNetwork.register()`）。**同一个通道的 discriminator 必须唯一且稳定**，不要用随机数或注册顺序之外的值。

### 3.2 协议版本检查

`newSimpleChannel` 的后两个参数是客户端/服务端兼容性谓词：

- 返回 `false` 表示对端必须也有这个通道，否则拒绝登录。
- `NetworkRegistry.ABSENT`：对端没有该通道；`ACCEPTVANILLA`：对端是原版/非 Forge 客户端。
- 只做单向包（例如纯客户端 HUD）时，按需放行 `ABSENT`，不要无脑返回 `true`。

### 3.3 处理线程

Minecraft 1.8 起网络包默认在**网络线程**处理：

- 不要在网络线程里直接访问 `Level`、`BlockEntity`、玩家背包等游戏状态。
- 用 `NetworkEvent.Context#enqueueWork(Runnable)` 切回主线程，再访问世界。
- 处理完成后调用 `setPacketHandled(true)`；漏掉会导致“包已收到但没标记完成”的重复/超时问题。

### 3.4 服务端安全

客户端可以伪造包内容，服务端必须重新校验：

1. 坐标距离/维度校验，不要信任客户端传来的任意 `BlockPos`。
2. 访问方块或 BlockEntity 前先判断 `level.hasChunkAt(pos)`，否则会触发**任意区块生成**，可被用来消耗服务器磁盘和内存。
3. 检查 sender 是否有权限操作该方块（例如 `sender.canUseGameMasterBlocks()` 或自定义权限）。
4. 限制频率与数值范围，避免一个包触发大范围扫描。

## 4. 发送目标

1.16.5/1.20.1 的 `SimpleChannel#send` 接收 `PacketDistributor.PacketTarget`：

```java
// 单个玩家
CHANNEL.send(PacketDistributor.PLAYER.with(player), msg);

// 正在跟踪某个区块的所有玩家（适合 BlockEntity 同步）
CHANNEL.send(PacketDistributor.TRACKING_CHUNK.with(levelChunk), msg);

// 所有在线玩家
CHANNEL.send(PacketDistributor.ALL.noArg(), msg);

// 某个维度所有玩家
CHANNEL.send(PacketDistributor.DIMENSION.with(level.dimension()), msg);
```

`PacketDistributor.PLAYER` 在 1.16.5 接收 `Supplier<ServerPlayerEntity>`，1.20.1 接收 `ServerPlayer`；写跨版本代码时以对应时代签名为准，不要直接复制另一代的 lambda 形式。

## 5. 客户端处理

客户端的处理器类只应在物理客户端加载。Forge 推荐：

```java
// 服务端也会加载的公共处理器里：
ctx.enqueueWork(() -> DistExecutor.unsafeRunWhenOn(Dist.CLIENT,
        () -> () -> ClientPacketHandler.handle(msg)));
```

- `DistExecutor.unsafeRunWhenOn` 的第二个参数是 `Supplier<Runnable>`，里面再引用客户端类，避免专用服务器加载客户端类。
- 不要在公共类里直接 `import net.minecraft.client.*` 并调用；专用服务器会 `NoClassDefFoundError`。

## 6. 迁移对照（1.12.2 → 1.16.5/1.20.1）

| 1.12.2 | 1.16.5 / 1.20.1 |
|---|---|
| `NetworkRegistry.INSTANCE.newSimpleChannel("id")` | `NetworkRegistry.newSimpleChannel(new ResourceLocation("id","main"), ...)` |
| `IMessage#toBytes/fromBytes(ByteBuf)` | `FriendlyByteBuf` + 静态 encode/decode |
| `IMessageHandler#onMessage` | `BiConsumer<MSG, Supplier<NetworkEvent.Context>>` |
| `ctx.getServerHandler().player` | `ctx.getSender()` |
| `MinecraftServer#addScheduledTask` | `ctx.enqueueWork(...)` |
| `Side.SERVER` 注册参数 | 方向由发送方法（`sendToServer`/`PacketDistributor`）决定 |

## 7. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 登录被踢 `network protocol error` | 协议版本谓词不匹配 | 客户端/服务端 `PROTOCOL_VERSION` 保持一致，或正确使用 `ABSENT` |
| `Received packet ... before channel registered` | 注册晚于连接 | 在 `FMLCommonSetupEvent` 或 mod 构造器早期注册 |
| 客户端收不到自定义包 | 只注册了 serverbound，或发给了错误目标 | 确认 `playToClient`/发送目标；检查 `TRACKING_CHUNK` 范围 |
| 服务端卡顿/磁盘暴涨 | 处理包时加载了未加载区块 | 访问前 `hasChunkAt`，并做距离校验 |
| 专用服务器崩溃 `NoClassDefFoundError: net/minecraft/client/...` | 公共类直接引用了客户端类 | 用 `DistExecutor` 延迟到客户端 |

## 8. 参考

- Forge 官方文档：<https://docs.minecraftforge.net/en/1.20.1/networking/simpleimpl/>
- Forge 1.20.1 MDK：`maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/`
- 仓库内相邻参考：`forge-modern-api.md`（总线/注册）、`forge-1.12.2-api.md`（1.12.2 概览）
