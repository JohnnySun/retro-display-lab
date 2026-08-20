# Retro Display Lab

[English](README.md) | [繁體中文](README.zh-tw.md) | **简体中文**

我写了两套给 RetroArch 使用的掌机 LCD Shader，分别用来还原初代
Game Boy，以及 GBA SP 后期背光版 AGS-101 的屏幕观感。

我想做的并不是另一个“看起来有点复古”的滤镜，而是从真实测量数据、
当年的研究文献和屏幕工作原理出发，重新建立这两块液晶屏幕的显示过程。

简单来说，就是四个字：**先量，再算。**

## 为什么只靠调色和混帧还不够？

现在常见的怀旧掌机 Shader，很多都是先凭印象调出一种“老屏幕的颜色”，
再把前后几帧混合起来，制造拖影效果。

这种方法可以做出怀旧气氛，却很容易走向不同的极端：有些把初代
Game Boy 调成非常鲜艳的绿色；另一些虽然灰暗复古，最后却更像文曲星或
计算器上的液晶屏幕，而不是初代 Game Boy。

它们可能都有“老屏幕的感觉”，但那不一定是真正的 Game Boy。很多时候，
它们还原的是作者印象中的老屏幕，而不是某一块原始面板实际如何显示。

## 先看看初代 Game Boy 的效果

下面两张图都开启了当前的 GB Shader。这里没有特意放 Shader 关闭时的
对比；你可以先直接看看它的颜色、屏幕质感和动态残影，是不是接近你记忆里
初代 Game Boy 的样子。后面再解释，这些效果为什么不是靠记忆调出来的。

<table>
  <tr><th>标题首页 — 串扰</th><th>方块下落 — 拖影</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-crosstalk.png" alt="KONKR Pocket Advance 上的俄罗斯方块标题首页，呈现初代 Game Boy 行列串扰"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-ghosting.png" alt="KONKR Pocket Advance 上的俄罗斯方块游戏画面，呈现初代 Game Boy 拖影"></td>
  </tr>
</table>

左边的大面积高对比图形能看出行列像素之间的相互影响；右边抓到直条方块
下落的一刻，后方的垂直尾巴把液晶的时间响应直接显示出来。这些不是在画面
最后加上的模糊，而是由持续变化的屏幕状态计算出来的。

## 第一步：先把颜色量清楚

如果想还原一块特定的屏幕，第一件事不是打开调色工具，而是先弄清楚它原本
到底是什么颜色。

Retro Display Lab 使用实际测量和经过色彩管理的参考数据，重建原始屏幕的
色彩、灰阶与黑白锚点，再把结果正确映射到标准 sRGB。初代 Game Boy 不只是
“四种绿色”：除了游戏能控制的四个灰阶，LCD 未驱动时的屏幕底色也是独立的
光学状态。AGS-101 也有自己的黑位、灰阶关系和原生色彩，不能只靠降低饱和度
来代替。

这里所说的校色，是指 Shader 的输出依据测量数据对准 sRGB。只要观看设备
本身经过妥善校准，结果就能接近模型所重建的原始屏幕色彩；如果显示器本身
严重偏色，Shader 当然无法替那块硬件自动完成校准。

## 第二步：计算屏幕如何响应

真正的液晶屏幕不会把前后几张完整画面混在一起。你可以把每个液晶像素想象
成一扇很小的百叶窗：电信号改变后，它需要时间才能移动到新的位置，而且从亮
变暗和从暗变亮，速度也不一定相同。

因此，游戏输出的色码会先转换成模拟的面板驱动，再由
**基于物理模型的算法**计算每个虚拟液晶像素接下来如何变化。每个像素都会保留之前的状态；
新的画面出现后，算法会根据驱动、液晶材料、扫描位置和历史状态，算出下一刻
实际能显示到哪里。

这不是用实体方式重建一块屏幕，而是把屏幕的物理原理做成可以在 GPU 上实时
运行的算法。拖影、串扰和残像因此是模型算出的结果，不是最后贴上去的特效。

## 初代 Game Boy：反射式被动矩阵 LCD

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建初代 Game Boy 的
反射式被动矩阵 STN LCD：

- 四个游戏灰阶，以及 LCD 未驱动时独立的光学底色；
- 精确的 Game Boy 扫描时序、等效电气驱动、STN 液晶响应与反射光学；
- 行列电极 loading 和局部串扰，而不是一般的空间模糊；
- 明暗方向不同的灰阶转换，以及逐像素、慢速的离子残像；
- 矩形像素开口、未驱动间隙与反射层阴影；
- Reference、重拖影、老化个体与加速实验用 preset。

每一份数据如何进入代码、哪些是直接测量、哪些是文献约束的重建，都写在
[DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md)。机器可读的决策与
实现记录则放在 [`reconstruction-v1.json`](models/nintendo-dmg-01/data/reconstruction-v1.json)
和 [implementation to-do](models/nintendo-dmg-01/IMPLEMENTATION-TODO.md)。

## GBA SP AGS-101：另一套完全不同的模型

GBA SP 后期的 AGS-101 使用背光 TFT LCD，和初代 Game Boy 不是同一种技术。
它响应更快，但不同颜色、不同明暗之间的切换速度仍然不完全相同，画面扫描、
驱动状态和 BGR 子像素排列也会影响最后的观感。

所以我没有把 GB 的拖影直接套到 GBA SP 上，而是为 AGS-101 单独建立了色彩、
电气、时间响应和像素结构模型。

<table>
  <tr><th>关闭 Shader — 模拟器原始输出</th><th>开启 Shader — AGS-101 模型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="关闭 AGS-101 Shader 的 GBA 马力欧画面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="开启 AGS-101 模型的 GBA 马力欧画面"></td>
  </tr>
</table>

两边的差别不只是饱和度或亮度。模型会一起处理从测量数据推导的 32 阶色彩
响应与黑白锚点、逐子像素 TFT gray-to-gray 状态、交替驱动与慢速 residual-DC
残像、GBA 扫描／latch／光学 onset 时间，以及最后的 BGR 像素开口。

目前仍没有该 AGS-101 的完整 gray-to-gray matrix 或主板时序 trace，默认值
因此采用文档中列明的解析模型和同时代文献候选范围；未来如果有更好的测量数据，
也已经保留 deterministic measured-table 路径。详细分类与限制见
[AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

## 模型里的数据从哪里来？

项目采用可取得的面板测量、经过色彩管理的原始屏幕参考，以及初代 GB 与
AGS-101 的驱动与时序数据，也查阅同时代相似面板和液晶材料的研究结果。
找不到完整原始数据时，就用年代与
技术相符的文献限制合理范围，并公开候选值和不确定性，而不是把推导值包装成
原机实测。

因此，最准确的定位是“**以物理模型为基础、受测量与文献约束的重建**”。
完整原则见[方法论](docs/methodology.md)、[引用规范](docs/reference-policy.md)和
[Reference 索引](REFERENCES.md)。

## 图片在哪里运行？

本文图片都在 **KONKR Pocket Advance（GT78-VN）** 上使用 RetroArch 实时渲染，
再从它的 **960×640 framebuffer** 直接截取：

- GBA 的 240×160 画面以精确 4 倍映射填满 960×640；
- GB 的 160×144 画面以精确 4 倍映射到 640×576 viewport，周围再放置外框。

这些是掌机 GPU 的实际输出，不是用相机拍摄实体面板。KONKR target 目前标示为
**sRGB-neutral、未测量**，不等同于经过仪器校准的 sRGB 显示器。

游戏画面只用来说明 Shader 行为。俄罗斯方块、马力欧、Nintendo 商标和游戏
内容都归各自的权利人所有。

## 下载

- 稳定版 v0.6.0：[固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.6.0.zip)
- 发布说明：[GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- 最新开发版：[`main` 的 ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git：`git clone https://github.com/JohnnySun/retro-display-lab.git`

## 安装到 RetroArch

1. 把项目解压或 clone 到 `RetroArch/shaders/retro-display-lab`。
2. 切换到 Vulkan video driver；target profile 有要求时开启整数缩放。
3. 关闭模拟器 core 自带的 frame mixing，否则时间响应会被重复计算。
4. 加载与设备相符的 target profile `.slangp`。

我实际测试过的 KONKR GT78-VN 请使用：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

同一台设备的 GBA 内容请使用：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-v1.slangp
```

其他面板请从 model preset 出发建立自己的 target profile，不要把 KONKR 的补偿
当成原始 GB 或 AGS-101 的特性。完整步骤见[安装说明](docs/installation.md)。

## 复现、验证与贡献

```sh
npm test
```

测试会检查 Shader／preset 结构、生成文件可复现性、Reference ID、色阶顺序、
STN surrogate、串扰、TFT gray-to-gray、residual-DC、扫描因果性、target scale、
HCS 色彩向量，以及未测量 target 是否被如实标示。

要提交 PR 请先阅读[引用规范](docs/reference-policy.md)和
[贡献指南](CONTRIBUTING.md)。学术或技术用途请引用 [`CITATION.cff`](CITATION.cff)，
并附上实际使用机制所对应的机型 Reference。

## 许可

原创代码和文档采用 Apache-2.0。第三方来源保持各自条款；项目不会再分发
BGB 图片、商业 ROM，或未经授权的 HCS Shader／数据文件。
