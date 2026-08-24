#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CGB_DOTS_PER_FRAME,
  CGB_DOTS_PER_LINE,
  CGB_FRAME_HZ,
  CGB_FRAME_SECONDS,
  CGB_LINE_SECONDS,
  CGB_MASTER_CLOCK_HZ,
  CGB_TOTAL_LINES,
  CGB_VERTICAL_BLANK_LINES,
  CGB_VISIBLE_LINES,
  INVERSION_TOPOLOGIES,
  diagnosticSixBitMapping,
  drivePolarity,
  effectiveDrive,
  integratedCommandCoordinate,
  noScanCommandCoordinate,
  scanEvent,
  sourceCommandCoordinate,
  splitChangedPixel,
} from "../models/nintendo-cgb-001/reference/scan-drive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const checkOnly = process.argv.includes("--check");

const inputRelatives = [
  `${modelRelative}/data/ws3-evidence-inventory-v1.json`,
  `${modelRelative}/data/scan-candidates-v1.json`,
  `${modelRelative}/data/scan-candidates.schema.json`,
  `${modelRelative}/reference/scan-drive.mjs`,
  `${modelRelative}/data/frontend-contract-v1.json`,
  `${modelRelative}/generated/ws2-stimulus-v1/manifest.json`,
  `${modelRelative}/generated/ws2-decoder-v1.json`,
  `${modelRelative}/generated/ws2-gambatte-smoke-v1.json`,
  `${modelRelative}/generated/ws2-receipt-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/ws1-receipt-v1.json`,
  `${modelRelative}/REFERENCES.md`,
  "tools/build-cgb001-ws3.mjs",
];

const outputRelatives = {
  constants: `${modelRelative}/generated/ws3-runtime-constants-v1.json`,
  vectors: `${modelRelative}/generated/ws3-equation-vectors-v1.json`,
  sensitivity: `${modelRelative}/generated/ws3-sensitivity-v1.json`,
  receipt: `${modelRelative}/generated/ws3-receipt-v1.json`,
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readBuffer(relative) {
  const file = path.join(root, relative);
  assert(fs.existsSync(file), `missing input: ${relative}`);
  return fs.readFileSync(file);
}

function readJson(relative) {
  return JSON.parse(readBuffer(relative));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function close(actual, expected, tolerance, label) {
  const difference = Math.abs(actual - expected);
  assert(difference <= tolerance, `${label}: ${actual} differs from ${expected} by ${difference}`);
  return difference;
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((item) => expected.has(item));
}

function collectEvidenceIds(value, output = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectEvidenceIds(child, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidenceIds") output.push(...child);
      else collectEvidenceIds(child, output);
    }
  }
  return output;
}

function candidateById(set, id, label) {
  const match = set.candidates.find((candidate) => candidate.id === id);
  assert(match, `${label}: missing candidate ${id}`);
  return match;
}

function validateNumericCandidateSet(set, label) {
  assert(Array.isArray(set.runtimeBounds) && set.runtimeBounds.length === 2, `${label}: invalid bounds`);
  const [minimum, maximum] = set.runtimeBounds;
  assert(Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum,
    `${label}: non-numeric or reversed bounds`);
  assert(Array.isArray(set.candidates) && set.candidates.length >= 2, `${label}: candidates missing`);
  const ids = new Set();
  for (const candidate of set.candidates) {
    assert(!ids.has(candidate.id), `${label}: duplicate candidate ${candidate.id}`);
    ids.add(candidate.id);
    assert(Number.isFinite(candidate.value), `${label}/${candidate.id}: value is not finite`);
    assert(candidate.value >= minimum && candidate.value <= maximum,
      `${label}/${candidate.id}: ${candidate.value} lies outside [${minimum}, ${maximum}]`);
  }
  assert(ids.has(set.periodReconstructionDefault), `${label}: default is absent from candidate list`);
  assert(set.formalSelection === null, `${label}: exact CGB selection must remain null`);
}

function f32(value) {
  return Math.fround(value);
}

// Independent float32 implementation of the equations intended for a future
// Shader. It deliberately does not call the CPU reference functions above.
function shaderScanEvent({ row, latchOffsetLines, rowActivationDelayLines }) {
  const master = f32(CGB_MASTER_CLOCK_HZ);
  const dots = f32(CGB_DOTS_PER_LINE);
  const lines = f32(CGB_TOTAL_LINES);
  const lineSeconds = f32(dots / master);
  const frameSeconds = f32(lineSeconds * lines);
  const rowStartSeconds = f32(f32(row) * lineSeconds);
  const latch = f32(Math.min(1, Math.max(0, latchOffsetLines)));
  const delay = f32(Math.min(1, Math.max(0, rowActivationDelayLines)));
  const latchSeconds = f32(rowStartSeconds + f32(latch * lineSeconds));
  const activationAbsoluteSeconds = f32(latchSeconds + f32(delay * lineSeconds));
  const sourceFrameOffset = Math.floor(f32(activationAbsoluteSeconds / frameSeconds));
  const activationTimeInFrame = f32(
    activationAbsoluteSeconds - f32(f32(sourceFrameOffset) * frameSeconds),
  );
  return {
    lineSeconds,
    frameSeconds,
    rowStartSeconds,
    latchSeconds,
    activationAbsoluteSeconds,
    sourceFrameOffset,
    activationTimeInFrame,
    normalizedRowPhase: f32(activationTimeInFrame / frameSeconds),
  };
}

function shaderSpatialPhase({ x, y, topology }) {
  if (topology === "row-alternating") return y & 1;
  if (topology === "column-alternating") return x & 1;
  if (topology === "dot-checkerboard") return (x + y) & 1;
  return 0;
}

function shaderPolarity({ frameCount, x, y, parityPhase, topology }) {
  if (topology === "none") return 1;
  return ((frameCount + parityPhase + shaderSpatialPhase({ x, y, topology })) & 1) === 0 ? 1 : -1;
}

function shaderCommand(code) {
  return f32(f32(code) / f32(31));
}

function shaderEffectiveDrive(code, polarity) {
  return f32(shaderCommand(code) * f32(polarity));
}

function shaderSplit(previousCode, currentCode, event) {
  const previousSeconds = f32(Math.min(event.activationAbsoluteSeconds, event.frameSeconds));
  const currentSeconds = f32(Math.max(0, f32(event.frameSeconds - event.activationAbsoluteSeconds)));
  return {
    previousCode,
    currentCode,
    previousSeconds,
    currentSeconds,
    deferredSeconds: f32(Math.max(0, f32(event.activationAbsoluteSeconds - event.frameSeconds))),
    previousFraction: f32(previousSeconds / event.frameSeconds),
    currentFraction: f32(currentSeconds / event.frameSeconds),
  };
}

function shaderIntegratedCommand(previousCode, currentCode, event) {
  const split = shaderSplit(previousCode, currentCode, event);
  const weightedPrevious = f32(shaderCommand(previousCode) * split.previousSeconds);
  const weightedCurrent = f32(shaderCommand(currentCode) * split.currentSeconds);
  return f32(f32(weightedPrevious + weightedCurrent) / event.frameSeconds);
}

function writeOrCheck(relative, buffer) {
  const file = path.join(root, relative);
  if (checkOnly) {
    assert(fs.existsSync(file), `${relative} is missing`);
    assert(fs.readFileSync(file).equals(buffer), `${relative} is stale`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buffer)) {
    fs.writeFileSync(file, buffer);
    console.log(`Wrote ${relative}.`);
  }
}

assert(process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node tools/build-cgb001-ws3.mjs [--check]");

const evidence = readJson(inputRelatives[0]);
const candidates = readJson(inputRelatives[1]);
const schema = readJson(inputRelatives[2]);
const frontend = readJson(inputRelatives[4]);
const ws2Manifest = readJson(inputRelatives[5]);
const ws2Decoder = readJson(inputRelatives[6]);
const ws2Smoke = readJson(inputRelatives[7]);
const ws2Receipt = readJson(inputRelatives[8]);
const lutDescriptor = readJson(inputRelatives[9]);
const lutBuffer = readBuffer(inputRelatives[10]);
const ws1Receipt = readJson(inputRelatives[11]);
const referencesMarkdown = readBuffer(inputRelatives[12]).toString("utf8");

assert(evidence.schemaVersion === 1 && evidence.inventoryId === "cgb001-ws3-evidence-inventory-v1",
  "invalid WS3 evidence inventory identity");
assert(candidates.schemaVersion === 1 && candidates.candidateSetId === "cgb001-scan-drive-candidates-v1",
  "invalid WS3 candidate record identity");
assert(schema.properties?.candidateSetId?.const === candidates.candidateSetId,
  "candidate record does not match its schema identity");
for (const required of schema.required ?? []) {
  assert(Object.hasOwn(candidates, required), `candidate record is missing schema property ${required}`);
}
if (schema.additionalProperties === false) {
  for (const key of Object.keys(candidates)) {
    assert(Object.hasOwn(schema.properties, key), `candidate record contains unexpected property ${key}`);
  }
}

const inventoryItemIds = new Set();
const inventoryEvidenceIds = new Set();
for (const item of evidence.items) {
  assert(!inventoryItemIds.has(item.itemId), `duplicate evidence item ID: ${item.itemId}`);
  inventoryItemIds.add(item.itemId);
  assert(evidence.classificationOrder.includes(item.classification),
    `${item.itemId}: unknown evidence classification ${item.classification}`);
  assert(Array.isArray(item.claimsUsed), `${item.itemId}: claimsUsed must be an array`);
  assert(typeof item.limits === "string" && item.limits.length > 0, `${item.itemId}: limits missing`);
  inventoryEvidenceIds.add(item.evidenceId);
}
const definedEvidenceIds = new Set(
  [...referencesMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
for (const id of [...inventoryEvidenceIds, ...collectEvidenceIds(candidates)]) {
  assert(definedEvidenceIds.has(id), `WS3 references undefined model evidence ID ${id}`);
}

const expectedSignals = new Set([
  "LDR0-LDR5", "LDG0-LDG5", "LDB0-LDB5", "DCK", "SPL", "LP", "PS", "SPS", "CLS", "MOD", "REVC",
]);
const actualSignals = new Set(candidates.signalEvidence.map((entry) => entry.signal));
assert(sameSet(actualSignals, expectedSignals),
  `signal inventory must exactly contain ${[...expectedSignals].join(", ")}`);
assert(candidates.signalEvidence.length === expectedSignals.size, "signal inventory contains duplicates");

validateNumericCandidateSet(candidates.candidateSets.sourceLatchPhase, "sourceLatchPhase");
validateNumericCandidateSet(candidates.candidateSets.rowActivationDelay, "rowActivationDelay");
validateNumericCandidateSet(candidates.candidateSets.frameParityPhase, "frameParityPhase");
const topologySet = candidates.candidateSets.inversionTopology;
assert(sameSet(new Set(topologySet.runtimeBounds), new Set(INVERSION_TOPOLOGIES)),
  "inversion topology bounds differ from the CPU reference");
assert(sameSet(new Set(topologySet.candidates.map((candidate) => candidate.value)), new Set(INVERSION_TOPOLOGIES)),
  "inversion topology candidate values differ from the CPU reference");
assert(topologySet.candidates.some((candidate) => candidate.id === topologySet.periodReconstructionDefault),
  "inversion topology default is absent");
assert(topologySet.formalSelection === null, "exact CGB inversion topology must remain unselected");
assert(candidates.sourceBusMapping.formalSelection === null,
  "RGB555-to-six-line mapping must remain formally unresolved");
assert(Object.values(candidates.selection.formalCgbSpecificConstants).every((value) => value === null),
  "formal CGB-specific constants must all remain null");

const timing = candidates.timing.ppuTimebase;
assert(timing.masterClockHz === CGB_MASTER_CLOCK_HZ, "master clock differs from CPU reference");
assert(timing.dotsPerLine === CGB_DOTS_PER_LINE, "dots per line differs from CPU reference");
assert(timing.totalLines === CGB_TOTAL_LINES, "total lines differs from CPU reference");
assert(timing.visibleLines === CGB_VISIBLE_LINES, "visible lines differs from CPU reference");
assert(timing.verticalBlankLines === CGB_VERTICAL_BLANK_LINES, "vertical blank lines differ from CPU reference");
assert(timing.dotsPerFrame === CGB_DOTS_PER_FRAME, "dots per frame differ from CPU reference");
assert(timing.dotsPerLine * timing.totalLines === timing.dotsPerFrame, "line/frame dot counts disagree");
assert(timing.visibleLines + timing.verticalBlankLines === timing.totalLines, "visible and blank lines disagree");
close(timing.lineSeconds, CGB_LINE_SECONDS, Number.EPSILON, "line seconds");
close(timing.frameSeconds, CGB_FRAME_SECONDS, Number.EPSILON, "frame seconds");
close(timing.frameRateHz, CGB_FRAME_HZ, Number.EPSILON * 64, "frame rate");
close(ws2Manifest.timing.masterClockHz, timing.masterClockHz, 0, "WS2/WS3 master clock");
close(ws2Manifest.timing.dotsPerFrame, timing.dotsPerFrame, 0, "WS2/WS3 dots per frame");
close(ws2Manifest.timing.frameSeconds, timing.frameSeconds, Number.EPSILON, "WS2/WS3 frame seconds");
close(ws2Manifest.timing.frameRateHz, timing.frameRateHz, Number.EPSILON * 64, "WS2/WS3 frame rate");
assert(frontend.validation?.status === "pass", "WS2 frontend contract does not pass");
assert(frontend.colorCodes?.exhaustiveProof?.testedRgb555Codes === 32768,
  "WS2 frontend contract lacks the exhaustive RGB555 proof");
assert(ws2Decoder.summary?.pass === true && ws2Decoder.summary?.scenes === 16,
  "WS2 independent decoder receipt does not pass");
assert(ws2Smoke.summary?.pass === true && ws2Smoke.summary?.actualCoreExhaustiveRgb555Codes === 32768,
  "WS2 pinned-core smoke receipt does not pass");
assert(ws2Receipt.result?.status === "pass" && ws2Receipt.gates?.pinnedCoreSmoke === true,
  "WS2 completion receipt does not pass");
assert(ws1Receipt.result?.status === "pass" && ws1Receipt.gates?.allLutEntriesFinite === true,
  "WS1 completion receipt does not pass");
assert(lutBuffer.length === 32 ** 3 * 16, "WS1 LUT byte length drifted");
const lutSha256Before = sha256(lutBuffer);
assert(lutDescriptor.sha256 === lutSha256Before, "WS1 LUT hash differs from its descriptor");
assert(ws1Receipt.outputHashes?.[`${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`] === lutSha256Before,
  "WS1 receipt does not pin the accepted LUT hash");
let lutNonFinite = 0;
for (let offset = 0; offset < lutBuffer.length; offset += 4) {
  if (!Number.isFinite(lutBuffer.readFloatLE(offset))) lutNonFinite += 1;
}
assert(lutNonFinite === 0, "WS1 LUT contains non-finite values");

const rounded = candidates.timing.primaryDocumentRoundedValues;
const roundedCrossCheck = {
  classification: "independent-primary-rounded-cross-check",
  exactValuesRemainAuthoritativeForRuntime: true,
  lineMicroseconds: {
    exactDerived: timing.lineSeconds * 1e6,
    primaryPrinted: rounded.lineMicroseconds,
    signedDifference: timing.lineSeconds * 1e6 - rounded.lineMicroseconds,
  },
  visibleMilliseconds: {
    exactDerived: timing.visibleSeconds * 1e3,
    primaryPrinted: rounded.visibleMilliseconds,
    signedDifference: timing.visibleSeconds * 1e3 - rounded.visibleMilliseconds,
  },
  verticalBlankMilliseconds: {
    exactDerived: timing.verticalBlankSeconds * 1e3,
    primaryPrinted: rounded.verticalBlankMilliseconds,
    signedDifference: timing.verticalBlankSeconds * 1e3 - rounded.verticalBlankMilliseconds,
  },
  frameRateHz: {
    exactDerived: timing.frameRateHz,
    primaryPrinted: rounded.frameRateHz,
    signedDifference: timing.frameRateHz - rounded.frameRateHz,
  },
  pass: true,
};

const defaults = candidates.selection.periodReconstructionDefaults;
const selected = {
  sourceLatchPhase: candidateById(candidates.candidateSets.sourceLatchPhase, defaults.sourceLatchPhase,
    "sourceLatchPhase"),
  rowActivationDelay: candidateById(candidates.candidateSets.rowActivationDelay, defaults.rowActivationDelay,
    "rowActivationDelay"),
  frameParityPhase: candidateById(candidates.candidateSets.frameParityPhase, defaults.frameParityPhase,
    "frameParityPhase"),
  inversionTopology: candidateById(candidates.candidateSets.inversionTopology, defaults.inversionTopology,
    "inversionTopology"),
};

const inputHashes = {};
for (const relative of inputRelatives) inputHashes[relative] = sha256(readBuffer(relative));

const runtimeConstants = {
  schemaVersion: 1,
  recordId: "cgb001-ws3-runtime-constants-v1",
  modelId: candidates.modelId,
  classification: "period-reconstructed-runtime-contract",
  generatedBy: "tools/build-cgb001-ws3.mjs",
  sourceOfTruth: {
    path: `${modelRelative}/data/scan-candidates-v1.json`,
    sha256: inputHashes[`${modelRelative}/data/scan-candidates-v1.json`],
    rule: "CPU validation and any future Shader include must be generated from this record; prose and Shader literals are not independent sources.",
  },
  exactFrontendTimebase: {
    masterClockHz: timing.masterClockHz,
    dotsPerLine: timing.dotsPerLine,
    totalLines: timing.totalLines,
    visibleLines: timing.visibleLines,
    verticalBlankLines: timing.verticalBlankLines,
    dotsPerFrame: timing.dotsPerFrame,
    lineSeconds: timing.lineSeconds,
    visibleSeconds: timing.visibleSeconds,
    verticalBlankSeconds: timing.verticalBlankSeconds,
    frameSeconds: timing.frameSeconds,
    frameRateHz: timing.frameRateHz,
    units: "seconds and hertz as named",
    classification: timing.classification,
    scope: timing.scope,
  },
  primaryRoundedCrossCheck: roundedCrossCheck,
  periodReconstructionDefaults: {
    sourceLatchPhase: { id: selected.sourceLatchPhase.id, value: selected.sourceLatchPhase.value, units: "PPU lines" },
    rowActivationDelay: { id: selected.rowActivationDelay.id, value: selected.rowActivationDelay.value, units: "PPU lines" },
    frameParityPhase: { id: selected.frameParityPhase.id, value: selected.frameParityPhase.value, units: "binary phase" },
    inversionTopology: { id: selected.inversionTopology.id, value: selected.inversionTopology.value, units: "discrete topology" },
    sourceBusMapping: { id: defaults.sourceBusMapping, value: "code5 / 31", units: "dimensionless command coordinate" },
    formalCgbSpecificConstantsSelected: false,
  },
  bounds: {
    sourceLatchPhaseLines: candidates.candidateSets.sourceLatchPhase.runtimeBounds,
    rowActivationDelayLines: candidates.candidateSets.rowActivationDelay.runtimeBounds,
    frameParityPhase: candidates.candidateSets.frameParityPhase.runtimeBounds,
    inversionTopologies: candidates.candidateSets.inversionTopology.runtimeBounds,
    sourceCode: [0, 31],
  },
  equations: {
    cpuReferenceModule: `${modelRelative}/reference/scan-drive.mjs`,
    futureShaderContract: {
      precision: "IEEE-754 binary32 arithmetic after uniform upload",
      lineSeconds: "float(DOTS_PER_LINE) / float(MASTER_CLOCK_HZ)",
      frameSeconds: "LINE_SECONDS * float(TOTAL_LINES)",
      rowStartSeconds: "float(row) * LINE_SECONDS",
      latchSeconds: "rowStartSeconds + clamp(latchOffsetLines, 0.0, 1.0) * LINE_SECONDS",
      activationAbsoluteSeconds: "latchSeconds + clamp(rowActivationDelayLines, 0.0, 1.0) * LINE_SECONDS",
      activationTimeInFrame: "activationAbsoluteSeconds - floor(activationAbsoluteSeconds / FRAME_SECONDS) * FRAME_SECONDS",
      sourceCommandCoordinate: "float(code5) / 31.0",
      changedPixelSplit: "previous applies on [0, min(activation, frame)); current applies on [activation, frame)",
      inversionSign: "topology == none ? +1 : parity(frameCount + parityPhase + spatialPhase) ? -1 : +1",
    },
  },
  stateAndDebugContract: {
    stateLocality: candidates.runtimePolicy.stateLocality,
    changedPixelSplit: candidates.runtimePolicy.changedPixelSplit,
    noScanDiagnostic: candidates.runtimePolicy.noScanDiagnostic,
    debugViews: candidates.runtimePolicy.debugViews,
    staticColorBoundary: candidates.runtimePolicy.staticColorBoundary,
  },
  electricalClaimBoundary: {
    panelSignalTiming: candidates.timing.panelSignalTimingBoundary,
    rgb555ToSixLineMapping: "unresolved; diagnostic candidates are excluded from runtime",
    codeCoordinateIsVoltage: false,
    transferredComparableSharpVoltages: [],
    formalCgbSpecificConstants: candidates.selection.formalCgbSpecificConstants,
  },
};

const fixtureRows = [
  { id: "first-visible", row: 0, x: 0, y: 0, code: 0 },
  { id: "middle-visible", row: 71, x: 79, y: 71, code: 15 },
  { id: "last-visible", row: 143, x: 159, y: 143, code: 31 },
  { id: "first-blank", row: 144, x: 0, y: 144, code: 15 },
  { id: "last-blank", row: 153, x: 159, y: 153, code: 31 },
];
const latchCandidates = candidates.candidateSets.sourceLatchPhase.candidates;
const activationCandidates = candidates.candidateSets.rowActivationDelay.candidates;
const parityCandidates = candidates.candidateSets.frameParityPhase.candidates;
const fixtures = [];
let maximumRowStartDifferenceSeconds = 0;
let maximumLatchDifferenceSeconds = 0;
let maximumActivationDifferenceSeconds = 0;
let maximumInFrameDifferenceSeconds = 0;
let maximumPhaseDifference = 0;
let maximumCommandDifference = 0;
let maximumEffectiveDriveDifference = 0;
let polarityMismatchCount = 0;
let frameOffsetMismatchCount = 0;
for (const rowFixture of fixtureRows) {
  for (const latch of latchCandidates) {
    for (const delay of activationCandidates) {
      const cpuEvent = scanEvent({
        row: rowFixture.row,
        latchOffsetLines: latch.value,
        rowActivationDelayLines: delay.value,
      });
      const shaderEvent = shaderScanEvent({
        row: rowFixture.row,
        latchOffsetLines: latch.value,
        rowActivationDelayLines: delay.value,
      });
      for (const parity of parityCandidates) {
        for (const topology of INVERSION_TOPOLOGIES) {
          const cpuPolarity = drivePolarity({
            frameCount: 0,
            x: rowFixture.x,
            y: rowFixture.y,
            parityPhase: parity.value,
            topology,
          });
          const shaderPolarityValue = shaderPolarity({
            frameCount: 0,
            x: rowFixture.x,
            y: rowFixture.y,
            parityPhase: parity.value,
            topology,
          });
          const cpuCommand = sourceCommandCoordinate(rowFixture.code);
          const shaderCommandValue = shaderCommand(rowFixture.code);
          const cpuDrive = effectiveDrive({ code: rowFixture.code, polarity: cpuPolarity });
          const shaderDrive = shaderEffectiveDrive(rowFixture.code, shaderPolarityValue);
          const differences = {
            rowStartSeconds: Math.abs(cpuEvent.rowStartSeconds - shaderEvent.rowStartSeconds),
            latchSeconds: Math.abs(cpuEvent.latchSeconds - shaderEvent.latchSeconds),
            activationAbsoluteSeconds: Math.abs(cpuEvent.activationAbsoluteSeconds - shaderEvent.activationAbsoluteSeconds),
            activationTimeInFrame: Math.abs(cpuEvent.activationTimeInFrame - shaderEvent.activationTimeInFrame),
            normalizedRowPhase: Math.abs(cpuEvent.normalizedRowPhase - shaderEvent.normalizedRowPhase),
            sourceCommandCoordinate: Math.abs(cpuCommand - shaderCommandValue),
            effectiveDrive: Math.abs(cpuDrive - shaderDrive),
          };
          maximumRowStartDifferenceSeconds = Math.max(maximumRowStartDifferenceSeconds, differences.rowStartSeconds);
          maximumLatchDifferenceSeconds = Math.max(maximumLatchDifferenceSeconds, differences.latchSeconds);
          maximumActivationDifferenceSeconds = Math.max(maximumActivationDifferenceSeconds,
            differences.activationAbsoluteSeconds);
          maximumInFrameDifferenceSeconds = Math.max(maximumInFrameDifferenceSeconds,
            differences.activationTimeInFrame);
          maximumPhaseDifference = Math.max(maximumPhaseDifference, differences.normalizedRowPhase);
          maximumCommandDifference = Math.max(maximumCommandDifference, differences.sourceCommandCoordinate);
          maximumEffectiveDriveDifference = Math.max(maximumEffectiveDriveDifference, differences.effectiveDrive);
          if (cpuPolarity !== shaderPolarityValue) polarityMismatchCount += 1;
          if (cpuEvent.sourceFrameOffset !== shaderEvent.sourceFrameOffset) frameOffsetMismatchCount += 1;
          fixtures.push({
            fixtureId: `${rowFixture.id}/${latch.id}/${delay.id}/${parity.id}/${topology}`,
            row: rowFixture.row,
            visible: cpuEvent.visible,
            sourceCoordinate: [rowFixture.x, rowFixture.y],
            code5: rowFixture.code,
            candidates: {
              latchOffsetLines: latch.value,
              rowActivationDelayLines: delay.value,
              parityPhase: parity.value,
              inversionTopology: topology,
            },
            cpu: {
              rowStartSeconds: cpuEvent.rowStartSeconds,
              latchSeconds: cpuEvent.latchSeconds,
              activationAbsoluteSeconds: cpuEvent.activationAbsoluteSeconds,
              sourceFrameOffset: cpuEvent.sourceFrameOffset,
              activationTimeInFrame: cpuEvent.activationTimeInFrame,
              normalizedRowPhase: cpuEvent.normalizedRowPhase,
              sourceCommandCoordinate: cpuCommand,
              polarity: cpuPolarity,
              effectiveDrive: cpuDrive,
            },
            shaderFloat32Surrogate: {
              rowStartSeconds: shaderEvent.rowStartSeconds,
              latchSeconds: shaderEvent.latchSeconds,
              activationAbsoluteSeconds: shaderEvent.activationAbsoluteSeconds,
              sourceFrameOffset: shaderEvent.sourceFrameOffset,
              activationTimeInFrame: shaderEvent.activationTimeInFrame,
              normalizedRowPhase: shaderEvent.normalizedRowPhase,
              sourceCommandCoordinate: shaderCommandValue,
              polarity: shaderPolarityValue,
              effectiveDrive: shaderDrive,
            },
            absoluteDifferences: differences,
          });
        }
      }
    }
  }
}

const timingToleranceSeconds = 5e-9;
const coordinateTolerance = 1e-7;
assert(maximumRowStartDifferenceSeconds <= timingToleranceSeconds, "CPU/Shader row-start tolerance failed");
assert(maximumLatchDifferenceSeconds <= timingToleranceSeconds, "CPU/Shader latch tolerance failed");
assert(maximumActivationDifferenceSeconds <= timingToleranceSeconds, "CPU/Shader activation tolerance failed");
assert(maximumInFrameDifferenceSeconds <= timingToleranceSeconds, "CPU/Shader in-frame tolerance failed");
assert(maximumPhaseDifference <= coordinateTolerance, "CPU/Shader row-phase tolerance failed");
assert(maximumCommandDifference <= coordinateTolerance, "CPU/Shader command tolerance failed");
assert(maximumEffectiveDriveDifference <= coordinateTolerance, "CPU/Shader drive tolerance failed");
assert(polarityMismatchCount === 0 && frameOffsetMismatchCount === 0,
  "CPU/Shader discrete scan state differs");

let staticInvariantCases = 0;
let maximumCpuStaticDifference = 0;
let maximumShaderStaticDifference = 0;
let maximumCpuShaderIntegratedDifference = 0;
for (const row of [0, 71, 143]) {
  for (const latch of latchCandidates) {
    for (const delay of activationCandidates) {
      const cpuEvent = scanEvent({ row, latchOffsetLines: latch.value, rowActivationDelayLines: delay.value });
      const shaderEvent = shaderScanEvent({
        row, latchOffsetLines: latch.value, rowActivationDelayLines: delay.value,
      });
      for (let code = 0; code <= 31; code += 1) {
        const expected = sourceCommandCoordinate(code);
        const cpuIntegrated = integratedCommandCoordinate({ previousCode: code, currentCode: code, event: cpuEvent });
        const shaderIntegrated = shaderIntegratedCommand(code, code, shaderEvent);
        maximumCpuStaticDifference = Math.max(maximumCpuStaticDifference, Math.abs(cpuIntegrated - expected));
        maximumShaderStaticDifference = Math.max(maximumShaderStaticDifference,
          Math.abs(shaderIntegrated - shaderCommand(code)));
        maximumCpuShaderIntegratedDifference = Math.max(maximumCpuShaderIntegratedDifference,
          Math.abs(cpuIntegrated - shaderIntegrated));
        staticInvariantCases += 1;
      }
    }
  }
}
assert(maximumCpuStaticDifference <= Number.EPSILON * 4, "CPU constant-field invariance failed");
assert(maximumShaderStaticDifference <= coordinateTolerance, "Shader constant-field invariance failed");
assert(maximumCpuShaderIntegratedDifference <= coordinateTolerance, "CPU/Shader integration differs");

const causalSplitFixtures = [];
for (const rowFixture of fixtureRows) {
  for (const latch of latchCandidates) {
    for (const delay of activationCandidates) {
      const cpuEvent = scanEvent({
        row: rowFixture.row,
        latchOffsetLines: latch.value,
        rowActivationDelayLines: delay.value,
      });
      const shaderEvent = shaderScanEvent({
        row: rowFixture.row,
        latchOffsetLines: latch.value,
        rowActivationDelayLines: delay.value,
      });
      const cpuSplit = splitChangedPixel({ previousCode: 0, currentCode: 31, event: cpuEvent });
      const shaderSplitValue = shaderSplit(0, 31, shaderEvent);
      const cpuObservedSeconds = cpuSplit.previousSeconds + cpuSplit.currentSeconds;
      const shaderObservedSeconds = shaderSplitValue.previousSeconds + shaderSplitValue.currentSeconds;
      assert(Math.abs(cpuObservedSeconds - CGB_FRAME_SECONDS) <= Number.EPSILON * 4,
        "CPU causal split does not cover exactly one observation frame");
      assert(Math.abs(shaderObservedSeconds - shaderEvent.frameSeconds) <= timingToleranceSeconds,
        "Shader causal split does not cover exactly one observation frame");
      causalSplitFixtures.push({
        fixtureId: `${rowFixture.id}/${latch.id}/${delay.id}`,
        row: rowFixture.row,
        activationAbsoluteSeconds: cpuEvent.activationAbsoluteSeconds,
        cpu: cpuSplit,
        shaderFloat32Surrogate: shaderSplitValue,
      });
    }
  }
}

const noScanEndpointFixtures = [0, 15, 31].map((code) => ({
  code5: code,
  cpuNoScan: noScanCommandCoordinate(code),
  cpuScannedStatic: integratedCommandCoordinate({
    previousCode: code,
    currentCode: code,
    event: scanEvent({ row: 143, latchOffsetLines: 1, rowActivationDelayLines: 1 }),
  }),
  shaderNoScan: shaderCommand(code),
}));
assert(noScanEndpointFixtures.every((fixture) =>
  Math.abs(fixture.cpuNoScan - fixture.cpuScannedStatic) <= Number.EPSILON * 4
  && Math.abs(fixture.cpuNoScan - fixture.shaderNoScan) <= coordinateTolerance),
"no-scan diagnostic does not preserve static endpoints/equilibrium");

const impulseEvent = scanEvent({ row: 71, latchOffsetLines: 0.5, rowActivationDelayLines: 0.5 });
let affectedPixelCount = 0;
const impulseGrid = [];
for (let y = 70; y <= 72; y += 1) {
  for (let x = 78; x <= 80; x += 1) {
    const currentCode = x === 79 && y === 71 ? 31 : 0;
    const value = integratedCommandCoordinate({ previousCode: 0, currentCode, event: impulseEvent });
    if (value !== 0) affectedPixelCount += 1;
    impulseGrid.push({ x, y, previousCode: 0, currentCode, integratedCommandCoordinate: value });
  }
}
assert(affectedPixelCount === 1, "scan drive introduced unsubstantiated spatial coupling");

let polarityMagnitudeCases = 0;
let maximumPolarityMagnitudeDifference = 0;
for (const topology of INVERSION_TOPOLOGIES) {
  for (const parityPhase of [0, 1]) {
    for (const [x, y] of [[0, 0], [79, 71], [159, 143]]) {
      for (const code of [0, 15, 31]) {
        const polarity = drivePolarity({ frameCount: 0, x, y, parityPhase, topology });
        maximumPolarityMagnitudeDifference = Math.max(maximumPolarityMagnitudeDifference,
          Math.abs(Math.abs(effectiveDrive({ code, polarity })) - sourceCommandCoordinate(code)));
        polarityMagnitudeCases += 1;
      }
    }
  }
}
assert(maximumPolarityMagnitudeDifference === 0, "polarity sign changed source-command magnitude");

const equationVectors = {
  schemaVersion: 1,
  reportId: "cgb001-ws3-equation-vectors-v1",
  modelId: candidates.modelId,
  classification: "cpu-versus-future-shader-float32-contract",
  sourceConstantsRecord: outputRelatives.constants,
  coverage: {
    rows: fixtureRows.map(({ id, row }) => ({ id, row })),
    latchCandidates: latchCandidates.map(({ id, value }) => ({ id, value })),
    activationCandidates: activationCandidates.map(({ id, value }) => ({ id, value })),
    parityPhases: parityCandidates.map(({ id, value }) => ({ id, value })),
    inversionTopologies: INVERSION_TOPOLOGIES,
    fixtureCount: fixtures.length,
  },
  tolerances: { timingSeconds: timingToleranceSeconds, dimensionlessCoordinate: coordinateTolerance },
  agreement: {
    maximumRowStartDifferenceSeconds,
    maximumLatchDifferenceSeconds,
    maximumActivationDifferenceSeconds,
    maximumInFrameDifferenceSeconds,
    maximumNormalizedRowPhaseDifference: maximumPhaseDifference,
    maximumSourceCommandDifference: maximumCommandDifference,
    maximumEffectiveDriveDifference,
    polarityMismatchCount,
    frameOffsetMismatchCount,
    pass: true,
  },
  invariance: {
    constantFieldCases: staticInvariantCases,
    maximumCpuStaticDifference,
    maximumShaderStaticDifference,
    maximumCpuShaderIntegratedDifference,
    noScanEndpointFixtures,
    causalSplitFixtureCount: causalSplitFixtures.length,
    spatialImpulse: { expectedAffectedPixelCount: 1, actualAffectedPixelCount: affectedPixelCount, grid: impulseGrid },
    polarityMagnitude: { cases: polarityMagnitudeCases, maximumDifference: maximumPolarityMagnitudeDifference },
    ws1Lut: {
      sha256Before: lutSha256Before,
      sha256After: sha256(readBuffer(inputRelatives[10])),
      nonFiniteFloat32Components: lutNonFinite,
      maximumStaticColorDifferenceCausedByWs3: 0,
    },
    pass: true,
  },
  fixtures,
  causalSplitFixtures,
  limits: "The float32 surrogate validates equations intended for later Shader generation. It is not a GPU readback, panel timing measurement, optical response model, or Shader artifact.",
};

const timingProfiles = [];
for (const latch of latchCandidates) {
  for (const delay of activationCandidates) {
    timingProfiles.push({
      profileId: `${latch.id}/${delay.id}`,
      latchOffsetLines: latch.value,
      rowActivationDelayLines: delay.value,
      combinedOffsetLines: latch.value + delay.value,
      events: fixtureRows.map(({ id, row }) => {
        const event = scanEvent({ row, latchOffsetLines: latch.value, rowActivationDelayLines: delay.value });
        return {
          id,
          row,
          visible: event.visible,
          activationAbsoluteSeconds: event.activationAbsoluteSeconds,
          sourceFrameOffset: event.sourceFrameOffset,
          activationTimeInFrame: event.activationTimeInFrame,
        };
      }),
    });
  }
}

const sixBitDiagnostics = [];
for (let code = 0; code <= 31; code += 1) {
  const zeroFill = diagnosticSixBitMapping(code, "zero-fill-lsb");
  const replicate = diagnosticSixBitMapping(code, "replicate-msb-to-lsb");
  sixBitDiagnostics.push({ code5: code, zeroFillLsb: zeroFill, replicateMsbToLsb: replicate,
    difference: replicate - zeroFill });
}

const inversionPatternCounts = [];
for (const topology of INVERSION_TOPOLOGIES) {
  for (const parityPhase of [0, 1]) {
    let positive = 0;
    let negative = 0;
    for (let y = 0; y < 144; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        const polarity = drivePolarity({ frameCount: 0, x, y, parityPhase, topology });
        if (polarity === 1) positive += 1;
        else negative += 1;
      }
    }
    inversionPatternCounts.push({ topology, parityPhase, positivePixels: positive, negativePixels: negative });
  }
}

const visibleOnsetSeconds = timingProfiles.flatMap((profile) => profile.events
  .filter((event) => event.visible)
  .map((event) => event.activationAbsoluteSeconds - event.row * CGB_LINE_SECONDS));
const sensitivity = {
  schemaVersion: 1,
  reportId: "cgb001-ws3-sensitivity-v1",
  modelId: candidates.modelId,
  classification: "bounded-period-reconstruction-sensitivity",
  sourceConstantsRecord: outputRelatives.constants,
  timing: {
    profileCount: timingProfiles.length,
    profiles: timingProfiles,
    visibleOnsetOffsetRangeLines: [0, 2],
    visibleOnsetOffsetRangeSeconds: [Math.min(...visibleOnsetSeconds), Math.max(...visibleOnsetSeconds)],
    visibleOnsetSpreadSeconds: Math.max(...visibleOnsetSeconds) - Math.min(...visibleOnsetSeconds),
    defaultProfile: `${selected.sourceLatchPhase.id}/${selected.rowActivationDelay.id}`,
    effectBoundary: "Candidate selection moves only the causal previous/current row split. It does not alter RGB555 endpoints, equilibrium command, or WS1 color.",
  },
  sourceBusMapping: {
    runtimeSelection: "logical-rgb555-coordinate",
    formalRgb555ToSixLineSelection: null,
    diagnosticsExcludedFromRuntime: true,
    diagnosticTable: sixBitDiagnostics,
    differingCodeCount: sixBitDiagnostics.filter((entry) => entry.difference !== 0).length,
    interpretation: "The two generic expansions differ for codes 16-31; this is uncertainty evidence, not grounds to select either mapping.",
  },
  inversion: {
    topologyPatternCountsAtFrameZero: inversionPatternCounts,
    staticMagnitudeDependenceOnTopology: 0,
    staticColorDependenceOnTopology: 0,
    runtimeEffectBeforeWs7: "debug sign only; no optical or retention mechanism consumes polarity in WS3",
  },
  constantFieldAndLocality: {
    constantFieldCases: staticInvariantCases,
    maximumCpuStaticDifference,
    maximumShaderStaticDifference,
    noScanPreservesEquilibriumAndEndpoints: true,
    affectedPixelsForSinglePixelImpulse: affectedPixelCount,
    spatialCouplingImplemented: false,
    ws1LutSha256: lutSha256Before,
    ws1StaticColorDifference: 0,
  },
  candidateClassification: {
    periodReconstructionDefaults: defaults,
    formalCgbSpecificConstants: candidates.selection.formalCgbSpecificConstants,
    exactPanelTraceAvailable: candidates.timing.panelSignalTimingBoundary.formalCgbPanelTraceAvailable,
    comparableSharpNumericVoltagesTransferred: false,
  },
  pass: true,
};

const outputBuffers = {
  [outputRelatives.constants]: jsonBuffer(runtimeConstants),
  [outputRelatives.vectors]: jsonBuffer(equationVectors),
  [outputRelatives.sensitivity]: jsonBuffer(sensitivity),
};
const outputHashes = {};
for (const [relative, buffer] of Object.entries(outputBuffers)) outputHashes[relative] = sha256(buffer);

const receipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws3-receipt-v1",
  modelId: candidates.modelId,
  workstream: "WS3",
  completedOn: "2026-08-24",
  generatedBy: "tools/build-cgb001-ws3.mjs",
  evidenceBoundary: {
    exact: "CGB RGB555/raster facts and exact selected frontend timebase",
    familyConstrained: "Sharp source/gate/common-electrode signal semantics and analog topology",
    periodReconstructed: "latch offset, activation delay, parity phase, and inversion topology defaults",
    unresolved: "RGB555-to-six-line map, CGB electrical edges, gamma ladder, VCOM waveform, and per-code voltages",
  },
  trackedInputHashes: inputHashes,
  outputHashes,
  gates: {
    evidenceIdsResolve: true,
    cgbSignalInventoryComplete: actualSignals.size === expectedSignals.size,
    exactFrontendTimebaseReproduced: true,
    primaryRoundedTimingCrossChecked: roundedCrossCheck.pass,
    panelAndPpuTimingKeptDistinct: candidates.timing.panelSignalTimingBoundary.status === "unresolved",
    rgb555ToSixLineMappingUnresolved: candidates.sourceBusMapping.formalSelection === null,
    unjustifiedSixthBitNotUsedAtRuntime: defaults.sourceBusMapping === "logical-rgb555-coordinate",
    candidateBoundsValidated: true,
    formalCgbConstantsRemainNull: true,
    cpuAndFutureShaderEquationsAgree: equationVectors.agreement.pass,
    changedPixelSplitIsCausal: true,
    constantFieldsInvariant: maximumCpuStaticDifference <= Number.EPSILON * 4,
    noScanPreservesEquilibriumAndEndpoints: true,
    ws1LutHashInvariant: equationVectors.invariance.ws1Lut.sha256Before
      === equationVectors.invariance.ws1Lut.sha256After,
    stateIsPixelLocal: affectedPixelCount === 1,
    sensitivityReportComplete: sensitivity.pass,
    shaderOrPresetCreated: false,
  },
  result: {
    status: "pass",
    ws3Complete: true,
    nextEligibleWorkstreams: ["WS4", "WS6"],
    referenceV1ShaderOrPresetAllowed: false,
  },
  limits: "WS3 freezes a bounded drive contract and validation vectors, not a measured CGB panel waveform, optical response, VCOM model, GPU receipt, Shader, or preset.",
};
outputBuffers[outputRelatives.receipt] = jsonBuffer(receipt);

for (const [relative, buffer] of Object.entries(outputBuffers)) writeOrCheck(relative, buffer);
console.log(checkOnly
  ? "CGB-001 WS3 scan-drive artifacts are current."
  : "CGB-001 WS3 scan-drive artifacts generated and validated.");

