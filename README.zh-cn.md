# Retro Display Lab

[English](README.md) | [繁體中文](README.zh-tw.md) | **简体中文**

面向 RetroArch、以研究可追溯性为核心的物理启发式掌机屏幕 Shader。

Retro Display Lab 将老式 LCD 视为一个随时间变化的光学系统，而不是给画面
套上一层色调。模型可以分别模拟光学色阶、像素开口、矩阵／TFT 结构、方向相关
响应、灰阶转换、串扰与长时间残影。每一项重要机制与参数都必须链接到实际测量、
一手技术文献，或明确标注的实验假设。

## 方法上的差异

Color Tint 只能改变颜色，无法重建与动态内容有关的屏幕缺陷。固定混合前几帧
虽然可以近似拖影，却会任意截断历史，并让所有灰阶转换呈现相同行为。本项目
改用因果、逐像素的状态模型：

- 快速与慢速光学响应会累积完整的画面历史；
- 加深与褪去，或不同 gray-to-gray 转换，可以有不同速度；
- 随曝光时间累积的离子／残留直流状态，使用独立的长时间尺度；
- 点阵开口、反射层阴影、行列串扰与 TFT 结构和色彩分开建模；
- 原始屏幕模型与现代目标面板的补偿设置彼此分离。

我们将成果描述为“**物理启发、测量约束的重建**”。如果找不到原面板的驱动
波形或响应矩阵，就公开文献约束、候选值与不确定性，不把推导值冒充实测值。
详见[方法论](docs/methodology.md)、[引用规范](docs/reference-policy.md)与
[完整 Reference 索引](REFERENCES.md)。

## 可下载模型：Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建初代 Game Boy 的
反射式被动矩阵 STN LCD：

- 四个游戏可指定灰阶，以及独立的 LCD 未驱动光学底色；
- 非对称短期响应、结构慢尾，以及受 1994 年 STN 实验约束的逐像素离子残影；
- 低强度行／列串扰；
- 依据公开 DMG 近拍资料建立的矩形像素开口与反射层阴影；
- Reference、重拖影、老化个体与加速实验 preset。

每一笔资料如何对应到代码、参数与限制，请见
[DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md)。

### 效果对比

<table>
  <tr><th>关闭 Shader — Gambatte 原始输出</th><th>开启 Shader — DMG-01 Reference v1</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-off.png" alt="KPA 关闭 DMG-01 Shader 的俄罗斯方块画面"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-on.png" alt="KPA 开启 DMG-01 Reference v1 的俄罗斯方块画面"></td>
  </tr>
</table>

两张图均为同一台 KPA、Gambatte core、俄罗斯方块 ROM、viewport 与显示状态下
的 960×640 framebuffer 截图，但不是同一个模拟帧。静态图无法完整呈现拖影衰减。

## AGS-101 研究原型

<table>
  <tr><th>关闭 Shader — 模拟器原始输出</th><th>开启 Shader — AGS-101 物理原型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="关闭 AGS-101 Shader 的 GBA 马力欧画面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="开启 AGS-101 物理原型的 GBA 马力欧画面"></td>
  </tr>
</table>

原型将 BGR 像素开口、测量参考色彩、TFT gray-to-gray 响应与慢速残留直流
分开处理。目前色彩阶段仍依赖固定 HCS snapshot 的衍生数据，但上游没有确认的
再分发许可；我们也尚未测到具名 AGS-101 面板的完整 gray-to-gray matrix。
因此图片只记录研究进度，目前不提供 AGS-101 preset。详见
[AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

游戏图片只用于说明 Shader 行为；俄罗斯方块、马力欧、Nintendo 商标与游戏内容
均属于其权利人。

## 下载

- 稳定 v0.2.0：[下载固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.2.0.zip)
- 发布说明：[GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- 最新开发版：[下载 `main` ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git：`git clone https://github.com/JohnnySun/retro-display-lab.git`

## 安装到 RetroArch

1. 将项目解压或 clone 到 `RetroArch/shaders/retro-display-lab`。
2. 使用 Vulkan video driver，并根据 target profile 开启整数缩放。
3. 关闭模拟器 core 自带的 frame mixing，避免重复模拟时间响应。
4. 加载与目标设备相符的 `.slangp`。

已测试的 KONKR GT78-VN 请加载：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

此 profile 在 960×640 面板使用 640×576 的 DMG viewport，正好是 4 倍整数
缩放。显示状态是“**sRGB-neutral、未测量**”，不等于仪器校准 sRGB。其他
面板应从 model preset 建立自己的 target profile。详见[安装说明](docs/installation.md)。

## 重现与验证

```sh
npm test
```

检查涵盖 Shader／preset 结构、Reference ID、色阶顺序、STN 响应锚点、1994
年回归、长尾、target scale，以及未测量显示状态的披露。贡献内容必须符合
[引用规范](docs/reference-policy.md)与[贡献指南](CONTRIBUTING.md)。
学术或技术使用请同时引用 [`CITATION.cff`](CITATION.cff)，以及实际使用机制所
对应的机型 Reference。

## 许可

本项目原创代码与文档采用 Apache-2.0。第三方来源维持各自条款；本项目不再分发
BGB 图片、商业 ROM 或未获许可的 HCS Shader／数据文件。
