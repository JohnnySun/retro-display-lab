#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CGB_FRAME_SECONDS,
} from "../models/nintendo-cgb-001/reference/scan-drive.mjs";
import {
  CGB_WS5_EQUATION_ID,
  integrateNoScanFrame,
  integrateScannedFrame,
  normalizeByReferenceWhiteY,
  staticXyz,
} from "../models/nintendo-cgb-001/reference/reflected-exposure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const checkOnly = process.argv.includes("--check");

const inputRelatives = [
  `${modelRelative}/data/ws5-exposure-policy-v1.json`,
  `${modelRelative}/data/exposure-integration.schema.json`,
  `${modelRelative}/reference/reflected-exposure.mjs`,
  `${modelRelative}/data/frontend-contract-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/ws1-receipt-v1.json`,
  `${modelRelative}/generated/ws3-runtime-constants-v1.json`,
  `${modelRelative}/generated/ws3-receipt-v1.json`,
  `${modelRelative}/data/response-ensemble-v1.json`,
  `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.json`,
  `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.r32f`,
  `${modelRelative}/generated/ws4-receipt-v1.json`,
  `${modelRelative}/REFERENCES.md`,
  "tools/build-cgb001-ws5.mjs",
];

const outputRelatives = {
  equations: `${modelRelative}/generated/ws5-equation-vectors-v1.json`,
  convergence: `${modelRelative}/generated/ws5-quadrature-convergence-v1.json`,
  fixtures: `${modelRelative}/generated/ws5-scan-exposure-fixtures-v1.json`,
  receipt: `${modelRelative}/generated/ws5-receipt-v1.json`,
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

function maximumComponentDifference(a, b) {
  return Math.max(...a.map((value, component) => Math.abs(value - b[component])));
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function fixtureParameters(memberIndex, row, transition) {
  return {
    lutBuffer,
    rateBuffer,
    memberIndex,
    initialState: transition.previousRgb555.map((code) => code / 31),
    previousRgb555: transition.previousRgb555,
    currentRgb555: transition.currentRgb555,
    row,
    latchOffsetLines: 0,
    rowActivationDelayLines: 0,
    panels: policy.opticalIntegration.futureShaderContract.panelsPerNativeFrame,
    order: 2,
  };
}

assert(process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node tools/build-cgb001-ws5.mjs [--check]");

const policy = readJson(inputRelatives[0]);
const schema = readJson(inputRelatives[1]);
const frontendContract = readJson(inputRelatives[3]);
const lutDescriptor = readJson(inputRelatives[4]);
const lutBuffer = readBuffer(inputRelatives[5]);
const ws1Receipt = readJson(inputRelatives[6]);
const ws3Constants = readJson(inputRelatives[7]);
const ws3Receipt = readJson(inputRelatives[8]);
const responseEnsemble = readJson(inputRelatives[9]);
const rateDescriptor = readJson(inputRelatives[10]);
const rateBuffer = readBuffer(inputRelatives[11]);
const ws4Receipt = readJson(inputRelatives[12]);
const referencesMarkdown = readBuffer(inputRelatives[13]).toString("utf8");

checkTopLevelSchema(policy, schema, "ws5-exposure-policy-v1.json");
assert(policy.opticalIntegration.futureShaderContract.panelsPerNativeFrame === 32,
  "WS5 future-Shader quadrature density drifted");
assert(policy.opticalIntegration.futureShaderContract.method === "composite two-point Gauss-Legendre",
  "WS5 future-Shader quadrature rule drifted");
assert(policy.referenceCondition.illuminationAngleDegrees === 45
    && policy.referenceCondition.viewAngleDegrees === 0
    && policy.referenceCondition.runtimeAngleModel === false,
"WS5 fixed reference geometry drifted");
assert(policy.referenceCondition.azimuth.valueDegrees === null,
  "WS5 invented a numeric source azimuth");
assert(policy.opticalIntegration.targetCompensation === "none",
  "WS5 must not include target-display compensation");
assert(policy.observationInterval.secondsPerFrame === 70_224 / 4_194_304,
  "WS5 policy frame interval drifted");
assert(frontendContract.timeSemantics?.failurePolicy?.includes("static WS1 color path"),
  "WS2 fail-closed static path is unavailable");
assert(ws1Receipt.result?.status === "pass" && ws1Receipt.result?.ws1Complete === true,
  "WS1 receipt does not pass");
assert(ws3Receipt.result?.status === "pass" && ws3Receipt.result?.ws3Complete === true,
  "WS3 receipt does not pass");
assert(ws4Receipt.result?.status === "pass" && ws4Receipt.result?.ws4Complete === true,
  "WS4 receipt does not pass");
assert(ws3Constants.exactFrontendTimebase.frameSeconds === CGB_FRAME_SECONDS,
  "WS3/reference frame interval mismatch");
assert(responseEnsemble.selectedModel?.equationId === "CGB-WS4-FIRST-ORDER-RATE-FIELD-V1",
  "WS4 selected response equation drifted");
assert(responseEnsemble.runtimeArtifact?.sha256 === sha256(rateBuffer)
    && rateDescriptor.binary?.sha256 === sha256(rateBuffer),
  "WS4 packed rate identity drifted");
assert(lutDescriptor.sha256 === sha256(lutBuffer), "WS1 packed LUT identity drifted");
assert(lutDescriptor.channels?.[0]?.startsWith("X absolute relative reflectance")
    && lutDescriptor.channels?.[1]?.startsWith("Y absolute relative reflectance")
    && lutDescriptor.channels?.[2]?.startsWith("Z absolute relative reflectance"),
"WS1 runtime LUT is not the accepted absolute relative-reflectance XYZ field");
// WS5 remains the CPU/future-Shader equation contract. Accepted WS8 files are
// validated independently and do not alter this historical receipt.

const definedEvidence = new Set(
  [...referencesMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
for (const id of policy.evidenceIds) assert(definedEvidence.has(id), `WS5 references undefined evidence ID ${id}`);

const inputHashes = {};
for (const relative of inputRelatives) inputHashes[relative] = sha256(readBuffer(relative));

const memberIds = responseEnsemble.members.map((member) => member.id);
assert(memberIds.join(",") === "hcr-like-fast,mid-envelope-nominal,gh-like-slow",
  "WS4 member order drifted");
const curatedRows = policy.validationContract.visibleRows;
const curatedTransitions = [
  { id: "full-rise", previousRgb555: [0, 0, 0], currentRgb555: [31, 31, 31] },
  { id: "full-fall", previousRgb555: [31, 31, 31], currentRgb555: [0, 0, 0] },
  { id: "adjacent-gray-rise", previousRgb555: [15, 15, 15], currentRgb555: [16, 16, 16] },
  { id: "adjacent-gray-fall", previousRgb555: [16, 16, 16], currentRgb555: [15, 15, 15] },
  { id: "mixed-rgb", previousRgb555: [0, 15, 31], currentRgb555: [31, 16, 0] },
  { id: "primary-exchange", previousRgb555: [31, 0, 0], currentRgb555: [0, 31, 0] },
  { id: "partial-red", previousRgb555: [0, 15, 15], currentRgb555: [31, 15, 15] },
];

let maximumQuadratureError = 0;
let maximumFloat32VsDoubleError = 0;
let maximumFloat32VsExactError = 0;
let maximumEndpointFloat32Error = 0;
let nonFiniteCount = 0;
let outOfRangeCount = 0;
let worstQuadratureCase = null;
let worstFloat32Case = null;
const curatedVectors = [];
const exactCurated = [];

function recordEquationCase(id, parameters, storeVector) {
  const exact = integrateScannedFrame({ ...parameters, method: "exact" });
  const runtimeDouble = integrateScannedFrame({ ...parameters, method: "gauss-double" });
  const futureShaderFloat32 = integrateScannedFrame({ ...parameters, method: "gauss-float32" });
  const quadratureError = maximumComponentDifference(runtimeDouble.averageXyz, exact.averageXyz);
  const float32VsDoubleError = maximumComponentDifference(
    futureShaderFloat32.averageXyz,
    runtimeDouble.averageXyz,
  );
  const float32VsExactError = maximumComponentDifference(
    futureShaderFloat32.averageXyz,
    exact.averageXyz,
  );
  const endpointFloat32Error = maximumComponentDifference(
    futureShaderFloat32.endpoint,
    runtimeDouble.endpoint,
  );
  if (quadratureError > maximumQuadratureError) {
    maximumQuadratureError = quadratureError;
    worstQuadratureCase = { id, exactAverageXyz: exact.averageXyz, runtimeAverageXyz: runtimeDouble.averageXyz };
  }
  if (float32VsDoubleError > maximumFloat32VsDoubleError) {
    maximumFloat32VsDoubleError = float32VsDoubleError;
    worstFloat32Case = {
      id,
      runtimeAverageXyz: runtimeDouble.averageXyz,
      futureShaderFloat32AverageXyz: futureShaderFloat32.averageXyz,
    };
  }
  maximumFloat32VsExactError = Math.max(maximumFloat32VsExactError, float32VsExactError);
  maximumEndpointFloat32Error = Math.max(maximumEndpointFloat32Error, endpointFloat32Error);
  for (const value of [...exact.averageXyz, ...runtimeDouble.averageXyz,
    ...futureShaderFloat32.averageXyz, ...futureShaderFloat32.endpoint]) {
    if (!Number.isFinite(value)) nonFiniteCount += 1;
  }
  if (futureShaderFloat32.endpoint.some((value) => value < 0 || value > 1)) outOfRangeCount += 1;
  if (storeVector) {
    curatedVectors.push({
      id,
      memberId: memberIds[parameters.memberIndex],
      row: parameters.row,
      initialState: parameters.initialState,
      previousRgb555: parameters.previousRgb555,
      currentRgb555: parameters.currentRgb555,
      activationSeconds: exact.event.activationAbsoluteSeconds,
      exactAverageXyz: exact.averageXyz,
      runtimeAverageXyz: runtimeDouble.averageXyz,
      futureShaderFloat32AverageXyz: futureShaderFloat32.averageXyz,
      runtimeEndpoint: runtimeDouble.endpoint,
      futureShaderFloat32Endpoint: futureShaderFloat32.endpoint,
      quadratureError,
      float32VsDoubleError,
      float32VsExactError,
      endpointFloat32Error,
      segmentCount: exact.segments.length,
      futureShaderSampleCount: futureShaderFloat32.segments.reduce(
        (sum, segment) => sum + (segment.quadraturePanels ?? 0) * 2,
        0,
      ),
    });
    exactCurated.push({ id, parameters, exact });
  }
}

for (let memberIndex = 0; memberIndex < memberIds.length; memberIndex += 1) {
  for (const row of curatedRows) {
    for (const transition of curatedTransitions) {
      recordEquationCase(
        `curated/${memberIds[memberIndex]}/row-${row}/${transition.id}`,
        fixtureParameters(memberIndex, row, transition),
        true,
      );
    }
  }
}

let randomSeed = 0x5a17c9e3;
function randomUnit() {
  randomSeed = (Math.imul(randomSeed, 1_664_525) + 1_013_904_223) >>> 0;
  return randomSeed / 4_294_967_296;
}
const randomCaseCount = policy.validationContract.deterministicRandomCases;
for (let index = 0; index < randomCaseCount; index += 1) {
  const memberIndex = index % memberIds.length;
  const row = Math.floor(randomUnit() * 144);
  const initialState = [randomUnit(), randomUnit(), randomUnit()];
  const previousRgb555 = [0, 1, 2].map(() => Math.floor(randomUnit() * 32));
  const currentRgb555 = [0, 1, 2].map(() => Math.floor(randomUnit() * 32));
  recordEquationCase(`random/${index}`, {
    lutBuffer,
    rateBuffer,
    memberIndex,
    initialState,
    previousRgb555,
    currentRgb555,
    row,
    latchOffsetLines: 0,
    rowActivationDelayLines: 0,
    panels: 32,
    order: 2,
  }, false);
}

const equationFixtureCount = curatedVectors.length + randomCaseCount;
assert(maximumQuadratureError <= policy.validationContract.maximumQuadratureAbsoluteXyzError,
  `WS5 quadrature error ${maximumQuadratureError} exceeds its declared bound`);
assert(maximumFloat32VsDoubleError
    <= policy.validationContract.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError,
`WS5 future-Shader float32 error ${maximumFloat32VsDoubleError} exceeds its declared bound`);
assert(maximumEndpointFloat32Error
    <= policy.validationContract.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError,
`WS5 future-Shader endpoint error ${maximumEndpointFloat32Error} exceeds its declared bound`);
assert(nonFiniteCount === 0 && outOfRangeCount === 0,
  `WS5 equation safety failed: nonFinite=${nonFiniteCount}, outOfRange=${outOfRangeCount}`);

const equationReport = {
  schemaVersion: 1,
  reportId: "cgb001-ws5-equation-vectors-v1",
  modelId: policy.modelId,
  equationId: CGB_WS5_EQUATION_ID,
  classification: "cpu-analytic-gold-versus-future-shader-quadrature-receipt",
  sourcePolicy: { path: inputRelatives[0], sha256: inputHashes[inputRelatives[0]] },
  runtimeArtifacts: {
    ws1LutSha256: sha256(lutBuffer),
    ws4RateSha256: sha256(rateBuffer),
  },
  coverage: {
    curatedFixtureCount: curatedVectors.length,
    deterministicRandomFixtureCount: randomCaseCount,
    totalFixtureCount: equationFixtureCount,
    xyzComponentCases: equationFixtureCount * 3,
    rows: curatedRows,
    members: memberIds,
    transitions: curatedTransitions.map((transition) => transition.id),
    randomSeedHex: "0x5a17c9e3",
  },
  integrationMethods: {
    gold: policy.opticalIntegration.cpuGoldReference.method,
    runtimeDouble: "composite two-point Gauss-Legendre; 32 panels per native-frame duration",
    futureShaderFloat32: "independent binary32 transcription of the same fixed quadrature contract",
  },
  agreement: {
    maximumQuadratureAbsoluteXyzError: maximumQuadratureError,
    quadratureTolerance: policy.validationContract.maximumQuadratureAbsoluteXyzError,
    maximumFutureShaderFloat32VsDoubleAbsoluteXyzError: maximumFloat32VsDoubleError,
    futureShaderFloat32Tolerance:
      policy.validationContract.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError,
    maximumFutureShaderFloat32VsExactAbsoluteXyzError: maximumFloat32VsExactError,
    maximumEndpointFloat32AbsoluteError: maximumEndpointFloat32Error,
    worstQuadratureCase,
    worstFloat32Case,
    pass: true,
  },
  safety: {
    nonFiniteCount,
    endpointOutOfRangeCount: outOfRangeCount,
    noFutureSourceArgument: true,
    actualGpuReadback: false,
    pass: true,
  },
  curatedVectors,
  limits: "The float32 path is a future-Shader arithmetic contract, not compiled GPU readback. Actual GPU validation remains WS8/WS9.",
};
const equationReportBuffer = jsonBuffer(equationReport);

const panelDensities = [4, 8, 16, 24, 32, 48, 64, 128, 256];
const convergenceProfiles = [];
for (const panelsPerFrame of panelDensities) {
  let maximumAbsoluteXyzError = 0;
  let worstCase = null;
  let maximumSamplesPerPixelFrame = 0;
  for (const item of exactCurated) {
    const approximate = integrateScannedFrame({
      ...item.parameters,
      method: "gauss-double",
      panels: panelsPerFrame,
      order: 2,
    });
    const error = maximumComponentDifference(approximate.averageXyz, item.exact.averageXyz);
    const sampleCount = approximate.segments.reduce(
      (sum, segment) => sum + (segment.quadraturePanels ?? 0) * 2,
      0,
    );
    maximumSamplesPerPixelFrame = Math.max(maximumSamplesPerPixelFrame, sampleCount);
    if (error > maximumAbsoluteXyzError) {
      maximumAbsoluteXyzError = error;
      worstCase = item.id;
    }
  }
  convergenceProfiles.push({
    panelsPerNativeFrame: panelsPerFrame,
    maximumSamplesPerPixelFrame,
    maximumAbsoluteXyzError,
    worstCase,
  });
}
const selectedConvergence = convergenceProfiles.find((profile) => profile.panelsPerNativeFrame === 32);
const highDensityCrossCheck = convergenceProfiles.find((profile) => profile.panelsPerNativeFrame === 256);
assert(selectedConvergence.maximumAbsoluteXyzError
    <= policy.validationContract.maximumQuadratureAbsoluteXyzError,
  "WS5 selected quadrature density does not meet the declared error bound");
assert(highDensityCrossCheck.maximumAbsoluteXyzError <= 1e-6,
  "WS5 analytic reference and high-density independent quadrature disagree");

const fastestLastRow = curatedVectors.filter((vector) => vector.memberId === "hcr-like-fast"
  && vector.row === 143);
assert(fastestLastRow.length === curatedTransitions.length,
  "WS5 convergence coverage omits the fastest member at the last visible row");
const convergenceReport = {
  schemaVersion: 1,
  reportId: "cgb001-ws5-quadrature-convergence-v1",
  modelId: policy.modelId,
  equationId: CGB_WS5_EQUATION_ID,
  classification: "analytic-cell-crossing-reference-versus-fixed-quadrature-convergence",
  coverage: {
    fixturesPerProfile: exactCurated.length,
    profiles: panelDensities.length,
    includesFastestMemberLastVisibleRow: true,
    fastestLastRowFixtureIds: fastestLastRow.map((vector) => vector.id),
  },
  selectedContract: {
    order: 2,
    panelsPerNativeFrame: 32,
    panelAllocation: policy.opticalIntegration.futureShaderContract.panelAllocation,
    maximumSamplesPerPixelFrame: selectedConvergence.maximumSamplesPerPixelFrame,
    tolerance: policy.validationContract.maximumQuadratureAbsoluteXyzError,
  },
  profiles: convergenceProfiles,
  highDensityIndependentCrossCheck: {
    panelsPerNativeFrame: 256,
    maximumAbsoluteXyzError: highDensityCrossCheck.maximumAbsoluteXyzError,
    tolerance: 1e-6,
    pass: true,
  },
  pass: true,
};
const convergenceReportBuffer = jsonBuffer(convergenceReport);

const staticRgbFixtures = [
  [0, 0, 0],
  [8, 16, 24],
  [15, 15, 15],
  [31, 31, 31],
  [31, 0, 16],
];
let maximumStaticScanError = 0;
let maximumStaticNoScanError = 0;
let maximumRowZeroNoScanError = 0;
const staticFixtures = [];
for (let memberIndex = 0; memberIndex < memberIds.length; memberIndex += 1) {
  for (const row of curatedRows) {
    for (const rgb555 of staticRgbFixtures) {
      const expectedXyz = staticXyz(lutBuffer, rgb555);
      const initialState = rgb555.map((code) => code / 31);
      const scanned = integrateScannedFrame({
        lutBuffer,
        rateBuffer,
        memberIndex,
        initialState,
        previousRgb555: rgb555,
        currentRgb555: rgb555,
        row,
        method: "exact",
      });
      const noScan = integrateNoScanFrame({
        lutBuffer,
        rateBuffer,
        memberIndex,
        initialState,
        currentRgb555: rgb555,
        method: "exact",
      });
      const scanError = maximumComponentDifference(scanned.averageXyz, expectedXyz);
      const noScanError = maximumComponentDifference(noScan.averageXyz, expectedXyz);
      maximumStaticScanError = Math.max(maximumStaticScanError, scanError);
      maximumStaticNoScanError = Math.max(maximumStaticNoScanError, noScanError);
      staticFixtures.push({ memberId: memberIds[memberIndex], row, rgb555, expectedXyz,
        scannedAverageXyz: scanned.averageXyz, noScanAverageXyz: noScan.averageXyz,
        scanError, noScanError });
    }
  }
}
assert(maximumStaticScanError === 0 && maximumStaticNoScanError === 0,
  "WS5 static scan/no-scan equilibrium differs from the WS1 LUT");

const causalRows = [0, 71, 143];
const causalFixtures = [];
for (let memberIndex = 0; memberIndex < memberIds.length; memberIndex += 1) {
  for (const transition of curatedTransitions.filter((item) => ["full-rise", "full-fall"].includes(item.id))) {
    const rows = causalRows.map((row) => {
      const parameters = fixtureParameters(memberIndex, row, transition);
      const result = integrateScannedFrame({ ...parameters, method: "exact" });
      if (row === 0) {
        const noScan = integrateNoScanFrame({
          lutBuffer,
          rateBuffer,
          memberIndex,
          initialState: parameters.initialState,
          currentRgb555: transition.currentRgb555,
          method: "exact",
        });
        maximumRowZeroNoScanError = Math.max(maximumRowZeroNoScanError,
          maximumComponentDifference(result.averageXyz, noScan.averageXyz),
          maximumComponentDifference(result.endpoint, noScan.endpoint));
      }
      return { row, activationSeconds: result.event.activationAbsoluteSeconds,
        averageXyz: result.averageXyz, endpoint: result.endpoint };
    });
    const y = rows.map((item) => item.averageXyz[1]);
    if (transition.id === "full-rise") assert(y[0] > y[1] && y[1] > y[2],
      `${memberIds[memberIndex]} rise lost top>middle>bottom exposure ordering`);
    else assert(y[0] < y[1] && y[1] < y[2],
      `${memberIds[memberIndex]} fall lost top<middle<bottom exposure ordering`);
    causalFixtures.push({ memberId: memberIds[memberIndex], transitionId: transition.id, rows });
  }
}
assert(maximumRowZeroNoScanError === 0,
  "WS5 default row-zero activation differs from the full-frame no-scan path");

for (const row of causalRows) {
  const riseY = memberIds.map((_memberId, memberIndex) => causalFixtures.find((fixture) => (
    fixture.memberId === memberIds[memberIndex] && fixture.transitionId === "full-rise"
  )).rows.find((item) => item.row === row).averageXyz[1]);
  const fallY = memberIds.map((_memberId, memberIndex) => causalFixtures.find((fixture) => (
    fixture.memberId === memberIds[memberIndex] && fixture.transitionId === "full-fall"
  )).rows.find((item) => item.row === row).averageXyz[1]);
  assert(riseY[0] > riseY[1] && riseY[1] > riseY[2],
    `WS5 row ${row} rise lost fast>nominal>slow exposure ordering`);
  assert(fallY[0] < fallY[1] && fallY[1] < fallY[2],
    `WS5 row ${row} fall lost fast<nominal<slow exposure ordering`);
}

function runPrefix(sequence) {
  let state = sequence[0].map((code) => code / 31);
  let previous = sequence[0];
  const output = [];
  for (let frame = 1; frame < sequence.length; frame += 1) {
    const result = integrateScannedFrame({
      lutBuffer,
      rateBuffer,
      memberIndex: 1,
      initialState: state,
      previousRgb555: previous,
      currentRgb555: sequence[frame],
      row: 71,
      method: "exact",
    });
    output.push({ endpoint: result.endpoint, averageXyz: result.averageXyz });
    state = result.endpoint;
    previous = sequence[frame];
  }
  return output;
}
const sharedPrefix = [[0, 0, 0], [31, 31, 31], [7, 24, 12], [24, 7, 20]];
const prefixA = runPrefix([...sharedPrefix, [31, 0, 31]]);
const prefixB = runPrefix([...sharedPrefix, [0, 31, 0]]);
let futureGhostMaximumDifference = 0;
for (let frame = 0; frame < sharedPrefix.length - 1; frame += 1) {
  futureGhostMaximumDifference = Math.max(futureGhostMaximumDifference,
    maximumComponentDifference(prefixA[frame].endpoint, prefixB[frame].endpoint),
    maximumComponentDifference(prefixA[frame].averageXyz, prefixB[frame].averageXyz));
}
assert(futureGhostMaximumDifference === 0, "WS5 exposure depends on a future source frame");

const blackXyz = staticXyz(lutBuffer, [0, 0, 0]);
const whiteXyz = staticXyz(lutBuffer, [31, 31, 31]);
const normalizedWhiteXyz = normalizeByReferenceWhiteY(whiteXyz, lutBuffer);
assert(normalizedWhiteXyz[1] === 1, "WS5 optional host-normalized white Y is not exact unity");
const fixtureReport = {
  schemaVersion: 1,
  reportId: "cgb001-ws5-scan-exposure-fixtures-v1",
  modelId: policy.modelId,
  equationId: CGB_WS5_EQUATION_ID,
  classification: "deterministic-cpu-reflected-exposure-fixtures-not-device-capture",
  referenceCondition: policy.referenceCondition,
  outputCoordinates: {
    physicalReflectance: {
      blackXyz,
      whiteXyz,
      units: "absolute relative-reflectance XYZ under the accepted D65 integration",
    },
    referenceWhiteYNormalized: {
      divisor: whiteXyz[1],
      blackXyz: normalizeByReferenceWhiteY(blackXyz, lutBuffer),
      whiteXyz: normalizedWhiteXyz,
      clipped: false,
      targetDeviceSpecific: false,
    },
  },
  staticCoverage: {
    fixtureCount: staticFixtures.length,
    members: memberIds,
    rows: curatedRows,
    rgb555: staticRgbFixtures,
    maximumStaticScanError,
    maximumStaticNoScanError,
    fixtures: staticFixtures,
  },
  causalCoverage: {
    rows: causalRows,
    fixtureCount: causalFixtures.length,
    maximumRowZeroNoScanError,
    fixtures: causalFixtures,
  },
  futureFrameIsolation: {
    sharedCommittedFrameCount: sharedPrefix.length,
    maximumPrefixDifference: futureGhostMaximumDifference,
    pass: true,
  },
  invariants: {
    ws1LutSha256Before: sha256(lutBuffer),
    ws1LutSha256After: sha256(readBuffer(inputRelatives[5])),
    ws4RateSha256Before: sha256(rateBuffer),
    ws4RateSha256After: sha256(readBuffer(inputRelatives[11])),
    secondAngleOrReflectorGainApplied: false,
    targetCompensationApplied: false,
    shaderImplemented: false,
    retentionStateCreated: false,
  },
  pass: true,
};
const fixtureReportBuffer = jsonBuffer(fixtureReport);

const outputBuffers = {
  [outputRelatives.equations]: equationReportBuffer,
  [outputRelatives.convergence]: convergenceReportBuffer,
  [outputRelatives.fixtures]: fixtureReportBuffer,
};
const outputHashes = {};
for (const [relative, buffer] of Object.entries(outputBuffers)) outputHashes[relative] = sha256(buffer);

const receipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws5-receipt-v1",
  modelId: policy.modelId,
  workstream: "WS5",
  completedOn: "2026-08-24",
  generatedBy: "tools/build-cgb001-ws5.mjs",
  trackedInputHashes: inputHashes,
  outputHashes,
  gates: {
    ws1Ws3Ws4ReceiptsPass: true,
    exactNativeObservationIntervalUsed: CGB_FRAME_SECONDS === 70_224 / 4_194_304,
    fixedD65FortyFiveZeroGeometryInheritedOnce: true,
    numericAzimuthNotInvented: policy.referenceCondition.azimuth.valueDegrees === null,
    previousAndCurrentSegmentsRespectRowActivation: true,
    continuousStateEvaluatesWs1ColorBeforeTimeAverage: true,
    analyticCellCrossingCpuGoldImplemented: true,
    selectedQuadratureMeetsDeclaredError: selectedConvergence.maximumAbsoluteXyzError
      <= policy.validationContract.maximumQuadratureAbsoluteXyzError,
    futureShaderFloat32EquationAgrees: maximumFloat32VsDoubleError
      <= policy.validationContract.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError,
    fastestLastVisibleRowConvergenceCovered: fastestLastRow.length === curatedTransitions.length,
    scanAndNoScanEquilibriaMatchWs1Exactly: maximumStaticScanError === 0
      && maximumStaticNoScanError === 0,
    rowZeroAndNoScanTransitionAgreeExactly: maximumRowZeroNoScanError === 0,
    topMiddleBottomCausalOrderingPasses: true,
    fastNominalSlowExposureOrderingPasses: true,
    noFutureFrameGhosts: futureGhostMaximumDifference === 0,
    physicalAndHostNormalizedCoordinatesSeparated: true,
    ws1LutAndWs4RateHashesInvariant: true,
    targetCompensationApplied: false,
    runtimeAngleModelCreated: false,
    retentionStateCreated: false,
    shaderOrPresetCreated: false,
  },
  result: {
    status: "pass",
    ws5Complete: true,
    nextEligibleWorkstreams: ["WS6", "WS7"],
    referenceV1ShaderOrPresetAllowed: false,
  },
  limits: "WS5 is a fixed-angle CPU/reference exposure-integration and future-Shader equation contract. It is not actual GPU readback, an angle-aware BRDF, target-display compensation, aperture composition, retention, Shader, or preset.",
};
outputBuffers[outputRelatives.receipt] = jsonBuffer(receipt);

for (const [relative, buffer] of Object.entries(outputBuffers)) writeOrCheck(relative, buffer);
console.log(checkOnly
  ? "CGB-001 WS5 reflected-exposure artifacts are current."
  : "CGB-001 WS5 reflected-exposure integration generated and validated.");
