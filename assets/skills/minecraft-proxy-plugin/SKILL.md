# 代理插件开发（minecraft-proxy-plugin）

> **铁律：代理插件不是 Bukkit/Paper 插件。** Velocity 的 jar 里如果只有 `plugin.yml` / `paper-plugin.yml` / `bungee.yml`，加载器会直接拒绝并抛「Velocity does not support plugins from these platforms」。写之前先确认：这个插件跑在代理上，还是跑在后端服务器上？
>
> 核对日期：2026-10-23。版本随生态漂移；表外版本先查官方源（fill.papermc.io、docs.papermc.io、BungeeCord 仓库 pom）再动手。

## 1. 定位：代理层做什么

代理（Velocity / BungeeCord）位于玩家与后端 Paper/Spigot/模组服之间，负责：

- 登录/正版验证、MOTD 与服务器列表 ping；
- 初始服务器选择与转服（`/hub`、`/lobby`）、`ServerPreConnectEvent` 拦截；
- 跨服消息、玩家列表、权限与命令的代理侧部分；
- 玩家信息转发（modern / legacy / bungeeguard），让后端拿到真实 UUID/IP。

**不该用代理插件做的事**：方块/实体/物品/世界逻辑、Bukkit 事件监听、后端命令注册。这些属于 `minecraft-paper-plugin`、`minecraft-fabric-mod`、`minecraft-forge-mod`、`minecraft-neoforge-mod`。

## 2. 版本与 Java 对照

| 代理 | 当前线 | 运行 Java | 坐标 / 备注 |
|---|---|---|---|
| **Velocity** | **4.3.0**（3.x 止于 3.5.1） | **25** | `com.velocitypowered:velocity-api:4.3.0`，repo.papermc.io；`compileOnly` + `annotationProcessor` |
| BungeeCord | **26.1-R0.1-SNAPSHOT** | **17** | `net.md-5:bungeecord-api:26.1-R0.1-SNAPSHOT`，central snapshots |
| Waterfall | EOL | — | 仅作迁移来源，不是推荐方案 |

后端 Java 与代理无关：MC 1.20.1=17、1.21.1=21、26.3=25。Velocity 4.x 的 Java 25 是**代理进程**的要求，不是后端。

> ⚠️ Velocity 3.x 已停止维护，新项目直接用 4.x（本技能只覆盖 4.x）。
> ⚠️ Spigot 官方 wiki 的 BungeeCord 坐标已过时（`oss.sonatype.org` + 1.19），以仓库 pom 的 `26.1-R0.1-SNAPSHOT` 与新快照仓库为准。

## 3. 项目骨架

### Velocity（Gradle Kotlin DSL）

```kotlin
plugins { java }

repositories { maven("https://repo.papermc.io/repository/maven-public/") }

dependencies {
    compileOnly("com.velocitypowered:velocity-api:4.3.0")
    annotationProcessor("com.velocitypowered:velocity-api:4.3.0")
}

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }
```

- `velocity-api` 必须 `compileOnly`；打进 jar 会与代理自带类冲突。
- JDK 23+ 必须显式声明 annotation processor，否则 `velocity-plugin.json` 不生成。
- 需要 shade 的只有自己的第三方库，且要 relocate。

### BungeeCord（Gradle）

```kotlin
repositories {
    maven("https://central.sonatype.com/repository/maven-snapshots/")
    mavenCentral()
}
dependencies { compileOnly("net.md-5:bungeecord-api:26.1-R0.1-SNAPSHOT") }
```

BungeeCord 插件用 Java 17 编译；`bungeecord-api` 同样 `compileOnly`。

## 4. 核心写法

### Velocity

```java
@Plugin(id = "example-proxy", name = "ExampleProxy", version = "1.0.0",
        description = "demo", authors = {"you"})
public final class ExamplePlugin {
    private final ProxyServer server;
    private final Logger logger;

    @Inject
    public ExamplePlugin(ProxyServer server, Logger logger, @DataDirectory Path dataDirectory) {
        this.server = server;
        this.logger = logger;   // 构造期不要调用代理 API
    }

    @Subscribe
    public void onInit(ProxyInitializeEvent event) {
        // 注册命令/监听器/调度任务都放这里
    }
}
```

- `velocity-plugin.json` 由 `@Plugin` 的 AP 生成；loader 只认它，不需要手写。
- 插件 id 必须匹配 `[a-z][a-z0-9-_]{0,63}`。
- `@Subscribe` 默认 `async = true`；需要主线程语义的事件要显式处理（`async = false` 的线程行为见 velocity 参考的待核实说明）。
- Velocity 没有主线程，`Scheduler` 全部异步。

### BungeeCord

```java
public final class DemoBungee extends Plugin {
    @Override public void onEnable() {
        getProxy().getPluginManager().registerCommand(this, new Command("hub", "demo.hub") {
            @Override public void execute(CommandSender sender, String[] args) {
                if (sender instanceof ProxiedPlayer p) {
                    p.connect(getProxy().getServerInfo("lobby"));
                }
            }
        });
    }
}
```

- 描述文件优先 `bungee.yml`，没有才回退 `plugin.yml`；两者都没有会报 `Plugin must have a plugin.yml or bungee.yml`。
- 事件用 `@EventHandler(priority = ...)`（byte：`LOWEST=-64` … `HIGHEST=64`），不要用 Guava `@Subscribe`。
- 没有 `PluginCommand` 类；用 `Command` + 可选 `TabExecutor`。
- `AsyncEvent`（`ProxyPingEvent`、`PostLoginEvent`）必须调用 `done.done(...)`。

## 5. 转发与安全（摘要）

**安全前提**：后端 `online-mode=false`，且后端端口只允许代理访问；modern forwarding **不能替代防火墙**。

| 方案 | 代理配置 | 后端（Paper） | 适用 |
|---|---|---|---|
| modern | `player-info-forwarding-mode="modern"` + `forwarding.secret` | `config/paper-global.yml` → `proxies.velocity.{enabled,online-mode,secret}` | MC 1.13+，推荐 |
| legacy | BungeeCord `ip_forward: true` | `spigot.yml` → `settings.bungeecord: true` | 兼容老后端；明文风险 |
| bungeeguard | `player-info-forwarding-mode="bungeeguard"` | BungeeGuard 插件 + token | legacy 加固 |
| none | `"none"` | 不转发 | 单服/测试 |

Paper 1.19+ 的键是 `proxies.velocity.*`（1.20.1 与 1.21.x 相同）；1.18.2 及更低才用 `paper.yml` 的 `settings.velocity-support.*`。

## 6. 常见坑

1. **把 Bukkit 插件丢进代理**：Velocity 直接拒绝；代理插件不继承 `JavaPlugin`。
2. **构造期调 API**：`getAllPlayers()` 等会 NPE/IllegalState；全部放 `ProxyInitializeEvent`/`onEnable`。
3. **异步默认**：Velocity `@Subscribe` 默认异步，操作共享集合要加锁/切回安全上下文。
4. **关闭顺序**：`ProxyPreShutdownEvent` → `ProxyShutdownEvent`；shutdown 里再调度任务基本不会执行。
5. **依赖打包**：`velocity-api` 打进 jar 会类冲突；第三方库要 shade + relocate。
6. **Java 版本**：Velocity 4.x 用 Java 25 编译/运行，拿 Java 17 编译的 jar 可能因字节码版本失败。
7. **转发配置混用**：代理开 modern，后端还留 `settings.bungeecord: true`，表现为进服即踢。
8. **BungeeCord 文档滞后**：wiki 的仓库地址/版本号可能过时，以 pom 与 Maven metadata 为准。

## 7. 参考索引

| 主题 | 文件 |
|---|---|
| Velocity 事件、API、命令、调度、配置、最小插件 | `references/api/velocity.md` |
| BungeeCord 生命周期、事件、命令、调度、配置、对照表 | `references/api/bungeecord.md` |
| modern/legacy/bungeeguard、Paper 配置、拓扑、上线自检 | `references/api/forwarding-and-security.md` |

## 8. 验证边界

- 官方文档与源码核对日期 2026-10-23；代码为文档级验证，未在本机跑真实代理。
- 代理需要真实 Velocity/BungeeCord 进程 + 后端才能验证转发；上线前按 `forwarding-and-security.md` 的 8 项清单逐条检查。
- 无法核实的条目会在正文注明待核实，不要当确定事实使用。
