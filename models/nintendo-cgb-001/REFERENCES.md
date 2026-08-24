# Nintendo CGB-001 evidence map

Status: WS1 fixed-angle color, WS2 frontend contract, WS3 bounded scan-drive,
WS4 period response ensemble, WS5 reflected-exposure integration, WS6 RGB
aperture, WS7 residual-DC retention, WS8 Shader/preset integration, and WS9
release/target acceptance complete, frozen 2026-08-24.
The raw references, normalized measurement, color model, runtime LUT, pinned
core source, deterministic ROMs, bounded drive/response, analytic exposure and
aperture references, independent slow-state equations, compiled Shader passes,
complete preset/manifest receipts, Mali-G76 numeric GPU readback, frontend
lifecycle behavior, and named-target receipt are accepted for reference-v1.

The detailed literature review, HCS workbook audit, source ledger, open questions,
and DMG/AGS transfer analysis are recorded in
[`docs/research/cgb-001-reference-survey.md`](../../docs/research/cgb-001-reference-survey.md).
This model-local map defines which evidence may control the implementation.

## Frozen reference-v1 scope

- Device: original Nintendo CGB-001 with the OEM Sharp reflective HR-TFT LCD.
- Architecture: 160×144 RGB active-matrix reflective TFT; no DMG passive-matrix
  RMS drive or row/column crosstalk is transferred.
- Static reference color: the pinned HCS Nintendo GBC WIP dataset and derived
  D65 report at commit `e688fc51141c0974728aa1bdcb89b94d74123f6b`.
- Geometry: 45° illumination and 0° detector/view direction. The viewer is
  normal to the panel. There is no runtime viewing-angle, camera, or face-tracking
  model in `reference-v1`.
- Illuminant: D65 is the default reference profile. Other illuminants may be
  generated later from the same fixed source without changing the default.
- Missing exact CGB dynamics, inversion, and aperture values are reconstructed
  from traceable Sharp-family and period evidence with explicit fast/nominal/slow
  or low/nominal/high bounds. They are never relabeled as measured CGB facts.
- A future authentic-panel capture creates a separate specimen profile unless
  multi-unit evidence supports changing the period reference.

## WS9 release validation boundary

The release receipt is [`generated/ws9-receipt-v1.json`](generated/ws9-receipt-v1.json);
the named-device record is
[`cgb001-ws9-target-20260824.json`](../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/cgb001-ws9-target-20260824.json).
RetroArch 1.22.2, Gambatte, Vulkan, and Mali-G76 MC4 reproduced every one of
the 32,768 RGB555 LUT codes. Across 98,304 XYZ components, maximum absolute
error was `7.6889992e-6`, within the explicit uint16 transport bound.
Synchronized response, exposure, and diagnostic-retention traces agreed with
the CPU float32 recurrence; analytic aperture coverage agreed within
`2.38419e-7`.

The authoritative LUT remains the unchanged RGBA32F WS1 artifact. A direct
single RGBA16 PNG probe failed because this RetroArch loader exposed 8-bit
texture values. Runtime presets therefore use paired nearest-filtered RGBA8
high/low-byte planes, reconstruct uint16 in the Shader, and perform trilinear
interpolation manually. Both the failed probe and accepted paired probe remain
in the target evidence so the transport decision is falsifiable.

On this Android target, returning from background rebuilds the Vulkan Shader
graph and safely clears temporal feedback instead of preserving ghosting
history. Cold content load behaves the same. Save-state feedback serialization
is unsupported; rewind and run-ahead are disabled, and accelerated or dropped
frame histories are outside reference-v1. These are frontend limits, not CGB
physics claims.

## Evidence IDs

| ID | Class | Source | What it controls | What it does not prove |
| --- | --- | --- | --- | --- |
| `CGB-NIN-SERVICE-1999` | CGB primary | Nintendo, *Game Boy Color Repair Procedures*, Rev. 6/22/99, [PDF](https://documents.cdn.ifixit.com/XfUohIuYorCPxUTY.pdf), downloaded SHA-256 `716b8a201ffab9d8d9cc0587cfbfd17143f45db882730068053a4357453bd1bc` | HR-TFT identity, 160×144×RGB, LCD-integrated drivers, rails, service part `38900` | Exact Sharp module number, LC mode, GtG, VCOM waveform, aperture |
| `CGB-NIN-PROG-1999` | CGB primary | Nintendo, *Game Boy Programming Manual* (1999), [landing page](https://www.manualslib.com/manual/1627081/Nintendo-Game-Boy.html) and [PDF mirror](https://files.nekoblog.org/uploads/pdf/39999184-GameBoy-Programming-Manual.pdf) | RGB555 palette, 32 codes/channel, raster facts, LCD signal names | Analogue levels, exact source mapping, optical onset |
| `CGB-HCS-REFLECTANCE-2026` | CGB direct measurement, accepted with limitations | Handheld Color Space Project, [Nintendo GBC WIP at `e688fc5`](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBC/%5B2026-05-xx%5D%5BPokefan531%5D%5BWIP%5D) | `reference-v1` static D65 color, measured patch comparison, 45°/0° geometry | Other viewing geometries, multiple-unit variation, reliable <440 nm spectrum, exact black stability, temporal behavior |
| `CGB-SHARP-HRTFT-1997` | manufacturer-family primary | Nakamura et al., “Development of HR-TFT,” [Sharp PDF](https://global.sharp/corporate/info/rd/tj1/pdf/7.pdf) | Super-HA/MRS/RGB-filter structure, GH/HCR family, response and reflectance bounds | Which exact type or constants the CGB panel uses |
| `CGB-SHARP-REFLECTIVE-1999` | manufacturer-family primary | Fujiwara and Mizushima, “反射型液晶ディスプレイの現状と動向,” [J-STAGE PDF](https://www.jstage.jst.go.jp/article/isj/38/2/38_2_128/_pdf/-char/ja), DOI `10.11370/isj.38.128` | one-polarizer HCR stack, normally-white family behavior, MRS and double-pass filter physics | Exact CGB optical stack values |
| `CGB-TN-SEKIYA-2001` | period primary response research | Nakamura and Sekiya, “Overdrive Method for Reducing Response Times of Liquid Crystal Displays,” [J-STAGE](https://www.jstage.jst.go.jp/article/itetr/25.5/0/25.5_43/_article/-char/en), DOI `10.11485/itetr.25.5.0_43` | transient nematic director dynamics make recursive/multi-state and history-sensitive candidates scientifically plausible | CGB timing, overdrive use, hidden-state coefficients, or any transferable milliseconds |
| `CGB-SHARP-HR-MODULE` | comparable manufacturer-family specification | Sharp LQ035Q2DD55, [PDF](https://www.beyondinfinite.com/lcd/Library/Sharp/LQ035Q2DD55.pdf) | meaning of DCLK/LP/SPL/SPS/CLS/MOD/VCOM-style HR-TFT interface signals and plausible supply topology | Pin-compatible or electrically identical CGB panel |
| `CGB-NIST-BRDF-1998` | display metrology | Kelley, Jones, Germer, “Display Reflectance Model Based on the BRDF,” [NIST](https://www.nist.gov/publications/display-reflectance-model-based-brdf) | separation of specular, haze, and diffuse reflection; terminology | A CGB BRDF or runtime angle requirement |
| `CGB-BECKER-RLCD-2001` | reflective-LCD metrology | Becker et al., “Electro-optical Characterization of Reflective LCDs,” [PDF](https://www.display-messtechnik.de/fileadmin/template/main/docs/sid01-eocrlcd.pdf) | source aperture, glare, viewing direction, contrast methodology | CGB-specific numerical values |
| `CGB-VCOM-LEE-2008` | active-matrix mechanism | Lee, “Common voltage control technology for highly reliable active matrix liquid crystal displays,” DOI `10.1117/1.2824378`, [record](https://www.researchgate.net/publication/238981861_Common_voltage_control_technology_for_highly_reliable_active_matrix_liquid_crystal_displays) | VCOM/flicker/DC-imbalance/image-sticking mechanism | CGB polarity topology or retention rate |
| `CGB-MIZUSAKI-2011` | later primary retention kinetics | Mizusaki, Miyashita, and Uchida, “Interaction between Impurity Ions and Alignment Polymer Layers Affecting the Image Sticking Effect on Liquid Crystal Displays,” [J-STAGE](https://www.jstage.jst.go.jp/article/koron/68/1/68_1_39/_article/-char/en), DOI `10.1295/koron.68.39` | adsorption/desorption equations and the reported 25 °C laboratory-cell rate ranges | CGB material identity, resultant-DC amplitude, optical coupling, aging, or a second CGB recovery state |
| `CGB-DRIVE-RECON-2026` | derived project constraint | WS3 [`scan-candidates-v1.json`](data/scan-candidates-v1.json) and receipt | explicit frame/row/column/dot/no-inversion candidates and two parity phases used by WS7 sensitivity fixtures | authentic CGB inversion selection or waveform |
| `CGB-GEKKIO-CENSUS` | secondary hardware census | [Game Boy Color hardware database](https://gbhwdb.gekkio.fi/consoles/cgb/) | CGB-CPU revision and specimen-stratification context | LCD equivalence across all revisions |
| `CGB-NATALIE-CPU04` | secondary reverse engineering | [CGB-CPU-04 interactive BOM/schematic](https://nataliethenerd.github.io/cgb.html) | P2 50-pin evidence for the documented board | Complete cross-revision LCD pinout |
| `CGB-GBDEV-EXTLCD` | secondary reverse engineering | [CGB external LCD/PGB signal mapping](https://gbdev.gg8.se/wiki/articles/Gameboy_and_Gameboy_Color_special_modes_and_features) | signal-function hypothesis and electrical fixture planning | Primary-source confirmation or analogue waveform |
| `CGB-PRIOR-SAMEBOY` | prior art | SameBoy [`Core/display.c` at `213a12c`](https://github.com/LIJI32/SameBoy/blob/213a12ce93d66b105a113debd9396306066a7cfc/Core/display.c) | regression comparison for 32-code curves and cross-channel transform | Measurement-derived reflective output |
| `CGB-PRIOR-LIBRETRO` | prior art and validated frontend implementation | Gambatte libretro [`3262c2a`](https://github.com/libretro/gambatte-libretro/commit/3262c2aa4adae8dba4f6d51cdd931c15cb11569f), libretro [`gbc-color.slang` at `a62d9cd`](https://github.com/libretro/slang-shaders/blob/a62d9cda9140294d22b6da5e4ff4187365890d42/handheld/shaders/color/gbc-color.slang), and [`Authentic GBC` at `be2f3e6`](https://github.com/PointSampler/ReShade-AuthenticGBC/tree/be2f3e65f915c0aded6a9106b069b24354cae9ce) | pinned WS2 RGB555 transport; comparison color/aperture implementations | OEM CGB color, dynamics, or photomask geometry |
| `CGB-GBCC-SUBPIXEL` | secondary CGB-specific observation and prior art | GBCC, [Technology: Subpixel Rendering](https://gbcc.dev/technology/) | left-to-right RGB description and roughly rectangular CGB subpixel observation | semicircle kernel, numeric fill/gap, color triplets, or scale-tuned phase as physical measurement |
| `CGB-BGB-REALITY` | independent secondary CGB observation and prior art | BGB, [Reality: GBC RGB doubler](https://bgb.bircd.org/reality/index.html) | independent three-RGB-subpixel observation and unit-average color convention | OEM subpixel order, fill/gap, overflow kernel, interlacing, or color correction |

## HCS source identity and handling

The accepted upstream raw artifacts are:

| Artifact | SHA-256 |
| --- | --- |
| `gbc_reflectance.ods` | `967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba` |
| `gbc_reflectance.txt` | `b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37` |

The upstream repository has no root LICENSE/COPYING/NOTICE in the pinned
revision. Following the project reference policy, the exact ODS/TXT and the
upstream parameter CSV are retained under `reference/upstream/hcs/` as
attributed scientific source/reference material, not relicensed as Apache-2.0
project code. The source commit, original path, authorship, WIP status, hashes,
and limitations are recorded in `reference/upstream/README.md`. Normalization,
repairs, color fitting, and runtime LUTs remain separate derived layers. The
build verifies every retained input hash before parsing, and it still supports
independent verification of another source directory.

Known source limitations remain machine-readable: R has 31 patches, G has 33,
the other ramps have 32; black differs between series; values below 440 nm are
invalid in the source author's audit; negative reflectance occurs; primary XYZ
additivity does not reproduce all secondaries/gray; processed report data was
modified to repair patch and monotonicity errors. Accepting the dataset as the
reference color does not erase these facts.

## Implementation transformation map

| Runtime layer | Controlling evidence | Policy |
| --- | --- | --- |
| Source code normalization | `CGB-NIN-PROG-1999` | Require uncorrected CGB core output and recover exact 5-bit channel codes without double correction |
| Static D65 color | `CGB-HCS-REFLECTANCE-2026` | Preserve the verbatim spectra; reproduce the pinned upstream parameters; generate a separately identified finite, non-negative, luminance-monotonic 32³ LUT with explicit black, interaction, and projection policies |
| Matrix/scan drive | `CGB-NIN-SERVICE-1999`, `CGB-NIN-PROG-1999`, `CGB-SHARP-HR-MODULE`, `CGB-GBDEV-EXTLCD` | Active-matrix sample-and-hold reconstruction; no DMG passive-matrix transfer |
| Short-term response | `CGB-SHARP-HRTFT-1997`, `CGB-SHARP-REFLECTIVE-1999`, `CGB-TN-SEKIYA-2001` | Fast/nominal/slow period ensemble; test richer response candidates but select no unsupported direction, overdrive, or hidden-state parameters; future measured tables remain replaceable |
| Slow retention | `CGB-VCOM-LEE-2008`, `CGB-MIZUSAKI-2011`, and `CGB-DRIVE-RECON-2026` | Separate one-scalar residual state with later-cell low/nominal/high kinetic bounds; healthy CGB resultant-DC and optical coupling stay zero until measured; never manufacture ordinary ghosting with it |
| Fixed-angle reflective output | HCS 45°/0° measurement plus D65; WS3/WS4 trajectory | Evaluate the WS1 XYZ field along continuous state and average over the exact native frame; MRS/angular response is already collapsed into WS1 and is not applied twice |
| Aperture | `CGB-SHARP-HRTFT-1997`, `CGB-GBCC-SUBPIXEL`, `CGB-BGB-REALITY`, and accepted HCS bare-panel color | Equal-third left-to-right RGB is the minimum-assumption full-coverage model; fill/gap/notch/MRS grain remain unresolved until calibrated OEM imagery exists |
| Modern target | target-local evidence map | Brightness/chroma compensation stays outside the CGB model |

## Frozen WS2 frontend path

WS2 builds the retained Gambatte commit without patching its source. The
selected libretro build requests RGB565 and emits each CGB palette value as
`(R5 << 11) | (G5 << 6) | B5`; bit 5 is therefore a zero padding bit. Integer
and normalized-texture decoders recover all 32,768 RGB555 combinations without
collision. The core runs at 160×144 and 4,194,304 / 70,224 Hz.

Reference use requires `gambatte_gbc_color_correction=disabled`,
`gambatte_dark_filter_level=0`, and `gambatte_mix_frames=disabled`. A mismatch
rejects reference-preset activation. Unsupported subframes, speculative frames,
or non-monotonic delivery clear or bypass temporal state according to
`data/frontend-contract-v1.json`; they never invent reverse-time LCD behavior.
The ROMs contain only project-owned code/data and leave the proprietary
Nintendo boot-logo area empty.

## Frozen WS3 scan-drive boundary

The selected frontend coordinate system is exact: 4,194,304 Hz, 456 dots per
line, 154 lines per frame, 144 visible lines, 70,224 dots per frame, and
59.7275005696 Hz. Nintendo's independently printed 108.7 µs, 15.66 ms,
1.09 ms, and 59.7 Hz values are retained as rounded cross-checks. These PPU
coordinates do not assert the electrical edge of `DCK`, `LP`, `SPS`, `CLS`,
`MOD`, or `REVC`.

Nintendo establishes the CGB signal names and five-bit palette codes. Comparable
Sharp primary documents constrain source sampling/latch, gate start/clock,
power-save, and common-electrode terminology, but do not supply CGB timing or
voltages. The normalized record therefore keeps 0/0.5/1-line latch and activation
delays, two parity phases, and five inversion topologies as bounded candidates.
The period default is line-start activation with row-alternating inversion, but
every formal CGB-specific selection remains `null`.

The five-bit palette to six physical source conductors per channel remains
unresolved. Runtime preserves `code5 / 31` as a dimensionless logical command;
zero-fill and bit-replication expansions appear only in the sensitivity report.
Likewise, the documented +5 V, +13.6 V, and −15 V rails are not assigned to RGB
codes, VCOM, or a gamma ladder. The WS3 receipt verifies CPU/future-Shader float32
equations, causal row splits, constant-field/no-scan invariance, pixel locality,
and the unchanged WS1 LUT hash without creating Shader files.

## Frozen WS4 response boundary

Sharp's 1997 paper reports only four family labels for a 6.5-inch active-drive
a-Si prototype: HCR `50 ms` on-and-off / `80 ms` gray-scales and GH `80 ms` /
`150 ms`. It does not publish response thresholds, separate directions, a gray
pair, temperature, instrument, waveform, or CGB relationship. WS4 therefore
uses these numbers only as fast/slow family bounds under an explicitly project-
equivalent 10–90 definition. The nominal `65/115 ms` member is the arithmetic
mid-envelope, not a measured typical CGB.

Period nematic-response research supports considering history-sensitive or
multi-state dynamics, but supplies no transferable CGB coefficients. WS4 tests
a symmetric first-order rate field, direction-asymmetric first-order field, and
two-state cascade. All can match the scalar anchors; only the symmetric model
avoids unconstrained direction or hidden-state parameters, so it becomes the
period default. Overshoot, overdrive, RGB timing differences, and temperature
coefficients remain disabled and unresolved.

The runtime artifact contains `3 members × 3 channels × 32 × 32 = 9,216`
float32 rates with per-cell provenance and fallback identity. A future measured
cell can replace one addressed rate without changing the state or Shader
interface. CPU and future-Shader float32 equations are validated for every cell
at five timesteps; actual GPU readback remains WS9. Every member reaches the
same exact source coordinate and byte-identical WS1 LUT endpoint. WS7 retention
remains an independent state.

## Frozen WS5 reflected-exposure boundary

WS5 observes exactly one committed native CGB frame at `70224 / 4194304`
seconds. For each pixel, the previous source command applies before the bounded
WS3 row-activation event and the current command afterward. Each constant-target
segment freezes the packed WS4 rate selected from the nearest segment-start
state code. An unchanged channel retains its rate across a split caused by a
different channel, so unrelated source changes cannot alter its dynamics.

Color is evaluated inside the time integral:
`average XYZ = integral(WS1_XYZ(stateRGB(t))) / frameSeconds`. The CPU gold
reference splits the monotone path at every crossed WS1 LUT-cell boundary,
expands the local trilinear basis into exponentials, and integrates them
analytically. The future-Shader contract uses 32 duration-allocated panels of
two-point Gauss-Legendre quadrature per native frame, at most 66 samples across
the row split. Across the deterministic curated/random suite its maximum
absolute XYZ error is `2.6201762790944993e-5`; the independent float32
transcription differs from the double quadrature by at most
`1.411202035228598e-7`. Actual GPU readback remains WS9.

The normal output remains unclipped absolute relative-reflectance XYZ. Optional
host coordinates divide by the WS1 code-31 white Y without adding target-device
brightness. The accepted 45° illumination, source specimen orientation, and 0°
normal view are inherited from WS1 exactly once. The unavailable numeric
azimuth remains `null`; no second MRS/BRDF, “45° gamma,” glare, reflector gain,
runtime angle, retention, Shader, or preset is introduced.

## Frozen WS6 aperture and surface boundary

WS6 audits Sharp-family structure, GBCC's CGB-specific microscope description,
BGB's independent RGB-subpixel prior art, and the accepted HCS bare-panel
condition without downloading or re-encoding web images as substitute evidence.
The only released geometry is a full-coverage source-pixel period divided into
equal left-to-right RGB thirds. `activeFill=1` and zero gap are a neutral
minimum assumption, not a measured CGB fill factor. Notches, bus masks, MRS
microfacets, surface grain, front-lens tint, and glare remain disabled.

WS5 XYZ is converted without clipping to the frozen linear-sRGB model space.
Each channel is multiplied by three times the analytic rectangular footprint
coverage of its stripe. Therefore every complete source period recovers the
input channels and XYZ average, independent of integer/fractional scale or
viewport phase. A future measured gap may use the declared WS1 code-zero color,
but no numeric gap is currently released. Disabling the aperture returns the
WS5 full-area value exactly. WS8 supplies the compiled Shader code; actual GPU
readback remains WS9.

## Frozen WS7 residual-DC boundary

Lee establishes the active-matrix link among alternating polarity, VCOM
balance, flicker, accumulated charge, and image sticking. Mizusaki et al.
provide the one-state adsorption/desorption equations and, for a later 25 °C
laboratory cell stressed for 120 minutes, `0.060–0.067 min^-1` adsorption and
`0.023–0.028 min^-1` slow-desorption ranges. WS7 retains those exact conditions
and ranges as low/midpoint/high kinetic bounds; it does not transfer their
voltages, materials, amplitude, or fast 70% recovery branch to CGB.

The excitation uses raw RGB555 command plus every WS3 inversion/parity
candidate. Displayed luma and optical feedback are forbidden inputs. One signed
float32 scalar per source pixel is reserved independently from WS4 RGB endpoint
state. Because no healthy CGB measurement identifies resultant DC or optical
coupling, both are zero in the reference profile. Nonzero normalized stress is
diagnostic only: it validates balanced/unbalanced polarity, spatial patterns,
formation/recovery, reversal, pause/reset, and future-Shader float32 equations.
WS7 therefore adds no ordinary moving-edge ghosting and invents no aged-CGB
preset.

## Claim boundary

The intended result is a physics-informed, measurement-constrained CGB-001
period reconstruction at one fixed viewing condition. It is not a calibration
of every surviving CGB, a recovered Sharp factory specification, or an
angle-aware digital twin.
