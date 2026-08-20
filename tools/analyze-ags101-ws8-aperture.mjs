#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { decodePng } from "./decode-ags101-ws5-readback.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const referenceFile = argument("--reference");
const exactFile = argument("--exact4");
const fractionalFile = argument("--fractional3_5");
const outputFile = argument("--output");
if (!referenceFile || !exactFile || !fractionalFile) {
  throw new Error("usage: node tools/analyze-ags101-ws8-aperture.mjs --reference reference.json --exact4 capture.png --fractional3_5 capture.png [--output report.json]");
}

const reference = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
const aperture = reference.apertureEnergy;
if (!aperture || aperture.debugView !== 14) throw new Error("reference has no WS8 DebugView 14 aperture fixture");

function srgbDecode8(value) {
  const encoded = value / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function analyze(file, scale, viewport) {
  const buffer = fs.readFileSync(file);
  const image = decodePng(file);
  if (image.width !== 960 || image.height !== 640) {
    throw new Error(`expected 960x640 KONKR capture, got ${image.width}x${image.height}`);
  }
  const sums = [0, 0, 0];
  for (let y = viewport.y; y < viewport.y + viewport.height; y += 1) {
    for (let x = viewport.x; x < viewport.x + viewport.width; x += 1) {
      const offset = y * image.stride + x * image.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        sums[channel] += srgbDecode8(image.pixels[offset + channel]) / aperture.encodedLinearScale;
      }
    }
  }
  const count = viewport.width * viewport.height;
  const meanRgbLinear = sums.map((sum) => sum / count);
  const expected = aperture.expectedByScale[String(scale)];
  const absoluteError = meanRgbLinear.map((value, channel) => Math.abs(value - expected[channel]));
  return {
    file: path.relative(process.cwd(), file),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    viewport,
    scale,
    meanRgbLinear,
    expectedCpuMeanRgbLinear: expected,
    absoluteError,
    maximumAbsoluteError: Math.max(...absoluteError),
  };
}

const exact = analyze(exactFile, 4, { x: 0, y: 0, width: 960, height: 640 });
const fractional = analyze(fractionalFile, 3.5, { x: 60, y: 40, width: 840, height: 560 });
const scaleDifference = exact.meanRgbLinear.map(
  (value, channel) => Math.abs(value - fractional.meanRgbLinear[channel]),
);
const maximumCpuError = Math.max(exact.maximumAbsoluteError, fractional.maximumAbsoluteError);
const maximumScaleDifference = Math.max(...scaleDifference);
const tolerance = aperture.screenshotComparisonTolerance;
const report = {
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws8-konkr-aperture-energy-v1",
  classification: "target-gpu-aperture-equation-and-scale-validation-not-panel-measurement",
  comparison: "DebugView 14 quarter-linear aperture energy at exact 4x and centered fractional 3.5x versus the CPU equation",
  reference: referenceFile,
  exact,
  fractional,
  scaleDifference,
  maximumCpuError,
  maximumScaleDifference,
  tolerance,
  pass: maximumCpuError <= tolerance && maximumScaleDifference <= tolerance,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) fs.writeFileSync(outputFile, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
