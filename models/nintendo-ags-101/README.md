# Nintendo GBA SP AGS-101 period reconstruction

This downloadable model separates seven mechanisms:

- an HCS-measured RGB555-to-native-linear source adapter;
- transition-dependent per-subpixel gray-to-gray response;
- a measurement-ready analytic/table GtG rate-field interface;
- a theory-derived drive-imbalance and adsorption/desorption state;
- explicit row-start, electrical-latch, and optical-onset events;
- native-frame emitted-light integration separated from endpoint feedback;
- an analytic BGR aperture followed by the measured native-to-host color stage.

Load [`presets/period-reconstruction-v1.slangp`](presets/period-reconstruction-v1.slangp) in
RetroArch. `drive-retention-debug-v2` visualizes the persistent state and
selected parity/inversion polarity. The normal preset itself now uses the published
Mizusaki laboratory-cell rate midpoint as the best-available period-literature
theoretical reconstruction.
`neutral-baseline-v1` freezes the former standard-sRGB source/output adapter
with GtG, retention, scan splitting, and aperture disabled for deterministic
static regression.

The main `period-reconstruction-v1` preset includes the N=1 three-event model. It
derives row start from the exact GBA clock and
line cycle count, places an explicit electrical latch within that line, and
changes the optical GtG target only after a separate optical delay. WS3 now
classifies the active line-center/zero-delay behavior as a legacy sensitivity
candidate rather than a formal AGS-101 constant; `scanout-line-start-v1` and
`scanout-line-end-v1` provide the two within-line diagnostic bounds. Optical
events that cross a frame boundary use
`OriginalHistory2 -> OriginalHistory1` in the following frame and never sample
a future input. Static rows take the original one-segment path, and setting
`BakedScanout` to zero—or loading `scanout-temporal-only-v1`—provides a
temporal-only equivalence control. Host-panel
scan direction is not baked into this model. Shader subframe counts other than
one bypass temporal state; N=2/4 remains unsupported.

WS3 generates nine timing, two parity-phase, and four inversion-topology
sensitivity presets under `generated/ws3-presets-v1`. `ParityPhase` and
`InversionTopology` implement the even/odd and frame/row/column/dot candidate
sets; the normal preset retains the historical even-positive/frame-global pair
only as a named legacy candidate. Debug views 6–10 isolate row start, latch,
optical onset, parity, and inversion without entering the persistent response
pass. The generated sensitivity and Shader compile receipts do not select an
authentic AGS-101 topology.

WS4 now supplies fast, nominal, and slow literature-constrained 3×32×32 GtG
tables. Their endpoint envelope comes from explicitly non-equivalent Sharp
handheld/near-size family specifications; every other cell is a documented
equation-based reconstruction. The normal preset selects the nominal 30 ms
white→black / 60 ms black→white endpoint member. It has zero measured AGS-101
cells, and channel, brightness, temperature, overshoot, and true GtG-distance
magnitude remain explicit unsupported dimensions. The legacy analytic path is
retained only as a missing-corner fallback.

`gtg-synthetic-table-v1` still exercises the full table path using a synthetic
3×32×32 dataset, but it now explicitly binds that test texture and is never the
normal reference. A future authentic-panel waveform record can still create a
separate specimen table through the existing schema and fitter without
overwriting the reconstructed ensemble.

Table lookup uses the continuous inverse-EOTF optical state and the new target
code. This avoids repeated nearest-code quantization and gives a defined
mid-transition target-change rule without storing a discrete transition ID.
Cells with missing corners, excessive overshoot/undershoot, non-monotonicity,
or excessive first-order residuals fall back explicitly per channel. See
[`docs/research/ags-101-gtg.md`](../../docs/research/ags-101-gtg.md) for the
model choice, schema, packing, measurement protocol, and acceptance gates.

The generated WS4 comparison receipt uses the same four deterministic WS2 GtG
scenes for all ensemble members. CPU double-precision and Shader-equation
float32 traces are bounded in the repository receipt; an actual target GPU
numeric readback has not been claimed.

WS5 extended the then-two-pass runtime's one per-pixel
residual-DC state with a raw RGB555-command and WS3 polarity/topology excitation
proxy. `SpatialCodeWeight=0.5` and `PolarityDriveWeight=0.25` are explicit
unfitted sensitivity priors; displayed luma never drives the electrical state.
The generated 3×4 candidate matrix crosses every WS4 member with every WS3
inversion topology, while parity phases are covered in the numeric receipt.
DebugView 11 exposes code proxy, excitation, retained state, and net mismatch;
DebugView 12 provides binary float/FrameCount bands for target readback without
writing diagnostic colors into persistent feedback.

Generated self-contained presets also isolate static color, GtG, scan timing,
real-clock retention, and explicit 60× laboratory stress/recovery.
They avoid the tested Android route's unreliable parameter overrides after
`#reference`. The historical KONKR record, artifact hashes, frontend lifecycle
outcomes, and safe fixed-time settings are described in
[`docs/research/ags-101-validation.md`](../../docs/research/ags-101-validation.md).

The old signed-luma ION effect has been removed. The replacement starts from an
explicit alternating drive polarity, a normalized external DC imbalance, and
the adsorption/desorption kinetics reported by Mizusaki et al. The electrical
state is updated with the exact constant-input exponential and affects the
optical path through effective drive code before the measured EOTF. Static
image luma is not an electrical excitation term.

Because unused AGS-101 panels are no longer reasonably obtainable, measuring a
surviving aged unit would characterize that aged specimen rather than recover
the original production behavior. The default therefore uses the best
traceable period-literature reconstruction: the Mizusaki 25 C cell midpoint
rates (`A=0.0010583333 s^-1`, `D=0.000425 s^-1`), with normalized project bridge
priors `DriveDcOffset=0.1` and `DriveCodeCoupling=0.15`. The rates are direct
literature values; the two bridge values are named project priors because the
paper does not provide an AGS code-to-voltage-to-optical mapping. This is a
theoretical reconstruction, not a claim of measurement on a pristine AGS-101.

The feedback pass uses RGBA32F: RGB stores the fast optical state and alpha
stores one signed residual-DC scalar. Retention is supported only for normal
forward rendering with `TotalSubFrames=1`; unsupported shader-subframe counts
bypass it. Rewind, run-ahead, and dropped fast-forward frames cannot reproduce
physical elapsed-time history in the current frontend contract.

WS7 makes the runtime three passes without feeding presentation averages back
into the physical state. Pass 0 retains the frame-boundary RGB endpoint and
residual-DC alpha. Pass 1 analytically integrates emitted native-linear RGB over
the exact `1232 * 228 / 16777216 = 0.016742706298828125 s` GBA frame and forwards
the endpoint alpha; pass 2 applies aperture, the selected static relative
backlight sensitivity, and host color conversion. `ExposureMode=0` is the named
endpoint-presentation diagnostic. Closed-form first-order segment integrals are
checked against 4096-subinterval Simpson references for all fast/nominal/slow
members, row 0/80/159 transitions, partial-channel changes, and alternating
sequences.

The fixed native clock advances once per executed emulated frame. Identical
content frames are real dwell and remain supported; host-only duplicate holds,
skipped emulated frames, and unknown VRR duplicate/drop histories cannot be
reconstructed. Static 0.5/0.75/1 relative-backlight bounds are supported, but
no PWM/DC waveform is invented. The current WS8 KONKR receipt covers numeric
exposure readback; unknown host intervals still require the stateless bypass.

Alpha is stored per pixel, so distinct RGB555/polarity histories now create
distinct slow states when `SpatialRetention=1`. `DriveDcOffset=0` remains
exactly balanced for every code and topology, while `SpatialRetention=0`
exactly restores the former global WS1 path. This is a bounded period-mechanism
reconstruction, not measured AGS-101 image sticking; equal-mean chromatic
commands still share one scalar state and no lateral ion diffusion is modeled.

The default presets directly integrate color information derived from the
Handheld Color Space Project snapshot at commit
`e688fc51141c0974728aa1bdcb89b94d74123f6b`. That snapshot contains an
identified AGS-101 measurement record: a ColorMunki Display/HCFR session with black and white,
32-code neutral grayscale, full-level primary/secondary, and report-supplied
spectral data. Its raw files, metadata, coverage, and derivation revisions are
catalogued under `AGS-COLOR-01`; AGS-101 static color measurement is therefore
available as evidence.

The checked-in normalized record at `data/hcs-e688fc5-color.json` preserves the
HCFR inputs and source hashes. `tools/build-ags101-hcs-color.mjs` independently
derives the black-subtracted 32-code EOTF, RGB-to-XYZ matrix, Bradford matrices,
measured black term, runtime Shader constants, and CPU golden vectors. The
generator is checked by `npm test` so edited measurements or stale Shader
constants fail validation.

WS6 exposes two unambiguous generated outputs:
`generated/ws6-presets-v1/hcs-black-subtracted-v1.slangp` retains the HCS
default derivation, while `hcs-physical-black-v1.slangp` restores the measured
black XYZ of that one pinned unit/protocol state. The generated color record
now states its real coverage separately: black/white, a 32-code neutral ramp,
and full-level RGB/CMY are measured; per-channel ramps, intermediate mixed
patches, repeats, brightness mode, absolute peak-luminance context, and
inter-unit variation are not.

`HcsChromaticAdaptation=0` and `HcsImproveContrast=1` reproduce the HCS default
color choices: retain the measured AGS-101 white and remove the measured
backlight black term. `BacklightScaleEnabled=0` independently prevents the
unresolved brightness ratio from changing that static-color stage. The WS6
0.5/0.75/1.0 relative-gain sweep is sensitivity-only. No DC/PWM topology,
frequency, duty cycle, or absolute luminance is selected.

The available `LQ029B1DC01F` photographs establish a panel label but are not
calibrated overlay-separated aperture captures. WS6 therefore does not invent
an AGS-specific kernel: it keeps the `lcd-grid-v2`-derived polynomial as an
explicit generic prior, adds narrow/nominal/wide geometry variants, and
normalizes each source channel to unit mean linear-light energy. CPU fixtures
cover 4×/5×/6× and 3.5×/3.75×/4.25× scales, RGB/BGR reversal, phase, and color
neutrality. WS8 adds exact-4x and centered-3.5x GPU aperture-energy agreement.
The upstream snapshot has no explicit redistribution license in the pinned
revision; confirm release terms before distributing the measurement-derived
artifact outside this research project. Upstream Shader source is cited but not
copied.

See [`REFERENCES.md`](REFERENCES.md) for the source-to-code evidence map and
limits. See [`IMPLEMENTATION-TODO.md`](IMPLEMENTATION-TODO.md) for the active
panel-closure workstreams.
The canonical WS1 parameter inventory and neutral/static hash baseline are
[`data/ws1-evidence-inventory-v1.json`](data/ws1-evidence-inventory-v1.json)
and
[`generated/ws1-baseline-v1.json`](generated/ws1-baseline-v1.json).
The retained equations, parameter classes, numerical update, and measurement
handoff are in
[`docs/research/ags-101-drive-retention.md`](../../docs/research/ags-101-drive-retention.md).
The scan event derivation and motherboard capture schema are documented in
[`docs/research/ags-101-scan-timing.md`](../../docs/research/ags-101-scan-timing.md).
The deterministic GBA ROM suite, synchronized electrical/photodiode schemas,
normalization/rejection rules, and synthetic GtG handoff are documented in
[`docs/research/ags-101-capture-pipeline.md`](../../docs/research/ags-101-capture-pipeline.md).
