# Retro Display Lab

Physics-informed handheld display shaders, target display profiles, and
reproducible validation for RetroArch.

Retro Display Lab treats an old screen as a dynamic optical system rather than
as a color tint. A model may include direction-dependent liquid-crystal
response, long-tail image retention, matrix crosstalk, pixel aperture, reflector
shadow, and a separately documented compensation profile for the modern panel
that shows the result.

## First public model

`models/nintendo-dmg-01` reconstructs the original Game Boy's reflective
passive-matrix STN display with:

- four driven shades plus a distinct LCD-disabled optical background;
- asymmetric darkening and clearing response;
- a structural slow tail and per-pixel ionic image-sticking state;
- sparse row/column crosstalk;
- measured-reference rectangular aperture and reflector shadow;
- reference, heavy-ghosting, aged, and accelerated 1994 experiment presets.

The first tested target profile is the KONKR GT78-VN at 960×640, with a 640×576
DMG viewport at exact 4× integer scale. Its display state is described as
**sRGB-neutral, unmeasured**—not as instrument-calibrated sRGB.

## Install in RetroArch

Copy this repository into RetroArch's shader directory as
`shaders/retro-display-lab`, then load:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

Other displays can start from the model-level preset and override only target
compensation parameters. See [installation](docs/installation.md) and
[methodology](docs/methodology.md).

## Evidence labels

Every model should distinguish instrument measurements, literature constraints,
reference-image matching, target-device tuning, and experimental assumptions.
The shaders are reproducible candidates with explicit limits; they are not a
claim that every surviving panel behaves identically.

## AGS-101 status

The AGS-101 physical-response work is being separated from color data derived
from the Handheld Color Space Project. The inspected upstream snapshot does not
contain an explicit redistribution license, so those data and derived color
code are not included in this initial public release. See
[`models/nintendo-ags-101/README.md`](models/nintendo-ags-101/README.md).

## Validation

```sh
npm test
```

The current checks verify shader structure, preset references, palette ordering,
STN response anchors, the published 1994 regression, long-tail behavior, and
target-profile invariants.

## License

Original code and documentation in this repository are licensed under the
Apache License 2.0. Third-party references remain under their respective terms;
no BGB photographs, commercial ROMs, or unlicensed HCS shader/data files are
redistributed here.

