# Upstream reference data

This directory preserves the exact source data used by the CGB-001
reconstruction so that every derived value remains independently auditable.
Files are stored verbatim; project normalization and runtime artifacts live
outside this directory and never overwrite them.

## HCS Nintendo GBC measurement

- Project: Handheld Color Space Project
- Authors/contributors: Brankale / Pokefan531
- Repository: <https://github.com/Brankale/Handheld-Color-Space-Project>
- Pinned commit: `e688fc51141c0974728aa1bdcb89b94d74123f6b`
- Original directory:
  `handhelds/Nintendo GBC/[2026-05-xx][Pokefan531][WIP]`
- Evidence ID: `CGB-HCS-REFLECTANCE-2026`

Verbatim files retained:

| File | SHA-256 | Role |
| --- | --- | --- |
| `hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b/measurements/gbc_reflectance.ods` | `967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba` | Complete source workbook |
| `hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b/measurements/gbc_reflectance.txt` | `b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37` | Source text export used for cross-checking |
| `hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b/report/GBC_illuminant_D65_params.csv` | `1126ac8104f27c3a590a19c59ab605395cca9b9ca86bd5f52b00ff3a13ffa86c` | Verbatim upstream-derived D65 comparison fixture |

The pinned HCS repository does not contain a root license or copying notice.
These files are retained as attributed scientific source/reference material,
not relicensed as Apache-2.0 project code. Preserve the original attribution,
commit, file hashes, WIP status, and measurement limitations when
redistributing this directory. In particular, the source author records an
incomplete measurement protocol, 31/33-patch ramp errors, drifting black,
invalid short-wavelength data, negative reflectance, failed XYZ additivity,
and manual modifications in the report-stage data.

## CIE standard data

The CIE files and their original metadata are stored verbatim under `cie/`.
The metadata identifies both datasets as Creative Commons
Attribution-ShareAlike 4.0 International.

| Dataset | DOI | SHA-256 |
| --- | --- | --- |
| CIE 1931 2° colour-matching functions | `10.25039/CIE.DS.xvudnb9b` | `fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1` |
| CIE standard illuminant D65 | `10.25039/CIE.DS.hjfjmt59` | `e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb` |

Source pages:

- <https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer>
- <https://www.cie.co.at/datatable/cie-standard-illuminant-d65>

The CIE CSV and metadata files remain governed by their stated CC BY-SA 4.0
terms. They are not covered by the repository's Apache-2.0 license.

## Gambatte libretro frontend reference

- Project: Gambatte libretro
- Repository: <https://github.com/libretro/gambatte-libretro>
- Pinned commit: `3262c2aa4adae8dba4f6d51cdd931c15cb11569f`
- Commit page: <https://github.com/libretro/gambatte-libretro/commit/3262c2aa4adae8dba4f6d51cdd931c15cb11569f>
- Evidence ID: `CGB-PRIOR-LIBRETRO`
- Upstream license file: GNU GPL version 2 (`COPYING`)

The complete GitHub source archive is retained verbatim so the WS2 core can be
built without a network fetch. Exact source files used to audit the libretro
pixel format, core options, geometry/timing, and RGB555 conversion are also
extracted unchanged for direct review:

| File | SHA-256 | Role |
| --- | --- | --- |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/gambatte-libretro.tar.gz` | `b67b5586f4a038c4e8b88cee537f59ab0878428b94a5c5bb10dd4b1870fac52f` | Complete pinned source archive |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/COPYING` | `ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6` | Upstream GPL-2.0 license text |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/Makefile.libretro` | `3c41f26d7296cb5d0f191853cb0e7891fa97ef1cb4ae984ce1db496b6bb7691f` | Default `VIDEO_RGB565=1` build path |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/gambatte.h` | `f3dd87bfcc8e5cad00b85dcc9b5c8ff4a94eaa681bc155b51fe9ff4443d327ed` | Core public timing/API constants |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/libretro.cpp` | `9a1c3e3c6f4bb9fe231a6a8e5a806c878ae0c7dacac6dec3f83f0fe9764256ed` | Pixel-format, geometry, timing, lifecycle, and option wiring |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/libretro.h` | `3e05e66cdfa2ddb8e9ac4eee6bb38ff4d735ed82e8563ef116b710089c732512` | Exact libretro ABI header used by the smoke harness |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/libretro_core_options.h` | `b7051285a7e04156dfc189e4e154474ba93515bf8e89b5f47e7edaecd80b7145` | Core option values and upstream defaults |
| `gambatte/3262c2aa4adae8dba4f6d51cdd931c15cb11569f/source/video_libretro.cpp` | `cea39b4ab1de0c24fd3e6f58f12b455e38903f9a950092ef9f3ffd20364fb887` | CGB BGR15 to frontend RGB565 conversion |

These upstream files remain under their upstream license and are not covered
by the repository's Apache-2.0 license. The project-owned ROM generator,
decoder, validation harness, policy, and reports remain separate.
