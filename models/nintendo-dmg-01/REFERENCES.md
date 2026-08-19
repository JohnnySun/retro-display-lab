# Nintendo DMG-01 evidence map

Accessed 2026-08-19. Evidence labels follow the repository
[reference policy](../../docs/reference-policy.md).

## Reconstruction rule

The normal preset targets the perceived appearance of a healthy period DMG
panel on a modern display. DMG-specific documented observations take priority.
When a DMG quantity is unavailable, contemporary measured STN work at
comparable technology level supplies a range or model constraint; general
nematic theory supplies only model shape. Any remaining numeric bridge is
explicitly experimental. The machine-readable current decision record is
[`data/reconstruction-v1.json`](data/reconstruction-v1.json), and the remaining
work is tracked in [`IMPLEMENTATION-TODO.md`](IMPLEMENTATION-TODO.md).
WS2 retains the earlier normalized response anchors in
[`data/stn-response-evidence-v1.json`](data/stn-response-evidence-v1.json) and
the interim four-shade regression envelope in
[`generated/ws2-temporal-fit-v1.json`](generated/ws2-temporal-fit-v1.json).
They are output-validation bounds, not physical inputs. The completed causal
reconstruction is generated in
[`generated/ws2-stn-physics-v1.json`](generated/ws2-stn-physics-v1.json) from
the versioned drive and material records.

## Source records

### DMG-COLOR-01 — BGB DMG reality: optical states

- Source: BGB, [The reality of DMG colors](https://bgb.bircd.org/reality/index.html), including the [five-state color scheme](https://bgb.bircd.org/reality/dmg-reality-colorscheme.png).
- Used for: four driven shades plus the distinct LCD-disabled background;
  central-patch sRGB samples; gamma-aware palette interpolation. Four sampled
  midpoints from BGB's published smooth gradient agree with piecewise
  linear-light interpolation to within one 8-bit code per channel.
- Transformation: central color patches were sampled as `#948A04`, `#759833`,
  `#588F51`, `#3B7560`, and `#2E615A`. The first is reserved for unpowered
  aperture gaps; game data selects only the other four states. The source file
  SHA-256, dimensions, and all zero-based 1x1 crop coordinates are recorded in
  `data/reconstruction-v1.json`. The generated CIEDE2000 report is
  [`generated/ws1-perceptual-v1.json`](generated/ws1-perceptual-v1.json).
- Limits: reference-image matched, not a spectrophotometer dataset from our
  specimen. BGB states that the photographs were ColorChecker-corrected to
  sRGB/gamma 2.2; camera, illumination, specimen, and display reproduction still
  limit absolute accuracy.
- Redistribution: linked only; the BGB images are not included here.

### DMG-MOTION-01 — BGB DMG frame blending

- Source: BGB, [DMG frame blending](https://bgb.bircd.org/reality/index.html),
  [blur comparison](https://bgb.bircd.org/reality/dmgblend-blur.png), and
  [shade comparison](https://bgb.bircd.org/reality/dmgblend-shades.png).
- Used for: qualitative constraints that DMG motion integrates prior optical
  states and can expose intermediate shades.
- Transformation: informs the causal feedback architecture and A/B scenes; no
  BGB blending coefficients or code are copied.
- Limits: behavior/reference-image evidence. It does not identify a unique DMG
  panel response curve.
- Redistribution: linked only.

### DMG-APERTURE-01 — BGB idealized LCD close-up

- Source: BGB, [DMG LCD close-up](https://bgb.bircd.org/reality/dmglcd-closeup.png)
  and its explanation on the DMG reality page.
- Used for: rectangular aperture, separate inter-pixel background, and
  reflector-shadow direction.
- Transformation: the published drawing's 70/80 one-axis aperture proportion
  seeds `PixelFill=0.875`; host-pixel box coverage preserves a subpixel-width
  grid at exact 4x output. The recorded `y=100` scanline identifies aperture
  `x=[60,130)`, gap `x=[130,140)`, and the next aperture at `x=140`; boundary
  pixels and the source SHA-256 are independently verifiable.
- Limits: BGB explicitly describes the drawing as idealized and says the actual
  edge width was unknown. Fill, edge softness, and shadow are therefore
  reference-image-matched/experimental—not physical measurements.
- Redistribution: linked only.

### DMG-STN-01 — 1994 STN image-sticking experiment

- Source: Yuji Nakazono, Atsushi Sawada, and Jun Nakanowatari, “Relationship
  between Image Sticking of STN LCD and Physical Properties of Liquid Crystal,”
  *Proceedings of the 20th Japanese Liquid Crystal Conference* (1994),
  [DOI 10.11538/ekitouyokou.20.0_374](https://doi.org/10.11538/ekitouyokou.20.0_374).
- Used for: per-pixel long-exposure ionic state, 30-minute protocol, and the
  relationship between sticking, conductivity anisotropy, and viscosity.
- Transformation: the eleven Table 1 rows are regressed to
  `DeltaV = 7.390426 × ((DeltaSigma/SigmaPerp)/eta) - 0.186987`, with
  `R²≈0.746`; validation recomputes this fit. `StickingOpticalGain` is an
  explicit voltage-to-optical bridge.
- Limits: the paper's `DeltaV` is a visibility voltage range, not transmission,
  and its mixtures are not identified as the DMG panel material. DMG-STN-05
  and DMG-ION-01 constrain the separate charge/release reconstruction; the
  voltage-to-optical gain remains a bounded project bridge.
- Redistribution: facts and independently recomputed regression only; the paper
  is not redistributed.

### DMG-STN-02 — STN material and director dynamics

- Source: Martin Schadt, “Liquid Crystal Materials and Liquid Crystal
  Displays,” *Annual Review of Materials Science* 27 (1997), 305–379,
  [DOI 10.1146/annurev.matsci.27.1.305](https://doi.org/10.1146/annurev.matsci.27.1.305).
- Used for: physical basis for viscosity/cell-gap/electric-field dependent,
  direction-dependent nematic response.
- Limits: mechanism-level constraint; it does not provide DMG panel constants.

### DMG-STN-03 — Historical STN material response range

- Source: Haruyoshi Takatsu, “Development and Industrialization of Liquid
  Crystalline Tolans,” *Journal of Synthetic Organic Chemistry, Japan* 57(7)
  (1999), 629–632,
  [J-STAGE PDF](https://www.jstage.jst.go.jp/article/yukigoseikyokaishi1943/57/7/57_7_629/_pdf).
- Used for: historical context that conventional STN response was around
  300 ms and later low-viscosity/high-birefringence mixtures improved it to
  120–130 ms.
- Limits: literature range for STN materials, not a DMG measurement. The
  quoted comparison does not identify whether its response time is `ton`,
  `toff`, their mean, or their sum; WS2 retains that field as unspecified.

### DMG-STN-04 — High-speed 270-degree STN experiment

- Source: Kazuhiro Okada, Satofumi Koike, Motonao Arai, Toshiro Yukinari, and
  Akira Harada, “High Response Speed Supertwisted LCD,” *Journal of the
  Institute of Television Engineers of Japan* 42(10) (1988), 1022–1028,
  [J-STAGE PDF](https://www.jstage.jst.go.jp/article/itej1978/42/10/42_10_1022/_pdf).
- Used for: duty ratio, cell gap, viscosity, and hysteresis as response-time
  variables; historical lower-bound context for a deliberately fast STN cell.
  The reported `80 ms` is explicitly `(ton+toff)/2`, measured at 20 °C with
  `ton≈toff` on a 4 µm, 270-degree, 1/200-duty yellow-mode cell.
- Limits: the reported prototype is not the DMG panel. Its measured response is
  used only as an output bound for the reconstructed material ensemble.

### DMG-STN-05 — Period alignment-layer and ion-retention protocol

- Source: Katsumi Takizawa et al., “Physical Properties of Liquid-Crystalline
  Materials Related to Image Sticking Phenomena of AM-LCD,” *ITE Technical
  Report* 21.3 (1997), 29–34,
  [J-STAGE PDF](https://www.jstage.jst.go.jp/article/itetr/21.3/0/21.3_29/_pdf).
- Used for: a period electrical/ionic time-scale constraint independent of the
  1994 STN material regression. In a 6 µm, 60 °C laboratory cell, the authors
  applied 10 V DC for 300 s, shorted for 5 s, then observed open-circuit
  residual voltage. Their general-polyimide example reports `ρ=10^15 Ω·cm`,
  `εr=3`, an RC time constant of 266 s, and an inferred 69.5% adsorbed-ion
  fraction at the ten-minute observation.
- Transformation: because charge at stress removal cannot exceed one, the
  reported 0.695 fraction bounds first-order release by
  `k_d <= -ln(0.695)/600 = 0.000606406 s^-1`. Combined with DMG-ION-01, the
  reconstruction solves the formation rate from the paper's complete
  300 s stress plus 600 s recovery protocol rather than assigning a frame
  coefficient.
- Limits: active-matrix high-temperature laboratory cells, not a DMG or a
  passive-matrix product measurement. It constrains the period-compatible
  kinetics but does not identify the DMG fill or optical transmission.

### DMG-ION-01 — Direct adsorption/desorption kinetic equation

- Source: Masanobu Mizusaki, Tetsuya Miyashita, and Tatsuo Uchida,
  “Interaction between Impurity Ions and Alignment Polymer Layers Affecting
  the Image Sticking Effect on Liquid Crystal Displays,” *Kobunshi Ronbunshu*
  68 (2011), 39–44,
  [DOI 10.1295/koron.68.39](https://doi.org/10.1295/koron.68.39).
- Used for: the directly measured first-order kinetic form
  `dn_a/dt = k_a N_s(n_s-n_a)-k_d n_a` and a slow-desorption range of
  `0.023–0.028 min^-1` at 25 °C. The midpoint `0.0255 min^-1` resolves the
  release rate that the period experiments alone leave unidentified and
  independently satisfies the DMG-STN-05 bound.
- Limits: a post-period laboratory measurement, not a DMG panel. It is used
  only to resolve a rate within the independent 1997 constraint; all context
  and this inferential boundary are retained in
  `data/stn-retention-evidence-v1.json`.

### DMG-DRIVE-01 — DMG-LCD-06 bias and driver topology

- Source: gekkio, [Game Boy DMG-LCD-06 reverse-engineered schematic](https://github.com/Gekkio/gb-schematics/blob/main/DMG-LCD-06/schematic/DMG-LCD-06.pdf).
- Used for: IR3E02 bias generator, 30 kΩ contrast potentiometer, V1–V5 rails,
  Sharp LH5076 row driver, Sharp LH5077 column driver, and the FR/CPG/LD0/LD1
  signal routing recorded in `data/dmg-drive-v1.json`.
- Limits: component connectivity reconstructed from a DMG-LCD-06 board; it is
  not a measurement of V1–V5 ratios or analogue row/column waveforms, and it
  does not establish DMG-LCD-01 equivalence.

### DMG-DRIVE-02 — DMG line and CPG timing capture

- Source: Thomas Spurden, [Capturing the Gameboy LCD with an FPGA](https://thomas.spurden.name/blog/capturing-gb-lcd/), including the linked
  [`6coins-title.vcd`](https://thomas.spurden.name/blog/capturing-gb-lcd/6coins-title.vcd).
- Used for: 108.724 µs mean line period, LD0/LD1 shift and CPL latch behavior,
  and four stable `c` rising edges per line. The VCD SHA-256 and recomputed
  phases are recorded in `data/dmg-drive-v1.json`.
- Limits: Spurden labels the captured line only `c`. Identifying it with the
  schematic's CPG input and inferring three equal grayscale dwell intervals is
  an explicit circuit-topology inference because no LH5077 data sheet or truth
  table has been recovered.

### DMG-SCAN-01 — Nintendo DMG frame and line timing

- Source: Nintendo, *Game Boy Programming Manual*, screen-timing diagram and
  `LY` register description (manual pages 53 and 56),
  [archival scan](https://files.nekoblog.org/uploads/pdf/39999184-GameBoy-Programming-Manual.pdf).
- Used for: 160 segments, 144 visible lines, 10 vertical-blanking lines,
  rounded `108.7 us` line time and `59.7 Hz` frame rate, and the statement that
  `LY=144..153` is vertical blanking. Combined with DMG-DRIVE-02, the runtime
  uses the captured `CPL` rising edge at line end as each row's electrical
  target-change event.
- Transformation: `data/dmg-scan-timing-v1.json` uses the existing physical
  surrogate's `59.7275 Hz` frame period divided by 154 rows. The resulting
  `108.718873 us` model line is cross-checked against both the manual's rounded
  value and Spurden's captured `108.723729 us` mean.
- Limits: PPU/LCD-interface timing does not measure sub-line analogue settling
  or a separate optical dead time. The model adds no unsupported pure delay.

### DMG-OPTICS-01 — Reflective 270-degree SBE/STN optics and multiplex drive

- Source: Terry J. Scheffer, “Direct-Multiplexed Liquid Crystal Displays,”
  *Japan Display '86* (1986),
  [J-STAGE PDF](https://www.jstage.jst.go.jp/article/tvtr/10/21/10_KJ00001966449/_pdf).
- Used for: Alt–Pleshko selection-ratio equation; full Frank elastic treatment;
  sub-270° commercial-production boundary; high-pretilt SBE cells; two-polarizer
  reflective topology; and wavelength-dependent yellow-mode behavior.
- Limits: general 100-row experimental/computed SBE evidence, not Nintendo
  panel data. The project's 260° twist and polarizer offsets remain bounded,
  BGB-constrained reconstruction values.

### DMG-MATERIAL-01 — Published ZLI-2293 material constants

- Source: Yun-Han Lee, Zhibing Ge, and Shin-Tson Wu, “Reflective Color Display
  Using Field-Sequential-Color LED Backlight,” *Applied Physics Letters* 90,
  201108 (2007), [author-hosted PDF](https://lcd.creol.ucf.edu/people/zge/Papers/APL%20Lee%20VA.pdf).
- Supporting source: Merck reference-mixture property table in
  [US Patent 8,804,092](https://patents.google.com/patent/US8804092B2/en).
- Used for: the proxy material's published `K11=12.5 pN`, `K22=7.2 pN`,
  `K33=17.9 pN`, dielectric constants, refractive indices, and strong-anchoring
  context. Published Merck ZLI-2293 rotational viscosity at 20 °C supplies the
  nominal `gamma1=0.162 Pa·s` value.
- Limits: ZLI-2293 is a characterized reference mixture, not an identification
  of the unknown DMG fill. It anchors an era-plausible ensemble, not a DMG
  material claim.

### DMG-MATERIAL-02 — Period STN geometry and material envelope

- Sources: Okada et al. [DMG-STN-04] and Takatsu [DMG-STN-03].
- Used for: measured 4–7 µm cells at `Δn·d≈0.95 µm`, `d/p≈0.7`, period
  viscosity/birefringence trade-offs, and bounded fast/nominal/slow members in
  `data/stn-material-ensemble-v1.json`.
- Limits: the ensemble propagates the absence of a usable unaged DMG specimen;
  none of its members is labeled an actual DMG formulation.

### DMG-MATRIX-01 — Passive-matrix addressing limits

- Source: Arlie R. Conner, “Active Addressing for High-Performance
  Passive-Matrix LCDs,” *Information Display* 8 (1992), 10–13,
  [DOI 10.1002/j.2637-496X.1992.tb06185.x](https://doi.org/10.1002/j.2637-496X.1992.tb06185.x).
- Supporting source: Hitachi Europe Ltd., “Liquid Crystal Display (LCD)
  Passive Matrix and Active Matrix Addressing,” application note AN-002
  (August 2004),
  [archival mirror](https://eclass.hmu.gr/modules/document/file.php/EE315/AN-002_Passive_and_Active_Matrix.pdf).
- Used for: pattern-dependent row/column loading, frame response, contrast loss,
  and crosstalk as passive-matrix mechanisms.
- Transformation: the normal path uses the Alt–Pleshko 1/144 selected/nonselected
  RMS ratio in `data/dmg-drive-v1.json`. WS5 separately reconstructs spatial
  loading from the sources below; it does not reuse the former state-mixing
  diagnostic or apply a Gaussian blur.
- Limits: this source establishes the mechanism and system-level consequences,
  not DMG conductor or driver values.

### DMG-MATRIX-02 — Period distributed-electrode crosstalk model

- Source: J. Nehring and T. J. Scheffer, “Crosstalk In Multiplexed
  Liquid-Crystal Matrix Displays Due to Electrode Resistance,” *Molecular
  Crystals and Liquid Crystals* 191 (1990), 87–95,
  [DOI 10.1080/00268949008038582](https://doi.org/10.1080/00268949008038582).
- Used for: the resistor-ladder/pixel-capacitor topology, the
  resistance-frequency-capacitance scaling, and the requirement to evaluate
  pattern and multiplex dependence rather than assign a blur strength.
- Transformation: `reference/passive-matrix-crosstalk.mjs` extends the paper's
  electrode model with sourced driver output resistance and LC leakage. It
  solves all 144 row and 160 column ladders over the DMG's three grayscale
  dwells, then combines row and column errors by first-order linear
  superposition. The omitted product term is reported rather than hidden.
- Limits: the paper analyzes comparable direct-multiplex TN/STN matrices, not a
  Nintendo panel. Its authors omit LC ohmic conductivity and identify driver
  output impedance as a future refinement; WS5 adds both from separate bounds.
  A KONKR Tetris mixed-tone regression showed that the reconstructed
  shade-specific uniform baseline can over-correct shade 2 in a nonuniform
  field. Runtime therefore limits that uncertain correction to `±0.125` shade
  and tests shade 3 borders around shade 2 interiors. This is an explicit
  tone-order safety boundary, not a sourced Nintendo electrical parameter.

### DMG-ITO-01 — 1988 transparent-electrode production bound

- Source: Fujitsu, “Method of forming transparent conductive film,”
  [JPS63221591A](https://patents.google.com/patent/JPS63221591A/en), published
  14 September 1988.
- Used for: the high-resistance side of the period ITO ensemble.
- Measurement context: heat treatment was monitored while an as-deposited
  `150–200 Ω/□` ITO film on transparent glass fell to its measured
  `30–40 Ω/□` minimum.
- Limits: a production-process result, not the DMG mask or its delivered glass.

### DMG-ITO-02 — Standard low-resistance ITO construction

- Source: “Multilayered conductive film, and transparent electrode substrate
  and liquid crystal device using the same,”
  [EP0733931A2](https://patents.google.com/patent/EP0733931A2/en) (1996).
- Used for: the lower/nominal sheet-resistance anchor and a dimensional
  cross-check. The document gives standard ITO resistivity
  `2.4×10^-4 Ω·cm`; at `240 nm` this is `10 Ω/□`, and it describes
  `5 Ω/□` as the lower value needed by larger fine-pattern devices.
- Limits: six years after the target period. It bounds an already-established
  ITO production trade-off; it is not evidence that Nintendo bought this film.

### DMG-DRIVER-03 — Period LCD-driver output resistance

- Source: Hitachi, *HD44100R LCD Driver with 40-Channel Outputs*,
  [datasheet PDF](https://www.jaapsch.net/psion/pdffiles/hd44100_datasheet.pdf).
- Used for: the nominal comparable period-driver output resistance. The part is
  explicitly usable as common or segment driver and specifies maximum
  `RON=20 kΩ` at `±0.05 mA`, `VCC−VEE=4 V`, with all Y pins driven.
- Limits: comparable 1990 multiplex LCD silicon, not Sharp LH5076/LH5077.

### DMG-DRIVER-04 — Multi-output driver sensitivity bound

- Source: Hitachi, *HD66100F 80-channel LCD Driver*, electrical-characteristic
  table mirrored with the
  [HD44100H/HD66100F data](https://www.alldatasheet.com/html-pdf/82775/HITACHI/HD44100H/3019/12/HD44100H.html).
- Used for: a sourced `11–30 kΩ` sensitivity interval: `11 kΩ` maximum when
  measuring one output at `0.1 mA`, and `30 kΩ` maximum with all outputs at
  `0.05 mA`, at `VCC−VEE=3–6 V`.
- Limits: test-condition and device-family variation are deliberately included
  in the ensemble. The range is not relabeled as an LH5076/LH5077 measurement.

### DMG-LCELECTRICAL-01 — Period LC resistivity floor

- Source: “Method for remotely detecting an electric field using a liquid
  crystal device,” [US Patent 4,818,072](https://patents.justia.com/patent/4818072)
  (1989).
- Used for: a conservative period nematic/smectic LC volume-resistivity floor
  of `10^11 Ω·cm`. Combined with DMG pixel area and the 4–7 µm gap, it gives a
  minimum pixel leakage time constant of `35.4 ms`, about 977 grayscale dwells.
- Limits: not an STN product-panel measurement. Leakage remains in the solver;
  this bound only demonstrates that it is a small WS5 dwell-scale correction,
  while slow ionic retention continues to belong to WS4.

### DMG-DIMENSIONS-01 — Manufacturer screen geometry

- Source: Nintendo, [Game Boy technical data](https://www.nintendo.com/fr-fr/Assistance/Consoles-plus-anciennes/Donnees-techniques-619585.html)
  and [hardware history](https://www.nintendo.com/en-gb/Hardware/Nintendo-History/Game-Boy/Game-Boy-627031.html).
- Used for: the `47×43 mm`, `160×144` active geometry and confirmation of an
  STN dot-matrix LCD. Together with the BGB 0.875 active fraction this gives a
  `6.7135×10^-8 m²` active pixel area.
- Transformation: `C=ε0 εr A/d` with the WS2 `4–7 µm` gap and the ZLI-2293
  proxy's orientation extrema `ε⊥=4`, `ε∥=14` yields the sourced/derived
  `0.340–2.081 pF` WS5 pixel-capacitance range.
- Limits: Nintendo does not publish electrode width, cell gap, capacitance, or
  driver resistance; those uncertainties remain explicit ensemble axes.

### DMG-HW-01 — Hardware identity and revisions

- Source: gekkio, [Game Boy Hardware Database: DMG consoles](https://gbhwdb.gekkio.fi/consoles/dmg/).
- Used for: hardware/revision context and Sharp LCD-driver identification.
- Limits: hardware inventory, not an optical-response measurement.

### DMG-ENGINE-01 — RetroArch slang feedback system and prior art

- Source: Libretro, slang-shaders, fixed commit
  [`1d5a9f038a4757fc85c7720ef440b957531c85e8`](https://github.com/libretro/slang-shaders/tree/1d5a9f038a4757fc85c7720ef440b957531c85e8)
  and [`handheld/gameboy.slangp`](https://github.com/libretro/slang-shaders/blob/1d5a9f038a4757fc85c7720ef440b957531c85e8/handheld/gameboy.slangp).
- Used for: RetroArch `.slang`/`.slangp` conventions, frame-history access,
  and comparison with an established seven-frame
  handheld approximation. Retro Display Lab's recursive IIR state is an
  independent implementation, not copied from this preset.
- Limits: upstream `response_time=0.33` is prior-art preset behavior, not
  treated as a verified DMG panel curve. Retro Display Lab code is original.
- Redistribution: no Libretro shader code is copied into this model.

## Parameter-to-evidence map

| Implementation | Evidence IDs | Classification |
| --- | --- | --- |
| five-state palette and linear-light interpolation | DMG-COLOR-01 | reference-image matched |
| generated director-drift LUT and reflective optical LUT | DMG-DRIVE-01, DMG-DRIVE-02, DMG-OPTICS-01, DMG-STN-04, DMG-MATERIAL-01, DMG-MATERIAL-02 | bounded physical reconstruction |
| per-row CPL latch and causal source-history split | DMG-SCAN-01, DMG-DRIVE-02, DMG-ENGINE-01 | DMG-specific timing and captured latch behavior |
| ionic integrator, formation, and release | DMG-STN-01, DMG-STN-05, DMG-ION-01 | period-protocol-constrained reconstruction; optical bridge experimental |
| passive-matrix selection loss | DMG-DRIVE-01, DMG-DRIVE-02, DMG-MATRIX-01 | physical RMS reconstruction |
| pattern-dependent spatial electrical loading | DMG-MATRIX-02, DMG-ITO-01, DMG-ITO-02, DMG-DRIVER-03, DMG-DRIVER-04, DMG-LCELECTRICAL-01, DMG-DIMENSIONS-01, DMG-MATERIAL-01 | period-bounded distributed-RC reconstruction with declared surrogate error |
| periodic aperture and joint reflector-shadow integration | DMG-APERTURE-01 | scale-invariant implementation of reference-image matched/experimental geometry |
| RetroArch feedback/preset integration | DMG-ENGINE-01 | platform prior art |

## Special thanks

Special thanks to BGB author beware for publishing unusually careful DMG color and
motion observations; to the authors of the cited LCD research; to gekkio and
hardware contributors; and to the Libretro community for the open shader
runtime and prior handheld-display work.
