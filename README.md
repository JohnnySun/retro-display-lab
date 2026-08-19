# Retro Display Lab

**English** | [繁體中文](README.zh-tw.md) | [简体中文](README.zh-cn.md)

Physics-based handheld LCD shaders for RetroArch, with the model and its sources
written down.

Most retro screen shaders begin and end with color. That can make a screenshot
look familiar, but it cannot reproduce the panel itself: a falling tetromino
smearing into the rows behind it, one gray transition taking longer than
another, a passive-matrix line changing the drive seen by its neighbors, or a
static image leaving a faint electrical memory after it is gone.

Retro Display Lab reconstructs those behaviors as causal panel simulations.
The DMG-01 model follows passive-matrix drive through STN director dynamics,
row and column crosstalk, slow ionic state, and the reflective pixel structure.
The AGS-101 model follows measured panel color through TFT gray-to-gray
response, alternating drive and residual DC, scan/latch/optical timing, and BGR
subpixel aperture. These are not decorative ghosting passes laid over a palette;
the visible result comes from state that evolves as the original display is
driven.

## What the model actually does

A tint changes color. A fixed blend of previous frames adds generic blur. This
project instead keeps the electrical and optical state that each pixel needs:

- input codes become panel drive and optical targets before they become host
  display colors;
- response continues over the full frame history, with different darkening,
  clearing, and gray-to-gray paths;
- passive-matrix loading and crosstalk are solved separately from STN response,
  while TFT drive polarity and residual DC have their own persistent state;
- scan position, latch time, optical onset, pixel aperture, reflector shadow,
  and BGR subpixels are explicit parts of the model rather than texture added at
  the end;
- original-panel behavior remains separate from compensation for the modern
  display on which the shader is viewed.

Both normal presets are therefore physics-based end to end. That does not mean
every constant is a direct measurement of a pristine original panel. Where an
original drive waveform or response matrix is no longer available, the model
uses a literature-constrained reconstruction and says so.

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
- exact Game Boy scan timing feeding a mobile surrogate of RMS drive, STN
  director dynamics, and reflected optical response;
- row/column electrode loading, local passive-matrix crosstalk, and a bounded
  common-mode correction that preserves neighboring logical shades;
- asymmetric transitions and per-pixel ionic image sticking constrained by
  period STN measurements;
- rectangular aperture and reflector shadow, based on documented DMG close-ups;
- reference, heavy-ghosting, aged, and accelerated-experiment presets.

Which source backs which line of code — and where the limits are — is spelled
out in the [DMG-01 evidence map](models/nintendo-dmg-01/REFERENCES.md). The
current machine-readable reconstruction decisions and remaining implementation
work are tracked in
[`reconstruction-v1.json`](models/nintendo-dmg-01/data/reconstruction-v1.json)
and the [implementation to-do](models/nintendo-dmg-01/IMPLEMENTATION-TODO.md).

### Representative captures

<table>
  <tr>
    <th>Title screen — crosstalk</th>
    <th>Falling piece — ghosting</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-crosstalk.png" alt="Tetris title screen on KPA showing DMG-01 row and column crosstalk"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-ghosting.png" alt="A falling I tetromino above a built-up Tetris field on KPA showing DMG-01 ghosting"></td>
  </tr>
</table>

Both are 960×640 framebuffer captures from the same KPA, Gambatte core, Tetris
ROM, current DMG shader, viewport, display state, and Game Boy bezel. The broad
high-contrast title graphics expose row and column crosstalk; the gameplay shot
catches an I tetromino falling over a built-up field, where its vertical trail
makes the temporal response visible. A still image can only show one instant of
that decay.

## Available model: Nintendo GBA SP AGS-101

<table>
  <tr>
    <th>Shader off — raw emulator output</th>
    <th>Shader on — AGS-101 physics model</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="GBA Mario gameplay with the AGS-101 shader disabled"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="GBA Mario gameplay with the AGS-101 physics model enabled"></td>
  </tr>
</table>

The preset is still named
[`physics-seed-v1`](models/nintendo-ags-101/presets/physics-seed-v1.slangp), but
the five planned physics workstreams are now implemented. Its two-pass runtime
combines:

- a reproducibly derived 32-code EOTF, native-primary matrix, and black/white
  anchors from the pinned HCS AGS-101 measurement record;
- continuous per-subpixel TFT gray-to-gray state, with a deterministic table
  path ready for measured transition data;
- alternating drive polarity and slow residual-DC image retention using
  published adsorption/desorption kinetics;
- exact GBA row timing split into row start, electrical latch, and optical
  onset, including causal events that cross a frame boundary;
- analytic BGR aperture followed by the measured native-to-host color stage.

No complete gray-to-gray matrix or motherboard timing trace has been recovered
for the referenced AGS-101. The default therefore uses the documented analytic
and period-literature candidates, while the measured-table and diagnostic paths
remain available for better evidence. A neutral sRGB adapter is kept as a
regression baseline. The exact classifications and limits are in the
[AGS-101 evidence map](models/nintendo-ags-101/REFERENCES.md).

Game imagery here exists only to show what the shaders do. Tetris, Mario,
Nintendo trademarks, and game content belong to their respective owners.

## Download

- Stable v0.5.0: [fixed tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.5.0.zip)
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

The DMG profile puts a 640×576 viewport on the panel at exactly 4×; the AGS-101
profile fills the same 960×640 panel at exactly 4× from its 240×160 source. The
target display state is **sRGB-neutral and unmeasured** — which is not the same
thing as instrument-calibrated sRGB. On any other display, start from the model
preset and build your own target profile. The
[installation guide](docs/installation.md) has the long version.

## Reproducibility and validation

```sh
npm test
```

The checks cover shader and preset structure, deterministic generated assets,
reference IDs, palette ordering, the STN surrogate and crosstalk gates, TFT
gray-to-gray lookup and fallback, residual-DC integration, scan-event causality,
target scale, HCS color vectors, and whether unmeasured target state is actually
disclosed as such.
Contributions need to follow the [evidence policy](docs/reference-policy.md) and
the [contribution guide](CONTRIBUTING.md). For academic or technical use, cite
[`CITATION.cff`](CITATION.cff) along with the model-local sources behind the
mechanisms you relied on.

## License

The original code and documentation are Apache-2.0. Third-party references stay
under their own terms: no BGB photographs, commercial ROMs, or unlicensed HCS
shader and data files are redistributed here.
