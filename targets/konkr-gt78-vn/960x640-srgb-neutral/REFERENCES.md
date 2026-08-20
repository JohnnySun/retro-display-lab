# KONKR GT78-VN 960×640 sRGB-neutral target evidence

Accessed/tested 2026-08-19. This file documents modern-target compensation;
original DMG behavior belongs to the
[DMG-01 evidence map](../../../models/nintendo-dmg-01/REFERENCES.md).

## TARGET-KPA-HW-01 — Device and framebuffer geometry

- Source: system-reported KONKR GT78-VN framebuffer and first-party direct
  captures from the test device.
- Repository evidence: [shader-off capture](../../../docs/images/comparisons/dmg01-tetris-shader-off.png)
  and [shader-on capture](../../../docs/images/comparisons/dmg01-tetris-shader-on.png).
- Used for: `panelResolution=[960,640]` and the tested target identity.
- Limits: a framebuffer capture records rendered pixels, not emitted spectral
  power, panel EOTF, viewing angle, ambient light, or perceived luminance.

## TARGET-KPA-SCALE-01 — Exact DMG integer viewport

- Source: source geometry `160×144` and target viewport configuration.
- Transformation: `160×4=640`, `144×4=576`; validation checks the 640×576
  viewport and integer scale 4 inside the 960×640 framebuffer.
- Limits: geometric configuration only; it does not validate optics or color.

## TARGET-KPA-COLOR-01 — Neutral but unmeasured display state

- Source: device configuration and framebuffer A/B captures made in the named
  neutral vendor/SurfaceFlinger state.
- Used for: target label `sRGB-neutral, unmeasured`.
- Limits: no spectrophotometer/colorimeter readings are available for white
  point, EOTF, gamut, luminance, black level, or Delta E. The label must never
  be shortened to “calibrated sRGB.”

## TARGET-KPA-TUNE-01 — Brightness and chroma compensation

- Source: same-device A/B captures compared with BGB's documented,
  color-managed DMG reference images [DMG-COLOR-01].
- Transformation: `ScreenBrightness=0.68` reduces linear-light output for the
  emissive modern LCD; `ScreenChroma=0.90` reduces the observed excess yellow-
  green chroma. These overrides leave the model-level five-state palette intact.
- Limits: device-tuned visual/reference-image match, not instrument calibration.
  Values may change after future target-panel measurement and should not be
  copied to unrelated displays.

## TARGET-KPA-DMG-01 — DMG WS2 physical-reconstruction Vulkan runtime probe

- Source: direct device run on 2026-08-19, recorded in
  [`validation/dmg01-ws2-20260819.json`](validation/dmg01-ws2-20260819.json),
  using RetroArch 1.22.2, Gambatte at 160×144/59.73 fps, Vulkan on Mali-G76
  MC4, and a repository-generated DMG toggle ROM.
- Used for: confirming that the generated 65-bin director-drift and reflective
  optical LUT compile and keep pass-0 feedback active on the named target.
  The physical run loaded `DriveContrast=1`, `20 °C`, and zero unsupported
  spatial loading. Verbose allocation showed response pass 0 as
  `R32G32B32A32_SFLOAT`, matrix pass 1 as `R16G16B16A16_SFLOAT`, and display
  pass 2 as `R8G8B8A8_UNORM`.
- Runtime isolation: the test ROM was generated locally and is not stored in
  the repository. The user's existing `Gambatte/gb.slangp` SHA-256 matched
  before and after the probe; the global RetroArch configuration was not
  replaced, RetroArch was stopped afterward, and validation-only files remain
  under explicit isolated names.
- Limits: this receipt is WS2 completion evidence for the bounded reconstruction,
  not proof that the unknown DMG analogue levels or material identity were
  recovered. Reported core FPS is a frontend geometry contract rather than an
  instrumented frame-pacing trace. The generated include is byte-identical to
  the CPU build and its causal screen output was sampled, but there is no
  floating-point framebuffer readback from the Mali GPU.

## TARGET-KPA-DMGSCAN-01 — DMG causal row-scanout runtime probe

- Source: direct device run on 2026-08-19, recorded in
  [`validation/dmg01-ws3-20260819.json`](validation/dmg01-ws3-20260819.json),
  using the deterministic full-screen DMG transition ROM, the isolated
  Gambatte configuration, RetroArch 1.22.2, and Mali Vulkan.
- Used for: confirming `144+10=154` row integration, captured CPL line-end
  latching, `OriginalHistory1` previous-drive use, a working temporal-only
  diagnostic, exact 4x output, and target compensation that actually loads as
  `ScreenBrightness=0.68` and `ScreenChroma=0.90`.
- Presented evidence: during a shade-0 to shade-3 transition, equal-size top,
  middle, and bottom crops measured Y averages `104.699`, `109.824`, and
  `110.562`. The earlier-latched top was darker; settled fields measured equal
  row averages. Pass 0 remained RGBA32F feedback and all three passes compiled.
- Preset compatibility: Libretro documents simple presets as applying parameter
  overrides after `#reference`, but this Android automatic game-preset route
  retained the referenced defaults in repeated controls. The repository now
  generates complete DMG diagnostic and KONKR target presets and checks their
  exact content. This is a bounded target/build observation, not a general
  claim about all RetroArch simple presets.
- Limits: captures validate presented causal phase and uniform endpoints, not
  analogue row voltage, emitted optics, or floating-point state readback.

## TARGET-KPA-AGS-01 — Exact GBA viewport

- Source: GBA source geometry `240×160` and the system-reported 960×640 target
  framebuffer [TARGET-KPA-HW-01].
- Transformation: `240×4=960`, `160×4=640`; the AGS-101 period reconstruction fills the
  target at exact 4× integer scale without model-specific target color
  compensation.
- Limits: geometric/device-tested target evidence. The AGS source color stage
  uses the HCS measurement record [AGS-COLOR-01], while the KPA target display
  state itself remains unmeasured.

## TARGET-KPA-SCAN-01 — N=1 Vulkan scanout runtime probe

- Source: direct runtime probe on the named GT78-VN unit with RetroArch 1.22.2,
  Vulkan on Mali-G76 MC4, mGBA at 240×160 and `video_shader_subframes=1`.
- Used for: confirming that the scan-aware `ags101-response-v1.slang` compiles,
  creates pass-0 framebuffer feedback, and presents through the analytic display pass
  at 960×640. A moving coordinate marker with `vTexCoord.y < 0.035` appeared at
  the logical top edge, confirming row 0 is the top row on this Vulkan target.
- WS3 integration probe, 2026-08-18: the consolidated main response shader was
  first run with a temporary `OpticalDelaySeconds=0.010` override, forcing the
  lower visible rows through the causal `OriginalHistory2 -> OriginalHistory1`
  frame-wrap branch. It presented stably at 60 Hz without shader compilation,
  Vulkan fatal, or process-crash errors. The override was then removed and the
  device restarted on the formal `ags101-physics-seed-v1` target preset, which
  keeps `BakedScanout=1`, `LatchOffsetLines=0.5`, and
  `OpticalDelaySeconds=0`.
- Test content: a locally owned GBA title supplied on the test device was used
  only for live motion inspection. No ROM or copyrighted capture is
  redistributed by this repository.
- Limits: the unit exposes only 60 Hz, so this verifies N=1 compilation,
  feedback creation, the cross-frame history path, and coordinate orientation.
  It does not establish N=2/4
  feedback rotation or the physical host panel's left/right scan direction.

## TARGET-KPA-HCS-01 — HCS measured-color Vulkan runtime probe

- Source: direct runtime probe on the named GT78-VN unit on 2026-08-18 with
  RetroArch 1.22.2, Vulkan on Mali-G76 MC4, mGBA at 240×160, and the 960×640
  exact 4× target preset [TARGET-KPA-AGS-01].
- Used for: confirming that the generated HCS 32-code EOTF and native-primary
  output transform compile and present through the existing two-pass temporal
  feedback plus analytic BGR-aperture pipeline.
- Parameter coverage: four separately loaded presets exercised (1) HCS
  measured color with native white and black subtraction, (2) the neutral
  regression backend, (3) HCS measured color with the measured black term
  retained, and (4) HCS measured color with Bradford adaptation to D65. All
  four produced stable output; the measured and neutral backends produced
  visibly distinct color rendering, and the Android process log contained no
  shader/Vulkan fatal or compilation failure.
- Device state after the probe: the mGBA core and GBA content overrides point
  to the measured/native-white/black-subtracted preset. Pre-probe overrides
  remain on the device as timestamped backups.
- Test content: a locally owned GBA title supplied on the test device was used
  only for live inspection. Probe captures remain local to the test device and
  are not redistributed by this repository.
- Limits: framebuffer output validates runtime routing and parameter branches,
  not the emitted colorimetry of the unmeasured KONKR target panel. It is not
  an independent instrument validation of the HCS source measurements.

## TARGET-KPA-DMGAPERTURE-01 — DMG WS6 aperture and shadow scale validation

- Source: direct KONKR run on 2026-08-19 plus the deterministic CPU report,
  recorded in [`validation/dmg01-ws6-20260819.json`](validation/dmg01-ws6-20260819.json).
- Implementation correction: periodic previous/current/next aperture coverage
  prevents fractional footprints from losing wrapped area. An analytic joint
  active/shadow integral replaces multiplication of separately averaged masks,
  keeping reflector-shadow gap energy independent of output scale.
- CPU coverage: exact 4x/5x/6x, fractional 3.5x/3.75x/4.25x, four viewport
  offsets, and three edge/corner/crop cases preserved aperture area `0.765625`
  and shadow-gap area `0.191875`; maximum area error was `1e-12`.
- Target coverage: the corrected shader compiled with RGBA32F feedback at exact
  640x576 4x and centered 560x504 3.5x. Presented linear-light averages differed
  by at most `0.00144461` per RGB channel and `0.001224498` in luminance, inside
  the declared `0.002` target tolerance.
- Limits: full DMG 5x/6x exceeds the target's 640-pixel height and is therefore
  a deterministic CPU/fixture gate, not a physical full-screen run. BGB's
  70/80 aperture and shadow offsets remain idealized candidates rather than
  microscope measurements.

## TARGET-KPA-DMGRETENTION-01 — DMG WS4 ionic-retention acceptance

- Source: direct run on the named GT78-VN unit on 2026-08-19, recorded in
  [`validation/dmg01-ws4-20260819.json`](validation/dmg01-ws4-20260819.json)
  and [`validation/dmg01-ws4-gpu-retention-v1.json`](validation/dmg01-ws4-gpu-retention-v1.json).
- Runtime: RetroArch 1.22.2, Gambatte, Vulkan on Mali-G76 MC4, exact 4x output,
  RGBA32F pass-0 feedback, and a deterministic visible 10/10 tile window.
  `DebugView=5` exposed ionic charge, current drive, and positive residual as
  independent R/G/B channels. The 60x diagnostic preserved the exact
  continuous-time exponent; it did not substitute a different rate.
- Result: charge converged to `0.996078`. Across 14 real seconds of zero drive
  (840 equivalent seconds), the observed release ratio was `0.691700` versus
  `0.699772` predicted, an absolute difference of `0.008073`. The inactive
  control half remained zero and charge/release were monotone within the
  declared capture tolerance.
- Limits: H.264, RGBA8, and RGB565 quantization are part of the acceptance
  tolerance. This validates implementation and target integration of the
  reconstructed rates; it does not convert the period/later literature model
  or its bounded optical bridge into a direct pristine-DMG measurement.

## TARGET-KPA-DMGCROSSTALK-01 — DMG WS5 passive-matrix crosstalk acceptance

- Source: direct run on the named GT78-VN unit on 2026-08-19, recorded in
  [`validation/dmg01-ws5-common-mode-20260819.json`](validation/dmg01-ws5-common-mode-20260819.json).
- Electrical reconstruction: three sourced/derived ensembles propagate
  `5–40 Ω/□` ITO, `11–30 kΩ` comparable period driver resistance,
  `0.340–2.081 pF` geometry/dielectric-derived pixel capacitance, LC leakage,
  and the DMG `160×144` three-dwell waveform through distributed row and column
  resistor ladders. The normal Shader uses the calculated nominal scale `1.0`;
  zero remains an isolation diagnostic.
- Approximation: the rejected directional kernel has been replaced by summing
  each distributed electrode's KCL equations and retaining its equipotential
  common mode. There are no training patterns or image coefficients. Nominal
  full-network error is `0.004733` shade RMS, `0.019108` at p99, and `0.020453`
  maximum. Runtime float32 error is `0.000059`; the phase-local performance
  reduction omits a `memory^8` boundary residual whose nominal maximum effect
  is `0.000335` shade.
- Target result: Mali compiled the `1×144`, `160×1`, `160×144`, `160×144`, and
  `640×576` five-pass chain with no errors; the first three targets remained
  RGBA32F and response feedback attached to pass 2. The original qualitative
  12-frame review missed a mixed-tone regression: a shade 2 mino interior was
  saturated to shade 3 by uniform-baseline over-correction and stayed wrong
  after landing. The corrected runtime bounds that correction to `±0.125`
  shade. On the same unit, `DebugView=6` presents the two dark tones near codes
  `181` and `244` instead of collapsing shade 2 to `255`; the normal Tetris
  sequence retains visibly lighter interiors on settled pieces.
- Capture discipline: one-second cold-start recordings were identical black
  Activity-transition frames and were rejected. Formal evidence waits three
  seconds before the two-second recording.
- Limits: the result validates the implementation of a period-evidence-bounded
  reconstruction, not an actual pristine DMG crosstalk measurement. No
  LH5076/LH5077 analogue datasheet or original DMG electrode mask has been
  recovered; aged specimens did not select the electrical parameters.

## TARGET-KPA-DMGFRONTEND-01 — DMG WS7 frontend and target acceptance

- Source: direct run on the named GT78-VN unit on 2026-08-19, recorded in
  [`validation/dmg01-ws7-20260819.json`](validation/dmg01-ws7-20260819.json),
  with RetroArch 1.22.2, Gambatte, Vulkan on Mali-G76 MC4, exact 4x output,
  one shader subframe, frame mixing disabled, and non-monotonic time features
  disabled.
- Numeric comparison: the deterministic four-shade ROM and `DebugView=4`
  compared settled GPU optical states against the generated CPU LUT after
  RGBA8/RGB565 presentation. Maximum channel error was four 8-bit codes against
  a six-code tolerance. The response pass allocated RGBA32F and retained pass-0
  feedback.
- Motion and pacing: three 126-interval SurfaceFlinger samples measured
  `60.248`, `60.267`, and `60.291 fps`; none contained a doubled 25-40 ms
  interval. A synchronized five-second moving-bar recording contained 302
  frames at 960x640.
- Lifecycle: a deterministic ROM covered initialization, restart, content
  reload, save and load, Quick Menu pause/resume, focus loss/resume, and clean
  Close Content. Saving the paused core before and after a three-second wait
  produced the identical state-file SHA-256. Focus loss preserved the same PID,
  and Close Content returned to the unloaded RetroArch main menu.
- Frontend boundary: `N=1` is the physical-time path. `N>1` shader subframes
  take the static bypass; rewind and run-ahead require temporal bypass or an
  explicit history reset. The Android build preserved `network_cmd` settings
  but opened no listener, so no accepted result relies on those commands.
- Limits: SurfaceFlinger measures presented timing rather than optical scanout;
  the numeric comparison includes final display quantization rather than a
  direct float-texture dump; screenshots do not measure an original DMG LCD.
  The archived `dmg01-ws7-20260819.json` static numeric capture predates the
  follow-up WS2 fixed-point correction and remains historical evidence for
  that generated artifact. The post-correction run is recorded separately in
  [`validation/dmg01-ws7-fixedpoint-20260819.json`](validation/dmg01-ws7-fixedpoint-20260819.json)
  and
  [`validation/dmg01-ws7-gpu-static-v2.json`](validation/dmg01-ws7-gpu-static-v2.json):
  the four calibrated optical states passed with a maximum five-code error,
  early and ten-second hold captures were byte-identical, and a 10.006-second
  Tetris capture presented 602 frames at `60.165 fps` with directional
  intermediate-shade persistence and stable stationary graphics.

## TARGET-KPA-DRIVE-01 — WS2 drive-retention Vulkan runtime probe

- Source: direct runtime probe on the named GT78-VN unit on 2026-08-18 with
  RetroArch 1.22.2, Vulkan on Mali-G76 MC4, mGBA at 240x160,
  `video_shader_subframes=1`, and a response pass requesting RGBA32F.
- Used for: confirming that the shared adsorption/desorption include, explicit
  `FrameCount` polarity, persistent state, HCS EOTF coupling, and the
  two-pass output pipeline compile and present on the target.
- State probe: a runtime-only accelerated setting used positive normalized DC,
  adsorption `1.0 s^-1`, desorption `0.2 s^-1`, and debug rendering. The state
  view converged toward positive/red as required; these values were not saved
  as an AGS-101 preset.
- Parity probe: a three-second screen recording contained 181 frames. The
  four-pixel top-left marker alternated black/white on every successive frame
  across the recording, confirming stable `FrameCount & 1` alternation in the
  normal forward N=1 contract on this frontend/target.
- Device state after the probe: both mGBA/GBA overrides were restored to the
  HCS measured/native-white/black-subtracted target preset, RetroArch restarted
  successfully, and timestamped pre-probe overrides remain on the device.
- Default-policy follow-up: after adopting the discontinued-display
  reconstruction policy, the same target preset was redeployed with
  `DriveDcOffset=0.1`, Mizusaki midpoint rates
  `A=0.0010583333 s^-1`/`D=0.000425 s^-1`, and
  `DriveCodeCoupling=0.15`. Device readback matched these values, the deployed
  response Shader SHA-256 matched the repository, and RetroArch resumed at
  approximately 60 fps without a Shader/Vulkan compilation failure.
- Precision audit follow-up: the WS5 verbose allocation probe found that the
  then-present preset-level `float_framebuffer0=true` overrode the shader's
  RGBA32F request and allocated `R16G16B16A16_SFLOAT`. WS5 removed that
  override; a repeated probe confirmed actual
  `R32G32B32A32_SFLOAT` allocation at approximately 60 fps. Thus the earlier
  run validated feedback topology, but only the WS5 follow-up validates the
  required float32 state precision [TARGET-KPA-VALIDATION-01].
- Limits: this validates topology, corrected precision-format support, feedback, and
  normal-forward parity. It does not turn the accelerated probe values into
  AGS-101 measurements, validate physical polarity sign, or make rewind,
  run-ahead, dropped-frame fast-forward, or shader subframes physically valid.

## TARGET-KPA-GTG-01 — WS4 GtG analytic/table Vulkan runtime probe

- Source: direct runtime probe on the named GT78-VN unit on 2026-08-18 with
  RetroArch 1.22.2, Vulkan, `video_shader_subframes=1`, mGBA at 240×160, and
  the target's only 960×640 at 60 Hz display mode.
- Deployment integrity: device readback matched the repository SHA-256 for
  `ags101-response-v1.slang`
  (`ffaab3e14e2d65215baf80aa7f97af6413af116ef73a053a8ba9421cc3f97fe9`),
  `physics-seed-v1.slangp`
  (`a3f8c704619325d656d4189ff881676bbd5ea45cba768f6ba5b533bac66bde7a`),
  and the 2,224-byte `gtg-synthetic-v1.png`
  (`9d2d8b0e53c6871b3d04086c821a08ce87e86e7214eae4664ebde96e0fd6cdb8`).
- Analytic probe: the formal target preset, with `GtgTableBackend=0`, compiled
  and presented normally. SurfaceFlinger samples stabilized at approximately
  59–61 fps with no shader/Slang compilation, Vulkan fatal, or process-crash
  error.
- Table probe: a temporary override selected
  `gtg-synthetic-table-v1.slangp`, forcing the custom PNG decode, per-channel
  table fetch, four-corner status validation, and bilinear rate interpolation
  path. It rendered without corruption at approximately 59–61 fps and
  produced no shader, texture, compilation, fatal, or process-crash error.
- Device state after the probe: both mGBA/GBA overrides were restored to the
  formal HCS-measured target preset, which selects the analytic GtG backend;
  RetroArch was restarted successfully and the game remained in the
  foreground near 60 fps. Timestamped pre-probe overrides remain on-device.
- Limits: this establishes Vulkan/frontend compatibility and shows that the
  table path fits the KONKR's 60 Hz frame budget. The exercised table is a
  deterministic synthetic fixture, not an AGS-101 measurement or an optical
  validation of its transition rates.

## TARGET-KPA-GTGENSEMBLE-01 — Current WS4 reconstructed-ensemble target run

- Source: direct run on serial `BW0306N250002377` on 2026-08-20, recorded in
  [`validation/ags101-ws4-target-20260820.json`](validation/ags101-ws4-target-20260820.json).
  RetroArch 1.22.2 Git `a609b709eb`, mGBA, Vulkan/Mali-G76 MC4, one shader
  subframe, exact 4x output, and the fixed 960x640 60 Hz mode were used.
- Deployment integrity: all deployed Shader, include, reconstructed LUT,
  comparison-preset, target-preset, and deterministic ROM hashes matched the
  repository. The loaded app-private core path is logged; Android's
  non-debuggable sandbox prevented hashing that byte stream, so the accessible
  2,472,240-byte external installation copy is pinned separately and is not
  claimed to prove identity.
- Compile result: fast, nominal, slow, and the exact KONKR target preset all
  cold-compiled. Pass 0 allocated `R32G32B32A32_SFLOAT`, pass 1 allocated
  `R8G8B8A8_UNORM`, table backend parameter `1` loaded, feedback attached to
  pass 0, and no Shader/texture/Slang error appeared in the preserved logs.
- Causal presentation result: the same WS2 `gtg-neutral-gate` ROM drove
  two-second RGB555 0/31 dwells for three 12-second recordings. Centered
  post-display 10-90 analysis measured brightening/darkening medians of
  `38.391/40.663 ms` fast, `49.344/65.672 ms` nominal, and
  `88.071/112.352 ms` slow. Both directions preserved fast < nominal < slow.
- Performance: fast and slow each presented one 126-interval sample at
  `60.432` and `60.273 fps`. Four nominal samples totaled 504 intervals at
  approximately `60.006 fps`; two isolated intervals exceeded 25 ms, with no
  sustained slowdown.
- Restoration: the test process was stopped and both temporary mGBA/GBA
  overrides were restored byte-for-byte to their pre-run SHA-256 values. The
  global RetroArch configuration was not modified.
- Limits: screen recording is downstream of the display transfer, RGB565/RGBA8
  conversion, frame sampling, and H.264. It validates current target
  compatibility and relative table-dependent behavior, not the RGBA32F values
  directly, not absolute linear-state response constants, and not original
  AGS-101 optics. Direct numeric GPU readback remains a WS8 task.

## TARGET-KPA-AGSRETENTION-01 — Current WS5 numeric retention readback

- Source: direct run on serial `BW0306N250002377` on 2026-08-20, recorded in
  [`validation/ags101-ws5-target-20260820.json`](validation/ags101-ws5-target-20260820.json).
  The isolated WS2 `retention-stress-recovery` ROM and generated WS5 numeric
  preset ran through RetroArch 1.22.2, mGBA, Vulkan/Mali-G76 MC4, one shader
  subframe, and exact 4x output.
- Compile result: the current response/display shaders cold-compiled without
  error. Vulkan allocated `R32G32B32A32_SFLOAT` to pass 0,
  `R8G8B8A8_UNORM` to pass 1, and feedback to pass 0. The loaded values were
  `SpatialRetention=1`, `SpatialCodeWeight=0.5`,
  `PolarityDriveWeight=0.25`, and `DebugView=12`.
- Numeric method: DebugView 12 emits outside/inside retained-state floats,
  `FrameCount`, and outside excitation as four black/white uint32 bit bands.
  Every bit was repeated over seven or eight source columns; all decoded bits
  were unanimous in every accepted capture.
- Result: the stress trajectory at frames `6865/7001/7136` separated the
  outside state `0.008374→0.008696` from the stressed inside state
  `0.012610→0.013125`. CPU float32 recurrence agreed within `2.3842e-6`
  against a `3e-6` asynchronous-capture tolerance, with one interval matching
  bit-for-bit. The uniform-recovery interval at frames `2444→2459` matched
  both states and the parity-dependent excitation bit-for-bit.
- Restoration: the RetroArch test process was stopped. Temporary mGBA/GBA
  shader overrides were restored to their exact pre-run SHA-256 values; the
  global RetroArch configuration was not modified.
- Limits: this validates current GPU state implementation, not the WS5 proxy
  weights as authentic AGS-101 physics. Actual GPU coverage used the nominal
  GtG/frame-global/even-positive candidate; the repository equation receipt
  covers the full WS3/WS4 sensitivity matrix.

## TARGET-KPA-VALIDATION-01 — Historical diagnostics and frontend lifecycle run

- Source: direct device run on 2026-08-18, recorded in
  [`validation/ags101-ws5-20260818.json`](validation/ags101-ws5-20260818.json),
  using RetroArch 1.22.2 Git `a609b709eb`, Vulkan on Mali-G76 MC4,
  `video_shader_subframes=1`, exact 4x integer scaling, and the fixed 60 Hz
  target mode.
- Deployment integrity: the device and repository matched exactly for the
  response shader (`dac4427f6fc34f4a96be8b8e407162d81ac97a7ad0cffda9eee37d63bacfe8c3`),
  display shader (`edaf42962e8f354fdd4cff1dce747537f8804c57f620052e4535da1b7c251ce2`),
  model preset (`b4ec9c03ffdfed964115d64e4770549380e0997109be7f6fdb6b4e6a3de95d5a`),
  and packed GtG fixture (`9d2d8b0e53c6871b3d04086c821a08ce87e86e7214eae4664ebde96e0fd6cdb8`).
- Precision probe: detailed frontend allocation logs exposed and then verified
  the correction of the RGBA16F preset override described in
  [TARGET-KPA-DRIVE-01]. The final response allocation is
  `R32G32B32A32_SFLOAT`; the display pass is `R8G8B8A8_UNORM`.
- Diagnostic coverage: unified views 1–5 directly exercised native optical
  state, four electrical components, the row/latch/optical phases, continuous
  GtG from/target/backend status, and aperture off/on. Static-color, GtG-only,
  scan-plus-GtG, analytic/table, and real/60x retention presets all compiled.
- Lifecycle coverage: reset, content reload, save-state load, and menu
  pause/resume completed without shader or process failure. The 4x
  fast-forward probe demonstrated that dropped presentation makes the fixed
  per-frame physical clock invalid; the final GBA overrides therefore disable
  rewind and run-ahead and set fast-forward to 1x. Variable refresh was not
  available on the target.
- Device state after the run: the formal HCS-measured preset is active and
  presents at approximately 59–61 fps. The global configuration was restored;
  the physical-time safety settings are scoped to the mGBA/GBA overrides. The
  temporary save state was moved to a recoverable validation archive rather
  than deleted.
- Limits: framebuffer captures are presentation-only. This run validates the
  implementation, frontend contract, precision allocation, isolation routes,
  and lifecycle handling on the named target; it does not measure the emitted
  optics of either LCD.

## Target claim

This profile means “tested geometry and visually tuned compensation on the
named unit in a neutral display state.” It does not mean “the KONKR panel is
measured sRGB” or “the compensation is a property of the original DMG LCD.”
