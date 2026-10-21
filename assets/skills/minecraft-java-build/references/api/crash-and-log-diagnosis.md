# Minecraft 崩溃与日志诊断

> 适用：Java 版客户端/服务端 1.7.10 ~ 26.3；原版、Paper/Spigot 插件、Fabric/Forge/NeoForge 模组均适用
> 核对来源：docs.papermc.io（Reading stacktraces / Basic troubleshooting / Debugging your plugin）、spark 文档、Oracle JDK 工具手册
> 核对日期：2026-10-21

本页讲「拿到一份崩溃或卡死现场，怎样在几分钟内定位到第一现场」。所有结论都按 Java 版通用行为写；不同 loader 的崩溃报告附加段不同，会单独标注。未经两处来源确认的条目不会写进本页；用前仍建议对照自己的 MC/loader 版本复核。

## 1. 先找对文件

| 文件 | 典型位置 | 用途 |
|---|---|---|
| 控制台输出 | 启动终端 / 面板日志 | 最先出现异常的地方，含插件加载顺序 |
| `latest.log` | 服务端根目录 `logs/latest.log`；客户端 `.minecraft/logs/latest.log` | 当前/最近一次会话全文（Log4j2 默认配置） |
| 滚动日志 | `logs/2026-10-21-1.log.gz` 等 | 历史会话；按修改时间排序最稳，不要只看编号 |
| 崩溃报告 | 服务端根目录 `crash-reports/crash-<日期>_<时间>-server.txt`；客户端 `crash-reports/...-client.txt` | 崩溃瞬间的线程、环境、模组/插件列表、完整堆栈 |
| JVM 致命错误 | 工作目录 `hs_err_pid<pid>.log` | 原生崩溃（SIGSEGV、显卡驱动、JNI），不是普通 Java 异常 |
| 构建日志 | 终端 / `build/reports/` | Gradle 编译失败，和运行时崩溃分开看 |

要点：

- 先看 `crash-reports/` 里最新那份；没有再退回 `latest.log`。
- `latest.log` 会在下次启动时被覆盖或滚动，复现后立刻复制一份。
- Forge/NeoForge 的崩溃报告通常带 `-- Mod List --` / `-- System Details --`；Fabric 带 `-- Mods --`；1.7.10 Forge 的报告可能没有模组列表，需要从 `mods/` 目录和日志加载段反推。
- `hs_err_pid*.log` 出现时不要再调 Java 代码，先查显卡驱动、原生库、JVM 参数；这类问题用 Java 堆栈解释不了。

## 2. 60 秒分诊流程

1. **看崩溃报告第一段**：`Description:`（旧版）或 `Failure message:` 一行就是崩溃类型，例如 `Exception ticking world`、`Ticking entity`、`Rendering overlay`。
2. **从下往上读 `Caused by:`**：最后一个 `Caused by` 是最内层根因；上面的异常往往只是包装。
3. **找第一个属于自己代码/模组的栈帧**：跳过 `java.base`、`jdk.internal`、`org.spongepowered.asm`、`com.google.common`，找到自己的包名或已知插件/模组名。
4. **对齐版本四件套**：MC 版本、loader 版本、Java 版本、出错插件/模组版本。四者任何一个不匹配，先修版本再谈代码。
5. **最小化复现**：只留出错插件/模组、换新存档、换原版客户端；能稳定复现再二分。
6. **没有崩溃报告**：服务端卡死/卡顿走第 4 节的 `jstack`/Spark，不要等它自己恢复。

## 3. 症状 → 关键行 → 根因

| 日志关键行 | 常见根因 | 处理方向 |
|---|---|---|
| `java.lang.UnsupportedClassVersionError` | 运行 JDK 低于编译目标（如 21 编译、17 运行） | 按 java-build 版本表换 JDK；检查启动脚本的 `JAVA_HOME` |
| `java.lang.NoClassDefFoundError` / `ClassNotFoundException` | 缺依赖、软依赖未安装、包名在版本间迁移 | 查 `plugin.yml` 的 `depend`/`softdepend`、`mods.toml`/`fabric.mod.json` 依赖；确认 jar 真的在 `plugins/`/`mods/` |
| `java.lang.NoSuchMethodError` / `NoSuchFieldError` | 编译时 API 与运行时版本不一致（最常见于 NMS/反射/旧插件） | 对齐 `paper-api` 或 loader 版本重新编译；不要跨大版本复用旧 jar |
| `Mixin apply failed` / `MixinTransformerError` / `InvalidInjectionException` | Mixin 目标方法签名在目标版本变了，或两个模组改同一处 | 查 mixin 的 `target` 描述符与映射；升级/移除冲突模组 |
| `Missing or unsupported mandatory dependencies` | Forge/NeoForge 的 `mods.toml` 依赖版本范围不满足 | 对照依赖的 `versionRange` 与实际版本 |
| `Incompatible mod set!` | Fabric 的 `fabric.mod.json` 依赖不满足 | 看报告列出的缺失/冲突模组，按提示换版本 |
| `java.lang.OutOfMemoryError: Java heap space` | 堆太小或内存泄漏（区块/实体/缓存） | 提高 `-Xmx` 前先做 heap dump；见第 4 节 |
| `Watchdog Thread` / `Server thread dump` / `Single server tick took` | 主线程卡死（死循环、同步 IO、阻塞锁） | `jstack` 连抓 3 次对比；Spark profiler |
| `Exception ticking world` / `Ticking entity` / `Ticking block entity` | 某个实体/方块实体每 tick 抛异常 | 报告里有实体类型/坐标；先移除该实体或区块再复现 |
| `java.util.ConcurrentModificationException` | 异步线程改主线程集合/世界状态 | 把修改调度回主线程（Paper `GlobalRegionScheduler`/Bukkit 调度器） |
| `Asynchronous ...` / `IllegalStateException: ... async` | 在异步线程调用了主线程 API | 同上；Folia 还要按区域调度 |
| `Could not pass event ... to <插件>` | 插件事件处理器抛异常 | 找 `Caused by` 和第一个插件栈帧；事件本身通常只是触发点 |
| `Failed to load plugin` / `Invalid plugin.yml` | 插件元数据缺字段、`api-version` 不合法、主类写错 | 对照 plugin.yml 必填字段；看控制台更早的加载错误 |
| `GLFW error` / `OpenGL` / `Pixel format not accelerated` | 客户端显卡驱动/OpenGL 版本 | 更新驱动；切换显卡；不要和服务端崩溃混为一谈 |
| `java.lang.StackOverflowError` | 递归/事件互相触发 | 看重复栈帧；加终止条件 |

说明：`OutOfMemoryError: Metaspace` 常见于反复热重载/大量动态类，处理思路与堆 OOM 不同；先停掉热重载再观察。

## 4. 没崩溃但卡死/卡顿

先确认是「TPS 低」还是「主线程卡住」：

- `/spark tps`、`/spark health` 看 TPS/内存/磁盘；`/spark profiler start --timeout 30` 采样后给链接。
- `jstack <pid> > thread-1.txt`，间隔 5 秒再抓 2 次；对比 3 份里都停在同一个栈的线程，就是热点/死锁点。
- `jcmd <pid> Thread.print` 是 `jstack` 的替代；`jcmd <pid> GC.heap_info` 看堆占用。
- 堆 dump：启动参数加 `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path/heap.hprof`；或 `jmap -dump:live,format=b,file=heap.hprof <pid>`。
- JFR：启动加 `-XX:StartFlightRecording=filename=rec.jfr,duration=60s`，用 JDK Mission Control 或 `jfr print` 看分配/锁/GC。
- 生产服操作前先备份存档；抓线程/堆会短暂 STW，避开高峰。

Spark 与 Paper 的排障入口见第 7 节。

## 5. 可编译片段：LogTriage

单文件、只用 JDK 标准库（且只用 Java 8 就有的 API），编译运行：

```bash
javac LogTriage.java
java LogTriage crash-reports/crash-2026-10-21_12.00.00-server.txt
```

它做三件事：打印 `Description:`、打印全部 `Caused by`、打印第一个非 JDK/非 Mixin 的栈帧，并按关键字给出提示。

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class LogTriage {
    private static final Pattern CAUSED = Pattern.compile("^Caused by:\\s*(.+)$");
    private static final Pattern FRAME = Pattern.compile("^\\s+at\\s+([\\w.$]+)\\(([^)]*)\\)");
    private static final Map<String, String> HINTS = new LinkedHashMap<>();

    static {
        HINTS.put("UnsupportedClassVersionError", "运行 JDK 低于编译目标：换 JDK 或降低 release");
        HINTS.put("NoClassDefFoundError", "缺依赖或包名迁移：查 depend/softdepend 与 jar 是否在 plugins/mods");
        HINTS.put("ClassNotFoundException", "类不在 classpath：确认依赖插件/模组已安装且版本匹配");
        HINTS.put("NoSuchMethodError", "编译 API 与运行版本不一致：对齐 paper-api/loader 重编译");
        HINTS.put("NoSuchFieldError", "同上：字段在目标版本被改名/移除");
        HINTS.put("Mixin apply failed", "Mixin 目标签名变了或冲突：查 target 描述符与冲突模组");
        HINTS.put("OutOfMemoryError", "内存不足/泄漏：先 heap dump，再考虑 -Xmx");
        HINTS.put("Watchdog", "主线程卡死：jstack 连抓 3 次 + Spark profiler");
        HINTS.put("ConcurrentModificationException", "异步线程改主线程集合：调度回主线程");
        HINTS.put("StackOverflowError", "递归/事件互相触发：查重复栈帧");
        HINTS.put("GLFW", "客户端显卡/OpenGL 问题：更新驱动，换显卡");
    }

    private LogTriage() {
    }

    public static void main(String[] args) throws IOException {
        if (args.length != 1) {
            System.err.println("usage: java LogTriage <crash-report-or-log>");
            System.exit(2);
        }
        List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
        String firstAppFrame = null;

        for (String raw : lines) {
            // Java 8 has no stripTrailing(); keep the leading indent so the
            // frame pattern still matches.
            String line = raw.replaceAll("\\s+$", "");
            if (line.startsWith("Description:") || line.startsWith("Failure message:")) {
                System.out.println("[summary] " + line);
            }
            Matcher caused = CAUSED.matcher(line);
            if (caused.matches()) {
                System.out.println("[cause]   " + caused.group(1));
            }
            Matcher frame = FRAME.matcher(line);
            // find(), not matches(): Forge/NeoForge append `~[mod.jar:?]` and
            // `~[?:?]` to the frame, so an end-anchored match misses it.
            if (frame.find() && firstAppFrame == null && isApplicationFrame(frame.group(1))) {
                firstAppFrame = frame.group(1) + " (" + frame.group(2) + ")";
            }
        }

        System.out.println("[frame]   " + (firstAppFrame == null ? "<no application frame found>" : firstAppFrame));
        for (Map.Entry<String, String> hint : HINTS.entrySet()) {
            for (String line : lines) {
                if (line.contains(hint.getKey())) {
                    System.out.println("[hint]    " + hint.getKey() + " -> " + hint.getValue());
                    break;
                }
            }
        }
    }

    private static boolean isApplicationFrame(String className) {
        return !(className.startsWith("java.")
                || className.startsWith("javax.")
                || className.startsWith("jdk.")
                || className.startsWith("sun.")
                || className.startsWith("com.sun.")
                || className.startsWith("org.spongepowered.asm.")
                || className.startsWith("org.objectweb.asm."));
    }
}
```

局限：它只做文本分诊，不替代完整堆栈阅读；`Caused by` 的根因仍需结合版本和复现步骤判断。

## 6. 修复后的验证清单

- [ ] 同一 MC/loader/Java/插件版本下，原始复现步骤不再抛异常。
- [ ] `latest.log` 中不再出现同一 `Caused by`；不是只把异常 catch 掉。
- [ ] 最小复现工程（只留必要插件/模组）能跑通。
- [ ] 相关回归：启动、重载（若支持）、关服、存档读写。
- [ ] 记录到 issue/PR：MC 版本、loader 版本、Java 版本、插件版本、复现步骤、日志片段。

## 7. 相关文档

- Paper 读堆栈：<https://docs.papermc.io/paper/dev/reading-stacktraces/>
- Paper 基础排障：<https://docs.papermc.io/paper/basic-troubleshooting/>
- Spark 文档：<https://spark.lucko.me/docs/>
- Oracle `jstack` 手册：<https://docs.oracle.com/en/java/javase/21/docs/specs/man/jstack.html>
- 构建/版本问题：同技能 [SKILL.md](../../SKILL.md) 第 1 节版本时代表
