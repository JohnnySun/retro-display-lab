# RetroArch installation

1. Download the [stable v0.3.0 tag](https://github.com/JohnnySun/retro-display-lab/archive/refs/tags/v0.3.0.zip),
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

The public AGS-101 preset is a literature-constrained physics seed with a
neutral color adapter. Disable core color correction and frame mixing. It does
not include the separately researched HCS-derived measured-color stage.

To create a core override, copy
`integrations/retroarch/overrides/gambatte-gb.slangp` into the appropriate
RetroArch core configuration directory. Its relative reference assumes this
repository is installed at `RetroArch/shaders/retro-display-lab`.
