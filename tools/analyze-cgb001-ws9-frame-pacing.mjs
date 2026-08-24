#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const inputPath = args.find((_arg, index) => index !== outputIndex && index !== outputIndex + 1);
if (!inputPath) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-frame-pacing.mjs LATENCY.txt [--output report.json]");
}

const lines = fs.readFileSync(inputPath, "utf8").trim().split(/\r?\n/);
const refreshPeriodNs = Number(lines.shift());
const frames = lines
  .map((line) => line.trim().split(/\s+/).map(Number))
  .filter((values) => values.length === 3 && values.every(Number.isFinite) && values[0] < 9e18);
const intervalsMs = frames.slice(1).map((frame, index) => (frame[0] - frames[index][0]) / 1e6);
const sorted = [...intervalsMs].sort((a, b) => a - b);
const percentile = (fraction) => sorted[Math.floor(fraction * (sorted.length - 1))];
const mean = intervalsMs.reduce((sum, value) => sum + value, 0) / intervalsMs.length;

const report = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-konkr-reference-frame-pacing-v1",
  classification: "KONKR-SurfaceFlinger-reference-preset-presentation-timestamps",
  source: path.relative(root, inputPath),
  refreshPeriodNs,
  refreshHz: 1e9 / refreshPeriodNs,
  frames: frames.length,
  intervals: intervalsMs.length,
  intervalMs: {
    mean,
    p50: percentile(0.5),
    p95: percentile(0.95),
    maximum: sorted.at(-1),
    over25ms: intervalsMs.filter((value) => value > 25).length,
  },
  pass: refreshPeriodNs === 16666667
    && frames.length >= 120
    && intervalsMs.length >= 119
    && percentile(0.95) <= 25
    && sorted.at(-1) <= 25
    && intervalsMs.every((value) => value > 0),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
