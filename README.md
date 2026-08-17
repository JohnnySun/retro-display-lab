# Retro Display Lab

**English** | [繁體中文](README.zh-tw.md) | [简体中文](README.zh-cn.md)

Research-grade, physics-informed handheld display shaders for RetroArch.

Retro Display Lab reconstructs how an original LCD behaves as a dynamic optical
system. It is not a color-tint collection: each model can combine documented
optical states, pixel aperture, matrix/TFT structure, direction-dependent
response, gray-to-gray transitions, crosstalk, and slow image retention. Every
important mechanism and parameter is linked to measurements, primary
literature, or an explicitly labeled experimental assumption.

## What makes the method different

A tint changes color but cannot reproduce motion-dependent display defects. A
fixed blend of several previous frames can suggest persistence, but it truncates
history arbitrarily and gives every transition the same behavior. Retro Display
Lab instead uses causal per-pixel state:

- fast and slow optical response evolve over the complete frame history;
- darkening and clearing, or individual gray-to-gray transitions, can differ;
- exposure-dependent ionic/residual-DC state accumulates and releases on a
  separate time scale;
- aperture, reflector shadow, row/column crosstalk, or TFT substructure are
  modeled independently from color;
- source-panel physics is separated from compensation for the modern target
  display.

This is a **physics-informed, measurement-constrained reconstruction**. Where a
panel's original waveform or response matrix is unavailable, the repository
publishes the literature constraint, candidate value, and uncertainty instead
of calling it an exact measurement. See [Methodology](docs/methodology.md),
[Reference policy](docs/reference-policy.md), and the complete
[reference index](REFERENCES.md).

## Available model: Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) reconstructs the original
Game Boy's reflective passive-matrix STN display with:

- four game-addressable shades plus a distinct LCD-disabled optical background;
- asymmetric short response, a structural slow tail, and per-pixel ionic
  image-sticking state constrained by a 1994 STN experiment;
- sparse row/column crosstalk;
- rectangular aperture and reflector shadow based on documented DMG close-ups;
- reference, heavy-ghosting, aged, and accelerated experiment presets.

The exact mapping from each source to code and limitations is in the
[DMG-01 evidence map](models/nintendo-dmg-01/REFERENCES.md).

### Visual comparison

<table>
  <tr>
    <th>Shader off — raw Gambatte output</th>
    <th>Shader on — DMG-01 Reference v1</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-off.png" alt="Tetris on KPA with the DMG-01 shader disabled"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-shader-on.png" alt="Tetris on KPA with the DMG-01 Reference v1 shader enabled"></td>
  </tr>
</table>

These are representative 960×640 framebuffer captures from the same KPA,
Gambatte core, Tetris ROM, viewport, and display state—not the same emulation
frame. A still image cannot fully show temporal decay.

## AGS-101 research prototype

<table>
  <tr>
    <th>Shader off — raw emulator output</th>
    <th>Shader on — AGS-101 physics prototype</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="GBA Mario gameplay with the AGS-101 shader disabled"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="GBA Mario gameplay with the AGS-101 physics prototype enabled"></td>
  </tr>
</table>

The prototype separates BGR aperture, measured-reference color,
transition-dependent TFT response, and slow residual-DC retention. Its current
color stage depends on HCS-derived data whose fixed upstream snapshot has no
confirmed redistribution license, and no identified AGS-101 gray-to-gray matrix
has yet been measured. The screenshots document ongoing research; an AGS-101
preset is not included. See the [AGS-101 evidence map](models/nintendo-ags-101/REFERENCES.md).

Game imagery is used only to document shader behavior. Tetris, Mario, Nintendo
trademarks, and game content remain the property of their respective owners.

## Download

- Stable package: [latest GitHub release](https://github.com/JohnnySun/retro-display-lab/releases/latest)
- Current development snapshot: [download `main` as ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git: `git clone https://github.com/JohnnySun/retro-display-lab.git`

## Install in RetroArch

1. Extract or clone the repository to
   `RetroArch/shaders/retro-display-lab`.
2. Select the Vulkan video driver and enable integer scaling when required by
   the target profile.
3. Disable the emulator core's own frame mixing; otherwise temporal response is
   simulated twice.
4. Load a `.slangp` from a matching target profile.

For the tested KONKR GT78-VN target, load:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

This target uses a 640×576 DMG viewport at exact 4× scale on a 960×640 panel.
Its display state is **sRGB-neutral, unmeasured**, not instrument-calibrated
sRGB. Other displays should start with the model preset and create a separate
target profile. See the full [installation guide](docs/installation.md).

## Reproducibility and validation

```sh
npm test
```

Checks cover shader/preset structure, reference IDs, palette ordering, STN
response anchors, the published 1994 regression, long-tail behavior, target
scale, and disclosure of unmeasured target state. Contributions must follow the
[evidence policy](docs/reference-policy.md) and [contribution guide](CONTRIBUTING.md).
For academic or technical use, cite both [`CITATION.cff`](CITATION.cff) and the
model-local sources that support the mechanisms used.

## License

Original code and documentation are licensed under Apache-2.0. Third-party
references remain under their own terms; no BGB photographs, commercial ROMs,
or unlicensed HCS shader/data files are redistributed here.
