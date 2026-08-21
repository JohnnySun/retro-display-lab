# RetroArch installation

1. Download the [stable v0.6.0 tag](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.6.0.zip),
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
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-v1.slangp
```

The two presets above are the `system-calibrated` route: Display Switcher must
keep the measured Android-system profile active, and no KPA LUT is appended.

For the mutually exclusive `retroarch-local` route, first use Display Switcher
to establish Android brightness 57, Gamma 7, neutral PQ, and an identity
SurfaceFlinger matrix. Then load one of:

```text
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-reference-kpa-local-v1.slangp
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/dmg01-one-year-used-kpa-local-v1.slangp
retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-kpa-local-v1.slangp
```

These presets append the measured reference-unit 65^3 KPA LUT as the final
pass after the source-panel model reaches encoded sRGB. They must never be used
while the Android-system KPA matrix is active. The artifact is a one-unit model
default and is currently labeled `framebuffer-validated-optical-validation-pending`.
Its final pass has matched the CPU LUT reference on the RetroArch/Vulkan
framebuffer, but it is not yet independent emitted-light validation.

The AGS-101 preset is an evidence-bounded period reconstruction whose default
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

To install the tested content-directory overrides, copy:

```text
integrations/retroarch/overrides/gambatte-gb.slangp
  -> RetroArch/config/Gambatte/gb.slangp
integrations/retroarch/overrides/mgba-gba.slangp
  -> RetroArch/config/mGBA/gba.slangp
```

For the local-LUT route, use the separately named
`gambatte-gb-kpa-local.slangp` and `mgba-gba-kpa-local.slangp` sources instead.
Do not deploy a local override unless the launcher or watcher switches Android
to `retroarch-local` before RetroArch starts.

On RetroArch 1.22 Android, the Config directory must resolve to
`RetroArch/config` (`rgui_config_directory` in the configuration file) for core
and content-directory automatic presets to load. A direct Activity launch that
leaves this at `default` can silently fall back to the stock shader.

Their relative references assume this repository is installed at
`RetroArch/shaders/retro-display-lab`. The Gambatte override selects the
one-year-used visual approximation used by the project screenshots; this is a
mild visual profile, not calibrated elapsed-time aging. The mGBA override
selects the AGS-101 period-reconstruction preset.

These filenames are content-directory overrides: `gb.slangp` applies only to
content loaded from a directory named `gb`, and `gba.slangp` only to a directory
named `gba`. They do not replace a core-wide preset. Content stored under `gbc`
or another directory therefore keeps its own shader configuration. Directory
names are case-sensitive on platforms that use a case-sensitive filesystem; if
the ROM directory is named `GBA`, use `GBA.slangp` instead.
