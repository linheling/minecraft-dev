# Forge Mixin / AccessTransformer / Coremod 参考（1.7.10–1.20.1）

> 本文件覆盖「改原版可见性」与「改原版行为」两条路：AccessTransformer（AT）只改访问修饰符，Mixin 做方法注入，Coremod 只用于 1.7.10/1.12.2 的类加载期改造。1.16.5+ 已经没有 `IClassTransformer` 的运行入口，行为改造一律用 Mixin。
>
> 核对来源：Forge 1.20.1 官方 Access Transformers 文档、SpongePowered Mixin Wiki、MixinGradle 元数据、GTNH ExampleMod、ForgeGradle FG_3.0 / FG_5.0 / FG_6.0 的 `MinecraftExtension` 源码、本仓库 `assets/templates/forge-*`。核对日期：2026-10-23。AT 语法与 FG 配置方法已逐条对照源码；Mixin 运行期行为按 Wiki 与 Forge 运行时库核对，未在本机完成 Gradle 编译（见文末验证状态）。

## 0. 适用版本

| 线 | Mixin | AccessTransformer | Coremod |
| --- | --- | --- | --- |
| 1.7.10 | 第三方（GTNH ExampleMod / UniMixins），非 Forge 自带 | `FMLAT` manifest + `META-INF/accesstransformer.cfg` | `IFMLLoadingPlugin` + `IClassTransformer` |
| 1.12.2 | 手动引入 Mixin 0.7.11-SNAPSHOT + coremod 初始化 | `FMLAT` manifest；FG3 可在 dev 用 `accessTransformer` | 同上（`net.minecraft.launchwrapper.IClassTransformer`） |
| 1.16.5 | Forge 运行时自带 Mixin 0.8.x + MixinGradle | FG5 `minecraft.accessTransformer` | 不再支持 `IClassTransformer` |
| 1.20.1 | 同 1.16.5，Mixin 0.8.5 | FG6 `minecraft.accessTransformer` | 不再支持，改用 Mixin |

选型：

| 需求 | 用什么 | 原因 |
| --- | --- | --- |
| 让私有的字段/方法/类可访问 | AT | 零运行时依赖，加载期改访问标志，兼容所有时代 |
| 在方法头/尾/调用点插入逻辑、改返回值 | Mixin | 1.16.5+ 官方运行时支持；1.7.10/1.12.2 需自备 |
| 替换类加载、改常量池/类结构 | Coremod（仅 1.7.10/1.12.2） | 1.16.5+ 无 `IClassTransformer` 入口，用 Mixin |
| 只想读一个私有字段 | AT + 普通代码 | 比 Mixin 稳定，不依赖混淆名映射 |

> 生产环境里 AT 和 Mixin 都面对 **SRG 名**；开发环境用官方映射（1.16.5/1.20.1）或 MCP 名（1.12.2/1.7.10）。AT 文件里的名字始终写 SRG，Mixin 源码里写开发名，refmap 负责生产重映射。

## 1. AccessTransformer

### 1.1 文件格式

AT 文件是纯文本，一行一条，`#` 后为注释：

```text
# 类：public 化（无描述符）
public net.minecraft.world.entity.player.Player

# 字段：public 化，并去掉 final（-f）；+f 表示加上 final
public net.minecraft.world.entity.player.Player f_36095_ # inventory

# 方法：public 化，必须带 JVM 描述符
public net.minecraft.Util m_137477_(Ljava/lang/String;)Ljava/util/concurrent/ExecutorService; # makeExecutor
```

规则：

- 访问级别只能是 `public`、`protected`、`default`（包私有）、`private`。
- 字段可加 `+f` / `-f` 改 `final`；方法不能改 `final`（用 Mixin 或改设计）。
- 方法必须写完整描述符：`(参数类型)返回类型`，无参用 `()`，`void` 用 `V`。写错描述符不会报错，AT 会静默不生效，运行时才 `NoSuchMethodError`。
- AT 只放宽/收紧访问标志，不改变类层次、不生成桥接方法。

### 1.2 SRG 名与描述符

生产环境 Minecraft 是混淆的，AT 在重映射之前应用，所以：

- 1.16.5/1.20.1：写 SRG 名（`m_xxxxx_` / `f_xxxxx_`），不是 Mojang 的 `tick` / `inventory`。
- 1.12.2/1.7.10：写 SRG 名（`func_xxxxx_` / `field_xxxxx_`），不是 MCP 的 `onUpdate` / `inventory`。
- 查名工具：MCPBot 存档、Linkie（1.16.5+）、Forge 的 `joined.tsrg`、或 `gradlew genSrgs` 产物。
- 描述符里的类用内部名：`Lnet/minecraft/world/entity/player/Player;`；数组是 `[I`、`[Ljava/lang/String;`。

### 1.3 1.20.1 / 1.16.5 配置

文件放 `src/main/resources/META-INF/accesstransformer.cfg`，构建脚本：

```groovy
// FG6（1.20.1）与 FG5（1.16.5）都提供 accessTransformer(Object) 方法
minecraft {
    accessTransformer file('src/main/resources/META-INF/accesstransformer.cfg')
}
```

要点：

- FG5/FG6 的 `MinecraftExtension` 同时有 `accessTransformer(Object)` 和 `accessTransformers(Object...)`；两者都是「追加」，多次调用会合并。属性写法 `accessTransformer = file(...)` 在部分 Gradle 版本上依赖动态属性解析，方法调用更稳。
- 运行时路径固定为 `META-INF/accesstransformer.cfg`；不要改名或挪目录，Forge 只认这个路径。
- 文件会自动打进 jar；`reobfJar` 会对 AT 之后的类做 SRG 重映射，不需要额外任务。
- 改完 AT 后至少重新跑一次 `genIntellijRuns` / `genEclipseRuns`，否则 IDE 里的 run configuration 不会带新参数；命令行 `runClient` 一般直接生效。

### 1.4 1.12.2 配置

FG3 支持在 dev 里应用 AT，同时生产环境要靠 `FMLAT` manifest：

```groovy
minecraft {
    accessTransformer file('src/main/resources/META-INF/accesstransformer.cfg')
}

jar {
    manifest {
        attributes 'FMLAT': 'accesstransformer.cfg'
    }
}
```

`FMLAT` 的值是**文件名**，Forge 会在 `META-INF/` 下找它。只写 `FMLAT` 不配 FG3 的 `accessTransformer` 时，`runClient` 的开发环境不会应用 AT，编译期访问私有成员会失败。

### 1.5 1.7.10 配置

FG 1.2 fork 没有 `accessTransformer` DSL，走 manifest：

```groovy
jar {
    manifest {
        attributes 'FMLAT': 'accesstransformer.cfg'
    }
}
```

文件放 `src/main/resources/META-INF/accesstransformer.cfg`。注意 1.7.10 的 SRG 名是 `field_xxxxx_` / `func_xxxxx_`，且部分字段在不同 Forge 版本间有差异，升级 Forge 后要重查。

### 1.6 AT 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| dev 能编译，生产 `IllegalAccessError` | 只配了 FG DSL，没写 `FMLAT` manifest | 两边都配（1.12.2/1.7.10） |
| `NoSuchFieldError` / `NoSuchMethodError` | 描述符或 SRG 名写错 | 用 `javap` 或 `joined.tsrg` 逐字核对 |
| AT 完全没生效 | 文件不在 `META-INF/accesstransformer.cfg`，或 manifest 值带路径 | 运行时路径固定；`FMLAT` 只写文件名 |
| 改 `final` 字段后行为异常 | `-f` 去掉了 final，但构造器/静态初始化仍按 final 优化 | 只对确实需要写的字段用 `-f`，并检查所有写入点 |
| 1.20.1 用 Mojang 名写 AT | 生产是 SRG，AT 在映射前应用 | 改成 SRG 名 |

## 2. Mixin

### 2.1 1.20.1 构建配置

在模板的 `plugins` 块追加 MixinGradle（模板已钉 ForgeGradle 6.0.54）：

```groovy
plugins {
    id 'net.minecraftforge.gradle' version '6.0.54'
    id 'org.spongepowered.mixin' version '0.7.38'
    id 'eclipse'
    id 'idea'
    id 'maven-publish'
}

mixin {
    // 生成的 refmap 名，必须与 mixin 配置 JSON 的 "refmap" 一致
    add sourceSets.main, 'mixins.mymod.refmap.json'
    // 把配置写进 jar manifest 的 MixinConfigs，并注入 run 配置
    config 'mixins.mymod.json'
}

dependencies {
    annotationProcessor 'org.spongepowered:mixin:0.8.5:processor'
}
```

说明：

- MixinGradle 0.7.38 是 2023-08 的最后版本；它负责生成 refmap、把 `MixinConfigs` 写进 manifest、给 `runClient` 注入配置。
- Forge 1.20.1 运行时经 ModLauncher 提供 Mixin 0.8.5，**不要**把 Mixin 再打进 mod jar，也不要 shade `org.spongepowered.asm`。
- 如果插件门户不可用，退回 buildscript：`classpath 'org.spongepowered:mixingradle:0.7.38'` + `apply plugin: 'org.spongepowered.mixin'`，仓库加 `https://repo.spongepowered.org/repository/maven-public/`。
- 1.20.1 的 Java 17 字节码，Mixin 配置 `compatibilityLevel` 写 `JAVA_17`。

### 2.2 1.16.5 构建配置

模板用 buildscript 方式应用 ForgeGradle，MixinGradle 也走 buildscript：

```groovy
buildscript {
    repositories {
        maven { url = 'https://maven.minecraftforge.net' }
        maven { url = 'https://repo.spongepowered.org/repository/maven-public/' }
        mavenCentral()
    }
    dependencies {
        classpath 'net.minecraftforge.gradle:ForgeGradle:5.1.77'
        classpath 'org.spongepowered:mixingradle:0.7.38'
    }
}

apply plugin: 'net.minecraftforge.gradle'
apply plugin: 'org.spongepowered.mixin'

mixin {
    add sourceSets.main, 'mixins.mymod.refmap.json'
    config 'mixins.mymod.json'
}

dependencies {
    annotationProcessor 'org.spongepowered:mixin:0.8.5:processor'
}
```

1.16.5 的 `compatibilityLevel` 写 `JAVA_8`；注解处理器版本与 Forge 自带 Mixin 对齐（0.8.5）。

### 2.3 mixin 配置 JSON

放 `src/main/resources/mixins.mymod.json`：

```json
{
  "required": true,
  "minVersion": "0.8",
  "package": "com.example.mymod.mixin",
  "compatibilityLevel": "JAVA_17",
  "refmap": "mixins.mymod.refmap.json",
  "mixins": [
    "PlayerTickMixin"
  ],
  "client": [
    "TitleScreenMixin"
  ],
  "injectors": {
    "defaultRequire": 1
  }
}
```

字段：

- `package`：mixin 类的包；JSON 里的类名相对这个包。
- `mixins`：双端都加载；`client`：只在客户端加载；`server`：只在服务端加载。客户端专属类（Screen、RenderSystem）必须放 `client`，否则专用服务器启动会 `ClassNotFoundException`。
- `refmap`：MixinGradle 生成的重映射表名，必须与 `add sourceSets.main, '...'` 一致。
- `injectors.defaultRequire`：注入点找不到时是否硬失败；开发期建议 `1`（早暴露），发布前可评估是否放宽。
- `required: true`：配置加载失败直接崩，避免静默失效。

### 2.4 一个最小 mixin

```java
package com.example.mymod.mixin;

import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Player.class)
public abstract class PlayerTickMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void mymod$beforeTick(CallbackInfo ci) {
        Player self = (Player) (Object) this;
        if (!self.level().isClientSide()) {
            // 只在服务端执行的逻辑
        }
    }
}
```

- 方法名统一加 `mymod$` 前缀，避免与目标类/其他 mixin 冲突。
- `tick` 是 1.20.1 官方映射下的开发名；生产由 refmap 映射到 SRG，不要在源码里写 `m_36170_`。
- 1.16.5 用官方映射时同理；1.12.2 写 MCP 名（如 `onUpdate`），refmap 映射到 SRG。
- 注入点选 `HEAD`/`RETURN`/`TAIL`/`INVOKE`；改返回值用 `@Inject(cancellable = true)` + `ci.cancel()` 或 `@Redirect`，不要直接 `@Overwrite`（冲突面最大）。

### 2.5 不用 MixinGradle 时的 manifest

如果项目已有自己的打包流程，最低要求是把配置写进 jar manifest 的 `MixinConfigs`，并确保 JSON 在 jar 根目录：

```groovy
jar {
    manifest {
        attributes 'MixinConfigs': 'mixins.mymod.json'
    }
}
```

refmap 仍需注解处理器生成；没有 refmap 时生产环境可能找不到 SRG 目标（`No refMap loaded`）。

### 2.6 1.12.2 的 Mixin（coremod 引导）

1.12.2 的 Forge 不自带 Mixin，也没有 MixinGradle 的官方支持路径。可行做法是手动引入 Mixin 0.7.11-SNAPSHOT，并用 coremod 在类加载早期初始化：

```groovy
repositories {
    maven { url = 'https://repo.spongepowered.org/repository/maven-public/' }
}

dependencies {
    implementation 'org.spongepowered:mixin:0.7.11-SNAPSHOT'
    annotationProcessor 'org.spongepowered:mixin:0.7.11-SNAPSHOT:processor'
}
```

```java
package com.example.mymod.core;

import net.minecraftforge.fml.relauncher.IFMLLoadingPlugin;
import org.spongepowered.asm.launch.MixinBootstrap;
import org.spongepowered.asm.mixin.Mixins;
import org.spongepowered.asm.mixin.MixinEnvironment;

import java.util.Map;

@IFMLLoadingPlugin.Name("mymod Mixin Loader")
@IFMLLoadingPlugin.MCVersion("1.12.2")
public final class MixinLoader implements IFMLLoadingPlugin {
    public MixinLoader() {
        MixinBootstrap.init();
        Mixins.addConfiguration("mixins.mymod.json");
        MixinEnvironment.getDefaultEnvironment().setObfuscationContext("searge");
    }

    @Override public String[] getASMTransformerClass() { return new String[0]; }
    @Override public String getModContainerClass() { return null; }
    @Override public String getSetupClass() { return null; }
    @Override public void injectData(Map<String, Object> data) { }
    @Override public String getAccessTransformerClass() { return null; }
}
```

```groovy
jar {
    manifest {
        attributes(
            'FMLCorePlugin': 'com.example.mymod.core.MixinLoader',
            'FMLCorePluginContainsFMLMod': 'true'
        )
    }
}
```

注意：

- Mixin 0.7.11 需要随 mod 分发（1.12.2 的 Forge 不提供），要么 shade 进 jar，要么声明为独立依赖；shade 时不要重定位 `org.spongepowered.asm` 之外的 ASM，避免与 Forge 冲突。
- 该路径依赖 coremod 在 `FMLTweaker` 之后、类加载之前执行；`MixinBootstrap.init()` 必须只调用一次。
- 1.12.2 的 production 是 SRG 名，`setObfuscationContext("searge")` 让 Mixin 按 SRG 解析目标；开发环境是 MCP 名，refmap 负责转换。
- 这一节是 1.12.2 的兼容做法，不是 Forge 官方承诺的 API；升级 Forge 或换 Mixin 版本时需回归。

### 2.7 1.7.10 的 Mixin（GTNH 路线）

1.7.10 没有官方 Mixin 支持。GTNH 的 ExampleMod 用 `gradle.properties` 开关接入：

```properties
usesMixins = true
coreModClass = com.example.mymod.core.MixinLoader
mixinPlugin = com.example.mymod.mixin.MixinPlugin
mixinsPackage = com.example.mymod.mixin
```

- 依赖 UniMixins / GTNHMixins 提供运行期 Mixin；不要直接把现代 Mixin 0.8.x 塞进 1.7.10。
- 字段名随 GTNH ExampleMod 版本变化，以该模板 README 为准；本仓库不复制其构建脚本，避免版本漂移。
- 1.7.10 的绝大多数「改可见性」需求用 AT 就够，Mixin 只用于必须改行为的场景。此节为外部模板指引，未在本仓库验证（UNVERIFIED）。

### 2.8 Mixin 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Mixin config ... was not found` | JSON 不在 jar 根目录，或 `MixinConfigs` 未写 | 放 `src/main/resources/` 根，配 MixinGradle `config` 或 manifest |
| `No refMap loaded` | 注解处理器没跑/没配 | `annotationProcessor 'org.spongepowered:mixin:0.8.5:processor'`，确认 `build/classes/.../refmap` 生成 |
| `InvalidInjectionException` | 目标方法签名随版本变了 | 用 `javap` 看目标类；必要时 `require = 0` 先定位再收紧 |
| 专用服务器崩 `ClassNotFoundException` | 客户端类放进了 `mixins` | 移到 `client` 数组 |
| `Mixin apply failed ... target class not found` | 目标类名/包名写错，或平台不匹配 | 核对官方映射名；1.16.5/1.20.1 不要写 SRG |
| `ClassFormatError` / `Unsupported class file major version` | `compatibilityLevel` 与 Java 版本不符 | 1.16.5 用 `JAVA_8`，1.20.1 用 `JAVA_17` |

调试开关（加在 run 配置的 VM options）：

```text
-Dmixin.debug.export=true
-Dmixin.debug.verbose=true
```

导出目录在 `run/.mixin.out/class/`，可直接对比注入后的字节码。

## 3. Coremod（仅 1.7.10 / 1.12.2）

### 3.1 入口与 manifest

1.7.10/1.12.2 的 coremod 实现 `IFMLLoadingPlugin`，在 `getASMTransformerClass()` 里返回 `IClassTransformer`：

```java
package com.example.mymod.core;

import net.minecraft.launchwrapper.IClassTransformer;
import net.minecraftforge.fml.relauncher.IFMLLoadingPlugin;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.tree.ClassNode;

import java.util.Map;

@IFMLLoadingPlugin.Name("mymod Core")
@IFMLLoadingPlugin.MCVersion("1.12.2")
public final class MyCorePlugin implements IFMLLoadingPlugin {
    @Override public String[] getASMTransformerClass() {
        return new String[] { MyTransformer.class.getName() };
    }
    @Override public String getModContainerClass() { return null; }
    @Override public String getSetupClass() { return null; }
    @Override public void injectData(Map<String, Object> data) { }
    @Override public String getAccessTransformerClass() { return null; }

    public static final class MyTransformer implements IClassTransformer {
        @Override public byte[] transform(String name, String transformedName, byte[] basicClass) {
            if (basicClass == null || !"net.minecraft.entity.player.EntityPlayer".equals(transformedName)) {
                return basicClass;
            }
            ClassNode node = new ClassNode();
            new ClassReader(basicClass).accept(node, 0);
            // 在这里改 node；改完写回
            ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
            node.accept(writer);
            return writer.toByteArray();
        }
    }
}
```

manifest：

```groovy
jar {
    manifest {
        attributes(
            'FMLCorePlugin': 'com.example.mymod.core.MyCorePlugin',
            'FMLCorePluginContainsFMLMod': 'true'
        )
    }
}
```

- `FMLCorePluginContainsFMLMod=true` 表示这个 jar 同时是普通 mod（有 `@Mod`）；纯 coremod 不写或写 `false`。
- 1.12.2 的 ASM 由 Forge 提供（`org.objectweb.asm`），不要 shade 另一份。
- `transform` 里只处理目标类，其他类原样返回；`basicClass == null` 要提前返回。
- `COMPUTE_MAXS` 足够大多数注入；改栈帧/局部变量表时用 `COMPUTE_FRAMES`，但会拖慢启动。

### 3.2 1.16.5+ 为什么不能再用

Forge 1.16.5 起切到 ModLauncher，类加载阶段不再调用 `IClassTransformer`；把 1.12.2 的 coremod 搬过来不会执行。需要改行为时：

- 方法级注入 → Mixin（`@Inject` / `@Redirect` / `@ModifyVariable`）。
- 改类结构 → Mixin 的 `@Mixin` + `@Overwrite`（谨慎）或访问器（`@Accessor`/`@Invoker`）。
- Forge 还保留 `ICoreMod`（JavaScript coremod）机制，但官方文档已不维护，且不能解决大多数模组兼容问题；不作为推荐路径。

### 3.3 迁移对照

| 1.12.2 coremod 写法 | 1.16.5 / 1.20.1 等价 |
| --- | --- |
| `IClassTransformer.transform` 里改方法体 | `@Mixin` + `@Inject` / `@Redirect` |
| 改字段访问标志 | AccessTransformer |
| 在类加载时替换整个类 | `@Mixin` + `@Overwrite`（最后手段） |
| coremod manifest `FMLCorePlugin` | MixinGradle `config` / manifest `MixinConfigs` |
| `IFMLLoadingPlugin.getASMTransformerClass` | 无直接等价；ModLauncher 插件需单独实现，模组开发不推荐 |

## 4. 组合使用建议

- 1.20.1：AT 文件 + MixinGradle，两者可同时存在；AT 先于 Mixin 应用，Mixin 里可以直接访问 AT 放宽后的成员。
- 1.16.5：同上；注意 FG5 的 `accessTransformer` 方法名是单数，传一个文件即可，多个用 `accessTransformers`。
- 1.12.2：AT 走 `FMLAT` + FG3 `accessTransformer`；Mixin 走 coremod 引导。两者同时使用时，coremod 的 `MixinLoader` 不要与 AT 的 `getAccessTransformerClass()` 混用（AT 由 FML 自己加载）。
- 1.7.10：优先 AT；Mixin 走 GTNH 模板，且要接受「第三方运行时」的维护风险。

## 5. 验证状态

- AT 的语法、路径、FG3/FG5/FG6 方法签名：已对照 Forge 官方文档与 ForgeGradle 源码。
- MixinGradle 0.7.38 的 `mixin { add ...；config ... }`、注解处理器坐标：已对照 Mixin Wiki 与 Gradle 插件元数据。
- 1.20.1/1.16.5 的 Mixin 运行未在本机完成 Gradle 编译（依赖下载受网络限制），代码片段为文档级验证；首次接入时先跑 `runClient`，确认 `MixinConfigs` 与 refmap 生效。
- 1.12.2 的 Mixin coremod 初始化路径、1.7.10 的 GTNH 字段名为兼容做法，标注 UNVERIFIED；生产接入前按对应 Forge/Mixin 版本回归。

## 6. 参考链接

- Forge 1.20.1 Access Transformers：https://docs.minecraftforge.net/en/1.20.1/advanced/accesstransformers/
- Forge 1.20.1 用户开发入门：https://docs.minecraftforge.net/en/1.20.1/gettingstarted/
- Mixin Wiki：https://github.com/SpongePowered/Mixin/wiki
- MixinGradle：https://github.com/SpongePowered/MixinGradle
- GTNH ExampleMod：https://github.com/GTNewHorizons/ExampleMod1.7.10
