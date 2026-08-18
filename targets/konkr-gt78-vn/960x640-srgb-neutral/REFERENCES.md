# KONKR GT78-VN 960×640 sRGB-neutral target evidence

Accessed/tested 2026-08-18. This file documents modern-target compensation;
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

## TARGET-KPA-AGS-01 — Exact GBA viewport

- Source: GBA source geometry `240×160` and the system-reported 960×640 target
  framebuffer [TARGET-KPA-HW-01].
- Transformation: `240×4=960`, `160×4=640`; the AGS-101 physics seed fills the
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

## TARGET-KPA-VALIDATION-01 — WS5 diagnostics and frontend lifecycle run

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
