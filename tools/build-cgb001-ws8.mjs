#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateUpstreamD65 } from "../models/nintendo-cgb-001/reference/color-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const generatedDir = path.join(modelDir, "generated");
const shaderDir = path.join(modelDir, "shaders");
const presetDir = path.join(modelDir, "presets");
const checkOnly = process.argv.includes("--check");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function clean(value) {
  const numeric = Number(value);
  if (Math.abs(numeric) < 1e-12) return 0;
  const cleaned = Number(numeric.toPrecision(9));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function output(relative, buffer) {
  const file = path.join(root, relative);
  if (checkOnly) {
    assert(fs.existsSync(file), `missing WS8 artifact: ${relative}`);
    assert(fs.readFileSync(file).equals(buffer), `stale WS8 artifact: ${relative}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
  }
}

const model = readJson(`${modelRelative}/model.json`);
const reconstruction = readJson(`${modelRelative}/data/reconstruction-v1.json`);
const hcs = readJson(`${modelRelative}/data/hcs-source-v1.json`);
const color = readJson(`${modelRelative}/data/color-reference-v1.json`);
const scan = readJson(`${modelRelative}/data/scan-candidates-v1.json`);
const response = readJson(`${modelRelative}/data/response-ensemble-v1.json`);
const exposure = readJson(`${modelRelative}/data/ws5-exposure-policy-v1.json`);
const aperture = readJson(`${modelRelative}/data/aperture-v1.json`);
const retention = readJson(`${modelRelative}/data/retention-v1.json`);
const rateDescriptor = readJson(`${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.json`);

for (let index = 1; index <= 7; index += 1) {
  assert(model.workstreamStatus?.[`ws${index}`] === "complete", `WS${index} must be complete before WS8`);
}
assert(model.workstreamStatus?.ws8 === "complete", "model metadata must mark WS8 complete");
assert(reconstruction.workstreams?.ws8?.status === "complete", "canonical record must mark WS8 complete");
assert(scan.selection?.periodReconstructionDefaults?.inversionTopology === "row-alternating",
  "WS3 row-alternating period default drifted");
assert(exposure.opticalIntegration?.futureShaderContract?.panelsPerNativeFrame === 32,
  "WS5 quadrature panel count drifted");
assert(aperture.subpixelOrder === "RGB" && aperture.geometry?.activeFill?.value === 1,
  "WS6 accepted aperture drifted");
assert(retention.referenceProfile?.resultantDcOffset === 0
    && retention.referenceProfile?.opticalCoupling === 0,
"WS7 healthy reference must remain zero-amplitude");

const members = Object.fromEntries(response.members.map((entry) => [entry.role, entry.parameters]));
const nominalRetention = retention.candidates.find((entry) => entry.id === "nominal-midpoint")?.parameters;
assert(members.fast && members.nominal && members.slow && nominalRetention,
  "response or retention ensemble is incomplete");

const referenceRawPath = path.join(generatedDir, "cgb001-d65-lut-v1.rgba32f");
const rateRawPath = path.join(generatedDir, "cgb001-ws4-gtg-rates-v1.r32f");
const referenceRaw = fs.readFileSync(referenceRawPath);
const rateRaw = fs.readFileSync(rateRawPath);
assert(referenceRaw.length === 32 ** 3 * 16, "WS1 RGBA32F LUT byte length drifted");
assert(rateRaw.length === 3 * 3 * 32 * 32 * 4, "WS4 R32F rate table byte length drifted");

const referenceValues = new Float64Array(32 ** 3 * 3);
for (let texel = 0; texel < 32 ** 3; texel += 1) {
  for (let component = 0; component < 3; component += 1) {
    referenceValues[texel * 3 + component] = referenceRaw.readFloatLE(texel * 16 + component * 4);
  }
}

const upstreamParameters = hcs.upstreamD65Fixture?.parameters;
assert(upstreamParameters, "pinned HCS upstream parameters are missing");
const upstreamValues = new Float64Array(32 ** 3 * 3);
let upstreamMaximum = 0;
for (let b = 0; b < 32; b += 1) {
  for (let g = 0; g < 32; g += 1) {
    for (let r = 0; r < 32; r += 1) {
      const xyz = evaluateUpstreamD65(upstreamParameters, [r / 31, g / 31, b / 31]);
      const texel = (b * 32 + g) * 32 + r;
      for (let component = 0; component < 3; component += 1) {
        assert(Number.isFinite(xyz[component]) && xyz[component] >= 0,
          "upstream LUT generation produced an invalid value");
        upstreamValues[texel * 3 + component] = xyz[component];
        upstreamMaximum = Math.max(upstreamMaximum, xyz[component]);
      }
    }
  }
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function deflateStored(buffer) {
  // A zlib stream made from uncompressed DEFLATE blocks is larger than a
  // compressor-produced stream, but its bytes do not depend on the host zlib
  // release. PNG runtime texels therefore remain byte-identical across Node.
  const blocks = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < buffer.length; offset += 65_535) {
    const length = Math.min(65_535, buffer.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === buffer.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    blocks.push(header, buffer.subarray(offset, offset + length));
  }
  let first = 1;
  let second = 0;
  for (const byte of buffer) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(((second << 16) | first) >>> 0);
  blocks.push(checksum);
  return Buffer.concat(blocks);
}

function packTiledRgba16(values, scale) {
  const width = 32 * 34;
  const height = 32;
  const rows = Buffer.alloc(height * (1 + width * 8));
  let maximumAbsoluteError = 0;
  for (let g = 0; g < 32; g += 1) {
    const rowOffset = g * (1 + width * 8);
    rows[rowOffset] = 0;
    for (let b = 0; b < 32; b += 1) {
      for (let local = 0; local < 34; local += 1) {
        const r = Math.max(0, Math.min(31, local - 1));
        const source = ((b * 32 + g) * 32 + r) * 3;
        const pixel = b * 34 + local;
        const target = rowOffset + 1 + pixel * 8;
        for (let component = 0; component < 3; component += 1) {
          const normalized = Math.max(0, Math.min(1, values[source + component] / scale));
          const packed = Math.round(normalized * 65535);
          rows.writeUInt16BE(packed, target + component * 2);
          maximumAbsoluteError = Math.max(
            maximumAbsoluteError,
            Math.abs(values[source + component] - packed / 65535 * scale),
          );
        }
        rows.writeUInt16BE(65535, target + 6);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateStored(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { png, width, height, maximumAbsoluteError };
}

function packTiledRgba8Planes(values, scale) {
  const width = 32 * 34;
  const height = 32;
  const highRows = Buffer.alloc(height * (1 + width * 4));
  const lowRows = Buffer.alloc(height * (1 + width * 4));
  let maximumAbsoluteError = 0;
  for (let g = 0; g < 32; g += 1) {
    const rowOffset = g * (1 + width * 4);
    highRows[rowOffset] = 0;
    lowRows[rowOffset] = 0;
    for (let b = 0; b < 32; b += 1) {
      for (let local = 0; local < 34; local += 1) {
        const r = Math.max(0, Math.min(31, local - 1));
        const source = ((b * 32 + g) * 32 + r) * 3;
        const pixel = b * 34 + local;
        const target = rowOffset + 1 + pixel * 4;
        for (let component = 0; component < 3; component += 1) {
          const normalized = Math.max(0, Math.min(1, values[source + component] / scale));
          const packed = Math.round(normalized * 65535);
          highRows[target + component] = packed >>> 8;
          lowRows[target + component] = packed & 255;
          maximumAbsoluteError = Math.max(
            maximumAbsoluteError,
            Math.abs(values[source + component] - packed / 65535 * scale),
          );
        }
        highRows[target + 3] = 255;
        lowRows[target + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const encode = (rows) => Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateStored(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { high: encode(highRows), low: encode(lowRows), width, height, maximumAbsoluteError };
}

const referenceScale = 1;
const upstreamScale = Math.max(1, Math.ceil(upstreamMaximum * 4) / 4);
const referenceTexture = packTiledRgba16(referenceValues, referenceScale);
const upstreamTexture = packTiledRgba16(upstreamValues, upstreamScale);
const referencePlanes = packTiledRgba8Planes(referenceValues, referenceScale);
const upstreamPlanes = packTiledRgba8Planes(upstreamValues, upstreamScale);
const referenceTextureRelative = `${modelRelative}/generated/cgb001-reference-d65-v1.png`;
const upstreamTextureRelative = `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1.png`;
const referenceHighRelative = `${modelRelative}/generated/cgb001-reference-d65-v1-hi-rgba8.png`;
const referenceLowRelative = `${modelRelative}/generated/cgb001-reference-d65-v1-lo-rgba8.png`;
const upstreamHighRelative = `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1-hi-rgba8.png`;
const upstreamLowRelative = `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1-lo-rgba8.png`;
output(referenceTextureRelative, referenceTexture.png);
output(upstreamTextureRelative, upstreamTexture.png);
output(referenceHighRelative, referencePlanes.high);
output(referenceLowRelative, referencePlanes.low);
output(upstreamHighRelative, upstreamPlanes.high);
output(upstreamLowRelative, upstreamPlanes.low);

let maximumPackedRateDifference = 0;
for (let memberIndex = 0; memberIndex < 3; memberIndex += 1) {
  const role = ["fast", "nominal", "slow"][memberIndex];
  const member = members[role];
  for (let channel = 0; channel < 3; channel += 1) {
    for (let from = 0; from < 32; from += 1) {
      for (let to = 0; to < 32; to += 1) {
        const distance = Math.abs(to - from) / 31;
        const grayWeight = Math.max(0, Math.min(1, ((1 - distance) / (30 / 31)) ** 2));
        const milliseconds = member.onAndOffT10To90Milliseconds
          + (member.grayT10To90Milliseconds - member.onAndOffT10To90Milliseconds) * grayWeight;
        const shaderRate = Math.fround(Math.log(9) / (milliseconds / 1000));
        const index = (((memberIndex * 3 + channel) * 32 + from) * 32 + to);
        maximumPackedRateDifference = Math.max(
          maximumPackedRateDifference,
          Math.abs(shaderRate - rateRaw.readFloatLE(index * 4)),
        );
      }
    }
  }
}
assert(maximumPackedRateDifference <= 2e-6,
  `Shader analytic rate differs from the authoritative WS4 table: ${maximumPackedRateDifference}`);

const runtimeInclude = Buffer.from(`// Generated by tools/build-cgb001-ws8.mjs; do not edit by hand.
// Sources: data/scan-candidates-v1.json, data/response-ensemble-v1.json,
// data/ws5-exposure-policy-v1.json, data/retention-v1.json, and WS8 textures.
const float CGB_MASTER_CLOCK_HZ = 4194304.0;
const float CGB_DOTS_PER_LINE = 456.0;
const float CGB_TOTAL_LINES = 154.0;
const float CGB_LINE_SECONDS = CGB_DOTS_PER_LINE / CGB_MASTER_CLOCK_HZ;
const float CGB_FRAME_SECONDS = CGB_DOTS_PER_LINE * CGB_TOTAL_LINES / CGB_MASTER_CLOCK_HZ;
const float CGB_LN9 = ${Math.log(9).toPrecision(12)};
const float CGB_RESPONSE_SNAP_EPSILON = ${response.selectedModel.snapEpsilon.toPrecision(12)};
const float CGB_RESPONSE_FAST_ON_OFF_MS = ${members.fast.onAndOffT10To90Milliseconds.toFixed(1)};
const float CGB_RESPONSE_FAST_GRAY_MS = ${members.fast.grayT10To90Milliseconds.toFixed(1)};
const float CGB_RESPONSE_NOMINAL_ON_OFF_MS = ${members.nominal.onAndOffT10To90Milliseconds.toFixed(1)};
const float CGB_RESPONSE_NOMINAL_GRAY_MS = ${members.nominal.grayT10To90Milliseconds.toFixed(1)};
const float CGB_RESPONSE_SLOW_ON_OFF_MS = ${members.slow.onAndOffT10To90Milliseconds.toFixed(1)};
const float CGB_RESPONSE_SLOW_GRAY_MS = ${members.slow.grayT10To90Milliseconds.toFixed(1)};
const float CGB_LATCH_OFFSET_LINES = 0.0;
const float CGB_ROW_ACTIVATION_DELAY_LINES = 0.0;
const uint CGB_PARITY_PHASE = 0u;
const int CGB_INVERSION_TOPOLOGY = 2;
const float CGB_RETENTION_ADSORPTION_RATE = ${nominalRetention.adsorptionRatePerSecond.toPrecision(12)};
const float CGB_RETENTION_DESORPTION_RATE = ${nominalRetention.desorptionRatePerSecond.toPrecision(12)};
const float CGB_RETENTION_CODE_WEIGHT = 0.5;
const float CGB_RETENTION_POLARITY_WEIGHT = 0.25;
const float CGB_RETENTION_DIAGNOSTIC_DC_OFFSET = 0.1;
const float CGB_RETENTION_DIAGNOSTIC_OPTICAL_COUPLING = 0.02;
const int CGB_EXPOSURE_PANELS = ${exposure.opticalIntegration.futureShaderContract.panelsPerNativeFrame};
const float CGB_GL2_NODE = 0.288675134595;
const int CGB_LUT_TILE_STRIDE = 34;
const int CGB_LUT_TILE_PADDING = 1;
const int CGB_LUT_TEXTURE_WIDTH = ${referenceTexture.width};
const int CGB_LUT_TEXTURE_HEIGHT = ${referenceTexture.height};
const float CGB_REFERENCE_LUT_SCALE = ${referenceScale.toFixed(1)};
const float CGB_UPSTREAM_LUT_SCALE = ${upstreamScale.toFixed(2)};
`);
const runtimeIncludeRelative = `${modelRelative}/shaders/cgb001-runtime-v1.inc`;
output(runtimeIncludeRelative, runtimeInclude);

const textureDescriptor = {
  schemaVersion: 1,
  artifactId: "cgb001-ws8-runtime-textures-v1",
  classification: "frontend-loadable-derived-textures-authoritative-float-sources-retained",
  generatedBy: "tools/build-cgb001-ws8.mjs",
  layout: {
    dimensions: [referenceTexture.width, referenceTexture.height],
    pngFormat: "paired RGBA8_UNORM high-byte/low-byte data planes",
    axisLayout: "32 B slices, each 34 texels wide with one duplicated R-edge texel on each side; G vertical; Shader performs explicit RGB trilinear interpolation after uint16 reconstruction",
    requiredFiltering: "nearest; Shader reconstructs uint16 and performs trilinear interpolation manually",
    requiredWrap: "clamp_to_edge",
    uploadPrecisionMustBeVerifiedInWs9: true,
    rejectedTargetProbe: {
      format: "single RGBA16 PNG",
      filesRetained: ["cgb001-reference-d65-v1.png", "cgb001-hcs-upstream-d65-v1.png"],
      result: "RetroArch 1.22.2 generic PNG loader on KONKR exposed n/255 values; retained as a reproducible failed transport probe, not used by presets",
    },
  },
  textures: {
    referenceD65: {
      path: "cgb001-reference-d65-v1-hi-rgba8.png",
      sha256: sha256(referencePlanes.high),
      rejectedRgba16Probe: { path: "cgb001-reference-d65-v1.png", sha256: sha256(referenceTexture.png) },
      runtimeHighPlane: { path: "cgb001-reference-d65-v1-hi-rgba8.png", sha256: sha256(referencePlanes.high) },
      runtimeLowPlane: { path: "cgb001-reference-d65-v1-lo-rgba8.png", sha256: sha256(referencePlanes.low) },
      encodedScale: referenceScale,
      authoritativeSource: "cgb001-d65-lut-v1.rgba32f",
      authoritativeSourceSha256: sha256(referenceRaw),
      maximumIntegerTexelAbsoluteXyzQuantizationError: clean(referenceTexture.maximumAbsoluteError),
    },
    hcsUpstreamD65: {
      path: "cgb001-hcs-upstream-d65-v1-hi-rgba8.png",
      sha256: sha256(upstreamPlanes.high),
      rejectedRgba16Probe: { path: "cgb001-hcs-upstream-d65-v1.png", sha256: sha256(upstreamTexture.png) },
      runtimeHighPlane: { path: "cgb001-hcs-upstream-d65-v1-hi-rgba8.png", sha256: sha256(upstreamPlanes.high) },
      runtimeLowPlane: { path: "cgb001-hcs-upstream-d65-v1-lo-rgba8.png", sha256: sha256(upstreamPlanes.low) },
      encodedScale: upstreamScale,
      authoritativeSource: "../data/hcs-source-v1.json#upstreamD65Fixture",
      authoritativeSourceSha256: sha256File(path.join(modelDir, "data/hcs-source-v1.json")),
      maximumIntegerTexelAbsoluteXyzQuantizationError: clean(upstreamTexture.maximumAbsoluteError),
    },
  },
  rateBinding: {
    authoritativeSource: "cgb001-ws4-gtg-rates-v1.r32f",
    authoritativeSourceSha256: sha256(rateRaw),
    shaderReduction: "the frozen WS4 analytic rate equation and the three source-record endpoints",
    maximumFloat32DifferenceAcross9216Cells: clean(maximumPackedRateDifference),
  },
  boundary: "The PNG files are derived frontend transport textures. They do not replace, relabel, or modify the retained RGBA32F WS1 LUT, R32F WS4 rate table, or verbatim HCS measurements.",
};
const textureDescriptorRelative = `${modelRelative}/generated/ws8-runtime-textures-v1.json`;
output(textureDescriptorRelative, jsonBuffer(textureDescriptor));

const stateDefaults = {
  ModelEnable: "1.0",
  ResponseEnsemble: "1.0",
  TemporalResponse: "1.0",
  ScanEnabled: "1.0",
  RetentionAmount: "0.0",
  ApertureAmount: "1.0",
  ModelExposure: "1.0",
  ColorPolicy: "0.0",
  DebugView: "0.0",
};

function presetBuffer({ title, classification, overrides = {} }) {
  const values = { ...stateDefaults, ...overrides };
  return Buffer.from(`## Nintendo CGB-001 WS8 ${classification}: ${title}
## Provenance: ../REFERENCES.md
## Fixed CIE D65, 45 degree illumination, 0 degree panel-normal view.
## Complete preset: no inherited parameter state.

shaders = "3"

textures = "CgbReferenceLut;CgbReferenceLutLo;CgbUpstreamLut;CgbUpstreamLutLo"
CgbReferenceLut = "../generated/cgb001-reference-d65-v1-hi-rgba8.png"
CgbReferenceLut_linear = "false"
CgbReferenceLut_wrap_mode = "clamp_to_edge"
CgbReferenceLut_mipmap = "false"
CgbReferenceLutLo = "../generated/cgb001-reference-d65-v1-lo-rgba8.png"
CgbReferenceLutLo_linear = "false"
CgbReferenceLutLo_wrap_mode = "clamp_to_edge"
CgbReferenceLutLo_mipmap = "false"
CgbUpstreamLut = "../generated/cgb001-hcs-upstream-d65-v1-hi-rgba8.png"
CgbUpstreamLut_linear = "false"
CgbUpstreamLut_wrap_mode = "clamp_to_edge"
CgbUpstreamLut_mipmap = "false"
CgbUpstreamLutLo = "../generated/cgb001-hcs-upstream-d65-v1-lo-rgba8.png"
CgbUpstreamLutLo_linear = "false"
CgbUpstreamLutLo_wrap_mode = "clamp_to_edge"
CgbUpstreamLutLo_mipmap = "false"

shader0 = "../shaders/cgb001-response-v1.slang"
filter_linear0 = "false"
scale_type0 = "source"
scale0 = "1.0"

shader1 = "../shaders/cgb001-color-v1.slang"
filter_linear1 = "false"
scale_type1 = "source"
scale1 = "1.0"

shader2 = "../shaders/cgb001-display-v1.slang"
filter_linear2 = "false"
scale_type2 = "viewport"
scale2 = "1.0"

ModelEnable = "${values.ModelEnable}"
ResponseEnsemble = "${values.ResponseEnsemble}"
TemporalResponse = "${values.TemporalResponse}"
ScanEnabled = "${values.ScanEnabled}"
RetentionAmount = "${values.RetentionAmount}"
ApertureAmount = "${values.ApertureAmount}"
ModelExposure = "${values.ModelExposure}"
ColorPolicy = "${values.ColorPolicy}"
DebugView = "${values.DebugView}"
`);
}

const presetDefinitions = new Map([
  ["reference-d65-v1.slangp", { title: "reference D65 period reconstruction", classification: "normal" }],
  ["static-color-only-v1.slangp", { title: "WS1 static color only", classification: "isolation", overrides: { TemporalResponse: "0.0", ScanEnabled: "0.0", ApertureAmount: "0.0" } }],
  ["response-fast-v1.slangp", { title: "fast manufacturer-family response bound", classification: "uncertainty", overrides: { ResponseEnsemble: "0.0" } }],
  ["response-slow-v1.slangp", { title: "slow manufacturer-family response bound", classification: "uncertainty", overrides: { ResponseEnsemble: "2.0" } }],
  ["no-scan-v1.slangp", { title: "row-activation bypass", classification: "isolation", overrides: { ScanEnabled: "0.0" } }],
  ["no-retention-v1.slangp", { title: "independent residual-state bypass", classification: "isolation", overrides: { RetentionAmount: "0.0" } }],
  ["no-aperture-v1.slangp", { title: "RGB aperture bypass", classification: "isolation", overrides: { ApertureAmount: "0.0" } }],
  ["hcs-upstream-d65-v1.slangp", { title: "exact pinned HCS upstream-color equation", classification: "comparison", overrides: { TemporalResponse: "0.0", ScanEnabled: "0.0", ApertureAmount: "0.0", ColorPolicy: "1.0" } }],
  ["diagnostic-source-code-v1.slangp", { title: "uncorrected RGB555 source code", classification: "diagnostic", overrides: { DebugView: "1.0" } }],
  ["diagnostic-row-phase-v1.slangp", { title: "row activation phase", classification: "diagnostic", overrides: { DebugView: "2.0" } }],
  ["diagnostic-response-state-v1.slangp", { title: "persistent RGB response state", classification: "diagnostic", overrides: { DebugView: "3.0" } }],
  ["diagnostic-exposure-v1.slangp", { title: "frame-average reflected exposure", classification: "diagnostic", overrides: { DebugView: "4.0" } }],
  ["diagnostic-lut-output-v1.slangp", { title: "settled WS1 LUT output", classification: "diagnostic", overrides: { DebugView: "5.0" } }],
  ["diagnostic-residual-state-v1.slangp", { title: "independent residual-DC state", classification: "diagnostic", overrides: { DebugView: "6.0" } }],
  ["diagnostic-aperture-coverage-v1.slangp", { title: "analytic RGB aperture coverage", classification: "diagnostic", overrides: { DebugView: "7.0" } }],
]);

const presetHashes = {};
for (const [name, definition] of presetDefinitions) {
  const buffer = presetBuffer(definition);
  output(`${modelRelative}/presets/${name}`, buffer);
  presetHashes[`presets/${name}`] = sha256(buffer);
}

function expandIncludes(source, directory, seen = new Set()) {
  return source.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_match, includeName) => {
    const includePath = path.resolve(directory, includeName);
    assert(includePath.startsWith(shaderDir + path.sep), `Shader include escaped model directory: ${includeName}`);
    assert(!seen.has(includePath), `recursive Shader include: ${includeName}`);
    const nextSeen = new Set(seen).add(includePath);
    return expandIncludes(fs.readFileSync(includePath, "utf8"), path.dirname(includePath), nextSeen);
  });
}

function stageSource(shaderPath, stage) {
  const source = fs.readFileSync(shaderPath, "utf8");
  const vertexMarker = "#pragma stage vertex";
  const fragmentMarker = "#pragma stage fragment";
  const vertexIndex = source.indexOf(vertexMarker);
  const fragmentIndex = source.indexOf(fragmentMarker);
  assert(vertexIndex >= 0 && fragmentIndex > vertexIndex, `${path.basename(shaderPath)} has invalid stage markers`);
  const common = source.slice(0, vertexIndex);
  const stageBody = stage === "vert"
    ? source.slice(vertexIndex + vertexMarker.length, fragmentIndex)
    : source.slice(fragmentIndex + fragmentMarker.length);
  return expandIncludes(`${common}\n${stageBody}`, path.dirname(shaderPath))
    .replace(/^#pragma\s+(?:format|parameter).*$/gm, "");
}

const shaderPaths = new Map([
  ["response", path.join(shaderDir, "cgb001-response-v1.slang")],
  ["color", path.join(shaderDir, "cgb001-color-v1.slang")],
  ["display", path.join(shaderDir, "cgb001-display-v1.slang")],
]);

function compileShaders() {
  const glslang = spawnSync("glslangValidator", ["--version"], { encoding: "utf8" });
  const spirvVal = spawnSync("spirv-val", ["--version"], { encoding: "utf8" });
  assert(glslang.status === 0, "glslangValidator is required to complete WS8");
  assert(spirvVal.status === 0, "spirv-val is required to complete WS8");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rdl-cgb001-ws8-compile-"));
  const stages = [];
  try {
    for (const [shaderId, shaderPath] of shaderPaths) {
      for (const stage of ["vert", "frag"]) {
        const expanded = stageSource(shaderPath, stage);
        const sourcePath = path.join(scratch, `${shaderId}.${stage}`);
        const spirvPath = `${sourcePath}.spv`;
        fs.writeFileSync(sourcePath, expanded);
        const compile = spawnSync("glslangValidator", [
          "-V", "--target-env", "vulkan1.1", "-S", stage, "-o", spirvPath, sourcePath,
        ], { encoding: "utf8" });
        assert(compile.status === 0,
          `${shaderId} ${stage} compilation failed:\n${compile.stdout}\n${compile.stderr}`);
        const validate = spawnSync("spirv-val", ["--target-env", "vulkan1.1", spirvPath], {
          encoding: "utf8",
        });
        assert(validate.status === 0,
          `${shaderId} ${stage} SPIR-V validation failed:\n${validate.stdout}\n${validate.stderr}`);
        const spirv = fs.readFileSync(spirvPath);
        stages.push({
          shaderId,
          stage,
          expandedSourceSha256: sha256(Buffer.from(expanded)),
          spirvSha256: sha256(spirv),
          spirvBytes: spirv.length,
          pass: true,
        });
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return {
    schemaVersion: 1,
    receiptId: "cgb001-ws8-shader-compile-v1",
    classification: "local-shader-compile-and-spirv-validation-not-gpu-readback",
    capturedAt: new Date().toISOString(),
    tools: {
      glslangValidator: glslang.stdout.trim().split("\n")[0],
      spirvVal: spirvVal.stdout.trim().split("\n")[0],
      targetEnvironment: "vulkan1.1",
    },
    sources: {
      ...Object.fromEntries([...shaderPaths].map(([id, file]) => [`${id}ShaderSha256`, sha256File(file)])),
      commonIncludeSha256: sha256File(path.join(shaderDir, "cgb001-common.inc")),
      runtimeIncludeSha256: sha256(runtimeInclude),
    },
    intendedFormats: {
      response: "R32G32B32A32_SFLOAT persistent feedback",
      color: "R32G32B32A32_SFLOAT non-persistent XYZ exposure",
      display: "frontend swapchain output",
    },
    stages,
    summary: { stages: stages.length, pass: stages.length === 6 && stages.every((entry) => entry.pass) },
    limits: "Compilation and SPIR-V validation prove syntax, interface, and declared formats. Actual texture upload precision, feedback allocation, numeric GPU readback, lifecycle behavior, and KONKR performance remain WS9.",
  };
}

const compileRelative = `${modelRelative}/generated/ws8-shader-compile-v1.json`;
let compileReceipt;
if (checkOnly) {
  compileReceipt = readJson(compileRelative);
  assert(compileReceipt.summary?.pass === true && compileReceipt.stages?.length === 6,
    "WS8 compile receipt does not pass");
  for (const [id, file] of shaderPaths) {
    assert(compileReceipt.sources?.[`${id}ShaderSha256`] === sha256File(file),
      `WS8 compile receipt is stale for ${id}`);
  }
  assert(compileReceipt.sources?.commonIncludeSha256
      === sha256File(path.join(shaderDir, "cgb001-common.inc"))
    && compileReceipt.sources?.runtimeIncludeSha256 === sha256(runtimeInclude),
  "WS8 compile receipt is stale for shared includes");
} else {
  compileReceipt = compileShaders();
  output(compileRelative, jsonBuffer(compileReceipt));
}
const compileBuffer = fs.readFileSync(path.join(root, compileRelative));

const shaderHashes = Object.fromEntries([
  ...[...shaderPaths].map(([_id, file]) => [`shaders/${path.basename(file)}`, sha256File(file)]),
  ["shaders/cgb001-common.inc", sha256File(path.join(shaderDir, "cgb001-common.inc"))],
  ["shaders/cgb001-runtime-v1.inc", sha256(runtimeInclude)],
]);
const sourceRecords = [
  "data/reconstruction-v1.json",
  "data/hcs-source-v1.json",
  "data/color-reference-v1.json",
  "data/scan-candidates-v1.json",
  "data/response-ensemble-v1.json",
  "data/ws5-exposure-policy-v1.json",
  "data/aperture-v1.json",
  "data/retention-v1.json",
  "generated/cgb001-d65-lut-v1.rgba32f",
  "generated/cgb001-ws4-gtg-rates-v1.r32f",
];
const manifest = {
  schemaVersion: 1,
  manifestId: "cgb001-ws8-shader-preset-manifest-v1",
  modelId: model.id,
  modelVersion: model.modelVersion,
  generatedBy: "tools/build-cgb001-ws8.mjs",
  referenceCondition: {
    illuminant: "CIE D65",
    illuminationAngleDegrees: 45,
    viewAngleDegrees: 0,
    runtimeAngleModel: false,
  },
  passes: [
    { index: 0, id: "response", format: "R32G32B32A32_SFLOAT", persistentFeedback: true },
    { index: 1, id: "color", format: "R32G32B32A32_SFLOAT", persistentFeedback: false },
    { index: 2, id: "display", format: "frontend swapchain", persistentFeedback: false },
  ],
  shaderHashes,
  presetHashes,
  textureHashes: {
    "generated/cgb001-reference-d65-v1.png": sha256(referenceTexture.png),
    "generated/cgb001-hcs-upstream-d65-v1.png": sha256(upstreamTexture.png),
    "generated/cgb001-reference-d65-v1-hi-rgba8.png": sha256(referencePlanes.high),
    "generated/cgb001-reference-d65-v1-lo-rgba8.png": sha256(referencePlanes.low),
    "generated/cgb001-hcs-upstream-d65-v1-hi-rgba8.png": sha256(upstreamPlanes.high),
    "generated/cgb001-hcs-upstream-d65-v1-lo-rgba8.png": sha256(upstreamPlanes.low),
    "generated/cgb001-d65-lut-v1.rgba32f": sha256(referenceRaw),
    "generated/cgb001-ws4-gtg-rates-v1.r32f": sha256(rateRaw),
  },
  sourceRecordHashes: Object.fromEntries(sourceRecords.map((relative) => [
    relative, sha256File(path.join(modelDir, relative)),
  ])),
  compileReceipt: {
    path: "generated/ws8-shader-compile-v1.json",
    sha256: sha256(compileBuffer),
    stagesPassed: compileReceipt.summary.stages,
  },
  diagnostics: {
    views: ["source-code", "row-phase", "response-state", "exposure", "lut-output", "residual-state", "aperture-coverage"],
    stateAffectingParametersEqualReference: true,
    debugViewReadOnlyInResponseAndColorPasses: true,
    settledWs1ColorMutation: false,
  },
  validation: {
    referenceTextureMaximumIntegerXyzQuantizationError: clean(referenceTexture.maximumAbsoluteError),
    upstreamTextureMaximumIntegerXyzQuantizationError: clean(upstreamTexture.maximumAbsoluteError),
    shaderRateMaximumFloat32DifferenceAcross9216Cells: clean(maximumPackedRateDifference),
    completePresetCount: presetDefinitions.size,
    thinReferencePresets: 0,
    pass: true,
  },
  ws9RequiredChecks: [
    "actual GPU numeric readback",
    "runtime texture upload precision and filtering (the later WS9 target probe selected paired RGBA8 high/low planes)",
    "RGBA32F response/color render-target allocation",
    "frontend reset/pause/load/rewind lifecycle",
    "KONKR performance and frame pacing",
  ],
};
const manifestRelative = `${modelRelative}/generated/ws8-manifest-v1.json`;
const manifestBuffer = jsonBuffer(manifest);
output(manifestRelative, manifestBuffer);

const receiptInputs = [
  `${modelRelative}/model.json`,
  `${modelRelative}/data/reconstruction-v1.json`,
  `${modelRelative}/data/color-reference-v1.json`,
  `${modelRelative}/data/scan-candidates-v1.json`,
  `${modelRelative}/data/response-ensemble-v1.json`,
  `${modelRelative}/data/ws5-exposure-policy-v1.json`,
  `${modelRelative}/data/aperture-v1.json`,
  `${modelRelative}/data/retention-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.r32f`,
];
const receiptOutputs = [
  referenceTextureRelative,
  upstreamTextureRelative,
  referenceHighRelative,
  referenceLowRelative,
  upstreamHighRelative,
  upstreamLowRelative,
  textureDescriptorRelative,
  runtimeIncludeRelative,
  compileRelative,
  manifestRelative,
  ...[...presetDefinitions.keys()].map((name) => `${modelRelative}/presets/${name}`),
  ...[...shaderPaths.values()].map((file) => path.relative(root, file)),
  `${modelRelative}/shaders/cgb001-common.inc`,
];
const receipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws8-receipt-v1",
  modelId: model.id,
  generatedBy: "tools/build-cgb001-ws8.mjs",
  trackedInputHashes: Object.fromEntries(receiptInputs.map((relative) => [relative, sha256File(path.join(root, relative))])),
  outputHashes: Object.fromEntries(receiptOutputs.sort().map((relative) => [relative, sha256File(path.join(root, relative))])),
  gates: {
    ws1ThroughWs7Complete: true,
    authoritativeFloatArtifactsRetained: true,
    shaderStagesCompileAndValidate: compileReceipt.summary.pass,
    intendedFloatFormatsDeclared: true,
    requiredCompletePresetsPresent: presetDefinitions.size === 15,
    viewingAngleControlAbsent: true,
    diagnosticsReadOnlyWithReferenceStateParameters: true,
    settledWs1ColorUnmodified: true,
    actualGpuReadbackDeferredToWs9: true,
  },
  result: {
    status: "pass",
    ws8Complete: true,
    ws9Eligible: true,
    referenceV1ReleaseDefaultAllowed: false,
  },
  limits: "WS8 integrates and compiles the evidence-bounded Shader/preset graph. It is not actual GPU readback, frontend lifecycle validation, a measured CGB response waveform, or KONKR target acceptance; those remain WS9.",
};
const receiptRelative = `${modelRelative}/generated/ws8-receipt-v1.json`;
output(receiptRelative, jsonBuffer(receipt));

console.log(checkOnly
  ? "CGB-001 WS8 integration artifacts are current."
  : `Wrote CGB-001 WS8 integration: ${presetDefinitions.size} complete presets and six validated SPIR-V stages.`);
