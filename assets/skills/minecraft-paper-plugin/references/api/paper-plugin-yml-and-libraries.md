# Paper 插件元数据：paper-plugin.yml / libraries / Bootstrap

> 适用：Paper 1.20.x / 1.21.x / 26.2 / 26.3（paper-plugin.yml 仅 Paper 支持；Spigot 只认 plugin.yml）
> 核对来源：docs.papermc.io（Paper 官方插件文档）与 jd.papermc.io
> 核对日期：2026-10-21

`paper-plugin.yml` 是 Paper 自有插件加载框架的元数据文件。官方文档在其页首挂 **Experimental** 警告，字段与行为可能变动；下面每个字段都对应 `PaperPluginMeta`（1.21.8 源码）与 javadoc，写入前建议按当前版本复核。

## 1. 选哪一份：plugin.yml vs paper-plugin.yml

| | `plugin.yml` | `paper-plugin.yml` |
|---|---|---|
| 谁认 | Bukkit 兼容路径（Paper / Spigot 都认） | 只有 Paper 的插件加载框架 |
| 依赖顺序 | `depend` / `softdepend` / `loadbefore` | `dependencies` 的 `load` 字段 |
| 命令 | `commands:` 段 | 无此段，代码里注册 Brigadier |
| 依赖库 | `libraries:`（Maven 坐标） | 无 `libraries`，改用 `loader:` |
| 启动前钩子 | 无 | `bootstrapper:` |
| classloader | 传统共享 | 逐一隔离，需 `join-classpath` 显式开放 |

- 只用 Bukkit API、还要兼容 Spigot → `plugin.yml`。
- 需要 Bootstrap / Loader / 依赖隔离 → `paper-plugin.yml`，同时接受「只在 Paper 家族上可加载」。

同一 JAR 里两份**可以共存**（官方原文：“you still have the ability to include both paper-plugin.yml and plugin.yml in the same JAR”），但 Paper 的加载器只挑一份：`PluginFileType.guessType` 按 `List.of(PAPER, SPIGOT)` 顺序探测，`paper-plugin.yml` 命中即返回（`paper-server/src/main/java/io/papermc/paper/plugin/provider/type/PluginFileType.java`）。也就是说 Paper 上 `paper-plugin.yml` 生效、`plugin.yml` 被忽略，Spigot 上恰好相反——两份文件的 `name` / `main` / `version` 稍有不一致，换核心就变成两个插件。**结论：二选一，不要混用。**

## 2. paper-plugin.yml 字段

```yaml
name: Example-Plugin            # 必填；插件名（唯一标识）
version: '1.0.0'                # 必填；建议加引号，避免被 YAML 转成数字
main: com.example.paperplugin.ExamplePlugin   # 必填；JavaPlugin 子类 FQCN
api-version: '1.21'             # 必填；1.x 写主次版本，26.x 写 major.minor
bootstrapper: com.example.paperplugin.ExamplePluginBootstrap  # 可选
loader: com.example.paperplugin.ExamplePluginLoader          # 可选
description: 演示 Paper 插件元数据
authors: [Example]
website: https://example.com
prefix: Example                 # 日志前缀
load: POSTWORLD                 # STARTUP | POSTWORLD，默认 POSTWORLD
provides: [SomeOtherPlugin]
permissions:
  example.use:
    description: 允许使用示例命令
    default: op
    children:
      example.use.child: true
default-permission: op
```

与 Bukkit 的两个关键差异：`api-version` **必填**且下限为 `1.19`（源码 `MINIMUM`，低于该值直接抛 `... is too old for a paper plugin!`）；**没有 `commands`、`depend`、`softdepend`、`libraries`** 这些字段。

Gradle 侧无需任何额外插件：把 `paper-plugin.yml` 放进 `src/main/resources/` 随 JAR 打包即可（`paperweight-userdev` 是给需要 NMS 源码的工程用的，普通插件项目不需要）。

构建坐标跟版本线走（仓库 `lib/versions.js`）：1.21.x → `io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT`，26.x → `io.papermc.paper:paper-api:26.3.build.+`；`api-version` 要和坐标对得上（`'1.21'` 配 1.21.x，`'26.3'` 配 26.3）。官方规则：合法范围 1.13–最新，1.20.5 起支持 minor 形式，写主次版本即可，不必追补丁号。

## 3. dependencies：加载顺序 vs 硬依赖

```yaml
dependencies:
  bootstrap:                    # bootstrap 阶段可见的依赖
    RegistryPlugin:
      load: BEFORE
      required: true
      join-classpath: true
  server:                       # 插件运行期的依赖
    RequiredPlugin:
      load: AFTER               # RequiredPlugin 在你的插件之后加载
      required: true
      join-classpath: false
    OptionalPlugin:
      required: false           # 缺失也继续加载
```

- 每项三个键，默认值：`load: OMIT`（不参与排序，官方说明此时顺序未定义）、`required: true`、`join-classpath: true`。
- `load: BEFORE` = 该依赖先加载、你的插件后加载；`load: AFTER` = 反过来。源码里 `getLoadAfterPlugins()` 过滤的是 `load()==BEFORE`、`getLoadBeforePlugins()` 过滤的是 `load()==AFTER`，与 Bukkit 的 `loadbefore` 方向正好互换。
- `required: true` 才是硬依赖：依赖缺失 → 你的插件**不加载**（`validateDependencies` 收集缺失项）；`false` 等于 softdepend。对照 `plugin.yml`：`required: true` ≈ `depend`、`required: false` ≈ `softdepend`、`load: AFTER` ≈ `loadbefore`（方向相反）。
- `join-classpath` 决定能否访问对方 classpath；只有 `true` 才能互相看到类。源码里 `getPluginDependencies()` 的过滤条件是 `required && joinClasspath`，`getPluginSoftDependencies()` 是 `!required && joinClasspath`——`join-classpath: false` 的依赖不会出现在 Bukkit 视角的 depend 列表里。
- 顺序与可见性分离：`required` 管加载，`load` 管先后，`join-classpath` 管可见，三者互不等价。
- 旧格式（根级 `dependencies:` 列表 + `load-before` / `load-after`）会被 `LegacyPaperMeta.migrate` 自动迁移，且含义已互换，新文件别照着旧写法抄。

## 4. libraries：plugin.yml 支持，paper-plugin.yml 不支持

`plugin.yml` 的 `libraries:` 是一组 Maven 坐标，插件加载器会从 Maven Central 下载并加进 classpath：

```yaml
libraries:
  - com.google.guava:guava:30.1.1-jre
  - com.google.code.gson:gson:2.8.6
```

镜像可用环境变量 `PAPER_DEFAULT_CENTRAL_REPOSITORY` 或系统属性 `org.bukkit.plugin.java.LibraryLoader.centralURL` 覆盖。`plugin.yml` 另有 `paper-plugin-loader`（FQCN，把库解析交给 Paper loader）和 `paper-skip-libraries`（跳过 `libraries` 解析）两个字段。

`paper-plugin.yml` **没有** `libraries` 字段：`PaperPluginMeta` 的字段全集里不存在该键，官方 `paper-plugins` 文档也只给 `loader:` + `MavenLibraryResolver` 方案。要加库就写 `loader:`：

```java
public final class ExamplePluginLoader implements PluginLoader {
    @Override
    public void classloader(final PluginClasspathBuilder classpathBuilder) {
        MavenLibraryResolver resolver = new MavenLibraryResolver();
        resolver.addDependency(new Dependency(new DefaultArtifact("com.google.code.gson:gson:2.11.0"), null));
        resolver.addRepository(new RemoteRepository.Builder(
                "central", "default", MavenLibraryResolver.MAVEN_CENTRAL_DEFAULT_MIRROR).build());
        classpathBuilder.addLibrary(resolver);
    }
}
```

`MavenLibraryResolver` 构造后**没有任何默认仓库**，必须自己 `addRepository`；本地 JAR 用 `classpathBuilder.addLibrary(new JarLibrary(Path.of(...)))`。官方提醒不要硬编码 `https://repo1.maven.org/maven2`，用 `MAVEN_CENTRAL_DEFAULT_MIRROR` 以跟随用户镜像配置。aether 类型（`org.eclipse.aether.*`）由 paper-api 的传递依赖带入；若 IDE 报缺失，先检查 `compileOnly` 的 paper-api 是否完整解析（独立坐标 `UNVERIFIED`：未在官方源找到 paper-api 之外的单列坐标）。

## 5. Bootstrap

接口是 `io.papermc.paper.plugin.bootstrap.PluginBootstrap`（`@Experimental`、`@OverrideOnly`），写在 `bootstrapper:`。1.21.8 javadoc 的 `io.papermc.paper.plugin.bootstrap` 包里只有 `BootstrapContext`、`PluginBootstrap`、`PluginProviderContext` 三个类型，**没有单独名为 `Bootstrap` 的接口**（早期版本是否有过 `UNVERIFIED`，以 javadoc 为准）。它只有两个方法：

```java
public final class ExamplePluginBootstrap implements PluginBootstrap {
    @Override
    public void bootstrap(final BootstrapContext context) {
        context.getLogger().info("bootstrap：服务器尚未启动完成，数据目录 " + context.getDataDirectory());
        // 不要在这里调用 Bukkit.getServer() / getPluginManager() / 事件系统
    }

    @Override
    public JavaPlugin createPlugin(final PluginProviderContext context) {
        return new ExamplePlugin("构造参数从 bootstrap 传入");   // main 类需有对应构造器
    }
}
```

- `BootstrapContext` 继承 `PluginProviderContext`（`getLogger()`、`getConfiguration()`、`getDataDirectory()`、`getPluginSource()`）并额外提供 `getLifecycleManager()`。
- 时机：服务器启动早期、插件实例化之前（注册到 `Entrypoint.BOOTSTRAPPER`）。`createPlugin` 的返回值就是最终 main 实例；不重写时默认按 `main` 反射加载（`ProviderUtil.loadClass`），需要传构造参数才重写。
- Bootstrap 里没有 `onEnable` / `onDisable`——那是 `JavaPlugin` 的生命周期，仍在服务器启动完成后由插件管理器调用。
- 不能用 Bukkit API：javadoc 原话 “All calls to Bukkit may throw a NullPointerExceptions or return null unexpectedly. You should only call api methods that are explicitly documented to work in the bootstrapper”。
- 与插件共用 classloader（“Your bootstrap class will be on the same classloader as your JavaPlugin.”），但 loader 阶段是**另一个** classloader，静态变量带不过去。
- `bootstrap()` 抛异常 → provider 标记 `ERRORED` → `shouldSkipCreation()` 为真，插件**根本不会被创建**，日志里往往只剩一行堆栈。

## 6. 命令：paper-plugin.yml 没有 commands 段

官方原话：Paper 插件不用 `commands` 字段注册命令，改用 Brigadier Command API。在 `JavaPlugin#onEnable` 之外通过 `getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> { ... })` 注册，签名与别名参数见 [commands.md](commands.md) §6。纸面迁移时记得：`plugin.yml` 的 `commands:`（`description` / `usage` / `aliases` / `permission` / `permission-message`）要拆成代码里的 Brigadier 节点 + `permissions` 段。

## 7. 迁移对照表

| `plugin.yml` | `paper-plugin.yml` | 说明 |
|---|---|---|
| `main` | `main` | 不变（FQCN，`extends JavaPlugin`） |
| `name` / `version` / `description` / `authors` / `website` / `prefix` | 同名 | 概念一一对应 |
| `api-version` | `api-version` | 规则相同（1.x 写 `1.21`，26.x 写 `26.3`），但 Paper 文件里必填且 ≥ `1.19` |
| `depend` | `dependencies.server.<name>.required: true` | 缺依赖不加载 |
| `softdepend` | `dependencies.server.<name>.required: false` | 缺了也加载 |
| `loadbefore` | `dependencies.server.<name>.load: AFTER` | 方向互换，别照抄 |
| `commands` | 删除，改 `LifecycleEvents.COMMANDS` | paper-plugin.yml 无此段 |
| `permissions` / `default-permission` | 同名（`permissionConfiguration` 解析） | 结构一致 |
| `libraries` | 无 → `loader:` | 见 §4 |
| `load: STARTUP/POSTWORLD` | `load:` | 同名同值，默认 `POSTWORLD` |
| 无 | `bootstrapper` / `loader` | Paper 新增 |

## 8. 常见坑

1. **Spigot 上 paper-plugin.yml 被当空气**：Spigot 只找 `plugin.yml`，JAR 里没有就按无效插件处理，插件不加载（具体报错措辞 `UNVERIFIED`：只确认「不加载」这一行为）。发布前按目标核心挑选文件。
2. **api-version 写错**：本仓库统一写 `'1.21'` / `'26.3'` 这类主次版本，别写成 `'1.21.8'` 去赌解析器行为；paper-plugin.yml 漏写该项直接加载失败，低于 `1.19` 报 “too old for a paper plugin”。
3. **两份文件混用**：Paper 取 `paper-plugin.yml`（探测顺序），Spigot 取 `plugin.yml`，同一份功能在两核心上表现不同；改错文件时改了也不生效。
4. **classloader 看不见**：没声明依赖或 `join-classpath: false` → 运行期 `ClassNotFoundException` / `NoClassDefFoundError`；loader 阶段是另一个 classloader，静态状态不会带到插件阶段。
5. **把 `load` 当硬依赖**：`load: BEFORE` 只保证顺序，不保证对方存在；要「没有它就别加载」必须 `required: true`。
6. **Bootstrap 里调 Bukkit**：`Bukkit.getServer()` 等返回 `null` 或抛 NPE，最稳妥是只做日志、读配置目录、准备注册表数据。
7. **循环加载不再自动解决**：检测到依赖环直接关服，`-Dpaper.useLegacyPluginLoading=true` 只是兜底开关，不修复设计。
8. **在 paper-plugin.yml 写 `libraries:`**：字段不存在，正确做法是 `loader:`；写错的失败方式（静默忽略还是解析报错）`UNVERIFIED`。

## 9. 参考链接

- Paper 插件入门（paper-plugin.yml 与 Bootstrap 示例）：<https://docs.papermc.io/paper/dev/getting-started/paper-plugins/>
- plugin.yml 字段与 `libraries`：<https://docs.papermc.io/paper/dev/plugin-yml/>
- Paper 插件加载机制说明：<https://docs.papermc.io/paper/reference/paper-plugins/>
- `PluginBootstrap` javadoc：<https://jd.papermc.io/paper/1.21.8/io/papermc/paper/plugin/bootstrap/PluginBootstrap.html>
- `BootstrapContext` javadoc：<https://jd.papermc.io/paper/1.21.8/io/papermc/paper/plugin/bootstrap/BootstrapContext.html>
- `PluginLoader` javadoc：<https://jd.papermc.io/paper/1.21.8/io/papermc/paper/plugin/loader/PluginLoader.html>
- `MavenLibraryResolver` javadoc：<https://jd.papermc.io/paper/1.21.8/io/papermc/paper/plugin/loader/library/impl/MavenLibraryResolver.html>
- `PluginMeta` javadoc：<https://jd.papermc.io/paper/1.21.8/io/papermc/paper/plugin/configuration/PluginMeta.html>
- 加载器源码：<https://github.com/PaperMC/Paper/tree/ver/1.21.8/paper-server/src/main/java/io/papermc/paper/plugin>
