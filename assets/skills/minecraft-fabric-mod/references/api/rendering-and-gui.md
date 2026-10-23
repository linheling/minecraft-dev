# Fabric 渲染与 GUI 参考（1.20.1 / 1.21.11 / 26.x）

> 覆盖 Screen、HUD、实体渲染器与模型层注册。Fabric 模板用 Mojang 官方映射（1.20.1/1.21.11 通过 `loom.officialMojangMappings()`；26.x 不再混淆、直接用官方名），本文类名一律写 mojmap，Yarn 名在括号里注明。
>
> 核对来源：Fabric API 1.21.11 / 26.2 源码（`HudElementRegistry`、`HudElement`、`EntityRendererRegistry`、`ModelLayerRegistry`）、Fabric 文档 `develop/rendering`（main 分支=26.x）、Fabric API 1.20.1 的 `HudRenderCallback`。核对日期：2026-10-23。代码为文档级验证，未在本机完成 Loom 编译。

## 1. 版本差异速查

| 项目 | 1.20.1 | 1.21.11 | 26.2 / 26.3 |
| --- | --- | --- | --- |
| 标识符类 | `ResourceLocation` | `Identifier` | `Identifier` |
| GUI 绘制类 | `GuiGraphics`（Yarn `DrawContext`） | `GuiGraphics` | `GuiGraphicsExtractor` |
| Screen 每帧方法 | `render(GuiGraphics, int, int, float)` | 同 1.20.1 | `extractRenderState(GuiGraphicsExtractor, int, int, float)` |
| 控件添加 | `addRenderableWidget`（Yarn `addDrawableChild`） | 同 1.20.1 | 同 1.20.1 |
| 按钮构造 | `Button.builder(...).bounds(x,y,w,h)` | `Button.builder(...).pos(x,y).size(w,h)` | 同 1.21.11 |
| HUD API | `HudRenderCallback.EVENT` | `HudElementRegistry`（`HudRenderCallback` 已弃用） | `HudElementRegistry` + `HudElement#extractRenderState` |
| 模型层注册 | `EntityModelLayerRegistry` | `EntityModelLayerRegistry` | `ModelLayerRegistry` |
| 实体渲染器 | `EntityRendererRegistry.register` | 同 1.20.1 | 同 1.20.1 |

26.x 的渲染管线改成「先抽取 RenderState，再统一提交」，`Screen#render` 被 `extractRenderState` 取代；屏幕背景/控件仍由 `super.extractRenderState(...)` 处理，自定义绘制改用 `GuiGraphicsExtractor` 的方法。

## 2. 客户端入口

`fabric.mod.json`：

```json
{
  "entrypoints": {
    "client": [
      "com.example.mymod.client.MyModClient"
    ]
  }
}
```

```java
package com.example.mymod.client;

import net.fabricmc.api.ClientModInitializer;

public class MyModClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // 注册按键、HUD、实体渲染器、Screen 等客户端资源
    }
}
```

只有 `client` 入口在物理客户端执行；服务端不会加载这个类。任何引用 `Minecraft`、`Screen`、`GuiGraphics` 的代码都必须放在 `src/client/java`（Loom 的 client source set）或 `client` 入口可达的类里，否则专用服务器会 `ClassNotFoundException`。

## 3. 普通 Screen

### 3.1 1.20.1 / 1.21.11

```java
package com.example.mymod.client.screen;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

public class MyScreen extends Screen {
    private static final Component TITLE = Component.translatable("screen.mymod.my_screen");

    public MyScreen() {
        super(TITLE);
    }

    @Override
    protected void init() {
        super.init();
        this.addRenderableWidget(Button.builder(Component.translatable("gui.done"), button -> this.onClose())
                // 1.20.1: .bounds(x, y, width, height)
                // 1.21.11: .pos(x, y).size(width, height)
                .bounds(this.width / 2 - 50, this.height / 2 + 20, 100, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(graphics);
        graphics.drawCenteredString(this.font, TITLE, this.width / 2, this.height / 2 - 30, 0xFFFFFFFF);
        super.render(graphics, mouseX, mouseY, partialTick);
    }
}
```

打开：

```java
Minecraft.getInstance().setScreen(new MyScreen());
```

要点：

- `init()` 里重建控件；窗口缩放会再次调用 `init()`，不要把控件只放在构造函数里。
- 1.20.1 的按钮用 `.bounds(x, y, w, h)`；1.21.11 改成 `.pos(x, y).size(w, h)`，直接抄 1.20.1 会编译失败。
- `addRenderableWidget` 同时渲染 + 交互 + 旁白；`addRenderableOnly` 只渲染；`addWidget` 只交互。
- `super.render(...)` 必须调用；`renderBackground(graphics)` 只画一次。
- 1.21.11 的 `Identifier.fromNamespaceAndPath("mymod", "my_screen")` 替代 1.20.1 的 `new ResourceLocation("mymod", "my_screen")`。

### 3.2 26.x

```java
@Override
public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
    // 背景与控件交给父类；自定义绘制用 GuiGraphicsExtractor 的 fill/blit/drawString
    super.extractRenderState(graphics, mouseX, mouseY, partialTick);
    graphics.drawString(this.font, TITLE, this.width / 2 - 40, this.height / 2 - 30, 0xFFFFFFFF);
}
```

26.x 不要在 `extractRenderState` 里直接调 OpenGL/`RenderSystem`；所有绘制都交给 `GuiGraphicsExtractor`，由渲染线程统一提交。直接写 raw GL 在 26.2 的 Vulkan 后端上不受支持。

### 3.3 纹理

```java
// 1.20.1
private static final ResourceLocation TEXTURE =
        new ResourceLocation("mymod", "textures/gui/my_screen.png");

// 1.21.11 / 26.x
private static final Identifier TEXTURE =
        Identifier.fromNamespaceAndPath("mymod", "textures/gui/my_screen.png");

graphics.blit(TEXTURE, 10, 10, 0, 0, 100, 60, 256, 256);
```

纹理文件放 `src/main/resources/assets/mymod/textures/gui/my_screen.png`；`blit` 的 `u/v` 是纹理内像素坐标，最后两个参数是整张 PNG 的宽高。

## 4. HUD

### 4.1 1.20.1

```java
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;

HudRenderCallback.EVENT.register((graphics, tickDelta) -> {
    Minecraft minecraft = Minecraft.getInstance();
    if (minecraft.player == null || minecraft.options.hideGui) {
        return;
    }
    graphics.drawString(minecraft.font, Component.literal("MyMod HUD"), 6, 6, 0xFFFFFFFF);
});
```

1.20.1 的 `HudRenderCallback#onHudRender(DrawContext, float)` 在 Yarn 里叫 `DrawContext`，mojmap 是 `GuiGraphics`；`float` 是 tick delta。注册在 `onInitializeClient()` 里。

### 4.2 1.21.11

```java
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.resources.Identifier;

HudElementRegistry.addLast(
        Identifier.fromNamespaceAndPath("mymod", "info"),
        (graphics, deltaTracker) -> {
            Minecraft minecraft = Minecraft.getInstance();
            if (minecraft.player == null || minecraft.options.hideGui) {
                return;
            }
            graphics.drawString(minecraft.font, Component.literal("MyMod HUD"), 6, 6, 0xFFFFFFFF);
        });
```

- `HudElementRegistry.addLast(Identifier, HudElement)` 追加到 HUD 末尾；`addFirst` 放到最前。
- 需要相对原版元素定位时用 `attachElementBefore(VanillaHudElements.MISC_OVERLAYS, id, element)` / `attachElementAfter(...)`，原版元素常量在 `VanillaHudElements`。
- `HudRenderCallback` 从 1.21.6 起标记 `@Deprecated`，仍能用，但新代码用 `HudElementRegistry`。
- `DeltaTracker#getGameTimeDeltaPartialTick(false)` 取插值时间；HUD 每帧调用，不要在这里做重活。

### 4.3 26.x

`HudElement` 的签名从 `render(GuiGraphics, DeltaTracker)` 改为：

```java
void extractRenderState(GuiGraphicsExtractor graphics, DeltaTracker deltaTracker);
```

注册方式与 1.21.11 相同，只是 lambda 的方法名/绘制类变了；示例：

```java
HudElementRegistry.addLast(
        Identifier.fromNamespaceAndPath("mymod", "info"),
        (graphics, deltaTracker) -> graphics.fill(4, 4, 84, 16, 0x80000000));
```

`GuiGraphicsExtractor` 的方法名与 `GuiGraphics` 接近，但语义是「写入 RenderState」；不要保存它、不要跨帧使用。

## 5. 实体渲染器与模型层

### 5.1 1.20.1 / 1.21.11

```java
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

EntityRendererRegistry.register(MyEntities.MY_MOB, MyMobRenderer::new);
EntityModelLayerRegistry.registerModelLayer(MyMobModel.LAYER, MyMobModel::createBodyLayer);
```

```java
public class MyMobRenderer extends MobRenderer<MyMob, MyMobModel> {
    private static final Identifier TEXTURE =
            Identifier.fromNamespaceAndPath("mymod", "textures/entity/my_mob.png");

    public MyMobRenderer(EntityRendererProvider.Context context) {
        super(context, new MyMobModel(context.bakeLayer(MyMobModel.LAYER)), 0.5F);
    }

    @Override
    public Identifier getTextureLocation(MyMob entity) {
        return TEXTURE;
    }
}
```

模型层：

```java
public class MyMobModel extends EntityModel<MyMob> {
    public static final ModelLayerLocation LAYER =
            new ModelLayerLocation(Identifier.fromNamespaceAndPath("mymod", "my_mob"), "main");

    public static LayerDefinition createBodyLayer() {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition root = mesh.getRoot();
        root.addOrReplaceChild("body",
                CubeListBuilder.create().texOffs(0, 0).addBox(-4.0F, 0.0F, -2.0F, 8.0F, 8.0F, 4.0F),
                PartPose.offset(0.0F, 16.0F, 0.0F));
        return LayerDefinition.create(mesh, 64, 64);
    }
}
```

### 5.2 26.x

- `EntityModelLayerRegistry` 改名为 `ModelLayerRegistry`：

```java
ModelLayerRegistry.registerModelLayer(MyMobModel.LAYER, MyMobModel::createBodyLayer);
```

- `EntityRendererRegistry.register(EntityType, EntityRendererProvider)` 不变。
- `getTextureLocation` 的返回类型是 `Identifier`；路径规则不变。

要点：

- 实体渲染器/模型层注册都要在客户端入口里执行，且 `EntityType` 已在 common 端注册。
- `context.bakeLayer(LAYER)` 依赖先注册 `ModelLayerRegistry`/`EntityModelLayerRegistry`；漏注册会启动失败。
- 纹理必须是 `assets/mymod/textures/entity/my_mob.png`，尺寸与 `LayerDefinition.create(mesh, texWidth, texHeight)` 一致。
- 1.20.1 的 `MobRenderer` 构造参数与 1.21.11 相同；1.20.1 的 `getTextureLocation` 返回 `ResourceLocation`。

## 6. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 专用服务器崩 `NoClassDefFoundError: net/minecraft/client/...` | 客户端类放进了 common source set | 移到 `src/client/java`，且只从 `client` 入口引用 |
| `Button.builder(...).bounds` 在 1.21.11 编译失败 | 1.21.11 改成 `.pos().size()` | 按版本切换 |
| Screen 打开后黑屏/控件不显示 | 没调 `super.render`/`super.extractRenderState` | 补上 |
| 26.x 报 `render` 不是抽象方法 | 26.x 用 `extractRenderState` | 改方法名与参数类型 |
| HUD 不显示 | 注册在 common 入口或服务端 | 放 `client` 入口 |
| `HudElementRegistry` 找不到 | Fabric API 版本低于 1.21.6 | 升级 Fabric API，或临时用已弃用的 `HudRenderCallback` |
| 实体纹理紫黑 | 路径/尺寸错，或 `Identifier` 命名空间不是 modid | 核对 `assets/<modid>/textures/entity/...` |
| 26.x 模型层注册编译失败 | `EntityModelLayerRegistry` 已改名 | 用 `ModelLayerRegistry` |

## 7. 参考链接

- Fabric 文档（main=26.x）：https://docs.fabricmc.net/develop/rendering/basic-concepts
- Fabric 文档 HUD：https://docs.fabricmc.net/develop/rendering/hud
- Fabric 文档自定义 Screen：https://docs.fabricmc.net/develop/rendering/gui/custom-screens
- Fabric API 1.21.11 `HudElementRegistry`：https://github.com/FabricMC/fabric/blob/1.21.11/fabric-rendering-v1/src/client/java/net/fabricmc/fabric/api/client/rendering/v1/hud/HudElementRegistry.java
- Fabric API 26.2 `HudElement`：https://github.com/FabricMC/fabric/blob/26.2/fabric-rendering-v1/src/client/java/net/fabricmc/fabric/api/client/rendering/v1/hud/HudElement.java

## 8. 验证状态

- 1.21.11 / 26.2 的 HUD、实体渲染器、模型层签名已对照 Fabric API 源码。
- 1.20.1 的 `HudRenderCallback` 签名已对照 1.20.1 分支源码；`Button.builder().bounds()` 与 `Screen#render` 按 1.20.1 mojmap。
- 26.x 的 `GuiGraphicsExtractor#fill/drawString` 方法名按 Fabric 文档与 26.2 源码的抽取式 API 编写；具体重载以编译结果为准。
- 未在本机执行 Loom 编译；首次接入先跑 `runClient`，并检查 `latest.log` 是否有 mixin/渲染注册错误。
