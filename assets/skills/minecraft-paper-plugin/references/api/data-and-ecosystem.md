# Paper 持久化与插件生态（PDC / Vault / PlaceholderAPI / BossBar / Scoreboard）

> 适用：Paper 1.20.x / 1.21.x / 26.2 / 26.3
> 核对来源：docs.papermc.io 与 jd.papermc.io（javadoc），Vault/PlaceholderAPI 用各自官方仓库
> 核对日期：2026-10-21

构建坐标跟版本线走（仓库 `lib/versions.js`）：1.21.x → `io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT`，26.x → `io.papermc.paper:paper-api:26.3.build.+`。本文签名在 1.21.8 与 26.3（`26.3.build.209-stable`）两份 javadoc 上逐条对过，26.x 相关类无破坏性变更。

## 1. 适用版本与依赖形态

| 能力 | 提供方 | 1.20.x | 1.21.x | 26.2 / 26.3 | 关键差异 |
| --- | --- | --- | --- | --- | --- |
| PDC | paper-api 内置 | 有 | 有 | 有 | `ItemStack#editPersistentDataContainer` 仅 1.21.4+ |
| BossBar | paper-api 内置 | 有 | 有 | 有 | `hide()` 已弃用 → `setVisible(false)` |
| Scoreboard | paper-api 内置 | 有 | 有 | 有 | String 版 `registerNewObjective` 已弃用 |
| Vault | 外部插件 `Vault` | 软依赖 | 软依赖 | 软依赖 | 走服务注册表，取不到必须降级 |
| PlaceholderAPI | 外部插件 `PlaceholderAPI` | 软依赖 | 软依赖 | 软依赖 | 内部 expansion 必须 `persist()` |

历史起点：Scoreboard 全版本可用；BossBar 随 1.9 API 出现；PDC 自 1.14 起。后两项小版本只查到社区口径（SpigotMC 讨论、TAB 文档 "Only works on Minecraft 1.9 and up"），`jd.papermc.io` 类页无 `@since`、docs 未写引入版本 → **UNVERIFIED**（官方源缺该元数据，无法直接读到）；功能存在性无碍：三个类在 1.20.x / 1.21.8 / 26.3 的 javadoc 里都在。

## 2. PersistentDataContainer（PDC）

官方推荐的自定义数据存储：不碰 NBT 反射，实体卸载时数据随实体存档。官方页 `https://docs.papermc.io/paper/dev/pdc`。

### 2.1 哪些类型真的持有 PDC

`PersistentDataHolder` 的「All Known Subinterfaces」与 docs 类清单一致，**能直接 `getPersistentDataContainer()` 的是**：

| 类型 | 全限定名 | 说明 |
| --- | --- | --- |
| 物品 / 元数据 | `org.bukkit.inventory.ItemStack`、`org.bukkit.inventory.meta.ItemMeta` | 1.21.4+ 写用 `editPersistentDataContainer(Consumer)`；读取返回只读 `io.papermc.paper.persistence.PersistentDataContainerView` |
| 实体 | `org.bukkit.entity.Entity` | `PersistentDataHolder` |
| 方块实体 | `org.bukkit.block.TileState` | 箱子/告示牌/熔炉等有方块实体的方块 |
| 世界 / 区块 | `org.bukkit.World`、`org.bukkit.Chunk` | 均实现 `PersistentDataHolder` |
| 其他 | `Structure`、`GeneratedStructure`、`Raid`、`OfflinePlayer` | docs 列出，少用 |

**`BlockState` 本身不是 `PersistentDataHolder`**，只有子接口 `TileState` 是（`TileState extends BlockState, PersistentDataHolder`），所以方块侧必须先 `instanceof TileState`。容器方法：`set` / `get`（可能 null）/ `getOrDefault` / `has(key)` / `has(key, type)` / `remove` / `getKeys` / `getAdapterContext`。

### 2.2 NamespacedKey 与常用类型

`new NamespacedKey(plugin, "level")` 用插件名当命名空间，等价于 `new NamespacedKey("myplugin", "level")`，天然避开跨插件键冲突。`PersistentDataType` 常量（1.21.8 与 26.3 一致）：`BOOLEAN`、`BYTE`、`SHORT`、`INTEGER`、`LONG`、`FLOAT`、`DOUBLE`、`STRING`、`BYTE_ARRAY`、`INTEGER_ARRAY`、`LONG_ARRAY`、`TAG_CONTAINER`、`LIST`。

- `BOOLEAN` 底层就是 byte，官方注明存在只是 "for convenience"，不是独立 NBT 类型。
- `LIST` 不是普通类型而是 `ListPersistentDataTypeProvider`：用 `PersistentDataType.LIST.strings()` / `.integers()` / `.dataContainers()`，或 `LIST.listTypeFrom(PersistentDataType.STRING)` 自建。
- `TAG_CONTAINER_ARRAY` 已 `@Deprecated(since="1.20.4")`，改用 `LIST.dataContainers()`；自定义类型必须传实例（如 `UUIDDataType.INSTANCE`），不能只传 Class。

### 2.3 物品：写入与读取

`ItemStack` 的写入是快照语义：改完必须 `setItemMeta` 写回。1.21.4+ 另有 `editPersistentDataContainer(Consumer)` 可直接在 lambda 里写，免去 ItemMeta。

```java
NamespacedKey levelKey = new NamespacedKey(plugin, "level");   // plugin 即 JavaPlugin 实例

ItemMeta meta = item.getItemMeta();                            // 经典写法：取快照 → 改 → 写回
meta.getPersistentDataContainer().set(levelKey, PersistentDataType.INTEGER, 5);
item.setItemMeta(meta);                                        // 不写回，改动当场丢失

// 1.21.4+：容器直接挂在 ItemStack 上，lambda 里改完即生效
item.editPersistentDataContainer(pdc -> pdc.set(levelKey, PersistentDataType.INTEGER, 5));

// 读取走只读视图 PersistentDataContainerView，同样不需要 ItemMeta
int level = item.getPersistentDataContainer().getOrDefault(levelKey, PersistentDataType.INTEGER, 0);
```

### 2.4 实体：直接写，靠卸载存档

```java
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

public final class EntityTags {
    private final NamespacedKey sourceKey;
    private final NamespacedKey expireKey;

    public EntityTags(Plugin plugin) {
        this.sourceKey = new NamespacedKey(plugin, "spawn_source");
        this.expireKey = new NamespacedKey(plugin, "spawn_expire");
    }

    public void mark(Entity entity, String source, long expiresAt) {
        PersistentDataContainer pdc = entity.getPersistentDataContainer();
        pdc.set(sourceKey, PersistentDataType.STRING, source);
        pdc.set(expireKey, PersistentDataType.LONG, expiresAt);
    }

    public boolean isManaged(Entity entity, long now) {
        Long expiresAt = entity.getPersistentDataContainer().get(expireKey, PersistentDataType.LONG);
        return expiresAt != null && expiresAt > now;   // 类型不符时 get 抛异常，别用 getOrDefault 掩盖
    }
}
```

### 2.5 方块与删除

```java
NamespacedKey ownerKey = new NamespacedKey(plugin, "owner");
BlockState state = block.getState();
if (!(state instanceof TileState tile)) {
    return false;                              // 普通方块（石头、草方块…）没有 PDC
}
tile.getPersistentDataContainer().set(ownerKey, PersistentDataType.STRING, "Steve");
tile.update();                                 // 不 update 只改了内存快照
```

删除用 `pdc.remove(ownerKey)`；判断存在用 `has(key)` 或带类型的 `has(key, type)`，别用 `get() != null`。迁移三条铁律：键名当协议对待，改名等于丢数据（先写双读旧键的过渡代码）；同一键的类型一旦换（STRING→INTEGER），旧值 `get` 会抛异常而不是返回 null；PDC 是可变的容器对象，改完仍要按对象类型重新保存。

## 3. Vault（经济 / 权限抽象）

Vault 只是抽象层，`Economy` 的真实实现来自服务端装的经济插件（EssentialsX、CMI 等）。坐标以官方 README 为准：仓库 `https://jitpack.io`，依赖 `com.github.MilkBowl:VaultAPI:1.7`，`plugin.yml` 写 `softdepend: [Vault]`；软依赖检测用 `Bukkit.getPluginManager().isPluginEnabled("Vault")` 或 `getPlugin("Vault") != null`，两者都要判，因为 Vault 装了也可能没有经济实现。

```java
import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.RegisteredServiceProvider;

public final class EconomyHook {
    private Economy economy;                       // null 表示没装 Vault 或没有经济实现

    public boolean setup() {
        if (!Bukkit.getPluginManager().isPluginEnabled("Vault")) return false;
        RegisteredServiceProvider<Economy> rsp = Bukkit.getServicesManager().getRegistration(Economy.class);
        if (rsp == null) return false;             // 有 Vault，但没插件注册 Economy
        this.economy = rsp.getProvider();
        return economy.isEnabled();
    }

    public boolean charge(OfflinePlayer player, double amount) {
        if (economy == null) return true;          // 降级：没经济就免单，别让主流程崩
        EconomyResponse response = economy.withdrawPlayer(player, amount);
        return response.transactionSuccess();
    }
}
```

常用：`Economy` 的 `getBalance` / `has` / `withdrawPlayer` / `depositPlayer`（String 与 OfflinePlayer 两种重载，部分带 world），写入类返回 `EconomyResponse`（`transactionSuccess()`、`amount`、`balance`、`errorMessage`）；权限侧 `Permission` 用 `has(Player, String)` / `playerHas` / `playerAdd`。

## 4. PlaceholderAPI（对外暴露占位符）

抽象基类 `me.clip.placeholderapi.expansion.PlaceholderExpansion`（`extends PlaceholderHook`）；数据入口是 `PlaceholderHook.onRequest(OfflinePlayer, String)`，旧式 `onPlaceholderRequest(Player, String)` 只在没覆写 `onRequest` 时被转调；消费别人的占位符用 `PlaceholderAPI.setPlaceholders(OfflinePlayer, String)`。

```java
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.java.JavaPlugin;
import org.jetbrains.annotations.NotNull;

public final class StatsExpansion extends PlaceholderExpansion {
    private final JavaPlugin plugin;
    private final StatsStore store;                // 你自己的统计源

    StatsExpansion(JavaPlugin plugin, StatsStore store) {
        this.plugin = plugin;
        this.store = store;
    }

    @Override public @NotNull String getIdentifier() { return "mystats"; }
    @Override public @NotNull String getAuthor() { return "you"; }
    @Override public @NotNull String getVersion() { return plugin.getPluginMeta().getVersion(); }

    @Override public boolean persist() { return true; }   // reload 后不被注销，内部 expansion 必须 true

    @Override public String onRequest(OfflinePlayer player, @NotNull String params) {
        if (player == null) return "";             // 控制台等无玩家语境
        return switch (params) {
            case "kills" -> String.valueOf(store.kills(player.getUniqueId()));
            case "coins" -> String.valueOf(store.coins(player.getUniqueId()));
            default -> null;                       // 不认识的参数交回 PAPI
        };
    }
}
```

注册放在 `onEnable` 且先确认在线：`if (Bukkit.getPluginManager().isPluginEnabled("PlaceholderAPI")) new StatsExpansion(this, store).register();`（`register()` 返回 boolean）。`plugin.yml` 写 `softdepend: [PlaceholderAPI]`；仓库地址与最新坐标以官方 wiki（https://wiki.placeholderapi.com/）为准，`compileOnly 'me.clip:placeholderapi:2.11.6'`（当前线已到 2.12.x）。插件没装时 `setPlaceholders` 原样返回字符串不抛异常，但类本身会 `NoClassDefFoundError`，判空不可省。

## 5. BossBar（屏幕顶部进度条）

`Bukkit.createBossBar(String title, BarColor color, BarStyle style, BarFlag... flags)`，进度默认 1.0；颜色 `BLUE/GREEN/PINK/PURPLE/RED/WHITE/YELLOW`，样式 `SOLID` 与 `SEGMENTED_6/10/12/20`，旗标 `CREATE_FOG/DARKEN_SKY/PLAY_BOSS_MUSIC`。用法是一条链：`BossBar bar = Bukkit.createBossBar("突袭进度", BarColor.RED, BarStyle.SEGMENTED_10)` → `bar.addPlayer(player)` → `bar.setProgress(0.5)`（只接受 0.0~1.0，越界抛异常）→ 结束时 `bar.setVisible(false)` 加 `bar.removeAll()`；单人退出用 `bar.removePlayer(player)`，隐藏用 `setVisible(false)`（`hide()` 已弃用）。

## 6. Scoreboard（侧边栏与队伍前后缀）

```java
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

public void applySidebar(Player player) {
    Scoreboard board = Bukkit.getScoreboardManager().getNewScoreboard();  // 每人一份，别动主计分板
    Objective objective = board.registerNewObjective("mystats", Criteria.DUMMY, Component.text("== 统计 =="));
    objective.setDisplaySlot(DisplaySlot.SIDEBAR);
    Team team = board.registerNewTeam("vip");
    team.addEntry(player.getName());
    team.prefix(Component.text("[VIP] "));         // setPrefix(String) 已弃用
    objective.getScore("击杀").setScore(store.kills(player.getUniqueId()));
    player.setScoreboard(board);
}
```

`registerNewObjective(String, Criteria, Component)` 是未弃用写法，`(String, String, ...)` 与 `(String, Criteria, String)` 重载全部已弃用；`Team` 的 `prefix/suffix/displayName` 也都换成了 `Component` 版。玩家退出时还原计分板（`player.setScoreboard(Bukkit.getScoreboardManager().getMainScoreboard())`），别把离线 `Player` 挂在静态表里。

## 7. 常见坑

- **PDC 键裸拼字符串** → 跨插件互踩；一律 `new NamespacedKey(plugin, "key")`。
- **异步线程碰 PDC / Scoreboard / BossBar** → 主线程断言失败或数据竞争；三者都在主线程操作。
- **写完不落盘** → 方块不 `update()`、物品不 `setItemMeta` 都只改内存快照；**把 `BlockState` 当 `PersistentDataHolder`** 编译期就挂，只能先转 `TileState`。
- **`has(key)` 当 `has(key, type)` 用** → 类型变更后判断失真，读取抛异常。
- **BossBar 建了不清理** → `addPlayer` 持有 `Player` 引用，换图/退服累积泄漏；`onDisable` 里 `removeAll()`。
- **PlaceholderAPI 没装就调 `setPlaceholders`** → `NoClassDefFoundError`；`softdepend` + `isPluginEnabled` 双保险。
- **Vault 装了但经济插件没装** → `getRegistration(Economy.class)` 返回 null，直接 `getProvider()` 就是 NPE。

## 8. 参考链接

- PDC 官方文档：`https://docs.papermc.io/paper/dev/pdc`
- Paper javadoc（1.21.8 与 26.3 两套）：`https://jd.papermc.io/paper/1.21.8/`、`https://jd.papermc.io/paper/26.3/`，类在 `org/bukkit/` 下的 `persistence/`、`boss/`、`scoreboard/`
- Vault：`https://github.com/MilkBowl/VaultAPI`、`https://github.com/MilkBowl/Vault`
- PlaceholderAPI：`https://github.com/PlaceholderAPI/PlaceholderAPI`、依赖 `https://wiki.placeholderapi.com/developers/using-placeholderapi/`、扩展开发 `https://wiki.placeholderapi.com/developers/creating-a-placeholderexpansion/`
