# 数据包函数与命令参考（1.20.1 / 1.21.1 / 26.x）

> 覆盖 `.mcfunction` 规则、宏、函数标签、`execute`、`return`、`schedule`、`data`、`item`、`loot`、`ride`、`forceload`。
> 核对来源：Minecraft Wiki 命令页、vanilla 数据包原件、26.x 变更日志。核对日期：2026-10-23。示例为文档级验证，未在游戏内逐条执行。

## 1. `.mcfunction` 规则

- 一行一条命令，**不带前导 `/`**；
- `#` 开头是注释；空行忽略；
- 行尾 `\` 续行（1.20.2+）；
- `$` 开头是宏行（1.20.2+），可含多个 `$(key)`；
- 函数文件路径 = 资源 id：`data/mypack/function/demo/give.mcfunction` → `mypack:demo/give`；
- 函数默认返回 void；用 `/return` 返回数值。

```mcfunction
# data/mypack/function/load.mcfunction
scoreboard objectives add demo dummy
tellraw @a {"text":"demo loaded","color":"green"}
```

## 2. 函数标签：load / tick

`data/minecraft/tags/function/load.json`（1.20.1 为 `tags/functions/`）：

```json
{ "values": ["mypack:load"] }
```

`data/minecraft/tags/function/tick.json`：

```json
{ "values": ["mypack:tick"] }
```

- `#minecraft:load`：世界加载时执行一次，并在每次 `/reload` 后再次执行；
- `#minecraft:tick`：每 tick 执行（20 次/秒）；
- 多个包写同名标签默认**合并**；`{"replace": true, "values": [...]}` 才覆盖；
- tick 函数要轻量；重逻辑用 `schedule` 分摊到多 tick。

## 3. 宏（1.20.2+）

`data/mypack/function/greet.mcfunction`：

```mcfunction
$tellraw @a {"text":"Hello $(name)","color":"$(color)"}
```

调用：

```mcfunction
function mypack:greet {name:"Steve",color:"green"}
```

或用存储/实体传参：

```mcfunction
function mypack:greet with storage mypack:args input
function mypack:greet with entity @s SelectedItem
```

规则：

- `$` 必须是行首第一个字符；宏行里每个 `$(key)` 都会被替换；
- key 匹配 `[a-zA-Z0-9_]+`；
- 传参是 SNBT 对象；缺 key 会报错；
- 1.20.1 不支持宏。

## 4. `execute`

结构：

```text
execute <修饰子命令...> (if|unless <条件>|run <命令>)
```

常用修饰：

- `as <targets>`：改变执行者；
- `at <targets>`：改变位置/维度/朝向；
- `positioned <pos>` / `positioned as <targets>`；
- `rotated <rot>` / `rotated as <targets>`；
- `anchored eyes|feet`；
- `facing <pos>` / `facing entity <targets> <anchor>`；
- `align xyz`；
- `in <dimension>`；
- `on <relation>`（1.21+）；
- `summon <entity>`（1.21+）。

条件：

- `if|unless block <pos> <block>`；
- `if|unless blocks <start> <end> <dest> [all|masked]`；
- `if|unless data block|entity|storage <target> <path>`；
- `if|unless entity <targets>`；
- `if|unless predicate <predicate>`；
- `if|unless score <target> <objective> <op> <source> <sourceObjective>`；
- `if|unless biome <pos> <biome>`（1.19.4+）；
- `if|unless dimension <dimension>`（1.19.4+）；
- `if|unless loaded <pos>`（1.20.5+）；
- `if|unless items block|entity ... <item_predicate>`（1.20.5+）；
- `if|unless function <function>`（1.20.2+）。

示例：

```mcfunction
# 给所有在线玩家发火焰粒子
execute as @a at @s run particle minecraft:flame ~ ~1 ~ 0 0 0 0 1

# 只有主手是钻石剑才执行
execute as @a if items entity @s weapon.mainhand minecraft:diamond_sword run say has sword

# 条件失败时执行 else
execute if entity @a[limit=1] run say someone online
execute unless entity @a[limit=1] run say nobody online
```

`store`：

```mcfunction
execute store result score @s demo run data get entity @s Health
execute store result storage mypack:data value run time query gametime
```

`store (result|success) block|bossbar|entity|score|storage ...`；`result` 存返回值，`success` 存是否成功（0/1）。

## 5. `return`（1.20.3+）

```mcfunction
# 返回整数
return 1

# 条件失败
return fail

# 执行命令并返回其结果
return run data get entity @s Health

# 提前返回
execute if entity @s[tag=done] run return 0
```

- 无 `return` 的函数返回 void；
- `return run` 的命令必须是单条命令；
- 宏函数里常用 `return fail` 做守卫。

## 6. `schedule`

```mcfunction
schedule function mypack:tick_once 1t
schedule function mypack:later 5s append
schedule clear mypack:later
```

- 时间单位 `t`（tick）、`s`（秒）、`d`（游戏日）；
- `append` 允许同一函数多次排队，`replace`（默认）替换；
- `schedule clear <function>` 清空该函数的所有排队；
- 1.20.1 已支持 `schedule`（append/replace 1.15+）。

## 7. `data` / `item` / `loot` / `ride` / `forceload`

| 命令 | 用途 | 关键限制 |
|---|---|---|
| `/data get\|merge\|modify\|remove` | 读写 block/entity/storage 的 NBT | **物品不是 `/data` 的目标**；改物品用 `/item` |
| `/item replace\|modify` | 改容器/实体槽位物品 | 1.20.5+ 组件语法；`item modify` 用 item_modifier |
| `/loot give\|insert\|spawn\|replace` | 按战利品表发物品 | 需要 `loot_table` 或内联表 |
| `/ride` | 让实体骑乘/被骑 | 1.19.4+ 语法有调整 |
| `/forceload add\|remove\|query` | 强制加载区块 | 有数量上限；用完 remove |

示例：

```mcfunction
# 读取玩家生命值到记分板
execute as @a store result score @s demo run data get entity @s Health

# 给主手物品加自定义数据
item modify entity @s weapon.mainhand {"type":"minecraft:set_components",
  "components":{"minecraft:custom_data":{demo:1b}}}

# 按战利品表给玩家发东西
loot give @s loot mypack:demo_reward
```

## 8. 性能与调试

- tick 函数里避免 `execute as @e[type=...]` 全实体扫描；用标签/记分板缩小范围；
- 大量循环用 `schedule` 分帧，不要在一个 tick 里跑完；
- `/reload` 只重载 function/tags/loot_table/recipe/advancement/predicate/item_modifier/structure；worldgen/dimension/enchantment/damage_type/variant 需重进世界；
- 宏函数报「未知命令」：检查 1.20.2+、`$` 是否行首、key 是否传全；
- JSON 错误看 `logs/latest.log`；路径错误可能静默忽略。

## 9. 参考链接

- 命令列表：https://minecraft.wiki/w/Commands
- 函数：https://minecraft.wiki/w/Function_(Java_Edition)
- 宏：https://minecraft.wiki/w/Function_(Java_Edition)#Macros
- 数据包标签：https://minecraft.wiki/w/Tag#Data_packs

## 10. 验证状态

- 函数/标签/宏/execute/return/schedule/data/item/loot/ride/forceload 的语法：Wiki + vanilla 数据包 ✅。
- `execute if items`、`if loaded`、`on`、`summon` 等 1.20.5+/1.21+ 子命令的引入版本：按 Wiki 与变更日志，个别版本边界未逐条实测（UNVERIFIED）。
- 未在游戏内执行本文全部示例。
