# 代理转发与安全参考（Velocity / BungeeCord）

> 适用：Velocity 4.x 的 modern/legacy/bungeeguard 转发，BungeeCord 的 legacy 转发，以及 Paper 1.20.1 / 1.21.x / 26.x 后端配置。
> 核对来源：Paper 官方 Velocity 文档、Velocity 安全文档、BungeeCord 源码/README。核对日期：2026-10-23。

## 1. 安全前提（先看这条）

代理架构的安全模型是：

1. 代理做正版验证（`online-mode=true`）；
2. 后端 `online-mode=false`；
3. **后端端口只允许代理访问**（OS 防火墙/安全组/私网）；
4. 代理与后端之间的玩家信息用转发协议保护。

Velocity 官方安全文档明确：modern forwarding **不能替代防火墙**。任何能直连后端端口的人，都可能绕过代理伪造身份（legacy 尤其严重）。

```
公网 25565 ──> Velocity/BungeeCord（唯一暴露端口）
                    │ 内网/回环
                    ├─ 127.0.0.1:25566  1.20.1 Paper（online-mode=false）
                    ├─ 127.0.0.1:25567  1.21.1 Paper
                    └─ 127.0.0.1:25568  26.3 Paper
```

后端监听 `127.0.0.1` 或私网 IP；`forwarding.secret` 权限 600，不进 git。

## 2. Velocity modern forwarding（推荐）

代理 `velocity.toml`：

```toml
online-mode = true
player-info-forwarding-mode = "modern"
forwarding-secret-file = "forwarding.secret"
```

`forwarding.secret` 内容为随机长串（UTF-8、非空），与后端 `proxies.velocity.secret` **逐字节相同**。

后端 Paper：

```properties
# server.properties
online-mode=false
```

```yaml
# spigot.yml
settings:
  bungeecord: false
```

```yaml
# config/paper-global.yml（Paper 1.19+）
proxies:
  velocity:
    enabled: true
    online-mode: true          # 与 velocity.toml 的 online-mode 一致
    secret: '<与 forwarding.secret 完全相同>'
```

版本边界：

- Paper **1.19+** 用 `config/paper-global.yml` 的 `proxies.velocity.*`；1.20.1、1.21.x、26.x 同键。
- Paper **1.18.2 及更低**用 `paper.yml` 的 `settings.velocity-support.{enabled,secret,online-mode}`。
- modern 仅 MC **1.13+**；Spigot 不支持 modern（只能 legacy）；与 ProtocolSupport 不兼容。

## 3. BungeeCord legacy forwarding

代理 `config.yml`：

```yaml
online_mode: true
ip_forward: true
```

后端 Spigot/Paper：

```yaml
# spigot.yml
settings:
  bungeecord: true
```

风险：legacy 把玩家 IP/UUID 以**明文文本**塞进握手包；任何能直连后端端口的人都能伪造身份。BungeeCord README 自己也警告：踢玩家不能保护服务器，必须用防火墙限制直连。

缓解：

- 防火墙只允许代理 IP 访问后端；
- 后端 `server-ip=127.0.0.1`；
- 或使用 **BungeeGuard**：Velocity 侧 `player-info-forwarding-mode = "bungeeguard"`，把 `forwarding.secret` 的值填进 BungeeGuard 的 token 配置；BungeeCord 侧安装 BungeeGuard 插件。

## 4. online-mode 放哪一侧

| 部署 | 代理 `online-mode` | 后端 `online-mode` | 转发 |
|---|---|---|---|
| 正版服（推荐） | `true` | `false` | modern（1.13+）或 legacy |
| 离线服 | `false` | `false` | legacy（modern 也可，UUID 由代理生成） |
| 单机直连 | — | `true` | 不用代理 |

后端不要同时 `online-mode=true` + 开转发：会出现「已登录」与「未登录」UUID 冲突，表现为进服即踢或数据错乱。

## 5. 上线前自检（逐项打勾）

| # | 检查项 | 正确状态 | 常见错误 |
|---|---|---|---|
| 1 | 代理转发模式 | `player-info-forwarding-mode` 与后端方案一致 | 代理 modern，后端仍留 `settings.bungeecord: true` |
| 2 | `forwarding.secret` | 代理文件与 Paper `proxies.velocity.secret` 逐字节相同 | 多换行/空格；非 UTF-8 |
| 3 | `online-mode` | 代理、`proxies.velocity.online-mode`、后端 `server.properties` 匹配 | 代理 true、Paper 侧 false |
| 4 | `spigot.yml` | modern 用 `settings.bungeecord: false`；legacy 用 `true` | 两种模式混用 |
| 5 | 后端监听 | `server-ip=127.0.0.1` 或私网 IP | 监听 `0.0.0.0` 且公网可达 |
| 6 | 防火墙 | 后端端口只允许代理机 | 玩家可直连 → legacy 可伪造 UUID |
| 7 | 版本 | 后端 1.13+ 才可用 modern；Spigot 只能 legacy | Spigot 后端配 modern |
| 8 | 日志 | 进服无「无法验证玩家信息」类报错 | secret 不匹配 → 进服即踢 |

## 6. 常见故障定位

| 现象 | 大概率原因 | 处理 |
|---|---|---|
| 进服即踢，日志提示无法验证玩家信息 | secret 不一致/缺失 | 对齐 `forwarding.secret` 与 `proxies.velocity.secret` |
| 玩家 UUID 变成离线 UUID | 代理/后端 `online-mode` 不匹配 | 按第 4 节表对齐 |
| 后端显示为「盗版服」或皮肤丢失 | 转发没生效 | 检查 `player-info-forwarding-mode` 与 `settings.bungeecord` |
| 玩家能绕过代理直连 | 防火墙/监听地址错 | 后端只监听回环，安全组只放行代理 |
| Velocity 启动报 secret 相关错误 | 文件为空/权限/编码 | UTF-8、非空、600 权限 |

## 7. 参考链接

- Velocity 玩家信息转发：https://docs.papermc.io/velocity/player-information-forwarding/
- Velocity 安全建议：https://docs.papermc.io/velocity/security/
- Paper 管理员文档（代理/后端配置入口）：https://docs.papermc.io/paper/admin/
- BungeeCord 仓库：https://github.com/SpigotMC/BungeeCord

## 8. 验证状态

- modern/legacy/bungeeguard 的配置键与版本边界：官方文档 ✅。
- Paper 1.20.1 与 1.21.x 的 `paper-global.yml` 是否完全同键：官方文档覆盖 ≥1.19，但未逐字比对生成文件，**UNVERIFIED**。
- 未在本机搭真实代理+后端；上线前按第 5 节逐项验证。
