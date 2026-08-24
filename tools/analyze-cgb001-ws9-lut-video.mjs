#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeReadbackPng } from "./decode-cgb001-ws9-readback.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const frameDir = args.find((arg, index) => index !== outputIndex && index !== outputIndex + 1);
if (!frameDir) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-lut-video.mjs FRAME_DIRECTORY [--output report.json]");
}

const lutPath = path.join(root, "models/nintendo-cgb-001/generated/cgb001-d65-lut-v1.rgba32f");
const lut = fs.readFileSync(lutPath);
const frames = fs.readdirSync(frameDir)
  .filter((name) => name.toLowerCase().endsWith(".png"))
  .sort()
  .map((name) => path.join(frameDir, name));
if (!frames.length) throw new Error(`no PNG frames found in ${frameDir}`);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const observed = new Map();
let invalidTileCount = 0;
let nonFiniteCount = 0;
let minimumUnanimousBits = 32;
const frameCounts = new Set();

for (const file of frames) {
  const decoded = decodeReadbackPng(file, "lut");
  for (const tile of decoded.tiles) {
    minimumUnanimousBits = Math.min(minimumUnanimousBits, ...tile.unanimousBits.slice(0, 6));
    if (!tile.valid) {
      if (tile.slot < 32) invalidTileCount += 1;
      continue;
    }
    frameCounts.add(tile.frameCount);
    if (!tile.xyz.every(Number.isFinite)) {
      nonFiniteCount += 1;
      continue;
    }
    const [r, g, b] = tile.sourceRgb555;
    const index = (b * 32 + g) * 32 + r;
    if (!observed.has(index)) observed.set(index, tile.xyz);
  }
}

let maximumAbsoluteXyzError = 0;
let errorSum = 0;
let componentCount = 0;
let worst = null;
for (const [index, xyz] of observed) {
  const expected = [0, 1, 2].map((component) => lut.readFloatLE(index * 16 + component * 4));
  for (let component = 0; component < 3; component += 1) {
    const error = Math.abs(xyz[component] - expected[component]);
    errorSum += error;
    componentCount += 1;
    if (error > maximumAbsoluteXyzError) {
      maximumAbsoluteXyzError = error;
      const b = Math.floor(index / (32 * 32));
      const g = Math.floor(index / 32) % 32;
      const r = index % 32;
      worst = { rgb555: [r, g, b], component, expected: expected[component], actual: xyz[component], error };
    }
  }
}

const tolerance = 0.0000085;
const report = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-gpu-all-rgb555-lut-readback-v1",
  classification: "KONKR-Mali-G76-paired-RGBA8-uint16-reconstruction-and-float-target-readback",
  sourceFrames: {
    directory: path.relative(root, frameDir),
    frameCount: frames.length,
    distinctShaderFrameCounts: frameCounts.size,
  },
  authoritativeLut: {
    path: path.relative(root, lutPath),
    sha256: sha256(lut),
    codes: 32768,
  },
  decoded: {
    uniqueRgb555Codes: observed.size,
    components: componentCount,
    invalidTileCount,
    nonFiniteCount,
    minimumUnanimousBitsPerWord: minimumUnanimousBits,
  },
  comparison: {
    maximumAbsoluteXyzError,
    meanAbsoluteXyzError: componentCount ? errorSum / componentCount : null,
    tolerance,
    worst,
  },
  pass: observed.size === 32768
    && invalidTileCount === 0
    && nonFiniteCount === 0
    && maximumAbsoluteXyzError <= tolerance,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
