# Retro Display Lab

[English](README.md) | [繁體中文](README.zh-tw.md) | **简体中文**

给 RetroArch 用的掌机屏幕 Shader，物理模型和数据出处都写清楚。

大多数怀旧屏幕 Shader 本质上只是一组调色板：把 Game Boy 的绿色调得差不多，就没有然后了。可是 DMG 的屏幕并不是一种颜色，它是一块反应很慢的反射式光学器件，而它之所以一眼就能认出来，很多东西是发生在时间轴上的——方块下落时后面拖出来的那条尾巴、暗下去的像素褪回亮色时比变暗还慢、离开标题画面之后还隐约留在那儿的残影。

这个项目想重建的就是这些行为。每个机型模型可以分开处理光学色阶、像素开口、矩阵与 TFT 结构、方向相关响应、灰阶转换、串扰，以及长时间残影。而每一项重要机制和参数，都得能连回实际测量、一手技术文献，或者一个被明确标注成假设的假设。

## 这个模型到底在做什么

Color Tint 只能改颜色，重建不了那些画面动起来才看得见的缺陷。把前面几帧按固定比例混合会接近一些，但那等于任意截断历史，而且所有灰阶转换都变成同一种行为。这里换成因果的、逐像素的状态模型：

- 快速与慢速光学响应是在完整的画面历史上累积，而不是固定几帧的窗口；
- 加深和褪去可以有不同速度，不同的 gray-to-gray 转换也可以；
- 离子／残留直流状态随曝光时间累积，并在另一个长得多的时间尺度上释放；
- 点阵开口、反射层阴影、行列串扰和 TFT 结构，都跟色彩分开建模；
- 原始面板的物理，和针对现代目标屏幕做的补偿，是两件分开处理的事。

把成果称作“**物理启发、测量约束的重建**”是有意保守的说法。如果找不到原面板的驱动波形或响应矩阵，就把文献约束、候选值和不确定性一起公开，而不是把推导出来的数字包装成实测值。细节见[方法论](docs/methodology.md)、[引用规范](docs/reference-policy.md)和[完整 Reference 索引](REFERENCES.md)。

## 可下载模型：Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建的是初代 Game Boy 那块反射式被动矩阵 STN LCD：

- 游戏可以指定的四个灰阶，加上 LCD 未驱动时那层独立的光学底色；
- 非对称短期响应、结构性的慢尾，以及受 1994 年 STN 实验约束的逐像素离子残影；
- 低强度的行／列串扰；
- 依据公开 DMG 近拍资料建立的矩形像素开口与反射层阴影；
- Reference、重拖影、老化个体，以及加速实验用的 preset。

哪一份资料对应到哪一段代码、有哪些限制，都写在 [DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md) 里。

### 效果对比

<table>
  <tr><th>关闭 Shader — Gambatte 原始输出</th><th>开启 Shader — DMG-01 Reference v1</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-off.png" alt="KPA 关闭 DMG-01 Shader 的俄罗斯方块画面"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-on.png" alt="KPA 开启 DMG-01 Reference v1 的俄罗斯方块画面"></td>
  </tr>
</table>

两张图都是在同一台 KPA、同一个 Gambatte core、同一份俄罗斯方块 ROM、同样的 viewport 和显示状态下拍的 960×640 framebuffer 截图，但不是同一个模拟帧。何况静态图本来也没法完整呈现拖影的衰减过程。

## 可下载物理种子：Nintendo GBA SP AGS-101

<table>
  <tr><th>关闭 Shader — 模拟器原始输出</th><th>开启 Shader — AGS-101 物理原型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="关闭 AGS-101 Shader 的 GBA 马力欧画面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="开启 AGS-101 物理原型的 GBA 马力欧画面"></td>
  </tr>
</table>

现在可以直接下载并使用
[`physics-seed-v1`](models/nintendo-ags-101/presets/physics-seed-v1.slangp)。
它把 BGR 像素开口、TFT 的 gray-to-gray 响应和慢速残留直流分开处理，色彩端
现在会从固定版本的 HCS AGS-101 测量记录，可复现地生成 32 阶 EOTF、原生色彩
矩阵与黑白锚点；中性 sRGB adapter 则保留作为回归基准。

参考资料中仍没有完整的 gray-to-gray matrix，因此 runtime 使用受文献约束的
解析 fallback，并提供可接收实测表格的格式。驱动残留使用同时代论文的 cell
动力学和明确标记的项目桥接先验；扫描则拆成 row start、电气 latch 与 optical
onset。完整证据与参数分类见
[AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

游戏画面只是用来说明 Shader 的行为。俄罗斯方块、马力欧、Nintendo 商标和游戏内容都归各自的权利人所有。

## 下载

- 稳定版 v0.4.0：[固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.4.0.zip)
- 发布说明：[GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- 最新开发版：[`main` 的 ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git：`git clone https://github.com/JohnnySun/retro-display-lab.git`

## 安装到 RetroArch

1. 把项目解压或 clone 到 `RetroArch/shaders/retro-display-lab`。
2. 切到 Vulkan video driver，target profile 有要求的话就打开整数缩放。
3. 关掉模拟器 core 自带的 frame mixing，否则时间响应会被模拟两遍。
4. 加载跟你设备相符的那个 target profile 下面的 `.slangp`。

我手上测过的 KONKR GT78-VN，对应的是这个：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

同一台设备的 GBA 内容请加载：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-physics-seed-v1.slangp
```

这个 profile 在 960×640 的面板上放一个 640×576 的 DMG viewport，正好是 4 倍整数缩放。它的显示状态是“**sRGB-neutral、未测量**”，跟仪器校准过的 sRGB 不是一回事。换成别的面板，请从 model preset 出发，自己建一份 target profile。完整步骤见[安装说明](docs/installation.md)。

## 复现与验证

```sh
npm test
```

检查范围包括 Shader 与 preset 结构、Reference ID、色阶顺序、STN／TFT 响应
锚点、1994 年回归、residual-DC 积分、target scale、HCS 禁止常数，以及未测量
显示状态有没有被如实披露。要提 PR 的话，请照[引用规范](docs/reference-policy.md)
和[贡献指南](CONTRIBUTING.md)来。学术或技术用途请引用
[`CITATION.cff`](CITATION.cff)，并附上实际使用机制所对应的机型 Reference。

## 许可

项目的原创代码和文档采用 Apache-2.0。第三方来源各自保持原本的条款：BGB 图片、商业 ROM，以及未获许可的 HCS Shader／数据文件，这里都不会再分发。
