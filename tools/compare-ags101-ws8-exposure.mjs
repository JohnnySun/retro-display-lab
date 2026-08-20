#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { decodePng } from "./decode-ags101-ws5-readback.mjs";
import { decodeExposureBands } from "./decode-ags101-ws8-exposure.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const outputFile = argument("--output");
const positional = process.argv.slice(2).filter((value, index, values) => (
  value !== "--output" && values[index - 1] !== "--output"
));
const [referenceFile, ...captureFiles] = positional;
if (!referenceFile || captureFiles.length < 2) {
  throw new Error("usage: node tools/compare-ags101-ws8-exposure.mjs reference.json capture.png [...] [--output report.json]");
}
const reference = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
const tolerance = reference.gpuComparisonTolerance;
const captures = captureFiles.map((file) => {
  const decoded = decodeExposureBands(decodePng(file));
  const key = decoded.targetRgb555.join(",");
  const expected = reference.expectedByPackedTarget[key];
  const absoluteError = expected
    ? decoded.exposure.map((value, channel) => Math.abs(value - expected.average[channel]))
    : [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return {
    file,
    scale: decoded.scale,
    exposure: decoded.exposure,
    exposureWords: decoded.exposureWords,
    frameCount: decoded.frameCount,
    frameCountWord: decoded.frameCountWord,
    packedTargetWord: decoded.packedTargetWord,
    targetRgb555: decoded.targetRgb555,
    unanimousBitsPerBand: decoded.confidence.map((entry) => entry.unanimousBits),
    expected: expected?.average ?? null,
    absoluteError,
    maximumAbsoluteError: Math.max(...absoluteError),
    allBitsUnanimous: decoded.confidence.every((entry) => entry.unanimousBits === 32),
  };
});
const targetKeys = new Set(captures.map((capture) => capture.targetRgb555.join(",")));
const expectedTargetKeys = new Set(Object.keys(reference.expectedByPackedTarget ?? {}));
const maximumAbsoluteError = Math.max(...captures.map((capture) => capture.maximumAbsoluteError));
const pass = maximumAbsoluteError <= tolerance
  && captures.every((capture) => capture.allBitsUnanimous)
  && expectedTargetKeys.size === 2
  && [...expectedTargetKeys].every((key) => targetKeys.has(key));
const report = {
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws8-konkr-exposure-gpu-v1",
  comparison: "WS8 DebugView 13 target GPU exposure floats versus packed-rate CPU alternating-cycle reference",
  reference: referenceFile,
  captures,
  coveredTargets: [...targetKeys].sort(),
  expectedTargets: [...expectedTargetKeys].sort(),
  maximumAbsoluteError,
  tolerance,
  pass,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) fs.writeFileSync(outputFile, serialized);
process.stdout.write(serialized);
if (!pass) process.exitCode = 1;
