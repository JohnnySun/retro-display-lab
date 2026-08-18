# AGS-101 row, latch, and optical phase model

Status: WS3 implementation basis, accepted 2026-08-18.

## Decision

The scan model uses three distinct events:

```text
t_row_start = row * T_line
t_latch     = t_row_start + LatchOffsetLines * T_line
t_optical   = t_latch + OpticalDelaySeconds
```

`t_row_start` is timing-derived. `LatchOffsetLines` is a period-technology
theoretical convention until a motherboard trace exists. `OpticalDelaySeconds`
is a model term, not a measured pure delay; it defaults to zero because the
current GtG response begins causally at the electrical event and no independent
dead time is established.

## Source-to-event map

| Evidence | Established quantity | Runtime use | Limit |
| --- | --- | --- | --- |
| Nintendo, *Game Boy Advance Programming Manual*, AGB-06-0001-002-B13 (2005), LCD Table 5 | 240 visible pixels, 308 total dots, 160 visible rows, 228 total rows, 73.433 us line and 16.743 ms frame | Cross-check exact clock-derived timing | Rounded published times do not locate the AGS panel latch inside a line. |
| mGBA GBATEK, LCD dimensions and timing | 16,777,216 Hz master clock, 1,232 cycles/line, 228 lines/frame | `T_line=1232/16777216`; `T_frame=228*T_line` | GBA raster timing, not AGS-101 optical delay. |
| GBATEK GBA-only signal list and Gekkio AGS-CPU-11 schematic | DCK, LP, PS, SPL, CLS, SPS, MOD, REVC and COM exist at the LCD interface | Defines the optional motherboard capture set | Signal presence does not establish which edge the AGS-101 glass treats as its optical time zero. |
| Libretro Slang shader specification | `OriginalHistory1` is input N-1, `OriginalHistory2` is N-2, negative history is transparent black | Causal handling of optical events crossing into the next rendered frame | Frontend history follows rendered input frames and does not repair run-ahead/rewind. |

Exact runtime constants are:

```text
T_line  = 0.00007343292236328125 s
T_frame = 0.016742706298828125 s
fps     = 59.72750056960583 Hz
```

The source row coordinate is top-to-bottom and covers rows 0–159 without
stretching visible rows over VBlank.

## Event semantics

The electrical latch and optical target change are deliberately not aliases.
The retained WS2 residual-DC prior is constant during a frame, so its kinetic
input does not branch at `t_latch`. The latch remains an explicit event for a
future captured drive waveform. The piecewise GtG target changes only at
`t_optical`.

With the theoretical line-center convention and zero optical dead time:

```text
LatchOffsetLines   = 0.5
OpticalDelaySeconds = 0
```

This reproduces the former `(row+0.5)/228` event time while retaining the three
separate concepts. Line-start (`0.0`) and line-end (`1.0`) diagnostic presets
bound the unknown within-line latch convention.

## Cross-frame optical events

The implementation never clamps an event to the frame endpoint. For visible
rows and the supported delay range, `t_optical` can cross at most one boundary.

```text
if t_optical < T_frame:
    event time = t_optical
    transition = input[N-1] -> input[N]
else:
    event time = t_optical - T_frame
    transition = input[N-2] -> input[N-1]
```

The second branch intentionally ignores input N: its optical event belongs to
the next output frame. On frontend startup, unavailable negative history is
transparent black; the shader detects its alpha and holds N-1 rather than
inventing an N-2 target.

## Frontend contract

- Normal forward rendering with `TotalSubFrames=1` is supported.
- `BakedScanout=0` is exactly the non-scan temporal path.
- A duplicated rendered input is still a real frontend frame and advances the
  optical/electrical state once.
- Pause freezes input history, `FrameCount`, and feedback.
- Run-ahead and rewind do not reconstruct Shader feedback and are unsupported.
- Fast-forward is temporally valid only when every emulated frame is rendered.
- Variable refresh presentation does not change the emulated GBA event times;
  the model integrates the core's fixed content-frame period.

## Motherboard capture protocol

An optical panel is not required to establish digital latch and polarity phase.
If a suitable GBA/SP motherboard is ever available:

1. Record console model, board revision, serial/board markings, power source,
   battery/charger state, brightness mode, attached LCD state, temperature,
   and modification history.
2. Run a deterministic test ROM alternating full-screen RGB555 codes once per
   frame, with a one-row marker and an encoded frame parity bit. Preserve the
   ROM binary and SHA-256.
3. Probe DCK, LP, SPS, MOD and REVC with high-impedance digital probes; capture
   COM with a suitable high-impedance analog or differential probe. Record PS,
   SPL and CLS where accessible. Use board ground and document the exact test
   points.
4. Use at least 100 MS/s for digital signals and at least 20 MS/s for COM,
   subject to probe/instrument bandwidth. Capture at least three complete
   frames and pre-trigger context. These are protocol minima, not source facts.
5. Trigger on the selected frame reference, retain raw samples unchanged, and
   export one record conforming to
   `models/nintendo-ags-101/data/scan-capture.schema.json`.
6. Derive DCK frequency, line period, frame period, latch edge relative to row
   start, MOD/REVC parity, and their uncertainties in a separate generated
   artifact. Never overwrite raw traces with derived timing.

Such a trace would characterize the motherboard timing and can refine
`LatchOffsetLines` and parity mapping. It still cannot measure the optical
delay of an absent pristine panel; zero pure delay plus the existing causal GtG
response remains the period-theory default.
