# AGS-101 diagnostics and frontend validation contract

Status: the 2026-08-20 WS8 KONKR record covers the current three-pass WS7
pipeline, GPU exposure/retention numeric readback, exact/fractional aperture
energy, cold compile, restoration, and explicit frontend safety boundaries.

## One diagnostic interface

The runtime has three shaders. Pass 0 writes persistent RGBA32F endpoint RGB and
residual-DC state. Pass 1 computes the native-frame emitted-light average without
feedback and forwards endpoint alpha. `DebugView` exists only in final pass 2,
so a diagnostic never changes persistent response state. `ExposureMode=0`
selects the named frame-boundary endpoint presentation when endpoint RGB rather
than the normal exposure average is required.

| DebugView | Display | Encoding |
| --- | --- | --- |
| 0 | Normal output | Selected aperture and HCS/neutral host conversion |
| 1 | Native optical presentation state | RGB is the exposure average normally, or the frame-boundary endpoint when `ExposureMode=0`; it is sRGB-encoded only for visibility |
| 2 | Electrical state | Left-to-right quarters are selected parity/inversion polarity, external DC mismatch, retained DC, and their net mismatch; cyan is negative and orange is positive |
| 3 | Three-event scan timing | Row start is red, latch is green, optical onset is blue, and a wrapped optical onset is magenta |
| 4 | GtG lookup identity | Each horizontal third selects R/G/B; output R is continuous from-code, G is target code, and B is 0.25 analytic, 1 table, or 0 fallback |
| 5 | Aperture comparison | Left is aperture off, right is aperture on, with one white divider pixel |
| 6 | Row-start event | Red marker only |
| 7 | Latch event | Green marker only |
| 8 | Optical-onset event | Blue marker, or magenta when causally wrapped |
| 9 | Parity phase | White is positive and black is negative; spatial inversion is ignored |
| 10 | Inversion topology | White/black spatial phase pattern; frame parity is ignored |
| 11 | WS5 spatial terms | Quarters show raw RGB555 command proxy, local excitation, retained state, and excitation-minus-state |
| 12 | WS5 numeric readback | Four binary uint32 bands encode outside/inside retained floats, FrameCount, and outside excitation |
| 13 | WS8 exposure numeric readback | Five binary uint32 bands encode center-pixel exposure R/G/B floats, FrameCount, and current packed RGB555 |
| 14 | WS8 aperture energy | Quarter-scale linear RGB aperture energy, sRGB-encoded only for loss-bounded screenshot averaging at exact and fractional scale |

`diagnostics-v1.slangp` enters mode 1 and exposes the remaining modes through
the same integer parameter. The normal preset always sets mode 0.
`neutral-baseline-v1` is the frozen neutral/static regression route: HCS
color, GtG, retention, scan splitting, and aperture are all disabled.
`isolation-static-color-v1` provides the measured HCS static-color counterpart
without duplicating shader source.
WS3 additionally generates self-contained timing, parity, inversion, and
read-only diagnostic presets under `generated/ws3-presets-v1`; every one is
classified as a sensitivity hypothesis rather than an AGS-101 profile.

## Mechanism isolation

Explicit switches keep the layers independent:

- `TemporalResponse=0` makes the optical state follow the effective target
  without GtG lag;
- `DriveRetention=0` clears residual DC and removes external/internal DC from
  effective drive code;
- `BakedScanout=0` performs one full-frame temporal update without a row event;
- `ApertureEnabled=0` bypasses aperture integration in the display pass.
- `BacklightScaleEnabled=0` bypasses the WS6 relative-gain sensitivity control
  independently of HCS measured color. Temporal backlight modulation is not
  selected or implemented because no transferable PWM/DC evidence was found.
- `ExposureMode=0` bypasses WS7 exposure averaging for endpoint diagnostics;
  it does not alter pass 0 feedback.

`isolation-static-color-v1`, `isolation-gtg-v1`, and
`isolation-scan-v1` select cumulative layers. They are self-contained full
presets generated from the normal preset by `tools/build-ags101-ws1.mjs`, not
alternate shaders. Full packaging is required because the tested Android
automatic-preset route did not reliably apply parameter assignments following
`#reference`. `drive-retention-debug-v2` runs the real literature clock.
`retention-stress-60x-v1` is labelled as a laboratory-only 60× uniform
imbalance clock. Its accelerated rates cannot be copied into the normal preset.

The persistent electrical scalar is stored per pixel. WS5 excitation uses the
raw RGB555 command plus selected parity/inversion candidate, with separately
exposed code and polarity sensitivity weights. DebugView 11 visualizes the
four electrical terms; DebugView 12 encodes outside/inside state, `FrameCount`,
and excitation into lossless black/white bit bands for target readback. These
diagnostics validate the implementation and candidate sensitivity, not an
original AGS-101 image-sticking magnitude.

## Numerical acceptance

The independent CPU implementation is split into small modules:

- `reference/color-pipeline.mjs` implements source EOTF, matrix color, and host
  encoding;
- `reference/drive-retention.mjs` implements polarity, exact residual-DC
  kinetics, and effective drive code;
- `reference/scan-timing.mjs` implements row/latch/optical event selection;
- `reference/gtg-response.mjs` implements the analytic/table response field;
- `reference/temporal-pipeline.mjs` composes the electrical, GtG, and scan
  updates without copying those equations into the validator;
- `reference/exposure-integration.mjs` implements exact first-order segment
  state/integral equations, scan-split exposure, Simpson references, and static
  relative-backlight sensitivity.

Acceptance is numerical. It covers all HCS golden vectors, sRGB and neutral
round trips, boundedness, sign reversal, equilibrium, exact time partition,
first/last rows, cross-frame causality, partial-channel changes, GtG fitting,
fallback, and packed-texture error. Screenshots are kept only to communicate
what a mode looks like; they do not establish equation correctness.

WS3 also generates the timing/polarity Shader include from the normalized
constraint record. The compile receipt covers response/exposure/display vertex and
fragment stages with glslang and `spirv-val`; the sensitivity receipt contains
80 polarity vectors and nine timing profiles. This proves source-equation and
SPIR-V validity, not a GPU numeric readback.

WS6 adds `reference/panel-optics.mjs` and
`generated/ws6-validation-v1.json`. The receipt verifies separately named HCS
black policies, an exact backlight-uncertainty bypass, generic-aperture
per-channel energy normalization at integer and fractional scales, RGB/BGR
order reversal, phase, and color neutrality. It is a CPU-equation/repository
receipt. The WS8 KONKR record now adds exact-4x and centered-3.5x GPU energy
averages against the same CPU equation.

WS7 adds `data/ws7-exposure-integration-v1.json`, the three-pass state and
frontend-interval contract, and `generated/ws7-exposure-validation-v1.json`.
For each constant-target segment the Shader and CPU reference use
`q*dt + (x0-q)*(1-exp(-k*dt))/k`; a 4096-subinterval Simpson reference checks
the closed form, and a float32 equation emulator bounds implementation error.
Fixtures cover static equilibrium, row 0/80/159 rise/fall/partial-channel
transitions, 12-frame alternation, all fast/nominal/slow members, and static
0.5/0.75/1 backlight bounds. The receipt is repository CPU/Shader-equation
evidence, not actual GPU readback; WS8 owns that final comparison.

Every evidence token used by a `.slang`, `.inc`, or `.slangp` file must exist
in both `REFERENCES.md` and `model.json`. This prevents a locally meaningful
comment from becoming an untracked claim.

## Frontend contract and safe bypass

The physical temporal model is accepted only for normal-forward execution with
one shader subframe, causal `OriginalHistory1/2`, persistent PassFeedback0, and
an RGBA32F response framebuffer. A validation run records the frontend version,
driver, history meaning, feedback format, scale, source/target refresh, rewind,
run-ahead, fast-forward, duplication, and variable-refresh state using
`data/frontend-validation.schema.json`.

Reset, content reload, save-state load, and pause/resume are tested as lifecycle
events. Rewind and run-ahead cannot be inferred reliably inside a Slang shader;
they must remain disabled for the physical preset. Fast-forward remains
equation-supported only when every emulated frame executes the Shader exactly
once; the native panel clock is never rescaled to host wall time. Ordinary
same-content frames are valid physical dwell time, but skipped emulated frames
and frontend-generated duplicates with unknown elapsed time are not. Variable
host refresh is equation-supported only with one Shader execution per emulated
frame; unknown duplication/drop history is unsupported.

When those conditions cannot be guaranteed, the safe static bypass is:

```text
TemporalResponse = 0
DriveRetention = 0
BakedScanout = 0
ExposureMode = 0
```

This retains the selected HCS color and aperture model but does not pretend
that invalid frontend history is physical elapsed-time evidence. A
`TotalSubFrames != 1` runtime is detected automatically and takes the same
stateless response-pass initialization path.

The reusable record is `data/frontend-validation-template.json`. Captures are
explicitly marked `presentationOnly`; artifact hashes, logs, state probes, and
causal invariants determine pass/fail. Each completed record is anchored to a
40-character `repositoryCommit`: its hashes describe the bytes deployed for
that historical run, while the current generators independently validate the
current checkout. Later asset regeneration must not rewrite old device evidence.

## KONKR target results

The current record is
`targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws8-target-20260820.json`.
On the current three-pass Vulkan route, exposure RGB matched the packed-rate CPU
cycle within `3.3381e-8`, retention recurrence matched bit-for-bit, and aperture
energy differed from the CPU equation by at most `0.00133409` at exact 4x and
centered 3.5x. Cold startup compiled both RGBA32F passes and the RGBA8 display
pass with feedback only on pass 0. Background/resume retained the Android PID
but restarted Shader `FrameCount`; save-state history, accelerated history, and
unknown VRR therefore remain reset/stateless boundaries rather than continuity
claims. All four user shader/config overrides were restored to their original
SHA-256 values.

The last completed WS5 target record is
`targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws5-target-20260820.json`.
On Mali-G76/Vulkan it allocated true RGBA32F feedback and decoded unanimous
black/white bits for both spatial probes, `FrameCount`, and parity-dependent
excitation. Stress recurrence agreed with the CPU float32 path within
`2.3842e-6` against a `3e-6` asynchronous-capture tolerance; one stress
interval and the uniform-recovery interval matched bit-for-bit. This validates
the pinned WS5 implementation, not its unfitted AGS-101 proxy weights or the
subsequent WS6 display-Shader and WS7 exposure-pass changes.

The preceding WS4 target record is
`targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws4-target-20260820.json`.
It pins the present Shader, all three reconstructed GtG LUT/preset members, the
exact KONKR target preset, WS2 neutral-gate ROM, device/config state, logs,
captures, and SurfaceFlinger samples. All four preset routes compiled with
RGBA32F response feedback; the recorded output preserved fast < nominal < slow
response ordering in both directions at approximately 60 fps. The capture is
explicitly post-display presentation evidence, not float-state readback or an
AGS-101 panel measurement.

The completed device record is
`targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws5-20260818.json`.
RetroArch 1.22.2 on Vulkan/Mali-G76 MC4 compiled all five unified diagnostic
views and every isolation path. Reset, content reload, save-state load, and
menu pause/resume preserved the pipeline. A 4× fast-forward probe did not
present every emulated frame in physical time, so the final GBA-specific
configuration disables rewind and run-ahead and fixes fast-forward at 1×.

The verbose allocation trace also found a real integration regression: the
old preset-level `float_framebuffer0=true` silently forced pass 0 to RGBA16F
despite the shader's RGBA32F request. That override is removed. The repeated
probe reported `R32G32B32A32_SFLOAT` for the persistent response pass and
stable presentation at approximately 59–61 fps.
