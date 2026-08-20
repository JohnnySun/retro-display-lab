# Nintendo GBA SP AGS-101 implementation plan

Status: WS1–WS8 implemented; promoted to period reconstruction, 2026-08-20.

## Outcome

The existing AGS-101 `physics-seed` has been promoted to the evidence-bounded
`period-reconstruction` model. An authentic AGS-101 motherboard, panel, and synchronized
electrical/optical measurement rig are not available and are not completion
requirements. The current implementation already provides the color pipeline,
temporal-state architecture, analytic/table GtG interface, scan model,
diagnostics, and CPU validation scaffold. This plan covers the remaining work
needed to close the defensible gap with the DMG-01 model using preserved direct
measurements, primary hardware records, manufacturer-family documentation,
period literature, and explicit uncertainty envelopes.

The target is not “looks more like an AGS-101.” The target is a model in which:

- static color comes from the pinned HCS AGS-101 measurement record;
- dynamic response is a named fast/nominal/slow ensemble constrained by
  period-appropriate TFT literature and the closest traceable Sharp
  manufacturer-family data;
- exact GBA scan facts remain separate from reconstructed latch, inversion,
  drive, and optical-delay hypotheses;
- retention responds to spatial code/polarity history only inside a named
  reconstruction profile whose electrical assumptions are inspectable;
- aperture and backlight behavior use traceable archival evidence where it is
  sufficient and otherwise remain generic priors or unknown;
- frame output integrates emitted light over the observation interval;
- CPU, GPU, sensitivity, and target-device results are tied to the same artifact
  hashes.

The result is not a specimen calibration and must not be presented as one. Any
future capture from an authentic panel creates a separate specimen-specific
profile unless multiple-unit evidence supports replacing the period
reconstruction.

## Non-negotiable rules

- Preserve source-panel reconstruction and target-device compensation as
  separate layers.
- Never promote a tuned, synthetic, or literature-derived value to “measured.”
- Classify every input as direct AGS-101 measurement, primary hardware artifact,
  exact platform timing, manufacturer-family datasheet, period literature,
  derived constraint, project prior, qualitative observation, or unknown.
- Preserve raw capture, normalized data, fitted model, generated runtime
  artifact, and acceptance report as separate stages.
- Every numeric physical value has units, an uncertainty/range, a stable
  evidence ID, and scope metadata. Specimen metadata is required only for
  specimen measurements.
- Static color must not change when temporal mechanisms are disabled.
- CPU reference equations must agree with shader equations before a profile can
  become the default.
- Unknown hardware behavior remains unknown or becomes a named hypothesis;
  signal names, visual tuning, and repeated community claims are not substitutes
  for a circuit or measurement.
- Authentic hardware acquisition is optional future evidence, not a hidden
  release gate.

## Priority and evidence map

| Workstream | Priority | Required evidence basis | Result |
| --- | --- | --- | --- |
| WS1 — baseline truth | P0 | none | consistent claims, defaults, presets, and hashes |
| WS2 — stimulus/tooling | P0 | none initially | deterministic ROM and capture pipeline |
| WS3 — timing reconstruction | P1 | platform timing, schematics, board/panel artifacts | bounded latch, parity, inversion, and drive hypotheses |
| WS4 — optical response ensemble | P1 | manufacturer-family data and period TFT literature | traceable fast/nominal/slow GtG profiles |
| WS5 — retention reconstruction | P1 | WS3/WS4 hypotheses and period mechanisms | bounded spatial code/polarity-history model |
| WS6 — panel optics | P2 | pinned HCS data and archival panel evidence | measured static color plus bounded backlight/aperture models |
| WS7 — exposure output | P2 | WS3/WS4/WS6 ensembles | exposure-integrated presentation and uncertainty bounds |
| WS8 — release validation | P0 gate | target frontend/device | reproducible CPU/GPU/device receipts |

## WS1 — Freeze a truthful baseline

Implementation status: repository work and the current-artifact KONKR
compilation/presentation receipt completed on 2026-08-20. WS8 now adds current
three-pass float exposure/retention readback and aperture-energy target evidence.

### Implementation

- [x] Resolve the `DriveCodeCoupling` inconsistency. Research prose previously
  described zero as the conservative default while the formal preset uses
  `0.15`. The canonical default is now the already validated `0.15` project
  prior; preset, shader, metadata, research prose, and validator agree.
- [x] State explicitly that the current `DriveDcOffset` path produces uniform
  imbalance/recovery, not spatial image-history retention.
- [x] Inventory every active parameter as measured, literature-derived,
  project-derived, target-compensation, or synthetic fixture.
- [x] Re-audit thin diagnostic presets that relied on inherited `#reference`
  parameter overrides. All model diagnostics and the KONKR target route are now
  generated as self-contained full presets.
- [x] Recompute and validate current-checkout hashes for the shaders, presets,
  generated color data, GtG artifacts, evidence inventory, and target preset.
- [x] Replace the historical table-path device evidence with a current-artifact
  KONKR receipt covering the fast/nominal/slow reconstructed LUTs and the exact
  target preset.
- [x] Freeze a machine-readable neutral/static baseline with all temporal
  mechanisms disabled.

### Acceptance

- [x] `model.json`, `REFERENCES.md`, research notes, presets, and validation
  reports agree on defaults and evidence classes.
- [x] No user-facing claim implies spatial image sticking before WS5 passes.
- [x] Repository hashes and CPU neutral/static golden vectors reproduce from a
  clean checkout through `tools/build-ags101-ws1.mjs --check`.
- [x] Current-artifact target compilation and presentation captures reproduce
  on the named KONKR device.

## WS2 — Build deterministic stimulus and capture tooling

Implementation status: repository pipeline and pinned mGBA smoke receipt
complete on 2026-08-20. Original GBA execution remains optional.

### Test ROM

- [x] Add an open, deterministic GBA ROM suite that emits exact RGB555 codes.
- [x] Include neutral ramps, per-channel ramps, mixed patches, row markers,
  alternating parity frames, checkerboards, isolated windows, and configurable
  stress/recovery sequences.
- [x] Give each scene a stable ID, source hash, expected frame sequence, and
  frame/row timing manifest.

### Data pipeline

- [x] Define electrical and photodiode capture schemas with clock, sample rate,
  units, probe position, panel/unit identity, temperature, brightness mode,
  charger state, warm-up time, and uncertainty.
- [x] Extend the GtG importer to ingest repeated raw waveforms, while keeping the
  current table schema as a generated runtime artifact.
- [x] Add synthetic loopback fixtures for timestamp alignment, noisy plateaus,
  missing samples, censored settling, fit rejection, and table generation.
- [x] Make every runtime coefficient traceable back to ROM scene, row, raw
  samples, normalization, and fit report.

### Acceptance

- [x] ROM and manifest builds are byte-stable in the documented environment.
- [x] Synthetic captures pass normalization, fitting, artifact generation, and
  report generation without manual edits.
- [x] Raw input is never overwritten by normalization or fitting.
- [x] Boot every generated ROM and confirm scene/page timing on pinned mGBA;
  record the exact core and artifact hashes. Original GBA execution is an
  optional compatibility receipt, not a completion requirement.

## WS3 — Reconstruct electrical drive and scan timing

Implementation status: repository reconstruction complete on 2026-08-20.
Evidence inventory, hardware identity, signal matrix, exact raster constants,
unselected candidate sets, WS2 gate, generated CPU/Shader equations, candidate
presets, independent diagnostics, compilation, and sensitivity acceptance all
pass. Future direct hardware evidence may refine the candidates but is not a
completion gate.

### Evidence audit

- [x] Freeze exact platform facts from primary GBA timing documentation: native
  clock, cycles per line, visible and blanking rows, frame period, row order,
  and source RGB555 update semantics.
- [x] Record the authenticated AGS-101 hardware identities already located in
  archival teardown records: `C/AGT-CPU-01` and panel label
  `LQ029B1DC01F`. Keep identity evidence separate from electrical inference.
- [x] Inventory AGS-001 schematics, GBA LCD interface documentation, AGT board
  photographs, connector markings, patents, and period Sharp interface
  material. Label cross-model topology transfer explicitly.
- [x] Build a signal evidence table for DCK, LP, SPS, MOD, REVC, COM, segment,
  brightness control, and panel supplies. For each signal, record whether its
  existence, direction, timing, and function are known independently.
- [x] Search archives for an exact `LQ029B1DC01F` specification. If none is
  found, record the unsuccessful search scope and do not substitute a nearby
  part number as if it were exact.

### Reconstruction and integration

- [x] Generate a machine-readable timing-constraint record separating exact
  platform constants from ranges and discrete topology hypotheses.
- [x] Define named candidate sets for source latch phase, row optical delay,
  frame parity, inversion topology, and brightness coupling. Include the
  existing half-line latch and zero optical-delay behavior only as explicit
  candidates.
- [x] Audit physical candidate bounds from circuit topology and period
  documentation. No exact AGT circuit or panel specification supports narrower
  bounds, so the record deliberately retains broad runtime/sensitivity bounds.
- [x] Generate CPU timing fixtures and Shader equations from the same normalized
  constraint record; no AGS-101-specific candidate is selected as a default.
- [x] Expose parity, inversion, row, latch, and optical events as independent
  read-only diagnostics.
- [x] Make profile selection and uncertain timing values visible in metadata and
  debug output.

### Acceptance

- [x] Exact timing facts reproduce their cited source values; reconstructed
  values stay inside their declared bounds.
- [x] No connector label or AGS-001 circuit becomes an AGS-101 fact without an
  explicit transfer argument and evidence class.
- [x] CPU and Shader equations agree for every generated candidate profile, and
  all four Shader stages pass glslang/SPIR-V validation.
- [x] Sensitivity tests show which visible behaviors change across latch,
  inversion, and optical-delay hypotheses.
- [x] Timing diagnostics do not alter persistent simulation state.

## WS4 — Replace synthetic GtG with a literature-constrained ensemble

### Source and transferability audit

- [x] Preserve the exact-panel datasheet search record from WS3.
- [x] Collect the closest traceable Sharp manufacturer-family specifications and
  period a-Si TFT/TN response literature, including temperature, transition
  definition, drive voltage, rise/fall asymmetry, overshoot, and measurement
  method.
- [x] Score every source for date, panel technology, size/resolution, drive
  architecture, temperature, and definition compatibility. A nearby Sharp
  model constrains a range; it does not identify the AGS-101 response.
- [x] Keep community ghosting reports and uncontrolled video comparisons as
  qualitative direction checks only. They cannot supply milliseconds or a GtG
  table cell.
- [x] Test whether first-order monotone response is compatible with the accepted
  source envelope. Add asymmetry or extra state only when the source family or
  required invariants justify it.

### Ensemble construction

- [x] Define fast, nominal, and slow profiles spanning accepted period evidence,
  with separate rise/fall and short-/long-distance transition behavior where
  justified.
- [x] Generate the 3×32×32 runtime tables from documented equations and source
  bounds. Mark generated cells as reconstructed, never measured or interpolated
  measurements.
- [x] Represent channel differences, brightness-mode effects, and temperature
  dependence as uncertainty dimensions unless a transferable source resolves
  them.
- [x] Retain raw per-cell override support so future authentic-panel waveforms
  can create a separate specimen profile without redesigning the runtime.
- [x] Keep the current analytic and synthetic-capture artifacts as test fixtures,
  not the period-reconstruction default.

### Acceptance

- [x] Every table cell identifies its equation, source class, parameter range,
  selected ensemble member, and fallback behavior.
- [x] Coverage reports expose unsupported transition dimensions instead of
  disguising generated values as measurements.
- [x] CPU double-precision and Shader-equation float32 traces agree at fixed
  timesteps for every ensemble member within the declared tolerance.
- [ ] Capture an actual GPU numeric readback for every ensemble member; this is
  reserved for the target-instrumentation work in WS8 and is not claimed by
  the repository equation receipt.
- [x] The released comparison set renders fast, nominal, and slow receipts for
  the same deterministic motion stimuli.
- [x] The synthetic GtG fixture remains test-only and is not the reconstructed
  reference default.

## WS5 — Reconstruct spatial drive retention

### Model

- [x] Define a per-pixel excitation proxy
  `u(x, y, code, polarity, row, column, time)` from held source code and each
  accepted WS3 topology hypothesis. Do not assign physical voltage units unless
  a traceable transfer establishes them.
- [x] Connect code, candidate VCOM/feedthrough imbalance, frame parity, and each
  accepted inversion hypothesis to that proxy.
- [x] Do not use displayed luma as an undocumented electrical substitute.
- [x] Audit period TFT image-sticking and charge-balance literature for
  mechanisms transferable to the reconstructed panel class. Keep the current
  fast/slow branches only when their semantics can be tied to those mechanisms;
  otherwise retain the existing global imbalance/recovery path and declare
  spatial retention out of scope.
- [x] Add asymmetry or state only when a cited mechanism requires it.
- [x] Preserve zero-balance, static-frame, reset, discontinuity, and `N=1`
  bypass invariants.

### Fixtures

- [x] Add uniform-field, checkerboard, isolated-window, polarity-reversal,
  unequal-duty-cycle, stress-duration, and recovery-duration tests.
- [x] Run fixtures across the WS3 topology candidates and WS4 response ensemble.
- [x] Reserve specimen-specific parameters for future measurements; do not
  invent an aged-specimen profile.

### Acceptance

- [x] When the spatial reconstruction is enabled, different code/polarity
  histories produce different slow states; identical histories remain
  identical within tolerance.
- [x] A balanced uniform field creates no undocumented spatial structure or
  future-frame ghost.
- [x] CPU and GPU state trajectories agree for all stress/recovery fixtures.
- [x] Disabling retention returns to the frozen WS1 baseline.
- [x] Metadata and UI describe the mechanism as reconstructed, not measured
  AGS-101 image sticking.

## WS6 — Consolidate color and reconstruct aperture/backlight

Implementation status: repository reconstruction completed on 2026-08-20.
HCS coverage/policies, explicit backlight unknowns, independently bypassable
relative-gain sensitivity, generic aperture variants, unit-energy CPU fixtures,
generated presets, current Shader compilation, and WS8 KONKR exact/fractional
GPU energy readback are complete.

### Static color and luminance

- [x] Pin and normalize the HCS AGS-101 ColorMunki/HCFR record containing black,
  white, a complete 32-code neutral ramp, and full-level RGB/CMY patches.
- [x] Preserve measurement identity, raw artifact hashes, black/white audit
  anchors, derivation revision, and every unrecorded protocol field.
- [x] Generate and validate the HCS black-subtracted EOTF and native-primary
  color transform without presenting the generated 32,768-entry LUT as 32,768
  separate measurements.
- [x] Expose physical-black and HCS black-subtracted policies as separately
  named outputs if both remain useful to users.
- [x] Encode missing per-channel ramps, intermediate mixed patches, repeats,
  brightness mode, peak luminance context, and inter-unit variation as coverage
  limits and uncertainty, not as mandatory future measurements.

### Brightness and backlight

- [x] Preserve the period product/manual-record fact that AGS-101 has two brightness
  modes while leaving their absolute luminance ratio and electrical modulation
  unknown unless a primary source resolves them.
- [x] Audit AGT board/panel photographs, manuals, patents, and exact or
  manufacturer-family documentation for LED topology, DC/PWM behavior,
  frequency, and spatial uniformity.
- [x] Build named DC, PWM, and brightness-ratio candidates only where needed for
  exposure sensitivity testing. Do not select a PWM frequency from camera
  banding or an unsourced modding claim.
- [x] Allow backlight modulation and brightness-ratio uncertainty to be disabled
  independently from the measured static color stage.

### Aperture

- [x] Collect provenance-bearing photographs of authentic `LQ029B1DC01F`
  panels at the highest available resolution and distinguish screen overlays,
  camera moire, and replacement panels.
- [x] Derive only the features supported by image scale and resolution, such as
  stripe order or normalized gap ratios. Do not infer calibrated fill factor
  from an unscaled photograph.
- [x] Generate an AGS-specific archival-evidence kernel only if the imagery is
  sufficient; otherwise retain `lcd-grid-v2` as an explicitly generic prior and
  include plausible aperture variants in the sensitivity set.
- [x] Validate CPU equations at integer and fractional host scales for
  area/energy conservation,
  channel order, phase, and color neutrality.

### Acceptance

- [x] The reference profile reports HCS measured coverage separately from
  unmeasured protocol, repeat, and inter-unit uncertainty.
- [x] Physical black and optional black subtraction cannot be confused.
- [x] Brightness/backlight behavior is source-backed, represented as a candidate
  range, or explicitly unknown.
- [x] Aperture parameters trace to archival evidence or carry a generic-prior
  label and pass CPU/GPU scale-energy fixtures.

## WS7 — Integrate emitted light over the exposure

Implementation status: repository implementation completed on 2026-08-20.
The runtime is now three passes: persistent frame-boundary endpoint state,
non-feedback native-frame exposure average, then aperture/color presentation.
WS8 GPU numeric exposure readback now matches the packed-rate CPU alternating
cycle within `3.3381e-8` on the current three-pass KONKR route.

### Implementation

- [x] Define observation intervals for ordinary refresh, duplicate frames,
  fast-forward, and variable refresh without changing the native panel clock.
- [x] Integrate GtG state, row/latch timing, optical delay, and each accepted
  backlight candidate over the interval.
- [x] Use analytic integration where the accepted response permits it;
  otherwise validate Simpson/adaptive sampling against a high-resolution
  reference.
- [x] Retain frame-boundary endpoint sampling as a named diagnostic mode.

### Acceptance

- [x] Static frames match endpoint output within numerical tolerance.
- [x] Moving and alternating stimuli match the high-resolution exposure
  reference across supported frame pacing.
- [x] Integration does not change source/target color transforms or aperture
  energy.
- [x] Fast/nominal/slow GtG and backlight candidates produce reproducible output
  bounds rather than one falsely precise result.

Runtime scope: supported intervals execute each emulated native frame exactly
once at the fixed GBA period. Frontend-generated duplicate holds, skipped
fast-forward frames, and unknown VRR duplication/drop histories are not
reconstructible in Shader state and require the safe bypass. Static 0.5/0.75/1
backlight sensitivity is integrated; PWM/DC waveforms remain unselected because
frequency, duty, phase, topology, and measured brightness ratio are unknown.

## WS8 — Close CPU, GPU, and target-device validation

### Validation matrix

- [ ] Complete GPU numeric readback for every color, GtG, and scan-phase cell.
  Current three-pass retention, exposure integration, and aperture energy are
  complete in `ags101-ws8-target-20260820.json`.
- [x] Compare the current retention, exposure, and aperture GPU results against
  their corresponding CPU fixtures.
- [ ] Capture target-device output for scan markers, GtG gate transitions,
  retention stress/recovery patterns, and the reconstruction sensitivity set.
- [x] Re-test reset/content reload and Android background/resume; classify
  save-state history restoration, rewind, run-ahead, accelerated history,
  duplicate execution, and unknown VRR as unsupported stateful intervals with
  a compiled/read-back stateless safe boundary. Background resume retained the
  PID but reset Shader `FrameCount`, so it is a reset boundary rather than
  continuous panel history.
- [ ] Test every diagnostic at integer/fractional scale. The aperture energy
  diagnostic passes exact 4x and centered 3.5x on KONKR.
- [x] Pin shader, preset, table, ROM, frontend/core, device/driver, video mode,
  and capture hashes in each receipt.
- [x] Keep KONKR/frontend compensation labeled as target behavior rather than
  AGS panel evidence.

### Promotion gate

- [x] Promote the model from `physics-seed` to `period-reconstruction` after
  current WS8 implementation validation passed and every remaining limitation
  was made explicit in `model.json`. Promotion does not claim specimen
  calibration or resolve the listed hardware-evidence gaps.
- [ ] Allow a future specimen-specific profile only when its name, metadata, and
  UI make that scope unmistakable.
- [ ] Rebuild the release and reproduce numeric/device receipts from a clean
  checkout using documented commands.

## Dependency order

```text
WS1 baseline -----> WS8 regression and release receipts
      |
      +-> WS2 stimulus/tooling -> WS3 timing reconstruction --+
                              |                               |
                              +-> WS4 GtG ensemble ------------+-> WS5 retention
                                                              |
HCS data -> WS6 color/aperture/backlight ----------------------+-> WS7 exposure
                                                              |
                                                              +-> WS8 promotion
```

Execution order:

1. Preserve the completed pinned-mGBA WS2 receipt and the pinned WS5 KONKR
   receipt as regression gates; do not call it current after WS6/WS7 Shader changes.
2. Freeze the evidence taxonomy, exact-platform facts, hardware identities, and
   source-search records used by WS3, WS4, and WS6.
3. Preserve the completed WS3/WS4/WS5 matrix and WS6 repository reconstruction;
   future evidence may refine them without rewriting their historical receipts.
4. Keep current Shader GPU numeric validation, including WS6 aperture energy
   and WS7 exposure output, in the continuous WS8 instrumentation track.
5. Preserve the completed WS7 interval contract, analytic integration, and
   fast/nominal/slow plus backlight bounds as the WS8 exposure baseline.
6. Run WS8 continuously for CPU/GPU regression, uncertainty receipts, and final
   target-device validation.

Authentic AGS-101 hardware is not part of the planned dependency chain. If
future hardware measurements become available, ingest them through the WS2
schemas as a new specimen-specific evidence branch; do not silently rewrite the
period reconstruction or relabel earlier priors as measurements.

## Definition of done

- [x] The reconstructed reference default uses the documented WS4 ensemble and
  no longer derives its nominal behavior from the analytic synthetic fixture.
- [ ] Exact scan facts and reconstructed latch, parity/inversion, drive, and
  optical-delay hypotheses cannot be confused.
- [ ] Retention, if enabled, responds to spatial code/polarity history under a
  named WS3 hypothesis and cites a transferable period mechanism.
- [ ] HCS static-color coverage, derivation, protocol gaps, and black policy are
  explicit and reproducible.
- [ ] Raw-black policy, brightness-mode scope, and backlight behavior are
  explicit.
- [ ] Aperture geometry is AGS-specific only when archival evidence supports
  that claim; otherwise the generic prior is visible and passes scale-energy
  validation.
- [x] Frame output represents the documented exposure interval.
- [ ] Sensitivity receipts bound every material unsupported timing, GtG,
  retention, brightness, and aperture choice.
- [ ] CPU, GPU, and target-device receipts name the exact current artifacts.
- [ ] Directly measured static color, period reconstruction, future
  specimen-specific data, synthetic fixtures, and target compensation cannot
  be confused in metadata or UI.
