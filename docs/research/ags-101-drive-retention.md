# AGS-101 drive imbalance and residual-DC retention

Status: WS5 reconstructed implementation, accepted 2026-08-20. This document
defines the electrical/kinetic model that replaced the old luma-driven `ION`
effect and the WS5 code/polarity excitation extension. It does not claim that
any electrical coefficient or image-sticking trajectory was measured on the
HCS AGS-101 specimen.

## Decision

Use a reduced TFT drive plus adsorption/desorption model:

```text
TFT/VCOM/feed-through errors
  -> signed external DC imbalance
  -> alignment-layer ion adsorption/desorption
  -> signed internal residual-DC state
  -> polarity-specific effective drive command
  -> measured HCS code-to-optical response
  -> fast GtG optical state
```

Do not use displayed luma as electrical polarity. Do not add the slow state
directly to linear RGB. Do not describe the HCS optical EOTF as a voltage-to-
transmittance curve.

The selected theory level is the experimentally fitted surface-kinetic model
published by Mizusaki, Miyashita, and Uchida. A spatial Poisson–Nernst–Planck
(PNP) model is rejected for this real-time implementation because an identified
AGS-101 cell gap, ion concentrations and species, mobilities/diffusion
coefficients, permittivity, electrode boundary conditions, and adsorption
boundary parameters are not available. PNP literature explicitly requires
different boundary conditions when adsorption occurs; inventing those inputs
would create a more complicated but not more truthful model.

## Source-to-equation table

| Evidence | Retained fact or equation | Variables and units | Runtime transformation | Limits |
| --- | --- | --- | --- | --- |
| Mizusaki, Miyashita, Uchida, *Kobunshi Ronbunshu* 68, 39–44 (2011), [DOI 10.1295/koron.68.39](https://doi.org/10.1295/koron.68.39), eqs. 1–6 | `dn_a/dt = k_a N_s (n_s - n_a) - k_d n_a`; `C_LC V_rDC = q n_a`; generation is exponential and zero-bias relaxation is exponential, with a two-component relaxation improving the reported fit. | `n_a`, `n_s`: m⁻²; `N_s`: m⁻²; `k_a`: m² s⁻¹; `k_d`: s⁻¹; `C_LC`: F m⁻²; `V_rDC`: V; `q`: C. | Normalize density and voltage. Retain one signed slow state and exact exponential integration. Start with the single slow component that the paper identifies as relevant to generation; reserve a second component until AGS recovery data justify it. | Rates and capacitance in the paper belong to a laboratory LC cell, not an AGS-101. Signed behavior is a symmetric extension using opposite interfaces/polarities. |
| Same paper, Table 1 and Fig. 9–10 | In its 25 °C test cell and 1–5 V stress range, `k_a N_s` and `k_d` are approximately voltage-independent, while available near-surface ion density `n_s` grows approximately with DC-offset magnitude. Reported examples are `k_a N_s = 0.060–0.067 min⁻¹` and slow `k_d = 0.023–0.028 min⁻¹`. | Rates: min⁻¹ in the paper; converted to s⁻¹ for code. | Treat signed normalized external DC as the source term. Literature-cell rates may be offered only as an explicitly named laboratory prior, not AGS calibration. | No AGS temperature, material, ion density, or rate measurement exists. |
| Renesas, [AN1208: LCD Screens—Don't Flicker—Or Do They?](https://www.renesas.com/in/en/document/apn/an1208-lcd-screens-dont-flicker-or-do-they), 2005 | Pixel voltage is driven above and below `VCOM`; exact centering gives zero net DC. A VCOM error makes positive and negative field magnitudes unequal and causes flicker/retention. | Pixel voltage, video voltage, and `VCOM`: V. | Define a signed external DC imbalance independently of picture luma and an explicit alternating polarity. | General TFT module guidance, not the AGS-101 circuit. |
| TFT feed-through patent [CN100407281C](https://patents.google.com/patent/CN100407281C/en), eq. 1 | `V_feed = C_GD / (C_GD + C_LC + C_ST) · ΔV_G`. Feed-through shifts the held pixel voltage and changes the positive/negative voltage relative to VCOM. | Capacitances: F; gate swing and feed-through: V. | The runtime accepts the resulting normalized DC error. A future board/panel measurement may compute it from capacitances and gate swing; the shader does not invent those values. | AGS capacitances and gate waveform are unknown. `C_LC` can vary with gray and polarity. |
| Polarity-dependent feed-through patent [CN102254538A](https://patents.google.com/patent/CN102254538A/en), eqs. 1–6 | Charge conservation across TFT turn-off produces positive/negative kickback; differing effective `C_LC`/storage paths can make the two polarities unequal and produce long-term burn-in/image sticking. | Charge: C; capacitance: F; voltage: V. | Permit the measured resultant DC imbalance to include VCOM and polarity-dependent feed-through terms. | Patent examples are not an AGS circuit extraction. |
| Libretro, [Slang shader format](https://github.com/libretro/slang-shaders), `#pragma format`, feedback, and `FrameCount` semantics | A pass may read its previous framebuffer; `FrameCount` is reflected into the UBO; `R32G32B32A32_SFLOAT` is a supported render-target format. | Frame counter: integer; texture values: IEEE-754 float. | Use frame parity for explicit polarity and RGBA32F for the combined optical RGB plus one electrical scalar state. | Frontend state is not rewound with core run-ahead/rewind. Target support must be probed. |
| Barbero et al., *Physical Review E* 86, 051705 (2012), [DOI 10.1103/PhysRevE.86.051705](https://doi.org/10.1103/PhysRevE.86.051705) | PNP plus adsorption/desorption requires bulk transport coefficients and surface kinetic boundary conditions. | Concentration: m⁻³; diffusion: m² s⁻¹; potential: V; spatial coordinate: m. | Used only to reject an underdetermined spatial PNP implementation for this target. | Not used to supply AGS parameters. |

## TFT drive boundary

For polarity `p ∈ {+1, -1}`, write the held LC voltage as

```text
V_LC(p) = p V_cmd + ΔV_DC - V_rDC
```

where the externally measurable resultant imbalance is

```text
ΔV_DC = ΔV_COM + ΔV_feed + other measured polarity-asymmetric offsets.
```

The sign convention is defined at the pixel electrode relative to the common
electrode. Feed-through may be calculated from the cited capacitance equation
only after the relevant AGS quantities are measured. Until then the runtime
parameter is the resultant normalized `DriveDcOffset`, not guessed values of
`C_GD`, `C_LC`, `C_ST`, or gate swing.

In ideal balance, `ΔV_DC = 0`. Alternating `p` then produces zero time-average
DC for every static source code. Picture luma does not appear in this equation.

## Reduced adsorption/desorption state

For raw integer RGB555 command `(R5,G5,B5)`, define

```text
q = (R5 + G5 + B5) / (3*31)
p = selected WS3 frame/row/column/dot polarity in {-1,+1}
u = clamp(ΔDC * (1 + Wcode*(2q-1) + Wpolarity*p), -1, 1)
x = signed normalized adsorbed-ion / residual-DC state
A = k_a N_s  [s^-1]
D = k_d      [s^-1]
```

`q` is a command-coordinate reduction, not displayed luma, optical output, or
voltage. The released nominal sensitivity member uses `Wcode=0.5` and
`Wpolarity=0.25`; low, high, and global-only controls remain generated
candidates. The weights are unfitted project priors because exact AGS VCOM,
feed-through, capacitance, and code-voltage data are unavailable.

This construction preserves two hard compatibility gates. `ΔDC=0` produces
`u=0` for every code, coordinate, polarity, and topology. Setting
`SpatialRetention=0` produces `u=ΔDC` and exactly restores the former global
WS1 excitation.

The signed normalized extension of Mizusaki eq. 1 is

```text
dx/dt = A (u - x) - D x,                    when |u| > 0
dx/dt = -D x,                               when u = 0.
```

`u < 0` represents accumulation at the opposite interface. This is equivalent
to subtracting two symmetric nonnegative interface populations while retaining
one differential state. It guarantees:

- balanced drive with `u=0` and `x=0` remains exactly zero;
- reversing `u` reverses the equilibrium sign;
- removing `u` relaxes the state with the published desorption topology;
- a static command cannot create DC by itself when `ΔDC=0`.

For constant nonzero `u`, define `λ=A+D` and

```text
x_eq   = A u / λ
x(t+h) = x_eq + (x(t)-x_eq) exp(-λh).
```

For zero imbalance:

```text
x(t+h) = x(t) exp(-D h).
```

These exact updates are stable for any positive step and make full-frame and
partitioned integration identical for constant drive.

## Electrical-to-optical bridge

HCS supplies measured optical output as a function of RGB555 source code. It
does not supply `V_cmd(code)`, `C_LC(code)`, or a voltage–transmittance curve.
Therefore the electrical model keeps `u` and `x` normalized and exposes a
separate, explicitly unmeasured conversion `DriveCodeCoupling`:

```text
c_eff = clamp(c + p · DriveCodeCoupling · (u - x), 0, 1)
```

where `c` is the normalized RGB555 drive-command coordinate, not volts. Each
channel evaluates the existing measured HCS EOTF at `c_eff`; neutral mode uses
the neutral EOTF. This places the retained electrical offset before the optical
mapping instead of adding an arbitrary brightness term after it.

Linear interpolation between adjacent RGB555 codes is required because the
offset need not land on an integer code. The normal period reconstruction uses
`DriveCodeCoupling=0.15` as an explicit project bridge prior. This is the
value pinned by the preset, Shader default, CPU validator, and historical
device readback; it is not an AGS-101 measurement. Zero remains the balanced
isolation control.

The alpha state is stored per pixel and WS5 now drives it from each pixel's raw
RGB555 command plus the selected WS3 polarity candidate. Different held-code or
polarity histories can therefore create different slow states. The reduction
is deliberately one scalar per pixel: equal-mean chromatic triplets share a
state, and lateral diffusion, subpixel-resolved capacitance, and row-line
voltage gradients are not reconstructed.

## Polarity and frontend contract

The current rendered polarity is

```text
p = +1 when FrameCount is even, -1 when FrameCount is odd.
```

The model requires normal forward execution, `video_shader_subframes=1`, and no
run-ahead or rewind. Pause freezes both `FrameCount` and feedback, which is the
desired behavior. Fast-forward is valid only when every emulated frame is
rendered; dropped video frames under-integrate physical time. Rewind and
run-ahead cannot reconstruct the shader's slow electrical state and are
unsupported. Shader-subframe counts other than one bypass retention.

A frame-parity reset can change the instantaneous flicker phase but not the
signed slow state. WS3 uses row-alternating plus frame reversal as its
family-constrained reconstruction default and also exposes frame-global,
column, and dot sensitivity controls. The debug views show retained `x`, selected polarity,
parity phase, and spatial inversion separately so a reset or topology change is
observable without claiming that one hypothesis is authentic.

## State texture and precision

One feedback cycle is required for the fast optical RGB state and one for the
slow electrical state. RetroArch exposes one previous framebuffer for the
selected feedback pass, so the implementation stores exactly one electrical
scalar in alpha beside optical RGB; it does not pack several physical states
into alpha.

RGBA16F is insufficient for the published minute-scale rates when encoded
state is biased near 0.5. Its half-float encoded spacing there is about
`4.88e-4`, or `1.95e-3` after the shader's `x = 4(alpha-0.5)` decode. A
`0.001 s^-1` process advances normalized state only about `1.67e-5` per
59.7275 Hz frame at unit error (`4.18e-6` in encoded alpha), so the update can
quantize to zero. The response pass therefore requests
`R32G32B32A32_SFLOAT`; float32 encoded spacing near 0.5 is about `5.96e-8`
(`2.38e-7` decoded). At 240×160, the two-frame feedback allocation is small
enough for the tested target but still requires a Vulkan runtime probe.

## Parameter classification

| Runtime quantity | Classification | Default policy |
| --- | --- | --- |
| `ParityPhase` | Unresolved WS3 starting-phase selector | Even-positive reconstruction convention or odd-positive sensitivity control; N=1 only. |
| `InversionTopology` | Family-constrained WS3 reconstruction selector | Row-alternating plus frame reversal is the normal default; frame-global, column, and dot remain sensitivity controls. No AGT REVC trace was captured. |
| `DriveDcOffset` | Normalized bridge quantity; no pristine AGS value exists | Project theoretical prior `0.1`; zero is the exact charge-balanced control. |
| `SpatialRetention` | WS5 compatibility selector | Enabled for the reconstructed path; disabling it exactly restores the WS1 global excitation. |
| `SpatialCodeWeight` | Normalized RGB555-command sensitivity; no AGS value exists | Project sensitivity prior `0.5`; generated low/global/high controls remain available. |
| `PolarityDriveWeight` | Normalized polarity-asymmetry sensitivity; no AGS value exists | Project sensitivity prior `0.25`; WS3 topology and parity remain unselected. |
| `IonAdsorptionRate` (`A`) | Direct period-literature cell measurement | Default `0.0635 min^-1 = 0.0010583333 s^-1`, the midpoint of the reported range. |
| `IonDesorptionRate` (`D`) | Direct period-literature cell measurement | Default `0.0255 min^-1 = 0.000425 s^-1`, the midpoint of the reported slow-component range. |
| `DriveCodeCoupling` | Normalized electro-optical bridge; no pristine AGS value exists | Project theoretical prior `0.15`, kept distinct from the direct literature rates. |
| HCS EOTF | Measured optical source record | Existing default, unchanged. |
| Fast GtG coefficients | Experimental AGS candidates | Unchanged by WS2. |

## WS5 acceptance receipt

[`generated/ws5-retention-validation-v1.json`](../../models/nintendo-ags-101/generated/ws5-retention-validation-v1.json)
is regenerated by `tools/build-ags101-ws5.mjs`. It covers balanced uniform,
uniform code-pair, checkerboard, isolated-window stress/recovery,
polarity-reversal, unequal-duty-cycle, stress-duration, recovery-duration,
latch partition, spatial-off baseline, reset, and `N=1` gates. The matrix spans
three WS4 GtG members, four WS3 inversion topologies, two parity phases, and two
spatial probes. CPU double precision and the Shader float32/alpha round-trip
emulator must remain within `1e-4` after 1,800 feedback frames.

The generated receipt is repository equation evidence, not a GPU claim.
DebugView 11 exposes code proxy, excitation, retained state, and net mismatch;
DebugView 12 encodes outside/inside retained-state floats, `FrameCount`, and
the outside excitation as binary bit bands for a separate target GPU receipt.

## Historical reconstruction policy

AGS-101 production ended roughly two decades before this implementation, and
an unused reference panel is not reasonably obtainable. A surviving unit has
unknown operating hours, storage conditions, electrical adjustment, polarizer
aging, and backlight aging. Its present-day measurement would accurately
describe that aged specimen, but it would not automatically be a more accurate
estimate of original production behavior than contemporary TFT-LCD literature.

The project therefore treats the closest traceable period literature as the
canonical theoretical default. This is not a claim that the literature cell is
the same physical AGS-101 panel. It is an explicit reconstruction choice under
irrecoverable source-hardware conditions, with direct paper values and project
normalization priors kept separately identifiable.

## Optional aged-specimen corroboration

If a surviving AGS-101 is ever measured, useful corroborating observations are:

- positive and negative pixel-to-COM waveforms for several RGB555 codes;
- VCOM/REVC phase and the compensation voltage that minimizes flicker;
- gate swing plus sufficient pixel capacitance information to audit
  feed-through, or directly measure the resultant `ΔV_DC`;
- stress/recovery `V_rDC(t)` at recorded temperature, brightness mode, power
  state, and specimen identity;
- a voltage/code-to-optical bridge or synchronized polarity-resolved optical
  trace for `DriveCodeCoupling`.

Such observations may bound or challenge the reconstruction but should be
recorded as aged-specimen evidence, not silently promoted to pristine-panel
ground truth. The period-literature reconstruction remains the project default.
