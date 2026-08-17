# Methodology

## Model the display, not a screenshot

An original handheld panel is treated as a causal optical system. Color,
temporal response, spatial structure, electrical crosstalk, and long-exposure
retention are separate mechanisms. A static tint or fixed blend of a few old
frames may be a useful approximation, but it must not be presented as a panel
reconstruction.

## Separate source and target

The source model describes the emulated display: DMG-01 STN, AGS-101 TFT, and
future panels. A target profile describes the modern screen used to show it:
resolution, integer scale, color mode, brightness/chroma compensation, frontend,
and tested driver. This prevents one device's compensation from becoming a
false property of the original screen.

## Temporal state

Short gray-to-gray response and long image sticking use independent state and
time constants. Both are causal and per pixel. The model does not draw a blur
in front of a moving object and does not erase the entire past at an arbitrary
fixed frame count.

## Evidence levels

- **Measured**: instrument data from an identified panel and protocol.
- **Literature-constrained**: equations or ranges from relevant technical work.
- **Reference-image matched**: sampled from a documented, color-managed image.
- **Device-tuned**: compensation for a named modern target display.
- **Experimental**: a bounded candidate awaiting stronger evidence.

Claims inherit the weakest evidence required by the result. Device settings
alone never establish calibrated sRGB; white point, transfer function, gamut,
and error require measurement.

## Validation

Validation should check model invariants and published anchors, not only shader
syntax. Examples include 10–90% transition time, long-tail decay, regression
coefficients, palette ordering, reference integrity, and target scale.

