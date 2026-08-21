# Retro Display Lab

**English** | [繁體中文](README.zh-tw.md) | [简体中文](README.zh-cn.md)

I built two handheld LCD shaders for RetroArch: one for the original Game Boy
and one for the backlit GBA SP AGS-101.

The goal is not to add another filter that merely feels retro. It is to rebuild
how those two displays produced an image, starting from real measurements,
period research, and the way each panel was driven.

The short version is: **measure first, then calculate.**

## Why color grading and frame blending are not enough

Many handheld shaders begin with an imagined “old LCD” color and blend a few
previous frames to create ghosting.

That can create a nostalgic mood, but it can also go in very different
directions. Some original Game Boy shaders become extremely bright green.
Others look more like a generic calculator LCD than the display in an actual
Game Boy.

Both may look old, but neither is necessarily faithful to a particular panel.
They often reproduce what someone remembers an old screen looking like, not how
that screen actually behaved.

## First, look at the original Game Boy result

Both images below were captured with the current Game Boy shader enabled. This
is not an on/off comparison. Before getting into the model, take a look at the
color, texture, crosstalk, and motion trail and decide whether they resemble the
original Game Boy you remember. The sections below explain why those details
were not tuned from memory.

<table>
  <tr>
    <th>Title screen — crosstalk</th>
    <th>Falling piece — ghosting</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/dmg01-tetris-crosstalk.png" alt="Tetris title screen on a KONKR Pocket Advance showing original Game Boy row and column crosstalk"></td>
    <td><img src="docs/images/comparisons/dmg01-tetris-ghosting.png" alt="Tetris gameplay on a KONKR Pocket Advance showing original Game Boy ghosting"></td>
  </tr>
</table>

The broad, high-contrast title graphics expose interaction between rows and
columns. The falling piece in the second image leaves a vertical trail that
makes the LCD response visible. Neither effect is blur painted over the final
image; both come from display state that continues to evolve over time.

## Step one: measure the color

If the goal is to reproduce a particular screen, the first step is not opening
a color picker. It is finding out what the screen actually displayed.

Retro Display Lab uses real measurements and color-managed references to
reconstruct panel color, gray levels, and black/white anchors, then maps the
result correctly to standard sRGB. The original Game Boy is not simply “four
greens”: its four game-controlled shades sit alongside a separate optical
background for the undriven LCD. The AGS-101 likewise has its own black level,
gray relationship, and native color behavior; lowering saturation is not a
substitute for measuring them.

Here, “color calibrated” means that the shader output is mapped to sRGB from
measurement data. On a properly calibrated viewing display, the result can
approach the original-panel color reconstructed by the model. A shader cannot
automatically correct a modern display that is itself badly miscalibrated.

## Step two: calculate how the display responds

A real LCD does not produce ghosting by blending several complete frames.
Think of each liquid-crystal pixel as a tiny window blind: after its electrical
signal changes, it needs time to move, and a light-to-dark transition does not
necessarily follow the same path as a dark-to-light transition.

The game’s color codes are therefore converted into simulated panel drive. An
**algorithm built from physical models** then calculates how every virtual
liquid-crystal pixel changes. Each pixel retains its previous state; the next
state depends on drive, material behavior, scan position, and display history.

This is not a physical reconstruction of a panel. It is an algorithm that makes
the panel’s physical principles run in real time on a GPU. Ghosting, crosstalk,
and image retention are outputs of that model rather than effects pasted on at
the end.

## Original Game Boy: reflective passive-matrix LCD

[`models/nintendo-dmg-01`](models/nintendo-dmg-01) reconstructs the original
Game Boy’s reflective passive-matrix STN LCD:

- four game-controlled shades plus a distinct undriven optical background;
- exact Game Boy scan timing, effective electrical drive, STN response, and
  reflected optical output;
- row/column electrode loading and local crosstalk instead of generic spatial
  blur;
- asymmetric gray transitions and slow, per-pixel ionic image retention;
- rectangular pixel apertures, undriven gaps, and reflector shadow;
- reference, heavy-ghosting, aged-unit, and accelerated-experiment presets.

The [DMG-01 evidence map](models/nintendo-dmg-01/REFERENCES.md) records how each
source enters the code and separates direct data from literature-constrained
reconstruction. Machine-readable decisions and implementation history live in
[`reconstruction-v1.json`](models/nintendo-dmg-01/data/reconstruction-v1.json)
and the [implementation to-do](models/nintendo-dmg-01/IMPLEMENTATION-TODO.md).

## GBA SP AGS-101: a completely different model

The later GBA SP AGS-101 uses a backlit TFT LCD, not the same display technology
as the original Game Boy. It responds faster, but different color and brightness
transitions still take different paths. Scan timing, drive state, and the BGR
subpixel arrangement also affect the final image.

I therefore did not reuse the Game Boy ghosting effect. The AGS-101 has its own
color, electrical, temporal-response, and pixel-structure model.

<table>
  <tr>
    <th>Shader off — raw emulator output</th>
    <th>Shader on — AGS-101 model</th>
  </tr>
  <tr>
    <td><img src="docs/images/comparisons/ags101-mario-shader-off.png" alt="GBA Mario gameplay with the AGS-101 shader disabled"></td>
    <td><img src="docs/images/comparisons/ags101-mario-shader-on.png" alt="GBA Mario gameplay with the AGS-101 model enabled"></td>
  </tr>
</table>

The difference is not just saturation or brightness. The model combines a
measured 32-code color response and black/white anchors, continuous per-subpixel
TFT gray-to-gray state, alternating drive and slow residual-DC retention, GBA
scan/latch/optical-onset timing, exact native-frame emitted-light integration,
and the final BGR pixel aperture. The exposure average is a separate
presentation pass, so it never replaces the physical endpoint used as the next
frame's feedback state.

The AGS-101 retention state is per pixel. WS5 now drives it from raw RGB555
command history and explicit frame/row/column/dot polarity candidates, so
different spatial histories can produce different slow states. Its code and
polarity weights remain unfitted sensitivity priors—not measured AGS-101 image
sticking—and balanced drive still produces exactly zero excitation.

No complete gray-to-gray matrix or motherboard timing trace has yet been
recovered for the referenced AGS-101. The default therefore uses documented
analytic models and candidates constrained by period literature. A deterministic
measured-table path remains ready for better transition data. See the
[AGS-101 evidence map](models/nintendo-ags-101/REFERENCES.md) for the exact
classifications and limits.

## Where the model data comes from

The project uses the available panel measurements, color-managed original-display
references, drive information, and timing evidence for the Game Boy and AGS-101,
together with research on comparable panels and liquid-crystal materials from
the same era.

When complete original data is unavailable, period-appropriate literature is
used to bound a reasonable range. Candidate values and uncertainty are
published instead of presenting a derived number as a direct panel measurement.

The most accurate description is a **physical-model-based reconstruction
constrained by measurement and literature**. The full rules are in the
[methodology](docs/methodology.md), [reference policy](docs/reference-policy.md),
and [reference index](REFERENCES.md).

## Where the screenshots were rendered

Every image in this README was rendered in RetroArch on a
**KONKR Pocket Advance (GT78-VN)** and captured directly from its
**960×640 framebuffer**:

- GBA content maps 240×160 to 960×640 at an exact 4× scale;
- Game Boy content maps 160×144 to a 640×576 viewport at an exact 4× scale,
  with a bezel around it.

These are direct captures of the handheld GPU output, not photographs of the
physical panel. The named KONKR reference unit now has a SpyderX-measured host
profile. It is still a one-unit model default, not a claim that every GT78-VN
panel has identical emitted color.

Game imagery is used only to demonstrate shader behavior. Tetris, Mario,
Nintendo trademarks, and game content belong to their respective owners.

## Download

- Stable v0.6.0: [fixed tag ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.6.0.zip)
- Release notes: [GitHub Releases](https://github.com/JohnnySun/retro-display-lab/releases)
- Latest development snapshot: [`main` as ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip)
- Git: `git clone https://github.com/JohnnySun/retro-display-lab.git`

## Install in RetroArch

1. Extract or clone the project into `RetroArch/shaders/retro-display-lab`.
2. Switch to the Vulkan video driver; enable integer scaling when the target
   profile requires it.
3. Disable the emulator core’s own frame mixing, or temporal response will be
   calculated twice.
4. Load the target profile `.slangp` that matches your device.

For the tested KONKR GT78-VN target, use:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

For GBA content on the same device, use:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-v1.slangp
```

Those presets assume the measured Android-system profile is active and do not
contain a second KPA correction. To use the measured RetroArch-local 65^3 LUT
instead, first switch Display Switcher to `retroarch-local` (Gamma 7, neutral
PQ, identity SurfaceFlinger), then load the corresponding preset whose name
ends in `kpa-local-v1.slangp`. Never combine both host-correction layers. The
local LUT has passed RetroArch/Vulkan framebuffer validation against the CPU
LUT reference and still awaits independent emitted-light validation; see the
[installation guide](docs/installation.md).

For another display, start from the model preset and build a separate target
profile. Do not treat KONKR-specific compensation as a property of the original
Game Boy or AGS-101 panel. See the [installation guide](docs/installation.md)
for the complete procedure.

## Reproduce, validate, and contribute

```sh
npm test
```

The test suite checks shader and preset structure, deterministic generated
assets, reference IDs, shade order, the STN surrogate, crosstalk, TFT
gray-to-gray behavior, residual DC, scan causality, target scale, HCS color
vectors, KPA host-LUT integrity and mutual exclusion, and honest labeling of
measurement and validation boundaries.

Before submitting a PR, read the [reference policy](docs/reference-policy.md)
and [contribution guide](CONTRIBUTING.md). For academic or technical use, cite
[`CITATION.cff`](CITATION.cff) and the model-local references behind the
mechanisms you used.

## License

Original code and documentation are Apache-2.0. Third-party sources keep their
own terms; this repository does not redistribute BGB images, commercial ROMs,
or unlicensed HCS shader/data files.
