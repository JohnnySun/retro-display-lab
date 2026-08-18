# RetroArch installation

1. Download the [stable v0.4.0 tag](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.4.0.zip),
   download the [current `main` ZIP](https://github.com/JohnnySun/retro-display-lab/archive/refs/heads/main.zip),
   or clone the repository into RetroArch's shader directory as
   `retro-display-lab`.
2. Use the Vulkan video driver and enable integer scaling where the target
   profile requires it.
3. Disable emulator-core frame mixing when the selected model already provides
   temporal response.
4. Load a `.slangp` from the relevant target profile.

For the tested KPA target, load:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-v1.slangp
```

For GBA content on the same 960×640 target, load:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-physics-seed-v1.slangp
```

The AGS-101 preset is a literature-constrained physics seed whose default
static-color path is derived from the pinned HCS AGS-101 measurement record.
Its main response shader also enables the period-theory row/latch/optical scan
model; no separate scanout shader or A/B preset is required.
Disable core color correction and frame mixing. Use
`models/nintendo-ags-101/presets/neutral-baseline-v1.slangp` only for the
pre-HCS neutral regression baseline. The temporal coefficients remain
a period-literature theoretical reconstruction; direct paper rates and project
normalization priors are distinguished in the AGS-101 evidence map.

For the physical temporal preset, also apply the GBA core/content settings in:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/retroarch/ags101-temporal.cfg
```

They require Vulkan, one shader subframe, integer scaling, normal-forward
execution, and 1× speed. Rewind and run-ahead are disabled because they cannot
preserve causal panel history. If those conditions cannot be guaranteed, use
the static safe bypass by setting `TemporalResponse=0`, `DriveRetention=0`, and
`BakedScanout=0`.

To create a core override, copy
`integrations/retroarch/overrides/gambatte-gb.slangp` into the appropriate
RetroArch core configuration directory. Its relative reference assumes this
repository is installed at `RetroArch/shaders/retro-display-lab`.
