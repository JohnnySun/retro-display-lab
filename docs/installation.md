# RetroArch installation

1. Download the [latest release](https://github.com/JohnnySun/retro-display-lab/releases/latest),
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

To create a core override, copy
`integrations/retroarch/overrides/gambatte-gb.slangp` into the appropriate
RetroArch core configuration directory. Its relative reference assumes this
repository is installed at `RetroArch/shaders/retro-display-lab`.
