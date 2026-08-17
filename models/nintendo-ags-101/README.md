# Nintendo GBA SP AGS-101 physics seed

This downloadable model separates four mechanisms:

- a standard RGB555-to-linear source adapter;
- transition-dependent per-subpixel gray-to-gray response;
- a slow, signed residual-DC/image-sticking state;
- an analytic BGR aperture rendered at the target viewport.

Load [`presets/physics-seed-v1.slangp`](presets/physics-seed-v1.slangp) in
RetroArch. `ion-debug-v1` visualizes the persistent state, while
`ion-lab-60x-v1` accelerates the integrator for laboratory checks.

The temporal topology is constrained by TFT-LCD literature, but its numerical
constants are not measurements of an identified AGS-101 panel. For that reason
this is a **physics seed**, not a measured reference preset.

The private KPA research integration also uses EOTF/color information derived
from the Handheld Color Space Project snapshot at commit
`e688fc51141c0974728aa1bdcb89b94d74123f6b`. No explicit redistribution license
was found in that snapshot, so the public model contains none of its per-code
EOTF, color matrices, or measured black/white constants. It uses a neutral sRGB
adapter that can later be replaced by independently measured AGS-101 data.

See [`REFERENCES.md`](REFERENCES.md) for the source-to-code evidence map and
limits.
