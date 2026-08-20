#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  normalizePhotodiodeTransition,
} from "../models/nintendo-ags-101/reference/capture-pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const sourcePath = path.join(modelDir, "data", "ws2-synthetic-capture-v1.json");
const stimulusManifestPath = path.join(
  modelDir,
  "generated",
  "ws2-stimulus-v1",
  "manifest.json",
);
const outputDir = path.join(modelDir, "generated", "ws2-capture-loopback-v1");
const sessionPath = path.join(outputDir, "session.json");
const reportPath = path.join(outputDir, "report.json");
const gtgPath = path.join(outputDir, "gtg-measurement-subset.json");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function cleanDeep(value) {
  if (typeof value === "number") {
    if (Math.abs(value) < 1e-12) return 0;
    return Number(value.toPrecision(12));
  }
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

function writeOrCheck(file, buffer) {
  const relative = path.relative(root, file);
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buffer)) {
      fail(`${relative} is missing or stale; run node tools/build-ags101-ws2.mjs`);
    }
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
  fs.writeFileSync(file, buffer);
  console.log(`Wrote ${relative}.`);
  return true;
}

function waveformCsv(fixture, caseSpec, repetition) {
  const step = 1 / fixture.sampleRateHz;
  const triggerOffset = 0.002 + repetition * 0.0005;
  const lines = ["time_seconds,detector_response,trigger"];
  const count = Math.floor((fixture.pretriggerSeconds + fixture.durationSeconds) / step) + 1;
  for (let index = 0; index < count; index += 1) {
    const rawTime = -fixture.pretriggerSeconds + index * step + triggerOffset;
    const relative = rawTime - triggerOffset;
    const missing = caseSpec.missingIntervalSeconds
      && relative >= caseSpec.missingIntervalSeconds[0]
      && relative <= caseSpec.missingIntervalSeconds[1];
    if (missing) continue;
    const progress = relative < 0 ? 0 : 1 - Math.exp(-caseSpec.ratePerSecond * relative);
    const noise = relative < 0
      ? 0
      : caseSpec.noiseAmplitude * Math.sin(2 * Math.PI * 137 * relative + repetition);
    const overshoot = relative < 0
      ? 0
      : caseSpec.overshootAmplitude * Math.exp(-(((relative - 0.12) / 0.012) ** 2));
    const detector = progress + noise + overshoot;
    const trigger = relative >= 0 ? 1 : 0;
    lines.push(`${rawTime.toFixed(7)},${detector.toFixed(12)},${trigger}`);
  }
  return Buffer.from(`${lines.join("\n")}\n`);
}

const sourceBuffer = fs.readFileSync(sourcePath);
const fixture = JSON.parse(sourceBuffer);
const manifestBuffer = fs.readFileSync(stimulusManifestPath);
const manifest = JSON.parse(manifestBuffer);
if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length < 5) {
  fail("invalid WS2 synthetic capture source");
}
const sceneIds = new Set(manifest.scenes.map((scene) => scene.sceneId));
const transitions = [];
const normalized = [];
const sourceFiles = [];
let changed = false;
for (const [caseIndex, caseSpec] of fixture.cases.entries()) {
  const sceneId = caseSpec.channel === "r" ? "gtg-red-gate"
    : caseSpec.channel === "g" ? "gtg-green-gate"
      : "gtg-blue-gate";
  if (!sceneIds.has(sceneId)) fail(`stimulus manifest is missing ${sceneId}`);
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const transitionId = `${caseSpec.caseId}-r${repetition}`;
    const relativeFile = `raw/${transitionId}.csv`;
    const rawFile = path.join(outputDir, relativeFile);
    const csv = waveformCsv(fixture, caseSpec, repetition);
    changed = writeOrCheck(rawFile, csv) || changed;
    const transition = {
      transitionId,
      sceneId,
      channel: caseSpec.channel,
      fromCode: caseSpec.fromCode,
      toCode: caseSpec.toCode,
      repetition,
      row: 79,
      frameParity: repetition % 2,
      eventReference: "source-frame-edge",
      rawFile: relativeFile,
      sha256: sha256(csv),
      fromPlateau: 0,
      toPlateau: 1,
      triggerUncertaintySeconds: 1 / fixture.sampleRateHz,
      expectedStatus: caseSpec.expectedStatus,
      fixtureCaseId: caseSpec.caseId,
    };
    transitions.push(transition);
    sourceFiles.push({
      path: path.relative(root, rawFile),
      sha256: transition.sha256,
    });
    const result = normalizePhotodiodeTransition({
      csv: csv.toString("utf8"),
      transition,
      sampleRateHz: fixture.sampleRateHz,
    });
    normalized.push({
      ...result,
      rawFile: relativeFile,
      rawSha256: transition.sha256,
      expectedStatus: caseSpec.expectedStatus,
      fixtureCaseId: caseSpec.caseId,
    });
  }
}
const session = {
  schemaVersion: 1,
  sessionId: fixture.fixtureId,
  classification: "synthetic-loopback",
  capturedAt: "2026-08-20T00:00:00Z",
  specimen: {
    consoleId: "synthetic-loopback",
    boardId: "synthetic-loopback",
    lcdLabel: "synthetic-loopback",
    brightnessMode: "synthetic",
    warmupSeconds: 0,
    temperatureC: 25,
    ambientIlluminanceLux: 0,
    chargerConnected: null,
    batteryVoltage: null,
    panelHistory: "not applicable: deterministic synthetic capture",
  },
  detector: {
    manufacturer: "Retro Display Lab",
    model: "deterministic waveform generator",
    serial: "synthetic",
    bandwidthHz: null,
    linearityCalibration: "exact synthetic response",
    positionPixels: [119.5, 79.5],
    footprintPixels: [16, 16],
  },
  acquisition: {
    sampleRateHz: fixture.sampleRateHz,
    pretriggerSeconds: fixture.pretriggerSeconds,
    timeUnits: "s",
    responseUnits: "V",
    triggerThreshold: 0.5,
  },
  stimulus: {
    suiteId: manifest.suiteId,
    manifestSha256: sha256(manifestBuffer),
  },
  transitions: transitions.map(({ expectedStatus, fixtureCaseId, ...transition }) => transition),
  notes: "Synthetic only: exercises alignment, repetitions, noise, overshoot, missing samples, censored settling, and fit rejection.",
};
const caseReports = fixture.cases.map((caseSpec) => {
  const repetitions = normalized.filter((entry) => entry.fixtureCaseId === caseSpec.caseId);
  return {
    caseId: caseSpec.caseId,
    expectedStatus: caseSpec.expectedStatus,
    actualStatuses: repetitions.map((entry) => entry.status),
    pass: repetitions.every((entry) => entry.status === caseSpec.expectedStatus),
    rejectionReasons: [...new Set(repetitions.flatMap((entry) => entry.rejectionReasons))],
  };
});
const report = cleanDeep({
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws2-capture-loopback-report-v1",
  generator: "tools/build-ags101-ws2.mjs",
  classification: "synthetic-pipeline-validation-only",
  source: {
    fixture: path.relative(root, sourcePath),
    fixtureSha256: sha256(sourceBuffer),
    stimulusManifest: path.relative(root, stimulusManifestPath),
    stimulusManifestSha256: sha256(manifestBuffer),
  },
  traceability: "sceneId -> ROM manifest/hash -> session transition -> raw CSV/hash -> aligned waveform -> fit/status",
  summary: {
    cases: caseReports.length,
    repetitions: normalized.length,
    accepted: normalized.filter((entry) => entry.status === "accepted").length,
    rejected: normalized.filter((entry) => entry.status === "rejected").length,
    pass: caseReports.every((entry) => entry.pass),
  },
  cases: caseReports,
  transitions: normalized,
});
if (!report.summary.pass) {
  fail(caseReports.filter((entry) => !entry.pass)
    .map((entry) => `${entry.caseId}: expected ${entry.expectedStatus}, got ${entry.actualStatuses.join(",")}`)
    .join("\n"));
}

const acceptedTransitions = normalized.filter((entry) => entry.status === "accepted");
const cellKeys = new Set(acceptedTransitions.map((entry) => (
  `${entry.channel}:${entry.fromCode}>${entry.toCode}`
)));
const missingCells = [];
for (const channel of ["r", "g", "b"]) {
  for (let fromCode = 0; fromCode < 32; fromCode += 1) {
    for (let toCode = 0; toCode < 32; toCode += 1) {
      const id = `${channel}:${fromCode}>${toCode}`;
      if (!cellKeys.has(id)) missingCells.push(id);
    }
  }
}
const gtgSamples = acceptedTransitions.map((entry) => ({
  id: entry.transitionId,
  channel: entry.channel,
  fromCode: entry.fromCode,
  toCode: entry.toCode,
  repetition: entry.repetition,
  status: "transition",
  eventTimeZeroSeconds: 0,
  fromPlateau: 0,
  toPlateau: 1,
  timesSeconds: entry.timesSeconds,
  opticalResponse: entry.normalizedResponse,
}));
const gtgRecord = cleanDeep({
  schemaVersion: "1.0.0",
  recordId: "ags101-ws2-synthetic-capture-subset-v1",
  classification: "synthetic",
  specimen: {
    consoleId: "not-applicable-synthetic",
    boardId: "not-applicable-synthetic",
    lcdLabel: "not-applicable-synthetic",
    brightnessMode: "synthetic-loopback",
    warmupSeconds: 0,
    ambient: { temperatureC: 25, illuminanceLux: 0 },
    power: { source: "synthetic", chargerConnected: null, batteryVoltage: null },
    panelHistory: "not applicable: deterministic synthetic capture",
    overlay: "none",
    measurementGeometry: {
      patchPixels: [240, 160],
      samplePointPixels: [119.5, 79.5],
      detectorDistanceMm: null,
      viewAngleDegrees: [0, 0],
    },
    detector: {
      manufacturer: "Retro Display Lab",
      model: "deterministic waveform generator",
      serial: "synthetic",
      bandwidthHz: null,
      linearityCalibration: "exact synthetic response",
    },
    acquisition: {
      sampleRateHz: fixture.sampleRateHz,
      repetitions: 3,
      pretriggerSeconds: fixture.pretriggerSeconds,
    },
    stimulus: {
      generator: "tools/build-ags101-ws2.mjs",
      testRom: "generated/ws2-stimulus-v1",
      patternSha256: sha256(manifestBuffer),
      preconditionFrames: 120,
      fromDwellSeconds: 2,
      toDwellSeconds: 2,
    },
  },
  eventTimeZero: {
    reference: "source-frame-edge",
    description: "Synthetic trigger edge aligned by capture-pipeline.mjs.",
    triggerUncertaintySeconds: 1 / fixture.sampleRateHz,
  },
  responseUnits: "normalized-transition",
  coverage: {
    channels: ["r", "g", "b"],
    codeRange: [0, 31],
    expectedCellCount: 3072,
    recordedCellCount: cellKeys.size,
  },
  samples: gtgSamples,
  missingCells,
  sourceFiles,
  integrity: {
    samplesSha256: "pending-cleaned-payload",
  },
});
gtgRecord.integrity.samplesSha256 = sha256(JSON.stringify(gtgRecord.samples));

changed = writeOrCheck(sessionPath, jsonBuffer(session)) || changed;
changed = writeOrCheck(reportPath, jsonBuffer(report)) || changed;
changed = writeOrCheck(gtgPath, jsonBuffer(gtgRecord)) || changed;
if (checkOnly) {
  console.log(`AGS-101 WS2 capture loopback is current (${normalized.length} waveforms).`);
} else if (!changed) {
  console.log("AGS-101 WS2 capture loopback was already current.");
}
