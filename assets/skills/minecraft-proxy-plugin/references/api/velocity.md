# Velocity 代理插件参考（4.3.0）

> 适用：Velocity **4.3.0**（4.x 线）。3.x 线止于 3.5.1，语法差异不大但 API 坐标与 Java 要求不同；新项目用 4.x。
> 核对来源：Velocity 官方文档（docs.papermc.io/velocity）、fill.papermc.io 版本 API、Velocity 源码 `@Plugin`/`@Subscribe`/事件类。核对日期：2026-10-23。代码为文档级验证，未在本机跑真实代理。

## 1. 坐标与构建

```kotlin
plugins { java }

repositories { maven("https://repo.papermc.io/repository/maven-public/") }

dependencies {
    compileOnly("com.velocitypowered:velocity-api:4.3.0")
    annotationProcessor("com.velocitypowered:velocity-api:4.3.0")
}

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }
```

| 项 | 值 |
|---|---|
| 当前稳定版 | 4.3.0 |
| 3.x 最新稳定 | 3.5.1 |
| 运行 Java | 25+（官方原文「requires at least Java 25」） |
| 构建 Java | 25；JDK 23+ 必须显式声明 AP |
| 仓库 | `https://repo.papermc.io/repository/maven-public/` |

Maven 3 需要把 AP 配进 `maven-compiler-plugin` 的 `<annotationProcessorPaths>`；Maven 4 可用 `<type>processor</type>`。`velocity-api` 必须 `compileOnly`，不要打进 jar。

## 2. `@Plugin` 与 `velocity-plugin.json`

```java
@Plugin(id = "example-proxy", name = "ExampleProxy", version = "1.0.0",
        description = "demo", url = "https://example.com", authors = {"you"},
        dependencies = @Dependency(id = "some-plugin", optional = true))
public final class ExamplePlugin {
    @Inject
    public ExamplePlugin(ProxyServer server, Logger logger, @DataDirectory Path dataDirectory) { ... }
}
```

| 维度 | `@Plugin` | `velocity-plugin.json` |
|---|---|---|
| 位置 | 主类 | jar 根目录（编译产物 `classes/`） |
| 生成 | AP 编译期生成 | 可手写；排查时可见 |
| 必填 | `id` | `id`、`main` |
| 可选 | `name`、`version`、`description`、`url`、`authors`、`dependencies`、`provides` | 同名 + `dependencies:[{id,optional}]` |
| id 规则 | `[a-z][a-z0-9-_]{0,63}` | 同左；非法抛 `Plugin ID '...' is invalid.` |

加载器只认 `velocity-plugin.json`。如果 jar 里只有 `plugin.yml` / `paper-plugin.yml` / `bungee.yml`，会抛：

```text
The plugin file X appears to be a Paper, Bukkit or BungeeCord plugin.
Velocity does not support plugins from these platforms.
```

## 3. 生命周期与 `@Subscribe`

- 构造期可注入 `ProxyServer`、`Logger`、`@DataDirectory Path`；**构造期不能注册监听器/命令**，等 `ProxyInitializeEvent`。
- 生命周期事件：`ProxyInitializeEvent` → `ProxyPreShutdownEvent` → `ProxyShutdownEvent`；另有 `ProxyReloadEvent`、`ProxyPingEvent`、`ListenerBoundEvent`、`ListenerCloseEvent`。
- `@Subscribe` 源码定义：`order()`（`PostOrder.FIRST/EARLY/NORMAL/LATE/LAST`，已废弃）、`short priority()`（默认 0，越高越早）、`boolean async()`（**默认 true**）。
- `async = false` 也不保证在主线程（UNVERIFIED）；需要线程安全的数据结构自己加锁。
- 3.0+ 支持异步完成：返回 `EventTask.async(...)` / `EventTask.withContinuation(...)`；自定义事件 `fire()` 返回 `CompletableFuture`。
- 可取消事件用 `ResultedEvent` + `GenericResult`（不再是 `isCancelled`）。
- 主类自动注册为 listener；其它 listener 用 `server.getEventManager().register(plugin, listener)`。

## 4. 事件表

| 事件 | 关键成员 | 语义 |
|---|---|---|
| `LoginEvent` | `getPlayer()`、`getServerIdHash()`（offline 为 null）、`setResult(ComponentResult)` | 认证完成、尚未进服；可拒绝；`@AwaitingEvent` |
| `PostLoginEvent` | `getPlayer()` | 玩家对象就绪；常在此设初始服务器/发消息 |
| `PlayerChooseInitialServerEvent` | `getInitialServer()`、`setInitialServer(...)` | 初始服务器选择 |
| `ServerPreConnectEvent` | `getPlayer()`、`getOriginalServer()`、`getPreviousServer()`、`getResult()` | 连接前拦截；`ServerResult.allowed/denied` |
| `ServerConnectedEvent` | `getPlayer()`、`getServer()`、`getPreviousServer()` | **阻塞**（`@AwaitingEvent`）；等待行为已废弃 |
| `ServerPostConnectEvent` | `getPlayer()`、`getPreviousServer()` | **不阻塞、不可取消**；官方原文「Velocity will not wait on this event to finish firing」 |
| `ProxyPingEvent` | `getConnection()`、`getPing()/setPing(...)`、`GenericResult` | MOTD/图标/在线人数 |
| `PluginMessageEvent` | `getSource()`、`getTarget()`、`getIdentifier()`、`getData()`、`dataAsInputStream()`、`ForwardResult` | 插件消息；`@AwaitingEvent` |
| `DisconnectEvent` | `getPlayer()`、`getLoginStatus()` | 断线清理 |

三个连接事件要一起理解：`ServerPreConnectEvent` 可拦截，`ServerConnectedEvent` 会等，`ServerPostConnectEvent` 只是通知。

## 5. 核心 API

| 接口 | 常用方法 |
|---|---|
| `ProxyServer` | `getPlayer(String/UUID)`、`getAllPlayers()`、`getPlayerCount()`、`getServer(String)`、`getAllServers()`、`registerServer(ServerInfo)`、`getConsoleCommandSource()`、`getPluginManager()`、`getEventManager()`、`getCommandManager()`、`getScheduler()`、`getChannelRegistrar()`、`getConfiguration()`、`getVersion()`、`shutdown()` |
| `Player` | `getUsername()`、`getUniqueId()`、`getCurrentServer()`、`createConnectionRequest(RegisteredServer)`、`disconnect(Component)`、`sendPluginMessage(ChannelIdentifier, byte[])`、`getPlayerSettings()`、`getPing()`、`isOnlineMode()`、`getTabList()` |
| `ServerConnection` | `getServer()`、`getPreviousServer()`、`getServerInfo()`、`isClientLoaded()`、`getPlayer()`、`sendPluginMessage(...)` |
| `CommandManager` | `metaBuilder(alias)`、`register(CommandMeta, Command)`、`register(BrigadierCommand)`、`unregister(...)`、`executeAsync(...)` |
| `SimpleCommand` | `execute(Invocation)`、`hasPermission(Invocation)`（默认 true）、`suggest(Invocation)` |
| `Scheduler` | `buildTask(plugin, Runnable)` → `TaskBuilder`（`.delay(...)`、`.repeat(...)`、`.schedule()`）；`tasksByPlugin(plugin)` |

### 5.1 命令

```java
@Subscribe
public void onInit(ProxyInitializeEvent event) {
    CommandMeta meta = server.getCommandManager().metaBuilder("hub")
            .aliases("lobby").plugin(this).build();
    server.getCommandManager().register(meta, new SimpleCommand() {
        @Override public void execute(Invocation invocation) {
            CommandSource source = invocation.source();
            if (!(source instanceof Player player)) {
                source.sendPlainMessage("players only");
                return;
            }
            server.getServer("lobby").ifPresent(s ->
                    player.createConnectionRequest(s).fireAndForget());
        }
        @Override public boolean hasPermission(Invocation invocation) {
            return invocation.source().hasPermission("demo.hub");
        }
    });
}
```

Brigadier 风格：`BrigadierCommand.literalArgumentBuilder("hub").requires(src -> src.hasPermission("demo.hub"))`；返回 `BrigadierCommand.FORWARD` 表示把命令转发给后端执行。

### 5.2 插件消息

```java
ChannelIdentifier id = MinecraftChannelIdentifier.from("custom:main");
server.getChannelRegistrar().register(id);

@Subscribe
public void onMessage(PluginMessageEvent event) {
    if (!event.getIdentifier().equals(id)) return;
    // 处理 event.getData()
    event.setResult(PluginMessageEvent.ForwardResult.handled());
}
```

向服务端发：`RegisteredServer.sendPluginMessage(id, bytes)`。Velocity 与 BungeeCord 通道兼容由 `velocity.toml` 的 `bungee-plugin-message-channel` 控制（默认 true）。

### 5.3 Adventure

`Player` 是 `Audience`，可直接 `player.sendMessage(Component.text("hi"))`。注意：书（books）与对话框（dialogs）在 Velocity 上不支持；`Player#playSound` 未实现（sound 仅 1.19.3+ 且需 emitter）。

## 6. `velocity.toml` 关键键

| 键 | 默认 | 说明 |
|---|---|---|
| `config-version` | `"2.9"` | 不要手改 |
| `bind` | `"0.0.0.0:25565"` | 监听地址 |
| `motd` | MiniMessage 字符串 | 只接受 MiniMessage |
| `online-mode` | `true` | 正版验证 |
| `player-info-forwarding-mode` | `"NONE"` | `none/legacy/bungeeguard/modern` |
| `forwarding-secret-file` | `"forwarding.secret"` | modern/bungeeguard 必配 |
| `[servers]` + `try` | 示例 `lobby = "127.0.0.1:30066"` | 后端清单与顺序 |
| `[forced-hosts]` | — | 域名强制路由 |
| `[advanced] bungee-plugin-message-channel` | `true` | Bungee 通道兼容 |
| `[advanced] login-ratelimit` | `3000` | 毫秒 |
| `[advanced] compression-threshold` | `256` | 0=全压缩，-1=关闭 |

## 7. 最小插件（完整）

```java
package com.example.proxy;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import java.nio.file.Path;
import org.slf4j.Logger;

@Plugin(id = "example-proxy", name = "ExampleProxy", version = "1.0.0",
        description = "demo", authors = {"you"})
public final class ExamplePlugin {
    private final ProxyServer server;
    private final Logger logger;

    @Inject
    public ExamplePlugin(ProxyServer server, Logger logger, @DataDirectory Path dataDirectory) {
        this.server = server;
        this.logger = logger;
    }

    @Subscribe
    public void onInit(ProxyInitializeEvent event) {
        logger.info("example-proxy enabled on {}", server.getVersion().getVersion());
    }

    @Subscribe
    public void onShutdown(ProxyShutdownEvent event) {
        logger.info("bye");
    }
}
```

编译后 `classes/velocity-plugin.json` 类似：

```json
{"id":"example-proxy","name":"ExampleProxy","version":"1.0.0",
 "description":"demo","authors":["you"],"dependencies":[],"provides":[]}
```

## 8. 坑位

1. **非 Bukkit**：见第 2 节异常；不要继承 `JavaPlugin`，不要用 `plugin.yml`。
2. **classloader 隔离**：每个插件一个 `PluginClassLoader`；依赖别的插件只能通过公开 API 或 `provides`。
3. **构造期调 API**：会 NPE/IllegalState；全部放 `ProxyInitializeEvent`。
4. **异步默认**：默认 `async=true`，访问非线程安全结构要加锁。
5. **关闭顺序**：`ProxyPreShutdownEvent` → `ProxyShutdownEvent`；shutdown 里调度任务基本不会跑。
6. **依赖打包**：`velocity-api` 必须 `compileOnly`；第三方库 shade + relocate。
7. **Java 25**：用旧 JDK 编译可能在 4.x 上因字节码版本失败。
8. **proxy-behind-proxy 不支持**：官方明确不支持。

## 9. 参考链接

- Velocity 文档：https://docs.papermc.io/velocity/
- 第一个插件：https://docs.papermc.io/velocity/dev/creating-your-first-plugin/
- 插件入门（结构 / `velocity-plugin.json`）：https://docs.papermc.io/velocity/dev/getting-started/
- 玩家信息转发：https://docs.papermc.io/velocity/player-information-forwarding/
- 下载与版本：https://fill.papermc.io/v3/projects/velocity
- 源码：https://github.com/PaperMC/Velocity

## 10. 验证状态

- 版本、Java 25、坐标、AP 要求：官方文档/下载 API ✅。
- 事件名与 `ServerPostConnectEvent` 非阻塞语义：源码/官方文档 ✅。
- `async=false` 的实际线程：javadoc 只说「可能在当前线程」，详见第 63 行的待核实说明。
- 未在本机运行真实 Velocity；上线前用最小插件 + 一个后端做 smoke。
