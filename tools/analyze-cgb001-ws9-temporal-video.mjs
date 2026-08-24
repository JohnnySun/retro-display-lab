#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeReadbackPng } from "./decode-cgb001-ws9-readback.mjs";
import { integrateScannedFrame } from "../models/nintendo-cgb-001/reference/reflected-exposure.mjs";
import { CGB_FRAME_SECONDS, CGB_LINE_SECONDS } from "../models/nintendo-cgb-001/reference/scan-drive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const outputIndex = args.indexOf("--output");
const mode = modeIndex >= 0 ? args[modeIndex + 1] : null;
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const ignored = new Set([modeIndex, modeIndex + 1, outputIndex, outputIndex + 1]);
const frameDir = args.find((_arg, index) => !ignored.has(index));
if (!frameDir || !["response", "retention", "exposure"].includes(mode)) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-temporal-video.mjs --mode response|retention|exposure FRAME_DIRECTORY [--output report.json]");
}

const f32 = Math.fround;
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const LN9 = f32(Math.log(9));
const SNAP = f32(1 / 65536);
const responseMembers = [
  [50, 80],
  [65, 115],
  [80, 150],
];
const [ON_OFF_MS, GRAY_MS] = responseMembers[1];
const ADSORPTION = f32(0.0635 / 60);
const DESORPTION = f32(0.0255 / 60);
const rateBuffer = fs.readFileSync(path.join(root, "models/nintendo-cgb-001/generated/cgb001-ws4-gtg-rates-v1.r32f"));
const lutBuffer = fs.readFileSync(path.join(root, "models/nintendo-cgb-001/generated/cgb001-d65-lut-v1.rgba32f"));

function responseRate(state, targetCode) {
  const fromCode = Math.floor(clamp(state) * 31 + 0.5);
  const distance = Math.abs(targetCode - fromCode) / 31;
  const grayWeight = clamp(((1 - distance) / (30 / 31)) ** 2);
  const milliseconds = ON_OFF_MS + (GRAY_MS - ON_OFF_MS) * grayWeight;
  return f32(LN9 / f32(0.001 * milliseconds));
}

function stepChannel(state, targetCode, seconds) {
  const start = f32(clamp(state));
  const target = f32(targetCode / 31);
  const rate = responseRate(start, targetCode);
  const duration = f32(Math.max(0, seconds));
  const decay = f32(Math.exp(f32(-f32(rate * duration))));
  const next = f32(target + f32(f32(start - target) * decay));
  return Math.abs(f32(next - target)) <= SNAP ? target : f32(clamp(next));
}

function predictResponse(start, previousCode, currentCode, row) {
  const activation = clamp(row * CGB_LINE_SECONDS, 0, CGB_FRAME_SECONDS);
  return start.map((value, channel) => {
    if (previousCode[channel] === currentCode[channel]) {
      return stepChannel(value, currentCode[channel], CGB_FRAME_SECONDS);
    }
    const split = stepChannel(value, previousCode[channel], activation);
    return stepChannel(split, currentCode[channel], CGB_FRAME_SECONDS - activation);
  });
}

function polarity(frameCount, x, y) {
  return ((frameCount + (y & 1)) & 1) === 0 ? 1 : -1;
}

function excitation(sourceCode, sign) {
  const proxy = (sourceCode[0] + sourceCode[1] + sourceCode[2]) / (3 * 31);
  return f32(clamp(0.1 * (1 + 0.5 * (2 * proxy - 1) + 0.25 * sign), -1, 1));
}

function stepResidual(state, target, seconds) {
  const current = f32(clamp(f32(state), -1, 1));
  const drive = f32(clamp(f32(target), -1, 1));
  const duration = f32(Math.max(0, f32(seconds)));
  if (Math.abs(drive) <= 1e-8) {
    return f32(clamp(f32(current * f32(Math.exp(f32(-DESORPTION * duration)))), -1, 1));
  }
  const rate = f32(ADSORPTION + DESORPTION);
  const equilibrium = f32(f32(ADSORPTION * drive) / rate);
  return f32(clamp(f32(equilibrium + f32(f32(current - equilibrium)
    * f32(Math.exp(f32(-rate * duration))))), -1, 1));
}

function predictResidual(state, previousCode, currentCode, frameCount, x, y) {
  const latch = clamp(y * CGB_LINE_SECONDS, 0, CGB_FRAME_SECONDS);
  const sign = polarity(frameCount, x, y);
  const first = stepResidual(state, excitation(previousCode, sign), latch);
  return stepResidual(first, excitation(currentCode, sign), CGB_FRAME_SECONDS - latch);
}

const framePaths = fs.readdirSync(frameDir)
  .filter((name) => name.toLowerCase().endsWith(".png"))
  .sort()
  .map((name) => path.join(frameDir, name));
if (!framePaths.length) throw new Error(`no PNG frames found in ${frameDir}`);

let previous = null;
let adjacentFramePairs = 0;
let comparedResponseComponents = 0;
let comparedExposureComponents = 0;
let comparedResiduals = 0;
let maxResponseError = 0;
let maxExposureError = 0;
let maxResidualError = 0;
let invalidTileCount = 0;
let nonFiniteCount = 0;
let minimumUnanimousBits = 32;
let firstFrameCount = null;
let lastFrameCount = null;

for (const file of framePaths) {
  const decoded = decodeReadbackPng(file, mode);
  const validTiles = new Map();
  for (const tile of decoded.tiles) {
    minimumUnanimousBits = Math.min(minimumUnanimousBits, ...tile.unanimousBits);
    if (!tile.valid) {
      invalidTileCount += 1;
      continue;
    }
    const numeric = mode === "exposure"
      ? [...tile.exposureXyz, ...tile.response]
      : [...tile.response, tile.residualDc];
    if (!numeric.every(Number.isFinite)) {
      nonFiniteCount += 1;
      continue;
    }
    validTiles.set(tile.slot, tile);
  }
  const representative = validTiles.get(0);
  if (!representative) continue;
  firstFrameCount ??= representative.frameCount;
  lastFrameCount = representative.frameCount;
  if (previous) {
    const previousRepresentative = previous.get(0);
    if (previousRepresentative && representative.frameCount === previousRepresentative.frameCount + 1) {
      adjacentFramePairs += 1;
      for (const [slot, tile] of validTiles) {
        const prior = previous.get(slot);
        if (!prior || prior.frameCount + 1 !== tile.frameCount) continue;
        const [x, y] = tile.probeSource;
        const expectedResponse = predictResponse(
          prior.response,
          prior.sourceRgb555,
          tile.sourceRgb555,
          y,
        );
        for (let channel = 0; channel < 3; channel += 1) {
          maxResponseError = Math.max(maxResponseError,
            Math.abs(expectedResponse[channel] - tile.response[channel]));
          comparedResponseComponents += 1;
        }
        if (mode === "retention") {
          const expectedResidual = predictResidual(
            prior.residualDc,
            prior.sourceRgb555,
            tile.sourceRgb555,
            tile.frameCount,
            x,
            y,
          );
          maxResidualError = Math.max(maxResidualError, Math.abs(expectedResidual - tile.residualDc));
          comparedResiduals += 1;
        } else if (mode === "response") {
          maxResidualError = Math.max(maxResidualError, Math.abs(tile.residualDc));
          comparedResiduals += 1;
        } else {
          const expectedExposure = integrateScannedFrame({
            lutBuffer,
            rateBuffer,
            memberIndex: 1,
            initialState: prior.response,
            previousRgb555: prior.sourceRgb555,
            currentRgb555: tile.sourceRgb555,
            row: y,
            method: "gauss-float32",
            panels: 32,
            order: 2,
          }).averageXyz;
          for (let component = 0; component < 3; component += 1) {
            maxExposureError = Math.max(maxExposureError,
              Math.abs(expectedExposure[component] - tile.exposureXyz[component]));
            comparedExposureComponents += 1;
          }
        }
      }
    }
  }
  previous = validTiles;
}

const responseTolerance = 0.000003;
const exposureTolerance = 0.00004;
const residualTolerance = mode === "retention" ? 0.0000005 : 0;
const report = {
  schemaVersion: 1,
  reportId: `cgb001-ws9-gpu-${mode}-sequence-v1`,
  classification: "KONKR-Mali-G76-float-bit-video-readback-versus-CPU-float32-recurrence",
  mode,
  frames: {
    directory: path.relative(root, frameDir),
    decodedFrames: framePaths.length,
    firstShaderFrameCount: firstFrameCount,
    lastShaderFrameCount: lastFrameCount,
    adjacentFramePairs,
  },
  decoded: { invalidTileCount, nonFiniteCount, minimumUnanimousBitsPerWord: minimumUnanimousBits },
  comparison: {
    comparedResponseComponents,
    maximumResponseAbsoluteError: maxResponseError,
    responseTolerance,
    comparedExposureComponents,
    maximumExposureAbsoluteXyzError: mode === "exposure" ? maxExposureError : null,
    exposureTolerance: mode === "exposure" ? exposureTolerance : null,
    comparedResiduals,
    maximumResidualAbsoluteError: mode === "exposure" ? null : maxResidualError,
    residualTolerance: mode === "exposure" ? null : residualTolerance,
  },
  pass: adjacentFramePairs >= 30
    && invalidTileCount === 0
    && nonFiniteCount === 0
    && comparedResponseComponents > 0
    && maxResponseError <= responseTolerance
    && (mode !== "exposure" || (comparedExposureComponents > 0 && maxExposureError <= exposureTolerance))
    && (mode === "exposure" || (comparedResiduals > 0 && maxResidualError <= residualTolerance)),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
