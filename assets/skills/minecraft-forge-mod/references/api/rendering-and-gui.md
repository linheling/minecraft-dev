# Forge 渲染与 GUI 参考（1.16.5 / 1.20.1）

> 覆盖 Screen、AbstractContainerScreen、HUD overlay、实体渲染器注册与模型层。1.16.5 与 1.20.1 的 GUI 渲染参数不同（`PoseStack` → `GuiGraphics`），本文按版本分节，代码片段默认为 1.20.1；1.16.5 的差异单独列出。
>
> 核对来源：Forge 1.20.1 官方 Screens 文档、Forge 1.20.x `RegisterGuiOverlaysEvent` / `IGuiOverlay` 源码、Forge 1.20.1 `Screen` / `GuiGraphics` / `Button` 签名、本仓库 `assets/templates/forge-1.20.1`。核对日期：2026-10-23。代码为文档级验证，未在本机完成 ForgeGradle 编译。

## 1. 版本差异速查

| 项目 | 1.16.5 | 1.20.1 |
| --- | --- | --- |
| 渲染上下文 | `PoseStack`（`com.mojang.blaze3d.vertex.PoseStack`） | `GuiGraphics`（`net.minecraft.client.gui.GuiGraphics`） |
| Screen 渲染方法 | `render(PoseStack, int, int, float)` | `render(GuiGraphics, int, int, float)` |
| 背景 | `renderBackground(PoseStack)` | `renderBackground(GuiGraphics)` |
| 文本 | `font.draw(stack, ...)` | `graphics.drawString(font, ...)` |
| HUD 事件 | `RenderGameOverlayEvent.Post`（`ElementType.ALL`） | `RegisterGuiOverlaysEvent`（mod bus） |
| 按钮构造 | `new Button(x, y, w, h, Component, onPress)` | `Button.builder(...).bounds(...).build()` |
| 实体渲染器注册 | `EntityRenderersEvent.RegisterRenderers` | 同上（1.16.5 已存在） |
| 模型层注册 | `EntityRenderersEvent.RegisterLayerDefinitions` | 同上 |

颜色一律 ARGB：`0xFFFFFFFF` 是不透明白，`0x80FF0000` 是半透明红。`0xFFFFFF` 在 `drawString` 里会被当作无 alpha，通常仍显示，但不要依赖。

## 2. 普通 Screen

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
                .bounds(this.width / 2 - 50, this.height / 2 + 20, 100, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(graphics);
        graphics.drawCenteredString(this.font, TITLE, this.width / 2, this.height / 2 - 30, 0xFFFFFFFF);
        super.render(graphics, mouseX, mouseY, partialTick);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
```

打开：

```java
Minecraft.getInstance().setScreen(new MyScreen());
```

要点：

- `init()` 里才能拿到正确的 `width` / `height`；窗口缩放会重新调用 `init()`，控件要在这里重建。
- `addRenderableWidget` 同时负责渲染、交互与旁白；只画不交互用 `addRenderableOnly`，只交互不画用 `addWidget`。
- `super.render(...)` 必须调用，否则控件不画；背景通常先画，tooltip 最后画。
- `renderBackground(graphics)` 在 1.20.1 会画模糊背景/菜单背景；不要在它之前再画一次全屏矩形，否则叠两层。
- `isPauseScreen()` 返回 `false` 时单人游戏打开界面不暂停；容器界面一般保持默认 `true`。
- 1.16.5 把 `GuiGraphics` 换成 `PoseStack`，`graphics.drawCenteredString(...)` 换成 `this.font.drawShadow(stack, TITLE, x, y, color)`。

### 2.1 纹理与文字

```java
private static final ResourceLocation TEXTURE =
        new ResourceLocation("mymod", "textures/gui/my_screen.png");

@Override
public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
    this.renderBackground(graphics);
    // 纹理按 256x256 归一化；x/y 是屏幕坐标，u/v 是纹理内坐标
    graphics.blit(TEXTURE, 10, 10, 0, 0, 100, 60, 256, 256);
    graphics.drawString(this.font, Component.literal("Hello"), 20, 20, 0xFFFFFFFF);
    super.render(graphics, mouseX, mouseY, partialTick);
}
```

`blit` 的 8 参数重载 `(texture, x, y, u, v, width, height, textureWidth, textureHeight)` 最常用；不确定 PNG 尺寸时显式传 256/256，不要用只接受 6 个参数、默认 256 的重载去画非 256 纹理。

## 3. AbstractContainerScreen

容器界面 = Menu（双端）+ Screen（客户端）。Menu 注册在 common 代码，Screen 注册在客户端 setup：

```java
// 客户端：FMLClientSetupEvent 里注册，必须在 enqueueWork 内
@SubscribeEvent
public static void clientSetup(FMLClientSetupEvent event) {
    event.enqueueWork(() -> MenuScreens.register(MyMenus.MY_MENU.get(), MyMenuScreen::new));
}
```

```java
public class MyMenuScreen extends AbstractContainerScreen<MyMenu> {
    private static final ResourceLocation BACKGROUND =
            new ResourceLocation("mymod", "textures/gui/container/my_menu.png");

    public MyMenuScreen(MyMenu menu, Inventory inventory, Component title) {
        super(menu, inventory, title);
        this.imageWidth = 176;
        this.imageHeight = 166;
    }

    @Override
    protected void renderBg(GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
        graphics.blit(BACKGROUND, this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(graphics);
        super.render(graphics, mouseX, mouseY, partialTick);
        this.renderTooltip(graphics, mouseX, mouseY);
    }
}
```

要点：

- `MenuScreens.register` 不是线程安全的，必须在 `FMLClientSetupEvent#enqueueWork` 里调用（并行事件）。
- `leftPos` / `topPos` 由 `AbstractContainerScreen` 在 `init()` 算好；`renderBg` 直接用，不要自己按 `width/2` 重算。
- Slot 的坐标是相对 menu 的；`addSlot(new Slot(inventory, index, x, y))` 的 x/y 相对背景左上角。
- 1.16.5 的 `renderBg` 第一个参数是 `PoseStack`，`graphics.blit` 换成 `GuiUtils.drawTexturedModalRect` 或在 `PoseStack` 上手动 blit。

## 4. HUD overlay（1.20.1）

HUD 是每帧叠加在游戏画面上的层；Forge 1.20.1 用 mod bus 的 `RegisterGuiOverlaysEvent`：

```java
@Mod.EventBusSubscriber(modid = MyMod.MODID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ClientOverlays {
    @SubscribeEvent
    public static void register(RegisterGuiOverlaysEvent event) {
        event.registerAboveAll("mymod_info", (gui, graphics, partialTick, screenWidth, screenHeight) -> {
            Minecraft minecraft = Minecraft.getInstance();
            if (minecraft.player == null || minecraft.options.hideGui) {
                return;
            }
            graphics.drawString(minecraft.font, Component.literal("MyMod HUD"), 6, 6, 0xFFFFFFFF);
        });
    }
}
```

可用注册点（1.20.1 的 `RegisterGuiOverlaysEvent`）：

| 方法 | 位置 |
| --- | --- |
| `registerBelowAll(id, overlay)` | 所有原版层之前 |
| `registerAboveAll(id, overlay)` | 所有原版层之后 |
| `registerBelow(ResourceLocation other, id, overlay)` | 指定原版层之前 |
| `registerAbove(ResourceLocation other, id, overlay)` | 指定原版层之后 |

`IGuiOverlay` 签名：

```java
void render(ForgeGui gui, GuiGraphics guiGraphics, float partialTick, int screenWidth, int screenHeight);
```

要点：

- 只注册一次；事件在客户端 mod bus，不要挂到 `MinecraftForge.EVENT_BUS`。
- 用 `minecraft.options.hideGui` 尊重 F1 隐藏界面；用 `player == null` 避免主菜单/加载界面渲染。
- HUD 每帧都跑，避免在渲染回调里分配大对象、读磁盘、发网络包；需要缓存的数据在 tick 里更新。
- 1.16.5 用 `RenderGameOverlayEvent.Post`，判断 `event.getType() == RenderGameOverlayEvent.ElementType.ALL`，从 `event.getMatrixStack()` 取 `MatrixStack`，再调用 `font.drawShadow(...)`。

## 5. 实体渲染器与模型层

实体渲染器是客户端资源，注册在 mod bus：

```java
@Mod.EventBusSubscriber(modid = MyMod.MODID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ClientEntityRenderers {
    @SubscribeEvent
    public static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(MyEntities.MY_MOB.get(), MyMobRenderer::new);
    }

    @SubscribeEvent
    public static void registerLayers(EntityRenderersEvent.RegisterLayerDefinitions event) {
        event.registerLayerDefinition(MyMobModel.LAYER, MyMobModel::createBodyLayer);
    }
}
```

```java
public class MyMobRenderer extends MobRenderer<MyMob, MyMobModel> {
    private static final ResourceLocation TEXTURE =
            new ResourceLocation("mymod", "textures/entity/my_mob.png");

    public MyMobRenderer(EntityRendererProvider.Context context) {
        super(context, new MyMobModel(context.bakeLayer(MyMobModel.LAYER)), 0.5F);
    }

    @Override
    public ResourceLocation getTextureLocation(MyMob entity) {
        return TEXTURE;
    }
}
```

模型层：

```java
public class MyMobModel extends EntityModel<MyMob> {
    public static final ModelLayerLocation LAYER =
            new ModelLayerLocation(new ResourceLocation("mymod", "my_mob"), "main");

    public static LayerDefinition createBodyLayer() {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition root = mesh.getRoot();
        root.addOrReplaceChild("body",
                CubeListBuilder.create().texOffs(0, 0).addBox(-4.0F, 0.0F, -2.0F, 8.0F, 8.0F, 4.0F),
                PartPose.offset(0.0F, 16.0F, 0.0F));
        return LayerDefinition.create(mesh, 64, 64);
    }

    @Override
    public void setupAnim(MyMob entity, float limbSwing, float limbSwingAmount,
                          float ageInTicks, float netHeadYaw, float headPitch) {
        // 按需旋转部件
    }

    @Override
    public void renderToBuffer(PoseStack poseStack, VertexConsumer buffer, int packedLight,
                               int packedOverlay, float red, float green, float blue, float alpha) {
        // 1.20.1 的 EntityModel 抽象方法；遍历 root 的 children 调 render
    }
}
```

要点：

- `getTextureLocation` 路径必须是 `assets/<modid>/textures/entity/...png`，且是 64x64 或 128x128 的方块模型纹理；尺寸与 `LayerDefinition.create(mesh, texWidth, texHeight)` 一致。
- `context.bakeLayer(LAYER)` 只能在注册了 `RegisterLayerDefinitions` 之后调用；漏注册会在启动时抛 `IllegalArgumentException: Layer ... not registered`。
- `EntityRendererProvider.Context` 还能取 `getEntityRenderDispatcher()`、`getBlockRenderDispatcher()`、`getItemRenderer()`；需要方块/物品模型时从这里拿，不要 `new`。
- 1.16.5 的 `EntityRenderersEvent` 已存在，写法基本一致，只是 `PoseStack` 代替 `GuiGraphics`（实体渲染本来就是 `PoseStack`）。

## 6. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 界面全黑/控件不显示 | 没有调用 `super.render(...)` | 在自定义渲染后调用 |
| 背景叠两层 | 自己画了全屏矩形又调了 `renderBackground` | 只保留一个 |
| 按钮点了没反应 | `init()` 里 `new Button(...)` 后没 `addRenderableWidget` | 通过 `addRenderableWidget` 加进去 |
| 打开容器界面崩溃 | `MenuScreens.register` 在并行事件外调用 | 放进 `FMLClientSetupEvent#enqueueWork` |
| HUD 不显示 | 注册到了 `MinecraftForge.EVENT_BUS` 或服务端 | 客户端 mod bus + `Dist.CLIENT` |
| 实体紫色/黑块 | 纹理路径或尺寸不对 | 核对 `assets/<modid>/textures/entity/...` 与 `LayerDefinition` 尺寸 |
| 启动报 layer 未注册 | 只 `bakeLayer` 没注册 `RegisterLayerDefinitions` | 两个事件都要写 |
| 1.16.5 代码直接搬 1.20.1 | `GuiGraphics` 在 1.16.5 不存在 | 用 `PoseStack` + `font.drawShadow` + `GuiUtils` |

## 7. 参考链接

- Forge 1.20.1 Screens：https://docs.minecraftforge.net/en/1.20.1/gui/screens/
- Forge 1.20.1 Menus：https://docs.minecraftforge.net/en/1.20.1/gui/menus/
- Forge 1.20.x `RegisterGuiOverlaysEvent` 源码：https://github.com/MinecraftForge/MinecraftForge/blob/1.20.x/src/main/java/net/minecraftforge/client/event/RegisterGuiOverlaysEvent.java
- Forge 1.20.1 GUI 概念（GuiGraphics/Renderable）：见 Screens 文档同名小节
- 本仓库模板：`assets/templates/forge-1.20.1/`、`assets/templates/forge-1.16.5/`

## 8. 验证状态

- `Screen` / `GuiGraphics` / `Button.builder().bounds()` / `MenuScreens.register` / `RegisterGuiOverlaysEvent` / `EntityRenderersEvent` 的签名已对照 Forge 1.20.1 文档与源码。
- 1.16.5 的 `PoseStack` 与 `RenderGameOverlayEvent` 路径按 Forge 1.16.5 API 编写；未逐行对照 1.16.5 源码，标注为文档级验证。
- 未在本机执行 ForgeGradle 编译（依赖下载受限）；首次接入先跑 `runClient` 验证 GUI 与 HUD。
