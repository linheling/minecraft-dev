# Paper 文本与 Component API（Adventure）
> 适用：Paper 1.20.x / 1.21.x / 26.2 / 26.3（Adventure 为 Paper 内置；Spigot 无该 API，只能用 § 字符串）
> 核对来源：docs.papermc.io 与 jd.papermc.io（javadoc）
> 核对日期：2026-10-21

本页只讲「把文字送到玩家眼前」这条链路：`Component` 构造、`Audience` 发送、MiniMessage 解析、旧格式互转、标题/动作栏、物品显示名。两站都查不到的条目在行内标 `UNVERIFIED`（括号写明原因），用前请自行确认。其它 Paper API 见同目录 [commands.md](commands.md)、[events.md](events.md)、[folia.md](folia.md)。

## 1. 适用版本与依赖

Adventure 不是外挂库：`paper-api` 已把 `net.kyori.adventure.*` 与 MiniMessage 一起带进来，只依赖 `paper-api` 就能 `import net.kyori.adventure.text.Component`，**不需要**额外声明 `net.kyori:adventure-*`（那是给非 Paper 平台用的）。

| 版本线 | 仓库钉选 | Java | paper-api 坐标 | Component/Audience | MiniMessage |
|---|---|---|---|---|---|
| 1.20 | 1.20.6 | 21 | `io.papermc.paper:paper-api:1.20.6-R0.1-SNAPSHOT`（该 jar 为 Java 21 字节码，脚手架默认 toolchain 21） | 有 | 有 |
| 1.21 | 1.21.8 | 21 | `io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT` | 有 | 有 |
| 26 | 26.2 | 25 | `io.papermc.paper:paper-api:26.2.build.+` | 有 | 有 |
| 26.3 | 26.3 | 25 | `io.papermc.paper:paper-api:26.3.build.+` | 有 | 有 |
| Spigot | —— | —— | `org.spigotmc:spigot-api` | **无** | **无** |

```kotlin
// build.gradle.kts —— 与仓库 lib/versions.js 的钉选一致
dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT") // 1.20.6 线改成 1.20.6-R0.1-SNAPSHOT
    // 26 线滚动取该线最新构建（当前解析到 -stable）：compileOnly("io.papermc.paper:paper-api:26.3.build.+")
}
```

注意：`26.3.build.+` 是「该线当前最新构建」，新构建发布后同一份配置解析出的版本会变；需要可复现构建时钉死版本号。

## 2. Component、Audience 与样式

- `Component` 为不可变文本节点。官方出现过的构造方式：`Component.text(String)`、`Component.text()`（builder，可 `.content().color().append().build()`）、`Component.translatable(String, ComponentLike...)`（i18n 页示例 `Component.translatable("some.translation.key", Component.text("The Argument"))`）、`Component.empty()`、`Component.keybind(String)`。
- `Component.join(...)`：`UNVERIFIED`（docs.papermc.io/adventure/text 与 paper/dev/component-api/* 均无该工厂方法示例，jd.papermc.io 不收录 net.kyori 包）。拼接子节点用 `Component.text().append(...)` 更稳。
- `Audience` 是「能接收消息的对象」：玩家、控制台、队伍、整批玩家都是。Paper 的 `org.bukkit.command.CommandSender` **extends Audience**（jd 1.21.4 页 "All Superinterfaces: Audience, Permissible, …"），所以控制台/命令发送者可直接 `sendMessage(Component)`。
- 颜色：`TextColor.color(int)`（`0xRRGGBB`）与 `NamedTextColor.*`（示例含 `LIGHT_PURPLE`、`GREEN`、`WHITE` 等）。装饰：`TextDecoration.BOLD / UNDERLINED / ITALIC / STRIKETHROUGH / OBFUSCATED`，用 `.decoration(TextDecoration.BOLD, true)` 打开——默认 `NOT_SET`，不显式打开不会有样式。

```java
package com.example.text;

import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

public final class BasicText {
    public void greet(Player player) {
        // 父组件带样式，追加的子组件会继承
        final Component hello = Component.text()
                .content("欢迎回来，")
                .color(NamedTextColor.GRAY)
                .append(Component.text(player.getName()).color(NamedTextColor.AQUA))
                .append(Component.text("！"))
                .build();
        player.sendMessage(hello);                    // Audience#sendMessage(Component)
        // RGB 颜色：TextColor.color(0xRRGGBB)
        player.sendMessage(Component.text("RGB 文本").color(TextColor.color(0x438df2)));
        player.sendMessage(Component.text("重点").decoration(TextDecoration.BOLD, true)); // 装饰默认 NOT_SET
        // 翻译键：客户端按自己的语言渲染，参数是 Component
        player.sendMessage(Component.translatable(
                "some.translation.key", Component.text("The Argument")));

        // 控制台也是 Audience（CommandSender extends Audience）
        final Audience console = Bukkit.getConsoleSender();
        console.sendMessage(Component.text("控制台日志行"));
    }
}
```

## 3. MiniMessage

- 实例：`MiniMessage.miniMessage()`（默认标签集、非严格模式；原文 `A standard instance of the serializer is available through the miniMessage() method.`）。
- 转换：`mm.deserialize(String)` → `Component`；`mm.serialize(Component)` → `String`（官方称「有可编辑需求时首选」，Component→字符串无损）。
- 严格模式：默认**不会**因用户输入抛异常，非法标签当普通文本；`MiniMessage.builder().strict(true).build()` 才开启严格校验（原文 `MiniMessage.Builder#strict(true) mode will enable strict mode`）。

| 需求 | 标签 | 备注 |
|---|---|---|
| 颜色 | `<#438df2>` / `<red>` / `<yellow>` / `<gray>` | 十六进制色写法见 introduction 示例 `<#438df2><b>…`；命名字色与 `NamedTextColor` 对应 |
| 加粗 | `<bold>` / `<b>` | 另有 `<italic>`、`<underlined>`、`<strikethrough>`、`<obfuscated>` |
| 渐变/彩虹 | `<gradient:…>` / `<rainbow>` | format 页有收录 |
| 点击执行命令 | `<click:run_command:/seed>` | format 页示例即此形（参数可不加引号） |
| 悬停文本 | `<hover:show_text:'<gold>提示'>` | 参数用单引号包住，内部可再写标签 |

```java
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.entity.Player;

public final class MiniMessageText {
    private static final MiniMessage MM = MiniMessage.miniMessage();

    public void send(Player player) {
        // 颜色 + 样式
        final Component styled = MM.deserialize("<#438df2><b>服务器公告</b> <yellow>欢迎");
        player.sendMessage(styled);
        // 可点击、可悬停
        player.sendMessage(MM.deserialize("<click:run_command:/spawn><green>[回城]"));
        player.sendMessage(MM.deserialize("<hover:show_text:'<gold>点击后传送到主城'><gray>[把鼠标放上来]"));
        // Component -> MiniMessage 字符串，便于写入配置文件
        final String text = MM.serialize(styled);
        // 严格模式：标签写错立即抛异常，适合开发期校验配置
        final MiniMessage strict = MiniMessage.builder().strict(true).build();
        player.sendMessage(strict.deserialize("<red>只在确定格式时使用"));
    }
}
```

**安全**：不要把玩家输入直接拼进模板再 `deserialize`——用户能注入颜色、换行，甚至 `<click:run_command:...>` 让其他玩家点一下就执行命令。正确做法：把用户文本作为独立 `Component`（`Component.text(userInput)`）插入，或先转义 `<`、`>`。用户输入场景保持默认（非严格）模式，避免抛异常打断主线程。

## 4. 旧格式互转与物品显示

- `LegacyComponentSerializer.legacySection()`（`§` 前缀）与 `legacyAmpersand()`（`&` 前缀，配置文件常见），官方原文：`There are 2 built-in legacy serializers, one dealing with § symbols and the other for & symbols. They have their own instances available through LegacyComponentSerializer#legacySection() and LegacyComponentSerializer#legacyAmpersand().`；两者都提供 `deserialize(String)` / `serialize(Component)`。
- `PlainTextComponentSerializer.plainText()`：`Component` → 纯文本，**有损**（样式全丢），只用于日志、文件名等。
- 迁移写法（官方 introduction 原文）：`MiniMessage.miniMessage().serialize(LegacyComponentSerializer.legacySection().deserialize(legacyString))`。
- 物品显示（Paper API）：`ItemMeta.displayName(Component)`、`ItemMeta.itemName(Component)`、`ItemMeta.lore(List<? extends Component>)`（26.3 jd 形参为 `@Nullable List<? extends Component> lore`）；旧的 `setDisplayName(String)` / `setLore(List<String>)` / `getDisplayName()` / `getLore()` 在 1.21.4 deprecated-list 中，仅作兼容保留。

```java
import java.util.List;
import java.util.Objects;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

public final class ItemText {
    public ItemStack fancyDiamond() {
        final ItemStack stack = new ItemStack(Material.DIAMOND);
        final ItemMeta meta = Objects.requireNonNull(stack.getItemMeta());
        meta.displayName(Component.text("闪耀的钻石").color(NamedTextColor.AQUA));
        meta.itemName(Component.text("钻石"));          // 更接近「物品本身的名字」语义
        meta.lore(List.of(
                Component.text("第一行 Lore"),
                Component.text("第二行 Lore").color(NamedTextColor.GRAY)));
        stack.setItemMeta(meta);
        return stack;
    }
}
```

## 5. 标题与动作栏

- 标题：`player.showTitle(Title.title(mainTitle, subtitle))`；带时长用 `Title.title(Component, Component, Title.Times)`，其中 `Title.Times.times(Duration, Duration, Duration)` 是嵌套类 `net.kyori.adventure.title.Title.Times`（**没有**独立 `Times` 类）。
- 动作栏：`player.sendActionBar(Component)`；清理用 `Audience#resetTitle()` / `clearTitle()`。
- 旧重载仍在：26.3 的 Player 页同时有 `showTitle(net.kyori.adventure.title.Title)` 与 `sendActionBar(net.kyori.adventure.text.Component)`，也保留 `sendActionBar(String)`、`sendTitle(String, String, int, int, int)`、`BaseComponent` 版本——后者供旧插件兼容、已 `@Deprecated`，新代码别再用。

```java
import java.time.Duration;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.entity.Player;

public final class TitleText {
    public void announce(Player player) {
        // 淡入 500ms / 停留 3000ms / 淡出 1000ms
        final Title.Times times = Title.Times.times(
                Duration.ofMillis(500), Duration.ofMillis(3000), Duration.ofMillis(1000));
        player.showTitle(Title.title(
                Component.text("活动开始").color(NamedTextColor.GOLD),
                Component.text("3 分钟后集合"),
                times));
        player.sendActionBar(Component.text("剩余 3 分钟").color(NamedTextColor.YELLOW));
        // 收尾：player.resetTitle(); 或 player.sendActionBar(Component.empty());
    }
}
```

## 6. 旧写法 → 新写法

| 场景 | 旧写法（Spigot / §） | 新写法（Paper / Adventure） |
|---|---|---|
| 发一条彩色消息 | `player.sendMessage("§a绿色")` | `player.sendMessage(MiniMessage.miniMessage().deserialize("<green>绿色"))` |
| 程序化构造文本 | `player.sendMessage(ChatColor.GREEN + "x")` | `player.sendMessage(Component.text("x").color(NamedTextColor.GREEN))` |
| 物品显示名 / Lore | `meta.setDisplayName("§b名字")` / `meta.setLore(List.of("§7行"))` | `meta.displayName(Component.text("名字").color(NamedTextColor.AQUA))` / `meta.lore(List.of(Component.text("行").color(NamedTextColor.GRAY)))` |
| 标题 | `player.sendTitle("§6主", "§e副", 10, 60, 20)` | `player.showTitle(Title.title(main, sub, times))` |
| 动作栏 | `player.sendActionBar("§e...")` | `player.sendActionBar(Component)` |
| 解析配置里的 `&` 颜色 | 手写 `replace('&', '§')` | `LegacyComponentSerializer.legacyAmpersand().deserialize(s)` |
| 去色取纯文本 | `ChatColor.stripColor(s)` | `PlainTextComponentSerializer.plainText().serialize(c)` |
| 点击执行命令（Java 侧） | —— | MiniMessage `<click:run_command:/spawn>`；`ClickEvent.runCommand(String)` 为 `UNVERIFIED`（两站只有标签与 `ClickEvent.openUrl(...)` 示例） |

## 7. 常见坑

- **MiniMessage 与 legacy 混用 / legacy 往返有损**：`<red>` 不会被 `LegacyComponentSerializer` 解析，`§a` 也不会被 MiniMessage 解析，先判断配置格式再选 serializer；且 legacy 字符串表示不了 click/hover、translatable、自定义字体，`Component → legacy → Component` 会丢这些，持久化复杂文本请用 MiniMessage 或 JSON。
- **颜色被客户端资源包覆盖**：服务端下发或玩家自带的资源包会改字体/配色，RGB 自定义色在第三方资源包里可能失真。关键提示用命名字色 + 文字说明，别只靠颜色传达信息。
- **Audience 与 CommandSender**：Paper 里 `CommandSender extends Audience`，反过来不成立；工具方法形参收 `Audience` 最通用（玩家、控制台、`Audience.audience(players)` 都行）。Spigot 的 `CommandSender` 不继承 `Audience`，别假设「一份代码两端都编译」。
- **异步线程发消息**：别从异步线程直接 `showTitle` / `sendActionBar` / 改 `ItemMeta`。统一 `Bukkit.getScheduler().runTask(plugin, ...)` 回主线程；Folia 用区域/全局调度器（见 [folia.md](folia.md)）。
- **Paper 与 Spigot 兼容性**：只依赖 `spigot-api` 编译时 `net.kyori.*` 不存在，编译直接失败。现代插件通常声明 `api-version` 并只针对 Paper（MiniMessage 的 strict 模式同理只在校验自有配置时开，别对用户输入开）。

## 8. 参考链接（2026-10-21 实测可达）

- Paper 组件文档：https://docs.papermc.io/paper/dev/component-api/introduction/ ・ https://docs.papermc.io/paper/dev/component-api/audiences/ ・ https://docs.papermc.io/paper/dev/component-api/i18n/；Adventure 文档（原 docs.advntr.dev 已 301 到此）：https://docs.papermc.io/adventure/ ・ https://docs.papermc.io/adventure/text/ ・ https://docs.papermc.io/adventure/audiences/ ・ https://docs.papermc.io/adventure/titles/
- MiniMessage 与序列化器：https://docs.papermc.io/adventure/minimessage/format/ ・ https://docs.papermc.io/adventure/minimessage/api/ ・ https://docs.papermc.io/adventure/serializer/legacy/ ・ https://docs.papermc.io/adventure/serializer/plain/
- javadoc：https://jd.papermc.io/paper/1.21.4/org/bukkit/entity/Player.html ・ https://jd.papermc.io/paper/1.21.4/org/bukkit/command/CommandSender.html ・ https://jd.papermc.io/paper/1.21.4/org/bukkit/inventory/meta/ItemMeta.html ・ https://jd.papermc.io/paper/26.3/org/bukkit/inventory/meta/ItemMeta.html ・ https://jd.papermc.io/paper/26.3/org/bukkit/entity/Player.html ・ https://jd.papermc.io/paper/1.21.8/

未收录的类/方法：jd.papermc.io 的 paper javadoc **不收录 `net.kyori.adventure` 包**（`net/kyori/adventure/text/Component.html` 在 1.21.4 与 26.3 均 404），Adventure 侧要去 `docs.papermc.io/adventure/` 对应章节看正文代码；旧链接 `https://docs.papermc.io/paper/dev/component-text/` 已 404，正确路径是 `/paper/dev/component-api/introduction/`。两边都查不到就标 `UNVERIFIED` 再动手。
