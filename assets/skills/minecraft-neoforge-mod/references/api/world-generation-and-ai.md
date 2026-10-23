# NeoForge 世界生成与实体 AI 参考（1.20.1 / 1.21.1 / 26.x）

> 覆盖数据驱动世界生成（生物群系修改器、矿物/树木、结构）与实体 AI（Goal、属性、生成限制）。
> NeoForge 1.20.1 本质是 Forge 47.1.3，数据包命名空间仍是 `forge:`；1.21.1 起改为 `neoforge:`；26.x 沿用 1.21.1 的路径与命名空间，只把 `ResourceLocation` 换成 `Identifier`。
>
> 核对来源：NeoForge 官方文档 `docs/worldgen/biomemodifier.md`（main 分支=26.x）、NeoForge 26.3.x 源码 `RegisterSpawnPlacementsEvent` / `DatapackBuiltinEntriesProvider` / `BiomeModifiers`、Minecraft 1.20.1/1.21.1 数据包格式。核对日期：2026-10-23。代码为文档级验证，未在本机完成 NeoGradle 编译。

## 1. 版本速查

| 项目 | 1.20.1（47.1.3） | 1.21.1（21.1.249） | 26.2 / 26.3 |
| --- | --- | --- | --- |
| 生物群系修改器命名空间 | `forge:add_features` 等 | `neoforge:add_features` 等 | 同 1.21.1 |
| 修改器路径 | `data/<ns>/forge/biome_modifier/` | `data/<ns>/neoforge/biome_modifier/` | 同 1.21.1 |
| 结构模板 NBT | `data/<ns>/structures/<name>.nbt` | `data/<ns>/structure/<name>.nbt` | 同 1.21.1 |
| 结构/特征 JSON | `data/<ns>/worldgen/{structure,structure_set,template_pool,configured_feature,placed_feature}/` | 同 1.20.1 | 同 1.20.1 |
| 标识符类 | `ResourceLocation` | `ResourceLocation` | `Identifier` |
| 生成限制事件 | `SpawnPlacementRegisterEvent`（Forge） | `RegisterSpawnPlacementsEvent`（NeoForge） | 同 1.21.1 |
| 实体 AI | `Goal` + `goalSelector` | 同 1.20.1 | 同 1.20.1 |
| DataComponents | 无（物品 NBT） | 有 | 有 |

## 2. 生物群系修改器

生物群系修改器是数据驱动的 JSON，在加载世界时把特征、生成项、气候等改动应用到目标生物群系。原版/模组自带的修改器可以被数据包用同名 JSON 覆盖。

### 2.1 添加矿物/树木（JSON）

`data/mymod/neoforge/biome_modifier/add_my_ore.json`：

```json
{
  "type": "neoforge:add_features",
  "biomes": "#minecraft:is_overworld",
  "features": "mymod:my_ore",
  "step": "underground_ores"
}
```

对应 1.20.1（NeoForge/Forge 47.1.3）：路径改为 `data/mymod/forge/biome_modifier/add_my_ore.json`，`type` 改为 `forge:add_features`。

字段说明：

- `biomes`：生物群系 id、id 列表，或 `#` 开头的 tag。
- `features`：`PlacedFeature` 的 id，或 tag。
- `step`：`GenerationStep.Decoration` 的枚举名，如 `underground_ores`、`vegetal_decoration`、`top_layer_modification`。

`PlacedFeature` 本身在 `data/mymod/worldgen/placed_feature/my_ore.json`：

```json
{
  "feature": "mymod:my_ore",
  "placement": [
    { "type": "minecraft:count", "count": 8 },
    { "type": "minecraft:in_square" },
    { "type": "minecraft:height_range", "height": { "type": "minecraft:trapezoid", "min_inclusive": { "absolute": -64 }, "max_inclusive": { "absolute": 64 } } },
    { "type": "minecraft:biome" }
  ]
}
```

`ConfiguredFeature` 在 `data/mymod/worldgen/configured_feature/my_ore.json`，用 `minecraft:ore` 的 `targets`/`size`/`discard_chance_on_air_exposure` 描述矿脉。三份 JSON 的 id 必须一致。

### 2.2 其它内置修改器

| 类型（1.21+） | 作用 | 1.20.1 对应 |
| --- | --- | --- |
| `neoforge:add_spawns` | 给生物群系增加生成项 | `forge:add_spawns` |
| `neoforge:remove_features` | 移除特征 | `forge:remove_features` |
| `neoforge:remove_spawns` | 移除生成项 | `forge:remove_spawns` |
| `neoforge:add_features` | 添加特征 | `forge:add_features` |
| `neoforge:none` | 空操作，数据包可用来禁用某个修改器 | `forge:none` |

`add_spawns` 的 `spawners` 数组每项是 `{ "type": "mymod:my_mob", "weight": 10, "minCount": 2, "maxCount": 4 }`；新实体必须先注册生成限制，否则可能生成在半空摔死。

:::warning
不要把同一个原版 `PlacedFeature` 既写进生物群系 JSON 又通过修改器添加，也不要让两个生物群系在同一 `GenerationStep` 里以不同顺序持有相同的两个特征——这会触发 feature cycle 崩溃。需要复用时，把原版特征复制到自己的命名空间。
:::

## 3. 结构

结构由四层数据组成：

| 文件 | 路径 | 作用 |
| --- | --- | --- |
| 结构模板 | `data/<ns>/structure/<name>.nbt`（1.20.1 为 `structures/`） | 建筑方块数据，结构方块导出 |
| 模板池 | `data/<ns>/worldgen/template_pool/<name>.json` | jigsaw 拼接池 |
| 结构 | `data/<ns>/worldgen/structure/<name>.json` | 结构类型、起始池、尺寸、高度 |
| 结构集 | `data/<ns>/worldgen/structure_set/<name>.json` | 间距/分离/盐，决定在世界里怎么撒 |

`worldgen/structure_set/my_structure.json`：

```json
{
  "structures": [
    { "structure": "mymod:my_structure", "weight": 1 }
  ],
  "placement": {
    "type": "minecraft:random_spread",
    "salt": 123456789,
    "spacing": 32,
    "separation": 8
  }
}
```

`worldgen/structure/my_structure.json`（jigsaw 结构，字段名与 1.20.1/1.21.1 一致）：

```json
{
  "type": "minecraft:jigsaw",
  "biomes": "#minecraft:is_overworld",
  "step": "surface_structures",
  "spawn_overrides": {},
  "terrain_adaptation": "beard_thin",
  "start_pool": "mymod:my_structure/start_pool",
  "size": 4,
  "start_height": { "absolute": 0 },
  "project_start_to_heightmap": "WORLD_SURFACE_WG",
  "max_distance_from_center": 80,
  "use_expansion_hack": false
}
```

`template_pool` 里用 `elements` 列出 `location`（指向 `structure/` 下的 NBT）、`weight`、`projection`（`rigid`/`terrain_matching`）。先用结构方块保存建筑到 `data/mymod/structure/my_structure/start_pool.nbt`，再用 `/place template mymod:my_structure/start_pool` 预览。

调试：`/locate structure mymod:my_structure`；数据包重载 `/reload` 只对结构集/特征 JSON 生效，NBT 变更建议重进世界。

## 4. 数据生成（1.21.1 / 26.x）

NeoForge 提供 `DatapackBuiltinEntriesProvider`，把 `RegistrySetBuilder` 里的条目写成数据包 JSON。

```java
package com.example.mymod.datagen;

import java.util.Set;
import java.util.concurrent.CompletableFuture;

import net.minecraft.core.HolderLookup;
import net.minecraft.core.RegistrySetBuilder;
import net.minecraft.data.PackOutput;
import net.neoforged.neoforge.common.data.DatapackBuiltinEntriesProvider;
import net.neoforged.neoforge.common.world.BiomeModifiers;
import net.neoforged.neoforge.registries.NeoForgeRegistries;
import net.minecraft.world.level.levelgen.GenerationStep;

import com.example.mymod.MyMod;

public class MyDatapackProvider extends DatapackBuiltinEntriesProvider {
    public static final RegistrySetBuilder BUILDER = new RegistrySetBuilder()
            .add(NeoForgeRegistries.Keys.BIOME_MODIFIERS, context -> {
                // 这里注册 BiomeModifier；JSON 版示例直接写文件，二选一
            });

    public MyDatapackProvider(PackOutput output, CompletableFuture<HolderLookup.Provider> registries) {
        super(output, registries, BUILDER, Set.of(MyMod.MOD_ID));
    }
}
```

接到 `GatherDataEvent`（mod 总线）：

```java
@SubscribeEvent
public static void gatherData(GatherDataEvent event) {
    if (event.includeServer()) {
        event.getGenerator().addProvider(true,
                new MyDatapackProvider(event.getGenerator().getPackOutput(), event.getLookupProvider()));
    }
}
```

`RegistrySetBuilder` 里注册生物群系修改器的官方写法：

```java
import net.minecraft.core.HolderSet;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.biome.Biomes;

BUILDER.add(NeoForgeRegistries.Keys.BIOME_MODIFIERS, bootstrap -> {
    var biomes = bootstrap.lookup(Registries.BIOME);
    var placedFeatures = bootstrap.lookup(Registries.PLACED_FEATURE);
    bootstrap.register(MyBiomeModifiers.ADD_ORE,
            new BiomeModifiers.AddFeaturesBiomeModifier(
                    HolderSet.direct(biomes.getOrThrow(Biomes.PLAINS)),
                    HolderSet.direct(placedFeatures.getOrThrow(MyPlacedFeatures.MY_ORE)),
                    GenerationStep.Decoration.UNDERGROUND_ORES));
});
```

1.20.1（Forge 47.1.3）使用 `net.minecraftforge.common.data.DatapackBuiltinEntriesProvider`，键为 `ForgeRegistries.Keys.BIOME_MODIFIERS`，其余结构相同；`GatherDataEvent` 在 `net.minecraftforge.data.event.GatherDataEvent`。

## 5. 实体 AI

### 5.1 Goal 组合

```java
package com.example.mymod.entity;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

public class MyMob extends PathfinderMob {
    public MyMob(EntityType<? extends PathfinderMob> type, Level level) {
        super(type, level);
    }

    public static AttributeSupplier.Builder createAttributes() {
        return Mob.createMobAttributes()
                .add(Attributes.MAX_HEALTH, 20.0)
                .add(Attributes.MOVEMENT_SPEED, 0.25)
                .add(Attributes.ATTACK_DAMAGE, 3.0);
    }

    @Override
    protected void registerGoals() {
        this.goalSelector.addGoal(0, new FloatGoal(this));
        this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0, false));
        this.goalSelector.addGoal(7, new WaterAvoidingRandomStrollGoal(this, 1.0));
        this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 8.0F));
        this.goalSelector.addGoal(8, new RandomLookAroundGoal(this));
        this.targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, true));
    }
}
```

`registerGoals()` 里的数字是优先级：0 最高，先执行；`goalSelector` 管自身行为，`targetSelector` 管目标选择。`MeleeAttackGoal` 需要 `Attributes.ATTACK_DAMAGE` 才有意义。

### 5.2 自定义 Goal

```java
package com.example.mymod.entity;

import java.util.EnumSet;

import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.goal.Goal;

public class StareAtTargetGoal extends Goal {
    private final Mob mob;

    public StareAtTargetGoal(Mob mob) {
        this.mob = mob;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        return this.mob.getTarget() != null && this.mob.distanceToSqr(this.mob.getTarget()) < 64.0;
    }

    @Override
    public void start() {
        this.mob.getNavigation().moveTo(this.mob.getTarget(), 1.0);
    }

    @Override
    public void tick() {
        this.mob.getLookControl().setLookAt(this.mob.getTarget(), 30.0F, 30.0F);
    }

    @Override
    public void stop() {
        this.mob.getNavigation().stop();
    }
}
```

`setFlags` 决定 Goal 占用哪些系统；同一 Flag 同时只能有一个 Goal 运行。长时间阻塞移动/看向的 Goal 要谨慎设置 Flag。

### 5.3 属性注册

```java
// mod 构造器里：
modEventBus.addListener(this::onEntityAttributes);

private void onEntityAttributes(EntityAttributeCreationEvent event) {
    event.put(MyEntities.MY_MOB.get(), MyMob.createAttributes().build());
}
```

`EntityAttributeCreationEvent` 在 `net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent`；1.20.1 在 `net.minecraftforge.event.entity.EntityAttributeCreationEvent`。

### 5.4 生成限制与生成蛋

自然生成的新实体需要注册 `SpawnPlacements.SpawnPredicate`，否则可能生成在半空。1.21.1/26.x：

```java
modEventBus.addListener((RegisterSpawnPlacementsEvent event) -> {
    event.register(MyEntities.MY_MOB.get(),
            (type, level, reason, pos, random) ->
                    level.getBlockState(pos.below()).is(BlockTags.ANIMALS_SPAWNABLE_ON)
                            && level.getRawBrightness(pos, 0) > 8,
            RegisterSpawnPlacementsEvent.Operation.REPLACE);
});
```

1.20.1 用 `SpawnPlacementRegisterEvent`，方法名与 `Operation` 枚举相同。生成蛋：

```java
// 1.21.1+
public static final DeferredItem<Item> MY_MOB_SPAWN_EGG =
        ITEMS.registerItem("my_mob_spawn_egg",
                properties -> new SpawnEggItem(MyEntities.MY_MOB.get(), properties));
```

26.x 的 `SpawnEggItem` 构造与 `DeferredItem` API 可能微调，编译时以 `Item.Properties#spawnEgg` 或 `SpawnEggItem` 的实际签名为准。

## 6. 迁移表（1.20.1 → 1.21.1 → 26.x）

| 1.20.1 | 1.21.1 | 26.x |
| --- | --- | --- |
| `forge:add_features` / `data/<ns>/forge/biome_modifier/` | `neoforge:add_features` / `data/<ns>/neoforge/biome_modifier/` | 同 1.21.1 |
| `data/<ns>/structures/` | `data/<ns>/structure/` | 同 1.21.1 |
| `SpawnPlacementRegisterEvent` | `RegisterSpawnPlacementsEvent` | 同 1.21.1 |
| `ForgeRegistries.Keys.BIOME_MODIFIERS` | `NeoForgeRegistries.Keys.BIOME_MODIFIERS` | 同 1.21.1 |
| `ResourceLocation` | `ResourceLocation` | `Identifier` |
| `new ResourceLocation(ns, path)` | `ResourceLocation.fromNamespaceAndPath(ns, path)`（1.21） | `Identifier.fromNamespaceAndPath(ns, path)` |
| `RegistryObject<E>` | `DeferredHolder<R, E>` | 同 1.21.1 |

## 7. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 生物群系修改器不生效 | 路径/命名空间错（1.21+ 仍写 `forge:`） | 改 `data/<ns>/neoforge/biome_modifier/` 与 `neoforge:` |
| `Unknown registry key ... BIOME_MODIFIERS` | 1.20.1 用了 NeoForge 键 | 1.20.1 用 `ForgeRegistries.Keys.BIOME_MODIFIERS` |
| 结构不生成 | 只写了 `worldgen/structure`，没写 `structure_set` | 补结构集，并确认 `biomes` tag 命中 |
| 1.21+ 结构模板加载失败 | NBT 仍在 `structures/` | 移到 `structure/` |
| 实体不动/不攻击 | Goal 没注册或优先级被高优先级 Goal 占满 | 检查 `registerGoals()` 与 Flag |
| 实体生成后立刻掉血/摔死 | 没注册生成限制 | 注册 `SpawnPlacements.SpawnPredicate` |
| 数据生成没输出 | 没接 `GatherDataEvent` 或没跑 `runData` | 加 provider，执行 `./gradlew runData` |
| 26.x 编译报 `ResourceLocation` 找不到 | 26.x 已全面换 `Identifier` | 按迁移表替换 |

## 8. 参考链接

- NeoForge 生物群系修改器文档：https://docs.neoforged.net/docs/worldgen/biomemodifier
- NeoForge `RegisterSpawnPlacementsEvent`：https://github.com/neoforged/NeoForge/blob/26.3.x/src/main/java/net/neoforged/neoforge/event/entity/RegisterSpawnPlacementsEvent.java
- NeoForge `DatapackBuiltinEntriesProvider`：https://github.com/neoforged/NeoForge/blob/26.3.x/src/main/java/net/neoforged/neoforge/common/data/DatapackBuiltinEntriesProvider.java
- 原版数据包结构：https://minecraft.wiki/w/Data_pack#Folder_structure
- 原版 jigsaw 结构：https://minecraft.wiki/w/Jigsaw_structure

## 9. 验证状态

- 生物群系修改器的类型名、路径、`step` 枚举与数据生成代码已对照 NeoForge 官方文档（main=26.x）。
- `RegisterSpawnPlacementsEvent` 的 `register` 重载与 `Operation` 已对照 NeoForge 26.3.x 源码。
- `DatapackBuiltinEntriesProvider`、`GatherDataEvent` 的包名已对照 26.3.x 源码树。
- Goal/Attribute 代码使用 Mojang 官方名，1.20.1/1.21.1 稳定 API；未在本机执行 NeoGradle 编译。
- 结构 JSON 字段按 1.20.1/1.21.1 原版格式编写；不同结构类型（`minecraft:jigsaw`、`minecraft:ruined_portal` 等）字段差异大，复制时以原版同类型 JSON 为模板。
