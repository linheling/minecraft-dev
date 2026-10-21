# Paper NMS 与 ProtocolLib

> 适用：Paper 1.20.5 ~ 26.3（NMS 访问）；ProtocolLib 5.4.0（MC 1.21.4 ~ 1.21.8）
> 核对来源：docs.papermc.io/paper/dev/internals、docs.papermc.io/paper/dev/userdev、ProtocolLib 5.4.0 release notes、Maven Central
> 核对日期：2026-10-21

本页只讲「插件需要越过 Bukkit API、直接读/改服务端内部或网络包」这条路线。先记住三条前提：

1. NMS（`net.minecraft.*`）不是公开 API，PaperMC 明确不为其提供支持；MC 每次升级都可能改签名。
2. 能用 Bukkit/Paper API 解决的，不要用 NMS；能用事件/`PersistentDataContainer` 解决的，不要用数据包。
3. 本页的包名结论只对 **Paper** 成立；Spigot/CraftBukkit 的映射与重定位规则不同。

## 1. 版本分界与包名

Paper 1.20.5 起在运行时使用 Mojang 映射；26.1 起 Mojang 服务端 jar 本身不再混淆，Paper 也不再支持对 26.1+ dev bundle 做 reobf。由此得到三档：

| MC 线 | 运行时映射 | CraftBukkit 包 | NMS 包 | 插件 jar 形态 |
|---|---|---|---|---|
| ≤ 1.20.4 | Spigot mappings | `org.bukkit.craftbukkit.v1_20_R3`（带版本段） | `net.minecraft.server.v1_20_R3`（带版本段） | 需 reobf（Spigot 与旧 Paper） |
| 1.20.5 ~ 1.21.11 | Mojang mappings | `org.bukkit.craftbukkit`（无版本段） | `net.minecraft.server` / `net.minecraft.world.*`（无版本段） | 仅 Paper 目标：不需要 reobf；要兼容 Spigot 才 reobf |
| 26.1 ~ 26.3 | Mojang mappings（服务端不再混淆） | 同上 | 同上 | 不支持 reobf；直接产出 Mojang-mapped jar |

版本段示例：1.20.2 的 CraftServer 全名是 `org.bukkit.craftbukkit.v1_20_R2.CraftServer`（Paper 文档原文）；1.20.5+ 的 Paper 上 `Bukkit.getServer().getClass().getPackage().getName()` 返回不带 `v1_xx_Rx` 的包名。

> 这一段是整页最容易踩坑的地方：在 1.20.5+ 的 Paper 上还按 `net.minecraft.server.v1_21_R1` 找类，必然 `ClassNotFoundException`。

## 2. 路线 A：paperweight-userdev（推荐）

`paperweight-userdev` 让 Gradle 在开发期拿到反混淆后的服务端类型，编译期可以直接 `import net.minecraft.*`；构建时按目标版本重映射。官方示例插件：[PaperMC/paperweight-test-plugin](https://github.com/PaperMC/paperweight-test-plugin)。

```kotlin
// build.gradle.kts
plugins {
    `java-library`
    id("io.papermc.paperweight.userdev") version "2.0.0-beta.21"
}

java {
    // 1.20.5~1.21.x 用 21；26.x 用 25
    toolchain.languageVersion = JavaLanguageVersion.of(21)
}

dependencies {
    // 1.21.x 线（以 Paper 文档与模板为准）；26.x 形如 "26.2.build.+"
    paperweight.paperDevBundle("1.21.11-R0.1-SNAPSHOT")
    // 只写 paper-api 与 dev bundle 二选一：userdev 项目用 dev bundle 提供 API
}
```

使用要点：

- 不要同时声明 `paper-api` 和 `paperDevBundle`，否则容易出现重复类/映射冲突；userdev 项目以 dev bundle 为准。
- 目标只有 Paper 1.20.5+ 时，不需要 reobf；直接 `gradlew build` 产出 Mojang-mapped jar。
- 目标包含 Spigot 或 ≤ 1.20.4 的 Paper 时，才加 reobf：

```kotlin
paperweight.reobfArtifactConfiguration =
    io.papermc.paperweight.userdev.ReobfArtifactConfiguration.REOBF_PRODUCTION

tasks.assemble {
    dependsOn(tasks.reobfJar)
}
```

- 26.1+ 没有可用的 reobf 配置，`reobfJar` 不再适用；目标 26.x 时只产出 Mojang-mapped jar。
- IDE 里能补全 `net.minecraft.*` 是 userdev 的最大价值；离开它写 NMS 基本等于盲写。

## 3. 路线 B：反射（不引 userdev，仍可编译）

只依赖 `paper-api`，用反射在运行时拿服务端对象。优点是构建简单、能跨小版本；缺点是慢、没有编译期检查、映射升级时字符串要跟着改。

```java
package com.example.nms;

import java.lang.reflect.Method;
import org.bukkit.Bukkit;

public final class NmsAccess {
    private NmsAccess() {
    }

    /** CraftServer#getServer() 返回 net.minecraft.server.MinecraftServer（1.7.10 ~ 26.x 都存在该方法）。 */
    public static Object minecraftServer() {
        Object craftServer = Bukkit.getServer();
        try {
            Method getServer = craftServer.getClass().getMethod("getServer");
            return getServer.invoke(craftServer);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("CraftServer#getServer is not available", e);
        }
    }

    /** 1.20.4-：org.bukkit.craftbukkit.v1_20_R3；1.20.5+：org.bukkit.craftbukkit。 */
    public static String craftPackage() {
        Package pkg = Bukkit.getServer().getClass().getPackage();
        return pkg == null ? "" : pkg.getName();
    }

    /** 按运行时映射选择 NMS 类名；版本升级后类名变了会在这里抛错，便于定位。 */
    public static Class<?> minecraftServerClass() throws ClassNotFoundException {
        String pkg = craftPackage();
        String suffix = pkg.substring(pkg.lastIndexOf('.') + 1);
        if (suffix.startsWith("v")) {
            return Class.forName("net.minecraft.server." + suffix + ".MinecraftServer");
        }
        return Class.forName("net.minecraft.server.MinecraftServer");
    }
}
```

注意：

- 反射调用要缓存 `Method`/`Field`（Paper 文档明确提醒：重复查找有性能开销）。
- 反射不会被 paperweight 重映射；开发期用 Mojang 名字、运行期是混淆名时，需要类似 [jpenilla/reflection-remapper](https://github.com/jpenilla/reflection-remapper) 的工具，或只在 Mojang-mapped 服务端（1.20.5+ Paper）上跑。
- 反射改 NMS 状态必须在主线程；异步线程只做只读快照或把任务调度回主线程。

## 4. ProtocolLib：不直接写 NMS 的数据包层

ProtocolLib 把协议包封装成 `PacketContainer`，插件通过监听器读写包字段，避免直接依赖 `net.minecraft.network.protocol.*`。适合做：假物品/假实体、界面覆盖、发包拦截、客户端侧提示。不适合做：需要服务端权威逻辑、跨版本强依赖内部字段的场景。

### 4.1 坐标与版本

ProtocolLib 5.4.0 的发布说明（2025-08-07）：

- 支持 Minecraft **1.21.4 ~ 1.21.8**；
- 最低 Java **17**；
- 从 5.4.0 起发布到 **Maven Central**，groupId 改为 `net.dmulloy2`（旧 `repo.dmulloy2.net` / `com.comphenix.protocol` 坐标已废弃）。

```kotlin
// build.gradle.kts
repositories {
    mavenCentral()
}

dependencies {
    compileOnly("net.dmulloy2:ProtocolLib:5.4.0")
}
```

```yaml
# plugin.yml
name: ExamplePackets
version: 1.0.0
main: com.example.packets.ExamplePackets
api-version: '1.21'
depend: [ProtocolLib]   # 玩家没装 ProtocolLib 就不启用本插件；软依赖用 softdepend
```

`paper-plugin.yml` 没有 `depend` 字段，依赖写在它的 `dependencies` 段；两种元数据只能二选一，细节见 [paper-plugin-yml-and-libraries.md](paper-plugin-yml-and-libraries.md)。

### 4.2 监听与发包示例

```java
package com.example.packets;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.events.PacketEvent;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

public final class PacketDemo {
    private final Plugin plugin;
    private final ProtocolManager manager;

    public PacketDemo(Plugin plugin) {
        this.plugin = plugin;
        this.manager = ProtocolLibrary.getProtocolManager();
    }

    /** 监听服务端发往客户端的 SET_SLOT；这里只示范读字段与取消。 */
    public void registerListener() {
        manager.addPacketListener(new PacketAdapter(
                plugin,
                ListenerPriority.NORMAL,
                PacketType.Play.Server.SET_SLOT) {
            @Override
            public void onPacketSending(PacketEvent event) {
                PacketContainer packet = event.getPacket();
                int windowId = packet.getIntegers().read(0);
                int slot = packet.getShorts().read(0);
                if (windowId == 0 && slot == 36) {
                    event.setCancelled(true);
                }
            }
        });
    }

    /** 给玩家发一个只存在于客户端的钻石。 */
    public void sendFakeItem(Player player, int slot) {
        PacketContainer packet = manager.createPacket(PacketType.Play.Server.SET_SLOT);
        packet.getIntegers().write(0, 0);           // window id：0 = 玩家背包
        packet.getShorts().write(0, (short) slot);  // slot 下标
        packet.getItemModifier().write(0, new ItemStack(Material.DIAMOND));
        // 5.4.0 的签名是 sendServerPacket(Player, PacketContainer, boolean filters)
        manager.sendServerPacket(player, packet, true);
    }
}
```

字段顺序提示：`SET_SLOT` 在上述版本中按「windowId(int) / slot(short) / item(ItemStack)」读取；大版本升级后先打印 `packet.getType()` 与字段结构核对，再改索引。数据包监听器可能运行在网络线程，**不要**在监听器里直接读世界/背包并改方块；需要时调度回主线程。

### 4.3 版本边界

- ProtocolLib 5.4.0 的声明支持到 1.21.8；1.21.11、26.2、26.3 不在其发布说明内。升级 MC 前先查 [ProtocolLib Releases](https://github.com/dmulloy2/ProtocolLib/releases) 是否有对应版本。
- 旧插件用 `com.comphenix.protocol:ProtocolLib` + `repo.dmulloy2.net` 的，迁移到 `net.dmulloy2:ProtocolLib:5.4.0`（Maven Central）；旧仓库地址当前已不可用。
- 需要覆盖更多版本、且不想被 ProtocolLib 的版本节奏绑定时，可评估 [PacketEvents](https://github.com/retrooper/packetevents)（另一套包库，API 与支持版本以它的发布页为准），但不要把两套包库混在同一监听链路里。

## 5. 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `ClassNotFoundException: net.minecraft.server.v1_21_R1...` | 1.20.5+ Paper 已无版本段包名 | 改用 `net.minecraft.server.*`，或按第 3 节判断运行时包名 |
| `NoSuchMethodError` / `NoSuchFieldError` | NMS 签名随 MC 版本变，插件还是旧编译产物 | 用对应 dev bundle 重编译；反射路径加版本分支 |
| `NoClassDefFoundError: net/minecraft/...` | 目标服务器是 Spigot/旧 Paper，但 jar 是 Mojang-mapped | 对 Spigot 目标启用 reobf；或只发布 Paper 版本 |
| ProtocolLib 插件加载失败 | 服务端没装 ProtocolLib，或版本不支持当前 MC | `depend` 声明 + 对齐 5.4.0 支持范围 |
| 发包后客户端崩溃/踢出 | `PacketContainer` 字段类型或索引错 | 先用最小包（只改一个字段）验证，再逐步加字段 |
| 监听器里操作世界报异步错误 | 回调在网络线程 | 调度回主线程；只做包字段读写 |
| 26.x 构建 `reobfJar` 失败 | 26.1+ 不再支持 reobf | 去掉 reobf 配置，直接产出 Mojang-mapped jar |

## 6. 构建与验证

```bash
./gradlew build          # 产出 build/libs/*.jar
./gradlew runServer      # 若项目带 run-paper/runServer 任务，用开发服验证
```

上线前至少验证：启动无 `NoClassDefFoundError`、目标 MC 版本登录/发包正常、重启后监听器只注册一次（`onEnable` 里不要重复 `addPacketListener`；`onDisable` 里 `removePacketListeners(plugin)`）。

## 7. 相关文档

- Paper Minecraft internals：<https://docs.papermc.io/paper/dev/internals/>
- Paper paperweight-userdev：<https://docs.papermc.io/paper/dev/userdev/>
- paperweight 示例插件：<https://github.com/PaperMC/paperweight-test-plugin>
- ProtocolLib 仓库：<https://github.com/dmulloy2/ProtocolLib>
- ProtocolLib 5.4.0 发布说明：<https://github.com/dmulloy2/ProtocolLib/releases/tag/5.4.0>
- 同目录：[paper-plugin-yml-and-libraries.md](paper-plugin-yml-and-libraries.md)、[folia.md](folia.md)
