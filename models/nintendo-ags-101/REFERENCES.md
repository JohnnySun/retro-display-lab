# Nintendo GBA SP AGS-101 evidence map

Accessed 2026-08-18. The default period-reconstruction presets use the HCS-measured
static color model and the closest traceable period-literature retention
parameters. Direct literature values and normalized project bridge priors are
identified separately below. A neutral sRGB adapter remains available only as
a regression baseline.

## Source records

### AGS-HW-01 — Nintendo hardware documentation

- Source: Nintendo, [Game Boy Advance SP instruction manual](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/agsmanual_english?_a=DATAg1AAZAA0)
  and [official support page](https://en-americas-support.nintendo.com/app/answers/detail/a_id/16961/).
- Used for: manufacturer-level form-factor and display-family context.
- Limits: the general SP manual describes a 2.9-inch TFT LCD but does not supply
  AGS-101 gray-to-gray curves, EOTF, spectral data, or image-sticking constants.

### AGS-COLOR-01 — Handheld Color Space Project measurement snapshot

- Source: Brankale, Handheld Color Space Project, fixed commit
  [`e688fc51141c0974728aa1bdcb89b94d74123f6b`](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b),
  and [AGS-101 measurement directory](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D).
- Measurement identity recorded by HCS: author Pokéfan531; measurement date
  2023-07-24; Nintendo GBA SP AGS-101; emissive display; 5-bit source depth;
  ColorMunki Display colorimeter; HCFR; screen overlay present. These fields
  come from the snapshot's
  [`measurements/README.md`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/measurements/README.md).
- Raw source artifacts: HCFR session
  [`hcfr_report.chc`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/measurements/hcfr_report.chc)
  and workbook export
  [`hcfr_report.xls`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/measurements/hcfr_report.xls).
- Workbook coverage: black and white plus a 32-code neutral gray ramp with XYZ,
  RGB, color temperature, and Delta E fields; full-level red, green, blue,
  yellow, cyan, and magenta measurements; and HCFR-report spectral rows from
  380–730 nm. The ColorChecker sheet contains no recorded patches (`-1`), so it
  is not counted as measured coverage. The historical
  [`lut_report.png`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/26a296b8ce359a55a7d68f6fba762f2bca91dae4/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/shaders/LUT%20version/lut_report.png)
  at commit `26a296b8ce359a55a7d68f6fba762f2bca91dae4` evaluates a
  32,768-entry LUT generated from the measured model; it is not 32,768 separate
  physical patch measurements.
- Recorded values used as audit anchors: workbook black
  `XYZ=(0.506620, 0.476724, 0.785710)` and white
  `XYZ=(121.178963, 122.963692, 151.959610)`, with white
  `xy=(0.305928, 0.310434)`. These anchors reproduce the black subtraction,
  white normalization, and matrix in the fixed snapshot's
  [`GBA_SP_AGS101_sRGB.slang`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/shaders/GBA_SP_AGS101_sRGB.slang).
- Artifact chronology: the HCS README records the measurement date. The XLS
  GeneralSheet separately records its export date as 2025-09-23; that is an
  export event, not a replacement measurement date. The same sheet records
  `Simulated sensor`, while the measurement README records the physical meter
  as ColorMunki Display. Both fields are retained with their artifact context
  instead of treating either as missing provenance.
- Derivation/version note: the snapshot's
  [`screen_config.json`](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/lut/screen_config.json)
  contains the earlier gamma-table derivation, whereas the shader includes the
  black-subtracted derivation introduced by HCS commit
  [`b80b89fc6951f0f64c2cbdfd2971c67bc8aafd2f`](https://github.com/Brankale/Handheld-Color-Space-Project/commit/b80b89fc6951f0f64c2cbdfd2971c67bc8aafd2f).
  They are two revisions over the same HCFR record and must not be treated as
  interchangeable tables.
- Local normalized record:
  [`data/hcs-e688fc5-color.json`](data/hcs-e688fc5-color.json), containing the
  utilized grayscale/patch values, HCS commit and file hashes, measurement
  metadata, and named derivation revision.
- Local deterministic derivation:
  [`tools/build-ags101-hcs-color.mjs`](../../tools/build-ags101-hcs-color.mjs)
  produces [`generated/hcs-e688fc5-color.json`](generated/hcs-e688fc5-color.json)
  and the generated Shader blocks. It performs black subtraction, normalized
  primary-matrix construction, local gamma recovery, HCS three-decimal runtime
  gamma quantization, RGB555 EOTF evaluation, Bradford adaptation, measured
  black normalization, and golden-vector generation.
- Used for: the default runtime source EOTF and native RGB→XYZ→host RGB color
  stage, plus numerical comparison against the pinned HCS Shader.
- Protocol fields explicitly marked `n.d.` by HCS: panel manufacturer, HCFR
  version/configuration, ambient lighting, warm-up, brightness level, charger
  state, purchase year, second-hand status, panel artifacts, and estimated use
  hours. `n.d.` means the named field is not recorded in this source; it does
  not make the measurement files, author, date, meter, or software unidentified.
- Coverage limits: this record contains a neutral ramp and full-level
  primaries/secondaries, not direct 32-step red-only, green-only, and blue-only
  ramps, repeated trials, uncertainty intervals, intermediate mixed-color
  patches, gray-to-gray timing, or image-sticking recovery curves. One record
  also cannot establish unit-to-unit variation across every AGS-101.
- Dataset semantics: because the recorded meter is a colorimeter, the
  SpectralSheet is cited as HCFR-report spectral data rather than described as
  direct spectroradiometer acquisition; see AGS-METER-01.
- License check: the fixed commit's root was checked through the GitHub API on
  2026-08-18 and no explicit `LICENSE`/`COPYING` file was present.
- Redistribution: the local implementation is independently written from the
  documented HCFR measurements and includes measurement-derived numerical data;
  upstream Shader source is not copied. The pinned HCS snapshot has no explicit
  license file, so external release of the measurement-derived artifact still
  requires a distribution decision or permission confirmation.

### AGS-METER-01 — ColorMunki Display instrument classification

- Source: X-Rite, *ColorMunki Solutions Product Comparison*, document L7-511,
  [official PDF](https://www.xrite.com/-/media/xrite/files/literature/l7/l7-500_l7-599/l7-511_colormunki_solutions_product_comparison/l7-511_colormunki_family_en.pdf).
- Exact fact used: ColorMunki Display is listed as a spectrally calibrated
  three-channel colorimeter; ColorMunki Photo is the spectrophotometer in the
  same comparison.
- Used for: interpreting the instrument field in AGS-COLOR-01 and avoiding the
  stronger claim that its SpectralSheet rows are direct spectroradiometer
  samples.
- Limits: instrument classification only; it does not invalidate the recorded
  HCFR XYZ/colorimetric measurements or identify the HCFR spectral reconstruction
  method used for this report.

### AGS-COLOR-02 — Libretro SP101 color prior art

- Source: Libretro, slang-shaders, fixed commit
  [`1d5a9f038a4757fc85c7720ef440b957531c85e8`](https://github.com/libretro/slang-shaders/tree/1d5a9f038a4757fc85c7720ef440b957531c85e8),
  [`sp101-color.slang`](https://github.com/libretro/slang-shaders/blob/1d5a9f038a4757fc85c7720ef440b957531c85e8/handheld/shaders/color/sp101-color.slang).
- Used for: comparison with established color-transform approaches.
- Limits: color transformation alone does not establish temporal panel physics;
  no code is copied into the unpublished response prototype.

### AGS-GTG-01 — TFT gray-to-gray overdrive

- Source: Baek-woon Lee, Cheolwoo Park, Sangil Kim, Manbok Jeon, Jun Heo,
  Dongsik Sagong, Jongseon Kim, and Junhyung Souk, “Reducing Gray-Level
  Response to One Frame: Dynamic Capacitance Compensation,” *SID Symposium
  Digest* 32(1) (2001),
  1260–1263, [DOI 10.1889/1.1831790](https://doi.org/10.1889/1.1831790).
- Supporting source: Sharp, [TW200425030A — liquid-crystal gray-level response
  driving](https://patents.google.com/patent/TW200425030A/en).
- Used for: direction- and transition-dependent gray-to-gray response as a TFT
  mechanism rather than a fixed N-frame blend.
- Limits: architecture-level literature, not a measured response matrix for the
  AGS-101 panel.

### AGS-GTGDATA-01 — GtG waveform measurement and runtime-table method

- Primary measurement source: VESA,
  [*Adaptive-Sync Display Compliance Test Specification*, revision 1.1a](https://vesa.org/wp-content/uploads/2023/05/Adaptive-Sync-Display-CTS-r1.1.pdf),
  section 7. The public CTS specifies a 9×9 G2G matrix, 10–90% timing,
  overshoot/undershoot evaluation, at least 250 ms between transitions, and at
  least 20 repetitions per transition.
- Supporting measurement source: Michael E. Becker, “LCD Response Time
  Evaluation in the Presence of Backlight Modulations,” *SID 2008 Digest*,
  [author-hosted PDF](https://www.display-messtechnik.de/fileadmin/template/main/docs/SID08-4_3.pdf).
  It separates LCD response, backlight modulation, frame modulation and noise,
  and shows that overdrive can shorten 10–90% while extending final settling.
- Supporting temporal-matrix source: H. Liang, A. Saha, and A. Badano,
  “Temporal response of medical liquid crystal displays,” *Medical Physics*
  34(2) (2007), [DOI 10.1118/1.2428403](https://doi.org/10.1118/1.2428403).
- Supporting LUT source: Heebum Park, Guiwon Seo, and Chulhee Lee,
  “Quasi-bi-quadratic interpolation for LUT implementation for LCD TV,”
  *VISAPP 2009*, [paper PDF](https://www.scitepress.org/papers/2009/18076/18076.pdf).
- Used for: preserving raw per-transition waveforms and repetitions; deriving
  timing, settling, overshoot, undershoot and residual metrics separately;
  maintaining independent R/G/B from-to tables; and treating incomplete-table
  interpolation as an explicit, testable operation.
- Local project transformation: WS4 selects a monotone first-order
  continuous-time rate field only for cells that pass documented residual and
  overshoot gates. Runtime rates are packed deterministically into a 32×96
  RGB8 texture. Four-corner bilinear interpolation is used only when all
  corners are eligible; otherwise that channel explicitly uses the analytic
  prior. This state-space reduction and its numerical thresholds are project
  decisions, not claims made by VESA or the papers.
- Local schema, fitter, synthetic fixture, runtime manifest, and protocol:
  [`data/gtg-measurement.schema.json`](data/gtg-measurement.schema.json),
  [`tools/build-ags101-gtg.mjs`](../../tools/build-ags101-gtg.mjs),
  [`generated/gtg-synthetic-v1.json`](generated/gtg-synthetic-v1.json), and
  [`docs/research/ags-101-gtg.md`](../../docs/research/ags-101-gtg.md).
- Limits: none of these sources contains a measured AGS-101 3×32×32 matrix.
  The checked-in `gtg-synthetic-v1` table is pipeline validation and is never
  labelled as panel measurement or used by the normal preset.

### AGS-GTGENSEMBLE-01 — Literature-constrained Sharp-family response ensemble

- Period manufacturer-family source: Sharp, *LQ022B8UD04 TFT-LCD Module
  Product Specification*, `LCY-303Z01`, issued 2003-12-27, preserved in the
  [Sharp specification mirror](https://www.beyondinfinite.com/lcd/Library/Sharp/LQ022B8UD04.pdf).
  At 25 C and normal view it specifies 10–90% white-to-black `Tr=18 ms`
  typical (`35 ms` maximum) and black-to-white `Td=45 ms` typical (`75 ms`
  maximum). It is a 2.2-inch, 176×220, normally-white active-matrix TFT with
  an integrated host interface; the checked specification does not state its
  LC mode or transmissive/transflective class. It is not the AGS panel.
- Near-size manufacturer-family source: Sharp, *LQ030B1DC4xx/LQ030B1DC6xx
  TFT-LCD Module Delivery Specification*, `LCG-02039B`, revised 2008-12-02,
  preserved in the
  [Sharp specification mirror](https://www.beyondinfinite.com/lcd/Library/Sharp/LQ030B1DC60J.pdf).
  At 25 C and normal view it specifies 10–90% white-to-black `Tr=30 ms`
  typical (`50 ms` maximum) and black-to-white `Td=60 ms` typical (`100 ms`
  maximum). It is a 3.0-inch, 256×192, normally-white transmissive a-Si TFT
  with raw RGB/timing input; it is close family evidence, not part identity.
- Supporting primary research: Hongye Liang and Aldo Badano,
  [“Temporal response of medical liquid crystal displays”](https://doi.org/10.1118/1.2428403),
  *Medical Physics* 34(2) (2007). It supports nonuniform GtG timing, generally
  slower small transitions, poorer adjacent-level repeatability, and material
  temperature dependence. Its display timings are not transferred.
- Local transformation: `fast` uses the period Sharp typical 18/45 ms
  darkening/brightening endpoints; `nominal` uses the near-size Sharp typical
  30/60 ms pair; `slow` uses its 50/100 ms maxima. A bounded project-prior
  distance penalty expands these scalar endpoints to full 3×32×32 monotone
  first-order tables. Every generated cell records its equation, source class,
  selected member, parameter-range record, and fallback behavior.
- Local evidence, definition, generator, and receipts:
  [`data/ws4-evidence-inventory-v1.json`](data/ws4-evidence-inventory-v1.json),
  [`data/ws4-gtg-ensemble-v1.json`](data/ws4-gtg-ensemble-v1.json),
  [`reference/gtg-ensemble.mjs`](reference/gtg-ensemble.mjs),
  [`tools/build-ags101-ws4.mjs`](../../tools/build-ags101-ws4.mjs), and
  [`generated/ws4-presets-v1/manifest.json`](generated/ws4-presets-v1/manifest.json).
- Limits: no exact `LQ029B1DC01F` datasheet or waveform was found. Channel,
  brightness-mode, temperature, overshoot, and true gray-distance magnitude
  remain explicit unsupported dimensions. These are reconstructed reference
  tables with zero measured cells.

### AGS-STICK-01 — TFT residual DC and image sticking

- Source: [US6590411B2 — Image sticking measurement method for liquid crystal
  display device](https://patents.google.com/patent/US6590411B2/en), including
  residual DC, ionic effects, alignment layers, and storage/parasitic
  capacitance.
- Supporting source: Masanobu Mizusaki, Tetsuya Miyashita, Tatsuo Uchida,
  Yuichiro Yamada, and Yutaka Ishii, “The Mechanism of Internal DC Offset
  Voltage and its Application to LCD,” Japanese Liquid Crystal Conference
  (2006), [DOI 10.11538/ekitou.2006.0.29.0](https://doi.org/10.11538/ekitou.2006.0.29.0).
- Used for: separating fast optical response from slow exposure-dependent
  residual-DC/image-sticking state.
- Limits: these sources constrain mechanisms and stress behavior, not AGS-101
  amplitudes or time constants.

### AGS-ION-01 — Measured adsorption/desorption kinetic model

- Source: Masanobu Mizusaki, Tetsuya Miyashita, and Tatsuo Uchida,
  “Interaction between Impurity Ions and Alignment Polymer Layers Affecting
  the Image Sticking Effect on Liquid Crystal Displays,” *Kobunshi Ronbunshu*
  68(1), 39–44 (2011),
  [DOI 10.1295/koron.68.39](https://doi.org/10.1295/koron.68.39).
- Retained equations: paper eq. 1,
  `dn_a/dt = k_a N_s(n_s-n_a)-k_d n_a`; eq. 3,
  `C_LC V_rDC = q n_a`; exponential generation/relaxation in eqs. 4–5; and
  the two-component relaxation fit in eq. 6.
- Quantitative prior: Table 1 reports `k_a N_s=0.060–0.067 min^-1` and slow
  `k_d=0.023–0.028 min^-1` for the paper's 25 °C laboratory cell over 1–5 V
  DC-offset stress. Figure 9 reports approximately voltage-independent rate
  constants in that range; Figure 10 attributes voltage-dependent residual DC
  primarily to increasing available near-surface ion density.
- Used for: the normalized signed adsorption/desorption state, exact exponential
  CPU/shader update, and explicit distinction between formation and zero-bias
  relaxation.
- Local derivation: [`docs/research/ags-101-drive-retention.md`](../../docs/research/ags-101-drive-retention.md)
  and [`reference/drive-retention.mjs`](reference/drive-retention.mjs).
- Limits: the paper's materials, cell construction, temperature, capacitance,
  and fitted rates are not measurements of the HCS or tested AGS-101 specimen.
  Under the discontinued-display policy in `docs/methodology.md`, their range
  midpoints are the default period-literature theoretical reconstruction, not
  a claim of direct AGS-101 measurement.

### AGS-DRIVE-01 — Common-electrode drive, inversion, and REVC

- Source: Renesas, *AN1208: LCD Screens — Don't Flicker — Or Do They?*,
  [application note](https://www.renesas.com/in/en/document/apn/an1208-lcd-screens-dont-flicker-or-do-they).
- Supporting source: Sharp, *LZ9JG17B Timing Controller for TFT-LCD Panels*,
  [datasheet](https://www1.futureelectronics.com/doc/SHARP/LZ9JG17B.pdf).
- Corroborating field report: Reddit r/Gameboy, [“AGS-101 GBA mod image
  retention fix (40-pin white tab)”](https://www.reddit.com/r/Gameboy/comments/5r8i0e/ags101_gba_mod_image_retention_fix_40pin_white/).
- Exact facts used: LCD drive alternates pixel voltage about a common-electrode
  reference so ideal time-average DC is zero; common-electrode mismatch can
  create visible flicker/retention; the Sharp controller defines REVC as a
  preparatory signal for common-electrode driving. The field report documents
  retention changing with an AGS-101 mod's drive-voltage adjustment.
- Used for: constraining the slow-retention model to an electrical-polarity and
  common-electrode mechanism, rather than treating displayed luma alone as a
  complete physical drive signal.
- Limits: the Renesas and Sharp documents are general TFT drive references, not
  an AGS-101 controller specification. The field report is a device observation,
  not a calibrated waveform. None supplies AGS-101 REVC/VCOM amplitude, phase,
  or retention time constants.

### AGS-FEED-01 — TFT feed-through and polarity imbalance equations

- Primary sources: [CN100407281C](https://patents.google.com/patent/CN100407281C/en),
  eq. 1, and [CN102254538A](https://patents.google.com/patent/CN102254538A/en),
  eqs. 1–6.
- Retained equation:
  `V_feed = C_GD/(C_GD+C_LC+C_ST) * DeltaV_G`. Charge conservation at TFT
  turn-off shifts the held pixel voltage; gray/polarity-dependent capacitance
  can make positive and negative drive unequal relative to VCOM.
- Used for: defining the shader input as the resultant signed DC drive error,
  separate from image luma, and for the future motherboard/panel measurement
  handoff.
- Limits: no AGS-101 `C_GD`, `C_LC`, `C_ST`, gate swing, VCOM error, or
  polarity-resolved pixel voltage has been measured. The runtime therefore
  accepts the normalized resultant error and does not synthesize capacitance
  values.

### AGS-RETENTION-01 — WS5 spatial retention reconstruction

- Evidence audit: [`data/ws5-evidence-inventory-v1.json`](data/ws5-evidence-inventory-v1.json)
  separates transferable period mechanisms from quantities that cannot be
  identified for `LQ029B1DC01F`. It combines the primary sources catalogued by
  `AGS-ION-01`, `AGS-DRIVE-01`, and `AGS-FEED-01` with the unselected WS3
  parity/inversion candidates and deterministic WS2 RGB555 fixtures.
- Local reconstruction: the raw integer command proxy is
  `q=(R5+G5+B5)/93`; the normalized excitation is
  `u=clamp(DriveDcOffset*(1+Wcode*(2q-1)+Wpolarity*p(x,y,t)),-1,1)`.
  Displayed luma, HCS optical output, GtG state, and aperture output do not
  enter this equation. `DriveDcOffset=0` remains exactly balanced, and
  disabling `SpatialRetention` exactly restores the WS1 global path.
- Parameter policy: `SpatialCodeWeight=0.5` and
  `PolarityDriveWeight=0.25` are named project sensitivity priors, not volts,
  capacitances, or fitted AGS-101 values. Frame/row/column/dot polarity remains
  an exposed candidate matrix rather than a selected panel identity.
- Local definition, CPU reference, generator, and receipts:
  [`data/ws5-retention-reconstruction-v1.json`](data/ws5-retention-reconstruction-v1.json),
  [`reference/drive-retention.mjs`](reference/drive-retention.mjs),
  [`tools/build-ags101-ws5.mjs`](../../tools/build-ags101-ws5.mjs),
  [`generated/ws5-retention-validation-v1.json`](generated/ws5-retention-validation-v1.json),
  and [`generated/ws5-presets-v1/manifest.json`](generated/ws5-presets-v1/manifest.json).
- Limits: no AGS-101 VCOM/feed-through waveform, code-voltage curve, or
  image-sticking capture selects the weights. One alpha scalar reduces the
  three subpixel commands to their arithmetic mean and contains no lateral ion
  diffusion or row-line voltage gradient. This is a bounded period-mechanism
  reconstruction, not measured AGS-101 image sticking.

### AGS-FRONTEND-01 — Slang feedback, precision, and frame parity

- Source: Libretro,
  [Slang shader format](https://github.com/libretro/slang-shaders), including
  previous-frame framebuffer feedback, reflected `FrameCount`, and supported
  `R32G32B32A32_SFLOAT` render-target format.
- Used for: explicit selectable parity/inversion polarity candidates, one persistent electrical
  scalar beside optical RGB, float32 precision required by minute-scale
  kinetic rates, causal scan events crossing a frame boundary, and the WS4
  static PNG lookup texture. The official format describes PNG lookup input as
  plain RGBA8/RGBA8_UNORM rather than an automatically sRGB-decoded color
  texture, which preserves the packed WS4 data bytes.
- History semantics used by WS3: the official format defines
  `OriginalHistory1` as input N-1 and `OriginalHistory2` as N-2; unavailable
  negative-frame inputs are transparent black. A delayed event therefore uses
  N-2 -> N-1 in the current output frame and never samples input N early.
- Precision result: the former biased half-float alpha encoding has about
  `1.95e-3` decoded-state spacing near zero, larger than the approximately
  `1.7e-5` unit-error update of a `0.001 s^-1` process at 59.7275 Hz. The new
  pass requests RGBA32F and is subject to target runtime validation.
- Frontend limits: valid for normal forward N=1 rendering. Rewind and run-ahead
  do not reconstruct shader feedback; dropped fast-forward frames undercount
  physical time; shader subframes other than one bypass retention.

### AGS-PANEL-01 — Community panel-label record

- Source: iceboy, [AGS panel database record](https://iceboy.a-singer.de/db/ags_iceboy_2.html).
- Recorded specimen: 2005 `C/AGT-CPU-01` board; LCD sticker
  `LQ029B1DC01F 58E06466754`; LCD stamp `0026 050820`; Sharp CPU.
- Used for: specimen/panel-label context when correlating future measurements.
- Limits: community hardware record; not optical metrology or manufacturer
  confirmation of all AGS-101 units. AGS-COLOR-01 does not record its panel
  sticker or board revision, so the two records are not asserted to describe
  the same specimen. The WS3 exact-part search did not locate a manufacturer
  specification for `LQ029B1DC01F`; nearby Sharp part numbers are not treated
  as exact substitutes.

### AGS-APERTURE-01 — Analytic LCD aperture prior art

- Source: cgwg/Libretro,
  [`lcd-grid-v2.slang`](https://github.com/libretro/slang-shaders/blob/1d5a9f038a4757fc85c7720ef440b957531c85e8/handheld/shaders/lcd-cgwg/lcd-grid-v2.slang),
  fixed Libretro commit `1d5a9f038a4757fc85c7720ef440b957531c85e8`.
- Used for: the published polynomial/analytic approach to integrating an RGB or
  BGR aperture over an output-pixel footprint.
- Transformation: Retro Display Lab re-derives the polynomial integration in
  independently structured code, removes upstream color/gamma behavior, and
  feeds it linear optical state from the AGS response pass.
- Limits: prior-art-informed structural candidate. It is not a microscope
  measurement of an identified AGS-101 aperture, fill factor, or subpixel order.
- Attribution: special thanks to cgwg and Libretro shader maintainers. The
  mathematical method is cited even though source code is not copied verbatim.
- WS6 result: the available provenance-bearing `LQ029B1DC01F` record identifies
  the panel label but does not provide calibrated macro/microscope scale, an
  overlay-separated view, or enough information to exclude camera moire and
  replacement-panel geometry. No AGS-specific kernel is therefore generated.
  The generic polynomial prior now has narrow/nominal/wide sensitivity
  variants and an exact per-channel unit-mean linear-light normalization.

### AGS-BACKLIGHT-01 — AGS-101 brightness/backlight evidence audit

- Manufacturer artifact fact: the AGS-101 retail revision is identified as a
  brighter *backlit* Game Boy Advance SP; period product/manual records identify
  its light button as a two-level brightness control rather than the AGS-001
  light on/off control.
- Supporting primary/manual boundary: Nintendo's preserved 2003
  [AGS instruction booklet](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/agsmanual_english?_a=DATAg1AAZAA0)
  documents the earlier AGS-001 screen-light on/off behavior and is used only
  as the cross-revision control, not as an AGS-101 electrical specification.
- Hardware sources audited: the `C/AGT-CPU-01` and `LQ029B1DC01F` artifact
  photographs in AGS-PANEL-01, the WS3 exact-part search, AGS-001 schematics,
  and period/near-family Sharp material already catalogued under AGS-RECON-01.
- Established: two user-facing brightness states, conventionally normal/low
  and bright/high. Unknown: the HCS session's selected state, absolute peak
  luminance context, low/high ratio, LED count/placement, DC versus PWM,
  frequency/duty/phase, and spatial uniformity.
- Runtime policy: measured static color is unchanged by default. A separately
  bypassable 0.5/0.75/1.0 relative-gain sweep exists only for WS7 sensitivity;
  it is not a physical bound. DC and PWM remain unselected hypotheses, and no
  PWM frequency is inferred from camera banding, modding adapters, or unrelated
  Nintendo hardware.
- Local closure artifacts:
  [`data/ws6-panel-optics-v1.json`](data/ws6-panel-optics-v1.json),
  [`reference/panel-optics.mjs`](reference/panel-optics.mjs),
  [`generated/ws6-presets-v1/manifest.json`](generated/ws6-presets-v1/manifest.json),
  [`generated/ws6-validation-v1.json`](generated/ws6-validation-v1.json), and
  [`tools/build-ags101-ws6.mjs`](../../tools/build-ags101-ws6.mjs).

### AGS-EXPOSURE-01 — Native-frame emitted-light integration

- Exact interval basis: AGS-TIMING-01 fixes one native observation frame to
  `1232 * 228 / 16777216 = 0.016742706298828125 s`. Host refresh and wall-clock
  fast-forward never replace this panel clock.
- Optical basis: every WS4 member uses a first-order constant-rate segment.
  For `x(t)=q+(x0-q)exp(-kt)`, WS7 uses the exact emitted-light integral
  `q*dt+(x0-q)(1-exp(-k*dt))/k`; each nonzero fixture segment is independently
  checked against composite Simpson integration with at least 4096 intervals.
- Scan basis: the same WS3 optical-onset event partitions changed channels;
  unchanged channels retain one full-frame segment to avoid an artificial rate
  re-quantization boundary. The existing residual-DC boundary reduction is
  preserved rather than replaced with a new within-segment electrical model.
- State separation: response pass RGB/alpha remains the physical endpoint and
  retention state for the next emulated frame. A new non-feedback exposure pass
  emits the native-linear frame average; the display pass then applies the
  unchanged WS6 aperture, relative-backlight sensitivity, and color policy.
- Frontend contract: ordinary frames and executed identical-content frames each
  advance one native interval. Host-generated duplicates advance no observable
  Shader state. Fast-forward/VRR are equation-safe only when every emulated
  frame executes once; unknown skipped/duplicated histories require the safe
  bypass and cannot be reconstructed from host presentation time.
- Backlight boundary: unity and static 0.75/0.5 project-sensitivity gains are
  reproducible exposure bounds. DC/PWM remain unselected; no frequency, duty,
  or phase is invented.
- Local closure artifacts:
  [`data/ws7-exposure-integration-v1.json`](data/ws7-exposure-integration-v1.json),
  [`reference/exposure-integration.mjs`](reference/exposure-integration.mjs),
  [`shaders/ags101-exposure-v1.slang`](shaders/ags101-exposure-v1.slang),
  [`generated/ws7-presets-v1/manifest.json`](generated/ws7-presets-v1/manifest.json),
  [`generated/ws7-exposure-validation-v1.json`](generated/ws7-exposure-validation-v1.json),
  and [`tools/build-ags101-ws7.mjs`](../../tools/build-ags101-ws7.mjs).
- Acceptance boundary: repository CPU/high-resolution/Shader-float equations
  and all six Shader stages pass. The WS8 KONKR receipt additionally decodes
  exposure floats from the current three-pass GPU route; it remains target
  implementation evidence rather than AGS-101 panel metrology.

### AGS-NEUTRAL-01 — Neutral regression color adapter

- Sources: IEC, [IEC 61966-2-1:1999 — Default RGB colour space,
  sRGB](https://webstore.iec.ch/en/publication/6169); W3C,
  [Specification of sRGB](https://www.w3.org/Graphics/Color/srgb); mGBA GBATEK
  fork, [GBA LCD color definitions](https://mgba-emu.github.io/gbatek/#lcd-color-palettes).
- Used for: the selectable `neutral-baseline-v1` regression path: RGB555
  quantization, standard sRGB decode before temporal integration, and standard
  sRGB encode for the modern host.
- Transformation: a source value round-trips through the standard transfer
  function when temporal/aperture effects are neutral. No HCS per-code EOTF,
  RGB-to-XYZ matrix, Bradford matrix, measured black, or measured white is
  embedded.
- Limits: engineering interoperability adapter, not an AGS-101 color
  measurement and no longer the default preset. AGS-COLOR-01 supplies the
  measured runtime color stage.

### AGS-TIMING-01 — GBA video timing

- Primary period source: Nintendo, *Game Boy Advance Programming Manual*,
  `AGB-06-0001-002-B13`, released 2005-05-27, LCD Table 5, as preserved in the
  [manual text/PDF mirror](https://www.manualslib.com/manual/3342081/Nintendo-Game-Boy-Advance.html).
- Technical source: mGBA GBATEK fork, [LCD dimensions and timing](https://mgba-emu.github.io/gbatek/#lcd-dimensions-and-timing), with the
  [GBA-only GBATEK mirror](https://rust-console.github.io/gbatek-gbaonly/) used
  for the AGS-101 connector signal list.
- Supporting qualitative observation: Veikkos,
  [gba-frame-test](https://github.com/veikkos/gba-frame-test), documenting the
  line-by-line scan pattern of original GBA-family displays in high-speed
  examples.
- Used for: 16,777,216 Hz master clock, 1,232 cycles per scanline, 228 total
  scanlines, 160 visible rows, exact `T_line=73.43292236328125 us`, and exact
  `T_frame=16.742706298828125 ms`. The three-event scan model derives row start
  from these values, then adds separately classified `LatchOffsetLines` and
  `OpticalDelaySeconds`. GBATEK also records
  the generic SP connector signals DCK, LP, PS, RGB, SPL, CLS, SPS, MOD, REVC,
  and COM. That technical map makes future motherboard testing possible, but is
  not direct proof of AGT-CPU-01 routing or phase.
- Established by the cited records: exact frame/line arithmetic and a
  top-to-bottom raster model corroborated qualitatively on original displays.
- Not established by the cited records: the exact LP/SPS/DCK latch point within
  a line, MOD/REVC phase and polarity mapping, and a separate panel optical dead
  time. `LatchOffsetLines=0.5` and `OpticalDelaySeconds=0` are retained legacy
  candidates. Neither is selected as a formal AGS-101-specific constant.
- Local derivation and capture handoff:
  [`docs/research/ags-101-scan-timing.md`](../../docs/research/ags-101-scan-timing.md),
  [`reference/scan-timing.mjs`](reference/scan-timing.mjs), and
  [`data/scan-capture.schema.json`](data/scan-capture.schema.json). The WS3
  evidence inventory, source constraints, and generated fixtures are listed in
  `AGS-RECON-01`.

### AGS-STIMULUS-01 — Deterministic GBA capture stimulus suite

- Local sources:
  [`data/ws2-stimulus-scenes-v1.json`](data/ws2-stimulus-scenes-v1.json),
  [`tools/build-ags101-test-rom.mjs`](../../tools/build-ags101-test-rom.mjs),
  and
  [`generated/ws2-stimulus-v1/manifest.json`](generated/ws2-stimulus-v1/manifest.json).
- Used for: exact RGB555 color ramps, mixed patches, row markers,
  checkerboard/window patterns, frame-parity alternation, channel GtG gates,
  and retention stress/recovery. Each scene is a separate deterministic GBA ROM
  with a stable ID, SHA-256, exact framebuffer hashes, and dwell schedule.
- Implementation: bitmap Mode 4 with preloaded double buffers; dynamic scenes
  change only the display-page bit at VBlank, avoiding visible-time full-frame
  uploads.
- Limits: deterministic electrical source stimulus, not evidence about the LCD
  response. Emulator execution is recorded by `AGS-MGBA-01`; original
  hardware remains an optional additional compatibility receipt.

### AGS-CAPTURE-01 — Synchronized capture and normalization pipeline

- Local sources:
  [`data/electrical-capture.schema.json`](data/electrical-capture.schema.json),
  [`data/photodiode-capture.schema.json`](data/photodiode-capture.schema.json),
  [`reference/capture-pipeline.mjs`](reference/capture-pipeline.mjs), and
  [`tools/build-ags101-ws2.mjs`](../../tools/build-ags101-ws2.mjs).
- Used for: recording specimen/environment/instrument/stimulus identity,
  aligning raw photodiode CSV to a trigger edge, detecting missing samples,
  normalizing plateaus, fitting/rejecting waveforms, and emitting the existing
  GtG measurement schema.
- Synthetic acceptance:
  [`generated/ws2-capture-loopback-v1/report.json`](generated/ws2-capture-loopback-v1/report.json)
  covers clean repetitions, noise, overshoot, missing samples, censored
  settling, explicit rejection, standard GtG handoff, and runtime packing.
- Limits: the loopback is synthetic validation only. It establishes data flow
  and rejection behavior, not AGS-101 timing or optics.

### AGS-MGBA-01 — Pinned ROM runtime and scene-consistency receipt

- Local sources:
  [`tools/validate-ags101-ws2-mgba.mjs`](../../tools/validate-ags101-ws2-mgba.mjs)
  and
  [`generated/ws2-mgba-smoke-v1/report.json`](generated/ws2-mgba-smoke-v1/report.json).
- Runtime: all eleven WS2 ROMs remained alive for the declared hold interval in
  mGBA 0.10.5 on Darwin arm64; the receipt pins the executable SHA-256, build
  identifier, options, platform, and every ROM hash.
- Independent consistency check: the validator decodes the GBA header, ARM
  page-toggle path and dwell literals, palette, and both Mode 4 pages, then
  compares them with the scene source and manifest.
- Used for: the mandatory WS2 scene/manifest gate before WS3 emits timing
  candidate fixtures.
- Limits: emulator compatibility and artifact consistency only. It is not an
  AGT electrical trace or AGS-101 panel observation.

### AGS-RECON-01 — Timing evidence inventory and constraint artifact

- Local sources:
  [`data/ws3-evidence-inventory-v1.json`](data/ws3-evidence-inventory-v1.json),
  [`data/ws3-timing-constraints-v1.json`](data/ws3-timing-constraints-v1.json),
  [`generated/ws3-timing-constraints-v1.json`](generated/ws3-timing-constraints-v1.json),
  [`generated/ws3-presets-v1/manifest.json`](generated/ws3-presets-v1/manifest.json),
  [`generated/ws3-sensitivity-v1.json`](generated/ws3-sensitivity-v1.json),
  [`generated/ws3-shader-compile-v1.json`](generated/ws3-shader-compile-v1.json),
  [`shaders/ags101-ws3-timing.inc`](shaders/ags101-ws3-timing.inc),
  and [`tools/build-ags101-ws3.mjs`](../../tools/build-ags101-ws3.mjs).
- Used for: source classification; `C/AGT-CPU-01` and `LQ029B1DC01F` artifact
  identity; per-signal existence/direction/function/timing status; exact raster
  arithmetic; unresolved latch/delay/parity/inversion/brightness candidates;
  nine CPU timing profiles, two parity candidates, four inversion candidates,
  five independent read-only diagnostics, and generated Shader presets.
- Cross-model boundary: Gekkio's
  [AGS-CPU-11 schematic](https://github.com/Gekkio/gb-schematics) is classified
  as AGS-001-only reverse engineering, while Sharp's
  [LZ9JG17B datasheet](https://www1.futureelectronics.com/doc/SHARP/LZ9JG17B.pdf)
  provides family signal semantics only.
- Exact-part search: no traceable `LQ029B1DC01F` manufacturer datasheet was
  located in the recorded 2026-08-20 search. The negative result and search
  scope are preserved; no nearby part is promoted as equivalent.
- Formal-selection status: latch phase, pure optical delay, frame parity phase,
  inversion topology, and brightness coupling are all `null`. The generated
  profiles are sensitivity hypotheses, not measured constants.
- Runtime acceptance: response and display use the same generated timing and
  polarity equations. Four Shader stages pass pinned local glslang compilation
  and SPIR-V validation; 80 CPU equation vectors and the model-output
  sensitivity report reproduce from the same constraint record. Compilation is
  not GPU numeric readback or original-hardware validation.

### AGS-BASELINE-01 — WS1 canonical inventory and repository baseline

- Local sources:
  [`data/ws1-evidence-inventory-v1.json`](data/ws1-evidence-inventory-v1.json),
  [`generated/ws1-baseline-v1.json`](generated/ws1-baseline-v1.json), and
  [`tools/build-ags101-ws1.mjs`](../../tools/build-ags101-ws1.mjs).
- Used for: one canonical classification/value record for every active runtime
  parameter, generated self-contained diagnostic/target presets, exact current
  artifact hashes, and neutral/static RGB555 CPU golden vectors.
- Established by the local checks: repository consistency and deterministic
  regeneration. The baseline is explicitly classified as a repository
  regression record, not a device run.
- Limit: target receipts establish frontend/GPU execution, not original-panel
  physics. Immutable historical records are never rewritten to match newer
  shader bytes.

## Prototype status and evidence gap

The public model separates BGR aperture structure, selectable measured/neutral
color stages, transition-dependent optical response, per-pixel RGB555/polarity
residual-DC retention, and row/latch/optical scan events. WS5's code and
polarity weights are bounded project sensitivity priors; they are not fitted
image-sticking constants. AGS-COLOR-01 supplies the default measured static
colorimetry.
AGS-ION-01 supplies the default period-literature kinetic rates. No pristine
AGS-101 temporal reference specimen is reasonably obtainable, so an aged unit
would be secondary specimen evidence rather than automatic original-production
ground truth. The normalized DC and code-coupling bridge remains a named
project prior; accordingly the preset is `period-reconstruction-v1`, not
`measured` or specimen-calibrated.

## Special thanks

Special thanks to the Handheld Color Space Project contributors for publishing
measurement reports, to Libretro shader maintainers, to the cited display
researchers, and to handheld hardware archivists. Citation is acknowledgment,
not an assertion that those projects endorse this model.
