#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  GTG_CHANNELS,
  GTG_FRAME_SECONDS,
  decodeRate16,
  encodeRate16,
  stepFirstOrder,
} from "../models/nintendo-ags-101/reference/gtg-response.mjs";
import {
  WS4_ENSEMBLE_VERSION,
  WS4_EQUATION_ID,
  buildReconstructedCells,
  reconstructedTransition,
  validateEnsembleDefinition,
} from "../models/nintendo-ags-101/reference/gtg-ensemble.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const dataDir = path.join(modelDir, "data");
const generatedDir = path.join(modelDir, "generated");
const presetDir = path.join(generatedDir, "ws4-presets-v1");
const evidencePath = path.join(dataDir, "ws4-evidence-inventory-v1.json");
const ensemblePath = path.join(dataDir, "ws4-gtg-ensemble-v1.json");
const scenePath = path.join(dataDir, "ws2-stimulus-scenes-v1.json");
const ws2ManifestPath = path.join(generatedDir, "ws2-stimulus-v1", "manifest.json");
const basePresetPath = path.join(modelDir, "presets", "period-reconstruction-v1.slangp");
const checkOnly = process.argv.includes("--check");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const jsonBuffer = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function clean(value) {
  if (typeof value === "number") {
    if (Math.abs(value) < 1e-12) return 0;
    return Number(value.toPrecision(10));
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

function writeOrCheck(file, expected) {
  const relative = path.relative(root, file);
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
      throw new Error(`${relative} is missing or stale; run node tools/build-ags101-ws4.mjs`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
    fs.writeFileSync(file, expected);
    process.stdout.write(`Wrote ${relative}.\n`);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodeRgbPng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), rgb.subarray(y * width * 3, (y + 1) * width * 3));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 0 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function packRateTexture(cells) {
  const width = 32;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 3);
  let maxRateRoundTripRelativeError = 0;
  let reconstructedCount = 0;
  let identityAnchorCount = 0;
  const cellMap = new Map(cells.map((cell) => [cell.id, cell]));
  for (let channelIndex = 0; channelIndex < GTG_CHANNELS.length; channelIndex += 1) {
    const channel = GTG_CHANNELS[channelIndex];
    for (let fromCode = 0; fromCode < 32; fromCode += 1) {
      for (let toCode = 0; toCode < 32; toCode += 1) {
        const cell = cellMap.get(`${channel}:${fromCode}>${toCode}`);
        const encoded = encodeRate16(cell.ratePerSecond);
        const offset = ((channelIndex * 32 + fromCode) * width + toCode) * 3;
        pixels[offset] = encoded >>> 8;
        pixels[offset + 1] = encoded & 0xff;
        pixels[offset + 2] = cell.status === "derived-identity-anchor" ? 192 : 255;
        const decoded = decodeRate16(encoded);
        maxRateRoundTripRelativeError = Math.max(
          maxRateRoundTripRelativeError,
          Math.abs(decoded - cell.ratePerSecond) / cell.ratePerSecond,
        );
        if (cell.status === "derived-identity-anchor") identityAnchorCount += 1;
        else reconstructedCount += 1;
      }
    }
  }
  return {
    png: encodeRgbPng(width, height, pixels),
    pixels,
    summary: {
      packedCount: cells.length,
      fallbackCount: 0,
      reconstructedCount,
      identityAnchorCount,
      maxRateRoundTripRelativeError,
    },
  };
}

function shaderFloatStep(value, target, rate, seconds) {
  const f = Math.fround;
  const exponent = f(-f(f(rate) * f(seconds)));
  const alpha = f(1 - f(Math.exp(exponent)));
  return f(f(value) + f(f(target - value) * alpha));
}

function shaderParityReceipt(member, cells) {
  const cellMap = new Map(cells.map((cell) => [cell.id, cell]));
  const vectors = [];
  let maxAbsoluteError = 0;
  for (const channel of GTG_CHANNELS) {
    for (const [fromCode, toCode] of [[0, 31], [31, 0], [0, 1], [15, 16], [16, 15], [30, 31]]) {
      const cell = cellMap.get(`${channel}:${fromCode}>${toCode}`);
      const decodedRate = decodeRate16(encodeRate16(cell.ratePerSecond));
      for (const seconds of [GTG_FRAME_SECONDS / 4, GTG_FRAME_SECONDS, 3 * GTG_FRAME_SECONDS]) {
        const start = fromCode / 31;
        const target = toCode / 31;
        const cpu = stepFirstOrder(start, target, decodedRate, seconds);
        const shaderEquation = shaderFloatStep(start, target, decodedRate, seconds);
        // Float32 exp implementations can differ below the meaningful receipt
        // precision across Node/libm versions. Keep seven significant digits
        // for the error only; the CPU and Shader-equation values remain at the
        // existing ten-digit precision.
        const absoluteError = Number(Math.abs(cpu - shaderEquation).toPrecision(7));
        maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
        vectors.push(clean({ channel, fromCode, toCode, seconds, decodedRate, cpu, shaderEquation, absoluteError }));
      }
    }
  }
  return { member: member.id, vectors, maxAbsoluteError };
}

function comparisonTraces(members, scenes) {
  const gtgScenes = scenes.scenes.filter((scene) => scene.sceneId.startsWith("gtg-"));
  const colors = {
    "gtg-neutral-gate": [1, 1, 1],
    "gtg-red-gate": [1, 0, 0],
    "gtg-green-gate": [0, 1, 0],
    "gtg-blue-gate": [0, 0, 1],
  };
  const frameCount = 12;
  const traces = [];
  for (const member of members) {
    for (const scene of gtgScenes) {
      const target = colors[scene.sceneId];
      const brighteningRate = reconstructedTransition(member, 0, 31).ratePerSecond;
      const darkeningRate = reconstructedTransition(member, 31, 0).ratePerSecond;
      const up = [[0, 0, 0]];
      let upState = [0, 0, 0];
      for (let frame = 1; frame <= frameCount; frame += 1) {
        upState = upState.map((value, channel) => stepFirstOrder(
          value, target[channel], brighteningRate, GTG_FRAME_SECONDS,
        ));
        up.push(upState);
      }
      const down = [target];
      let downState = [...target];
      for (let frame = 1; frame <= frameCount; frame += 1) {
        downState = downState.map((value) => stepFirstOrder(
          value, 0, darkeningRate, GTG_FRAME_SECONDS,
        ));
        down.push(downState);
      }
      traces.push(clean({
        member: member.id,
        sceneId: scene.sceneId,
        sourceDwellFrames: [scene.page0DwellFrames, scene.page1DwellFrames],
        frameSeconds: GTG_FRAME_SECONDS,
        brightening: up,
        darkening: down,
      }));
    }
  }
  return { frameCount, gtgScenes, traces };
}

function renderComparison(comparison) {
  const blockWidth = 8;
  const blockHeight = 10;
  const gap = 4;
  const samplesPerDirection = comparison.frameCount + 1;
  const width = samplesPerDirection * blockWidth * 2 + gap;
  const height = comparison.traces.length * blockHeight;
  const pixels = Buffer.alloc(width * height * 3, 18);
  for (let row = 0; row < comparison.traces.length; row += 1) {
    const trace = comparison.traces[row];
    const samples = [...trace.brightening, ...trace.darkening];
    for (let index = 0; index < samples.length; index += 1) {
      const x0 = index < samplesPerDirection
        ? index * blockWidth
        : samplesPerDirection * blockWidth + gap + (index - samplesPerDirection) * blockWidth;
      const rgb = samples[index].map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
      for (let y = row * blockHeight; y < (row + 1) * blockHeight; y += 1) {
        for (let x = x0; x < x0 + blockWidth; x += 1) {
          const offset = (y * width + x) * 3;
          pixels[offset] = rgb[0];
          pixels[offset + 1] = rgb[1];
          pixels[offset + 2] = rgb[2];
        }
      }
    }
  }
  return { width, height, png: encodeRgbPng(width, height, pixels) };
}

function presetForMember(base, member) {
  return [
    "## Generated by tools/build-ags101-ws4.mjs; do not edit by hand.",
    "## Literature-constrained reconstruction; not an LQ029B1DC01F measurement.",
    `## WS4 ensemble member: ${member.id}.`,
    "",
    base
      .replace(/^GtgRateLut = .*$/m, `GtgRateLut = "../ws4-gtg-${member.id}-v1.png"`)
      .replace(/^GtgTableBackend = .*$/m, 'GtgTableBackend = "1.0"')
      .replace(/^(shader\d+\s*=\s*)"\.\.\/shaders\//gm, '$1"../../shaders/'),
    "",
  ].join("\n");
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const ensemble = JSON.parse(fs.readFileSync(ensemblePath, "utf8"));
const scenes = JSON.parse(fs.readFileSync(scenePath, "utf8"));
const ws2Manifest = JSON.parse(fs.readFileSync(ws2ManifestPath, "utf8"));
const basePreset = fs.readFileSync(basePresetPath, "utf8").trimEnd();
const definitionErrors = validateEnsembleDefinition(ensemble, evidence);
if (definitionErrors.length) throw new Error(definitionErrors.join("\n"));
if (ws2Manifest.source.sha256 !== sha256(fs.readFileSync(scenePath))) {
  throw new Error("WS2 scene source and manifest disagree; WS4 generation is gated");
}

const memberArtifacts = [];
const shaderParity = [];
for (const member of ensemble.members) {
  const cells = buildReconstructedCells(member);
  if (cells.length !== 3_072) throw new Error(`${member.id} did not generate 3x32x32 cells`);
  const packed = packRateTexture(cells);
  const pngName = `ws4-gtg-${member.id}-v1.png`;
  const pngPath = path.join(generatedDir, pngName);
  const manifestPath = path.join(generatedDir, `ws4-gtg-${member.id}-v1.json`);
  const manifest = clean({
    assetVersion: "ags101-gtg-rate-texture-v1",
    ensembleVersion: WS4_ENSEMBLE_VERSION,
    equationId: WS4_EQUATION_ID,
    sourceClassification: ensemble.classification,
    ensembleMember: member,
    evidenceInventory: path.relative(modelDir, evidencePath),
    evidenceInventorySha256: sha256(fs.readFileSync(evidencePath)),
    ensembleDefinition: path.relative(modelDir, ensemblePath),
    ensembleDefinitionSha256: sha256(fs.readFileSync(ensemblePath)),
    texture: {
      file: pngName,
      sha256: sha256(packed.png),
      width: 32,
      height: 96,
      format: "RGB8 PNG",
      addressing: "x=toCode, y=fromCode+32*channelIndex; channelIndex r=0,g=1,b=2",
      rateEncoding: "rate=1*pow(1024,uint16/65535) per second in R/G; B status",
      statusEncoding: "B=255 reconstructed, B=192 derived identity anchor, B=0 fallback",
    },
    coverage: packed.summary,
    provenanceDictionary: {
      reconstructed: {
        equationId: WS4_EQUATION_ID,
        sourceClass: "literature-constrained-reconstruction-not-measured",
        parameterRangeId: "data/ws4-gtg-ensemble-v1.json#parameterRanges",
        ensembleMember: member.id,
        sourceEvidenceIds: member.endpointEvidenceIds,
        fallbackBehavior: ensemble.runtimeModel.fallbackBehavior,
      },
      identityAnchor: {
        equationId: WS4_EQUATION_ID,
        sourceClass: "reconstructed-identity-anchor",
        parameterRangeId: "data/ws4-gtg-ensemble-v1.json#parameterRanges",
        ensembleMember: member.id,
        sourceEvidenceIds: member.endpointEvidenceIds,
        fallbackBehavior: ensemble.runtimeModel.fallbackBehavior,
      },
      measuredCellCount: 0,
    },
    cells: cells.map((cell) => ({
      id: cell.id,
      status: cell.status,
      provenanceId: cell.status === "derived-identity-anchor" ? "identityAnchor" : "reconstructed",
      direction: cell.direction ?? "identity",
      ratePerSecond: cell.ratePerSecond,
      t10To90Ms: cell.t10To90Ms,
    })),
  });
  const manifestBuffer = jsonBuffer(manifest);
  writeOrCheck(pngPath, packed.png);
  writeOrCheck(manifestPath, manifestBuffer);
  const presetName = `ags101-ws4-${member.id}-v1.slangp`;
  const presetBuffer = Buffer.from(presetForMember(basePreset, member));
  writeOrCheck(path.join(presetDir, presetName), presetBuffer);
  shaderParity.push(shaderParityReceipt(member, cells));
  memberArtifacts.push({
    member: member.id,
    texture: { file: `../${pngName}`, sha256: sha256(packed.png) },
    manifest: { file: `../ws4-gtg-${member.id}-v1.json`, sha256: sha256(manifestBuffer) },
    preset: { file: presetName, sha256: sha256(presetBuffer) },
    endpointRatesPerSecond: {
      opticalDarkening: reconstructedTransition(member, 31, 0).ratePerSecond,
      opticalBrightening: reconstructedTransition(member, 0, 31).ratePerSecond,
    },
    coverage: packed.summary,
  });
}

const comparison = comparisonTraces(ensemble.members, scenes);
const comparisonImage = renderComparison(comparison);
const comparisonPngPath = path.join(generatedDir, "ws4-comparison-v1.png");
writeOrCheck(comparisonPngPath, comparisonImage.png);
const comparisonReport = clean({
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws4-comparison-v1",
  classification: "cpu-rendered-reconstruction-comparison-not-device-capture",
  sourceSceneFile: "data/ws2-stimulus-scenes-v1.json",
  sourceSceneSha256: sha256(fs.readFileSync(scenePath)),
  ws2Manifest: "generated/ws2-stimulus-v1/manifest.json",
  ws2ManifestSha256: sha256(fs.readFileSync(ws2ManifestPath)),
  image: {
    file: path.basename(comparisonPngPath),
    sha256: sha256(comparisonImage.png),
    width: comparisonImage.width,
    height: comparisonImage.height,
    layout: "rows are fast/nominal/slow x neutral/red/green/blue scenes; left half brightens, right half darkens; one block per source frame",
  },
  traces: comparison.traces,
});
writeOrCheck(path.join(generatedDir, "ws4-comparison-v1.json"), jsonBuffer(comparisonReport));

const maxShaderEquationError = Math.max(...shaderParity.map((item) => item.maxAbsoluteError));
const validation = clean({
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws4-validation-v1",
  classification: "repository-equation-and-artifact-receipt-not-gpu-readback",
  checks: {
    ws2SceneManifestGate: "passed",
    memberCount: ensemble.members.length,
    cellsPerMember: 3_072,
    measuredCells: 0,
    allCellsHaveEquationSourceRangeMemberAndFallback: true,
    firstOrderScalarEndpointCompatibility: "passed",
    packedRateRoundTripMaximum: Math.max(...memberArtifacts.map((item) => item.coverage.maxRateRoundTripRelativeError)),
    cpuVsShaderFloat32EquationMaximumAbsoluteError: maxShaderEquationError,
    cpuVsShaderFloat32EquationTolerance: 2e-7,
    actualGpuNumericReadback: "not-run; reserved for WS8 target instrumentation",
    syntheticFixtureUsedAsDefault: false,
  },
  shaderParity,
  unresolvedDimensions: {
    exactPanelWaveform: "unsupported",
    channelDifferences: "unsupported-held-neutral",
    temperatureDependence: "unsupported-reference-only-at-25C",
    brightnessModeDependence: "unsupported",
    overshoot: "unsupported-monotone-first-order-selected",
    grayToGrayDistanceMagnitude: "project-prior-range",
  },
});
if (maxShaderEquationError > validation.checks.cpuVsShaderFloat32EquationTolerance) {
  throw new Error(`CPU/shader-equation error ${maxShaderEquationError} exceeds tolerance`);
}
writeOrCheck(path.join(generatedDir, "ws4-validation-v1.json"), jsonBuffer(validation));

const presetManifest = clean({
  schemaVersion: 1,
  manifestId: "nintendo-ags-101-ws4-presets-v1",
  generatedBy: "tools/build-ags101-ws4.mjs",
  classification: ensemble.classification,
  defaultMember: ensemble.defaultMember,
  artifacts: memberArtifacts,
  comparisonReceipt: "../ws4-comparison-v1.json",
  validationReceipt: "../ws4-validation-v1.json",
});
writeOrCheck(path.join(presetDir, "manifest.json"), jsonBuffer(presetManifest));

const coverage = clean({
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws4-coverage-v1",
  generatedCells: 9_216,
  measuredCells: 0,
  reconstructedTransitionCells: memberArtifacts.reduce((sum, item) => sum + item.coverage.reconstructedCount, 0),
  derivedIdentityAnchors: memberArtifacts.reduce((sum, item) => sum + item.coverage.identityAnchorCount, 0),
  runtimeFallbackCells: 0,
  unsupportedDimensions: validation.unresolvedDimensions,
  specimenOverridePath: ensemble.specimenOverride,
  rule: "Complete runtime coverage is generated reconstruction coverage, not measurement coverage.",
});
writeOrCheck(path.join(generatedDir, "ws4-coverage-v1.json"), jsonBuffer(coverage));

process.stdout.write(checkOnly
  ? "AGS-101 WS4 reconstructed GtG ensemble and receipts are current.\n"
  : "AGS-101 WS4 reconstructed GtG ensemble generated.\n");
