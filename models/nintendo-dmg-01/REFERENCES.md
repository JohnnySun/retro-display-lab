# Nintendo DMG-01 evidence map

Accessed 2026-08-18. Evidence labels follow the repository
[reference policy](../../docs/reference-policy.md).

## Source records

### DMG-COLOR-01 — BGB DMG reality: optical states

- Source: BGB, [The reality of DMG colors](https://bgb.bircd.org/reality/index.html), including the [five-state color scheme](https://bgb.bircd.org/reality/dmg-reality-colorscheme.png).
- Used for: four driven shades plus the distinct LCD-disabled background;
  central-patch sRGB samples; gamma-aware palette interpolation.
- Transformation: central color patches were sampled as `#948A04`, `#759833`,
  `#588F51`, `#3B7560`, and `#2E615A`. The first is reserved for unpowered
  aperture gaps; game data selects only the other four states.
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
  grid at exact 4x output.
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
  and its mixtures are not identified as the DMG panel material. Charge/release
  rates and optical gain remain experimental candidates.
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
  300 ms and later low-viscosity/high-birefringence mixtures improved it.
- Limits: literature range for STN materials, not a DMG measurement.

### DMG-STN-04 — High-speed 270-degree STN experiment

- Source: Kazuhiro Okada, Satofumi Koike, Motonao Arai, Toshiro Yukinari, and
  Akira Harada, “High Response Speed Supertwisted LCD,” *Journal of the
  Institute of Television Engineers of Japan* 42(10) (1988), 1022–1028,
  [J-STAGE PDF](https://www.jstage.jst.go.jp/article/itej1978/42/10/42_10_1022/_pdf).
- Used for: duty ratio, cell gap, viscosity, and hysteresis as response-time
  variables; historical lower-bound context for a deliberately fast STN cell.
- Limits: the reported prototype is not the DMG panel.

### DMG-MATRIX-01 — Passive-matrix addressing limits

- Source: Arlie R. Conner, “Active Addressing for High-Performance
  Passive-Matrix LCDs,” *Information Display* 8 (1992), 10–13,
  [DOI 10.1002/j.2637-496X.1992.tb06185.x](https://doi.org/10.1002/j.2637-496X.1992.tb06185.x).
- Supporting source: Sharp, “Passive Matrix and Active Matrix Liquid Crystal
  Displays,” application note AN-002,
  [archival mirror](https://eclass.hmu.gr/modules/document/file.php/EE315/AN-002_Passive_and_Active_Matrix.pdf).
- Used for: pattern-dependent row/column loading, frame response, contrast loss,
  and crosstalk as passive-matrix mechanisms.
- Transformation: sparse row/column taps approximate electrode loading within a
  mobile-GPU budget.
- Limits: no DMG waveform or driver model is reconstructed; tap count and gains
  are literature-constrained approximations.

### DMG-HW-01 — Hardware identity and revisions

- Source: gekkio, [Game Boy Hardware Database: DMG consoles](https://gbhwdb.gekkio.fi/consoles/dmg/).
- Used for: hardware/revision context and Sharp LCD-driver identification.
- Limits: hardware inventory, not an optical-response measurement.

### DMG-ENGINE-01 — RetroArch slang feedback system and prior art

- Source: Libretro, slang-shaders, fixed commit
  [`1d5a9f038a4757fc85c7720ef440b957531c85e8`](https://github.com/libretro/slang-shaders/tree/1d5a9f038a4757fc85c7720ef440b957531c85e8)
  and [`handheld/gameboy.slangp`](https://github.com/libretro/slang-shaders/blob/1d5a9f038a4757fc85c7720ef440b957531c85e8/handheld/gameboy.slangp).
- Used for: RetroArch `.slang`/`.slangp` conventions, feedback/IIR capability,
  and comparison with established multi-pass handheld approximations.
- Limits: upstream `response_time=0.33` is prior-art preset behavior, not
  treated as a verified DMG panel curve. Retro Display Lab code is original.
- Redistribution: no Libretro shader code is copied into this model.

## Parameter-to-evidence map

| Implementation | Evidence IDs | Classification |
| --- | --- | --- |
| five-state palette and linear-light interpolation | DMG-COLOR-01 | reference-image matched |
| causal fast/slow optical feedback | DMG-MOTION-01, DMG-STN-02, DMG-STN-03, DMG-STN-04 | literature-constrained experimental candidate |
| ionic integrator and 1994 regression | DMG-STN-01 | literature-constrained; optical bridge experimental |
| row/column crosstalk | DMG-MATRIX-01 | literature-constrained approximation |
| aperture and reflector shadow | DMG-APERTURE-01 | reference-image matched/experimental |
| RetroArch feedback/preset integration | DMG-ENGINE-01 | platform prior art |

## Special thanks

Special thanks to BGB author beware for publishing unusually careful DMG color and
motion observations; to the authors of the cited LCD research; to gekkio and
hardware contributors; and to the Libretro community for the open shader
runtime and prior handheld-display work.
