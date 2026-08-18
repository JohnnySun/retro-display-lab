# AGS-101 diagnostics and frontend validation contract

Status: WS5 complete, including the KONKR device run recorded under
`TARGET-KPA-VALIDATION-01`.

## One diagnostic interface

The runtime remains two shaders. `DebugView` exists only in the final display
pass, so a diagnostic can read the optical RGB/residual-DC state, original
source, timing parameters, and GtG texture without changing the RGBA32F
feedback written by the response pass.

| DebugView | Display | Encoding |
| --- | --- | --- |
| 0 | Normal output | Selected aperture and HCS/neutral host conversion |
| 1 | Native optical state | RGB is the pre-aperture, pre-host-conversion native-primary state, sRGB-encoded only for visibility |
| 2 | Electrical state | Left-to-right quarters are frame polarity, external DC mismatch, retained DC, and their net mismatch; cyan is negative and orange is positive |
| 3 | Three-event scan timing | Row start is red, latch is green, optical onset is blue, and a wrapped optical onset is magenta |
| 4 | GtG lookup identity | Each horizontal third selects R/G/B; output R is continuous from-code, G is target code, and B is 0.25 analytic, 1 table, or 0 fallback |
| 5 | Aperture comparison | Left is aperture off, right is aperture on, with one white divider pixel |

`diagnostics-v1.slangp` enters mode 1 and exposes the remaining modes through
the same integer parameter. The normal preset always sets mode 0. The existing
normal and `neutral-baseline-v1` presets provide the measured/neutral static
color comparison without duplicating shader source.

## Mechanism isolation

Three explicit switches keep the layers independent:

- `TemporalResponse=0` makes the optical state follow the effective target
  without GtG lag;
- `DriveRetention=0` clears residual DC and removes external/internal DC from
  effective drive code;
- `BakedScanout=0` performs one full-frame temporal update without a row event;
- `ApertureEnabled=0` bypasses aperture integration in the display pass.

`isolation-static-color-v1`, `isolation-gtg-v1`, and
`isolation-scan-v1` select cumulative layers. These are thin parameter presets,
not alternate shaders. `drive-retention-debug-v2` runs the real literature
clock. `retention-stress-60x-v1` is named and labelled as a laboratory-only
60× clock; stress uses the inherited nonzero mismatch and recovery begins by
setting `DriveDcOffset=0`. Its accelerated rates cannot be copied into the
normal preset.

## Numerical acceptance

The independent CPU implementation is split into small modules:

- `reference/color-pipeline.mjs` implements source EOTF, matrix color, and host
  encoding;
- `reference/drive-retention.mjs` implements polarity, exact residual-DC
  kinetics, and effective drive code;
- `reference/scan-timing.mjs` implements row/latch/optical event selection;
- `reference/gtg-response.mjs` implements the analytic/table response field;
- `reference/temporal-pipeline.mjs` composes the electrical, GtG, and scan
  updates without copying those equations into the validator.

Acceptance is numerical. It covers all HCS golden vectors, sRGB and neutral
round trips, boundedness, sign reversal, equilibrium, exact time partition,
first/last rows, cross-frame causality, partial-channel changes, GtG fitting,
fallback, and packed-texture error. Screenshots are kept only to communicate
what a mode looks like; they do not establish equation correctness.

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
they must remain disabled for the physical preset. Fast-forward is unsupported
unless every emulated frame is presented with its real elapsed time. Ordinary
same-content frames are valid physical dwell time, but frontend-generated
duplicates with unknown elapsed time are not. Variable refresh is unsupported
by the current fixed GBA-period integrator.

When those conditions cannot be guaranteed, the safe static bypass is:

```text
TemporalResponse = 0
DriveRetention = 0
BakedScanout = 0
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

## KONKR WS5 result

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
