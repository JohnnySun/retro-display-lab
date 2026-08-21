# KPA reference-unit RetroArch-local host correction

This directory contains the measured host-display correction for reference unit
`BW0306N250002377`, firmware `BW03_20260730`, Android brightness `57`, Gamma
`7`, neutral PQ `4/4/4/2`, and an identity SurfaceFlinger matrix.

The final shader pass maps encoded sRGB to encoded KPA device RGB through a
manually trilinear-sampled `65^3` RGB8 LUT. The LUT is generated from the raw
180-patch SpyderX baseline with ArgyllCMS `colprof` and `collink`; the manifest
records source hashes, model-fit results, a 96-color model projection, and all
limitations. The display ICC is an audit artifact and is not loaded at runtime.

This is a reference-unit model default, not proof that every GT78-VN panel is
identical. It cannot expand the physical gamut. The RetroArch/Vulkan framebuffer
implementation passed A/B validation against the CPU LUT reference, with mean
absolute channel error `0.1402`, maximum `3`, and P95 pixel maximum `1`; see
[`../../validation/kpa-host-correction-framebuffer-20260822.json`](../../validation/kpa-host-correction-framebuffer-20260822.json).
Centered emitted-light validation is still required before removing
`optical-validation-pending` from the manifest.

Use only a preset whose name contains `kpa-color-corrected`, after Display Switcher has
entered `retroarch-local` mode. Never enable this LUT while the Android-system
KPA matrix is active.
