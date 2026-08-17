# Reference index

Retro Display Lab treats provenance as part of the model. A URL by itself is
not sufficient: every consequential source must state what was used, how it
was transformed, what it does **not** prove, and whether source material may be
redistributed.

## Model evidence maps

- [Nintendo DMG-01](models/nintendo-dmg-01/REFERENCES.md)
- [Nintendo GBA SP AGS-101](models/nintendo-ags-101/REFERENCES.md)

## Target evidence maps

- [KONKR GT78-VN, 960×640, sRGB-neutral/unmeasured](targets/konkr-gt78-vn/960x640-srgb-neutral/REFERENCES.md)

## Project policy

See [Reference and evidence policy](docs/reference-policy.md). New display
models must add a model-local `REFERENCES.md` before they can be described as a
research model. Shader and preset files must point to the evidence IDs that
constrain them.

## Prior work and project contribution

Retro Display Lab builds on, and does not replace, several kinds of prior work:

- BGB documents color-managed DMG photographs, sampled optical states, and
  behavior-oriented frame-blending research.
- Libretro's slang-shaders project provides the shader preset/feedback
  infrastructure and mature handheld-display approximations.
- Handheld Color Space Project (HCS) publishes instrument-derived handheld
  color transforms and reports.
- Display-science papers explain physical mechanisms and measured ranges for
  STN and TFT LCD response, addressing, crosstalk, and image sticking.

Our contribution is an evidence-linked integration: source-panel physics,
modern target-display compensation, causal per-pixel temporal state, and
automated checks are kept separate and traceable. This is a
physics-informed, measurement-constrained reconstruction—not a claim that an
unmeasured surviving panel has been identified exactly.

Third-party sources remain under their own terms. Linking or citing a source
does not grant permission to redistribute its photographs, datasets, or code.
