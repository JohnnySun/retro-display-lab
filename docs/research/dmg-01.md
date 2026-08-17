# DMG-01 反射式 LCD shader 模型

更新日期：2026-08-18

## 目標

這套 shader 的目標不是把畫面「染成綠色」，而是重建初代 Game Boy DMG-01 的五個光學狀態、慢速液晶轉換、被動矩陣串擾、矩形點陣與反射層陰影。首個 target profile 是 KPA：GB 內容以 `160×144 → 640×576` 精確 4 倍整數縮放顯示，周圍仍由既有 GB overlay 補滿。

程式碼源於 KPA 專案的原始實作，現已拆成裝置無關模型與獨立 target profile。BGB 網站只用作公開量測方法、參考圖片與行為描述；專案沒有收錄 BGB 程式碼或圖片素材。

## 四個邏輯灰階與五個光學狀態

Game Boy 的畫面資料是 2-bit，因此遊戲只有 shade 0、1、2、3 四個邏輯灰階。BGB 色票多出來的第五格是 LCD 未驅動時的反射底色；它用於像素間隙與面板背景，不是可由遊戲指定的 shade 4。機身 contrast wheel 會改變四個驅動灰階的光學映射，也不會新增邏輯灰階。

BGB 的 `dmg-reality-colorscheme.png` 中央色塊是已校正到 sRGB gamma 2.2 的五個狀態。逐色塊取樣如下：

| 狀態 | sRGB 8-bit | Hex | shader 狀態值 |
| --- | --- | --- | --- |
| LCD 未驅動／點間背景 | 148, 138, 4 | `#948A04` | 0.00 |
| Game Boy shade 0 | 117, 152, 51 | `#759833` | 0.25 |
| Game Boy shade 1 | 88, 143, 81 | `#588F51` | 0.50 |
| Game Boy shade 2 | 59, 117, 96 | `#3B7560` | 0.75 |
| Game Boy shade 3 | 46, 97, 90 | `#2E615A` | 1.00 |

Pass 2 先把 sRGB 解碼成線性光，再在相鄰狀態之間插值，最後重新編碼成 sRGB。這保留 BGB 所描述的「沿五色漸層移動」，避免直接在兩個端點色之間做不正確的畫面平均。

## 三個 pass

1. `dmg01-response-v1.slang`
   - 將 Gambatte 的四個灰階量化到 0.25、0.50、0.75、1.00。
   - 使用 `PassFeedback0` 遞迴保存三個液晶狀態：主響應、結構慢尾、離子殘像。它不是固定混合幾張舊 frame，而是三個 IIR 狀態對整段過去歷史做指數加權壓縮。
   - 變黑與恢復透明使用不同反應率；預設恢復較慢，因此移動後會留下暗尾跡。
   - Reference 的結構慢尾占 8%；另以每像素離散積分器保存正規化驅動電壓造成的離子狀態。預設充電時間常數約 299 秒、釋放時間常數約 59.8 秒，因此短暫移動不會立刻得到完整殘像，靜態圖案停留數分鐘後才逐步接近飽和。
   - 中間灰階轉換可由 `GrayDrag` 額外減速；端點 0↔3 不套此項，避免破壞基準響應時間。
   - 首幀直接初始化成當前畫面，避免載入遊戲時由全黑／全透明漸入。
2. `dmg01-matrix-v1.slang`
   - 在 `160×144` 原始解析度估算同列與同行電極負載。
   - 將少量列／行平均混回目前像素，模擬被動矩陣 crosstalk 帶來的對比下降與圖樣相依灰霧。
   - 固定線差與低頻 panel mottle 預設關閉，只在 Aged profile 啟用。
3. `dmg01-display-v1.slang`
   - 在 viewport 解析度重建矩形 aperture；4 倍整數縮放時每個 GB 像素正好占 `4×4` host pixels。
   - BGB close-up 的節距是 `80×80` 參考像素、有效 aperture 是 `70×70`、水平與垂直未驅動線各 `10 px`，因此一維填充率為 `0.875`。KPA 上等效間隙只有 `0.5 host pixel`，shader 會積分矩形 aperture 與 host-pixel footprint 的重疊面積，避免中心點取樣把格線消掉。
   - aperture 之外使用 LCD 未驅動色，不拿 shade 0 冒充點間背景。
   - 以偏移遮罩模擬液晶層投到後方 reflector 的陰影。
   - 提供 contrast wheel、偏壓與可選的老化偏色。
   - KPA 的 LCD 本身會發光，與被環境光照亮的反射式 DMG 不同；KPA target preset 在最後以線性光 `0.68` 補償主機亮度。這是目標顯示器補償，不修改五色之間的相對量測關係；裝置無關的 model reference 維持 `1.00`。
   - KPA 實際截圖的 shade 0 aperture 中央是 `97,127,42`，BGB 校正實拍的對應區域平均約 `96.5,119.2,54.2`；KPA target preset 因此使用 `ScreenChroma=0.90`，降低黃綠飽和度，但不改四階順序；裝置無關 preset 維持 `1.00`。

## 時間響應推導

DMG 是反射式被動矩陣 STN，不是 TFT。線性化的 nematic director 動力學給出：

- `τoff ∝ γ₁ d² / (κ π²)`
- `τon ∝ γ₁ d² / (ΔεE² − κ π²)`

其中 `γ₁` 是旋轉黏滯係數、`d` 是 cell gap、`κ` 是 Frank 彈性常數組合，`E` 是有效驅動場。這支持三件事：響應時間隨 cell gap 平方和黏度上升；溫度降低會因黏度增加而變慢；高於臨界值的驅動可以讓加深比無場彈性恢復更快。

1999 年大日本油墨化學的 STN 材料回顧記錄，傳統 STN 約 `300 ms`，後來低黏度、高雙折射材料才把它改善到 `120–130 ms`。1988 年 Citizen 的 270° STN 實驗進一步顯示，response time 會隨 multiplex duty、cell gap、黏度與 hysteresis 大幅變化；即使特別開發的 4 µm、1/200 duty 高速 STN，也只是把 `(ton+toff)/2` 做到約 `80 ms`，並不代表其後沒有剩餘鬆弛。

短期光學 response 和長期 image sticking 也不是同一件事。1994 年 Merck Japan 的 STN 實驗先讓 ON／OFF 圖案維持 30 分鐘，再把全部電極切換成共同的 35 Hz 正弦波，仍能量到可見的殘留圖案；殘像強度和液晶中的離子導電異向性及黏度相關。這支持在主響應之外加入「停留越久才越明顯、釋放也更慢」的小幅狀態，而不是把每一個移動 frame 都等量拖成幾十秒。

論文 Table 1 的 11 組混合物可重算出：

`sticking ΔV ≈ 7.390426 × ((Δσ/σ⊥)/η) − 0.186987`，`R² ≈ 0.746`

這與論文 Fig. 4 標示的 `R=0.86`、`R²=0.75` 一致。Reference 使用樣本中間附近的材料指標 `0.050`，預測 30 分鐘後 sticking range 約 `0.183 V`。但 `ΔV` 是「殘像仍可見的共同正弦波電壓範圍」，不是透射率；shader 因此把 `StickingOpticalGain=0.082` 明列為尚待 DMG 實機校準的電壓→光學橋接值，而不是冒充論文量測。

DMG 在 1989 年已使用 Sharp `LH5076/LH5077` 列／行驅動器與約 `-19 V` LCD bias，但目前找不到 panel 液晶配方、cell gap、逐階 RMS 電壓、離子濃度或指定溫度 waveform，因此不能從技術名稱唯一算出某一台 DMG 的精確曲線。

Reference 仍把主體約 `300 ms` 拆成加深 `100 ms`、褪去 `201 ms` 的 10→90% 端點響應，但不把 90% 誤當成完全恢復。在 DMG `59.7275 Hz` 下，主極點係數與組合結果如下：

| 方向 | 每幀係數 | 90% 所需幀數 | 10→90% 時間 |
| --- | ---: | ---: | ---: |
| shade 0 → shade 3（加深） | 0.42 | 6 | 約 100 ms |
| shade 3 → shade 0（褪去，僅結構） | 0.23 | 12 | 約 201 ms |

在一個像素已經長時間停留於 shade 3、接著切回 shade 0 的保守最壞條件下，剩餘對比為：

| 切換後時間 | 尚未恢復的對比 |
| ---: | ---: |
| 201 ms | 約 10.3% |
| 217 ms | 約 9.1% |
| 502 ms | 約 3.7% |
| 1.00 s | 約 2.3% |
| 2.01 s | 約 1.9% |
| 10.05 s | 約 1.7% |
| 60.0 s | 約 0.7% |
| 120 s | 約 0.3% |

前 1–2 秒主要是 director／結構慢尾；更後面的低幅度部分代表 exposure-dependent image sticking。表格採用論文 protocol 的 30 分鐘飽和前置條件；此時積分器到達約 99.76%，完整殘留約占黑白對比 2%。若像素只短暫經過一兩幀，離子狀態幾乎不會累積。整個模型仍是因果的：不存在物體前方的「未來殘影」；物體後方的殘留按多時間常數指數曲線下降。

Pass 2 額外提供診斷顯示：`DebugView=1` 顯示目前四階正規化驅動電壓，`2` 顯示每像素離子積分值，`3` 顯示「積分值高於目前電壓」的實際殘留圖案。`merck-1994-debug-v1` 把積分時間加速 60 倍，30 秒等效論文的 30 分鐘，僅供實驗重播；日常 Reference 維持真實時間 `1×`。

這套設計刻意沒有使用空間 Gaussian blur。DMG 的拖影是時間響應，串擾是列／行驅動問題；把兩者都做成一般模糊會讓靜止畫面也失焦。

## 預設

- `reference-v1`：預設。含五個光學狀態、方向相依主響應、8% 結構慢尾、1994 實驗回歸約束的每像素離子積分器、低強度串擾、點陣與反射陰影；不加入特定舊機才有的污斑或線差。
- `merck-1994-debug-v1`：60× 加速實驗重播，直接顯示殘留電位圖；不是日常遊戲畫面 preset。
- `heavy-ghosting-v1`：較冷／較慢面板的候選，適合檢查利用殘影的遊戲場景。
- `aged-v1`：展示明顯老化個體；增加固定線差、低頻污斑、對比衰退與偏色，不應被當作每一台 DMG 的標準狀態。

## 量測邊界

- BGB 公開資料足以支持五色、五色間連續轉換、frame blend、contrast wheel 與點陣背景的模型方向。
- BGB 也明確表示 close-up 點陣圖是理想化近似，像素邊寬與陰影並非完整儀器量測，因此 `PixelFill`、edge softness 與 shadow 仍是視覺候選值。
- 尚未找到可可靠套用到 DMG-01 的原廠 transition waveform、逐灰階 rise/fall 或指定溫度響應資料。三個 preset 的時間常數是可重現的 A/B 候選，不宣稱是單一真機的精密量測。
- 被動矩陣文獻支持非選取列／行會受影響並降低對比，但本 shader 用稀疏取樣近似全列／全行負載，以配合行動 GPU 預算。
- 實體 DMG 的拖影會隨面板個體、溫度、contrast wheel 與老化而變化；「Reference」代表保守基準，不代表所有保存至今的 DMG。

## 來源

- BGB DMG reality：https://bgb.bircd.org/reality/index.html
- BGB 五色參考圖：https://bgb.bircd.org/reality/dmg-reality-colorscheme.png
- BGB frame-blend blur 圖：https://bgb.bircd.org/reality/dmgblend-blur.png
- BGB frame-blend shade 圖：https://bgb.bircd.org/reality/dmgblend-shades.png
- BGB 理想化 close-up：https://bgb.bircd.org/reality/dmglcd-closeup.png
- Sharp passive/active matrix application note：https://eclass.hmu.gr/modules/document/file.php/EE315/AN-002_Passive_and_Active_Matrix.pdf
- 1992 SID passive-matrix response/crosstalk paper：https://sid.onlinelibrary.wiley.com/doi/full/10.1002/j.2637-496X.1992.tb06185.x
- LCD response and temperature：https://saemobilus.sae.org/papers/highly-multiplexed-dot-matrix-lcd-suitable-wide-temperature-range-930546
- M. Schadt, Liquid crystal materials and liquid crystal displays, Annual Review of Materials Science 27 (1997)：https://web.mit.edu/daigohji/Public/342/LiqCrys_Mats_Displays_1997.pdf
- H. Takatsu, Development and Industrialization of Liquid Crystalline Tolans (1999)：https://www.jstage.jst.go.jp/article/yukigoseikyokaishi1943/57/7/57_7_629/_pdf
- K. Okada et al., High Response Speed Supertwisted LCD (1988)：https://www.jstage.jst.go.jp/article/itej1978/42/10/42_10_1022/_pdf
- Y. Nakazono et al., Relationship between Image Sticking of STN LCD and Physical Properties of Liquid Crystal (1994)：https://doi.org/10.11538/ekitouyokou.20.0_374
- Game Boy Hardware Database（Sharp LH5076/LH5077 與 LCD revisions）：https://gbhwdb.gekkio.fi/consoles/dmg/

## 調整順序

使用 KPA profile 時，先固定其中性顯示模式、讓 Gambatte 關閉 colorization／額外 frame mixing、RetroArch 使用 Vulkan 與 4 倍整數縮放，再依序調整：

1. `Contrast`／`ContrastBias`：先對靜止四階灰圖。
2. `DarkenResponse`／`ClearResponse`／`SlowTail`：用高速橫移黑白邊與已知利用殘影的遊戲。
3. `RowCrosstalk`／`ColumnCrosstalk`：用棋盤、直條、橫條測試圖。
4. `PixelFill`／`PixelEdge`／shadow：最後以 KPA 實際 `640×576` 遊戲視窗調整。

Reference 的 `PixelFill=0.875` 直接取自 BGB close-up 的 `70/80` 比例。最初的 0.76 讓 LCD 未驅動 gap 佔比過高，造成 KPA 畫面平均值比 BGB 實機照片更亮、更黃；後來的 0.84 搭配中心點 smoothstep 又會在 4× 輸出抹掉半像素格線。現在改用 box coverage，同時保留量測比例與可見的次像素格線。

不要用靜止選單判斷拖影，也不要同時開 Gambatte `Mix Frames`，否則會重複時間混合。
