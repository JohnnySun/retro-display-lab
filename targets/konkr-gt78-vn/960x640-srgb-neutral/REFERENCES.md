# KONKR GT78-VN 960×640 sRGB-neutral target evidence

Accessed/tested 2026-08-18. This file documents modern-target compensation;
original DMG behavior belongs to the
[DMG-01 evidence map](../../../models/nintendo-dmg-01/REFERENCES.md).

## TARGET-KPA-HW-01 — Device and framebuffer geometry

- Source: system-reported KONKR GT78-VN framebuffer and first-party direct
  captures from the test device.
- Repository evidence: [shader-off capture](../../../docs/images/comparisons/dmg01-tetris-shader-off.png)
  and [shader-on capture](../../../docs/images/comparisons/dmg01-tetris-shader-on.png).
- Used for: `panelResolution=[960,640]` and the tested target identity.
- Limits: a framebuffer capture records rendered pixels, not emitted spectral
  power, panel EOTF, viewing angle, ambient light, or perceived luminance.

## TARGET-KPA-SCALE-01 — Exact DMG integer viewport

- Source: source geometry `160×144` and target viewport configuration.
- Transformation: `160×4=640`, `144×4=576`; validation checks the 640×576
  viewport and integer scale 4 inside the 960×640 framebuffer.
- Limits: geometric configuration only; it does not validate optics or color.

## TARGET-KPA-COLOR-01 — Neutral but unmeasured display state

- Source: device configuration and framebuffer A/B captures made in the named
  neutral vendor/SurfaceFlinger state.
- Used for: target label `sRGB-neutral, unmeasured`.
- Limits: no spectrophotometer/colorimeter readings are available for white
  point, EOTF, gamut, luminance, black level, or Delta E. The label must never
  be shortened to “calibrated sRGB.”

## TARGET-KPA-TUNE-01 — Brightness and chroma compensation

- Source: same-device A/B captures compared with BGB's documented,
  color-managed DMG reference images [DMG-COLOR-01].
- Transformation: `ScreenBrightness=0.68` reduces linear-light output for the
  emissive modern LCD; `ScreenChroma=0.90` reduces the observed excess yellow-
  green chroma. These overrides leave the model-level five-state palette intact.
- Limits: device-tuned visual/reference-image match, not instrument calibration.
  Values may change after future target-panel measurement and should not be
  copied to unrelated displays.

## Target claim

This profile means “tested geometry and visually tuned compensation on the
named unit in a neutral display state.” It does not mean “the KONKR panel is
measured sRGB” or “the compensation is a property of the original DMG LCD.”
