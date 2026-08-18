# AGS-101 measurement-ready gray-to-gray model

Status: WS4 implementation accepted 2026-08-18, including KONKR Vulkan runtime
and 60 Hz performance validation of both the normal analytic path and the
opt-in synthetic-table path (`TARGET-KPA-GTG-01`).

## Decision

The runtime uses a continuous-time, first-order rate field for monotone
gray-to-gray transitions:

```text
dx/dt = k_c(u, v) * (target - x)
x(t + dt) = target + (x(t) - target) * exp(-k_c(u, v) * dt)
```

`x` is the current optical primary state, `u` is its continuous inverse-EOTF
code coordinate, `v` is the new RGB555 target code, and `c` is R, G, or B.
Each channel has an independent 32×32 grid. Four valid neighboring grid cells
are bilinearly interpolated. If any required cell is missing or rejected, that
channel uses the analytic prior and reports an explicit fallback status in the
runtime asset.

This is the state-space alternative allowed by the WS4 state inventory. It
does not retain a discrete transition identity or repeatedly quantize the
optical state to a nearest code. A target arriving mid-transition simply
changes `v`; the current optical state `x` remains continuous.

## Why the v1 model is first order

| Candidate | Strength | Required persistent state | WS4 v1 decision |
| --- | --- | --- | --- |
| First-order exponential | Causal, bounded, exact continuous-time partition, one optical state | Existing optical RGB | Selected for monotone cells that pass residual tests. |
| Bi-exponential | Can represent a slow tail | Two optical states or retained transition time/identity per channel | Preserved as a future fit candidate; not justified without AGS waveforms. |
| Second-order/underdamped | Can reproduce overshoot and ringing | Optical RGB plus velocity/second state per channel | Not silently reduced to one state; requires a future state-layout revision. |
| Raw waveform playback | Retains arbitrary measured shape | Transition identity, age, and interruption rules per channel | Canonical raw data are preserved, but direct playback is not the v1 runtime. |

Model complexity is selected from data. A cell is eligible for the v1 runtime
only when all repetitions are monotone and the first-order fit has normalized
`RMSE <= 0.02`, maximum absolute error `<= 0.05`, overshoot `<= 0.02`, and
undershoot `<= 0.02`. These are project acceptance thresholds, not values
claimed by the cited standards. A failing cell remains in the fit report and
its texture status is explicit fallback; its waveform is never discarded or
relabeled as first order.

## Canonical record and derived artifacts

The raw schema is
[`models/nintendo-ags-101/data/gtg-measurement.schema.json`](../../models/nintendo-ags-101/data/gtg-measurement.schema.json).
It requires:

- console, board, LCD label, brightness, warm-up, ambient/temperature, power,
  charger, history, overlay, geometry, detector, acquisition, stimulus, and
  repetition metadata;
- channel, from/to RGB555 code, repetition, event-time-zero, sample times,
  from/to plateau, raw/normalized optical samples, and units for every
  waveform; absolute units are normalized only in the derived fit stage;
- explicit missing cell IDs, source-file SHA-256 hashes, and a deterministic
  sample-payload hash.

Raw records contain no fitted fields. `tools/build-ags101-gtg.mjs` validates the
record, derives `t10`, `t50`, `t90`, 10–90%, 2% settling, overshoot,
undershoot, first-order rate, residual errors and rejection reasons, and writes
a separate fit report and runtime asset.

The checked-in `gtg-synthetic-v1` record covers all 3×32×32 cells and is
generated exactly from the analytic prior. It tests the complete pipeline but
is classified `synthetic`; it is not evidence about an AGS-101 panel and is
not enabled by the normal preset.

## Runtime packing

Three representations were evaluated. A 3,072-float constant array and
equivalent generated shader source would enlarge and recompile the response
shader for every specimen profile. A floating-point LUT texture preserves more
than the measured precision is likely to justify and depends on frontend image
format support. The selected normalized RGB8 texture is a standard custom
texture, keeps the shader/profile boundary stable, and has a measured packing
error below the declared fit tolerances by more than two orders of magnitude.
The Slang format specifies PNG lookup textures as plain RGBA8/RGBA8_UNORM, so
the two encoded rate bytes are not passed through an implicit sRGB transfer.

The generated texture is 32×96 RGB8:

```text
x = to code
y = from code + 32 * channel index   (R=0, G=1, B=2)
R,G = big-endian uint16 log-rate code
B = 255 fitted, 192 derived identity anchor, 0 explicit fallback
rate = 1 * 1024^(uint16 / 65535) per second
```

This one 2-D texture supports independent channel and specimen/brightness
profiles by changing the preset texture path, without editing shader source.
Identity-grid rates cannot be measured because no optical transition exists;
the generator derives and labels those interpolation anchors from adjacent
eligible transitions. An identity update itself remains exactly stationary.

The generated synthetic asset has maximum encode/decode relative rate error
below `5.3e-5`. The shader uses `texelFetch`; texture filtering and mipmaps are
disabled. The table backend is opt-in until a qualifying measured or accepted
period-literature table exists.

## Target runtime validation

The KONKR GT78-VN probe ran RetroArch 1.22.2 with the Vulkan driver,
`video_shader_subframes=1`, and the target's only 960×640 at 60 Hz display
mode. The normal analytic preset loaded the packed texture but selected the
analytic rate field. A temporary diagnostic override then selected the
synthetic table, forcing the custom-texture decode, channel lookup,
four-corner validity check, and bilinear interpolation path to execute. Both
paths compiled, rendered without corruption, and presented at approximately
59–61 fps; the current RetroArch process reported no shader, Slang, texture,
compile, fatal, or crash error.

The response shader, physics preset, and 2,224-byte PNG read back from the
device with SHA-256 values identical to the repository. After the diagnostic
run, both mGBA/GBA content overrides were restored to the target
`ags101-physics-seed-v1` preset and RetroArch was restarted successfully. This
probe validates frontend compatibility and runtime cost only. Because the
table is synthetic, it does not convert its rates into AGS-101 measurements.

## Measurement protocol

VESA's public Adaptive-Sync CTS uses a 9×9 G2G matrix, 10–90% transition time,
explicit overshoot/undershoot tests, at least 250 ms between transitions, and
at least 20 executions of each transition. Becker additionally shows why LCD
transition extraction must account for backlight and frame modulation and why
overshoot can make a short 10–90% number conceal multi-frame settling. This
project adopts those structural requirements and extends the address space to
the GBA's full 5-bit channels.

For an AGS-101 specimen:

1. Record every schema field before acquisition. An aged unit is classified
   `measured-aged-specimen`, not as original-production ground truth.
2. Stabilize the console, backlight mode, power state, detector geometry and
   panel temperature. Record temperature continuously or before and after the
   run; keep it within ±1 °C during a profile.
3. Use a centered patch at least 128×96 source pixels. Exercise one primary at
   a time while holding the other two at code 0. Record stable from/to plateaus
   as well as the transition.
4. Synchronize the optical recorder to the test-pattern event and, where
   available, record the WS3 LP/DCK/row reference on another channel. State
   precisely whether time zero is source-frame, row-start, latch, or detected
   optical onset.
5. Project minima are a detector bandwidth of 500 Hz and acquisition at
   2 ksample/s or faster, with unclipped pre-trigger data. These minima are
   protocol choices, not facts from the cited sources.
6. Precondition each starting code for at least 120 frames, hold each side for
   at least 0.5 s, and record at least 20 repetitions for a release-quality
   profile. Preserve every repetition rather than averaging raw traces first.
7. Measure the full 3×32×32 table when practical. The mandatory staged subset
   for every channel is: `0<->31`; `0<->1,8,16,24,30`; near steps
   `7<->8`, `15<->16`, `23<->24`, `30<->31`; and mid-range
   `8<->16`, `16<->24`. Every unmeasured cell must appear in `missingCells`.
8. Preserve detector voltage/luminance and source files unchanged. Normalize a
   separate working record with the measured from/to plateaus. If backlight or
   frame modulation is removed, retain both the raw trace and the exact
   filtering/deconvolution derivation.

No aged-specimen table becomes the project default automatically. It can
corroborate or bound the period-theory reconstruction under the project's
irreplaceable-display policy.

## Verification contract

- Identity transitions are stationary.
- For fixed `k` and target, any time partition composes exactly.
- The synthetic raw record fits back to its known analytic rates.
- PNG encode/decode error is reported and bounded.
- Ineligible or missing table corners invoke channel-local analytic fallback.
- A record cannot be labelled measured if specimen/protocol identity is a
  synthetic or unknown placeholder.
