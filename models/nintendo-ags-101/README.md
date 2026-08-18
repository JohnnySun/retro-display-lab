# Nintendo GBA SP AGS-101 physics seed

This downloadable model separates six mechanisms:

- an HCS-measured RGB555-to-native-linear source adapter;
- transition-dependent per-subpixel gray-to-gray response;
- a measurement-ready analytic/table GtG rate-field interface;
- a theory-derived drive-imbalance and adsorption/desorption state;
- explicit row-start, electrical-latch, and optical-onset events;
- an analytic BGR aperture followed by the measured native-to-host color stage.

Load [`presets/physics-seed-v1.slangp`](presets/physics-seed-v1.slangp) in
RetroArch. `drive-retention-debug-v2` visualizes the persistent state and
alternating frame polarity. The normal preset itself now uses the published
Mizusaki laboratory-cell rate midpoint as the best-available period-literature
theoretical reconstruction.
`neutral-baseline-v1` restores the former standard-sRGB source/output adapter
for regression comparisons.

The main `physics-seed-v1` preset now includes the N=1 three-event model. It
derives row start from the exact GBA clock and
line cycle count, places an explicit electrical latch within that line, and
changes the optical GtG target only after a separate optical delay. The
period-theory default is a line-center latch with zero independent dead time;
`scanout-line-start-v1` and `scanout-line-end-v1` provide the two within-line
diagnostic bounds. Optical events that cross a frame boundary use
`OriginalHistory2 -> OriginalHistory1` in the following frame and never sample
a future input. Static rows take the original one-segment path, and setting
`BakedScanout` to zero—or loading `scanout-temporal-only-v1`—provides a
temporal-only equivalence control. Host-panel
scan direction is not baked into this model. Shader subframe counts other than
one bypass temporal state; N=2/4 remains unsupported.

WS4 adds a canonical full-waveform GtG record and a deterministic fitter. The
normal preset continues to use the analytic period-theory candidate because no
qualifying AGS-101 transition matrix exists. `gtg-synthetic-table-v1` exercises
the complete table path with a full 3×32×32 dataset generated from that same
analytic prior; it is a pipeline fixture, not an A/B shader and not a panel
measurement. The packed runtime texture is only 32×96 RGB8, while raw samples,
per-cell fits, rejection reasons, hashes, and error metrics stay in separate
data artifacts.

Table lookup uses the continuous inverse-EOTF optical state and the new target
code. This avoids repeated nearest-code quantization and gives a defined
mid-transition target-change rule without storing a discrete transition ID.
Cells with missing corners, excessive overshoot/undershoot, non-monotonicity,
or excessive first-order residuals fall back explicitly per channel. See
[`docs/research/ags-101-gtg.md`](../../docs/research/ags-101-gtg.md) for the
model choice, schema, packing, measurement protocol, and acceptance gates.

WS5 keeps the runtime at the same two shaders and adds one read-only diagnostic
selector in the final display pass. It exposes native optical state, separated
electrical terms, row/latch/optical phases, GtG lookup identity/backend, and an
aperture split without writing diagnostic colors into persistent feedback.
Thin presets isolate static color, GtG, scan timing, real-clock retention, and
explicit 60× laboratory stress/recovery. The completed KONKR record, artifact
hashes, frontend lifecycle outcomes, and safe fixed-time settings are described
in [`docs/research/ags-101-validation.md`](../../docs/research/ags-101-validation.md).

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

`HcsChromaticAdaptation=0` and `HcsImproveContrast=1` reproduce the HCS default
color choices: retain the measured AGS-101 white and remove the measured
backlight black term. The other settings remain available for HCS parity tests.
The upstream snapshot has no explicit redistribution license in the pinned
revision; confirm release terms before distributing the measurement-derived
artifact outside this research project. Upstream Shader source is cited but not
copied.

See [`REFERENCES.md`](REFERENCES.md) for the source-to-code evidence map and
limits. See [`IMPLEMENTATION-TODO.md`](IMPLEMENTATION-TODO.md) for the staged
measured-color, drive-retention, scan-timing, GtG, and validation workstreams.
The retained equations, parameter classes, numerical update, and measurement
handoff are in
[`docs/research/ags-101-drive-retention.md`](../../docs/research/ags-101-drive-retention.md).
The scan event derivation and motherboard capture schema are documented in
[`docs/research/ags-101-scan-timing.md`](../../docs/research/ags-101-scan-timing.md).
