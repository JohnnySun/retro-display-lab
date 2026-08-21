# AGS-101 timing evidence and reconstruction

Status: WS3 evidence promotion updated on 2026-08-21. Line-start latch and
row-alternating plus frame-reversal drive are the best available
family-constrained reconstruction defaults. They remain distinct from formal
AGS-101-specific constants pending an AGT trace or exact-panel specification.

## Result

The model separates exact GBA raster timing from AGS-101 interface hypotheses:

```text
t_row_start = row * T_line                  exact GBA timing
t_latch     = t_row_start + L * T_line      unresolved AGS-101 candidate
t_optical   = t_latch + D                   unresolved pure-delay candidate
```

`T_line` and `T_frame` are formal constants. `L=0` and row-plus-frame inversion
are reconstruction defaults supported by mutually consistent Sharp-family
documents and a cross-model GBA signal observation; they are not formal AGT
constants. `D=0`, starting polarity phase, and brightness coupling remain
project conventions or unresolved. Legacy line-center/frame-global behavior
remains available as a sensitivity control.

The normalized records are:

- `models/nintendo-ags-101/data/ws3-evidence-inventory-v1.json`;
- `models/nintendo-ags-101/data/ws3-timing-constraints-v1.json`;
- `models/nintendo-ags-101/generated/ws3-timing-constraints-v1.json`;
- `models/nintendo-ags-101/generated/ws3-presets-v1/manifest.json`;
- `models/nintendo-ags-101/generated/ws3-sensitivity-v1.json`;
- `models/nintendo-ags-101/generated/ws3-shader-compile-v1.json`.

`tools/build-ags101-ws3.mjs` verifies source classes, evidence references,
exact raster arithmetic, the WS2 ROM/runtime gate, generated CPU event vectors,
the shared Shader equations, candidate presets, sensitivity output, and the
Shader compile receipt.

## Evidence tiers

| Tier | Record | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Manufacturer period document | Nintendo GBA Programming Manual `AGB-06-0001-002-B13` | 240/308 dots, 160/228 rows, blanking sizes, rounded line/frame periods, Mode 4 frame layout | AGS-101 panel-interface edge or optical delay |
| Technical reconstruction | GBATEK GBA timing and SP interface | Exact clock/cycle arithmetic and generic SP signal/socket names | Direct AGT-CPU-01 routing, voltage, edge polarity, or phase |
| Cross-model signal observation | InsideGadgets AGB logic-analyzer record | 240 visible-line DCLK pulses, RGB changes on DCLK negative edges, and control activity at line boundaries on the observed AGB | An AGT-CPU-01 edge capture or proof that every signal phase transfers |
| Primary artifact records | iceboy and gbhwdb photographs | `C/AGT-CPU-01`; one documented matching panel label `LQ029B1DC01F` | Electrical behavior or population-wide panel identity |
| Cross-model reverse engineering | Gekkio `AGS-CPU-11` schematic | Period-adjacent AGS-001 topology | AGS-101/AGT circuit facts; the author explicitly scopes it to AGS-CPU-11 |
| Manufacturer-family document | Sharp `LZ9JG17B` datasheet | DCK/LP/source/gate/REVC family signal semantics | Identification as the AGS-101 controller or transferable phase values |
| Period controller application note | NXP `AN2415` for Sharp HR-TFT | Distinct Sharp control roles and a REV transition on every line | Identification of the AGS panel, exact edge, voltage, or starting phase |
| Near-size manufacturer-family document | Sharp `LQ030B1DC`, `LCG-02039B` | REV reversal every horizontal and vertical scan; per-module VCOM adjustment | Exact LQ029 behavior; the 2007/2008 document postdates the 2005 AGS specimen |
| Qualitative direct observation | `gba-frame-test` high-speed examples | Original GBA-family panels visibly scan line by line | Synchronized AGS-101 timing metrology |
| Local runtime receipt | WS2 mGBA report | Generated ROMs boot and decoded scenes match the manifest | Original-hardware timing or panel optics |

An exact `LQ029B1DC01F` manufacturer specification was not found in searches
of exact part-number variants, PDF indexes, Sharp-hosted results, and archive
indexes on 2026-08-20 and 2026-08-21. This is recorded as a bounded negative search, not proof
that no document exists. Nearby `LQ029*` or `LQ030*` parts are not substituted.

## Exact platform constants

The period document and technical reconstruction agree on dimensions. GBATEK's
cycle counts reproduce the exact runtime values:

```text
master clock     = 16,777,216 Hz
cycles per dot   = 4
dots per line    = 308 = 240 visible + 68 blank
cycles per line  = 1,232
lines per frame  = 228 = 160 visible + 68 blank
cycles per frame = 280,896

T_line  = 1232 / 16777216
        = 0.00007343292236328125 s
T_frame = 280896 / 16777216
        = 0.016742706298828125 s
fps     = 59.72750056960583 Hz
```

The source coordinate is top-to-bottom, rows 0–159. Visible rows are not
stretched over VBlank. WS2 dynamic scenes preload both Mode 4 pages and change
only the page-select bit at a VBlank edge.

## Hardware identity and signal reconstruction

The authenticated artifact baseline is deliberately narrow: one 2005 AGS-101
record pairs a `C/AGT-CPU-01` board with panel sticker
`LQ029B1DC01F 58E06466754`. Multiple AGT board photos corroborate the board
marking. This does not prove that every AGS-101 used that exact panel.

The generic GBA SP interface exposes DCK, LP, PS, SPL, CLS, SPS, MOD, REVC,
five-bit R/G/B buses, panel supply contacts, and COM. The constraint record
tracks existence, inferred direction, family-level function, and AGS-101 timing
independently for every signal. The recovered evidence supports a line-boundary
latch and row-plus-frame inversion as runtime reconstruction defaults, while
AGS-101-specific edges and starting polarity remain unknown. Brightness
control is even less resolved: two user modes are known,
but this audit found no defensible DC/PWM net, frequency, or ratio.

## Candidate sets

The runtime retains the full diagnostic set while naming the strongest
evidence-bounded reconstruction member:

- latch phase: line start `0` reconstruction default, legacy line center `0.5`,
  line end `1.0`;
- pure delay: zero extra dead time, one-line sensitivity, half-frame
  sensitivity;
- frame parity phase: even-positive or odd-positive;
- inversion topology: row-alternating plus frame reversal reconstruction
  default; legacy frame-global, column, or dot/checkerboard controls;
- brightness coupling: none, DC gain, or PWM exposure.

The one-line and half-frame delays are test points inside the runtime's causal
representable interval, not physical bounds derived for `LQ029B1DC01F`.
Line start is the boundary between the previous line's completion and the next
line's start in this software convention. Family source/latch semantics plus
the cross-model waveform make it the preferred reconstruction point, but it is
still not a captured AGT electrical edge.

The runtime implements all four inversion candidates and both frame-parity
phases through `ParityPhase` and `InversionTopology`. Response and display use
the same generated `ags101-ws3-timing.inc`. The runtime default is recorded
separately from `formalSelection=null`: it is the best available reconstruction,
not an authentic-panel measurement.

## WS2 gate before formal constants

The WS3 builder refuses to generate its artifact unless:

1. the WS2 scene-source hash equals the manifest source hash;
2. every decoded ROM header, palette, framebuffer page, page-flip instruction,
   and dwell literal equals the source and manifest;
3. every manifest ROM hash equals the runtime receipt;
4. all eleven ROMs passed the pinned mGBA boot smoke test.

The current receipt passes 11/11 scenes on mGBA 0.10.5. This establishes that
the ROM scene and manifest are consistent before timing hypotheses are emitted.
It does not establish an AGS-101 electrical constant.

## Runtime event semantics

The electrical latch and optical target change remain separate events. With a
selected candidate `(L, D)`:

```text
rowStart = row * T_line
latch    = rowStart + L * T_line
optical  = latch + D
```

If `optical < T_frame`, the output frame integrates the N-1 to N transition.
If it crosses one frame boundary, it integrates N-2 to N-1 at
`optical - T_frame`. It never clamps the event to the frame endpoint or samples
N early. Missing negative history uses the documented frontend fallback.

Normal forward `TotalSubFrames=1` rendering is supported. Rewind, run-ahead,
and dropped fast-forward frames do not reconstruct shader feedback.

## Runtime acceptance

The generated preset set contains nine timing combinations, two parity phases,
four inversion topologies, and five independent read-only diagnostics. Debug
views 6–10 isolate row start, latch, optical onset, parity phase, and inversion
topology. `DebugView` remains absent from the feedback-writing response pass.

The acceptance artifacts establish:

1. 80 CPU polarity vectors reproduce the generated Shader equation;
2. all 27 representative scan-event vectors reproduce `scanEvent` exactly;
3. eight of nine timing candidates alter the modeled black-to-white output
   relative to the line-start/zero-delay reconstruction default; that default
   is the one unchanged control;
4. 14 of 16 parity/topology/frame runs alter electrical excitation relative to
   the row-alternating/even-positive reconstruction default;
5. response/exposure/display vertex and fragment stages compile through glslang and all
   six SPIR-V modules pass `spirv-val` for Vulkan 1.1.

This is equation, compilation, and model-output sensitivity acceptance. It is
not GPU numeric readback, panel measurement, or evidence for selecting one
hypothesis as authentic.

## Closure and future evidence

WS3 is complete under the no-hardware reconstruction policy. Family evidence
now narrows the normal reconstruction to line-start and row-plus-frame
inversion, while the broad candidate set remains because the source audit found
no exact-panel or AGT circuit values. Optical delay and starting polarity are
not narrowed visually.

Authentic hardware remains optional future evidence. If an AGT motherboard is
ever available, the existing electrical-capture schema can record DCK, LP,
SPS, MOD, REVC, COM, supplies, and uncertainty without changing this evidence
model. A panel would still be required to measure optical delay or GtG response.
