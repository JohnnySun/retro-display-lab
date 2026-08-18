#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const inputFlag = process.argv.indexOf("--input-dir");
const outputFlag = process.argv.indexOf("--output");
const fpsFlag = process.argv.indexOf("--sample-fps");
const inputDir = inputFlag >= 0 ? path.resolve(process.argv[inputFlag + 1]) : null;
const outputPath = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : null;
const sampleFps = fpsFlag >= 0 ? Number(process.argv[fpsFlag + 1]) : 2;
if (!inputDir || !Number.isFinite(sampleFps) || sampleFps <= 0) {
  console.error("usage: node tools/analyze-dmg01-retention-captures.mjs --input-dir <png-dir> [--sample-fps 2] [--output <json>]");
  process.exit(1);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("invalid PNG signature");
  let offset = 8;
  let header;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (!header || header.bitDepth !== 8 || ![2, 6].includes(header.colorType)
      || header.interlace !== 0) {
    throw new Error("analyzer supports non-interlaced 8-bit RGB/RGBA PNG only");
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = [];
  let inputOffset = 0;
  let prior = Buffer.alloc(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[inputOffset++];
    const encoded = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] ?? 0;
      const upperLeft = x >= channels ? prior[x - channels] : 0;
      if (filter === 0) row[x] = encoded[x];
      else if (filter === 1) row[x] = (encoded[x] + left) & 0xff;
      else if (filter === 2) row[x] = (encoded[x] + up) & 0xff;
      else if (filter === 3) row[x] = (encoded[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (encoded[x] + paeth(left, up, upperLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    prior = row;
  }
  return {
    ...header,
    rgb(x, y) {
      const start = x * channels;
      return [rows[y][start], rows[y][start + 1], rows[y][start + 2]];
    },
  };
}

function regionMean(image, region) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = region.y0; y < region.y1; y += 8) {
    for (let x = region.x0; x < region.x1; x += 8) {
      const rgb = image.rgb(x, y);
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += rgb[channel];
      count += 1;
    }
  }
  return sums.map((sum) => sum / count / 255);
}

const files = fs.readdirSync(inputDir).filter((name) => name.endsWith(".png")).sort();
if (files.length < sampleFps * 35) throw new Error("capture set is too short for a 30 s charge plus release sequence");
const viewport = { x: 160, y: 32, width: 640, height: 576 };
const chargedRegion = { x0: 224, x1: 432, y0: 96, y1: 544 };
const controlRegion = { x0: 528, x1: 736, y0: 96, y1: 544 };
const frames = files.map((name, index) => {
  const buffer = fs.readFileSync(path.join(inputDir, name));
  const image = decodePng(buffer);
  if (image.width !== 960 || image.height !== 640) {
    throw new Error(`expected 960x640 capture, got ${image.width}x${image.height}`);
  }
  const charged = regionMean(image, chargedRegion);
  const control = regionMean(image, controlRegion);
  return {
    name,
    seconds: index / sampleFps,
    charge: charged[0],
    drive: charged[1],
    residual: charged[2],
    controlMaximum: Math.max(...control),
  };
});

const phases = [];
for (const frame of frames) {
  const phase = frame.drive >= 0.5 ? "charge" : "release";
  const current = phases.at(-1);
  if (!current || current.phase !== phase) phases.push({ phase, frames: [frame] });
  else current.frames.push(frame);
}
const chargePhase = phases.filter((phase) => phase.phase === "charge")
  .sort((a, b) => b.frames.length - a.frames.length)[0];
const releasePhase = phases.filter((phase) => phase.phase === "release")
  .sort((a, b) => b.frames.length - a.frames.length)[0];
if (!chargePhase || !releasePhase) throw new Error("did not observe both drive phases");

const releaseStart = releasePhase.frames[0];
const releaseEnd = releasePhase.frames.at(-1);
const releaseElapsed = releaseEnd.seconds - releaseStart.seconds;
const observedReleaseRatio = releaseEnd.charge / releaseStart.charge;
const releaseRatePerSecond = 0.000425;
const acceleratedTimeScale = 60;
const expectedReleaseRatio = Math.exp(-releaseRatePerSecond * releaseElapsed * acceleratedTimeScale);
const chargeMonotoneViolations = chargePhase.frames.slice(1).filter(
  (frame, index) => frame.charge + 0.025 < chargePhase.frames[index].charge,
).length;
const releaseMonotoneViolations = releasePhase.frames.slice(1).filter(
  (frame, index) => frame.charge > releasePhase.frames[index].charge + 0.025,
).length;
const acceptedSequence = frames.filter((frame) => (
  frame.seconds >= chargePhase.frames[0].seconds
  && frame.seconds <= releasePhase.frames.at(-1).seconds
));
const maximumControl = Math.max(...acceptedSequence.map((frame) => frame.controlMaximum));
const checks = {
  observedChargeAndReleasePhases: chargePhase.frames.length >= sampleFps * 20
    && releasePhase.frames.length >= sampleFps * 10,
  chargedStateConverged: Math.max(...chargePhase.frames.map((frame) => frame.charge)) >= 0.95,
  chargedDriveReachedFullScale: Math.max(...chargePhase.frames.map((frame) => frame.drive)) >= 0.95,
  releasedDriveReachedZero: Math.max(...releasePhase.frames.map((frame) => frame.drive)) <= 0.05,
  positiveResidualAfterDriveRemoval: releaseStart.residual >= 0.90,
  chargeMonotoneWithinCaptureTolerance: chargeMonotoneViolations === 0,
  releaseMonotoneWithinCaptureTolerance: releaseMonotoneViolations === 0,
  releaseRatioMatchesReconstruction: Math.abs(observedReleaseRatio - expectedReleaseRatio) <= 0.05,
  inactiveControlStayedLow: maximumControl <= 0.05,
};

const clean = (value) => Number(value.toFixed(9));
const report = {
  schemaVersion: 1,
  reportId: "konkr-gt78-vn-dmg01-ws4-gpu-retention-v1",
  source: {
    directory: path.basename(inputDir),
    frames: files.length,
    sampleFps,
    aggregateSha256: crypto.createHash("sha256").update(files.map((name) => (
      fs.readFileSync(path.join(inputDir, name))
    )).reduce((all, buffer) => Buffer.concat([all, buffer]), Buffer.alloc(0))).digest("hex"),
  },
  viewport,
  diagnosticChannels: { red: "ionic charge", green: "current drive", blue: "positive residual" },
  phases: phases.map((phase) => ({
    phase: phase.phase,
    firstSecond: clean(phase.frames[0].seconds),
    lastSecond: clean(phase.frames.at(-1).seconds),
    frames: phase.frames.length,
  })),
  measurements: {
    maximumCharge: clean(Math.max(...chargePhase.frames.map((frame) => frame.charge))),
    releaseStartCharge: clean(releaseStart.charge),
    releaseEndCharge: clean(releaseEnd.charge),
    releaseElapsedRealSeconds: clean(releaseElapsed),
    releaseElapsedEquivalentSeconds: clean(releaseElapsed * acceleratedTimeScale),
    observedReleaseRatio: clean(observedReleaseRatio),
    expectedReleaseRatio: clean(expectedReleaseRatio),
    absoluteReleaseRatioError: clean(Math.abs(observedReleaseRatio - expectedReleaseRatio)),
    maximumControl: clean(maximumControl),
    chargeMonotoneViolations,
    releaseMonotoneViolations,
  },
  validation: { ...checks, pass: Object.values(checks).every(Boolean) },
  limits: [
    "H.264 screen recording and the RGB565 swapchain quantize the diagnostic channels; the acceptance tolerance includes both effects.",
    "The accelerated run validates the exact rate transformation and GPU feedback trajectory; it does not turn the reconstructed kinetics into a direct DMG measurement.",
  ],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.validation.pass) process.exit(1);
