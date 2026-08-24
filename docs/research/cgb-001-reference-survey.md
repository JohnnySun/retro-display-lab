# CGB-001 reference survey：Sharp 反射式 HR-TFT

更新日期：2026-08-24
狀態：reference collection complete；WS1 已分層色彩資料，WS2 已凍結 RGB555 frontend，WS3 已凍結有邊界的 scan-drive，WS4 已建立 period response ensemble，WS5 已完成固定角度 reflected-exposure integration，WS6 已凍結最低假設 RGB aperture，WS7 已凍結獨立且 reference 零振幅的 residual-DC contract；本文件不定 Shader pass

2026-08-24 implementation scope decision：`reference-v1` 接受目前固定版本的
HCS GBC 光譜資料作為 reference color。觀看方向固定為面板法線 `0°`，沿用資料
的 `45°/0°` illumination/view geometry；預設輸出 illuminant 為 D65。不做動態
視角、人臉／鏡頭追蹤或 runtime BRDF。資料品質限制仍須留在 provenance 與驗收
報告中，但不再阻擋第一版實作。

## 結論先行

1. **CGB-001 不是彩色版 DMG STN。** Nintendo 維修手冊直接把顯示器標為 `HR-TFT 160 × 144 × RGB Dots`，並標出 LCD 內建 common / segment drivers。這是一片沒有背光、利用環境光的 Sharp 反射式主動矩陣 TFT LCD。它和 DMG 共享的是反射顯示、環境光依賴、解析度與掃描時間背景，不共享 DMG 的被動矩陣 RMS selection、row/column crosstalk 或 STN director 拓撲。
2. **目前公開的 GBC 光譜量測很有價值，但仍是 WIP 靜態錨點。** Handheld Color Space Project（HCS）公開了 32-code ramps、primaries、secondaries、gray、spectral reflectance 與多種 illuminant 的擬合。不過原作者也明列量測條件不完整、patch 數錯位、黑階漂移、短波段失效、負反射率，以及 XYZ 不滿足加法性；處理後資料另有人工修補。因此它不能單獨支撐完整、可稱為物理重建的面板模型。
3. **單一 45°/0° 色度不是「GBC 的唯一顏色」。** Sharp HR-TFT 以 MRS 微反射電極塑造角度散射；反射式 LCD 的輸出取決於 illuminant spectrum、照明方向與孔徑、觀看方向、面板方位角、前表面 glare 和內部 reflector。HCS 的 45°/0°、特定旋轉方向是一個明確使用情境，不是角度無關的面板色域。
4. **Sharp 的同期 HR-TFT 論文能限定結構與年代範圍，不能冒充 CGB module datasheet。** 1997 年 Sharp 原始論文給出 Super-HA、MRS、反射式 RGB microfilters、GH/HCR 兩種模式，以及 family-level 的反射率、對比與 response；但尚未找到 CGB 面板的 Sharp model number、cell mode、VCOM waveform、gamma reference voltages、完整 GtG 或 BRDF。
5. **第一版 reference scope 已可開始實作。** 靜態顏色接受固定 HCS dataset 與法線觀看情境；缺少的 32×32×RGB 暫態、VCOM／殘影與精確 aperture 依照專案既有原則，以 Sharp family／同期文獻建立明標的 period-reconstruction，而不是等待必須取得原廠實機量測。

## 研究範圍與證據分級

目標是原廠 CGB-001、原裝反射式 LCD、接近健康服役狀態的行為。IPS/OLED replacement、背光改裝、相機自動白平衡照片與單純「憑記憶調色」不作校準真值。老化機可以提供行為線索，但不能在沒有老化分離的情況下代表 1998 年新面板。

證據分四層：

| 層級 | 定義 | 可控制的內容 |
| --- | --- | --- |
| A | Nintendo／Sharp 的 CGB-specific primary document，或可重驗的 CGB 原始量測 | 可以直接凍結裝置事實；量測仍須通過 metadata、重複性與儀器範圍檢查 |
| B | Sharp 同期 HR-TFT 原始論文、可比較 module datasheet、display metrology 標準／論文 | 限定模型形狀、結構、合理範圍；不能直接填 CGB 專屬常數 |
| C | 開源 emulator、逆向工程、硬體資料庫、示波器／顯微照片與有方法的社群研究 | 建立待驗假說、fixture、版本矩陣；交叉驗證後才可升格 |
| D | Shader、照片目測、論壇描述、主觀 LUT | prior art 與失敗案例；不作物理參數來源 |

## 專案內 GB／GBA baseline 已讀範圍

這輪先完整讀過專案內 DMG-01 與 AGS-101 的 `REFERENCES.md`、所有 `reference/*.mjs`、核心 shader/includes、presets、model README，以及對應 research 文件，再拿它們作架構對照。入口分別是 [`models/nintendo-dmg-01/REFERENCES.md`](../../models/nintendo-dmg-01/REFERENCES.md)、[`docs/research/dmg-01.md`](dmg-01.md)、[`models/nintendo-ags-101/REFERENCES.md`](../../models/nintendo-ags-101/REFERENCES.md) 與 [`docs/research/ags-101-capture-pipeline.md`](ags-101-capture-pipeline.md)。

對照後的核心判斷：

| 層 | DMG-01 | AGS-101 | CGB-001 應如何看待 |
| --- | --- | --- | --- |
| 矩陣驅動 | 反射式 passive-matrix STN | backlit active-matrix TFT | **active-matrix TFT**；不得搬用 DMG row/column RMS 與 passive-matrix crosstalk |
| 短期狀態 | STN director + reflective optical LUT | per-subpixel TFT GtG state | 架構較接近 AGS 的 per-subpixel state，但 CGB 必須重測自己的 GtG、temperature 與 reflective endpoint |
| 長期狀態 | ionic sticking 與普通拖影分離 | VCOM／residual-DC retention 與 GtG 分離 | 可沿用「短期 response 與慢速 DC/ionic state 分離」的研究方法；常數與 polarity pattern 皆未凍結 |
| 光源 | ambient reflection | panel backlight | 必須保留 illuminant spectrum、照明／觀看 geometry、前表面 glare 與 MRS scattering；不能把結果當自發光 RGB |
| 色彩 | 五態 DMG-specific anchor | measured RGB555 endpoint | 以 CGB spectral reflectance 為主，但需保留黑底、交互作用、illuminant 與角度；靜態 3×3 matrix 只能是降階結果 |
| 幾何 | 單色矩形 aperture | BGR aperture | CGB 要獨立確認 RGB order、notch、fill factor、black matrix／反射電極形狀；不能借用 AGS BGR |
| 時序 | CGB/DMG family line timing + DMG CPL capture | GBA scan/latch capture | Nintendo timing 能給 frame/line 骨架；光學 onset、REVC parity 與 source latch 仍需 CGB 實測 |

可重用的是 source provenance、raw/derived 分離、因果 state、deterministic stimulus、capture schema、failure gate 和 aperture 面積積分方法；不可重用的是任一台其他面板的物理常數。

## WS2 已凍結的數位 source boundary

初始 frontend 固定為 Gambatte libretro commit
[`3262c2aa4adae8dba4f6d51cdd931c15cb11569f`](https://github.com/libretro/gambatte-libretro/commit/3262c2aa4adae8dba4f6d51cdd931c15cb11569f)。完整 upstream source tarball 與實際控制
build、core options、libretro ABI、geometry/timing、色彩 packing 的原始檔已逐 hash
保留，沒有把上游程式降階重寫成不可考證的摘要。

固定 source contract 是 160×144、4,194,304 / 70,224 Hz、未套色彩校正的 CGB
RGB555。選定 build 要求 `RETRO_PIXEL_FORMAT_RGB565`；core 的實際 packing 為
`(R5 << 11) | (G5 << 6) | B5`，所以 RGB565 bit 5 固定為零。16 個專案自製
CGB ROM 經獨立 byte decoder 與重新編譯的 pinned core 驗證，其中 exhaustive
transport ROM 在 1,024-frame cycle 實際送出全部 32,768 個 RGB555 值，缺值為
零。這是 emulator/source 證據，不是面板顏色或 response 證據。

必須停用 `gambatte_gbc_color_correction`、`gambatte_dark_filter_level` 與
`gambatte_mix_frames`，避免在 WS1/後續 temporal model 前先做一次未知校正或
ghosting。Native CGB 與明確使用 GBC RGB555 palette 的 DMG content 屬 initial
scope；SGB border/colorization、GBA-enhanced mode 與其他 post-processing 不在
v1。Pause 只凍結 state；reset、content load、save-state load、rewind discontinuity
清除歷史後由當前完整 frame 重建 baseline。Dropped/coalesced fast-forward、
speculative run-ahead、subframe 或非單調 frame ID 一律 fail closed 至當前 frame
的 static WS1 color path，不倒推或猜測 LCD state。

## CGB 硬體與驅動鏈

### 已有直接證據

- Nintendo 1999 service manual 的 block diagram：`HR-TFT 160 × 144 × RGB Dots`，common driver 與 segment driver 內建於 LCD，CGB regulator 向顯示部分供應約 `+5 V`、`+13.6 V` 與 `−15 V`。手冊零件表只給 Nintendo service part `38900 LCD Unit, CGB`，沒有 Sharp module model number。
- Nintendo Programming Manual：遊戲端每通道 32 階、總 palette 32,768 色；硬體 block diagram 同時列出 `LDR0–5`、`LDG0–5`、`LDB0–5` 與 `DCK/SPL/LP/PS/SPS/CLS/MOD/REVC`。所以 RGB555 palette storage 和面板側每通道 6 條資料線是兩個不同層級；尚不能假設第六條只是簡單 bit replication。
- Sharp 的可比較 HR-TFT module datasheet 把同名訊號解釋為 pixel sampling clock、source sampling start、source latch、gate start／clock、power save、gate control 與 common-electrode drive。這只用來確認 interface taxonomy；該 3.52-inch module 不是 CGB 面板。

### 合理推論與未解項

`REVC` 名稱、Sharp family interface 與 active-matrix LCD 通則都指向 common-electrode polarity inversion；但 CGB 的實際 line/frame polarity pattern、VCOM DC offset、source gamma ladder、pixel voltage swing 與不同 board revision 是否相同，仍沒有直接波形。Nintendo 維修手冊只把 LCD ribbon connector 標為 P2，沒有給 pin count；同頁稍後所稱的「32 pin connector」是 PCB 下方的 cartridge connector，不能拿來當 LCD 規格。現存 CGB-CPU-04 逆向資料把 P2 記為 50-pin，仍須用實機與 schematic 交叉確認完整 pinout，而不是從圖片文字猜測。

Game Boy Hardware Database 已記錄 CGB-CPU-01 至 -06、日期與主要 Sharp IC，可作採樣分層；但目前沒有同等完整的 LCD label／panel revision census。後續每次面板量測都必須綁定主機 serial、PCB revision、CPU revision、LCD ribbon／背標、維修與改裝歷史。

### WS3 實作結論

WS3 把 `4,194,304 Hz × 70,224 dots`、456 dots/line、154 lines/frame、
144 visible lines 凍結為 exact frontend/PPU coordinate；Nintendo 手冊印出的
108.7 µs/line、15.66 ms visible、1.09 ms VBlank、59.7 Hz 只作獨立 rounded
cross-check。這個 coordinate 不被寫成 LP／SPS／CLS／REVC 的實測 edge。

`LDR/G/B0–5`、`DCK`、`SPL`、`LP`、`PS`、`SPS`、`CLS`、`MOD`、`REVC`
已逐項分開 CGB-specific existence 與 Sharp-family semantics。runtime 保留原始
RGB555 code，使用 `code5 / 31` 的無因次 command coordinate；兩種常見 5→6 bit
展開只放在 sensitivity diagnostic，沒有選入 runtime。0/0.5/1 line latch、
0/0.5/1 line activation delay、兩種 parity phase 與五種 inversion topology
都有界且可重驗；period default 不被宣稱為 Nintendo 原廠常數。

CPU double 與未來 Shader 的 float32 方程已用 first/middle/last visible 及 blanking
rows、兩個 parity phase 驗證。candidate 只能移動 previous/current causal split；
constant field、no-scan endpoint、pixel locality 與 WS1 LUT hash 均保持不變。
實際 GPU Shader／readback 仍屬 WS8/WS9，WS3 沒有建立 `.slang` 或 preset。

## Sharp HR-TFT 的反射光學

Sharp 1997 原始論文和 1999 回顧給出的 family-level 結構是：前偏光片／補償膜、反射顯示用 RGB color filter、LC layer、TFT、以及位於 cell 內部的鋁 MRS reflective electrode。Super-HA 把反射像素延伸到 bus line 上方以提高 aperture；把 reflector 放進 cell 內可避免厚玻璃造成的 parallax、blur 與跨像素混色。MRS 表面是隨機化的微小突起，目的是把外光散射到設計角域並減少規則干涉色。

這個光路有幾個不能被一般 RGB matrix 抹掉的性質：

- 外光穿過 color filter 到 reflector，再通過同一 filter 返回，因此 filter 是 double-pass；Sharp 論文特別把反射率、對比、filter purity 與 ambient spectrum 視為共同設計問題。
- MRS 不是 Lambertian 白紙。1997 論文顯示其反射率在法線 ±45° 範圍內有經設計的角度分布；同期 Sharp 研究進一步以 micro-mirror slope distribution 定義理想散射。
- reflective LCD 的可見黑位同時包含 LC 未完全截止、color-filter／reflector 光路和前表面 glare。這些都隨照明與觀看 geometry 變化。
- Sharp 同期提供高亮 GH 與高彩度／高對比 HCR 兩型。1999 回顧描述一偏光片、normally-white 的 HCR；但尚未找到 CGB module-specific 證據確認它究竟採 GH、HCR 或哪個子版本。GBC 外觀與產品用途可以形成假說，不能升格成事實。

Sharp 1997 的 6.5-inch prototypes 給出 family reference：GH 約 33% MgO-relative reflectance、5:1；HCR 約 30%、10:1；HCR on/off 約 50 ms、gray 約 80 ms，GH 約 80/150 ms。這些證明同期 HR-TFT 並非瞬時顯示，也給出量級；它們**不是** 2.45-inch CGB panel 的 response specification。

## GBC 公開光譜量測審計

### 來源固定

主要資料是 HCS repository commit [`e688fc51141c0974728aa1bdcb89b94d74123f6b`](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBC/%5B2026-05-xx%5D%5BPokefan531%5D%5BWIP%5D)。WS1 按本專案的可考證 reference 政策，保留了逐位元相同的 ODS/TXT 與上游參數 CSV，並標明作者、原路徑、commit、hash、WIP 狀態與所有已知限制；正規化與 LUT 另存為派生層。repository root 未找到 LICENSE/COPYING/NOTICE，因此這些檔案不被重新授權為 Apache-2.0 專案程式碼。

| 原始 artifact | SHA-256 |
| --- | --- |
| `gbc_reflectance.ods` | `967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba` |
| `gbc_reflectance.txt` | `b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37` |

ODS 有 `R/G/B/Y/C/M/Greyscale/Summary` 八張表；每個 raw reading 包含 XYZ、Lab，以及名義 380–730 nm、10 nm interval 的 spectrum。實際 patch 數為 R=31、G=33，其他 ramps=32；和預期每通道 32 code 不一致。Summary 只有 white、black、R、G、B 五組 spectrum。

### 作者已揭露的限制

- 使用 X-Rite ColorMunki Photo、ArgyllCMS `spotread` 與 240p Test Suite／HCFR；case 與前玻璃移除。
- 使用 `spotread` 時應啟用 high-resolution output；量測條件、ambient、warm-up、供電、主機 age／hours 等 metadata 沒有完整記錄。
- 每組 color ramp 的 black patch 不一致；作者建議每次測量前重新以 white tile calibration。
- ColorMunki 的有效短波能力不足；作者明列 440 nm 以下平坦失真，並存在物理上不可能的負反射率。X-Rite 同系硬體的官方規格是反射量測約 420–700 nm／10 nm reporting interval，因此不可把輸出檔的 380–730 nm 全段視為儀器實測頻寬。
- primaries 的 XYZ 組合不能可靠預測 secondaries／gray，作者直接標出 additivity failure；這表示 combined RGB reflection、黑底扣除、漂移或量測誤差尚未分離。

### Derived report 不是 raw truth

HCS `report/data/README.md` 說明，報告前先對資料做了「slightly modified」修補，以處理 31/33 patches 與非單調 luminance。審計發現 `r.csv` 最後一列在 440–730 nm 幾乎複製前一列，而前五個失效波長各增加約 `1.0`。它應歸類為方便擬合的 processed artifact，不能回寫成原始量測。

D65 報告目前的降階結果可作 comparison fixture：

| 項目 | 目前 processed result |
| --- | --- |
| R polynomial RMSE | `0.081440` |
| G polynomial RMSE | `0.046959` |
| B polynomial RMSE | `0.119118` |
| RGB-linear → XYZ columns | R `(0.404124, 0.273466, 0.202098)`；G `(0.377494, 0.562442, 0.402784)`；B `(0.146833, 0.206531, 0.559688)` |
| secondary/gray scalar k | Y `0.946776`；C `0.969184`；M `0.897847`；gray `0.959289` |

報告圖顯示 primary luminance fit 尚可，但 fitted gamma 在部分高 code 會變負，secondary／gray 偏差更明顯。這些數值可用來做「新 pipeline 是否至少重現既有 WIP 結果」的 regression，不能當 reference freeze。

現有 HCS GBC Shader 只做 polynomial EOTF、靜態 3×3 matrix 與 secondary scalar correction；所謂 45° simulation 是在 exponent 上加固定 `1.05`。它沒有使用宣告的 measured black XYZ，也沒有 dynamic response、scan、VCOM／retention、angle-resolved reflectance 或 aperture。因此它是可讀的 static-color prototype，不是完整物理模擬。

## 45°/0° reference 的適用範圍

ColorMunki 類 45°/0° geometry 代表光源從相對 sample normal 45° 入射、detector 沿 0° 法線接收，且通常排除鏡面反射。這是可重現且常用的外觀量測，但顯示 metrology 文獻指出 reflective LCD 的 contrast／color 不是脫離 source aperture、direction 與 viewing direction 的單一固有值。

NIST 的 display reflectance model 把反射分成 specular、Lambertian 與中間的 haze，主張用 BRDF 描述；reflective-LCD 電光量測也顯示前表面 glare、anti-glare coating、source aperture 與 viewing angle 都會改變 contrast。現代 reflective-display metrology 建議至少分開量 45°/0° directional useful reflection、hemispherical diffuse，以及 specular／haze，再用環境照明模型合成使用情境。

`reference-v1` 不嘗試覆蓋所有情境，而是有意把 45°/0° 固定成唯一正常
觀看條件。所以上述角度依賴是模型的 scope boundary 和未來 specimen-profile
升級方向，不是第一版的 release blocker。

因此下一版 GBC color dataset 至少要記錄：source/detector angles 與 aperture、面板方位角、是否保留原廠 lens、illuminant SPD、reference tile、detector observer、樣本溫度與重複次數。HCS README 所稱 `-45°` 與 `45° simulation` 也必須改寫成完整的 incidence/view/azimuth 定義，不能用一個 gamma offset 代表幾何。

## 暫態、掃描與殘影的現有邊界

### 已知

- CGB 遊戲 frame timing 約 59.7 Hz、160×144 visible rows；Nintendo manual 能固定 digital source timing 的骨架。
- TFT source/gate signals 與 `REVC` 建立了逐列 sample-and-hold、common-electrode inversion 的高度可信架構。
- Sharp 同期 HR-TFT prototype 的 50–150 ms family range 表明多個 frame 的光學暫態合理存在，且 gray transition 比 on/off 更慢。
- 一般 active-matrix LCD 文獻確認 VCOM offset／polarity imbalance 會造成 flicker、DC charge accumulation 與 image sticking；短期 LC response 和慢速 retention 必須是不同實驗與狀態。

### 未知

- 原廠 CGB 的 32×32 per-channel GtG、mixed-color coupling、rise/fall asymmetry、overshoot、temperature dependence。
- 第 y 列真正的 source latch、LC optical onset 與 frame exposure；PPU timing 不能自動替代面板光學 timing。
- `REVC` 是 frame、line、dot 或其他 inversion pattern；不同 CGB revision 是否一致。
- VCOM DC/AC、source gray reference、pixel storage droop、flicker spectrum、長曝 formation/recovery kinetics。

沒有這些資料前，只能把 Sharp family 速度用作 protocol dwell／capture window 的上界，不能把 `50 ms` 填進 Shader 當「GBC response time」。

### WS4 實作結論

Sharp 1997 Table 2 的原始粒度只有 HCR `50 ms on and off / 80 ms gray
scales` 與 GH `80/150 ms`；沒有 threshold、方向、gray pair、溫度或 waveform。
WS4 把它們保留成 6.5-inch family bound，另以明標 `period-reconstructed`
的共同 10–90 interval 建立可計算座標，沒有把 50 ms 改稱 CGB 實測值。

模型選擇實際比較 symmetric first-order、direction-asymmetric first-order 與
two-state cascade。三者都能吻合 scalar interval；後兩者的方向參數／hidden
state 無法由現有證據識別，因此選擇最小的 symmetric first-order rate field。
HCR-like fast、mid-envelope nominal、GH-like slow 分別使用 `50/80`、`65/115`、
`80/150 ms` compatibility anchors。RGB channel multiplier 固定為 neutral 1，
25°C 只作 generic laboratory reference，沒有 temperature coefficient。

產物含 9,216 個 `member/channel/from/to` rate cell，允許未來 raw measured cell
逐格覆寫而不改 Shader interface。所有 32×32×RGB transition 已做 CPU double／
未來 Shader float32、causality、boundedness、exact fixed point 與 convergence
驗收；fast/nominal/slow 只改 transient，settled WS1 LUT bytes 完全一致。實際
Shader/GPU readback 仍屬 WS8/WS9，WS4 沒有建立 `.slang`、preset 或 retention。

### WS5 實作結論

WS5 不把一個 frame 的 RGB state 先平均後只查一次色彩；它先沿 WS4 的連續
per-channel state trajectory 對 WS1 `32³` absolute-reflectance XYZ LUT 做
trilinear evaluation，再對整個 `70224 / 4194304 s` native frame 取時間平均。
WS3 row activation 前後分別使用 previous/current command，因此 top/middle/bottom
transition 保留因果曝光順序；static、no-scan 與 scan equilibrium 則逐位等於 WS1。

CPU gold reference 在每個 LUT-cell crossing 分段，把 trilinear basis 展成有限個
exponential term 後解析積分。未來 Shader contract 使用依 segment duration 分配的
32-panel composite two-point Gauss-Legendre，最多 66 samples/frame。126 個定向
fixtures 加 1,000 個 deterministic random fixtures 的最大 XYZ quadrature error 為
`2.62018e-5`，float32 surrogate 對 double quadrature 最大差 `1.41121e-7`；實際
GPU readback 仍留在 WS8/WS9。

輸出把 physical absolute relative-reflectance XYZ 與 optional white-Y normalized
host coordinate 分開，沒有 target-device brightness。45° illumination、來源樣本
orientation 與 0° normal view 只從 WS1 繼承一次；來源沒有數字 azimuth，因此保持
`null`，沒有添加第二次 MRS/BRDF、angle gamma、glare、retention、Shader 或 preset。

### WS6 實作結論

Sharp 原始 HR-TFT 論文只證明 RGB micro color filters、Super-HA 內置鋁反射電極與
隨機 MRS 微結構；GBCC 明確描述 CGB 是左到右 RGB、近矩形 subpixels，BGB 則是
獨立的三 RGB subpixel 觀察與平均色守恆 prior art。現有 web 圖沒有 raw calibration、
scale target、panel identity 與 camera pipeline，不能從壓縮圖回推 fill、gap 或 notch。
因此 WS6 沒有把任何圖片另存成降階真值，也沒有採用 GBCC semicircle、BGB overflow
或 `Authentic GBC` notch。

凍結模型只把一個 logical pixel 完整分成等寬 RGB 三段，`activeFill=1`、gap=0；這是
最少發明的 neutral geometry，不是 CGB fill-factor 量測。WS5 XYZ 先無裁切轉成固定
linear-sRGB model space，再以三倍 analytic rectangle footprint coverage 重排每個
channel。完整週期平均會回到原 channel 與 XYZ；4×/5×/6×、3.5×/4.25×/4.75×、
多種 viewport phase 與非整週期 crop 均由 CPU 生成器驗證。HCS 測量已拆掉 case/glass，
所以 WS6 是 bare measured panel；MRS aggregate 只繼承 WS1/WS5 一次，grain、lens、
glare 全部關閉。

### WS7 實作結論

Lee 2008 把 alternating polarity、VCOM balance、兩 frame flicker、DC charge 與 image
sticking 串在同一 active-matrix mechanism 上，但沒有給 CGB rate。Mizusaki、Miyashita
與 Uchida 2011 的原始論文則在 25 °C、ZLI-1132/AL-1051 laboratory cell、3.4 V 30 Hz
矩形波、1–5 V DC offset、120 分鐘 stress、90 分鐘 recovery 下，得到 `kaNs` 為
`0.060–0.067 min^-1`、slow `kd2` 為 `0.023–0.028 min^-1`。WS7 保留完整 protocol，
只用 range 端點與 arithmetic midpoint 作 low/nominal/high kinetics；沒有移植 0.44 V
amplitude、材料 identity 或 70% fast-recovery branch。

每個 160×144 source pixel 使用一個與 WS4 RGB endpoint 完全分離的 signed scalar。
excitation 只讀 raw RGB555、FrameCount、x/y、兩 parity phase 與 WS3 的 none/frame/row/
column/dot candidates；displayed luma 與 WS5 XYZ 禁止作電氣歷史。因為沒有 healthy CGB
resultant-DC 或 optical-coupling 量測，reference 兩者都固定為 0。非零 normalized stress
只供 balanced/unbalanced duty、uniform/window/checkerboard、polarity reversal、stress/
recovery、pause/reset 與 future-Shader float32 方程驗收；它不產生 normal moving-edge
ghosting，也不建立 aged-CGB preset。

## 像素幾何與 prior art

Sharp 可比較 HR-TFT module 使用 RGB vertical stripe；GBCC 的顯微頁面也描述 GBC 為左到右 RGB、近矩形 subpixels。這足以把 RGB stripe 列為主要假說，但仍缺原廠 CGB 的校準尺度顯微圖、fill factor、MRS aperture、bus／black-matrix 邊界、notch 與多片面板比較。`Authentic GBC` 等 Shader 的 notched pixel 能作視覺 prototype，不能反過來證明 OEM photomask。

| Prior art | 固定版本／連結 | 可用部分 | 不可用部分 |
| --- | --- | --- | --- |
| HCS GBC WIP | `e688fc51141c0974728aa1bdcb89b94d74123f6b` | raw spectra、method notes、illuminant experiments | 修補資料、單一角度、靜態 Shader 不代表完整面板 |
| Pokefan531 舊量測 | `5c6e221b09a88b981eca571de4235a3a1d1269bf` | ColorMunki/spotread/HCFR 方法史 | repository 後來已把兩批結果標為 INVALID；不能回用舊 matrix |
| SameBoy color correction | [`213a12ce93d66b105a113debd9396306066a7cfc`](https://github.com/LIJI32/SameBoy/blob/213a12ce93d66b105a113debd9396306066a7cfc/Core/display.c) | 32-code curve、cross-channel mixing、light-temperature UI 的成熟 prior art | heuristic display transform；沒有 raw CGB measurement provenance，也沒有 reflective geometry／dynamics |
| libretro `gbc-color.slang` | [`a62d9cda9140294d22b6da5e4ff4187365890d42`](https://github.com/libretro/slang-shaders/blob/a62d9cda9140294d22b6da5e4ff4187365890d42/handheld/shaders/color/gbc-color.slang) | public-domain matrix baseline、regression screenshot | 固定 matrix 與 brighten control；沒有物理／量測閉環 |
| `Authentic GBC` / ReShade port | [`be2f3e65f915c0aded6a9106b069b24354cae9ce`](https://github.com/PointSampler/ReShade-AuthenticGBC/tree/be2f3e65f915c0aded6a9106b069b24354cae9ce)；CC0 | aperture／coverage prior art，授權清楚 | 可選 pixel shape 不是 OEM 幾何證據；不含光譜與 panel state |
| GBCC technology notes | [gbcc.dev/technology](https://gbcc.dev/technology/) | microscope lead、512-color subjective LUT 方法 | 人眼配色與動畫描述，不是儀器量測 |
| BGB reality page | [bgb.bircd.org/reality](https://bgb.bircd.org/reality/index.html) | angle/light sensitivity、RGB doubler 等待驗線索 | 照片與目測校準；不得作定量 reference |

## Reference gap matrix

| 主題 | 現況 | 缺少的最小證據 | 對 reference freeze 的影響 |
| --- | --- | --- | --- |
| 面板技術 | Nintendo 明確：reflective HR-TFT active matrix | CGB Sharp module ID／datasheet | 架構已可凍結；細節仍開放 |
| 靜態 spectra | 一片面板、單一主要 geometry 的 WIP ramps | 未來可用重新校準、重複量測與多片統計收窄不確定性 | `reference-v1` 已接受；QA／repair policy 必須可追溯 |
| RGB 組合 | primaries、secondaries、gray；additivity 失敗 | black-subtracted repeat、sampled RGB cube／factorial design、interaction residual | 第一版使用明標的 interaction correction；不得把 3×3 matrix 說成完整物理真值 |
| Illuminant | 可從 spectra 重算許多標準光源 | 未來可加入真實環境 SPD、diffuse + directional mixture | D65 凍結為預設；其他 illuminant 是可選 profile |
| Angular reflectance | 45°/0°、兩個方位描述 | spectral BRDF 或 incidence/view/azimuth grid | 第一版固定 `45°/0°` 且 observer 為法線；不做 runtime angle model |
| Pixel geometry | RGB stripe 的 secondary evidence | 校準尺度顯微圖、R/G/B aperture masks、至少多片面板 | 第一版使用明標 generic/secondary-evidence aperture；未來可替換 |
| GtG | 只有 Sharp family 50–150 ms | 未來 authentic-panel photodiode 32×32×RGB 可建立 specimen profile | 第一版需完成 period-reconstructed fast/nominal/slow ensemble |
| Scan/latch | Nintendo digital timing + family signal semantics | 未來 DCK/LP/SPL/SPS/CLS 與 photodiode 同步 capture | 第一版需建立 bounded candidate 並做 sensitivity／causality 驗收 |
| Inversion／retention | REVC + generic VCOM physics | 未來 REVC/VCOM waveform、flicker parity、controlled stress/recovery | 第一版需明標 reconstructed；不能冒充 CGB 實測 |
| Revision spread | CGB-CPU-01…06 已有 census | LCD label／color／response 共同 census；確認 P2／panel 是否跨 revision 不變 | `reference-v1` 是 period target，不宣稱涵蓋所有個體 |
| 年代／老化 | 現存樣本年齡未知 | panel hours/condition、同批多片統計、偏光片／reflector aging diagnostic | 阻擋把舊機絕對黑白值稱為 pristine |
| 資料授權 | HCS root 未見明確 license | 保留完整 attribution、commit、hash、WIP 與缺少授權的告示；如能取得作者明示授權再更新 | 不阻擋作為可考證 scientific reference 保存；禁止重新授權或抹去出處 |

## 可提升未來 specimen profile 的量測

以下工作可以在未來把 period reconstruction 升級成 specimen-specific profile，
但不是 `reference-v1` 開始實作的前置條件：

1. 建立 CGB specimen manifest：至少涵蓋 early/mid/late PCB revision，每片記 serial、PCB/CPU、P2／ribbon／LCD 背標、維修與使用狀況；第一輪建議 3–5 片，任何 panel cluster 出現後再擴樣。
2. 重做靜態 reflectance：使用可覆蓋至少 400–700 nm、最好 380–780 nm 的校準 spectroradiometer／spectrophotometer；每個 ramp interleave black/white、每 patch 至少三次，保留 raw spectrum、white-tile trace、dark correction、instrument mode、observer 與 uncertainty。先量 32-code R/G/B/gray、primaries/secondaries，再以分層 RGB cube 檢查交互作用。
3. 拆開環境光 geometry：同一面板量 45°/0° 的四個 azimuth、至少數個 off-normal view、hemispherical diffuse，以及可分離 specular/haze 的 configuration；原廠 lens on/off 分成兩個 target，不混在同一資料列。
4. 建立 CGB electrical + photodiode 共時 capture：用 deterministic ROM 在 VBlank 切 page，同時記 DCK/LP/SPL/SPS/CLS/REVC、source row、光電二極體波形與 temperature。GtG 先做 neutral 32×32 gate，再擴 R/G/B 與 mixed colors。
5. 做低風險 retention protocol：先用低對比、小窗口、有限 dwell 的 polarity/flicker 診斷；只有確認安全上限後才做長曝 formation/recovery。普通 GtG、frame inversion flicker 和分鐘尺度 image sticking 必須輸出三份資料，不合併成一條「ghosting」曲線。
6. 取得校準顯微圖：raw、dark/flat、scale target、面板方位、RGB identity、至少中心與四角。先量 aperture mask 與 pitch，再討論任何 notched/grid Shader。

達成條件應是：每個 runtime-facing 數值都能指向 raw artifact、樣本、儀器、geometry、版本、轉換程式和 uncertainty；缺值只能明標 `period-constrained` 或 `experimental`，不能由 prior-art Shader 反推。

## Source ledger

以下均於 2026-08-24 存取；GitHub 資料已盡可能固定 commit。

### A：CGB-specific primary／direct measurement

1. Nintendo, *Game Boy Color Repair Procedures*, Rev. 6/22/99：[`documents.cdn.ifixit.com/XfUohIuYorCPxUTY.pdf`](https://documents.cdn.ifixit.com/XfUohIuYorCPxUTY.pdf)。本輪下載檔 SHA-256：`716b8a201ffab9d8d9cc0587cfbfd17143f45db882730068053a4357453bd1bc`。
2. Nintendo, *Game Boy Programming Manual*（1999）：[ManualsLib landing page](https://www.manualslib.com/manual/1627081/Nintendo-Game-Boy.html)、[PDF mirror](https://files.nekoblog.org/uploads/pdf/39999184-GameBoy-Programming-Manual.pdf)。
3. Brankale / Pokefan531, *Handheld Color Space Project — Nintendo GBC WIP*, commit [`e688fc5`](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBC/%5B2026-05-xx%5D%5BPokefan531%5D%5BWIP%5D)。
4. X-Rite, *ColorMunki Design* hardware brochure：[`L10-391_ColorMunki_Design_en.pdf`](https://www.xritephoto.com/documents/literature/en/L10-391_ColorMunki_Design_en.pdf)；[ColorMunki Photo support archive](https://www.xrite.com/service-support/product-support/calibration-solutions/colormunki-photo)。
5. ArgyllCMS, [`spotread` documentation](https://www.argyllcms.com/doc/spotread.html)：high-resolution／spectrum flags、observer/illuminant defaults、reflective scale 與 white-tile calibration。

### B：Sharp HR-TFT family／display physics／metrology

6. K. Nakamura, H. Nakamura, N. Kimura, “Development of HR-TFT (High Reflective-TFT),” *Sharp Technical Journal*, Dec. 1997：[landing page](https://global.sharp/corporate/info/rd/tj1/1-7.html)、[English PDF](https://global.sharp/corporate/info/rd/tj1/pdf/7.pdf)。
7. S. Fujiwara and S. Mizushima, “反射型液晶ディスプレイの現状と動向,” *日本画像学会誌* 38(2), 1999, pp. 128–131, DOI `10.11370/isj.38.128`：[J-STAGE PDF](https://www.jstage.jst.go.jp/article/isj/38/2/38_2_128/_pdf/-char/ja)。
8. T. Uchida et al., “High Reflective (HR)-TFT LCD: Optimum optical conditions of liquid crystal cell,” IEICE, Jan. 1998：[CiNii record](https://cir.nii.ac.jp/crid/1571698602346556672)。
9. Sharp, HR-TFT corporate history（mass production announced Sep. 1997; began Jan. 1998）：[1997 company history](https://global.sharp/corporate/info/his/h_company/1997/index.html)。
10. Sharp, LQ035Q2DD55 HR-TFT module specification（comparable interface only）：[`LQ035Q2DD55.pdf`](https://www.beyondinfinite.com/lcd/Library/Sharp/LQ035Q2DD55.pdf)。
11. E. F. Kelley, G. R. Jones, T. Germer, “Display Reflectance Model Based on the BRDF,” *Displays* 19(1), 1998：[NIST publication](https://www.nist.gov/publications/display-reflectance-model-based-brdf)。
12. M. E. Becker et al., “Electro-optical Characterization of Reflective LCDs,” SID 2001：[PDF](https://www.display-messtechnik.de/fileadmin/template/main/docs/sid01-eocrlcd.pdf)。
13. M. E. Becker, “Measurement and Evaluation of Display Scattering,” SID 2004：[PDF](https://www.display-messtechnik.de/fileadmin/template/main/docs/sid04-medsc.pdf)。
14. D. Hertel, “Evaluating Display Reflections in Reflective Displays and Beyond,” *Information Display*, 2020：[article](https://sid.onlinelibrary.wiley.com/doi/full/10.1002/msid.1099)。
15. IEC 61747-6-2:2011, *Measuring Methods for Reflective LCD Modules*：[catalog/preview record](https://standards.iteh.ai/catalog/standards/clc/934d9b02-ed7c-4878-8c40-e50529a56476/en-61747-6-2-2011)。
16. S.-W. Lee, “Common voltage control technology for highly reliable active matrix liquid crystal displays,” *Optical Engineering* 47(2), 2008, DOI `10.1117/1.2824378`：[author copy/record](https://www.researchgate.net/publication/238981861_Common_voltage_control_technology_for_highly_reliable_active_matrix_liquid_crystal_displays)。只用作一般 TFT VCOM／flicker／image-sticking physics。
17. H. Nakamura and K. Sekiya, “Overdrive Method for Reducing Response Times of Liquid Crystal Displays,” *ITE Technical Report* 25.5, 2001, DOI `10.11485/itetr.25.5.0_43`：[J-STAGE](https://www.jstage.jst.go.jp/article/itetr/25.5/0/25.5_43/_article/-char/en)。只用來證明 nematic transient／addressing history 可能需要更豐富候選；不移植 overdrive、毫秒值或 hidden-state coefficient。
18. M. Mizusaki, T. Miyashita, T. Uchida, “Interaction between Impurity Ions and Alignment Polymer Layers Affecting the Image Sticking Effect on Liquid Crystal Displays,” *Kobunshi Ronbunshu* 68(1), 2011, DOI `10.1295/koron.68.39`：[J-STAGE article](https://www.jstage.jst.go.jp/article/koron/68/1/68_1_39/_article/-char/en)、[original PDF](https://www.jstage.jst.go.jp/article/koron/68/1/68_1_39/_pdf)。只轉移一狀態吸附／脫附方程與明列的 later-cell rate range，不轉移電壓、材料、amplitude 或老化程度到 CGB。

### C／D：逆向、版本 census 與 prior art

19. Gekkio, [Game Boy Color hardware database](https://gbhwdb.gekkio.fi/consoles/cgb/)：PCB/CPU/IC 日期與 revision census。
20. Natalie the Nerd, [CGB-CPU-04 interactive schematic/BOM](https://nataliethenerd.github.io/cgb.html)：50-pin P2 evidence。
21. gbdevWiki, [CGB external LCD / PGB mode signal mapping](https://gbdev.gg8.se/wiki/articles/Gameboy_and_Gameboy_Color_special_modes_and_features)：secondary reverse-engineered signal mapping。
22. SameBoy [`Core/display.c` at `213a12c`](https://github.com/LIJI32/SameBoy/blob/213a12ce93d66b105a113debd9396306066a7cfc/Core/display.c)、libretro [`gbc-color.slang` at `a62d9cd`](https://github.com/libretro/slang-shaders/blob/a62d9cda9140294d22b6da5e4ff4187365890d42/handheld/shaders/color/gbc-color.slang)、[`Authentic GBC` ReShade port at `be2f3e6`](https://github.com/PointSampler/ReShade-AuthenticGBC/tree/be2f3e65f915c0aded6a9106b069b24354cae9ce)。
23. GBCC, [Technology notes](https://gbcc.dev/technology/)；BGB, [Gameboy Color — it’s all about reality](https://bgb.bircd.org/reality/index.html)。只作 CGB RGB/order 交叉觀察與 prior art；不作 fill、gap、kernel 或色彩的定量真值。
24. Gambatte libretro, commit [`3262c2a`](https://github.com/libretro/gambatte-libretro/commit/3262c2aa4adae8dba4f6d51cdd931c15cb11569f) 與 [official core documentation](https://docs.libretro.com/library/gambatte/)；固定為 WS2 initial core/source transport，不能作 OEM 面板光學證據。

## 目前的 freeze decision

**可以凍結：** CGB-001 是 160×144、RGB、無背光的 Sharp reflective HR-TFT active-matrix LCD；模型研究必須以環境光反射、TFT sample-and-hold、MRS／color-filter 光路與面板 state 為核心。`reference-v1` 使用固定 HCS commit 的 GBC 光譜資料、D65、45° 入射／0° 法線觀看，不做 runtime viewing-angle reconstruction。

**暫不凍結成 CGB 實測事實：** CGB 是 GH 或 HCR 的精確版本、黑位以外的未量測交互作用、reflectance percentage 的跨個體代表性、50 ms response、精確 RGB aperture mask、VCOM parity、retention rate，以及「全系列共用一片相同面板」的假設。第一版可用固定來源或同期物理範圍重建它們，但 metadata 必須保留 `measured`、`derived`、`period-reconstructed` 和 `generic-prior` 的差別。

第一版實作可以依照 [`models/nintendo-cgb-001/IMPLEMENTATION-TODO.md`](../../models/nintendo-cgb-001/IMPLEMENTATION-TODO.md) 進行；任何未來原廠面板量測建立獨立 specimen profile，除非多片證據足以改寫 period reference。
