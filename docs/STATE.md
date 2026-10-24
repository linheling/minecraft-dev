# 版本线验证状态

固定真相源是 [`lib/versions.js`](../lib/versions.js) 的 `PLATFORM_LINES`：19 条 (平台 × 版本线)，每条钉住默认 MC 版本、Java 级别、模板目录与依赖坐标。

本表记录的是**另一件事**：这些线里，哪些真的构建过、哪些真的在服务器/客户端里跑过，以及证据在哪。没有证据的行写 `未验证` —— 这不是缺陷清单，而是让读者知道「照这个模板生成」与「有人在真机上跑通过」之间的距离。

验证等级（写进「最近验证」列）：

| 写法 | 含义 |
|---|---|
| `YYYY-MM` 或 `YYYY-MM-DD` | 该时间段有一次**构建或运行**实测通过，证据写在「证据/备注」列 |
| `未验证` | 只有模板生成与坐标查证，没有真实构建/运行记录 |

`npm run check:state` 校验本表：必须不多不少覆盖 `PLATFORM_LINES` 的每一条 (平台 × 线)，默认 MC 版本 / Java / 模板目录与源码一致，日期格式合法且不在未来。CI 的 `syntax` job 每次都跑。

| 平台 | 线 | 默认 MC | Java | 模板 | 最近验证 | 证据 / 备注 |
|---|---|---|---|---|---|---|
| paper | 1.20 | 1.20.6 | 21 | paper | 未验证 | 仅坐标查证：paper-api 1.20.6 为 Java 21 字节码（2026-10-21，class major 65），目标 Java 17 的工程需显式传 `javaVersion=17` |
| paper | 1.21 | 1.21.8 | 21 | paper | 未验证 | 模板生成与 Gradle 8.14.3 坐标；无本仓库构建记录 |
| paper | 26 | 26.2 | 25 | paper | 未验证 | 坐标查证：Gradle 8.14.3 在 JDK 25 上配置阶段即失败（2026-10-20 实测），已改用 9.2.1；该线本身未构建 |
| paper | 26.3 | 26.3 | 25 | paper | 未验证 | 坐标查证：`26.3.build.+` 解析到 26.3.build.207-stable（repo.papermc.io，2026-10-20） |
| fabric | 1.20 | 1.20.1 | 17 | fabric | 未验证 | 模板生成与 loom/loader/fabric-api 坐标；无构建记录 |
| fabric | 1.21 | 1.21.11 | 21 | fabric | 未验证 | 模板生成与坐标；无构建记录 |
| fabric | 26 | 26.2 | 25 | fabric-26 | 未验证 | 模板生成与坐标；无构建记录 |
| fabric | 26.3 | 26.3 | 25 | fabric-26 | 2026-09 | 真机构建通过（loom 固定在 1.17.21：1.18.2 要求 Gradle JVM 为 25） |
| forge | 1.7 | 1.7.10 | 8 | forge-1.7.10 | 未验证 | 模板生成与 ForgeGradle 1.2 坐标；无构建记录 |
| forge | 1.12 | 1.12.2 | 8 | forge-1.12.2 | 未验证 | 模板生成与 ForgeGradle 3.0.197 坐标；无构建记录 |
| forge | 1.16 | 1.16.5 | 8 | forge-1.16.5 | 未验证 | 模板生成与 ForgeGradle 5.1.77 坐标；无构建记录 |
| forge | 1.20 | 1.20.1 | 17 | forge-1.20.1 | 未验证 | 模板生成与 ForgeGradle 6.0.54 坐标；无构建记录 |
| neoforge | 1.20 | 1.20.1 | 17 | neoforge-1.20.1 | 未验证 | 模板生成与 legacyforge 2.0.91 坐标；无构建记录 |
| neoforge | 1.21 | 1.21.11 | 21 | neoforge | 未验证 | 模板生成与 moddev 2.0.144 / NeoForge 21.11.45 坐标；无构建记录 |
| neoforge | 1.21.1 | 1.21.1 | 21 | neoforge-1.21.1 | 2026-09 | 真机客户端安装构建通过（NeoForge 21.1.249；1.21.1 需显式 modLoader/loaderVersion） |
| neoforge | 26 | 26.2 | 25 | neoforge-26 | 未验证 | 模板生成与 NeoForge 26.2.0.59 坐标；无构建记录 |
| neoforge | 26.3 | 26.3 | 25 | neoforge-26 | 未验证 | 坐标查证：26.3.0.12-beta 是 maven.neoforged.net 上最新的 26.3 构建（2026-09），该线 beta-only |
| spigot | 1.7 | 1.7.10 | 8 | spigot-1.7.10 | 未验证 | 坐标查证（非构建）：spigot-api 1.7.10 无公开 maven（hub 最早 1.8，镜像 404），模板改为 vendored jar |
| spigot | 1.12 | 1.12.2 | 8 | spigot-1.12.2 | 未验证 | 坐标查证：spigot-api 1.12.2-R0.1-SNAPSHOT 可从 Spigot hub 解析；该线未构建 |

## 维护方式

- 新增或删除版本线：先改 `lib/versions.js`，再改本表，`npm run check:state` 必须通过。
- 每次真实构建/运行后：把「最近验证」改成当天日期，把命令、日志路径或 PR 号写进证据列。**不要**把「坐标能解析」写成构建验证。
- 失败记录也值得写：它同样证明有人试过，并且说明了为什么改坐标（如 paper 26 的 Gradle 8.14.3 → 9.2.1）。
