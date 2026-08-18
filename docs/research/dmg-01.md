# DMG-01 反射式 LCD shader 模型

更新日期：2026-08-19

## 目標

這套 shader 的目標不是把畫面「染成綠色」，而是以現存 DMG 專屬資料為優先，再用同期 STN 量測補足缺口，儘可能重建健康新品狀態的初代 Game Boy DMG-01 觀感：五個光學狀態、慢速液晶轉換、被動矩陣串擾、矩形點陣與反射層陰影。它不是拿一片已老化四十年的面板當作新品真值。首個 target profile 是 KPA：GB 內容以 `160×144 → 640×576` 精確 4 倍整數縮放顯示，周圍仍由既有 GB overlay 補滿。

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

這項插值也可以直接用 BGB 公布的 `dmgblend-shades.png` 驗證。四段相鄰色階的中點取樣為 `(134,144,36)`、`(104,148,67)`、`(74,130,89)`、`(52,107,93)`；現行線性光插值的預測每通道只差 `0–1` 個 8-bit code。因此五態色彩與其間的連續變化是目前最強的 DMG-specific 校準錨點，不應被同期一般 STN 色彩假設取代。WS1 的 CIEDE2000 報告中，五態色票最大 `ΔE00=0`，四個漸層中點最大 `ΔE00=0.518042`，通過預先記錄的 `0.6` 門檻。

BGB 三張來源圖的 SHA-256、尺寸、零起算取樣座標與 aperture 邊界都記錄在 reconstruction record。專案不再散布來源圖片；下載原檔後可用 `node tools/build-dmg01-ws1.mjs --check --verify-sources <directory>` 完整重驗。生成的固定測試場景包含五態色票、連續漸層、四個邏輯灰階、contrast wheel 最小／預設／最大值，以及 4 倍 aperture 與像素間隙。

## 重建優先順序

1. DMG 專屬且有方法說明的資料直接控制 reference；BGB 五態校色與 motion 觀察屬此層。
2. DMG 缺失量才使用 1988–1994 年、條件可比較的 STN 實驗，並保留溫度、duty、cell gap、黏度與 response 定義。
3. 一般 nematic 論文只決定模型形狀。
4. 最後仍缺的數值才使用有界、可重算並明標 `experimental` 的 project bridge。

目前決策已整理在 [`models/nintendo-dmg-01/data/reconstruction-v1.json`](../../models/nintendo-dmg-01/data/reconstruction-v1.json)，後續實作順序見 [`models/nintendo-dmg-01/IMPLEMENTATION-TODO.md`](../../models/nintendo-dmg-01/IMPLEMENTATION-TODO.md)。
WS1 已於 2026-08-18 完成；固定場景與感知差異報告位於 [`generated/ws1-static-v1.png`](../../models/nintendo-dmg-01/generated/ws1-static-v1.png) 和 [`generated/ws1-perceptual-v1.json`](../../models/nintendo-dmg-01/generated/ws1-perceptual-v1.json)。這是 model-space sRGB 校準，不等同於 KPA 面板發光後的儀器色準。

## 三個 pass

1. `dmg01-response-v1.slang`
   - 將 Gambatte 的四個灰階量化到 0.25、0.50、0.75、1.00。
   - 使用 `PassFeedback0` 保存 director 座標、反射光學狀態、獨立 ionic charge，以及目前／起始 drive。普通拖影由 WS2 生成的物理 LUT 積分，不再使用手寫的 `100/200 ms`、slow tail 或 gray drag。
   - 使用 `OriginalHistory1` 取得上一個 core frame。只有像素真的改變時，才在該 source row 的 `CPL` line-end latch 把一幀分成「舊 drive」與「新 drive」兩段；未改變像素保持原本 WS2 單步更新，避免人造數值誤差。
   - 離子殘像沿用同一 row-latch 分段，但仍是獨立、低幅度、分鐘尺度的狀態，不參與製造普通移動拖影。
   - `TotalSubFrames != 1` 時不重複積分物理歷史，而是 fail closed 到當前靜態狀態。
   - 首幀直接初始化成當前畫面，避免載入遊戲時由全黑／全透明漸入。
   - WS5 先把同期 ITO、driver、cell RC 所造成的列／行電壓偏差化成連續 drive，再交給同一套 WS2 director／反射光學積分；串擾不是在最後把鄰近像素顏色混進來。
2. `dmg01-matrix-v1.slang`
   - WS2 的選取／未選取 RMS 已經包含被動矩陣 selection loss。
   - WS5 的列／行 taps 只負責取樣 pattern context；其係數由完整 `160×144` 分布式 RC 網路生成。normal preset 的 `RowCrosstalk=1`、`ColumnCrosstalk=1` 表示計算出的 nominal 強度，`0` 才是隔離診斷。
   - 固定線差與低頻 panel mottle 預設關閉，只在 Aged profile 啟用。
3. `dmg01-display-v1.slang`
   - 在 viewport 解析度重建矩形 aperture；4 倍整數縮放時每個 GB 像素正好占 `4×4` host pixels。
   - BGB 理想化 close-up 的節距是 `80×80` 參考像素、有效 aperture 是 `70×70`、水平與垂直未驅動線各 `10 px`，因此先以一維填充率 `0.875` 作為 reference-image seed；這不是實體像素量測。KPA 上等效間隙只有 `0.5 host pixel`，shader 會積分矩形 aperture 與 host-pixel footprint 的重疊面積，避免中心點取樣把格線消掉。
   - aperture 之外使用 LCD 未驅動色，不拿 shade 0 冒充點間背景。
   - 以偏移遮罩模擬液晶層投到後方 reflector 的陰影。
   - 提供 contrast wheel、偏壓與可選的老化偏色。
   - KPA 的 LCD 本身會發光，與被環境光照亮的反射式 DMG 不同；KPA target preset 在最後以線性光 `0.68` 補償主機亮度。這是目標顯示器補償，不修改五色之間的相對量測關係；裝置無關的 model reference 維持 `1.00`。
   - KPA 實際截圖的 shade 0 aperture 中央是 `97,127,42`，BGB 校正實拍的對應區域平均約 `96.5,119.2,54.2`；KPA target preset 因此使用 `ScreenChroma=0.90`，降低黃綠飽和度，但不改四階順序；裝置無關 preset 維持 `1.00`。

## WS2：STN 物理重建

DMG 是反射式被動矩陣 STN，不是 TFT。線性化的 nematic director 動力學給出：

- `τoff ∝ γ₁ d² / (κ π²)`
- `τon ∝ γ₁ d² / (ΔεE² − κ π²)`

其中 `γ₁` 是旋轉黏滯係數、`d` 是 cell gap、`κ` 是 Frank 彈性常數組合，`E` 是有效驅動場。這支持三件事：響應時間隨 cell gap 平方和黏度上升；溫度降低會因黏度增加而變慢；高於臨界值的驅動可以讓加深比無場彈性恢復更快。

1999 年大日本油墨化學的 STN 材料回顧記錄，傳統 STN 約 `300 ms`，後來低黏度、高雙折射材料才把它改善到 `120–130 ms`。1988 年 Citizen 的 270° STN 實驗進一步顯示，response time 會隨 multiplex duty、cell gap、黏度與 hysteresis 大幅變化；即使特別開發的 4 µm、1/200 duty 高速 STN，也只是把 `(ton+toff)/2` 做到約 `80 ms`，並不代表其後沒有剩餘鬆弛。

短期光學 response 和長期 image sticking 也不是同一件事。1994 年 Merck Japan 的 STN 實驗先讓 ON／OFF 圖案維持 30 分鐘，再把全部電極切換成共同的 35 Hz 正弦波，仍能量到可見的殘留圖案；殘像強度和液晶中的離子導電異向性及黏度相關。這支持在主響應之外加入「停留越久才越明顯、釋放也更慢」的小幅狀態，而不是把每一個移動 frame 都等量拖成幾十秒。

論文 Table 1 的 11 組混合物可重算出：

`sticking ΔV ≈ 7.390426 × ((Δσ/σ⊥)/η) − 0.186987`，`R² ≈ 0.746`

這與論文 Fig. 4 標示的 `R=0.86`、`R²=0.75` 一致。Reference 使用樣本中間附近的材料指標 `0.050`，預測 30 分鐘後 sticking range 約 `0.183 V`。但 `ΔV` 是「殘像仍可見的共同正弦波電壓範圍」，不是透射率；shader 因此把 `StickingOpticalGain=0.082` 明列為尚待 DMG 實機校準的電壓→光學橋接值，而不是冒充論文量測。

DMG-LCD-06 電路圖確認了 IR3E02、Sharp `LH5076/LH5077`、V1–V5、`FR` 與 `CPG` 的連接。Thomas Spurden 的 DMG 邏輯擷取則量到每行約 `108.724 µs`，且未命名的 `c` 訊號每行穩定出現四個脈衝。結合兩者，WS2 把四灰階建模為三段 CPG dwell 的 `0、1/3、2/3、1` 選通能量占比；這是明標的電路拓撲推論，並非 LH5077 類比輸出的直接量測。

電氣層使用 Alt–Pleshko `1/144` multiplex。令 column 振幅為 `Vc`、選取 row 振幅為 `Vr=√144·Vc`，則每個 CPG dwell 都先算 `Vpixel(t)=Vrow(t)-Vcolumn(t)`，再以一幀 RMS 場驅動液晶。Nominal `Vns=1.82 V` 對應 `Vc≈1.344 V`、`Vr≈16.130 V`，四階 RMS 約為 `1.820、1.874、1.927、1.979 V`。絕對電壓仍是由 1988 STN threshold 與 DMG 約 `-19 V` rail 約束的區間；只有數位時序、driver 拓撲與 multiplex ratio 是 DMG-specific。

材料層不是單一猜值，而是三個 1988–1990 技術區間成員。Nominal 使用 `d=6 µm`、`Δn·d≈0.95 µm`，以及公開的 ZLI-2293 `γ₁=0.162 Pa·s`、`K11/K22/K33=12.5/7.2/17.9 pN`、`Δε=10` 作為已知參考混合物；fast／slow 成員改變 cell gap、黏度、彈性與介電範圍。它們不是「DMG 用了 ZLI-2293」的聲明，而是沒有可用未老化 DMG cell 時的年代材料 ensemble。

離線 solver 對 1D depth profile 積分含 `K11/K22/K33`、chiral pitch、介電耦合與 Rapini–Papoular anchoring 的 Frank–Oseen 自由能，再用忽略 inertia／backflow 的 overdamped Ericksen–Leslie reduction 更新 director。光學層把每一層 director 經 15 個可見光波長的 Jones matrix，往返通過前後 polarizer 與 reflector，產生反射 spectrum；BGB 五色只用來把物理光學座標校準到已量到的 DMG 觀感，不參與決定速度。

完整 solver 會在 STN 臨界電壓附近出現「先累積 director 變形、光學上幾乎不動，跨過臨界後快速翻轉」。雙指數擬合會抹掉這個特性，因此 Runtime 不再使用 `DarkenResponse`、`ClearResponse`、`SlowTail` 或 `GrayDrag`。Build 會從完整 trajectory 產生 65 格的「director 狀態 × 四階電壓」每幀 drift LUT；Shader 積分隱藏的 director 座標，再用另一張生成的 reflective optical LUT 輸出 BGB 光學狀態。途中改色仍從當前物理狀態繼續，不是重播固定的毫秒動畫。

`generated/ws2-stn-physics-v1.json` 記錄的驗收結果包括：固定場自由能無上升、零場自由能下降、時間步光學誤差約 `9.0×10⁻⁸`、17→21 depth grid 誤差約 `1.0×10⁻⁵`，以及 supported contrast envelope 上最壞 runtime-surrogate RMS 誤差約 `0.058`。Nominal shade 0→3 的 T90 約 `0.28 s`；接近 threshold 的 shade 0→1 可慢到約 `0.8 s`。這些是 solver 的輸出，不是先指定的輸入。舊 `100/200 ms` regression 仍留在版本化報告中供差異追蹤，但 normal Shader 完全不讀它。

短期 director response 與長期 image sticking 仍分開。WS4 用 1997 年的
完整壓測 protocol 補上時間尺度：6 µm 實驗 cell 在 60 °C 下承受 10 V DC
300 秒、短路 5 秒，再於開路恢復 600 秒；一般 polyimide 的 `ρ=10^15 Ω·cm`、
`εr=3` 對應 266 秒 RC，而十分鐘後 69.5% 的總離子電荷仍被判定為吸附。
因吸附量在 stress removal 時不可能大於 1，這先給出
`k_release ≤ -ln(0.695)/600 = 0.000606406 s⁻¹` 的年代上界。

2011 年直接動力學量測提供 `0.023–0.028 min⁻¹` 的慢釋放範圍；取中點
`0.0255 min⁻¹ = 0.000425 s⁻¹`，它通過前述獨立上界。再把這個 release rate
帶回 1997 年 300+600 秒 protocol，解出 formation rate
`0.00757258 s⁻¹`。所以 normal preset 的每幀係數
`charge=0.000126777389`、`release=0.000007115625` 是連續時間模型在
59.7275 Hz 的精確指數轉換，不是看畫面拍定。30 分鐘 exposure 約收斂到
`0.999999`，十分鐘 recovery 約保留 `0.7749`。

1994 STN regression 仍只決定材料 mobility 與殘像可見電壓的關係；
`StickingOpticalGain=0.082` 因缺少 pristine DMG 長曝 optical trace，仍明列為
低幅度橋接，最大 optical-state bias 約 `0.01497`。這個限制不能靠年代資料
完全消除，但也不會反過來污染已重建的 charge/release kinetics。整個模型
保持因果，不存在物體前方的未來殘影。

Pass 2 額外提供診斷顯示：`DebugView=1` 顯示目前四階正規化驅動電壓，`2` 顯示每像素離子積分值，`3` 顯示「積分值高於目前電壓」的實際殘留圖案，`5` 則以 R/G/B 原樣輸出 ionic charge／current drive／positive residual，供 framebuffer 數值驗證；`6` 顯示 WS5 串擾後的 effective drive，供 CPU／GPU 數值比對。`merck-1994-debug-v1` 把積分時間加速 60 倍，30 秒等效論文的 30 分鐘，僅供實驗重播；日常 Reference 維持真實時間 `1×`。

KONKR 實機以 RGBA32F feedback 跑 60× deterministic window scene：charge
收斂到 `0.9961`；驅動清零後 14 秒（等效 840 秒）從 `0.9922` 降到
`0.6863`，實測比 `0.69170`，理論比 `0.69977`，絕對差 `0.00807`。
未驅動控制半屏維持零，charge／release 都單調，三個 Vulkan pass 無編譯錯誤。

這套設計刻意沒有使用空間 Gaussian blur。DMG 的拖影是時間響應，串擾是列／行驅動問題；把兩者都做成一般模糊會讓靜止畫面也失焦。

## WS5：被動矩陣串擾的年代物理重建

原始 DMG 的 ITO 線阻、LCD driver 類比輸出阻抗、pixel cell capacitance 與
電極 mask 沒有留下可直接使用的完整規格；保存至今的面板又已老化，不能反推
健康新品值。因此 WS5 沒有拿照片調一個「看起來像」的混色比例，而是把同期
可量化的透明導電膜、driver、液晶電阻率與螢幕幾何資料放進同一個有界模型。

period ensemble 使用 `5/10/40 Ω/□` 的 ITO sheet resistance、
`11/20/30 kΩ` 的可比同期 driver output resistance，以及由 Nintendo 公布的
`47×43 mm` 畫面尺寸、`160×144` 點陣、BGB 理想化 fill seed、`4–7 µm`
cell gap 與同期介電常數推得的 `0.340/0.741/2.081 pF` pixel capacitance。
1989 液晶材料文獻給出的 `10¹¹ Ω·cm` 電阻率下限也進入 leakage bound；這些
資料限定 low／nominal／high 三組可重算範圍，但不代表 Nintendo 採用了其中
某個公開材料或 driver。

CPU reference 對 160 條 column 與 144 條 row 建立單端電阻梯形網路，在每個
crossing 放入 pixel capacitance 與 leakage，並重播 DMG 三段灰階 dwell；每段
`36.241 µs` 以 backward Euler 積分。為了避免把全畫面亮暗變化誤認成串擾，
每個位置都扣除同灰階 uniform-field baseline，所以常數場嚴格不變。求解器測試
single-dot、full-row、full-column、checkerboard、alternating-lines、window、
inverse-window 七種 pattern；high ensemble 的 8→16 substep checkerboard RMS
差為 `0.009790` shade。

完整網路再降階為「單次列／行轉換」與「連續兩列重複 loading」的 Shader
surrogate，作用在 WS2 的連續電壓／director 座標之前。nominal 網路對
surrogate 的 RMS 誤差為 `0.008997` shade、p99 為 `0.024016`；最壞值
`0.338495` 出現在稀疏 checkerboard 的遠端邊緣，已保留成明確限制而沒有藏掉。
`RowCrosstalk=1`、`ColumnCrosstalk=1` 選用這個 nominal 重建，兩者設成 `0`
則完全隔離 WS5。

KONKR 實機用 `DebugView=6` 逐一跑七個 deterministic ROM。CPU 預測與經過
RGBA8、RGB565 及 H.264 擷取後的 GPU 輸出，最大 pattern RMS 為
`1.359/255`、p99 為 `2.291/255`，分別通過 `8/255` 與 `20/255` 門檻；
response pass 仍使用 RGBA32F feedback，三個 Vulkan pass 都沒有編譯錯誤。
這證明 runtime 忠實執行所選降階模型，不等於聲稱已量到 Nintendo 原廠
Crosstalk 規格。

## WS3：逐列 CPL latch 與因果掃描

Nintendo Programming Manual 的 screen-timing 圖記錄 `160×144` 可見區、
10 條垂直 blanking line、每 line 約 `108.7 µs`、frame 約 `59.7 Hz`；`LY`
說明也明確把 `144–153` 定義成 VBlank。Thomas Spurden 在 DMG 主機 LCD
介面上的擷取進一步記錄：`S/VSYNC` rising 開始 frame、`ST/HSYNC` rising
開始 line、`LD0/LD1` 隨 `CP` 移入，完整 160 pixel 在 `CPL` rising 時鎖進
LCD driver，而且該事件就是 line end。

Runtime 因此不再假設全畫面同時變色。第 `y` 列的事件是：

`t_latch = (y + LatchOffsetLines) × T_frame / 154`

normal 使用有擷取依據的 `LatchOffsetLines=1`。第 0 列在約 `0.109 ms`
切換，第 143 列在約 `15.656 ms` 切換，後者仍保有十條 VBlank、約
`1.087 ms` 的新 drive 積分時間。像素未變時不切開一幀；像素有變時，
director 與 ionic charge 都先在舊 drive 下積分到 CPL，再在新 drive 下積分
至 frame end。`scanout-temporal-only-v1` 可完全停用 row split，以隔離 WS2
本體 response；`scanout-line-start-v1` 則只作 sub-line phase 下界診斷。

CPU 生成報告確認 144+10 timebase、manual/capture line-time 一致性、frame
partition、unchanged-pixel 等價，以及 shade 0→3 在一幀後呈現
top > middle > bottom 的新 drive 累積量。這重建的是 LCD 電氣 target 的
因果起點，不把 PPU mode timing 誤稱成額外的光學 dead time。

## WS7：前端時間契約與 KONKR 實機驗收

物理 feedback 的時間單位不是「Shader 被呼叫一次」而是正常前進時真正呈現
的一個 core frame。因此正式契約固定 `N=1`、Gambatte frame mixing 關閉、
rewind／run-ahead 關閉、fast-forward `1×`。若前端要求 `N>1` 合成 subframe，
response pass 直接輸出目前輸入，不把人工 subframe 偽裝成面板經歷的時間；
非單調時間也必須 reset history 或停用 temporal path。暫停時狀態凍結，不憑空
補算牆上時間。

KONKR 上三個 SurfaceFlinger 視窗量到 `60.248–60.291 fps`，沒有 25–40 ms
的雙倍 frame interval；五秒 moving-bar 錄影為 302 frames。四階靜態 ROM
透過 `DebugView=4` 顯示 raw optical state，與 CPU 生成 LUT 經 RGBA8／RGB565
量化後最大相差四個 code，低於六 code 門檻。Quick Menu 的 save/load、reset、
三秒 pause、focus loss/resume 與 Close Content 都有版本化收據；pause 前後
即時存檔 SHA-256 完全一致。這些證明指定前端路徑可安全承載模型，不把螢幕
截圖誤稱成原始 LCD 光學量測。

## WS6：縮放不變的像素開口與反射陰影

WS6 找到舊 box coverage 的兩個數值問題。第一，分數縮放時 host pixel 的
footprint 可能跨過 source cell 邊界，舊式只和「目前 cell」相交會丟掉繞到
相鄰 pitch 的部分；第二，把已平均的 pixel mask 與 shadow mask 相乘，並不
等於先算兩者交集再平均，因此陰影能量會隨 4×／5×／6× 改變。

現在 Shader 會積分前一個、目前、下一個週期開口，並解析計算 active aperture
與位移後 shadow aperture 的 joint coverage；陰影只從未驅動 gap 的覆蓋量扣除。
選定的 `PixelFill=0.875` 因而在所有測試尺度保持面積 `0.765625`，位移陰影的
gap 面積保持 `0.191875`。CPU 測試涵蓋 4×、5×、6×、3.5×、3.75×、4.25×、
viewport 位移、crop、邊與角；最大面積誤差 `1×10⁻¹²`。KONKR 以正式 Vulkan
路徑比較 640×576 的 4× 與 560×504 的 3.5×，平均 linear RGB 最大差
`0.00144461`，通過 `0.002` 門檻。這只證明所選幾何的積分正確；BGB 的
`70/80` 與 shadow offset 仍是理想化參考，不是 DMG 顯微尺寸量測。

## 預設

- `reference-v1`：預設。20 °C、nominal drive；含生成的 STN director／反射光學 LUT、獨立 ionic state、點陣與反射陰影，不加入特定舊機污斑。
- `scanout-temporal-only-v1`：關閉逐列 CPL split，只保留相同 WS2 物理 response 的對照組。
- `scanout-line-start-v1`：把 latch 移到 line start 的 phase 下界診斷；normal 仍使用捕捉到的 line-end CPL。
- `plausible-fast-v1`：同一物理 LUT 的 30 °C 暖機診斷；不是 DMG revision。
- `plausible-slow-v1`：同一物理 LUT 的 10 °C 冷機診斷；不是 DMG revision。
- `merck-1994-debug-v1`：60× 加速實驗重播，直接顯示殘留電位圖；不是日常遊戲畫面 preset。
- `ws4-numeric-retention-v1`：60× GPU 數值驗證；R/G/B 分別是 ionic charge、current drive、positive residual，不是遊戲外觀。
- `ws5-crosstalk-off-v1`：把列／行 loading 都設為零，只隔離 WS5；WS2 selection loss 與其他物理機制仍保留。
- `ws5-numeric-drive-v1`：以 `DebugView=6` 輸出串擾後 effective drive，供七場景 CPU／GPU 數值驗證，不是遊戲外觀。
- `heavy-ghosting-v1`：較冷／較慢面板的候選，適合檢查利用殘影的遊戲場景。
- `aged-v1`：展示明顯老化個體；增加固定線差、低頻污斑、對比衰退與偏色，不應被當作每一台 DMG 的標準狀態。

## 量測邊界

- BGB 公開資料足以支持五色、五色間連續轉換、frame blend、contrast wheel 與點陣背景的模型方向。
- BGB 也明確表示 close-up 點陣圖是理想化近似，像素邊寬與陰影並非完整儀器量測，因此 `PixelFill`、edge softness 與 shadow 仍是視覺候選值。
- 尚未找到 IR3E02 V1–V5 比例、LH5076/LH5077 類比波形、DMG 原液晶配方或 polarizer spectrum；它們以明列區間傳入 ensemble，沒有被宣稱為 DMG 實測。
- 被動矩陣 selection loss 已由 `1/144` Alt–Pleshko RMS 進入 drive。空間 row／column loading 則由同期 ITO、driver、cell 與 DMG 幾何／時序的 low／nominal／high ensemble 重建；normal 使用計算出的 nominal 值。它仍不是 DMG 原廠實測，且 LH5076/LH5077 類比輸出阻抗與原始電極 mask 是明列缺口。
- 無法從健康原機重測的量，一律保留來源定義、年代、適用面板類別、輸入範圍、推導公式、敏感度與 Shader 降階誤差。老化 DMG 圖片只可驗證方向與可見性，不得拿來識別新品電氣參數。
- 實體 DMG 的拖影會隨面板個體、溫度、contrast wheel 與老化而變化；「Reference」代表保守基準，不代表所有保存至今的 DMG。

## 來源

以下是方便閱讀的來源摘要；可稽核的來源 ID、完整書目、資料轉換、限制與再散布
狀態，以 [`models/nintendo-dmg-01/REFERENCES.md`](../../models/nintendo-dmg-01/REFERENCES.md)
為準。

- BGB DMG reality：https://bgb.bircd.org/reality/index.html
- BGB 五色參考圖：https://bgb.bircd.org/reality/dmg-reality-colorscheme.png
- BGB frame-blend blur 圖：https://bgb.bircd.org/reality/dmgblend-blur.png
- BGB frame-blend shade 圖：https://bgb.bircd.org/reality/dmgblend-shades.png
- BGB 理想化 close-up：https://bgb.bircd.org/reality/dmglcd-closeup.png
- Hitachi Europe passive/active matrix application note AN-002：https://eclass.hmu.gr/modules/document/file.php/EE315/AN-002_Passive_and_Active_Matrix.pdf
- 1992 SID passive-matrix response/crosstalk paper：https://sid.onlinelibrary.wiley.com/doi/full/10.1002/j.2637-496X.1992.tb06185.x
- Nehring 與 Scheffer，Alt–Pleshko multiplex optimization（1990）：https://doi.org/10.1080/00268949008038582
- 1988 年透明電極 ITO 製程資料：https://patents.google.com/patent/JPS63221591A/en
- 同期 LCD driver output-resistance 資料（HD44100 family）：https://www.jaapsch.net/psion/pdffiles/hd44100_datasheet.pdf
- 1989 年液晶電阻率資料：https://patents.justia.com/patent/4818072
- Nintendo Game Boy 畫面尺寸資料：https://www.nintendo.com/fr-fr/Assistance/Consoles-plus-anciennes/Donnees-techniques-619585.html
- LCD response and temperature：https://saemobilus.sae.org/papers/highly-multiplexed-dot-matrix-lcd-suitable-wide-temperature-range-930546
- M. Schadt, Liquid crystal materials and liquid crystal displays, Annual Review of Materials Science 27 (1997)：https://doi.org/10.1146/annurev.matsci.27.1.305
- H. Takatsu, Development and Industrialization of Liquid Crystalline Tolans (1999)：https://www.jstage.jst.go.jp/article/yukigoseikyokaishi1943/57/7/57_7_629/_pdf
- K. Okada et al., High Response Speed Supertwisted LCD (1988)：https://www.jstage.jst.go.jp/article/itej1978/42/10/42_10_1022/_pdf
- Y. Nakazono et al., Relationship between Image Sticking of STN LCD and Physical Properties of Liquid Crystal (1994)：https://doi.org/10.11538/ekitouyokou.20.0_374
- K. Takizawa et al., Physical Properties Related to Image Sticking (1997)：https://www.jstage.jst.go.jp/article/itetr/21.3/0/21.3_29/_pdf
- M. Mizusaki et al., Residual DC Voltage and Image Sticking kinetics (2011)：https://doi.org/10.1295/koron.68.39
- Game Boy Hardware Database（Sharp LH5076/LH5077 與 LCD revisions）：https://gbhwdb.gekkio.fi/consoles/dmg/
- DMG-LCD-06 reverse-engineered schematic：https://github.com/Gekkio/gb-schematics/blob/main/DMG-LCD-06/DMG-LCD-06.pdf
- Thomas Spurden, Capturing the Gameboy LCD：https://thomas.spurden.name/blog/capturing-gb-lcd/
- Nintendo, Game Boy Programming Manual（screen timing 與 LY）：https://files.nekoblog.org/uploads/pdf/39999184-GameBoy-Programming-Manual.pdf
- Terry J. Scheffer, Direct-Multiplexed Liquid Crystal Displays (1986)：https://www.jstage.jst.go.jp/article/tvtr/10/21/10_KJ00001966449/_pdf
- Lee, Ge and Wu, published ZLI-2293 constants：https://lcd.creol.ucf.edu/people/zge/Papers/APL%20Lee%20VA.pdf

## 調整順序

使用 KPA profile 時，先固定其中性顯示模式、讓 Gambatte 關閉 colorization／額外 frame mixing、RetroArch 使用 Vulkan 與 4 倍整數縮放，再依序調整：

1. `Contrast`／`ContrastBias`：先對靜止四階灰圖。
2. `DriveContrast`／`PanelTemperatureCelsius`：只能在物理報告支援的 `0.88–1.12` 與 `10–30 °C` 內比較高速橫移邊緣；不要輸入目標毫秒數。
3. `PixelFill`／`PixelEdge`／shadow：最後以 KPA 實際 `640×576` 遊戲視窗調整。

Reference 的 `PixelFill=0.875` 取自 BGB 理想化 close-up 的 `70/80` 繪圖比例。最初的 0.76 讓 LCD 未驅動 gap 佔比過高，造成 KPA 畫面平均值比 BGB 實機照片更亮、更黃；後來的 0.84 搭配中心點 smoothstep 又會在 4× 輸出抹掉半像素格線。現在改用 box coverage，同時保留 BGB 參考比例與可見的次像素格線；實際 aperture 仍待更強的 DMG-specific 幾何來源。

不要用靜止選單判斷拖影，也不要同時開 Gambatte `Mix Frames`，否則會重複時間混合。
