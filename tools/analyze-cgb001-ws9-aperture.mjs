#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeReadbackPng } from "./decode-cgb001-ws9-readback.mjs";
import { rgbStripeCoverage } from "../models/nintendo-cgb-001/reference/rgb-aperture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const screenshot = args.find((_arg, index) => index !== outputIndex && index !== outputIndex + 1);
if (!screenshot) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-aperture.mjs screenshot.png [--output report.json]");
}

const decoded = decodeReadbackPng(screenshot, "aperture");
const byPhase = new Map();
let invalidTileCount = 0;
let minimumUnanimousBits = 32;
for (const tile of decoded.tiles) {
  minimumUnanimousBits = Math.min(minimumUnanimousBits, ...tile.unanimousBits.slice(0, 6));
  if (!tile.valid) {
    invalidTileCount += 1;
    continue;
  }
  if (!byPhase.has(tile.phase)) byPhase.set(tile.phase, tile);
}

let maximumCoverageError = 0;
const phases = [...byPhase].sort(([a], [b]) => a - b).map(([phase, tile]) => {
  const hostIndex = Math.floor(tile.scaleX * 80) + phase;
  const sourceCenter = (hostIndex + 0.5) / tile.scaleX - 0.5;
  const expected = rgbStripeCoverage({
    sourceX: sourceCenter,
    hostPixelsPerSourcePixel: tile.scaleX,
  }).channels.map((value) => 3 * value);
  const errors = expected.map((value, channel) => Math.abs(value - tile.coverage[channel]));
  maximumCoverageError = Math.max(maximumCoverageError, ...errors);
  return {
    phase,
    scaleX: tile.scaleX,
    outputWidth: tile.outputWidth,
    sourceWidth: tile.sourceWidth,
    sourceCenter,
    expected,
    actual: tile.coverage,
    errors,
  };
});

const tolerance = 0.000002;
const viewportContract = phases.length > 0
  && phases.every((item) => item.scaleX === 4 && item.outputWidth === 640 && item.sourceWidth === 160);
const report = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-gpu-aperture-coverage-v1",
  classification: "KONKR-Mali-G76-float-bit-readback-of-analytic-host-footprint-coverage",
  screenshot: path.relative(root, screenshot),
  decodedViewport: decoded.viewport,
  decoded: { invalidTileCount, minimumUnanimousBitsPerWord: minimumUnanimousBits },
  phases,
  comparison: { maximumCoverageError, tolerance },
  viewportContract: {
    requiredContentViewport: [640, 576],
    requiredScale: 4,
    shaderReportedOutputWidth: phases[0]?.outputWidth ?? null,
    shaderReportedSourceWidth: phases[0]?.sourceWidth ?? null,
    pass: viewportContract,
  },
  pass: invalidTileCount === 0
    && phases.length >= 4
    && viewportContract
    && maximumCoverageError <= tolerance,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
