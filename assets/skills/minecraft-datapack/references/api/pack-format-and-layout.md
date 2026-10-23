# 数据包格式与目录布局（1.20.1 / 1.21.1 / 26.x）

> 核对来源：各版本 vanilla `pack.mcmeta`、misode/mcmeta 的版本 tag 目录清单。核对日期：2026-10-23。
> 结论先行：**先定 `pack_format`，再定目录单复数**；两处任一错，包可能加载但不生效。

## 1. `pack_format` 对照

| MC 版本 | 数据包 `pack_format` | `min_format`/`max_format` | 资源包格式 |
|---|---|---|---|
| 1.20.1 | **15** | — | 15 |
| 1.20.2 | 18 | — | 18 |
| 1.20.5–1.20.6 | 41 | — | 32 |
| 1.21–1.21.1 | **48** | — | 34 |
| 1.21.4 | 61 | — | 46 |
| 1.21.5 | 71 | — | 55 |
| 1.21.6 | 80 | — | 63 |
| 1.21.7–1.21.8 | 81 | — | 64 |
| 1.21.9–1.21.10 | 88 | `[88,0]` | 69 |
| 1.21.11 | 94 | `[94,1]` | 75 |
| 26.1–26.1.2 | 101 | `[101,1]` | 84 |
| 26.2 | 107 | `[107,1]` | 88 |
| **26.3** | **121** | `[121,0]` | 97.1 |
| 26.4-snapshot-5 | 125 | `[125,0]` | 100.2 |

26.4 正式版未知（只核实到快照）。

## 2. `pack.mcmeta` 三种写法

### 1.20.1 / 1.21.1（旧式）

```json
{
  "pack": {
    "pack_format": 48,
    "description": "Demo 1.21.1 pack"
  }
}
```

1.20.1 把 `48` 换成 `15`。

### 26.x（新式）

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

规则：

- `pack_format` **永远是整数**，只写 major；minor 只出现在 `min_format`/`max_format`（数组 `[major, minor]`）。
- 26.x 的 `min_format`/`max_format` 可用数组或对象；不确定时数组最直观。
- `supported_formats` 仍能写（整数 / `[min,max]` / `{min_inclusive,max_inclusive}`），但仅对 <82 的旧客户端有意义，新包用 `min_format`/`max_format`。
- 跨 25w31a 分界的包：同时写 `pack_format` 与 `min_format`/`max_format`。

### overlays（一个包兼容多版本）

```json
{
  "pack": {
    "pack_format": 48,
    "description": "Multi-version pack",
    "supported_formats": [15, 48]
  },
  "overlays": {
    "entries": [
      { "directory": "overlay_1_20", "formats": 15 },
      { "directory": "overlay_1_21", "formats": 48 }
    ]
  }
}
```

overlay 目录里放与主包同结构的 `data/`，按客户端格式选择。注意：overlay 只解决**文件覆盖**，不能改变函数/组件的语法差异；跨代包通常仍需两套逻辑。

## 3. 目录布局

分界点：**24w21a（1.21，格式 48）**，注册表目录由复数改单数，且**没有别名**，写错会静默忽略。

| ≤1.20.6（复数） | 1.21+（单数） |
|---|---|
| `functions/` | `function/` |
| `structures/` | `structure/` |
| `advancements/` | `advancement/` |
| `recipes/` | `recipe/` |
| `loot_tables/` | `loot_table/` |
| `predicates/` | `predicate/` |
| `item_modifiers/` | `item_modifier/` |
| `tags/functions/` | `tags/function/` |
| `tags/blocks/` | `tags/block/` |
| `tags/items/` | `tags/item/` |
| `tags/entity_types/` | `tags/entity_type/` |
| `tags/fluids/` | `tags/fluid/` |
| `tags/game_events/` | `tags/game_event/` |

### 1.20.1 常用目录

```text
data/<ns>/
├── advancements/
├── chat_type/
├── damage_type/
├── dimension/
├── dimension_type/
├── loot_tables/
├── recipes/
├── structures/
├── tags/
├── trim_material/
├── trim_pattern/
└── worldgen/
```

`predicates/`、`item_modifiers/` 合法，但 vanilla 没有文件。

### 1.21.1 常用目录

```text
data/<ns>/
├── advancement/
├── banner_pattern/
├── chat_type/
├── damage_type/
├── dimension/
├── dimension_type/
├── enchantment/
├── enchantment_provider/
├── jukebox_song/
├── loot_table/
├── painting_variant/
├── recipe/
├── structure/
├── tags/
├── trim_material/
├── trim_pattern/
├── wolf_variant/
└── worldgen/
```

### 26.3 新增（在 1.21.1 基础上）

`block_transformer/`、`context_float_provider/`、`context_int_provider/`、`decorated_pot_pattern/`、`dialog/`、`instrument/`、`predicate/`（作为注册表）、`sulfur_cube_archetype/`、`test_environment/`、`test_instance/`、`timeline/`、`trade_set/`、`trial_spawner/`、`villager_trade/`、`world_clock/`，以及各类 variant/sound_variant。

`tags/` 子目录在 26.3 还新增 `enchantment/`、`dialog/`、`potion/`、`timeline/`、`villager_trade/`。

## 4. 命名规则

- 命名空间：小写 `[a-z0-9_.-]`，不能含大写/空格；
- 路径可含 `/`，对应子目录；
- 资源 id = `namespace:path`（去掉 `data/<ns>/` 与 `.json`/`.mcfunction`）；
- 函数文件扩展名 `.mcfunction`，其余注册表 `.json`。

## 5. 常见错误

| 现象 | 原因 | 修法 |
|---|---|---|
| 包能加载但函数不执行 | 1.21+ 仍用 `functions/` 或 `tags/functions/` | 改单数 |
| 提示「为更旧/更新版本制作」 | `pack_format` 不匹配 | 查第 1 节表；26.x 补 `min_format`/`max_format` |
| 整个包不加载 | 缺 `description`、JSON 尾逗号、BOM | JSON 校验器；看 `latest.log` |
| 配方/战利品表被忽略 | `recipes/`、命名空间大写、扩展名错 | 单数 + 全小写 + `.json` |
| 26.x 格式警告 | `min_format` 写成小数/字符串 | 用 `[major, minor]` 数组或 `pack_format` 整数 |
| overlay 不生效 | `formats` 与客户端格式不匹配 | 用 `/datapack list` 看实际格式 |

## 6. 参考链接

- 数据包格式（Misode）：https://misode.github.io/
- mcmeta 版本数据：https://github.com/misode/mcmeta
- 原版数据包目录：https://minecraft.wiki/w/Data_pack
- 26.3 数据包版本：https://minecraft.wiki/w/Data_pack#Pack_format

## 7. 验证状态

- 格式号与目录清单：各版本 vanilla `pack.mcmeta` + misode/mcmeta 原件 ✅。
- 26.4 正式版格式号：**UNVERIFIED**（仅快照 125.0）。
- overlay 行为基于原版文档；未在本机用真实客户端加载测试。
