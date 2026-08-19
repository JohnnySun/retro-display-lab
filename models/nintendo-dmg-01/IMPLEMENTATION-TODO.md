# DMG-01 reconstruction implementation to-do

Updated 2026-08-19 after completion of the full WS1-WS7 reconstruction and
KONKR target acceptance.

## Objective

Reproduce the perceived appearance of a healthy original-period Nintendo DMG
reflective STN panel as closely as the surviving evidence permits. This is not
a calibration of a forty-year-old specimen. DMG-specific documented color,
motion, geometry, timing, and driver evidence takes priority. Missing values
are supplied by measured 1988-1994 STN work at comparable technology level,
then by general nematic physics, and finally by an explicit bounded project
bridge.

The normal preset should look like a working DMG when shown on a modern target,
not like a generic green filter and not like a visibly deteriorated survivor.

## Status language

- **Complete** means the implementation and its workstream-specific acceptance
  evidence both exist.
- **Partial** means WS1 or WS2 already supplied useful implementation or
  evidence, but the workstream's own test matrix or completion gate remains
  open.
- **Pending** means no qualifying implementation has been accepted yet.
- **Superseded** means an earlier engineering bridge is retained only for
  regression or output comparison and is not part of the normal path.

Checked boxes are complete. Unchecked boxes are still required, even when the
surrounding workstream is marked partial.

## Non-negotiable evidence order

1. Use DMG-specific data directly when it exists. BGB's color-managed five
   optical states and DMG motion observations remain the primary perceptual
   reference.
2. Use contemporary measured STN data only for a missing DMG quantity, after
   recording response definition, temperature, duty, cell gap, viscosity, and
   whether the source was a deliberately optimized prototype.
3. Use mechanism papers to choose model shape, never to manufacture an
   unreported DMG constant.
4. Label every final bridge value `experimental`; keep its input range and
   transformation machine-readable.
5. Keep original-panel behavior separate from KONKR or any other modern target
   compensation.
6. When an original healthy DMG quantity can no longer be measured, do not
   leave it permanently arbitrary or zero merely because direct hardware is
   unavailable. Collect period industry measurements for every contributing
   physical parameter, build a versioned causal model, propagate the period
   ranges into nominal/fast-or-low/slow-or-high ensembles, and validate its
   outputs against surviving DMG observations. The missing DMG measurement
   remains explicit; the reconstruction is a calculated period expectation,
   not a recovered factory specification.

The canonical current record is
[`data/reconstruction-v1.json`](data/reconstruction-v1.json).

## Current reconstruction baseline

- [x] Preserve BGB's four driven colors plus the distinct LCD-disabled
  reflector color.
- [x] Interpolate adjacent BGB states in linear light. Four independently
  sampled BGB gradient midpoints match the model to a maximum of one 8-bit code
  per channel.
- [x] Keep the `70/80` aperture proportion as a BGB idealized-reference seed,
  not a physical measurement.
- [x] Generate ordinary motion from DMG passive-matrix voltage, bounded period
  material properties, director dynamics, and reflected optics.
- [x] Keep the old `100/200 ms` response split and low-dimensional timing fit
  only as a **superseded** output-comparison envelope. The normal Shader has no
  endpoint response-time, slow-tail, gray-drag, or distance-drag input.
- [x] Keep long-exposure ionic retention separate from ordinary director
  motion.
- [x] Apply the WS5 period-bounded distributed-RC reconstruction in the normal
  preset (`RowCrosstalk=1`, `ColumnCrosstalk=1`). These values are
  dimensionless multipliers of the generated nominal coefficients; zero is
  retained only as an isolation diagnostic. Passive-matrix non-selected
  voltage remains part of the WS2 physical drive model.
- [x] Request `R32G32B32A32_SFLOAT` for the persistent response state and verify
  its allocation on the KONKR Vulkan frontend.

## Completed foundations

### WS1 - BGB optical and perceptual reference

**Status: complete 2026-08-18.**

- [x] Store the five sampled sRGB states and BGB gradient midpoint facts in the
  reconstruction record without redistributing the source images.
- [x] Validate palette ordering, linear-light interpolation, and midpoint
  error automatically.
- [x] Keep target brightness/chroma compensation outside the model preset.
- [x] Build a deterministic static comparison scene containing the five
  optical states, four logical shades, contrast-wheel endpoints, and pixel
  gaps.
- [x] Record exact crop coordinates and hashes for independently sampled BGB
  image facts.
- [x] Produce a CIEDE2000 report for model output versus BGB's palette and
  shade-gradient images.
- [x] Preserve the BGB palette as the highest-weight color source unless a more
  complete DMG-specific color-managed dataset is found.

Generated artifacts are [`generated/ws1-static-v1.png`](generated/ws1-static-v1.png)
and [`generated/ws1-perceptual-v1.json`](generated/ws1-perceptual-v1.json).
`node tools/build-dmg01-ws1.mjs --check` reproduces both. Supplying
`--verify-sources <directory>` additionally verifies the linked BGB files by
SHA-256, dimensions, and every recorded sample coordinate.

### WS2 - Period-STN physical reconstruction

**Status: complete 2026-08-19.**

The normal Shader is a mobile runtime reduction of this causal chain:

`DMG row/column drive -> pixel RMS voltage -> director dynamics -> reflected optical response -> Shader surrogate`.

The electrical step is a declared cycle-averaged RMS reduction of the inferred
1/144 multiplex waveform. It preserves the relevant dielectric `E^2` drive for
the slow director response; it is not a claim that the unavailable DMG analogue
waveform has been measured.

- [x] Normalize historical response anchors by response definition,
  temperature, duty, cell gap, viscosity, twist, optical configuration, and
  prototype/production status.
- [x] Reconstruct selected and non-selected pixel voltage from the DMG driver
  topology, captured digital timing, Alt-Pleshko multiplex physics, contrast
  scale, polarity inversion, and inferred four-shade dwell fractions.
- [x] Build a versioned 1988-1990 material envelope containing temperature-
  dependent rotational viscosity, `K11/K22/K33`, dielectric anisotropy,
  birefringence, cell gap, twist, chiral pitch, pretilt, and anchoring energy.
- [x] Implement and test a one-dimensional Frank-Oseen director solver with a
  declared overdamped Ericksen-Leslie reduction and finite anchoring.
- [x] Convert the depth-dependent director profile to reflected spectral output
  with a sliced Jones solver containing STN twist, birefringence, polarizers,
  reflector, and wavelength sampling.
- [x] Propagate unknown drive and material inputs through nominal,
  plausible-fast, and plausible-slow physical ensembles.
- [x] Generate the 65-bin director-drift and director-to-optical LUTs consumed
  by the Shader; do not hand-author response coefficients.
- [x] Integrate each equilibrium adaptively to an angular convergence gate;
  record zero-field relaxation, energy, timestep, grid, static shade, and
  runtime-surrogate validation.
- [x] Anchor all four nominal director equilibria as zero-drift runtime fixed
  points and exact optical shades; verify a 600-frame constant-input hold on
  the normal `N=1` path.
- [x] Keep ionic image sticking as a separate slow mechanism rather than using
  it to manufacture ordinary frame motion.
- [x] Remove `DarkenResponse`, `ClearResponse`, `SlowTail`, `SlowRateScale`,
  `GrayDrag`, and `DistanceDrag` from the normal runtime path.
- [x] Verify generated-artifact identity, Mali Vulkan compilation, RGBA32F
  feedback, and causal test-ROM output on the KONKR target.
- [x] Preserve actual DMG analogue levels, fill material, polarizer spectra,
  and exact LD0/LD1-to-CPG truth table as explicit unknowns.

Completion artifacts are `data/dmg-drive-v1.json`,
`data/stn-material-ensemble-v1.json`, `reference/stn-physics.mjs`,
`generated/ws2-stn-physics-v1.json`, and the generated
`shaders/dmg01-stn-surrogate.inc`. The nominal deepest transition reaches T90
at roughly 0.28 s as a solver output; it is not an input target.

## Completed workstreams in implementation order

### Priority 1: WS3 - DMG row timing and causal scanout

**Status: complete 2026-08-19.** The Shader now splits each changed pixel's
physical integration at its captured CPL line-end latch. CPU and exact-4x KONKR
evidence confirm the row phase while settled fields remain uniform.

Already available:

- [x] Record 144 visible rows, 160 columns, 59.7275 Hz nominal refresh, and the
  captured 108.724 us mean line period in the drive record.
- [x] Record the DMG-LCD-06 `LD0/LD1`, `CP`, `CPL`, `ST`, `S`, `FR`, and `CPG`
  routing and clearly separate schematic topology from captured behavior.

Completed:

- [x] Add a stable primary-source record for the complete 144-visible plus
  10-blank-line frame structure and the observed behavior of `LD0/LD1`, `CP`,
  `CPL`, `ST`, and `S`.
- [x] Define the row-latch phase. Keep any line-center convention classified as
  an experimental project bridge until a source establishes it; PPU mode timing
  alone is not panel optical onset.
- [x] Split every changed pixel's frame integration at its row latch using
  `OriginalHistory1`: the previous drive applies before the latch and the
  current drive afterward.
- [x] Preserve a no-scanout diagnostic path so director response can be tested
  independently from row timing.
- [x] Add first-row, last-row, unchanged-pixel, same-row transition, and
  cross-frame causal tests.
- [x] Demonstrate that enabling row timing changes only causal onset and does
  not alter constant-frame equilibrium or the physical transition endpoints.

Completion gate: the CPU reference and Shader must agree on row-split waveforms,
and a deterministic ROM must visibly distinguish first-row from last-row onset
without changing static BGB color.

Completion artifacts are `data/dmg-scan-timing-v1.json`,
`reference/scanout-timing.mjs`, `generated/ws3-scanout-v1.json`, the normal
response Shader, and the target receipt
`../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws3-20260819.json`.
The receipt also records a frontend compatibility correction: on this Android
automatic-preset route, simple-preset parameter overrides were not applied, so
DMG diagnostic and target presets are generated as complete full presets.

### Priority 2: WS7 - Frontend and KONKR target acceptance

**Status: complete 2026-08-19.** The versioned frontend contract, deterministic
scene ROMs, numeric GPU comparison, frame-pacing samples, and real-device
lifecycle receipt now qualify the normal forward path on the named KONKR unit.

Already available:

- [x] Record the KONKR device, Android version, Mali GPU, RetroArch 1.22.2,
  Vulkan driver, Gambatte core, 160x144 geometry, reported 59.73 core FPS, and
  response-pass `R32G32B32A32_SFLOAT` allocation.
- [x] Run the physical preset with Gambatte frame mixing disabled in an isolated
  validation configuration.
- [x] Generate and run a deterministic full-screen shade-transition ROM and
  retain hashes for the ROM, logs, Shader inputs, and two output captures.
- [x] Preserve the user's Gambatte override and global RetroArch configuration.

Completed:

- [x] Record source refresh, measured target refresh/frame pacing, shader
  subframes, run-ahead, rewind, fast-forward, and relevant core options for
  every temporal acceptance run.
- [x] Add a validator or documented launch contract that requires Gambatte
  frame mixing off while the physical preset is active.
- [x] Test first-frame initialization, reset, content reload, save-state load,
  pause/resume, focus loss, and clean shutdown/relaunch.
- [x] Define a static bypass or safe history reset for unsupported rewind,
  run-ahead, fast-forward, and other non-monotonic time operations.
- [x] Measure stable 59-61 fps/frame pacing on the KONKR target; the core's
  reported 59.73 fps is not an instrumented performance result.
- [x] Expand the test ROM into repeatable multi-shade, moving-edge, alternating-
  row, and row-timing scenes.
- [x] Capture synchronized motion evidence. Static screenshots remain valid
  only for color/aperture evidence.
- [x] Add floating-point feedback readback or another declared numeric GPU
  comparison before claiming complete CPU-to-GPU equivalence.

Completion gate: one versioned receipt must cover configuration, lifecycle,
frame pacing, precision, synchronized causal scenes, restoration, and all known
frontend time-manipulation boundaries.

Completion artifacts are `data/frontend-contract-v1.json`,
`presets/ws7-numeric-state-v1.slangp`,
`../../targets/konkr-gt78-vn/960x640-srgb-neutral/retroarch/dmg01-temporal.cfg`,
the deterministic ROM generator, the numeric GPU report, and
`../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws7-20260819.json`.
Three SurfaceFlinger windows measured `60.248-60.291 fps` with no doubled
intervals. The settled four-state GPU comparison remained within four 8-bit
codes after RGB565 presentation. Quick Menu state hashes were identical across
a three-second pause, save/load toasts were observed, focus loss preserved the
PID, and Close Content returned cleanly to the unloaded frontend.

### Priority 3: WS6 - Pixel aperture and reflector shadow

**Status: complete 2026-08-19.** Periodic aperture and active/shadow joint
integration now conserve the selected geometry at exact and fractional scales;
CPU fixtures and KONKR 4x/3.5x evidence both pass.

Already available:

- [x] Render rectangular dots over a distinct LCD-disabled reflector state.
- [x] Integrate the rectangular aperture over each host-pixel footprint so the
  subpixel-width gap survives exact 4x output.
- [x] Keep the BGB-indicated reflector-shadow direction in a separate geometric
  layer rather than baking it into palette colors.
- [x] Classify `PixelFill`, edge/softness, shadow strength, and offsets as
  reference-image candidates, not measured DMG geometry.

Completed:

- [x] Add deterministic exact 5x and 6x fixtures.
- [x] Add representative fractional-scale and viewport-offset fixtures.
- [x] Verify that aperture integration conserves the intended BGB state average
  across scale instead of merely making the screen darker or yellower.
- [x] Add edge, corner, crop, and non-integer viewport tests so the grid cannot
  disappear, shimmer, or change phase unexpectedly.
- [x] Promote geometry values only if a documented DMG macro or microscope
  source supplies physical dimensions; otherwise retain their experimental
  classification.

Completion gate: exact and fractional scale fixtures must agree on average
linear-light output within a declared tolerance while retaining a stable gap
and shadow direction.

Completion artifacts are `reference/aperture-geometry.mjs`, five deterministic
`generated/ws6-aperture-*.png` fixtures, `generated/ws6-aperture-v1.json`, and
the target receipts `dmg01-ws6-scale-v1.json` / `dmg01-ws6-20260819.json`.
WS6 exposed and fixed two real defects: the old single-cell integral lost the
footprint portion that wrapped across a cell boundary, and multiplying two
separately averaged masks made shadow energy depend on scale. The corrected
periodic and joint integrals preserve aperture area `0.765625` and shadow-gap
area `0.191875`; presented KONKR 4x versus 3.5x linear RGB differs by at most
`0.00144461` under the declared `0.002` tolerance. The BGB geometry itself
remains experimental rather than being promoted to measured DMG dimensions.

### Priority 4: WS4 - Long-exposure image retention

**Status: complete.** The independent ionic state now uses a period-protocol-
constrained first-order reconstruction. The optical gain remains a separately
bounded bridge because no pristine DMG long-exposure optical trace survives.

Already available:

- [x] Recompute Nakazono's eleven-row material regression as the only direct
  numeric image-sticking anchor.
- [x] Keep the paper's residual-image voltage result separate from the
  project's `StickingOpticalGain` voltage-to-optical bridge in the
  reconstruction record and Shader comments.
- [x] Store ionic charge independently from the director and displayed optical
  state in the RGBA32F feedback texture.
- [x] Keep retention low-amplitude in `reference-v1` and reserve the 60x
  accelerated 30-minute protocol for `merck-1994-debug-v1`.
- [x] Verify that the ordinary motion path does not consume ionic values as
  director-response coefficients.

Completed:

- [x] Search contemporary passive-matrix STN sources for time-resolved ion
  adsorption and release curves. Import a rate only when units, temperature,
  waveform, duty, and material context are known.
- [x] Produce a generated WS4 report that distinguishes measured regression,
  measured residual-voltage window, inferred DMG exposure, and experimental
  optical gain/rates.
- [x] Add no-change equilibrium, monotone charge, monotone release, bounded
  optical bias, and long-run RGBA32F convergence tests.
- [x] Prove that the 60x diagnostic reaches the same state as the normal
  30-minute protocol within a declared tolerance.
- [x] Add interruption and scene-change tests so accelerated debug state cannot
  contaminate normal use.

Completion gate: every retention rate must be either literature-derived with
complete measurement context or visibly experimental, and normal/accelerated
integrations must agree numerically.

Completion artifacts are `data/stn-retention-evidence-v1.json`,
`reference/ionic-retention.mjs`, `generated/ws4-retention-v1.json`, the
deterministic `retention-window` ROM scene, and target receipts
`dmg01-ws4-gpu-retention-v1.json` / `dmg01-ws4-20260819.json`. The 60x target
run reached charge `0.9961`; after 14 real seconds of release (840 equivalent
seconds), the observed ratio was `0.69170` versus `0.69977` predicted. The
inactive half remained exactly zero and both trajectories were monotone.

### Priority 5: WS5 - Passive-matrix spatial crosstalk

**Status: complete 2026-08-19.** WS2 models non-selected pixel voltage and
selection-ratio loss; WS5 now separately reconstructs position- and pattern-
dependent whole-row and whole-column electrical loading. Because no pristine
DMG panel remains available for direct measurement, the result is a calculated
healthy-period expectation from contemporary conductor, driver, dielectric,
geometry, timing, and passive-matrix evidence—not a recovered Nintendo factory
coefficient.

Completed:

- [x] Derive passive-matrix selected/non-selected RMS voltage and selection loss
  from the same drive model used by director dynamics.
- [x] Replace the former zero-valued placeholder with the calculated nominal
  surrogate. `RowCrosstalk=1` and `ColumnCrosstalk=1` select that result;
  `0` disables it for an isolation test.
- [x] Remove the unsupported visual-mixing interpretation. The Shader taps now
  reduce a distributed electrical network and perturb continuous drive before
  the WS2 director/optical integration.
- [x] Keep spatial crosstalk distinct from an ordinary Gaussian blur.
- [x] Collect period production ranges for transparent-electrode sheet
  resistance, row/column geometry, driver output resistance, liquid-crystal
  cell capacitance/conductance, multiplex duty/bias, line settling time, and
  temperature. Keep measurement definition, year, panel class, and provenance
  for every value.
- [x] Build a distributed row/column RC network from those ranges and the DMG
  `160x144`, `1/144`, `108.7 us` drive. Calculate position- and pattern-
  dependent electrode voltage rather than assigning a visual mixing number.
- [x] Feed the calculated pixel-voltage error through the existing WS2
  voltage/director/reflective-optical model to derive the visible crosstalk
  state. Do not fit a blur or select the final optical coefficient first.
- [x] Propagate the period parameter ranges into nominal, plausible-low, and
  plausible-high ensembles. Report sensitivity, uncertainty, and whether each
  bound is material-, driver-, geometry-, or temperature-dominated.
- [x] Reduce the distributed solver into a documented whole-row/whole-column
  Shader surrogate, and record its error against the full network on canonical
  patterns.
- [x] Add single-dot, full-row, full-column, checkerboard, alternating-line,
  window, and inverse-window diagnostics.
- [x] Record approximation error and ensure constant fields remain unchanged.
- [x] Use surviving DMG photographs or captures only as output validation for
  direction and plausible magnitude; do not use an aged specimen to identify
  pristine electrical parameters.
- [x] Replace the temporary zero coefficients with the calculated nominal
  surrogate only after all physical, uncertainty, pattern, CPU/Shader, and
  KONKR runtime gates pass. A calculated negligible value is acceptable only
  if the model itself produces it.

Completion gate: spatial loading enters the normal preset only after a
versioned period-parameter dataset, distributed electrical solver, WS2 optical
coupling, bounded ensemble, pattern suite, declared surrogate error, CPU/Shader
agreement, KONKR runtime receipt, and clear separation from optical blur all
pass. WS5 cannot be marked complete merely because direct DMG measurement is
impossible or because the temporary coefficients remain zero.

Completion artifacts are
`data/passive-matrix-crosstalk-evidence-v1.json`,
`reference/passive-matrix-crosstalk.mjs`,
`reference/passive-matrix-crosstalk-lumped.mjs`,
`generated/ws5-crosstalk-lumped-v2.json`, the generated constants plus
phase-local reduction, row-load and per-column summary passes, the two WS5
isolation/numeric presets, and target receipt
`dmg01-ws5-common-mode-20260819.json`. The earlier image-fitted directional
kernel is retained only as rejected historical evidence. The replacement is
derived by summing electrode KCL equations and has no training patterns or
image coefficients. Nominal full-network error is `0.004733` shade RMS,
`0.019108` p99 and `0.020453` maximum; float32 error is `0.000059` and the
phase-boundary residual is `0.000335` shade. The five-pass Mali path compiles
without error. A later mixed-tone mino regression found that the per-shade
uniform baseline could over-correct shade 2 into shade 3 even after a piece
settled; the former all-shade-3 fixture could not detect it. The runtime now
limits the uncertain common-mode correction to `±0.125` shade and the generated
gate requires at least `0.75` shade between the dark adjacent tones.

## Project definition of done

- [x] Generate the physical LUT/include artifacts from versioned reconstruction
  records and cross-check every normal `reference-v1` mechanism parameter; no
  undocumented numeric override is accepted by the validator.
- [x] Pass BGB palette and gradient checks within the declared one-code sampling
  tolerance.
- [x] Allow temporal response, row scanout, retention, spatial crosstalk,
  aperture, and target compensation to be disabled and tested independently.
- [x] Record the original measurement definition for every historical numeric
  value and keep every missing-DMG bridge visibly experimental across all
  workstreams.
- [x] Demonstrate CPU reference, generated surrogate, and GPU output agreement
  within declared numerical tolerances. The WS7 settled-state comparison
  includes the final RGBA8/RGB565 presentation quantization. The original
  artifact passed at four codes; the post-fixed-point v2 artifact passes at
  five codes against the same six-code tolerance and remains byte-identical
  over a ten-second constant-input hold.
- [x] Re-run the reviewed fixed-point Shader on KONKR with normal `N=1`
  feedback and a 602-frame Tetris motion capture; retain directional
  intermediate-shade persistence without stationary-graphic drift.
- [x] Pass the complete WS7 frontend, lifecycle, frame-pacing, precision, and
  synchronized target-runtime contract with the normal preset.
- [x] Keep the final claim bounded to a best-effort reconstruction of a healthy
  period-DMG appearance, never a measurement of a particular surviving panel.

## Current execution order

All workstreams, target-specific acceptance gates, and the repository-wide
validation run are complete. Remaining release work is limited to the scoped
commit and remote push.

Do not reopen WS2 merely to tune an observed response time. Reopen it only if
new evidence invalidates the drive/material/optical model, a convergence or
surrogate gate fails, or the runtime ceases to be generated from the physical
artifacts.
