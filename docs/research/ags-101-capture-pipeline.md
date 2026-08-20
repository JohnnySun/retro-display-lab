# AGS-101 deterministic stimulus and capture pipeline

Status: WS2 repository pipeline and pinned mGBA smoke receipt complete on
2026-08-20. Original-hardware ROM execution and the current-artifact KONKR
presentation receipt remain optional/pending respectively.

## Purpose

Electrical timing, photodiode response, static color, aperture imaging, and
retention experiments must identify the same source event. WS2 therefore
defines one deterministic stimulus vocabulary and keeps these stages separate:

```text
scene specification
  -> exact GBA ROM and framebuffer hashes
  -> raw electrical/photodiode files
  -> trigger-aligned normalized waveforms
  -> fit/rejection report
  -> accepted GtG measurement record
  -> packed runtime fixture
```

Raw files are immutable inputs. Normalization, fitting, and packing always
produce new files.

## Stimulus suite

The source is
`models/nintendo-ags-101/data/ws2-stimulus-scenes-v1.json`.
`tools/build-ags101-test-rom.mjs` generates eleven independent ROMs and a
manifest under `generated/ws2-stimulus-v1`.

| Scene | Purpose | Page schedule |
| --- | --- | --- |
| `color-ramps` | neutral, R, G, B, and mixed RGB555 ramps | static |
| `mixed-patches` | intermediate mixed colors | static |
| `row-markers` | row identity and top/center/bottom sentinels | static |
| `checkerboard` | one-pixel alternating spatial load | static |
| `isolated-window` | window/surround spatial stress | static |
| `parity-toggle` | bounded local-window frame parity marker, RGB555 8↔24 on a stable code-8 surround | 1/1 frames, 600 flips maximum, then hold page 0 |
| `gtg-neutral-gate` | neutral 0↔31 optical gate | 120/120 frames |
| `gtg-red-gate` | red 0↔31 optical gate | 120/120 frames |
| `gtg-green-gate` | green 0↔31 optical gate | 120/120 frames |
| `gtg-blue-gate` | blue 0↔31 optical gate | 120/120 frames |
| `retention-stress-recovery` | window stress then uniform recovery | 1800/900 frames |

The ROMs use GBA bitmap Mode 4. Both 240×160 pages and the complete RGB555
palette are loaded before enabling display. Dynamic scenes only change the
display page bit at a VBlank edge, so the source does not perform a
visible-period full-frame upload. The manifest records source-spec hash, ROM
hash, ARM-program hash, page hashes, palette values, GBA header checksum, dwell
counts, and the exact GBA clock.

Each scene is a separate ROM so a capture cannot begin in an undocumented
phase of a long automatic demo loop.

### Live-device stimulus safety

The ordinary parity/exposure validation does not require full-field black/white
alternation. The current `parity-toggle` ROM limits the changing region to a
96×64 center window (16% of the 240×160 frame), limits neutral contrast to
RGB555 8↔24, and hard-stops page flips after 600 VBlank events (about 10.05
seconds). Its ARM program then holds the low-neutral page without further
display-page changes. The generator and validators reject a window above 25%
of the frame, contrast above 16 codes, more than 600 flips, a dynamic interval
above 10.1 seconds, or a non-low terminal page.

Full-range optical-gate scenes are specialized bench stimuli, not a prerequisite
for routine shader, parity, exposure, build, or emulator validation. Do not run
them on a user device merely to exercise the repository test suite; use the
generated fixtures and host-side checks unless a separately reviewed physical
measurement protocol explicitly requires panel observation.

The KONKR receipts dated 2026-08-20 are historical evidence from the earlier
full-field parity ROM. They are retained as records of that run and do not claim
that the bounded replacement has been rerun on the device.

## Capture schemas

`electrical-capture.schema.json` records:

- board/panel identity and modification history;
- brightness, warm-up, temperature, ambient, battery/charger, and VCOM state;
- oscilloscope/logic-analyzer rate, bandwidth, accuracy, and probe loading;
- stimulus suite, scene, ROM, and manifest hashes;
- trigger reference and uncertainty;
- row, parity, source code, signal-file mapping, units, and raw hashes.

`photodiode-capture.schema.json` additionally records detector linearity,
position/footprint, acquisition units, repeated transition identity, source
row, frame parity, event reference, and raw waveform hashes.

Null is permitted only where the protocol explicitly allows an unmeasured
quantity. A measured session must not replace unknown metadata with synthetic
placeholders.

## Photodiode normalization

`reference/capture-pipeline.mjs` accepts CSV with:

```text
time_seconds,detector_response,trigger
```

For each repetition it:

1. locates the first rising trigger crossing;
2. subtracts that timestamp from every sample;
3. detects gaps larger than 1.5 nominal sample intervals;
4. uses declared plateaus, or isolated pretrigger/tail windows;
5. converts detector response to normalized transition progress;
6. runs the existing full-waveform first-order fit;
7. rejects missing samples, censored settling, non-monotonicity, overshoot,
   undershoot, RMSE failure, or maximum-error failure.

Rejected waveforms remain in the normalization report but do not enter the GtG
measurement record. The generated GtG record lists their cells as missing, so
the runtime builder produces an explicit fallback rather than disguising a
rejection as measurement.

## Synthetic loopback

`tools/build-ags101-ws2.mjs` generates five three-repeat cases:

- clean first-order response, accepted;
- noisy response, rejected;
- overshoot, rejected;
- missing samples, rejected;
- censored settling, rejected.

The resulting report contains 15 traceable waveforms: 3 accepted and 12
rejected. The accepted cell is passed through the existing
`gtg-measurement.schema.json` record and `build-ags101-gtg.mjs`; the packed
fixture contains one measured-path cell and 3,071 explicit fallbacks. All of
this remains classified synthetic.

## Reproduction

```sh
node tools/build-ags101-test-rom.mjs --check
node tools/validate-ags101-ws2-mgba.mjs --check
node tools/build-ags101-ws2.mjs --check
node tools/build-ags101-gtg.mjs --check \
  --input models/nintendo-ags-101/generated/ws2-capture-loopback-v1/gtg-measurement-subset.json \
  --output-prefix models/nintendo-ags-101/generated/ws2-capture-loopback-v1/gtg-runtime
node tools/validate-ags101.mjs
```

## Runtime receipt and remaining hardware option

`generated/ws2-mgba-smoke-v1/report.json` records mGBA 0.10.5, the executable
hash, platform, options, all ROM hashes, and 11/11 successful boots. The same
validator independently decodes each ROM's header, ARM page-selection path,
palette, both Mode 4 pages, and dwell literals, so a passing receipt confirms
that the running artifact and manifest describe the same scene schedule.

This is an emulator compatibility and artifact-consistency gate. It does not
turn synthetic loopback data into panel evidence or prove original GBA signal
timing. A later cartridge run or physical trace is an optional additional
receipt, not a prerequisite for proceeding with period reconstruction.
