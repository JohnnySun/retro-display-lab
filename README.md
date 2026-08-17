# Retro Display Lab

**English** | [繁體中文](README.zh-tw.md) | [简体中文](README.zh-cn.md)

Handheld LCD shaders for RetroArch, with the physics and the sources written
down.

Most retro screen shaders are palettes. They get the tint of a Game Boy screen
roughly right and stop there. But a DMG screen isn't a color — it's a slow
reflective optical device, and a lot of what makes it recognizable only happens
over time: the smear trailing a falling tetromino, dark pixels clearing back up
more slowly than they darkened, the faint ghost of a title screen that lingers
after you've left it.

That behavior is what this repository tries to reconstruct. A model can combine
documented optical states, pixel aperture, matrix and TFT structure,
direction-dependent response, gray-to-gray transitions, crosstalk, and slow
image retention. Every mechanism and parameter that matters is tied back to a
measurement, to primary literature, or to an assumption that is labeled as one.

## What the model actually does

A tint changes color but can't reproduce a defect that only shows up in motion.
Blending a fixed number of previous frames gets closer, but it truncates the
history arbitrarily and gives every transition the same behavior. This project
keeps causal per-pixel state instead:

- fast and slow optical response evolve over the whole frame history, not a
  fixed window;
- darkening and clearing can run at different speeds, and so can individual
  gray-to-gray transitions;
- ionic and residual-DC state accumulates with exposure and releases again on
  its own, much longer, time scale;
- aperture, reflector shadow, row and column crosstalk, and TFT substructure
  are modeled separately from color;
- the physics of the original panel is kept apart from the compensation for
  whatever modern display you're looking at it on.

Calling this a **physics-informed, measurement-constrained reconstruction** is a
deliberate hedge. Where a panel's original drive waveform or response matrix
isn't available, the repository publishes the literature constraint, the
candidate value, and the uncertainty rather than dressing a derived number up as
an exact measurement. See [Methodology](docs/methodology.md), the
[reference policy](docs/reference-policy.md), and the full
[reference index](REFERENCES.md).

## Available model: Nintendo DMG-01

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) reconstructs the original
Game Boy's reflective passive-matrix STN display:

- the four shades a game can address, plus a distinct optical background for
  when the LCD is disabled;
- asymmetric short response, a structural slow tail, and per-pixel ionic
  image-sticking constrained by a 1994 STN experiment;
- sparse row and column crosstalk;
- rectangular aperture and reflector shadow, based on documented DMG close-ups;
- reference, heavy-ghosting, aged, and accelerated-experiment presets.

Which source backs which line of code — and where the limits are — is spelled
out in the [DMG-01 evidence map](models/nintendo-dmg-01/REFERENCES.md).

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

Both are 960×640 framebuffer captures from the same KPA, Gambatte core, Tetris
ROM, viewport, and display state — but not from the same emulation frame. A
still image can't really show temporal decay anyway.

## Available physics seed: Nintendo GBA SP AGS-101

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

The downloadable
[`physics-seed-v1`](models/nintendo-ags-101/presets/physics-seed-v1.slangp)
separates BGR aperture, transition-dependent TFT response, and slow residual-DC
retention. It uses a neutral sRGB color adapter, so it contains none of the
unlicensed HCS-derived EOTF tables, matrices, or black/white measurements used
by the private research prototype shown above.

No gray-to-gray matrix has yet been measured for a named AGS-101 panel. The
temporal constants are reproducible literature-constrained candidates, not
panel measurements. The exact public/private data boundary is in the
[AGS-101 evidence map](models/nintendo-ags-101/REFERENCES.md).

Game imagery here exists only to show what the shaders do. Tetris, Mario,
Nintendo trademarks, and game content belong to their respective owners.

## Download

- Stable v0.3.0: [fixed tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.3.0.zip)
- Release notes: [GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- Latest development snapshot: [`main` as ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git: `git clone https://github.com/JohnnySun/retro-display-lab.git`

## Install in RetroArch

1. Extract or clone the repository into
   `RetroArch/shaders/retro-display-lab`.
2. Switch to the Vulkan video driver, and turn on integer scaling if the target
   profile asks for it.
3. Turn off the core's own frame mixing — otherwise the temporal response gets
   simulated twice.
4. Load a `.slangp` from a target profile that matches your device.

For the KONKR GT78-VN I've tested on, that means:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

For GBA content on the same target, load:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-physics-seed-v1.slangp
```

That profile puts a 640×576 DMG viewport on a 960×640 panel at exactly 4×. Its
display state is **sRGB-neutral and unmeasured** — which is not the same thing
as instrument-calibrated sRGB. On any other display, start from the model preset
and build your own target profile. The
[installation guide](docs/installation.md) has the long version.

## Reproducibility and validation

```sh
npm test
```

The checks cover shader and preset structure, reference IDs, palette ordering,
STN and TFT response anchors, the published 1994 regression, residual-DC
integration, target scale, forbidden HCS constants, and whether unmeasured
target state is actually disclosed as such.
Contributions need to follow the [evidence policy](docs/reference-policy.md) and
the [contribution guide](CONTRIBUTING.md). For academic or technical use, cite
[`CITATION.cff`](CITATION.cff) along with the model-local sources behind the
mechanisms you relied on.

## License

The original code and documentation are Apache-2.0. Third-party references stay
under their own terms: no BGB photographs, commercial ROMs, or unlicensed HCS
shader and data files are redistributed here.
