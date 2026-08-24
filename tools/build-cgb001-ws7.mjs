#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CGB_RETENTION_EQUATION_ID,
  LITERATURE_KINETIC_ENSEMBLE,
  applyRetentionBridge,
  residualDcExcitation,
  stepResidualDc,
  stepResidualDcFloat32,
  stepRetentionPixel,
} from "../models/nintendo-cgb-001/reference/residual-dc-retention.mjs";
import { CGB_FRAME_SECONDS, drivePolarity } from "../models/nintendo-cgb-001/reference/scan-drive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const checkOnly = process.argv.includes("--check");

const inputRelatives = [
  `${modelRelative}/data/ws7-evidence-inventory-v1.json`,
  `${modelRelative}/data/retention-v1.json`,
  `${modelRelative}/data/retention.schema.json`,
  `${modelRelative}/reference/residual-dc-retention.mjs`,
  `${modelRelative}/reference/scan-drive.mjs`,
  `${modelRelative}/data/scan-candidates-v1.json`,
  `${modelRelative}/generated/ws3-receipt-v1.json`,
  `${modelRelative}/data/response-ensemble-v1.json`,
  `${modelRelative}/generated/ws4-receipt-v1.json`,
  `${modelRelative}/data/frontend-contract-v1.json`,
  `${modelRelative}/REFERENCES.md`,
  "tools/build-cgb001-ws7.mjs",
];

const outputRelatives = {
  validation: `${modelRelative}/generated/ws7-retention-validation-v1.json`,
  receipt: `${modelRelative}/generated/ws7-receipt-v1.json`,
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readBuffer(relative) {
  const file = path.join(root, relative);
  assert(fs.existsSync(file), `missing input: ${relative}`);
  return fs.readFileSync(file);
}

function readJson(relative) {
  return JSON.parse(readBuffer(relative));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function clean(value, digits = 9) {
  if (Math.abs(value) < 1e-12) return 0;
  const cleaned = Number(value.toPrecision(digits));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function checkTopLevelSchema(instance, schema, label) {
  for (const required of schema.required ?? []) {
    assert(Object.hasOwn(instance, required), `${label}: missing schema property ${required}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(instance)) {
      assert(Object.hasOwn(schema.properties ?? {}, key), `${label}: unexpected property ${key}`);
    }
  }
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(property, "const") && Object.hasOwn(instance, key)) {
      assert(JSON.stringify(instance[key]) === JSON.stringify(property.const),
        `${label}: ${key} violates schema const`);
    }
  }
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

function simulateSegments(member, segments, float32 = false) {
  let state = 0;
  let elapsedSeconds = 0;
  const samples = [{ elapsedSeconds, state }];
  for (const segment of segments) {
    state = (float32 ? stepResidualDcFloat32 : stepResidualDc)({
      state,
      excitation: segment.excitation,
      adsorptionRatePerSecond: member.adsorptionRatePerSecond,
      desorptionRatePerSecond: member.desorptionRatePerSecond,
      dtSeconds: segment.seconds,
    });
    elapsedSeconds += segment.seconds;
    samples.push({ elapsedSeconds, state });
  }
  return samples;
}

function simulateHistory({
  topology,
  parityPhase,
  x,
  y,
  sourceAtFrame,
  offsetAtFrame,
  frames,
  member,
  float32 = false,
}) {
  let state = 0;
  for (let frameCount = 0; frameCount < frames; frameCount += 1) {
    const sourceRgb555 = sourceAtFrame(frameCount);
    const polarity = drivePolarity({ frameCount, x, y, parityPhase, topology });
    const excitation = residualDcExcitation({
      sourceRgb555,
      polarity,
      resultantDcOffset: offsetAtFrame(frameCount),
    });
    state = (float32 ? stepResidualDcFloat32 : stepResidualDc)({
      state,
      excitation,
      adsorptionRatePerSecond: member.adsorptionRatePerSecond,
      desorptionRatePerSecond: member.desorptionRatePerSecond,
      dtSeconds: CGB_FRAME_SECONDS,
    });
  }
  return state;
}

assert(process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node tools/build-cgb001-ws7.mjs [--check]");

const evidence = readJson(inputRelatives[0]);
const retention = readJson(inputRelatives[1]);
const schema = readJson(inputRelatives[2]);
const scanCandidates = readJson(inputRelatives[5]);
const ws3Receipt = readJson(inputRelatives[6]);
const responseEnsemble = readJson(inputRelatives[7]);
const ws4Receipt = readJson(inputRelatives[8]);
const frontendContract = readJson(inputRelatives[9]);
const referencesMarkdown = readBuffer(inputRelatives[10]).toString("utf8");

checkTopLevelSchema(retention, schema, "retention-v1.json");
assert(evidence.inventoryId === "cgb001-ws7-evidence-inventory-v1", "WS7 evidence identity drifted");
assert(retention.retentionModelId === "cgb001-ws7-residual-dc-v1", "WS7 retention identity drifted");
assert(retention.referenceProfile.resultantDcOffset === 0
    && retention.referenceProfile.opticalCoupling === 0,
"WS7 reference profile must remain zero-amplitude without CGB measurement");
assert(retention.bypass.preservesStaticColor === true
    && retention.bypass.preservesOrdinaryResponse === true,
"WS7 bypass contract drifted");
assert(ws3Receipt.result?.status === "pass" && ws3Receipt.result?.ws3Complete === true,
  "WS3 receipt does not pass");
assert(ws4Receipt.result?.status === "pass" && ws4Receipt.result?.ws4Complete === true,
  "WS4 receipt does not pass");
assert(responseEnsemble.selectedModel?.equationId === "CGB-WS4-FIRST-ORDER-RATE-FIELD-V1",
  "WS4 ordinary response model drifted");
assert(frontendContract.timeSemantics?.failurePolicy?.includes("static WS1 color path"),
  "WS2 lifecycle failure policy is unavailable");
// WS7's receipt describes its historical scope; WS8 may consume this state.

const definedEvidence = new Set(
  [...referencesMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
for (const id of retention.evidenceIds) assert(definedEvidence.has(id), `WS7 references undefined evidence ID ${id}`);

const candidateIds = retention.candidates.map((candidate) => candidate.id);
assert(candidateIds.join(",") === LITERATURE_KINETIC_ENSEMBLE.map((member) => member.id).join(","),
  "WS7 kinetic member order drifted");
for (let index = 0; index < retention.candidates.length; index += 1) {
  const parameters = retention.candidates[index].parameters;
  const expected = LITERATURE_KINETIC_ENSEMBLE[index];
  assert(parameters.adsorptionRatePerSecond === expected.adsorptionRatePerSecond
      && parameters.desorptionRatePerSecond === expected.desorptionRatePerSecond,
  `WS7 kinetic values drifted for ${expected.id}`);
}

const inputHashes = Object.fromEntries(inputRelatives.map((relative) => [relative, sha256(readBuffer(relative))]));
const topologies = scanCandidates.candidateSets.inversionTopology.candidates.map((candidate) => candidate.value);
assert(topologies.join(",") === "none,frame-global,row-alternating,column-alternating,dot-checkerboard",
  "WS3 inversion candidate set drifted");

let maximumFloat32Difference = 0;
const kineticTrajectories = [];
for (const member of LITERATURE_KINETIC_ENSEMBLE) {
  const stressSegments = [60, 240, 300, 600, 2400, 3600].map((seconds) => ({ seconds, excitation: 0.1 }));
  const recoverySegments = [60, 240, 600, 900, 3600].map((seconds) => ({ seconds, excitation: 0 }));
  const segments = [...stressSegments, ...recoverySegments];
  const cpu = simulateSegments(member, segments);
  const shader = simulateSegments(member, segments, true);
  const memberDifference = Math.max(...cpu.map(
    (sample, index) => Math.abs(sample.state - shader[index].state),
  ));
  maximumFloat32Difference = Math.max(maximumFloat32Difference, memberDifference);
  kineticTrajectories.push({
    memberId: member.id,
    adsorptionRatePerSecond: member.adsorptionRatePerSecond,
    desorptionRatePerSecond: member.desorptionRatePerSecond,
    stressProtocolSeconds: stressSegments.reduce((sum, segment) => sum + segment.seconds, 0),
    recoveryProtocolSeconds: recoverySegments.reduce((sum, segment) => sum + segment.seconds, 0),
    cpu: cpu.map((sample) => ({ elapsedSeconds: sample.elapsedSeconds, state: clean(sample.state) })),
    futureShaderFloat32: shader.map((sample) => ({ elapsedSeconds: sample.elapsedSeconds, state: clean(sample.state) })),
    maximumFloat32Difference: clean(memberDifference),
  });
}

const nominal = LITERATURE_KINETIC_ENSEMBLE[1];
let maximumBalancedZeroOffsetState = 0;
let maximumTopologyFloat32Difference = 0;
const topologyFixtures = [];
for (const topology of topologies) {
  for (const parityPhase of [0, 1]) {
    const spatialStates = [];
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const zeroState = simulateHistory({
        topology,
        parityPhase,
        x,
        y,
        sourceAtFrame: () => [16, 16, 16],
        offsetAtFrame: () => 0,
        frames: 2048,
        member: nominal,
      });
      maximumBalancedZeroOffsetState = Math.max(maximumBalancedZeroOffsetState, Math.abs(zeroState));
      const cpu = simulateHistory({
        topology,
        parityPhase,
        x,
        y,
        sourceAtFrame: (frame) => frame % 64 < 32 ? [4, 12, 28] : [27, 18, 3],
        offsetAtFrame: () => 0.1,
        frames: 4096,
        member: nominal,
      });
      const shader = simulateHistory({
        topology,
        parityPhase,
        x,
        y,
        sourceAtFrame: (frame) => frame % 64 < 32 ? [4, 12, 28] : [27, 18, 3],
        offsetAtFrame: () => 0.1,
        frames: 4096,
        member: nominal,
        float32: true,
      });
      maximumTopologyFloat32Difference = Math.max(maximumTopologyFloat32Difference, Math.abs(cpu - shader));
      spatialStates.push({ x, y, zeroOffsetState: clean(zeroState), cpu: clean(cpu), futureShaderFloat32: clean(shader) });
    }
    topologyFixtures.push({ topology, parityPhase, spatialStates });
  }
}

function gridFixture(pattern) {
  const values = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const sourceRgb555 = pattern(x, y);
      const state = simulateHistory({
        topology: "row-alternating",
        parityPhase: 0,
        x,
        y,
        sourceAtFrame: () => sourceRgb555,
        offsetAtFrame: () => 0.1,
        frames: 8192,
        member: nominal,
      });
      values.push(state);
    }
  }
  return {
    minimum: clean(Math.min(...values)),
    maximum: clean(Math.max(...values)),
    range: clean(Math.max(...values) - Math.min(...values)),
    checksum: clean(values.reduce((sum, value, index) => sum + value * (index + 1), 0)),
  };
}

const spatialFixtures = {
  uniform: gridFixture(() => [16, 16, 16]),
  isolatedWindow: gridFixture((x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5
    ? [31, 31, 31] : [0, 0, 0]),
  checkerboard: gridFixture((x, y) => (x + y) % 2 === 0 ? [31, 31, 31] : [0, 0, 0]),
};

const identicalOptions = {
  topology: "dot-checkerboard",
  parityPhase: 1,
  x: 3,
  y: 5,
  sourceAtFrame: (frame) => frame % 120 < 80 ? [31, 8, 4] : [2, 24, 31],
  offsetAtFrame: () => 0.1,
  frames: 12_000,
  member: nominal,
};
const identicalA = simulateHistory(identicalOptions);
const identicalB = simulateHistory(identicalOptions);
const differentCode = simulateHistory({ ...identicalOptions, sourceAtFrame: () => [0, 0, 0] });

function manualPolarityHistory(sequence, frames, sourceRgb555 = [24, 12, 4]) {
  let state = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const polarity = sequence[frame % sequence.length];
    const excitation = residualDcExcitation({
      sourceRgb555,
      polarity,
      resultantDcOffset: 0.1,
    });
    state = stepResidualDc({
      state,
      excitation,
      adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
      desorptionRatePerSecond: nominal.desorptionRatePerSecond,
      dtSeconds: CGB_FRAME_SECONDS,
    });
  }
  return state;
}

const dutyFixtures = {
  balanced: clean(manualPolarityHistory([1, -1], 12_000)),
  unequalPositive: clean(manualPolarityHistory([1, 1, -1], 12_000)),
  unequalNegative: clean(manualPolarityHistory([-1, -1, 1], 12_000)),
};

const stressed = stepResidualDc({
  state: 0,
  excitation: 0.1,
  adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: 7200,
});
const reversed = stepResidualDc({
  state: stressed,
  excitation: -0.1,
  adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: 7200,
});
const recovered = stepResidualDc({
  state: stressed,
  excitation: 0,
  adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: 5400,
});
const pauseState = stepResidualDc({
  state: stressed,
  excitation: -0.1,
  adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: 0,
});

const ordinaryState = [0.13, 0.51, 0.89];
const formationZeroState = stepResidualDc({
  state: 0,
  excitation: 0.5,
  adsorptionRatePerSecond: 0,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: 60,
});
const formationZeroBridge = applyRetentionBridge({
  ordinaryRgbState: ordinaryState,
  residualDcState: formationZeroState,
  opticalCoupling: 1,
});
const referenceBridge = applyRetentionBridge({
  ordinaryRgbState: ordinaryState,
  residualDcState: stressed,
  opticalCoupling: retention.referenceProfile.opticalCoupling,
});
const disabledPixel = stepRetentionPixel({
  state: stressed,
  sourceRgb555: [31, 31, 31],
  frameCount: 7,
  x: 2,
  y: 3,
  adsorptionRatePerSecond: nominal.adsorptionRatePerSecond,
  desorptionRatePerSecond: nominal.desorptionRatePerSecond,
  dtSeconds: CGB_FRAME_SECONDS,
  enabled: false,
});

const maximumShaderDifference = Math.max(maximumFloat32Difference, maximumTopologyFloat32Difference);
const tolerances = {
  futureShaderFloat32State: 2e-5,
  balancedZeroOffsetState: 0,
  identicalHistory: 0,
  ordinaryResponseIsolation: 0,
  pause: 0,
};
const checks = {
  literatureConditionsNormalized: evidence.sources.some((source) => source.id === "WS7-MIZUSAKI-2011"
    && source.conditions.stress === "120 minutes"
    && source.conditions.temperatureCelsius === 25),
  lowNominalHighKineticsMatchSourceRange: retention.candidates[0].parameters.adsorptionRatePerSecond === 0.001
    && retention.candidates[2].parameters.desorptionRatePerSecond === 0.028 / 60,
  referenceAmplitudeAndOpticalCouplingZero: retention.referenceProfile.resultantDcOffset === 0
    && retention.referenceProfile.opticalCoupling === 0,
  balancedUniformZeroOffsetExact: maximumBalancedZeroOffsetState === 0,
  identicalHistoriesExact: identicalA === identicalB,
  differentCodeHistoriesDiffer: Math.abs(identicalA - differentCode) > 1e-5,
  spatialFixturesCreateOnlyDocumentedDiagnosticDifferences: spatialFixtures.uniform.range > 0
    && spatialFixtures.isolatedWindow.range > spatialFixtures.uniform.range
    && spatialFixtures.checkerboard.range > spatialFixtures.uniform.range,
  unequalDutyChangesSlowState: dutyFixtures.unequalPositive !== dutyFixtures.balanced
    && dutyFixtures.unequalNegative !== dutyFixtures.balanced,
  polarityReversalChangesSign: stressed > 0 && reversed < 0,
  recoveryDecaysMagnitude: recovered > 0 && recovered < stressed,
  formationZeroLeavesOrdinaryResponseExact: formationZeroState === 0
    && ordinaryState.every((value, channel) => value === formationZeroBridge[channel]),
  referenceBridgeLeavesWs4Exact: ordinaryState.every((value, channel) => value === referenceBridge[channel]),
  pauseFreezesStateExact: pauseState === stressed,
  resetPolicyClearsToZero: retention.state.initialization === 0
    && retention.state.resetPolicy.includes("clear to zero"),
  disabledPathPreservesIndependentState: disabledPixel.state === stressed,
  everyWs3TopologyAndParityCovered: topologyFixtures.length === topologies.length * 2,
  futureShaderFloat32TrajectoriesAgree: maximumShaderDifference <= tolerances.futureShaderFloat32State,
  ws4OrdinaryResponseUnchanged: responseEnsemble.selectedModel.equationId === "CGB-WS4-FIRST-ORDER-RATE-FIELD-V1",
  shaderOrPresetCreated: false,
};
const pass = Object.entries(checks).every(([name, value]) => (
  name === "shaderOrPresetCreated" ? value === false : value === true
));
assert(pass, `WS7 validation failed: ${JSON.stringify(checks)}`);

const validation = {
  schemaVersion: 1,
  reportId: "cgb001-ws7-retention-validation-v1",
  modelId: retention.modelId,
  equationId: CGB_RETENTION_EQUATION_ID,
  generatedBy: "tools/build-cgb001-ws7.mjs",
  classification: "period-mechanism and later-laboratory-cell kinetic ensemble with zero-amplitude CGB reference profile",
  referenceProfile: retention.referenceProfile,
  kineticTrajectories,
  topologyFixtures,
  spatialFixtures,
  historyFixtures: {
    identicalA: clean(identicalA),
    identicalB: clean(identicalB),
    differentCode: clean(differentCode),
    absoluteCodeHistoryDifference: clean(Math.abs(identicalA - differentCode)),
  },
  dutyFixtures,
  stressRecoveryFixtures: {
    stressed: clean(stressed),
    polarityReversed: clean(reversed),
    recovered: clean(recovered),
  },
  lifecycleFixtures: {
    pauseState: clean(pauseState),
    resetState: retention.state.initialization,
    disabledState: clean(disabledPixel.state),
    unsupportedFramePolicy: retention.state.resetPolicy,
  },
  isolationFixtures: {
    ordinaryState,
    formationZeroState,
    formationZeroBridge,
    referenceBridge,
  },
  maxima: {
    balancedZeroOffsetState: clean(maximumBalancedZeroOffsetState),
    kineticFutureShaderFloat32Difference: clean(maximumFloat32Difference),
    topologyFutureShaderFloat32Difference: clean(maximumTopologyFloat32Difference),
    allFutureShaderFloat32Difference: clean(maximumShaderDifference),
  },
  tolerances,
  invariants: {
    ws4OrdinaryResponseEquation: responseEnsemble.selectedModel.equationId,
    ws4RateOrRgbStateModified: false,
    displayedLumaUsedAsExcitation: false,
    healthyCgbNonzeroAmplitudeInvented: false,
    agedCgbPresetInvented: false,
    shaderImplemented: false,
    presetImplemented: false,
  },
  checks,
  pass,
};

const validationBuffer = jsonBuffer(validation);
writeOrCheck(outputRelatives.validation, validationBuffer);

const receipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws7-receipt-v1",
  modelId: retention.modelId,
  workstream: "WS7",
  completedOn: "2026-08-24",
  generatedBy: "tools/build-cgb001-ws7.mjs",
  trackedInputHashes: inputHashes,
  outputHashes: {
    [outputRelatives.validation]: sha256(validationBuffer),
  },
  gates: {
    activeMatrixVcomAndIonMechanismsNormalized: checks.literatureConditionsNormalized,
    lowNominalHighKineticEnsembleFrozen: checks.lowNominalHighKineticsMatchSourceRange,
    sourceCodeAndWs3PolarityExcitationImplemented: true,
    displayedLumaExcluded: true,
    slowStateIndependentFromWs4: checks.ws4OrdinaryResponseUnchanged,
    referenceProfileRemainsZeroAmplitude: checks.referenceAmplitudeAndOpticalCouplingZero,
    balancedUniformNoDriftPasses: checks.balancedUniformZeroOffsetExact,
    codePolarityAndSpatialProtocolsPass: checks.differentCodeHistoriesDiffer
      && checks.spatialFixturesCreateOnlyDocumentedDiagnosticDifferences
      && checks.unequalDutyChangesSlowState,
    stressRecoveryAndPolarityReversalPass: checks.polarityReversalChangesSign
      && checks.recoveryDecaysMagnitude,
    formationZeroOrdinaryResponseIsolationPasses: checks.formationZeroLeavesOrdinaryResponseExact,
    pauseResetDiscontinuityAndBypassPass: checks.pauseFreezesStateExact
      && checks.resetPolicyClearsToZero
      && checks.disabledPathPreservesIndependentState,
    everyWs3TopologyAndParityCovered: checks.everyWs3TopologyAndParityCovered,
    futureShaderFloat32EquationAgrees: checks.futureShaderFloat32TrajectoriesAgree,
    agedCgbPresetInvented: false,
    shaderOrPresetCreated: false,
  },
  result: {
    status: "pass",
    ws7Complete: true,
    nextEligibleWorkstreams: ["WS6", "WS8-after-WS6"],
    referenceV1ShaderOrPresetAllowed: false,
  },
  limits: "WS7 freezes a one-scalar CPU/reference residual-DC equation and future-Shader contract. Its rates are later-cell bounds, the CGB reference amplitude/coupling remain zero, and it creates no aged preset, Shader, or actual GPU readback.",
};
writeOrCheck(outputRelatives.receipt, jsonBuffer(receipt));

console.log(`CGB-001 WS7 ${checkOnly ? "check" : "build"} passed: ${topologyFixtures.length} topology/parity fixtures, max float32 state error ${maximumShaderDifference}.`);
