# Retro Display Lab

[English](README.md) | **繁體中文** | [简体中文](README.zh-cn.md)

給 RetroArch 用的掌機 LCD Shader，從物理模型到資料出處都寫清楚。

大多數懷舊螢幕 Shader 從顏色開始，也在顏色結束。這樣能讓截圖看起來有點像，卻重建不了螢幕本身：方塊落下時拖過後方列線的殘影、不同灰階轉換各自的速度、被動矩陣某一條線對鄰近像素驅動的影響，或靜態畫面消失後留下的微弱電氣記憶。

Retro Display Lab 把這些行為做成有因果關係的面板模擬。DMG-01 從被動矩陣驅動一路算到 STN 指向矢動力學、行列串擾、慢速離子狀態與反射式像素結構；AGS-101 則從量測色彩出發，接上 TFT gray-to-gray 響應、交替驅動與 residual DC、scan／latch／optical timing，以及 BGR 子像素開口。這些不是疊在調色盤上的裝飾性拖影；畫面來自會隨原始面板驅動持續演化的狀態。

## 這個模型實際在做什麼

Color Tint 只能改顏色，固定混合前幾幀也只是加上一種通用模糊。這裡保存的是每個像素真正需要的電氣與光學狀態：

- 輸入色碼會先變成面板驅動與光學目標，最後才轉成現代螢幕的顏色；
- 響應沿著完整的畫面歷史持續演化，加深、褪去與各種 gray-to-gray 轉換都可以走不同路徑；
- 被動矩陣的 loading／crosstalk 和 STN 響應分開求解；TFT 的驅動極性與 residual DC 也有各自的持久狀態；
- 掃描位置、latch 時間、光學 onset、像素開口、反射層陰影與 BGR 子像素，都是模型本身的一部分，不是最後再貼上去的材質；
- 原始面板的物理，和針對現代目標螢幕做的補償，兩件事分開處理。

因此目前兩套 normal preset 從頭到尾都走物理模型。不過這不代表每個常數都是從全新原機直接量到的；找不到原始驅動波形或響應矩陣時，模型會採用受文獻約束的重建值，並把這件事明確寫出來。

把成果稱為「**物理啟發、測量約束的重建**」是刻意保守的說法。如果找不到原面板的驅動波形或響應矩陣，就把文獻約束、候選值和不確定性一併公開，而不是把推導出來的數字包裝成實測值。細節見[方法論](docs/methodology.md)、[引用規範](docs/reference-policy.md)和[完整 Reference 索引](REFERENCES.md)。

## 可下載模型：Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建初代 Game Boy 那塊反射式被動矩陣 STN LCD：

- 遊戲可以指定的四個灰階，加上 LCD 未驅動時獨立的光學底色；
- 由 Game Boy 精確掃描時序驅動的 mobile surrogate，依序重建 RMS drive、STN 指向矢動力學與反射光學響應；
- 行列電極 loading、局部被動矩陣 crosstalk，以及會保住相鄰邏輯色階的有界 common-mode 修正；
- 非對稱灰階轉換，以及受同時代 STN 量測約束的逐像素離子殘像；
- 依據公開 DMG 近拍資料建立的矩形像素開口與反射層陰影；
- Reference、重拖影、老化個體，以及加速實驗用的 preset。

哪一筆資料對應到哪一段程式碼、有哪些限制，都寫在 [DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md) 裡。目前的機器可讀重建決策與後續實作工作，分別記錄在 [`reconstruction-v1.json`](models/nintendo-dmg-01/data/reconstruction-v1.json) 和 [implementation to-do](models/nintendo-dmg-01/IMPLEMENTATION-TODO.md)。

### 效果對比

<table>
  <tr><th>關閉 Shader — Gambatte 原始輸出</th><th>開啟 Shader — DMG-01 Reference v1</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-off.png" alt="KPA 關閉 DMG-01 Shader 的俄羅斯方塊畫面"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-on.png" alt="KPA 開啟 DMG-01 Reference v1 的俄羅斯方塊畫面"></td>
  </tr>
</table>

兩張都是同一台 KPA、同一個 Gambatte core、同一份俄羅斯方塊 ROM、同樣的 viewport 和顯示狀態下拍的 960×640 framebuffer 截圖，但不是同一個模擬幀。而且靜態圖本來就沒辦法完整呈現拖影的衰減過程。

## 可下載模型：Nintendo GBA SP AGS-101

<table>
  <tr><th>關閉 Shader — 模擬器原始輸出</th><th>開啟 Shader — AGS-101 物理模型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="關閉 AGS-101 Shader 的 GBA 瑪利歐畫面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="開啟 AGS-101 物理模型的 GBA 瑪利歐畫面"></td>
  </tr>
</table>

Preset 名稱仍然是
[`physics-seed-v1`](models/nintendo-ags-101/presets/physics-seed-v1.slangp)，
不過原先規劃的五個物理 workstream 現在都已經實作完成。兩個 pass 會一起處理：

- 從固定版本的 HCS AGS-101 量測紀錄，可重現地推導 32 階 EOTF、原生色彩矩陣與黑白錨點；
- 連續的逐子像素 TFT gray-to-gray 狀態，以及可直接接收未來實測轉換資料的 deterministic table 路徑；
- 交替驅動極性，以及使用已發表 adsorption／desorption kinetics 的慢速 residual-DC 殘像；
- 精確的 GBA row timing，拆成 row start、電氣 latch 與 optical onset，跨 frame 的事件仍維持因果關係；
- 解析式 BGR 像素開口，最後再接上量測得到的 native-to-host 色彩轉換。

目前仍沒有該 AGS-101 的完整 gray-to-gray matrix 或主機板時序 trace，因此 default 使用文件中列明的解析模型與同時代文獻候選值；measured-table 與診斷路徑則保留給更好的證據。中性 sRGB adapter 也仍作為回歸基準。完整分類與限制見 [AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

遊戲畫面只是拿來說明 Shader 的行為。俄羅斯方塊、瑪利歐、Nintendo 商標和遊戲內容都屬於各自的權利人。

## 下載

- 穩定版 v0.4.0：[固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.4.0.zip)
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

DMG profile 會在面板上放一個 640×576 的 viewport，剛好是 4 倍整數縮放；AGS-101 profile 則把 240×160 原始畫面以 4 倍填滿同一塊 960×640 面板。這個 target 的顯示狀態是「**sRGB-neutral、未量測**」，跟儀器校準過的 sRGB 不是同一件事。其他面板請從 model preset 出發，自己建一份 target profile。詳細步驟見[安裝說明](docs/installation.md)。

## 重現與驗證

```sh
npm test
```

檢查範圍包括 Shader／preset 結構、生成檔的可重現性、Reference ID、色階順序、
STN surrogate 與 crosstalk gate、TFT gray-to-gray lookup／fallback、residual-DC
積分、scan event 因果性、target scale、HCS 色彩向量，以及未量測顯示狀態有沒有
被誠實揭露。要送 PR 的話請照[引用規範](docs/reference-policy.md)和
[貢獻指南](CONTRIBUTING.md)來。學術或技術用途請引用
[`CITATION.cff`](CITATION.cff)，並附上實際使用機制所對應的機型 Reference。

## 授權

專案的原創程式碼和文件採用 Apache-2.0。第三方來源各自維持原本的條款：BGB 圖片、商業 ROM，還有未獲授權的 HCS Shader／資料檔，這裡都不會再散布。
