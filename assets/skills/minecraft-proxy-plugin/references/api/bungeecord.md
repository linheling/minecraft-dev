# BungeeCord 代理插件参考（26.1-R0.1-SNAPSHOT）

> 适用：BungeeCord **26.1-R0.1-SNAPSHOT**（2026-10 仓库 pom）。BungeeCord 仍在维护，但新项目优先选 Velocity；Waterfall 已 EOL，只作迁移来源。
> 核对来源：SpigotMC/BungeeCord 仓库 pom 与源码、central.sonatype.com 的 maven-snapshots 元数据、Spigot wiki（注意其文档滞后）。核对日期：2026-10-23。代码为文档级验证。

## 1. 版本与坐标

| 项 | 值 |
|---|---|
| 当前版本 | `26.1-R0.1-SNAPSHOT` |
| Java | 17（`maven.compiler.release 17`；enforcer max 17） |
| 坐标 | `net.md-5:bungeecord-api:26.1-R0.1-SNAPSHOT` |
| 快照仓库 | `https://central.sonatype.com/repository/maven-snapshots/` |
| 支持 MC | 1.8.x – 1.20.x / 1.21.x / 26.x |

```kotlin
repositories {
    maven("https://central.sonatype.com/repository/maven-snapshots/")
    mavenCentral()
}
dependencies {
    // 稳定线：Maven Central 的最近发布件（2026-10-23 核对为 1.21-R0.3）
    compileOnly("net.md-5:bungeecord-api:1.21-R0.3")
    // 或最新开发线（snapshot 仓库）
    // compileOnly("net.md-5:bungeecord-api:26.1-R0.1-SNAPSHOT")
}
```

> ⚠️ Spigot 官方 wiki 仍写旧地址 `oss.sonatype.org/content/repositories/snapshots` 与 `1.19-R0.1-SNAPSHOT`（2023 年最后修改），**不要照抄**；以仓库 pom 与 Maven metadata 为准。
> 发布件存在性已核对：Maven Central `net.md-5:bungeecord-api` 的 `latest/release` 为 `1.21-R0.3`（metadata lastUpdated 2025-09-27）；26.1 线目前走快照仓库。

## 2. 描述文件与生命周期

加载器先找 jar 内的 `bungee.yml`，找不到再找 `plugin.yml`；两者都没有会报：

```text
Plugin must have a plugin.yml or bungee.yml
```

`bungee.yml` 字段（SnakeYAML 直接映射）：

```yaml
name: DemoBungee
main: com.example.bungee.DemoBungee
version: 1.0.0
author: you
depends: []
softDepends: []
description: demo
libraries: []
```

> 键名大小写：`PluginDescription.java` 的字段确认为 `softDepends`（大驼峰 D，2026-10-23 源码核对）。

生命周期：

- `onLoad()`：插件加载时（此时代理 API 大多可用，但别做重活）；
- `onEnable()`：注册命令/监听器/通道；
- `onDisable()`：清理。

`Plugin` 提供 `getDataFolder()`、`getResourceAsStream()`、`getProxy()`。

## 3. 事件与 API

事件注解是 `@EventHandler`（Guava `@Subscribe` 会抛「has registered using deprecated subscribe annotation」）。优先级是 byte：`LOWEST=-64`、`LOW=-32`、`NORMAL=0`、`HIGH=32`、`HIGHEST=64`。

| 事件 | 要点 |
|---|---|
| `ServerConnectEvent` | `@Data`、`Cancellable`；`getPlayer()`、`getTarget()/setTarget(ServerInfo)`、`getReason()` |
| `ServerSwitchEvent` | `getPlayer()`、`getFrom()`（初始连接为 null） |
| `ProxyPingEvent` | `AsyncEvent`；`getConnection()`、`getResponse()/setResponse(ServerPing)` |
| `PluginMessageEvent` | `TargetedEvent` + `Cancellable`；`getTag()`、`getData()`、`getSender()/getReceiver()` |
| `PostLoginEvent` | `AsyncEvent`；`getPlayer()`、`getTarget()/setTarget()` |
| `PlayerDisconnectEvent` | `getPlayer()` |
| `ServerConnectedEvent` | `getPlayer()`、`getServer()` |

`AsyncEvent`（`ProxyPingEvent`、`PostLoginEvent`）必须在回调里 `done.done(this, null)`，或用 `registerIntent(plugin)` 延长异步工作；否则事件不会完成。

核心对象：

- `ProxyServer`（抽象类）：`getPlayers()`、`getPlayer(name/uuid)`、`getServers()`、`getServerInfo(name)`、`getPluginManager()`、`getScheduler()`、`registerChannel(String)`、`unregisterChannel`、`getChannels()`、`getConsole()`、`broadcast(...)`、`getConfig()`、`constructServerInfo(...)`。
- `TaskScheduler`：`runAsync(plugin, task)`、`schedule(plugin, task, delay, unit)`、`schedule(..., period, unit)`、`cancel(int/task/plugin)`。
- `ProxiedPlayer`：`connect(ServerInfo)`、`getServer()`、`getUniqueId()`、`getAddress()`、`sendMessage(BaseComponent)`、`setTabHeader/Footer`。

## 4. 命令

BungeeCord **没有 `PluginCommand` 类**。用 `Command`（抽象 `execute(CommandSender, String[])`）或 `TabExecutor`（额外 `onTabComplete`）：

```java
public final class DemoBungee extends Plugin {
    @Override public void onEnable() {
        getProxy().getPluginManager().registerCommand(this,
                new Command("hub", "demo.hub", "lobby") {
                    @Override public void execute(CommandSender sender, String[] args) {
                        if (sender instanceof ProxiedPlayer p) {
                            p.connect(getProxy().getServerInfo("lobby"));
                        }
                    }
                });
    }
}
```

构造参数：`Command(name, permission, aliases...)`；权限为空字符串表示不检查。

## 5. `config.yml` 关键键

| 键 | 默认 | 说明 |
|---|---|---|
| `online_mode` | `true` | 代理侧正版验证 |
| `ip_forward` | `false` | legacy 转发开关；开了必须配防火墙 |
| `player_limit` | `-1` | 不限 |
| `connection_throttle` | `4000` | 毫秒 |
| `network_compression_threshold` | `256` | 压缩阈值 |
| `max_packets_per_second` | `4096` | 单连接包速率 |
| `server_connect_timeout` | `5000` | 毫秒 |
| `disabled_commands` | 示例值 | 禁用命令列表 |

## 6. 最小插件

```java
package com.example.bungee;

import net.md_5.bungee.api.CommandSender;
import net.md_5.bungee.api.connection.ProxiedPlayer;
import net.md_5.bungee.api.plugin.Command;
import net.md_5.bungee.api.plugin.Plugin;

public final class DemoBungee extends Plugin {
    @Override
    public void onEnable() {
        getProxy().registerChannel("demo:main");
        getProxy().getPluginManager().registerCommand(this,
                new Command("hub", "demo.hub") {
                    @Override public void execute(CommandSender sender, String[] args) {
                        if (sender instanceof ProxiedPlayer p) {
                            p.connect(getProxy().getServerInfo("lobby"));
                        }
                    }
                });
    }

    @Override
    public void onDisable() {
        getProxy().unregisterChannel("demo:main");
    }
}
```

## 7. 与 Velocity 对照

| 维度 | Velocity 4.x | BungeeCord 26.1 |
|---|---|---|
| 最低 Java | 25 | 17 |
| 坐标 | `com.velocitypowered:velocity-api:4.3.0` | `net.md-5:bungeecord-api:26.1-R0.1-SNAPSHOT` |
| 描述文件 | `velocity-plugin.json`（AP 生成） | `bungee.yml` 优先，回退 `plugin.yml` |
| 入口 | `@Plugin` + 构造注入 | `extends Plugin` + `onEnable/onDisable` |
| 事件注解 | `@Subscribe(priority, async)` | `@EventHandler(priority)`（byte） |
| 异步 | 默认异步；`async` 可关 | `Event` / `AsyncEvent` 两类 |
| 取消 | `ResultedEvent` + `GenericResult` | `Cancellable#setCancelled` |
| 文本 | Adventure `Component`/MiniMessage | Bungee `BaseComponent` |
| 命令 | `CommandManager` + `SimpleCommand`/Brigadier | `Command` + `TabExecutor` |
| 调度 | `Scheduler.buildTask(...).delay().repeat()` | `TaskScheduler.runAsync/schedule` |
| 插件消息 | `ChannelRegistrar` + `ForwardResult` | `registerChannel` + `PluginMessageEvent` |
| 转发 | modern/legacy/bungeeguard/none | `ip_forward`（legacy only） |

## 8. 坑位

1. **别用 Guava `@Subscribe`**：BungeeCord 会抛废弃注解异常，用 `@EventHandler`。
2. **AsyncEvent 不调 `done()`**：事件挂起；`PostLoginEvent` 表现像「卡登录」。
3. **`plugin.yml` 与 `bungee.yml` 同名冲突**：Bungee 优先 `bungee.yml`；Bukkit 只读 `plugin.yml`。同一 jar 想两用，两个文件都要放且 `main` 不同。
4. **legacy forwarding 明文**：后端必须只允许代理访问；否则可伪造 UUID。见 `forwarding-and-security.md`。
5. **wiki 过时**：仓库地址、版本号、Java 说明都可能落后；以 pom 为准。
6. **Waterfall**：README 已写 EOL，推荐迁 Velocity；不要作为新项目方案。

## 9. 参考链接

- BungeeCord 仓库：https://github.com/SpigotMC/BungeeCord
- BungeeCord wiki（注意滞后）：https://www.spigotmc.org/wiki/bungeecord/
- 快照仓库：https://central.sonatype.com/repository/maven-snapshots/
- Velocity 对照：https://docs.papermc.io/velocity/

## 10. 验证状态

- 版本、Java 17、坐标、快照仓库：仓库 pom + Maven metadata ✅。
- 事件/命令/调度 API：仓库源码 ✅。
- `softDepends` 键名、稳定发布件（1.21-R0.3）均已按源码/Maven metadata 确认。
- 未在本机运行 BungeeCord；legacy 转发需真实代理+后端验证。
