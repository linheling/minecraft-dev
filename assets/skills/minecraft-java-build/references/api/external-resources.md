# Minecraft 开发外部资源索引

> 适用：全平台（Paper/Spigot、Fabric、Forge、NeoForge）、MC 1.7.10 ~ 26.3
> 核对方式：本机 `curl -L -A 'Mozilla/5.0'` 逐条抽检（2026-10-21）；`200` 为可达，`403` 多为站点反爬（浏览器通常可开），`超时` 表示本机网络不可达、不代表站点下线
> 核对日期：2026-10-21

本页是「查文档时先打开哪个站」的索引，不复制各站内容。链接会随生态变化，新增/替换条目时请在同一行注明核对日期与可达状态；仓库的 `npm run check-links` 会对 `assets/**/*.md` 做同样的可达性检查（404/410/5xx 判 BROKEN，403/超时判 UNVERIFIABLE）。

## 1. 官方文档与 Javadoc

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| Paper 文档 | <https://docs.papermc.io/> | 插件开发、paperweight、事件/命令/数据组件 | 200 |
| Paper Javadoc（1.21.8） | <https://jd.papermc.io/paper/1.21.8/> | 查 `org.bukkit.*` / `io.papermc.paper.*` 签名 | 200 |
| Paper 下载 | <https://papermc.io/downloads/paper> | 获取服务端 jar 与构建号 | 200 |
| Paper 源码 | <https://github.com/PaperMC/Paper> | 行为差异、补丁、issue | 200 |
| Fabric 文档 | <https://docs.fabricmc.net/> | 模组开发、loader、loom、映射 | 200 |
| Fabric API 源码 | <https://github.com/FabricMC/fabric> | 模块与事件实现 | 200 |
| Fabric 版本元数据 | <https://meta.fabricmc.net/v2/versions/loader> | 查 loader/game 版本组合 | 200 |
| Forge 文档 | <https://docs.minecraftforge.net/> | Forge 现代线（1.13+）开发 | 200 |
| Forge Javadoc（1.20.1） | <https://lexxie.dev/forge/1.20.1/> | 查 Forge 1.20.1 API | 200 |
| Forge 源码 | <https://github.com/MinecraftForge/MinecraftForge> | 事件、注册、版本分支 | 200 |
| NeoForge 源码 | <https://github.com/neoforged/NeoForge> | NeoForge 实现与 issue | 200 |
| NeoForge 文档源码 | <https://github.com/neoforged/Documentation> | 文档内容；官网见下行 | 200 |
| NeoForge 官网 | <https://docs.neoforged.net/> | 官方文档入口 | 超时（本机；浏览器可试） |

> NeoForge 官网在当前环境多次超时，和仓库里既有的 NeoForge 未核实条目同源；需要查 NeoForge 文档时优先看 GitHub 文档源码。

## 2. 版本、映射与反编译

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| Mojang 版本清单 | <https://piston-meta.mojang.com/mc/game/version_manifest_v2.json> | 所有 Java 版版本号与元数据 URL | 200 |
| mappings.dev | <https://mappings.dev/> | 在线浏览 Mojang/Yarn 等映射 | 200 |
| Linkie | <https://linkie.shedaniel.dev/> | 跨版本类/方法/字段名查询 | 200 |
| Parchment | <https://parchmentmc.org/> | 带参数名的社区映射（Forge/NeoForge 常用） | 200 |
| Fabric 元数据 API | <https://meta.fabricmc.net/> | loader、Yarn、游戏版本 | 200 |

补充：

- Mojang 官方映射可从版本清单里的 `downloads.client_mappings` 获取；`mappings.dev` 适合快速对照，不适合脚本化。
- 1.7.10/1.12.2 的 MCP 映射已基本停止维护；老线优先查项目里现成的 `build.gradle` 与 `mappings` 配置，不要从零找 MCP 快照。

## 3. 平台、发布与依赖

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| Modrinth | <https://modrinth.com/> | 模组/插件发布、版本与依赖查询 | 200 |
| CurseForge | <https://www.curseforge.com/minecraft> | 模组/整合包发布 | 403（反爬） |
| Minecraft 服务端下载 | <https://www.minecraft.net/en-us/download/server> | 原版服务端 jar | 200 |
| Paper Maven | <https://repo.papermc.io/repository/maven-public/> | `paper-api` 等依赖 | 200 |
| Forge Maven | <https://maven.minecraftforge.net/> | Forge/ForgeGradle 依赖 | 200 |
| Fabric Maven | <https://maven.fabricmc.net/> | loom、loader、Fabric API | 200 |

> NeoForge Maven（`https://maven.neoforged.net/releases`）在本机抽检超时；Gradle 配置里仍按 `https://maven.neoforged.net/releases` 写，构建机网络通即可。Spigot 的 javadoc 站（`hub.spigotmc.org/javadocs`）同样是 403，查 Bukkit API 直接用 Paper Javadoc；SpigotMC 资源站对本环境持续 503，故不列入上表。

## 4. 排障、性能与日志

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| Paper 读堆栈 | <https://docs.papermc.io/paper/dev/reading-stacktraces/> | 官方堆栈阅读方法 | 200 |
| Paper 基础排障 | <https://docs.papermc.io/paper/basic-troubleshooting/> | 启动失败、插件冲突 | 200 |
| Spark 文档 | <https://spark.lucko.me/docs/> | profiler、TPS、heap summary | 200 |
| Spark 源码 | <https://github.com/lucko/spark> | 命令与实现细节 | 200 |
| Oracle jstack | <https://docs.oracle.com/en/java/javase/21/docs/specs/man/jstack.html> | 线程 dump 参数 | 200 |

日志/崩溃的具体分诊流程见同技能 [crash-and-log-diagnosis.md](crash-and-log-diagnosis.md)。

## 5. 老线（1.7.10 / 1.12.2）

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| ForgeGradle | <https://github.com/MinecraftForge/ForgeGradle> | 1.12.2 及更早的构建插件 | 200 |
| anatawa12 ForgeGradle 1.2 fork | <https://github.com/anatawa12/ForgeGradle-1.2> | 1.7.10 可用的 ForgeGradle 分支 | 200 |
| MinecraftForge 源码 | <https://github.com/MinecraftForge/MinecraftForge> | 老版本分支与补丁 | 200 |
| CraftBukkit 源码 | <https://github.com/Bukkit/CraftBukkit> | 老线 NMS/版本段包名 | 200 |

老线文档大量失效，优先用仓库内模板与真机构建验证；外部链接只作为线索，不作为 API 签名依据。

## 6. 数据包与协议

| 资源 | 链接 | 用途 | 抽检 |
|---|---|---|---|
| ProtocolLib Wiki | <https://github.com/dmulloy2/ProtocolLib/wiki> | 包监听/发包用法 | 200 |
| ProtocolLib 源码 | <https://github.com/dmulloy2/ProtocolLib> | API 与版本支持 | 200 |
| ProtocolLib Releases | <https://github.com/dmulloy2/ProtocolLib/releases> | 版本支持范围（5.4.0 → 1.21.4~1.21.8） | 200 |
| PacketEvents | <https://github.com/retrooper/packetevents> | ProtocolLib 之外的另一套包库 | 200 |

用法与版本边界见 Paper 技能 [nms-and-protocol.md](../../../minecraft-paper-plugin/references/api/nms-and-protocol.md)。

## 7. 维护约定

1. 新增条目必须写「用途」和「抽检」两列；不写裸链接。
2. 抽检优先用 `curl -sS -o /dev/null -w '%{http_code}' -L --max-time 15 <url>`；403 与超时分开记。
3. 站点改版导致 404 时，优先换成该项目的 GitHub 仓库或文档源码，再在备注里说明。
4. `npm run check-links` 全量检查较慢（会逐条发请求）；只改本文件时可先跑：

```bash
node scripts/check-doc-links.mjs --dir assets/skills/minecraft-java-build/references/api
```

5. 新增/替换链接后，重新统计未核实标记数量，确保 CI 的 `check:unverified:gate` 不超阈值。
