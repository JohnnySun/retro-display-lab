# Retro Display Lab

[English](README.md) | **繁體中文** | [简体中文](README.zh-cn.md)

我寫了兩套給 RetroArch 使用的掌機 LCD Shader，分別用來還原初代
Game Boy，以及 GBA SP 後期背光版 AGS-101 的螢幕觀感。

我想做的並不是另一個「看起來有點復古」的濾鏡，而是從真實量測資料、
當年的研究文獻和螢幕工作原理出發，重新建立這兩塊液晶螢幕的顯示過程。

簡單來說，就是四個字：**先量，再算。**

## 為什麼只靠調色和混幀還不夠？

現在常見的懷舊掌機 Shader，很多都是先憑印象調出一種「老螢幕的顏色」，
再把前後幾幀混合起來，製造拖影效果。

這種方法可以做出懷舊氣氛，卻很容易走向不同的極端：有些把初代
Game Boy 調成非常鮮豔的綠色；另一些雖然灰暗復古，最後卻更像文曲星或
計算機上的液晶螢幕，而不是初代 Game Boy。

它們可能都有「老螢幕的感覺」，但那不一定是真正的 Game Boy。很多時候，
它們還原的是作者印象中的老螢幕，而不是某一塊原始面板實際如何顯示。

## 先看看初代 Game Boy 的效果

下面兩張圖都開啟了目前的 GB Shader。這裡沒有特意放 Shader 關閉時的
對比；你可以先直接看看它的顏色、螢幕質感和動態殘影，是不是接近你記憶裡
初代 Game Boy 的樣子。後面再解釋，這些效果為什麼不是靠記憶調出來的。

<table>
  <tr><th>標題首頁 — 串擾</th><th>方塊下落 — 拖影</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-crosstalk.png" alt="KONKR Pocket Advance 上的俄羅斯方塊標題首頁，呈現初代 Game Boy 行列串擾"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-ghosting.png" alt="KONKR Pocket Advance 上的俄羅斯方塊遊戲畫面，呈現初代 Game Boy 拖影"></td>
  </tr>
</table>

左邊的大面積高對比圖形能看出行列像素之間的互相影響；右邊抓到直條方塊
下落的一刻，後方的垂直尾巴把液晶的時間響應直接顯示出來。這些不是在畫面
最後加上的模糊，而是由持續變化的螢幕狀態演算出來的。

## 第一步：先把顏色量清楚

如果想還原一塊特定的螢幕，第一件事不是打開調色工具，而是先弄清楚它原本
到底是什麼顏色。

Retro Display Lab 使用實際量測和經過色彩管理的參考資料，重建原始螢幕的
色彩、灰階與黑白錨點，再把結果正確映射到標準 sRGB。初代 Game Boy 不只是
「四種綠色」：除了遊戲能控制的四個灰階，LCD 未驅動時的螢幕底色也是獨立的
光學狀態。AGS-101 也有自己的黑位、灰階關係和原生色彩，不能只靠降低飽和度
來代替。

這裡所說的校色，是指 Shader 的輸出依據量測資料對準 sRGB。只要觀看設備
本身經過妥善校準，結果就能接近模型所重建的原始螢幕色彩；如果顯示器本身
嚴重偏色，Shader 當然無法替那塊硬體自動完成校準。

## 第二步：計算螢幕如何反應

真正的液晶螢幕不會把前後幾張完整畫面混在一起。你可以把每個液晶像素想像
成一扇很小的百葉窗：電訊號改變後，它需要時間才能移動到新的位置，而且從亮
變暗和從暗變亮，速度也不一定相同。

因此，遊戲輸出的色碼會先轉換成模擬的面板驅動，再由
**基於物理模型的演算法**計算每個虛擬液晶像素接下來如何變化。每個像素都會保留之前的狀態；
新的畫面出現後，演算法會根據驅動、液晶材料、掃描位置和歷史狀態，算出下一刻
實際能顯示到哪裡。

這不是用實體方式重建一塊螢幕，而是把螢幕的物理原理做成可以在 GPU 上即時
運行的演算法。拖影、串擾和殘像因此是模型算出的結果，不是最後貼上去的特效。

## 初代 Game Boy：反射式被動矩陣 LCD

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) 重建初代 Game Boy 的
反射式被動矩陣 STN LCD：

- 四個遊戲灰階，以及 LCD 未驅動時獨立的光學底色；
- 精確的 Game Boy 掃描時序、等效電氣驅動、STN 液晶反應與反射光學；
- 行列電極 loading 和局部串擾，而不是一般的空間模糊；
- 亮暗方向不同的灰階轉換，以及逐像素、慢速的離子殘像；
- 矩形像素開口、未驅動間隙與反射層陰影；
- Reference、重拖影、老化個體與加速實驗用 preset。

每一筆資料如何進入程式碼、哪些是直接量測、哪些是文獻約束的重建，都寫在
[DMG-01 Evidence Map](models/nintendo-dmg-01/REFERENCES.md)。機器可讀的決策與
實作紀錄則放在 [`reconstruction-v1.json`](models/nintendo-dmg-01/data/reconstruction-v1.json)
和 [implementation to-do](models/nintendo-dmg-01/IMPLEMENTATION-TODO.md)。

## GBA SP AGS-101：另一套完全不同的模型

GBA SP 後期的 AGS-101 使用背光 TFT LCD，和初代 Game Boy 不是同一種技術。
它反應更快，但不同顏色、不同明暗之間的切換速度仍然不完全相同，畫面掃描、
驅動狀態和 BGR 子像素排列也會影響最後的觀感。

所以我沒有把 GB 的拖影直接套到 GBA SP 上，而是為 AGS-101 單獨建立了色彩、
電氣、時間響應和像素結構模型。

<table>
  <tr><th>關閉 Shader — 模擬器原始輸出</th><th>開啟 Shader — AGS-101 模型</th></tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="關閉 AGS-101 Shader 的 GBA 瑪利歐畫面"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="開啟 AGS-101 模型的 GBA 瑪利歐畫面"></td>
  </tr>
</table>

兩邊的差別不只是飽和度或亮度。模型會一起處理從量測資料推導的 32 階色彩
響應與黑白錨點、逐子像素 TFT gray-to-gray 狀態、交替驅動與慢速 residual-DC
殘像、GBA 掃描／latch／光學 onset 時間，以及最後的 BGR 像素開口。

目前仍沒有該 AGS-101 的完整 gray-to-gray matrix 或主機板時序 trace，預設值
因此採用文件中列明的解析模型和同年代文獻候選範圍；未來若有更好的量測資料，
也已經保留 deterministic measured-table 路徑。詳細分類與限制見
[AGS-101 Evidence Map](models/nintendo-ags-101/REFERENCES.md)。

## 模型裡的資料從哪裡來？

專案採用可取得的面板量測、經色彩管理的原始螢幕參考，以及初代 GB 與
AGS-101 的驅動與時序資料，也查閱同年代相似面板和液晶材料的研究結果。
找不到完整原始資料時，就用年代與
技術相符的文獻限制合理範圍，並公開候選值和不確定性，而不是把推導值包裝成
原機實測。

因此，最準確的定位是「**以物理模型為基礎、受量測與文獻約束的重建**」。
完整原則見[方法論](docs/methodology.md)、[引用規範](docs/reference-policy.md)和
[Reference 索引](REFERENCES.md)。

## 圖片在哪裡運行？

本文圖片都在 **KONKR Pocket Advance（GT78-VN）** 上使用 RetroArch 即時渲染，
再從它的 **960×640 framebuffer** 直接擷取：

- GBA 的 240×160 畫面以精確 4 倍映射填滿 960×640；
- GB 的 160×144 畫面以精確 4 倍映射到 640×576 viewport，周圍再放置外框。

這些是掌機 GPU 的實際輸出，不是用相機拍攝實體面板。指定的 KONKR 參考機現已建立
SpyderX 實測 host profile；它仍是單台參考機的機型預設，不能宣稱每片 GT78-VN 面板
都有完全相同的發光色度。

遊戲畫面只用來說明 Shader 行為。俄羅斯方塊、瑪利歐、Nintendo 商標和遊戲
內容都屬於各自的權利人。

## 下載

- 穩定版 v0.6.0：[固定 tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.6.0.zip)
- 發布說明：[GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- 最新開發版：[`main` 的 ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git：`git clone https://github.com/JohnnySun/retro-display-lab.git`

## 安裝到 RetroArch

1. 把專案解壓或 clone 到 `RetroArch/shaders/retro-display-lab`。
2. 切換到 Vulkan video driver；target profile 有要求時開啟整數縮放。
3. 關閉模擬器 core 自帶的 frame mixing，否則時間響應會被重複計算。
4. 載入與裝置相符的 target profile `.slangp`。

我實際測過的 KONKR GT78-VN 請使用：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

同一台裝置的 GBA 內容請使用：

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-v1.slangp
```

以上 preset 假設 Android-system 實測 profile 已啟用，本身不再疊加 KPA 校正。若要改用
RetroArch 的實測 65^3 KPA 螢幕顏色校正，先在 Display Switcher 切到 `retroarch-local`
（Gamma 7、neutral PQ、SurfaceFlinger identity），再載入檔名以
`kpa-color-corrected.slangp` 結尾的對應 preset。兩個 host-correction layer 絕對不能同時啟用。
目前顏色校正 LUT 已通過 RetroArch/Vulkan framebuffer 與 CPU LUT 參考實作的比對，
仍待 RetroArch 實際發光的獨立光學驗證；詳見
[安裝說明](docs/installation.md)。

其他面板請從 model preset 出發建立自己的 target profile，不要把 KONKR 的補償
當成原始 GB 或 AGS-101 的特性。完整步驟見[安裝說明](docs/installation.md)。

## 重現、驗證與貢獻

```sh
npm test
```

測試會檢查 Shader／preset 結構、生成檔可重現性、Reference ID、色階順序、
STN surrogate、串擾、TFT gray-to-gray、residual-DC、掃描因果性、target scale、
HCS 色彩向量、KPA host LUT 完整性與互斥條件，以及量測／驗證邊界是否被誠實標示。

要送 PR 請先閱讀[引用規範](docs/reference-policy.md)和
[貢獻指南](CONTRIBUTING.md)。學術或技術用途請引用 [`CITATION.cff`](CITATION.cff)，
並附上實際使用機制所對應的機型 Reference。

## 授權

原創程式碼和文件採用 Apache-2.0。第三方來源維持各自條款；專案不會再散布
BGB 圖片、商業 ROM，或未獲授權的 HCS Shader／資料檔。
