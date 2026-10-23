# 数据包组件与版本迁移参考（1.20.1 → 1.21.1 → 26.x）

> 覆盖 1.20.5+ 物品组件、1.20.1 NBT 迁移、配方/战利品表的版本差异、谓词与 26.x 新变化。
> 核对来源：各版本 vanilla 数据包原件、Minecraft Wiki 组件页、26.3 变更日志。核对日期：2026-10-23。

## 1. 分水岭

| 版本 | 物品数据模型 | 数据包格式 |
|---|---|---|
| 1.20.1 | `{id, Count, tag:{...}}` NBT | 15 |
| 1.20.5+ | `{id, count, components:{...}}` | 41 |
| 1.21.1 | 组件；`result` 用 `{id,count}` | 48 |
| 26.3 | 组件 + `min_format`/`max_format` | 121 |

**1.20.1 的 `tag:{...}` 在 1.20.5+ 不再解析**；把旧命令/配方直接搬过去会报组件语法错或静默丢数据。

## 2. 组件语法

命令里用方括号，逗号分隔，组件键可省略 `minecraft:` 前缀：

```mcfunction
give @s minecraft:stone[minecraft:custom_data={demo:1b},minecraft:item_name='{"text":"Demo Stone"}']
```

- 组件值用 SNBT：字符串加引号、数字带类型后缀、列表/对象用 `[]`/`{}`；
- `!component` 移除默认组件：

```mcfunction
give @s minecraft:diamond_sword[!minecraft:attribute_modifiers]
```

- 改已有物品用 `/item modify`（item_modifier JSON），不是 `/data`：

```mcfunction
item modify entity @s weapon.mainhand {"type":"minecraft:set_components",
  "components":{"minecraft:custom_data":{blessed:1b}}}
```

- 读组件：`/data get entity @s SelectedItem` 可读整块；按组件路径读的语法在 26.3 未核实（UNVERIFIED），文档只教读整块再解析。

## 3. 常用组件

| 组件 | 用途 | 备注 |
|---|---|---|
| `minecraft:custom_data` | 自定义数据，供谓词/函数匹配 | 替代旧 `tag.{自定义键}` |
| `minecraft:item_name` | 物品显示名 | 1.21.2+；不可铁砧改 |
| `minecraft:custom_name` | 自定义名 | 玩家可铁砧改 |
| `minecraft:lore` | 描述行 | ≤256 行 |
| `minecraft:enchantments` | 附魔 | `{levels:{...}}` |
| `minecraft:attribute_modifiers` | 属性修饰 | 可 `!` 移除 |
| `minecraft:custom_model_data` | 自定义模型数据 | 1.21.4+ 变对象 `{floats,flags,strings,colors}` |
| `minecraft:max_stack_size` | 堆叠上限 | 1–99 |
| `minecraft:food` | 食物属性 | 1.20.5+ |
| `minecraft:tool` | 工具属性 | 1.20.5+ |
| `minecraft:enchantment_glint_override` | 附魔光效覆盖 | 布尔 |

## 4. 1.20.1 NBT → 组件对照

| 1.20.1 NBT | 1.20.5+ 组件 |
|---|---|
| `tag.display.Name` | `minecraft:custom_name` 或 `minecraft:item_name` |
| `tag.display.Lore` | `minecraft:lore` |
| `tag.Enchantments` | `minecraft:enchantments` |
| `tag.CustomModelData` | `minecraft:custom_model_data` |
| `tag.AttributeModifiers` | `minecraft:attribute_modifiers` |
| `tag.{自定义}` | `minecraft:custom_data` |
| `tag.HideFlags` | 各组件用 `!` 移除，或 `tooltip_display` |

示例（同一把剑）：

```mcfunction
# 1.20.1
give @s diamond_sword{display:{Name:'{"text":"Blade"}'},Enchantments:[{id:"minecraft:sharpness",lvl:3}]}

# 1.21.1+
give @s minecraft:diamond_sword[minecraft:custom_name='{"text":"Blade"}',
  minecraft:enchantments={levels:{"minecraft:sharpness":3}}]
```

## 5. 配方与战利品表迁移

### 5.1 配方 result

```json
// 1.20.1
"result": { "item": "minecraft:diamond_sword" }
```

```json
// 1.21.1+
"result": { "id": "minecraft:diamond_sword", "count": 1 }
```

26.3 的 `key` 还支持字符串简写与标签：

```json
"key": {
  "X": "#minecraft:diamond_tool_materials",
  "Y": "minecraft:stick"
}
```

### 5.2 战利品表函数改名

| 1.20.1 | 1.21.1+ |
|---|---|
| `minecraft:looting_enchant` | `minecraft:enchanted_count_increase` |
| `minecraft:random_chance_with_looting` | `minecraft:random_chance_with_enchanted_bonus` |
| `entity_properties.flags.is_on_fire` | 组件谓词 + `any_of`（装备/附魔判断） |
| `nbt` 谓词 | `custom_data` 子谓词 |

1.21.1 的「带附魔概率」：

```json
{
  "function": "minecraft:enchanted_count_increase",
  "enchantment": "minecraft:looting",
  "count": { "type": "minecraft:uniform", "min": 1, "max": 2 }
}
```

```json
{
  "condition": "minecraft:random_chance_with_enchanted_bonus",
  "unenchanted_chance": 0.025,
  "enchanted_chance": {
    "type": "minecraft:linear",
    "base": 0.035,
    "per_level_above_first": 0.01
  },
  "enchantment": "minecraft:looting"
}
```

路径也从 `loot_tables/entities/zombie.json` 变为 `loot_table/entities/zombie.json`；资源 id 仍是 `minecraft:entities/zombie`。

## 6. 谓词与 custom_data 匹配

1.20.5+ 用组件谓词匹配物品，不再用 `nbt`：

```json
{
  "condition": "minecraft:entity_properties",
  "entity": "this",
  "predicate": {
    "equipment": {
      "mainhand": {
        "items": "minecraft:diamond_sword",
        "predicates": {
          "minecraft:custom_data": { "blessed": true }
        }
      }
    }
  }
}
```

- `items` 可写 id、列表或 `#tag`；
- `predicates` 里放组件谓词，如 `minecraft:custom_data`、`minecraft:enchantments`；
- 1.20.1 时代用 `nbt` 谓词或 `entity_properties.flags`，迁移时整体重写。

## 7. 26.x 变化（已核实部分）

- **26.2**：`team modify color` / `waypoint modify` 只接受小写下划线颜色名；新增 `unpublish`；`advancement grant/revoke` 输出改为变更数 + 受影响玩家数；新增组件 `minecraft:sulfur_cube_content`；格式 107.1。
- **26.3**：格式 121.0；新增 `block_transformer`、context providers、`predicate` 注册表、`decorated_pot_pattern` 等；数据包格式从 108.0 连续升到 121.0。
- 26.x 版本号改年份制，但 `pack_format` 仍连续递增。

26.4 正式版格式号未知（仅快照 125.0，见 pack-format 参考的待核实项）。

## 8. 调试

| 现象 | 原因 | 修法 |
|---|---|---|
| 物品组件语法错 | 把 1.20.1 `{...}` NBT 写进 1.20.5+ | 改方括号 `stone[custom_data={...}]` |
| 组件被忽略 | 组件键拼错/版本不支持 | 查该版本的组件列表；看 `latest.log` |
| 配方不生效 | `result` 仍用 `item` 而非 `id` | 1.20.5+ 改 `{id,count}` |
| 战利品表不生效 | 函数名仍是 1.20.1 的旧名 | 按 5.2 表改名 |
| 谓词不匹配 | 仍用 `nbt` 谓词 | 改组件谓词 `predicates` |
| `/reload` 后无变化 | 改的是 enchantment/damage_type 等加载期注册表 | 重进世界/重启 |

## 9. 参考链接

- 物品组件：https://minecraft.wiki/w/Data_component_format
- 配方：https://minecraft.wiki/w/Recipe
- 战利品表：https://minecraft.wiki/w/Loot_table
- 谓词：https://minecraft.wiki/w/Predicate
- 26.3 变更日志：https://minecraft.wiki/w/Java_Edition_26.3

## 10. 验证状态

- 组件、NBT 映射、配方/战利品表函数改名：vanilla 原件 + Wiki ✅。
- 26.4 格式号、`/data ... SelectedItem` 组件路径：见正文两处待核实标注。
- 未在游戏内逐条执行本文命令。
