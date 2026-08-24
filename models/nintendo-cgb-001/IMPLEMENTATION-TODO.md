# Nintendo CGB-001 reconstruction implementation to-do

Status: WS0 through WS8 completed 2026-08-24. WS9 release validation and target
acceptance are next; WS8 compilation is not actual GPU or KONKR acceptance.

## Outcome

Build a physics-informed reconstruction of the original Nintendo Game Boy
Color CGB-001 OEM Sharp reflective HR-TFT LCD. The default result represents a
healthy period panel under the accepted HCS reference condition: D65,
45° illumination, and a 0° viewing direction normal to the panel.

The target is not a generic desaturated GBC matrix, a modern IPS pixel grid, or
an angle-aware digital twin. The target causal chain is:

```text
uncorrected CGB RGB555 source
  -> active-matrix row/source drive and latch timing
  -> continuous per-subpixel HR-TFT optical state
  -> fixed-angle D65 measured-reflectance color
  -> RGB aperture and reflective-panel composition
  -> separate modern-target compensation
```

Ordinary motion must come from the evolving TFT/LC state. Slow retention must
remain a different state. Static color must remain unchanged when temporal
features are bypassed.

## Frozen product decisions

- Use the pinned HCS GBC dataset at commit
  `e688fc51141c0974728aa1bdcb89b94d74123f6b` as the `reference-v1` color
  source despite its recorded measurement limitations.
- The source measurement geometry is the reference geometry. The detector and
  simulated viewer remain at panel-normal `0°`; illumination remains `45°`
  with the source dataset's recorded panel orientation.
- Use D65 as the normal reference illuminant and sRGB D65 as the model-space
  presentation encoding.
- Do not implement camera, face tracking, head pose, dynamic viewing angle,
  runtime BRDF, or a user-facing angle slider in `reference-v1`.
- Do not require acquisition of an authentic CGB, oscilloscope, photodiode, or
  goniospectrophotometer to complete the period reconstruction. Future direct
  measurements create a separate specimen profile.
- Do not transfer DMG passive-matrix selection loss, row/column RMS crosstalk,
  STN material constants, or the DMG five-state palette.
- Reuse the AGS-101 engineering pattern—per-subpixel state, scan separation,
  generated GtG tables, exact exposure integration, and independent retention—
  but not its measured colors, BGR aperture, backlight, response values, or GBA
  timing.

## Status language

- **Complete** means implementation plus workstream-specific acceptance
  artifacts exist and reproduce from a clean checkout.
- **Partial** means useful code or evidence exists but the workstream's own gate
  remains open.
- **Pending** means no qualifying implementation has been accepted.
- **Diagnostic** means the path isolates one mechanism and is not a normal
  user preset.
- Checked boxes are complete. Unchecked boxes remain required.

## Non-negotiable rules

1. Preserve raw-source identity, normalized measurement, fitted model,
   generated runtime artifact, Shader state, and acceptance report as separate
   stages.
2. Every numeric value records evidence ID, units where applicable, source
   class (`measured`, `derived`, `period-reconstructed`, `generic-prior`,
   `target-compensation`, or `synthetic`), scope, and uncertainty/range.
3. Accepting HCS as reference color does not permit silent edits. The 31-patch
   R ramp, 33-patch G ramp, black drift, invalid short wavelengths, negative
   reflectance, and upstream processed-data modifications remain visible in
   the normalization record.
4. Retain the exact HCS ODS/TXT used as scientific source/reference material
   with authorship, upstream path, pinned commit, hashes, WIP status, and the
   missing-license caveat. Do not relicense or silently edit them. Keep all
   project-owned normalization, models, reports, and runtime artifacts separate.
5. The HCS upstream-compatible output and the project reference output are
   distinct named policies. The former reproduces the pinned upstream Shader;
   the latter may add explicit measured black and a documented interaction
   correction, but must show exactly how and why.
6. Do not call a generated 32³ LUT “32,768 measured colors.” It is a continuous
   reduction constrained by the measured ramps and corner/gray patches.
7. Keep reflective-panel exposure normalization inside the model and any KONKR
   or other modern-screen brightness/chroma adjustment in the target preset.
8. No temporal state may look into a future core frame. Pause freezes state;
   reset/content load initializes safely; unsupported non-monotonic time fails
   closed to a declared static path.
9. CPU reference equations and generated Shader equations must agree before a
   workstream becomes part of the default preset.
10. Period-family values may complete the model, but their UI, metadata, and
    reports must never imply authentic CGB measurement.

## Workstream order and dependency map

| Workstream | Priority | Depends on | Result |
| --- | --- | --- | --- |
| WS0 — scaffold and canonical record | P0 | current evidence map | model schema, source inventory, build entry points |
| WS1 — fixed-angle D65 color | P0 | WS0 | measured-reference color model and 32³ runtime LUT |
| WS2 — source/frontend contract and ROMs | P0 | WS0 | exact RGB555 input plus deterministic stimuli |
| WS3 — CGB scan and electrical drive | P1 | WS0, WS2 | bounded active-matrix latch/inversion reconstruction |
| WS4 — HR-TFT optical response | P1 | WS1, WS3 | fast/nominal/slow dynamic ensemble |
| WS5 — fixed-angle reflected exposure | P1 | WS1, WS3, WS4 | frame-integrated D65 output at the frozen geometry |
| WS6 — RGB aperture and panel surface | P2 | WS1 | scale-invariant reflective pixel composition |
| WS7 — VCOM/residual retention | P2 | WS3, WS4 | slow state independent of ordinary response |
| WS8 — Shader/preset integration | P0 gate | WS1–WS7 | normal, diagnostic, and uncertainty presets |
| WS9 — release validation | P0 gate | WS8 | reproducible CPU/GPU/frontend/device receipts |

WS0, then WS1 and WS2, are the first implementation slice. WS3 through WS5
define the temporal CPU/reference and future-Shader equation contract. WS6 and
WS7 may be developed independently after their dependencies but cannot alter
WS1 static reference color.

## Candidate runtime architecture

This is the starting architecture, not a completion claim. WS4/WS5 may change
packing or pass count only with a recorded CPU/GPU precision reason.

1. `cgb001-response-v1.slang`
   - persistent `R32G32B32A32_SFLOAT` state;
   - RGB stores end-of-frame per-channel HR-TFT state;
   - A stores the independently bypassable residual-DC state if WS7 validates
     a scalar state; otherwise WS7 receives its own feedback pass;
   - applies row-latch split and active-matrix response, not final color blur.
2. `cgb001-color-v1.slang`
   - computes observation-interval optical exposure from previous/end state;
   - evaluates the generated continuous 32³ D65 reflectance LUT;
   - applies the selected measured-black policy;
   - contains no aperture or modern-target compensation.
3. `cgb001-display-v1.slang`
   - integrates RGB aperture coverage at the host-pixel footprint;
   - composes inactive gaps/reflector surface without double-applying MRS angle
     gain already present in the fixed HCS reference;
   - exposes only model-level presentation controls.

No DMG-style row-load or column-summary pass is expected. Adding one requires
CGB active-matrix evidence rather than visual similarity.

## WS0 — Scaffold the model and canonical reconstruction record

**Status: complete (2026-08-24).** The scaffold is reproducible and its receipt
passes without third-party raw data.

### Implementation

- [x] Create `models/nintendo-cgb-001/` with model-local `README.md`,
  `REFERENCES.md`, and `IMPLEMENTATION-TODO.md`.
- [x] Freeze the HCS commit, raw ODS/TXT hashes, D65 default, 45°/0° geometry,
  and no-runtime-angle decision in the evidence map.
- [x] Add `model.json` with model identity, claim boundary, version, native
  geometry, default frontend contract, parameter classes, and generated
  artifact hashes.
- [x] Add `data/reconstruction-v1.json` as the canonical machine-readable
  record. Every later workstream must extend this record rather than creating
  conflicting constants in prose and Shader code.
- [x] Create empty/versioned schemas for measurement normalization, color
  model, scan candidates, response ensemble, retention, aperture, frontend
  contract, and release receipt.
- [x] Add `reference/`, `data/`, `generated/`, `shaders/`, and `presets/` only
  when their first qualifying artifact is produced; do not populate placeholder
  generated truth.
- [x] Add top-level build/check entry points following DMG/AGS naming:
  `tools/build-cgb001-ws*.mjs` and `tools/validate-cgb001.mjs`.

### Acceptance

- [x] A clean checkout can validate the reconstruction record and evidence IDs
  without downloading third-party raw data.
- [x] Supplying HCS source files enables hash verification and regeneration;
  wrong or modified files fail before normalization.
- [x] No Shader or preset is called `reference-v1` until WS1, WS4, WS5, WS8,
  and WS9 gates pass.

### Completion artifacts

- `model.json`
- `data/reconstruction-v1.json`
- eight `data/*.schema.json` downstream contracts
- `generated/ws0-scaffold-v1.json`
- `tools/build-cgb001-ws0.mjs`
- `tools/validate-cgb001.mjs`
- `npm run test:cgb-ws0`

## WS1 — Build the fixed-angle HCS D65 color reference

**Status: complete (2026-08-24). No Shader was created.**

### Source ingestion and audit

- [x] Implement a read-only HCS importer for the pinned ODS/TXT and derived D65
  parameter/report files. Record source paths, hashes, sheet names, row counts,
  columns, wavelength grid, and upstream notes.
- [x] Preserve all raw values before repair. Generate a separate audit showing
  R=31, G=33, other ramps=32, series black differences, non-monotonic readings,
  negative reflectance, and invalid wavelengths.
- [x] Define the usable-spectrum policy. Values below 440 nm must not silently
  enter an independent spectral integration. If the pinned upstream D65
  derivation is used, classify its edge handling as upstream-derived rather
  than independently measured.
- [x] Define deterministic R/G patch-index policies. Do not infer a missing code
  by duplicating a neighbor without naming that candidate and testing its
  effect. Preserve the upstream repaired sequence as one comparison candidate.
- [x] Keep measured series-specific black readings and Summary black/white as
  separate facts; do not average them before generating a drift report.

### Color reductions

- [x] Reproduce the pinned upstream D65 polynomial EOTFs, RGB→XYZ matrix, and
  secondary/gray correction as `hcs-upstream-d65-v1`.
- [x] Implement `reference-d65-v1` with an explicit black policy:
  `XYZ = measured_black + black_subtracted_response`. Keep an upstream-black-
  omitted diagnostic for exact comparison.
- [x] Evaluate two documented interaction reductions:
  1. the upstream scalar corrections for Y/C/M/gray;
  2. measured Y/C/M interaction residuals with gray held out, followed by a
     gray-constrained candidate and an explicitly reported weighted 3D isotonic
     runtime projection.
- [x] Select the default reduction by finite-output, monotonicity, corner
  reproduction, gray-ramp, and perceptual-error gates—not by subjective game
  screenshots.
- [x] Generate a continuous 32×32×32 LUT in linear model space and a packed
  runtime texture. Trilinear interpolation must reproduce every
  integer code exactly within float tolerance.
- [x] Preserve absolute/relative reflectance separately from target exposure.
  Normalizing white for an emissive host must not destroy the measured
  black/white contrast ratio or chromatic relationships.

### Acceptance

- [x] Reproduce the pinned HCS D65 parameters within `1e-6` for parsed numeric
  values and independently regenerate measured-patch reports with declared
  comparison policies and tolerances.
- [x] Generate per-series XYZ, xyY, CIEDE2000, and CAM16-UCS reports for all
  accepted raw and repaired patches.
- [x] All 32³ entries are finite; model-space reflectance is non-negative; code
  endpoints and integer grid points are deterministic; no polynomial produces
  a negative high-code output in the released LUT.
- [x] The selected project reduction is no worse than the upstream reduction on
  measured corners and reports its held-out gray-ramp change explicitly.
- [x] Static CPU LUT sampling reproduces every integer RGB555 texel exactly.
  Shader agreement remains a mandatory WS8 integration gate before any CGB
  Shader or temporal path is accepted.

### Completion artifacts

`data/hcs-source-v1.json`, `data/color-reference-v1.json`,
`reference/color-reference.mjs`, `generated/ws1-color-audit-v1.json`,
`generated/cgb001-d65-lut-v1.*`, and static comparison fixtures.

## WS2 — Freeze the RGB555 source and frontend contract

**Status: complete (2026-08-24). No Shader was created.**

### Source contract

- [x] Define supported content: native CGB games and DMG games rendered through
  CGB RGB555 palettes. SGB borders and non-CGB post-processing remain outside
  the initial model unless separately specified.
- [x] Select and pin the initial libretro core path. Record exact core version,
  pixel format, 5-bit→host expansion, frame rate, native 160×144 viewport, and
  whether LCD color correction is applied.
- [x] Require core color correction and frame blending off to prevent double
  application of color or response.
- [x] Prove exact recovery of all 32 channel codes from the chosen core output.
  If recovery is ambiguous after host quantization, add a core-native metadata
  or LUT path instead of guessing.
- [x] Define reset, content load, save-state load, pause, fast-forward, rewind,
  run-ahead, subframe, and focus-loss behavior.

### Deterministic CGB ROM suite

- [x] Generate separate byte-stable ROMs for 32-code R/G/B/gray ramps;
  K/R/G/B/C/M/Y/W; mixed RGB patches; row markers; first/last-row changes;
  moving edges; checkerboards; isolated windows; alternating lines; parity;
  bounded retention stress/recovery; and pixel-grid identity.
- [x] Change dynamic pages/palettes only at documented events. Record exact ROM,
  source, tile/map, palette, expected framebuffer, page schedule, and duration
  hashes.
- [x] Add a pinned emulator smoke run and independent ROM decoder. Emulator
  screenshots alone are not panel or Shader evidence.

### Acceptance

- [x] All RGB555 codes round-trip through ROM → core → Shader source
  normalization with exact integer identity.
- [x] ROM and manifest generation are byte-stable and do not require proprietary
  Nintendo assets.
- [x] The frontend contract fails closed when color correction, core blending,
  unsupported subframes, or non-monotonic time would invalidate the model.

### Completion artifacts

- `data/frontend-contract-v1.json` and its policy/schema inputs
- 16 deterministic 32 KiB `.gbc` ROMs plus `generated/ws2-stimulus-v1/manifest.json`;
  the sixteenth drives all 32,768 RGB555 values through the actual core
- `generated/ws2-decoder-v1.json` from an independent byte-level ROM decoder
- `generated/ws2-gambatte-smoke-v1.json` from the pinned core built from the
  retained upstream tarball
- `generated/ws2-receipt-v1.json`
- `tools/build-cgb001-test-rom.mjs`, `tools/decode-cgb001-test-rom.mjs`,
  `tools/validate-cgb001-ws2-gambatte.mjs`, and `tools/build-cgb001-ws2.mjs`
- `npm run test:cgb-ws2`

## WS3 — Reconstruct active-matrix drive, row latch, and inversion

**Status: complete (2026-08-24). No Shader was created.** Exact frontend raster
time is frozen separately from unresolved physical panel edges; all CGB-specific
electrical constants remain nullable candidates.

### Evidence and candidates

- [x] Freeze exact CGB raster constants and distinguish PPU timing from panel
  signal timing.
- [x] Build a signal evidence table for `LDR0–5`, `LDG0–5`, `LDB0–5`, `DCK`,
  `SPL`, `LP`, `SPS`, `CLS`, `MOD`, `PS`, and `REVC`. Record existence,
  direction, timing, and function confidence independently.
- [x] Resolve or bound RGB555→six-line source-driver mapping. Do not assume the
  sixth line is bit replication without evidence.
- [x] Define named candidate sets for source latch, row optical onset, frame
  parity, and inversion topology. Exact Nintendo facts and Sharp-family transfer
  ranges remain separate fields.
- [x] Record supply rails and comparable gamma/VCOM topology without assigning
  unavailable CGB voltages to individual codes.

### Runtime reconstruction

- [x] Generate CPU scan/drive equations and future Shader constants from one normalized
  candidate record.
- [x] Split changed pixels at the accepted row latch so previous drive applies
  before the event and current drive after it.
- [x] Preserve a no-scan diagnostic whose equilibrium and endpoints are
  identical to the normal path.
- [x] Expose row phase, frame parity, inversion sign, source code, and effective
  drive as read-only debug views.
- [x] Keep the model local to each TFT pixel unless a CGB active-matrix circuit
  source establishes spatial electrical coupling.

### Acceptance

- [x] Exact timing constants reproduce their cited values; candidates stay
  inside declared bounds.
- [x] CPU and future-Shader float32 event equations agree for first, middle, last, and blanking
  rows across two frame parities.
- [x] Row timing changes causal onset only; constant fields and WS1 colors are
  invariant.
- [x] Candidate sensitivity reports show which visible results depend on latch
  or inversion assumptions.

### Completion artifacts

- `data/ws3-evidence-inventory-v1.json`
- `data/scan-candidates-v1.json` and `data/scan-candidates.schema.json`
- `reference/scan-drive.mjs`
- `generated/ws3-runtime-constants-v1.json`
- `generated/ws3-equation-vectors-v1.json`
- `generated/ws3-sensitivity-v1.json`
- `generated/ws3-receipt-v1.json`
- `tools/build-cgb001-ws3.mjs`
- `npm run test:cgb-ws3`

## WS4 — Build the period HR-TFT optical-response ensemble

**Status: complete (2026-08-24). No Shader was created.** The selected model is
the smallest symmetric first-order rate field compatible with the published
Sharp-family scalar bounds; it is not identified as an authentic CGB waveform.

### Source normalization

- [x] Normalize Sharp HR-TFT family response facts by GH/HCR mode, response
  definition, on/off versus gray, temperature, panel size, drive system, and
  measurement method.
- [x] Use the Sharp family values only as bounds: approximately 50/80 ms for
  HCR on/off/gray and 80/150 ms for GH on/off/gray. Do not label one number
  “the CGB response time.”
- [x] Add period a-Si TFT/TN literature only where it resolves transition shape,
  rise/fall asymmetry, temperature, or frame-rate conversion missing from the
  Sharp record.
- [x] Test monotone first-order, asymmetric first-order, and a minimal two-state
  LC reduction. Select the smallest causal model that satisfies family bounds,
  equilibria, and frame-integration tests.

### Ensemble and runtime tables

- [x] Define fast, nominal, and slow members spanning accepted HR-TFT family
  evidence. Keep GH-like/HCR-like hypotheses visible instead of silently
  choosing a product type.
- [x] Generate 3×32×32 per-channel GtG tables or the smallest equivalent
  continuous representation. Every cell records equation, direction, distance,
  ensemble, source class, and fallback.
- [x] Treat channel differences and temperature as uncertainty dimensions until
  transferable evidence supports distinct values.
- [x] Support future raw measured per-cell overrides without changing Shader
  architecture.
- [x] Make first-frame/current-frame fixed points exact and prevent continuous
  drift on a held input.

### Acceptance

- [x] Every ensemble reproduces its declared on/off and gray bounds under the
  same response definition.
- [x] CPU double precision and future-Shader float32 trajectories agree for all
  32×32 transitions at fixed timesteps.
- [x] All transitions are causal, bounded, finite, and converge to exact WS1
  endpoints without future-frame ghosts.
- [x] Fast/nominal/slow deterministic motion fixtures differ in response only;
  their settled color is byte-identical in model space.

### Completion artifacts

- `data/ws4-evidence-inventory-v1.json`
- `data/ws4-response-policy-v1.json`
- `data/response-ensemble-v1.json` and `data/response-ensemble.schema.json`
- `reference/optical-response.mjs`
- `generated/cgb001-ws4-gtg-rates-v1.r32f` and descriptor
- `generated/ws4-model-selection-v1.json`
- `generated/ws4-equation-vectors-v1.json`
- `generated/ws4-motion-fixtures-v1.json`
- `generated/ws4-receipt-v1.json`
- `tools/build-cgb001-ws4.mjs`
- `npm run test:cgb-ws4`

## WS5 — Integrate fixed-angle reflected exposure

**Status: complete (2026-08-24). No Shader was created.** WS1 XYZ is evaluated
along each continuous WS4 state path and time-averaged over the exact CGB frame.
The accepted fixed geometry is inherited once; no second angle gain is applied.

- [x] Compute optical exposure over the whole source frame rather than sampling
  only the end state. Integrate old/new drive segments around the WS3 row latch.
- [x] Evaluate color after continuous per-channel optical state, so transient
  mixed colors pass through the same WS1 D65 reflectance model as static codes.
- [x] Freeze 45° illumination, the source specimen orientation, and 0° view in
  metadata; preserve the unavailable numeric azimuth as `null` and expose no
  runtime angle control.
- [x] Collapse HCS/MRS fixed-geometry gain into the color reference exactly once.
  The display pass must not add a second arbitrary “45° gamma” correction.
- [x] Define `physical-reflectance` and optional host-normalized exposure as
  separate outputs. Target-device brightness stays downstream.
- [x] Preserve a static/no-temporal path that evaluates WS1 directly and agrees
  with the settled dynamic path.

### Acceptance

- [x] Numerical quadrature/substep convergence meets a declared error bound for
  the fastest ensemble and last visible row.
- [x] Constant input, no-scan, and scan-enabled outputs share exact equilibria.
- [x] One-frame top/middle/bottom transitions show the expected causal exposure
  ordering without changing final color.
- [x] Disabling dynamics returns exactly to the WS1 reference fixture.

### Completion artifacts

- `data/ws5-exposure-policy-v1.json`
- `data/exposure-integration.schema.json`
- `reference/reflected-exposure.mjs`
- `generated/ws5-equation-vectors-v1.json`
- `generated/ws5-quadrature-convergence-v1.json`
- `generated/ws5-scan-exposure-fixtures-v1.json`
- `generated/ws5-receipt-v1.json`
- `tools/build-cgb001-ws5.mjs`
- `npm run test:cgb-ws5`

## WS6 — Reconstruct RGB aperture and reflective-panel composition

**Status: complete (2026-08-24).**

- [x] Audit the highest-quality provenance-bearing OEM CGB microscope/macro
  imagery. Separate replacement panels, moiré, camera demosaic, and screen-lens
  reflections.
- [x] Promote left-to-right RGB vertical stripe only after at least two
  independent sources agree. Keep fill factor, notch, bus mask, and MRS
  microtexture as `generic-prior` or bounded candidates.
- [x] Start with a normalized equal-third RGB stripe kernel and explicit gap
  color derived from the fixed reference, not AGS BGR or `Authentic GBC` shape.
- [x] Integrate aperture over the host-pixel footprint at integer and fractional
  scales. Preserve area, color neutrality, phase, and edge/crop behavior.
- [x] Decide whether the target represents the bare measured panel or adds a
  separately bypassable generic front-lens/glare layer. The HCS measurement had
  case/glass removed; do not bake an unmeasured lens tint into WS1.
- [x] Do not render individual MRS microfacets. At the frozen viewing condition
  their aggregate optical effect belongs to WS1/WS5; any visible surface grain
  must be a low-energy, zero-mean, evidence-classified layer.

### Acceptance

- [x] Exact 4×/5×/6× and representative fractional fixtures conserve channel
  energy and average D65 color within declared tolerances.
- [x] RGB order, gap phase, borders, and crop remain stable under viewport
  offsets.
- [x] Disabling aperture returns the WS5 full-area output without brightness or
  chroma change.

### Completion artifacts

- `data/ws6-evidence-inventory-v1.json`
- `data/aperture-v1.json`
- `data/aperture.schema.json`
- `reference/rgb-aperture.mjs`
- `generated/ws6-aperture-validation-v1.json`
- `generated/ws6-receipt-v1.json`
- `tools/build-cgb001-ws6.mjs`
- `npm run test:cgb-ws6`

## WS7 — Add independent VCOM/residual-DC retention

**Status: complete (2026-08-24).**

- [x] Build a per-pixel excitation proxy from source code, WS3 row/parity, and
  each inversion candidate. Do not substitute displayed luma for electrical
  history without a documented bridge.
- [x] Normalize active-matrix image-sticking literature by stress voltage,
  polarity balance, duration, temperature, cell/alignment technology, and
  recovery definition.
- [x] Define low/nominal/high formation and recovery ensembles. Parameters
  remain `period-reconstructed`; no aged-CGB preset is invented.
- [x] Store slow state independently from WS4 ordinary response. If one scalar
  is insufficient, add a separate feedback texture rather than corrupting RGB
  endpoint state.
- [x] Add balanced uniform, isolated-window, checkerboard, unequal-duty,
  polarity reversal, stress-duration, and recovery fixtures.
- [x] Keep retention independently bypassable and low-amplitude in the normal
  profile until sensitivity gates justify the nominal member.

### Acceptance

- [x] Balanced constant input creates no undocumented spatial structure or
  drift.
- [x] Different code/polarity histories create different slow states while
  identical histories remain identical.
- [x] Ordinary moving edges are unchanged when retention formation is zero;
  WS4 alone still provides all short-term ghosting.
- [x] CPU and future-Shader equation stress/recovery trajectories agree across every WS3
  inversion candidate and reset/lifecycle event.

### Completion artifacts

- `data/ws7-evidence-inventory-v1.json`
- `data/retention-v1.json`
- `data/retention.schema.json`
- `reference/residual-dc-retention.mjs`
- `generated/ws7-retention-validation-v1.json`
- `generated/ws7-receipt-v1.json`
- `tools/build-cgb001-ws7.mjs`
- `npm run test:cgb-ws7`

## WS8 — Integrate Shaders, presets, metadata, and diagnostics

**Status: complete (2026-08-24).**

### Required presets

- [x] `reference-d65-v1`: nominal period response, fixed 45°/0° D65 color,
  accepted aperture, conservative validated retention.
- [x] `static-color-only-v1`: WS1 color with all temporal and aperture behavior
  disabled.
- [x] `response-fast-v1` and `response-slow-v1`: uncertainty endpoints with
  identical static color.
- [x] `no-scan-v1`, `no-retention-v1`, and `no-aperture-v1`: independent
  mechanism isolation.
- [x] `hcs-upstream-d65-v1`: exact upstream-color comparison policy, not the
  normal preset if measured black/interaction gates select another reduction.
- [x] Full self-contained diagnostic presets for source code, row phase,
  response state, exposure, LUT output, residual state, and aperture coverage.

### UI and metadata

- [x] Keep normal user controls small: model enable, optional response ensemble,
  optional retention amount, aperture amount, and model-level exposure. Do not
  expose unbounded engineering coefficients in the reference preset.
- [x] Remove/omit viewing-angle controls. The fixed geometry appears in preset
  name/metadata rather than as a misleading slider.
- [x] Label every debug/uncertainty preset and prevent it from inheriting stale
  parameter overrides from a normal preset.
- [x] Generate complete presets where the frontend cannot reliably apply thin
  `#reference` parameter overrides.

### Acceptance

- [x] All Shader stages compile to SPIR-V and request the intended float formats.
- [x] Preset hashes, LUT hashes, Shader hashes, model version, and source record
  appear in one generated manifest.
- [x] No diagnostic changes persistent state or settled WS1 color.

### Completion artifacts

- `shaders/cgb001-response-v1.slang`, `cgb001-color-v1.slang`, and
  `cgb001-display-v1.slang`
- fifteen complete normal, isolation, uncertainty, comparison, and diagnostic
  presets under `presets/`
- `generated/ws8-runtime-textures-v1.json`
- `generated/ws8-shader-compile-v1.json`
- `generated/ws8-manifest-v1.json`
- `generated/ws8-receipt-v1.json`
- `tools/build-cgb001-ws8.mjs`
- `npm run test:cgb-ws8`

## WS9 — Release validation and target acceptance

**Status: complete (2026-08-24).**

- [x] Build CPU golden vectors for every workstream and one end-to-end reference
  sequence covering static ramps, mixed colors, scan, motion, retention, reset,
  and aperture.
- [x] Add Shader-equation float32 simulation and actual GPU readback for endpoint
  state, exposure/color output, residual state, and aperture coverage.
- [x] Validate the chosen core/frontend contract with color correction and frame
  blending off, exact 160×144 input, normal `N=1`, and documented handling of
  pause/reset/load/non-monotonic time.
- [x] Run the CGB model on the KONKR target using a separate target preset. Record
  Vulkan compilation, allocated feedback formats, frame pacing, source/target
  refresh, viewport, screenshots for static evidence, and synchronized video/
  numeric traces for temporal evidence.
- [x] Compare against HCS static fixtures, SameBoy/libretro prior-art output, and
  deterministic motion scenes. Prior art is a difference report, never the
  acceptance truth.
- [x] Run sensitivity reports across color repair policy, response ensemble,
  latch/inversion candidates, retention range, and aperture variants.
- [x] Verify clean-checkout regeneration and stale-artifact rejection.

### Release gate

`reference-d65-v1` may become the default only when:

- [x] HCS source identity and all derived color artifacts reproduce;
- [x] all integer RGB555 codes match the generated LUT and static CPU/GPU paths;
- [x] response/scan are causal, bounded, stable, and CPU/GPU equivalent;
- [x] retention is independent, conservative, and lifecycle-safe;
- [x] aperture conserves average color/energy at integer and fractional scales;
- [x] frontend/device receipts use the exact released artifacts;
- [x] documentation distinguishes accepted measurement, derived color,
  period-reconstructed dynamics, generic aperture priors, and target
  compensation.

### Completion artifacts

- `generated/ws9-cpu-golden-v1.json`
- `generated/ws9-sensitivity-v1.json`
- `generated/ws9-prior-art-comparison-v1.json`
- `generated/ws9-preset-manifest-v1.json`
- `generated/ws9-receipt-v1.json`
- `targets/konkr-gt78-vn/960x640-srgb-neutral/validation/cgb001-ws9-target-20260824.json`
- five model-local and five target-local float-bit diagnostic presets
- `tools/build-cgb001-ws9.mjs`
- `tools/build-cgb001-ws9-receipt.mjs`
- `tools/analyze-cgb001-ws9-*.mjs`
- `npm run test:cgb-ws9`

## Delivery milestones

### M1 — Static measured-color slice

WS0 + WS1 + WS2. Delivers exact RGB555 source handling, fixed-angle D65 HCS
color, generated 32³ LUT, static Shader comparison, and deterministic ROMs. No
ghosting, scan, aperture, or retention claim.

### M2 — Causal HR-TFT motion slice

WS3 + WS4 + WS5. Delivers active-matrix row timing, period fast/nominal/slow
response, and exposure-integrated fixed-angle reflective color. This is the
minimum physics-informed temporal Shader.

### M3 — Panel appearance slice

WS6. Adds RGB aperture and reflective-panel composition without changing M1
color or M2 motion equilibria.

### M4 — Retention and release

WS7 + WS8 + WS9. Adds conservative period-reconstructed residual-DC retention,
all diagnostics/presets, and reproducible release receipts.

Implementation should proceed in milestone order. A later milestone may expose
an earlier assumption but must update the canonical reconstruction record and
regenerate dependent artifacts rather than patching a visual symptom in the
final display pass.
