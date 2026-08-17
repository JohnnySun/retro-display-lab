# Retro Display Lab

[English](README.md) | **繁體中文** | [简体中文](README.zh-cn.md)

給 RetroArch 用的掌機螢幕 Shader，物理模型和資料出處都寫出來。

大多數懷舊螢幕 Shader 其實就是一組調色盤：把 Game Boy 的綠色調得差不多，然後就結束了。但 DMG 的螢幕不是一種顏色，它是一塊反應很慢的反射式光學元件，而它之所以一眼就認得出來，很多是發生在時間軸上的事——方塊掉下來時後面拖的那條尾巴、暗掉的像素要褪回亮色時比變暗還慢、離開標題畫面之後還隱約留在那裡的殘影。

這個專案想重建的就是這些行為。每個機型模型可以分別處理光學色階、像素開口、矩陣與 TFT 結構、方向相依響應、灰階轉換、串擾，以及長時間殘像。而每一項重要機制和參數，都要能連回實際量測、一手技術文獻，或是一個被明確標示成假設的假設。

## 這個模型實際在做什麼

Color Tint 只能改顏色，重建不了那些只有在畫面動起來時才看得到的缺陷。把前面幾幀固定混合起來會接近一點，但那是任意截斷歷史，而且所有灰階轉換都變成同一種行為。這裡改用因果的、逐像素的狀態模型：

- 快速與慢速光學響應是在完整的畫面歷史上累積，不是固定幾幀的視窗；
- 加深和褪去可以有不同速度，不同的 gray-to-gray 轉換也可以；
- 離子／殘留直流狀態隨曝光時間累積，並在另一個長得多的時間尺度上釋放；
- 點陣開口、反射層陰影、行列串擾與 TFT 結構，都和色彩分開建模；
- 原始面板的物理，和針對現代目標螢幕做的補償，兩件事分開處理。

把成果稱為「**物理啟發、測量約束的重建**」是刻意保守的說法。如果找不到原面板的驅動波形或響應矩陣，就把文獻約束、候選值和不確定性一併公開，而不是把推導出來的數字包裝成實測值。細節見[方法論](docs/methodology.md)、[引用規範](docs/reference-policy.md)和[完整 Reference 索引](REFERENCES.md)。

## 可下載模型：Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建初代 Game Boy 那塊反射式被動矩陣 STN LCD：

- 遊戲可以指定的四個灰階，加上 LCD 未驅動時獨立的光學底色；
- 非對稱短期響應、結構性的慢尾，以及受 1994 年 STN 實驗約束的逐像素離子殘像；
- 低強度的行／列串擾；
- 依據公開 DMG 近拍資料建立的矩形像素開口與反射層陰影；
- Reference、重拖影、老化個體，以及加速實驗用的 preset。

哪一筆資料對應到哪一段程式碼、有哪些限制，都寫在 [DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md) 裡。

### 效果對比

<table>
  <tr><th>關閉 Shader — Gambatte 原始輸出</th><th>開啟 Shader — DMG-01 Reference v1</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-off.png" alt="KPA 關閉 DMG-01 Shader 的俄羅斯方塊畫面"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-on.png" alt="KPA 開啟 DMG-01 Reference v1 的俄羅斯方塊畫面"></td>
  </tr>
</table>

兩張都是同一台 KPA、同一個 Gambatte core、同一份俄羅斯方塊 ROM、同樣的 viewport 和顯示狀態下拍的 960×640 framebuffer 截圖，但不是同一個模擬幀。而且靜態圖本來就沒辦法完整呈現拖影的衰減過程。

## 可下載物理種子：Nintendo GBA SP AGS-101

<table>
  <tr><th>關閉 Shader — 模擬器原始輸出</th><th>開啟 Shader — AGS-101 物理原型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="關閉 AGS-101 Shader 的 GBA 瑪利歐畫面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="開啟 AGS-101 物理原型的 GBA 瑪利歐畫面"></td>
  </tr>
</table>

現在可以直接下載並使用
[`physics-seed-v1`](models/nintendo-ags-101/presets/physics-seed-v1.slangp)。
它把 BGR 像素開口、TFT 的 gray-to-gray 響應和慢速殘留直流分開處理，色彩端
使用中性 sRGB adapter，因此不包含私有研究原型裡那些未確認再散布授權的 HCS
EOTF 表、色彩矩陣與黑白位量測值。

目前仍沒有量到具名 AGS-101 面板的完整 gray-to-gray matrix，所以時間參數是
可重現、受文獻約束的候選值，不是面板實測值。完整資料邊界見
[AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

遊戲畫面只是拿來說明 Shader 的行為。俄羅斯方塊、瑪利歐、Nintendo 商標和遊戲內容都屬於各自的權利人。

## 下載

- 穩定版 v0.3.0：[固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.3.0.zip)
- 發布說明：[GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- 最新開發版：[`main` 的 ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git：`git clone https://github.com/JohnnySun/retro-display-lab.git`

## 安裝到 RetroArch

1. 把專案解壓或 clone 到 `RetroArch/shaders/retro-display-lab`。
2. 切到 Vulkan video driver，target profile 有要求的話就開整數縮放。
3. 關掉模擬器 core 自己的 frame mixing，不然時間響應會被模擬兩次。
4. 載入和你的裝置相符的 target profile 底下的 `.slangp`。

我手上測過的 KONKR GT78-VN，對應的是這一份：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

同一台裝置的 GBA 內容請載入：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-physics-seed-v1.slangp
```

這個 profile 在 960×640 的面板上放一個 640×576 的 DMG viewport，剛好是 4 倍整數縮放。它的顯示狀態是「**sRGB-neutral、未量測**」，跟儀器校準過的 sRGB 不是同一件事。其他面板請從 model preset 出發，自己建一份 target profile。詳細步驟見[安裝說明](docs/installation.md)。

## 重現與驗證

```sh
npm test
```

檢查範圍包括 Shader 與 preset 結構、Reference ID、色階順序、STN／TFT 響應
錨點、1994 年回歸、residual-DC 積分、target scale、HCS 禁止常數，以及未量測
顯示狀態有沒有被誠實揭露。要送 PR 的話請照[引用規範](docs/reference-policy.md)
和[貢獻指南](CONTRIBUTING.md)來。學術或技術用途請引用
[`CITATION.cff`](CITATION.cff)，並附上實際使用機制所對應的機型 Reference。

## 授權

專案的原創程式碼和文件採用 Apache-2.0。第三方來源各自維持原本的條款：BGB 圖片、商業 ROM，還有未獲授權的 HCS Shader／資料檔，這裡都不會再散布。
