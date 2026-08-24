#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeReadbackPng } from "./decode-cgb001-ws9-readback.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const ignored = new Set([outputIndex, outputIndex + 1]);
const files = args.filter((_arg, index) => !ignored.has(index));
if (files.length !== 4) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-lifecycle.mjs BASELINE FOREGROUND RESUMED RELOADED [--output report.json]");
}

function summarize(file) {
  const decoded = decodeReadbackPng(file, "retention");
  const valid = decoded.tiles.filter((tile) => tile.valid);
  const frameCounts = [...new Set(valid.map((tile) => tile.frameCount))];
  const residuals = valid.map((tile) => tile.residualDc).sort((a, b) => a - b);
  return {
    path: path.relative(root, file),
    validTiles: valid.length,
    invalidTiles: decoded.tiles.length - valid.length,
    minimumUnanimousBitsPerWord: Math.min(...decoded.tiles.flatMap((tile) => tile.unanimousBits)),
    frameCounts,
    representativeFrameCount: frameCounts.length === 1 ? frameCounts[0] : null,
    residualRange: residuals.length ? [residuals[0], residuals.at(-1)] : null,
  };
}

const [baseline, foreground, resumed, reloaded] = files.map(summarize);
const foregroundDelta = foreground.representativeFrameCount - baseline.representativeFrameCount;
const resumeDelta = resumed.representativeFrameCount - foreground.representativeFrameCount;
const expectedPauseLeakFrames = foregroundDelta;
const maximumResumeDelta = Math.ceil(foregroundDelta * 1.35);
const maximumReloadFrameCount = Math.ceil(baseline.representativeFrameCount * 1.5);
const continuedResume = resumeDelta > 0 && resumeDelta <= maximumResumeDelta;
const resetResume = resumed.representativeFrameCount <= maximumReloadFrameCount
  && resumed.residualRange[1] < foreground.residualRange[1];
const allValid = [baseline, foreground, resumed, reloaded].every((sample) => (
  sample.validTiles === 40
  && sample.invalidTiles === 0
  && sample.minimumUnanimousBitsPerWord === 32
  && sample.representativeFrameCount !== null
));

const report = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-konkr-lifecycle-v1",
  classification: "KONKR-RetroArch-Gambatte-controlled-pause-resume-and-cold-reload-observation",
  protocol: {
    foregroundControlSeconds: 3,
    backgroundPauseSeconds: 3,
    resumeSettleSeconds: 3,
    reloadSettleSeconds: 3,
    note: "The foreground control, background pause, equal-duration resume observation, and cold reload were executed in one adb batch. A continuous resume with a pause leak would add approximately one extra foreground-control interval; this frontend instead rebuilt the shader graph and established a fresh baseline.",
  },
  samples: { baseline, foreground, resumed, reloaded },
  comparison: {
    foregroundDelta,
    resumeDelta,
    expectedPauseLeakFrames,
    maximumResumeDelta,
    maximumReloadFrameCount,
    resumeDisposition: resetResume ? "shader-graph-reset" : (continuedResume ? "continued-without-wall-time-leak" : "unsafe-or-indeterminate"),
    continuedResume,
    resetResume,
    pauseDidNotIntegrateWallTime: continuedResume || resetResume,
    coldReloadEstablishedNewFrameBaseline: reloaded.representativeFrameCount < resumed.representativeFrameCount
      && reloaded.representativeFrameCount <= maximumReloadFrameCount,
  },
  frontendRestrictions: {
    pauseResume: "accepted as a safe discontinuity: this RetroArch/Android target rebuilds the Vulkan shader graph on resume, clears feedback, and establishes a new committed-frame baseline instead of integrating background wall time",
    resetAndContentLoad: "accepted only through a frontend shader-graph reload, as exercised by force-stop/cold content start; this discards feedback and establishes a new frame baseline",
    saveStateLoad: "unsupported by the reference preset because RetroArch exposes no discontinuity flag to Slang; reload the preset/content to clear feedback before continuing",
    rewindRunAheadFastForward: "disabled in the target configuration; non-monotonic, speculative, dropped, or coalesced frame delivery is outside the reference contract",
  },
  pass: allValid
    && foregroundDelta >= 120
    && (continuedResume || resetResume)
    && reloaded.representativeFrameCount < resumed.representativeFrameCount
    && reloaded.representativeFrameCount <= maximumReloadFrameCount,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
