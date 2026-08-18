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

## Irreplaceable discontinued displays

For a display technology whose production ended long ago and for which no
unused reference specimen can reasonably be obtained, a surviving aged panel
is not automatically the ground truth for its original behavior. Aging,
unknown operating hours, storage history, temperature exposure, polarizer and
backlight drift, and prior electrical adjustment can all dominate a new
measurement.

In that case the project default is a **period-literature theoretical
reconstruction**: the best traceable equations and measured parameter ranges
from contemporary work at the same technology level and in the same display
family. A modern measurement of an aged specimen may corroborate or bound that
model, but it represents that aged specimen and does not displace the period
reconstruction by default. Direct literature measurements, normalized
transformations, and project bridge assumptions must still be labelled
separately so that the reconstruction remains auditable.

Every model must implement these labels as stable IDs in a model-local
`REFERENCES.md`, including exact versions/DOIs, the transformation into code,
limitations, and redistribution status. Shader and preset comments point back
to those IDs. See the [reference policy](reference-policy.md).

## Validation

Validation should check model invariants and published anchors, not only shader
syntax. Examples include 10–90% transition time, long-tail decay, regression
coefficients, palette ordering, reference integrity, and target scale.
