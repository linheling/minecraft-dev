# 数据包开发（minecraft-datapack）

> **铁律：先看 `pack_format`，再看目录单复数。** 1.20.1 用格式 15 + 复数目录（`functions/`、`recipes/`），1.21.1 用 48 + 单数目录（`function/`、`recipe/`），26.3 用 121 + `min_format`/`max_format`。目录名写错时游戏**静默忽略**，日志不一定报错。
>
> 核对日期：2026-10-23。格式号与目录来自各版本 vanilla `pack.mcmeta` 与 misode/mcmeta 原件。

## 1. 三条线与分水岭

| 线 | pack_format | 目录 | 组件模型 |
|---|---|---|---|
| **1.20.1** | **15** | 复数（`functions/`、`recipes/`、`loot_tables/`） | 物品 NBT（`tag:{...}`） |
| **1.21.1** | **48** | 单数（24w21a 起） | 1.20.5+ 组件（`[custom_data={...}]`） |
| **26.3** | **121** | 单数 + 新注册表 | 组件 + `min_format`/`max_format` |

- 1.21.9（25w31a）起格式号带 minor：`pack_format` 只写 **major 整数**，minor 放 `min_format`/`max_format` 数组。
- `supported_formats` 已被 `min_format`/`max_format` 取代，仅为 <82 的旧客户端保留。
- 一个包要跨 25w31a 分界，必须**同时**写 `pack_format` 与 `min_format`/`max_format`。

## 2. 项目结构（1.21.1 基线）

```text
mypack/
├── pack.mcmeta
└── data/
    ├── minecraft/tags/function/{load.json,tick.json}
    └── mypack/
        ├── function/{load.mcfunction,tick.mcfunction,give_demo.mcfunction}
        ├── recipe/demo_stone.json
        ├── loot_table/entities/demo_zombie.json
        └── advancement/demo/root.json
```

`pack.mcmeta`（1.21.1）：

```json
{
  "pack": {
    "pack_format": 48,
    "description": "Demo 1.21.1 pack"
  }
}
```

26.3：

```json
{
  "pack": {
    "description": "26.3 pack",
    "pack_format": 121,
    "min_format": [121, 0],
    "max_format": [121, 0]
  }
}
```

1.20.1：`pack_format` 15，目录全部复数；`data/<ns>/functions/load.mcfunction`、`data/minecraft/tags/functions/load.json`。

## 3. 函数与命令

`.mcfunction` 规则：

- 一行一条命令，**不带前导 `/`**；
- `#` 注释，空行忽略；
- `\` 行续（1.20.2+）；
- `$` 宏行（1.20.2+），占位符 `$(key)`，`key` 匹配 `[a-zA-Z0-9_]+`；
- 调用宏：`function mypack:f {k:"v"}` 或 `function mypack:f with block/entity/storage <src> <path>`。

`data/mypack/function/load.mcfunction`：

```mcfunction
scoreboard objectives add demo dummy
tellraw @a {"text":"demo loaded","color":"green"}
```

`data/minecraft/tags/function/load.json`（1.21+；1.20.1 用 `tags/functions/`）：

```json
{ "values": ["mypack:load"] }
```

`data/minecraft/tags/function/tick.json`：

```json
{ "values": ["mypack:tick"] }
```

常用命令：

- `execute`：`align/anchored/as/at/facing/in/on/positioned/rotated/summon` + `if|unless ...` + `run`；`store (result|success) block|bossbar|entity|score|storage`。
- `/return`（1.20.3+）：`return <value>`、`return fail`、`return run <cmd>`；无 return 的函数为 void。
- `/schedule function <f> <time> [append|replace]`、`schedule clear`。
- `/data` 目标是 block/entity/storage；**物品不是 `/data` 的目标**，改物品用 `/item`。
- `/loot`、`/item replace|modify`、`/ride`、`/forceload` 都是原版命令，参数随版本演进。

## 4. 数据驱动注册表

文件位置：`data/<namespace>/<registry>/<path>.json` → id `namespace:path`。id 只允许 `[a-z0-9_.-]`，路径可含 `/`。

常用注册表：

| 目录（1.21+） | 1.20.1 目录 | 说明 |
|---|---|---|
| `recipe/` | `recipes/` | 配方 |
| `loot_table/` | `loot_tables/` | 战利品表 |
| `advancement/` | `advancements/` | 进度 |
| `predicate/` | `predicates/` | 谓词 |
| `item_modifier/` | `item_modifiers/` | 物品修饰器 |
| `damage_type/` | `damage_type/` | 伤害类型（无复数变化） |
| `enchantment/` | —（1.21+） | 附魔 |
| `jukebox_song/` | —（1.21+） | 唱片 |
| `tags/` | `tags/` | 标签；子目录也随单复数变化 |

配方的 `result` 在 1.20.5+ 改为 `{id, count}`：

```json
{
  "type": "minecraft:crafting_shaped",
  "pattern": ["X", "X", "#"],
  "key": {
    "X": { "item": "minecraft:diamond" },
    "#": { "item": "minecraft:stick" }
  },
  "result": { "id": "minecraft:diamond_sword", "count": 1 },
  "show_notification": true
}
```

标签默认**合并**；`"replace": true` 才覆盖。`#minecraft:load` 在世界加载与 `/reload` 后执行，`#minecraft:tick` 每 tick 执行。

## 5. 物品组件（1.20.5+）

1.20.5（格式 41）起物品数据模型是 `{id, count, components}`；旧的 `tag:{...}` 不再解析。

```mcfunction
give @s minecraft:stone[minecraft:custom_data={demo:1b},minecraft:item_name='{"text":"Demo Stone"}']
give @s minecraft:diamond_sword[!minecraft:attribute_modifiers]
item modify entity @s weapon.mainhand {"type":"minecraft:set_components","components":{"minecraft:custom_data":{blessed:1b}}}
```

| 1.20.1 NBT | 1.20.5+ 组件 |
|---|---|
| `tag.display.Name` | `minecraft:custom_name`（玩家可改）/ `minecraft:item_name`（1.21.2+） |
| `tag.display.Lore` | `minecraft:lore` |
| `tag.Enchantments` | `minecraft:enchantments` |
| `tag.CustomModelData` | `minecraft:custom_model_data`（1.21.4+ 变对象） |
| 自定义键 | `minecraft:custom_data` |

迁移规则：`{...}` 换方括号、组件键可省略 `minecraft:` 前缀、移除组件用 `!`。

## 6. 调试

| 操作 | 命令/位置 | 注意 |
|---|---|---|
| 列表/启停 | `/datapack list [available|enabled]`、`/datapack enable/disable ...` | 磁盘包用 `file/` 前缀 |
| 热重载 | `/reload` | 只重载 function/tags/loot_table/recipe/advancement/predicate/item_modifier/structure；worldgen、dimension、enchantment、damage_type、variant 只在世界加载时读 |
| 日志 | `logs/latest.log` | JSON 错误通常带文件名+行号；路径错误可能静默忽略 |
| 安全模式 | 解析失败时游戏进入 Safe Mode | 修 JSON 后 reload，不要硬顶 |

常见错误：

1. 1.21+ 仍用 `functions/` / `tags/functions/` → 函数不执行；
2. `pack_format` 与目标版本不符 → 「为更旧/更新版本制作」；
3. `pack.mcmeta` 缺 `description` 或 JSON 尾逗号 → 整个包不加载；
4. 命名空间含大写/空格、扩展名不是 `.json` → 配方/战利品表被忽略；
5. 1.20.1 的 `tag:{...}` 写进 1.20.5+ → 组件语法错误；
6. 改 worldgen 后 `/reload` 无效 → 需退出重进世界/重启；
7. 1.20.1 写 `$` 宏 → 未知命令（宏要 1.20.2+）。

## 7. 参考索引

| 主题 | 文件 |
|---|---|
| `pack.mcmeta`、格式号、目录单复数、版本矩阵 | `references/api/pack-format-and-layout.md` |
| 函数、宏、`execute`/`return`/`schedule`/`data`/`item`/`loot`/`ride` | `references/api/functions-and-commands.md` |
| 1.20.5+ 组件、NBT 迁移、谓词、配方/战利品表版本差异 | `references/api/components-and-migration.md` |

## 8. 验证边界

- 格式号与目录名：vanilla `pack.mcmeta` / misode/mcmeta 原件核对（2026-10-23）。
- 26.4 正式版 `pack_format` 未知；只核实到 26.4-snapshot-5 = 125.0。
- 未在游戏内加载本仓库示例；粘贴前用 JSON 校验器并看 `latest.log`。
- 无法核实的条目会在正文注明待核实，不要当确定事实。
