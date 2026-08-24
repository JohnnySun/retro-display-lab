# Nintendo CGB-001

Model workspace for the original Game Boy Color reflective Sharp HR-TFT LCD.

- [Evidence map](REFERENCES.md)
- [Implementation to-do](IMPLEMENTATION-TODO.md)
- [Canonical reconstruction record](data/reconstruction-v1.json)
- [WS0 scaffold receipt](generated/ws0-scaffold-v1.json)
- [WS1 color receipt](generated/ws1-receipt-v1.json)
- [WS1 color audit](generated/ws1-color-audit-v1.json)
- [WS2 frontend contract](data/frontend-contract-v1.json)
- [WS2 completion receipt](generated/ws2-receipt-v1.json)
- [WS2 deterministic ROM manifest](generated/ws2-stimulus-v1/manifest.json)
- [WS2 independent ROM decoder report](generated/ws2-decoder-v1.json)
- [WS2 pinned Gambatte smoke report](generated/ws2-gambatte-smoke-v1.json)
- [WS3 evidence inventory](data/ws3-evidence-inventory-v1.json)
- [WS3 normalized scan candidates](data/scan-candidates-v1.json)
- [WS3 runtime constants contract](generated/ws3-runtime-constants-v1.json)
- [WS3 CPU/future-Shader equation vectors](generated/ws3-equation-vectors-v1.json)
- [WS3 candidate sensitivity report](generated/ws3-sensitivity-v1.json)
- [WS3 completion receipt](generated/ws3-receipt-v1.json)
- [WS4 evidence inventory](data/ws4-evidence-inventory-v1.json)
- [WS4 response policy](data/ws4-response-policy-v1.json)
- [WS4 normalized response ensemble](data/response-ensemble-v1.json)
- [WS4 runtime GtG descriptor](generated/cgb001-ws4-gtg-rates-v1.json)
- [WS4 model-selection report](generated/ws4-model-selection-v1.json)
- [WS4 CPU/future-Shader equation report](generated/ws4-equation-vectors-v1.json)
- [WS4 deterministic motion fixtures](generated/ws4-motion-fixtures-v1.json)
- [WS4 completion receipt](generated/ws4-receipt-v1.json)
- [WS5 reflected-exposure policy](data/ws5-exposure-policy-v1.json)
- [WS5 CPU/future-Shader equation report](generated/ws5-equation-vectors-v1.json)
- [WS5 quadrature convergence report](generated/ws5-quadrature-convergence-v1.json)
- [WS5 scan/exposure fixtures](generated/ws5-scan-exposure-fixtures-v1.json)
- [WS5 completion receipt](generated/ws5-receipt-v1.json)
- [WS6 aperture evidence inventory](data/ws6-evidence-inventory-v1.json)
- [WS6 aperture model](data/aperture-v1.json)
- [WS6 scale/phase validation](generated/ws6-aperture-validation-v1.json)
- [WS6 completion receipt](generated/ws6-receipt-v1.json)
- [WS7 retention evidence inventory](data/ws7-evidence-inventory-v1.json)
- [WS7 retention model](data/retention-v1.json)
- [WS7 stress/recovery validation](generated/ws7-retention-validation-v1.json)
- [WS7 completion receipt](generated/ws7-receipt-v1.json)
- [WS8 frontend texture descriptor](generated/ws8-runtime-textures-v1.json)
- [WS8 SPIR-V compile receipt](generated/ws8-shader-compile-v1.json)
- [WS8 Shader/preset manifest](generated/ws8-manifest-v1.json)
- [WS8 completion receipt](generated/ws8-receipt-v1.json)
- [WS9 CPU golden vectors](generated/ws9-cpu-golden-v1.json)
- [WS9 sensitivity report](generated/ws9-sensitivity-v1.json)
- [WS9 prior-art difference report](generated/ws9-prior-art-comparison-v1.json)
- [WS9 release receipt](generated/ws9-receipt-v1.json)
- [WS9 KONKR target receipt](../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/cgb001-ws9-target-20260824.json)
- [Reference D65 preset](presets/reference-d65-v1.slangp)
- [Verbatim upstream references and attribution](reference/upstream/README.md)
- [Research survey](../../docs/research/cgb-001-reference-survey.md)

WS0 through WS9 are complete. The exact pinned HCS ODS/TXT and official CIE observer
and D65 tables are retained with attribution as the auditable source of record.
The reproducible WS1 importer produces a separate normalization/audit record,
a measured-constrained color model, and a finite monotonic 32×32×32 absolute-
reflectance XYZ LUT for 45° illumination and a 0° normal viewing direction.
The LUT is a derived runtime reduction and never replaces the source spectra.

WS2 pins Gambatte libretro commit
`3262c2aa4adae8dba4f6d51cdd931c15cb11569f`, retains its complete upstream
source archive, and verifies the core's uncorrected RGB565 output against 16
project-generated CGB ROMs. All 32,768 RGB555 values recover exactly; core
color correction, dark filtering, and frame blending must remain disabled.
The lifecycle contract freezes/reset temporal state safely and fails closed to
the static WS1 color path for unsupported frame delivery.

WS3 freezes the exact 4,194,304 Hz / 456-dot / 154-line frontend timebase while
keeping LP/SPS/CLS/REVC panel edges explicitly unresolved. Its bounded latch,
activation-delay, parity, and inversion candidates share one generated constants
record with CPU and future-Shader float32 validation. RGB555 remains the exact
0–31 logical source coordinate; neither a sixth data bit nor pixel voltage is
invented. Runtime viewing-angle tracking remains out of scope.

WS4 treats Sharp's 6.5-inch HCR 50/80 ms and GH 80/150 ms values as family
bounds, not as CGB measurements. It evaluates symmetric first-order,
direction-asymmetric first-order, and two-state candidates, selecting the
smallest symmetric model because the source has no direction split or waveform.
The generated fast, midpoint-nominal, and slow tables contain 9,216 addressable
RGB GtG cells. Channel and temperature effects remain neutral/unresolved;
settled output is byte-identical through the unchanged WS1 LUT.

WS5 integrates the WS1 trilinear XYZ field along the continuous WS4 RGB state
instead of evaluating color once at an averaged state. Its CPU gold reference
splits at LUT-cell crossings and analytically integrates the trilinear basis;
the future-Shader contract uses duration-allocated composite two-point
Gauss-Legendre quadrature. Across 1,126 fixtures, selected-quadrature error is
at most `2.62018e-5` XYZ and the float32 surrogate differs from its double path
by at most `1.41121e-7`. Static, no-scan, and scan equilibria match WS1 exactly.
The 45°/0° geometry is inherited only from WS1; no second angle gain or target
compensation is applied.

WS6 freezes the minimum-assumption panel appearance: one full-coverage logical
period split into equal left-to-right RGB rectangles. It analytically integrates
each rectangle over the host-pixel footprint and preserves every linear channel
and the WS5 XYZ average at 4×/5×/6× and fractional scales across viewport phases
and crops. Numeric gap/fill/notch/bus-mask geometry, MRS grain, lens tint, and
glare remain unresolved rather than borrowed from another panel or emulator.

WS7 adds a separate one-scalar residual-DC contract. Lee's VCOM/polarity
mechanism and Mizusaki's later laboratory-cell adsorption/desorption ranges
define low/midpoint/high kinetic bounds, but no source identifies healthy-CGB
amplitude. Consequently the reference resultant DC and optical coupling are
both zero. Nonzero normalized stress remains diagnostic; all WS3 inversion and
parity candidates, spatial patterns, unequal duty, reversal, recovery, pause,
reset, and future-Shader float32 equations are covered without modifying WS4
ordinary motion response.

WS8 integrates three Slang passes: persistent RGBA32F response/residual state,
non-persistent RGBA32F frame-average XYZ exposure, and analytic viewport RGB
aperture/presentation. All six Vulkan stages compile and pass SPIR-V validation.
Fifteen presets cover the normal reference, static/scan/retention/aperture
isolations, response bounds, exact upstream-color comparison, and seven
self-contained diagnostics. The frontend lookup textures use paired,
nearest-filtered RGBA8 high/low-byte planes so the Shader reconstructs explicit
uint16 values and interpolates them manually. The rejected single RGBA16 PNG
probe is retained separately; the WS1 RGBA32F LUT, WS4 R32F rates, and verbatim
HCS ODS/TXT remain authoritative.

WS9 validates the released graph on RetroArch 1.22.2, Gambatte, Vulkan, and a
Mali-G76 MC4 in KONKR reference unit `BW0306N250002377`. All 32,768 RGB555
codes and 98,304 XYZ components pass GPU readback; response, exposure, and
diagnostic retention pass synchronized float-bit recurrence checks; aperture,
frame pacing, cold compilation, and device restoration pass. Android
background resume safely rebuilds the shader graph and clears history on this
frontend. Save-state feedback serialization remains unsupported, while rewind,
run-ahead, dropped fast-forward history, and Shader subframes remain disabled
or outside the reference contract. SameBoy and libretro comparisons are
difference reports, not acceptance truth.

Validate the scaffold with:

```sh
npm run test:cgb-ws0
npm run test:cgb-ws1
npm run test:cgb-ws2
npm run test:cgb-ws3
npm run test:cgb-ws4
npm run test:cgb-ws5
npm run test:cgb-ws6
npm run test:cgb-ws7
npm run test:cgb-ws8
npm run test:cgb-ws9
```

The retained HCS source can also be verified independently:

```sh
node tools/build-cgb001-ws0.mjs --check --verify-sources models/nintendo-cgb-001/reference/upstream/hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b
```
