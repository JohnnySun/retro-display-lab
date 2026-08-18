# Nintendo GBA SP AGS-101 implementation to-do

Status: rolling implementation plan. Checked items are implemented and have
passed the acceptance evidence named in their workstream; unchecked items
remain planned work.

This plan turns the current `physics-seed` into a model whose static color,
electrical retention, scan timing, and gray-to-gray behavior have separate
interfaces and evidence levels. Work must preserve the source/target separation
and evidence rules in `docs/methodology.md` and `docs/reference-policy.md`.

The five workstreams are:

1. HCS measured color integration;
2. literature-derived drive-imbalance and ionic-retention model;
3. three-part scan timing;
4. measurement-ready gray-to-gray (GtG) model and table format;
5. diagnostics, CPU references, and regression validation.

`GtG` is used below for gray-to-gray. It corresponds to the “GPG” item in the
request.

## Non-negotiable rules

- Do not tune a parameter visually and then label it measured or
  literature-derived.
- Every equation, constant, dataset, and transformation must have a stable
  evidence ID in `REFERENCES.md`.
- Preserve the raw record, the normalized intermediate data, and the generated
  runtime artifact as distinct layers.
- Store physical quantities with units. Normalized or dimensionless proxies
  must be named as proxies.
- A missing measurement may use a bounded experimental parameter, but the
  default and UI label must not imply AGS-101 calibration.
- The neutral public color path must remain available as a regression baseline.
- No temporal rewrite may silently change static color when all temporal
  effects are disabled.
- CPU reference equations and shader equations must agree before a new preset
  becomes the default.

## Proposed pipeline boundary

```text
RGB555 source code
  -> source EOTF (neutral or HCS measured)
  -> electrical drive and slow charge state
  -> GtG optical state
  -> scan/latch/optical event timing
  -> native-primary aperture integration
  -> measured native RGB -> XYZ -> host RGB transform
  -> host transfer function
```

The exact pass count and state-texture layout are implementation decisions, but
electrical state, optical state, and source/target color transforms must remain
separable in code and validation.

## WS1 — Integrate the existing HCS measured color model

Implementation status: complete in the model, CPU validation path, and tested
KONKR Vulkan runtime on 2026-08-18. External redistribution of the pinned HCS
measurement artifact still requires the release decision below.

### Objective

Add a measured AGS-101 color path derived reproducibly from `AGS-COLOR-01`, while
retaining the neutral sRGB path as a selectable baseline. “Direct integration”
means numerical parity with the selected HCS derivation, not manual visual
matching.

### Source and policy gate

- [x] Pin the input to HCS commit
  `e688fc51141c0974728aa1bdcb89b94d74123f6b` and the exact AGS-101 measurement
  directory already recorded in `REFERENCES.md`.
- [x] Record whether the measured artifact is research/private-only or may be
  redistributed publicly. This decision controls packaging, not whether the
  measurement exists. Current decision: checked-in research integration;
  external redistribution still requires confirmation or a release decision.
- [x] Select the black-subtracted shader derivation introduced by HCS commit
  `b80b89fc6951f0f64c2cbdfd2971c67bc8aafd2f`; do not combine it silently with
  the earlier `screen_config.json` gamma tables.

### Data ingestion

- [x] Add a reproducible importer for `hcfr_report.xls` or an explicitly
  documented normalized export of the same workbook.
- [x] Preserve source metadata: author, measurement date, meter, software,
  screen overlay, workbook export date, and every `n.d.` protocol field.
- [x] Extract and validate the 32-code neutral ramp, black/white XYZ, and
  full-level RGB/CMY patches.
- [x] Generate a versioned intermediate data file containing source hashes,
  derivation revision, units, 32-code EOTF tables, black/white anchors, and the
  native-primary color transform.
- [x] Reject non-monotonic tables, missing endpoints, changed source hashes, or
  a derivation revision that is not named explicitly.

### Shader integration

- [x] Define a source-EOTF interface with at least `neutral` and `hcs-measured`
  backends.
- [x] Keep the temporal optical state in normalized native-panel primary space;
  do not apply the host sRGB matrix before temporal response or aperture
  integration.
- [x] Apply the measured native RGB -> XYZ -> adapted host RGB transform after
  native-primary aperture integration and before host transfer encoding.
- [x] Define black handling once. The measured black term must not be added in
  both the response and display passes.
- [x] Remove the candidate `BlackLevel` from the measured path or make it an
  explicit experimental override that defaults off.
- [x] Add separate presets for neutral and HCS-measured color so comparisons do
  not depend on hidden parameter state.

### Verification and acceptance

- [x] Add CPU golden vectors for all 32 neutral codes and the six measured
  full-level color patches.
- [x] With temporal response and aperture disabled, match the selected HCS
  reference shader within a documented floating-point tolerance.
- [x] Verify exact RGB555 endpoint behavior and monotonic EOTF lookup.
- [x] Verify black and white anchors, white chromaticity, and matrix orientation.
- [x] Verify that selecting the neutral backend reproduces the current neutral
  output exactly.
- [x] Document measured coverage accurately: neutral ramp plus full-level
  primaries/secondaries, not direct per-channel ramps or 32,768 measured colors.
- [x] Run a live RetroArch probe of measured/neutral switching, HCS contrast,
  and chromatic-adaptation parameters on the tested KPA Vulkan target. See
  `TARGET-KPA-HCS-01`.

### Deliverables

- [x] HCS importer/normalizer and deterministic generated artifact.
- [x] Measured source-EOTF and output-color backends.
- [x] Neutral and measured presets.
- [x] Updated evidence map, model metadata, and validation anchors.

## WS2 — Replace the luma-driven ION model with a theory-derived drive model

Implementation status: complete for the theory-derived topology, CPU
reference, period-literature default runtime, and normal-forward N=1 KONKR
Vulkan contract on 2026-08-18. Project policy uses the closest contemporary
TFT-LCD literature as the theoretical reference because a pristine AGS-101
specimen is no longer obtainable; aged specimens are secondary evidence.

### Objective

Replace the current signed-luma excitation with a model derived from documented
TFT pixel drive, polarity inversion, residual DC, mobile-ion transport, and
alignment-layer adsorption/desorption theory. No shader implementation begins
until the research gate below is satisfied.

### Research gate

- [x] Produce `docs/research/ags-101-drive-retention.md` before changing the
  runtime model.
- [x] Search primary papers, patents, and manufacturer drive documentation for:
  TFT pixel equivalent circuits; gate feed-through; storage/parasitic
  capacitance; common-electrode/VCOM drive; frame/line/dot inversion; residual
  DC formation; mobile-ion drift/diffusion; and alignment-layer
  adsorption/desorption.
- [x] Start from `AGS-STICK-01` and `AGS-DRIVE-01`, then add the primary sources
  actually used to derive equations. General summaries may orient the search
  but may not be the sole basis of the simulation.
- [x] For every retained equation, record its source location, variables,
  assumptions, dimensions, valid regime, and transformation into shader form.
- [x] Decide which theory level is supportable in real time: a reduced
  equivalent-circuit/kinetic model, a reduced Poisson–Nernst–Planck model, or
  another published reduction. Document why discarded levels are not used.
- [x] Explicitly determine what existing HCS optical EOTF data can and cannot
  say about panel voltage. Do not rename optical code/EOTF as a measured V–T
  curve.
- [x] Separate literature-specified parameters, externally measurable drive
  quantities, and still-unmeasured AGS-101 specimen parameters.

Research-gate acceptance requires a source-to-equation table, a continuous-time
model, units for every state and parameter, and a documented numerical
discretization. If those cannot be produced, the existing ION model remains an
experimental effect and is not replaced by another guessed topology.

### Required physical behavior

- [x] Represent the pixel/common-electrode drive with explicit polarity rather
  than the sign of displayed luminance.
- [x] Represent common-electrode mismatch and any retained feed-through offset
  as electrical terms, not as post-color brightness offsets.
- [x] Represent slow charge/ion state separately from fast optical GtG state.
- [x] Couple retained ionic/alignment-layer charge back through an effective
  electrical offset or published electro-optical relationship, not by adding
  an arbitrary gray value to RGB output.
- [x] Balanced positive/negative drive must produce zero long-term DC in the
  ideal limit.
- [x] Reversing the electrical imbalance must reverse the residual-DC direction.
- [x] Removing the imbalance must relax the slow state according to the derived
  kinetics.
- [x] Static image content alone must not imply net DC when the modeled drive is
  perfectly balanced.

### State and frontend architecture

- [x] Inventory required states before choosing a packing scheme. Expected
  candidates include electrical DC offset, trapped/interfacial charge, optical
  RGB state, and possibly inversion phase.
- [x] Do not pack multiple physical states into one low-precision alpha channel
  without an error analysis.
- [x] Resolve persistent-state layout against RetroArch's single feedback cycle.
  The RGBA32F pass stores optical RGB plus exactly one electrical scalar in
  alpha; the documented precision analysis rejects RGBA16F and no second
  physical state is packed into alpha.
- [x] Define and test the frontend contract for frame parity. Normal-forward
  N=1 `FrameCount & 1` alternated without a repeat across 181 recorded KONKR
  frames (`TARGET-KPA-DRIVE-01`). Rewind, run-ahead, dropped-frame fast-forward,
  and N>1 shader subframes are explicitly unsupported rather than guessed.
- [x] Define reset/initial conditions for every state and make discontinuities
  observable in a debug preset.

### Numerical verification and acceptance

- [x] Implement an independent CPU reference from the continuous equations.
- [x] Use an exact exponential, implicit, or otherwise justified stable update;
  do not make the result depend on an arbitrary host update rate.
- [x] Test full-frame versus partitioned integration equivalence where the drive
  is constant.
- [x] Test convergence, boundedness, sign reversal, zero-imbalance equilibrium,
  and long-duration numerical stability.
- [x] Expose unmeasured specimen parameters as such; do not ship candidate
  values under measured labels.
- [x] Compare qualitative behavior against the cited AGS-101 retention field
  observations without fitting undocumented constants to a screenshot.

### Deliverables

- [x] Literature review and source-to-equation derivation document.
- [x] CPU simulator with units and long-duration tests.
- [x] Persistent electrical-state shader pass and debug view.
- [x] Make the period-literature retention reconstruction the normal preset.
  The signed-luma runtime and redundant A/B preset are removed; Git history is
  the regression record.

## WS3 — Split scan timing into row, latch, and optical phases

Implementation status: complete for the period-theory three-event model, CPU
reference, cross-frame causal history, diagnostics, and capture-ready schema.
No motherboard trace exists, so trace-derived latch/parity refinement remains
an optional evidence upgrade rather than a blocker to the theoretical default.

### Objective

Replace the single `(row + 0.5) / 228` convention with three named timing
components:

```text
t_row_start = row * T_line
t_latch     = t_row_start + latch_offset * T_line
t_optical   = t_latch + optical_delay
```

The first term is timing-derived, the second is electrically measurable at the
motherboard, and the third is panel-optical.

### Timing model

- [x] Introduce explicit `RowStartPhase`, `LatchOffsetLines`, and
  `OpticalDelaySeconds` concepts; choose UI exposure only after their reference
  and preset roles are clear.
- [x] Derive `T_line` and frame time from the documented GBA clock/cycle counts
  rather than duplicating rounded constants.
- [x] Keep top-to-bottom direction as cited evidence.
- [x] Treat latch offset as theoretical until DCK/LP/SPS capture data exist.
- [x] Treat optical delay as theoretical until a synchronized optical trace
  exists.
- [x] Specify whether electrical/ion integration changes at `t_latch` while
  optical target response changes at `t_optical`; do not use one event for both
  unless the model derivation justifies it.
- [x] Handle events that wrap across the frame boundary. Do not hide an
  out-of-frame optical event with `clamp(0, 1)`.

### Measurement preparation without a panel

- [x] Write a motherboard capture protocol for DCK, LP, SPS, MOD, REVC, COM, and
  a frame reference, including probe reference, sample rate, trigger, test ROM,
  and expected clock relationships.
- [x] Define an importable capture record with signal names, units, logic/analog
  classification, board revision, and uncertainty.
- [ ] Derive latch offset and polarity/parity relationships from an actual future capture;
  preserve raw traces and the derivation script.

### Presets and compatibility

- [x] Provide temporal-only, line-start, line-center, and line-end diagnostic
  presets before selecting any new default.
- [x] Preserve the current N=1 fail-safe until feedback rotation is proven for
  shader subframes.
- [x] Verify static-row equivalence and unchanged-channel behavior.
- [x] Test top versus bottom transitions in both rise and fall directions.
- [x] Record frontend assumptions: history frame meaning, run-ahead, frame
  duplication, variable refresh, pause, fast-forward, and shader subframes.

### Acceptance

- [x] CPU and shader event times agree to floating-point tolerance.
- [x] `OpticalDelaySeconds=0` and the legacy line-center setting reproduce the
  former single-event line-center timing exactly.
- [x] Disabling scan timing reproduces the temporal-only model exactly.
- [x] Cross-frame events produce causal results with no future-frame sampling.
- [x] Evidence labels distinguish timing-derived, electrically measured, and
  optical-measured quantities.

### Deliverables

- [x] Three-component scan timing implementation.
- [x] Capture protocol/schema; raw-trace importer remains optional until a
  capture file format and actual trace exist.
- [x] Diagnostic presets and expanded scanout CPU tests.

## WS4 — Build a measurement-ready GtG model and response-table format

Implementation status: complete for the versioned raw record, deterministic
fitter, monotone first-order rate field, packed runtime texture, analytic
fallback, measurement protocol, CPU validation, and KONKR Vulkan runtime on
2026-08-18. Both the normal analytic path and the opt-in synthetic-table path
compiled and presented at the target's 60 Hz refresh; the device was restored
to the normal analytic preset after the probe (`TARGET-KPA-GTG-01`).

### Objective

Retain an analytic fallback while adding a canonical measurement format and a
runtime backend capable of consuming per-channel 32x32 transition data without
rewriting the temporal pipeline.

### Canonical measurement record

- [x] Define a versioned schema independent of the shader storage format.
- [x] Required specimen metadata: console/board ID, LCD label, brightness mode,
  warm-up, ambient/temperature, power/charger state, panel history, overlay,
  measurement geometry, detector, acquisition rate, test ROM/pattern generator,
  and repetitions.
- [x] Required sample identity: channel, from code, to code, repetition, event
  time zero, sample times, normalized or absolute optical response, and units.
- [x] Preserve raw time-series samples. Derived `t10`, `t50`, `t90`, settling,
  overshoot, undershoot, and fit parameters are separate generated fields.
- [x] Permit incomplete tables but record missing cells explicitly; never fill
  missing measurements silently.
- [x] Add schema/version validation and deterministic source hashes.

### Model and fitting decisions

- [x] Research response models appropriate to the measured waveforms: first
  order, bi-exponential, second-order/overshoot, or a documented LCD-specific
  formulation.
- [x] Select model complexity from residual/error analysis, not from a desire to
  expose more parameters.
- [x] Define treatment of overshoot/undershoot and code-dependent settling.
- [x] Decide how a new target arriving mid-transition changes the active model.
  A full transition table requires retaining the transition identity or an
  equivalently justified state-space formulation.
- [x] Inventory the state needed to retain from/to code per channel; do not rely
  on repeated nearest-code re-quantization if that changes the meaning of a
  measured transition.
- [x] Define interpolation/fallback rules for incomplete tables and label
  analytic substitution in diagnostics.

### Runtime representation

- [x] Keep the canonical JSON/CSV or equivalent record separate from packed
  runtime assets.
- [x] Evaluate constant arrays, floating-point LUT textures, and generated code
  for precision, portability, shader limits, and package size.
- [x] Generate runtime assets deterministically and record their source hash,
  schema version, fit version, units, and error metrics.
- [x] Provide `analytic` and `measured-table` backends through one response
  interface.
- [x] Support R/G/B tables independently and brightness/specimen profiles
  without changing shader source manually.

### Measurement protocol preparation

- [x] Define a photodiode/high-speed camera protocol with sufficient temporal
  bandwidth and synchronized transition trigger.
- [x] Specify patch area, spatial sampling point, preconditioning frames,
  starting-level dwell, ending-level dwell, repetitions, and temperature.
- [x] Decide whether all 3 x 32 x 32 transitions are required initially or
  whether a staged subset is acceptable. The schema must support the full set
  either way.
- [x] Include black-to-code, code-to-black, near-level, mid-gray, and endpoint
  transitions in the first mandatory subset.

### Verification and acceptance

- [x] Identity transitions remain stationary.
- [x] Exact time scaling is invariant under equivalent frame partitioning for
  the selected continuous-time fit.
- [x] Known synthetic tables reproduce known analytic responses.
- [x] Table round-trip (raw -> fit -> runtime asset) stays within documented
  error bounds.
- [x] Missing cells invoke an explicit, testable fallback.
- [x] No table is labelled measured unless its specimen and protocol metadata
  pass schema validation.

### Deliverables

- [x] Versioned GtG raw-measurement schema and example synthetic dataset.
- [x] Fitter/generator with fit reports and error metrics.
- [x] Analytic/table runtime interface and table-backed shader path.
- [x] Measurement protocol and validation suite.

## WS5 — Add mechanism-level diagnostics and regression validation

Implementation status: complete on 2026-08-18. The two-shader runtime now has
read-only unified diagnostics, mechanism isolation presets, independent CPU
references, provenance and artifact-integrity gates, and a completed KONKR
frontend lifecycle record (`TARGET-KPA-VALIDATION-01`).

### Objective

Make every model layer independently observable and ensure that apparent visual
improvement cannot hide color, timing, or state regressions.

### Diagnostic views and presets

- [x] Neutral versus HCS-measured color A/B.
- [x] Source EOTF/native-primary state before output color conversion.
- [x] Electrical polarity, common-electrode mismatch, residual DC, and trapped
  charge as separate views.
- [x] Row start, latch event, and optical event timing overlays.
- [x] GtG transition ID, selected table cell, fit backend, and fallback-cell
  indicator.
- [x] Aperture off/on and temporal-mechanism isolation presets.
- [x] Long-duration stress/recovery laboratory preset with real and accelerated
  clocks clearly separated.

### CPU references and automated tests

- [x] Refactor shared color, electrical, scan, and GtG equations into small CPU
  references used by validation.
- [x] Add golden vectors for HCS static color.
- [x] Add property tests for boundedness, monotonicity where applicable,
  equilibrium, polarity reversal, reset behavior, and time-partition invariance.
- [x] Add scan tests for first/last visible row, frame wrapping, unchanged rows,
  and partial RGB transitions.
- [x] Add GtG schema, fit, fallback, overshoot, and runtime-packing tests.
- [x] Add reference-integrity tests that require every shader/preset evidence ID
  to exist in both `REFERENCES.md` and `model.json`.
- [x] Keep screenshots for presentation comparisons only; numerical and causal
  checks determine model acceptance.

### Frontend integration checks

- [x] Record RetroArch version, video driver, shader subframes, history semantics,
  feedback precision, integer scaling, and target refresh for every temporal
  validation run.
- [x] Test reset, content reload, save-state load, pause, rewind, run-ahead,
  fast-forward, frame duplication, and variable-refresh behavior.
- [x] Define safe bypass behavior when required frontend semantics are absent.

### Acceptance

- [x] Each mechanism can be disabled without changing unrelated layers.
- [x] Debug views expose state directly and do not feed altered state back into
  gameplay presets.
- [x] All validation passes from a clean checkout using documented commands.
- [x] Model metadata reports measured, literature-derived, and experimental
  portions separately.

### Deliverables

- [x] Diagnostic shader/preset set.
- [x] Expanded `validate-ags101.mjs` CPU references and invariants.
- [x] Reproducible validation-run record template and completed device record.

## Dependency and sequencing notes

- WS1 is largely independent and can be implemented first.
- WS2 must pass its literature/equation gate before runtime implementation.
- WS3 can begin from existing scanout-v2, but its electrical event should use
  the drive definition selected by WS2 when the two are integrated.
- WS4 schema/protocol work can begin without a panel. Its runtime state layout
  should be coordinated with WS2 so persistent textures are not redesigned
  twice.
- WS5 starts with the first implementation workstream and grows with every
  subsequent one; it is not a final cleanup phase.

A practical dependency graph is:

```text
WS1 measured color -------------------------> integrated preset

WS2 research -> electrical-state design ----+
                                              +-> shared temporal state layout
WS4 schema/model -> transition-state design -+
                                              |
WS3 three-part scan timing ------------------+-> integrated temporal preset

WS5 validation and diagnostics span all workstreams
```

## Overall definition of done

- [x] Static HCS color is reproducibly generated and selectable.
- [x] The retention model is traceable from primary literature to equations to
  discretized shader code; displayed luma is not used as an undocumented
  electrical substitute.
- [x] Row, latch, and optical timing are separate quantities with separate
  evidence labels.
- [x] GtG measurements can be imported through a stable schema and consumed by
  the shader without redesigning the model.
- [x] CPU references, shader behavior, provenance, and frontend assumptions are
  validated together.
- [x] No unmeasured quantity is presented as a measured property of AGS-101.
