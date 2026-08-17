# Nintendo GBA SP AGS-101 evidence map

Accessed 2026-08-18. This is a research map for the current prototype; no
downloadable AGS-101 preset is published yet.

## Source records

### AGS-HW-01 — Nintendo hardware documentation

- Source: Nintendo, [Game Boy Advance SP instruction manual](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/agsmanual_english?_a=DATAg1AAZAA0)
  and [official support page](https://en-americas-support.nintendo.com/app/answers/detail/a_id/16961/).
- Used for: manufacturer-level form-factor and display-family context.
- Limits: the general SP manual describes a 2.9-inch TFT LCD but does not supply
  AGS-101 gray-to-gray curves, EOTF, spectral data, or image-sticking constants.

### AGS-COLOR-01 — Handheld Color Space Project measurement snapshot

- Source: Brankale, Handheld Color Space Project, fixed commit
  [`e688fc51141c0974728aa1bdcb89b94d74123f6b`](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b),
  [AGS-101 measurement directory](https://github.com/Brankale/Handheld-Color-Space-Project/tree/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D), and
  [AGS-101 sRGB shader](https://github.com/Brankale/Handheld-Color-Space-Project/blob/e688fc51141c0974728aa1bdcb89b94d74123f6b/handhelds/Nintendo%20GBA%20SP%20AGS-101/%5B2023-07-24%5D%5BPokefan531%5D/shaders/GBA_SP_AGS101_sRGB.slang).
- Used for: prototype EOTF/color-stage research and comparison against an
  instrument-derived transform for one identified measurement set.
- Limits: one panel/specimen/protocol cannot define every AGS-101. The fixed
  commit's root was checked through the GitHub API on 2026-08-18 and no explicit
  `LICENSE`/`COPYING` file was present.
- Redistribution: cited but not redistributed. HCS-derived color data/code are
  excluded until permission is confirmed or independently measured data replace
  them.

### AGS-COLOR-02 — Libretro SP101 color prior art

- Source: Libretro, slang-shaders, fixed commit
  [`1d5a9f038a4757fc85c7720ef440b957531c85e8`](https://github.com/libretro/slang-shaders/tree/1d5a9f038a4757fc85c7720ef440b957531c85e8),
  [`sp101-color.slang`](https://github.com/libretro/slang-shaders/blob/1d5a9f038a4757fc85c7720ef440b957531c85e8/handheld/shaders/color/sp101-color.slang).
- Used for: comparison with established color-transform approaches.
- Limits: color transformation alone does not establish temporal panel physics;
  no code is copied into the unpublished response prototype.

### AGS-GTG-01 — TFT gray-to-gray overdrive

- Source: Baek-woon Lee, Cheolwoo Park, Sangil Kim, Manbok Jeon, Jun Heo,
  Dongsik Sagong, Jongseon Kim, and Junhyung Souk, “Reducing Gray-Level
  Response to One Frame: Dynamic Capacitance Compensation,” *SID Symposium
  Digest* 32(1) (2001),
  1260–1263, [DOI 10.1889/1.1831790](https://doi.org/10.1889/1.1831790).
- Supporting source: Sharp, [TW200425030A — liquid-crystal gray-level response
  driving](https://patents.google.com/patent/TW200425030A/en).
- Used for: direction- and transition-dependent gray-to-gray response as a TFT
  mechanism rather than a fixed N-frame blend.
- Limits: architecture-level literature, not a measured response matrix for the
  AGS-101 panel.

### AGS-STICK-01 — TFT residual DC and image sticking

- Source: [US6590411B2 — Liquid crystal display device with reduced image
  sticking](https://patents.google.com/patent/US6590411B2), including residual
  DC, ionic effects, alignment layers, and storage/parasitic capacitance.
- Supporting source: Masanobu Mizusaki, Tetsuya Miyashita, Tatsuo Uchida,
  Yuichiro Yamada, and Yutaka Ishii, “The Mechanism of Internal DC Offset
  Voltage and its Application to LCD,” Japanese Liquid Crystal Conference
  (2006), [DOI 10.11538/ekitou.2006.0.29.0](https://doi.org/10.11538/ekitou.2006.0.29.0).
- Used for: separating fast optical response from slow exposure-dependent
  residual-DC/image-sticking state.
- Limits: these sources constrain mechanisms and stress behavior, not AGS-101
  amplitudes or time constants.

### AGS-PANEL-01 — Community panel-label record

- Source: iceboy, [AGS panel database record](https://iceboy.a-singer.de/db/ags_iceboy_2.html).
- Used for: specimen/panel-label context when correlating future measurements.
- Limits: community hardware record; not optical metrology or manufacturer
  confirmation of all AGS-101 units.

## Prototype status and evidence gap

The current prototype separates BGR aperture structure, measured-reference
color, transition-dependent optical response, and slow residual-DC retention.
However, no published source above supplies an identified AGS-101 panel's full
gray-to-gray response matrix and long-duration recovery curve. Temporal values
remain bounded candidates until we measure an identified specimen under a
documented protocol. The repository therefore shows prototype screenshots but
does not distribute or advertise an AGS-101 model as complete.

## Special thanks

Special thanks to the Handheld Color Space Project contributors for publishing
measurement reports, to Libretro shader maintainers, to the cited display
researchers, and to handheld hardware archivists. Citation is acknowledgment,
not an assertion that those projects endorse this model.
