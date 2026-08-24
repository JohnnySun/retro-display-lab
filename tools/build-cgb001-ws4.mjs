#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CGB_WS4_CHANNELS,
  CGB_WS4_CODE_COUNT,
  CGB_WS4_EQUATION_ID,
  CGB_WS4_SNAP_EPSILON,
  cascadeRateForT10To90Milliseconds,
  cascadeUnitStep,
  commandCoordinate,
  stepFirstOrder,
  t10To90MillisecondsFromRate,
  transitionParameters,
} from "../models/nintendo-cgb-001/reference/optical-response.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const checkOnly = process.argv.includes("--check");

const inputRelatives = [
  `${modelRelative}/data/ws4-evidence-inventory-v1.json`,
  `${modelRelative}/data/ws4-response-policy-v1.json`,
  `${modelRelative}/data/response-ensemble.schema.json`,
  `${modelRelative}/reference/optical-response.mjs`,
  `${modelRelative}/generated/ws3-runtime-constants-v1.json`,
  `${modelRelative}/generated/ws3-receipt-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/ws1-receipt-v1.json`,
  `${modelRelative}/REFERENCES.md`,
  "tools/build-cgb001-ws4.mjs",
];

const outputRelatives = {
  ensemble: `${modelRelative}/data/response-ensemble-v1.json`,
  binary: `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.r32f`,
  descriptor: `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.json`,
  selection: `${modelRelative}/generated/ws4-model-selection-v1.json`,
  equations: `${modelRelative}/generated/ws4-equation-vectors-v1.json`,
  motion: `${modelRelative}/generated/ws4-motion-fixtures-v1.json`,
  receipt: `${modelRelative}/generated/ws4-receipt-v1.json`,
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

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((item) => expected.has(item));
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

function f32(value) {
  return Math.fround(value);
}

// Independent binary32 transcription of the future Shader equation. It does
// not call stepFirstOrder and consumes the packed float32 rate table.
function shaderFloatStep(state, target, ratePerSecond, seconds) {
  const current = f32(Math.min(1, Math.max(0, state)));
  const destination = f32(Math.min(1, Math.max(0, target)));
  const rate = f32(ratePerSecond);
  const duration = f32(seconds);
  const snap = f32(CGB_WS4_SNAP_EPSILON);
  if (current === destination || duration === 0) return current === destination ? destination : current;
  const exponent = f32(-f32(rate * duration));
  const decay = f32(Math.exp(exponent));
  const next = f32(destination + f32(f32(current - destination) * decay));
  if (Math.abs(f32(destination - next)) <= snap) return destination;
  return f32(Math.min(Math.max(next, Math.min(current, destination)), Math.max(current, destination)));
}

function cascadeTimeAtFraction(ratePerSecond, fraction) {
  let low = 0;
  let high = 2;
  while (cascadeUnitStep(ratePerSecond, high) < fraction) high *= 2;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = 0.5 * (low + high);
    if (cascadeUnitStep(ratePerSecond, middle) < fraction) low = middle;
    else high = middle;
  }
  return 0.5 * (low + high);
}

function lutEntryHex(lutBuffer, rgb) {
  const [r, g, b] = rgb;
  const voxel = (b * 32 + g) * 32 + r;
  return lutBuffer.subarray(voxel * 16, voxel * 16 + 16).toString("hex");
}

assert(process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node tools/build-cgb001-ws4.mjs [--check]");

const evidence = readJson(inputRelatives[0]);
const policy = readJson(inputRelatives[1]);
const schema = readJson(inputRelatives[2]);
const ws3Constants = readJson(inputRelatives[4]);
const ws3Receipt = readJson(inputRelatives[5]);
const lutDescriptor = readJson(inputRelatives[6]);
const lutBuffer = readBuffer(inputRelatives[7]);
const ws1Receipt = readJson(inputRelatives[8]);
const referencesMarkdown = readBuffer(inputRelatives[9]).toString("utf8");

assert(evidence.inventoryId === "cgb001-ws4-evidence-inventory-v1", "invalid WS4 evidence inventory");
assert(policy.policyId === "cgb001-ws4-response-policy-v1", "invalid WS4 response policy");
assert(policy.selection?.equationId === CGB_WS4_EQUATION_ID, "policy/reference equation ID mismatch");
assert(policy.state?.snapEpsilon?.value === CGB_WS4_SNAP_EPSILON, "policy/reference snap epsilon mismatch");
const evidenceClasses = new Set(evidence.classificationOrder);
const evidenceItemIds = new Set();
for (const item of evidence.items) {
  assert(!evidenceItemIds.has(item.itemId), `duplicate evidence item ${item.itemId}`);
  evidenceItemIds.add(item.itemId);
  assert(evidenceClasses.has(item.classification), `${item.itemId}: unknown evidence class`);
  assert(Array.isArray(item.claimsUsed), `${item.itemId}: claimsUsed must be an array`);
  assert(typeof item.limits === "string" && item.limits.length > 0, `${item.itemId}: limits missing`);
}
const definedEvidence = new Set(
  [...referencesMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
for (const id of new Set([...policy.evidenceIds, ...evidence.items.map((item) => item.evidenceId)])) {
  assert(definedEvidence.has(id), `WS4 references undefined evidence ID ${id}`);
}
assert(policy.familyAnchors.HCR.onAndOffMilliseconds === 50
    && policy.familyAnchors.HCR.grayScalesMilliseconds === 80,
"HCR family anchors drifted");
assert(policy.familyAnchors.GH.onAndOffMilliseconds === 80
    && policy.familyAnchors.GH.grayScalesMilliseconds === 150,
"GH family anchors drifted");
assert(policy.runtimeResponseDefinition.classification === "period-reconstructed-conversion",
  "runtime timing conversion is not explicitly reconstructed");
assert(policy.members.length === 3, "WS4 policy must have exactly three members");
assert(policy.members.map((member) => member.role).join(",") === "fast,nominal,slow",
  "WS4 members must remain ordered fast, nominal, slow");
for (let index = 1; index < policy.members.length; index += 1) {
  assert(policy.members[index].parameters.onAndOffT10To90Milliseconds
      > policy.members[index - 1].parameters.onAndOffT10To90Milliseconds,
  "on/off member bounds must increase fast < nominal < slow");
  assert(policy.members[index].parameters.grayT10To90Milliseconds
      > policy.members[index - 1].parameters.grayT10To90Milliseconds,
  "gray member bounds must increase fast < nominal < slow");
}
assert(policy.heldNeutralDimensions.channelMultipliers.r === 1
    && policy.heldNeutralDimensions.channelMultipliers.g === 1
    && policy.heldNeutralDimensions.channelMultipliers.b === 1,
"unsupported channel differences must remain neutral");
assert(policy.heldNeutralDimensions.referenceTemperatureC.runtimeCoefficientAvailable === false,
  "WS4 must not invent a temperature coefficient");
assert(policy.specimenOverride.shaderInterfaceChangesRequired === false
    && policy.specimenOverride.currentMeasuredCellCount === 0,
"WS4 specimen override boundary drifted");
assert(ws3Receipt.result?.status === "pass" && ws3Receipt.result?.ws3Complete === true,
  "WS3 receipt does not pass");
assert(ws1Receipt.result?.status === "pass" && ws1Receipt.result?.ws1Complete === true,
  "WS1 receipt does not pass");
const frameSeconds = ws3Constants.exactFrontendTimebase?.frameSeconds;
const lineSeconds = ws3Constants.exactFrontendTimebase?.lineSeconds;
assert(frameSeconds === 70_224 / 4_194_304 && lineSeconds === 456 / 4_194_304,
  "WS3 exact timebase is unavailable or drifted");
assert(lutBuffer.length === 32 ** 3 * 16, "WS1 LUT byte length drifted");
const lutSha256 = sha256(lutBuffer);
assert(lutSha256 === lutDescriptor.sha256, "WS1 LUT hash differs from its descriptor");
assert(ws1Receipt.outputHashes?.[`${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`] === lutSha256,
  "WS1 receipt does not pin the accepted LUT");
// The WS4 receipt retains its historical no-Shader claim; WS8 may now provide
// the separately hashed integration without changing this rate artifact.

const inputHashes = {};
for (const relative of inputRelatives) inputHashes[relative] = sha256(readBuffer(relative));

const cells = [];
const cellCount = policy.members.length * CGB_WS4_CHANNELS.length * CGB_WS4_CODE_COUNT ** 2;
const rateBinary = Buffer.alloc(cellCount * 4);
let binaryOffset = 0;
let minimumRatePerSecond = Infinity;
let maximumRatePerSecond = -Infinity;
let maximumFloat32RateRelativeError = 0;
const perMemberCoverage = [];
for (let memberIndex = 0; memberIndex < policy.members.length; memberIndex += 1) {
  const member = policy.members[memberIndex];
  let memberMinimumRate = Infinity;
  let memberMaximumRate = -Infinity;
  let reconstructedTransitionCells = 0;
  let identityCells = 0;
  for (let channelIndex = 0; channelIndex < CGB_WS4_CHANNELS.length; channelIndex += 1) {
    const channel = CGB_WS4_CHANNELS[channelIndex];
    for (let fromCode = 0; fromCode < CGB_WS4_CODE_COUNT; fromCode += 1) {
      for (let toCode = 0; toCode < CGB_WS4_CODE_COUNT; toCode += 1) {
        const parameters = transitionParameters(member, fromCode, toCode);
        const packedRate = f32(parameters.ratePerSecond);
        rateBinary.writeFloatLE(packedRate, binaryOffset);
        const linearIndex = binaryOffset / 4;
        binaryOffset += 4;
        minimumRatePerSecond = Math.min(minimumRatePerSecond, packedRate);
        maximumRatePerSecond = Math.max(maximumRatePerSecond, packedRate);
        memberMinimumRate = Math.min(memberMinimumRate, packedRate);
        memberMaximumRate = Math.max(memberMaximumRate, packedRate);
        maximumFloat32RateRelativeError = Math.max(maximumFloat32RateRelativeError,
          Math.abs(packedRate - parameters.ratePerSecond) / parameters.ratePerSecond);
        if (parameters.direction === "identity") identityCells += 1;
        else reconstructedTransitionCells += 1;
        cells.push({
          id: `${member.id}/${channel}/${fromCode}>${toCode}`,
          linearIndex,
          address: { memberIndex, memberId: member.id, channelIndex, channel, fromCode, toCode },
          direction: parameters.direction,
          distance: parameters.distance,
          grayWeight: parameters.grayWeight,
          t10To90Milliseconds: parameters.t10To90Milliseconds,
          ratePerSecond: parameters.ratePerSecond,
          packedFloat32RatePerSecond: packedRate,
          provenanceId: parameters.direction === "identity" ? "derived-identity-anchor" : "period-reconstructed-cell",
          fallbackId: "policy-analytic-rate-field",
        });
      }
    }
  }
  perMemberCoverage.push({
    memberId: member.id,
    cells: CGB_WS4_CHANNELS.length * CGB_WS4_CODE_COUNT ** 2,
    reconstructedTransitionCells,
    identityCells,
    measuredOverrideCells: 0,
    minimumRatePerSecond: memberMinimumRate,
    maximumRatePerSecond: memberMaximumRate,
  });
}
assert(binaryOffset === rateBinary.length && cells.length === 9_216,
  "WS4 did not generate exactly 3 members x 3 channels x 32 x 32 cells");

for (let memberIndex = 0; memberIndex < policy.members.length; memberIndex += 1) {
  for (let fromCode = 0; fromCode < 32; fromCode += 1) {
    for (let toCode = 0; toCode < 32; toCode += 1) {
      const base = (((memberIndex * 3) * 32 + fromCode) * 32 + toCode) * 4;
      const rates = [0, 1, 2].map((channelIndex) => rateBinary.readFloatLE(
        base + channelIndex * 32 * 32 * 4,
      ));
      assert(rates[0] === rates[1] && rates[1] === rates[2],
        "held-neutral channel rate tables differ");
    }
  }
}

const descriptor = {
  schemaVersion: 1,
  artifactId: "cgb001-ws4-gtg-rates-v1",
  modelId: policy.modelId,
  classification: "period-reconstructed-runtime-rate-field",
  sourcePolicy: { path: "../data/ws4-response-policy-v1.json", sha256: inputHashes[inputRelatives[1]] },
  evidenceInventory: { path: "../data/ws4-evidence-inventory-v1.json", sha256: inputHashes[inputRelatives[0]] },
  binary: {
    path: "cgb001-ws4-gtg-rates-v1.r32f",
    sha256: sha256(rateBinary),
    byteLength: rateBinary.length,
    format: "little-endian R32_SFLOAT",
  },
  dimensions: [3, 3, 32, 32],
  axisOrder: "member, channel, fromCode, toCode; toCode fastest",
  members: policy.members.map(({ id, role }) => ({ id, role })),
  channels: CGB_WS4_CHANNELS,
  equationId: CGB_WS4_EQUATION_ID,
  responseDefinition: policy.runtimeResponseDefinition,
  coverage: {
    generatedCells: cells.length,
    measuredOverrideCells: 0,
    reconstructedTransitionCells: perMemberCoverage.reduce((sum, item) => sum + item.reconstructedTransitionCells, 0),
    derivedIdentityCells: perMemberCoverage.reduce((sum, item) => sum + item.identityCells, 0),
    runtimeFallbackCells: 0,
    minimumRatePerSecond,
    maximumRatePerSecond,
    maximumFloat32RateRelativeError,
    perMember: perMemberCoverage,
  },
  provenanceDictionary: {
    "period-reconstructed-cell": {
      equationId: CGB_WS4_EQUATION_ID,
      sourceClass: "period-reconstructed-from-Sharp-family-bounds",
      parameterRangeId: "data/ws4-response-policy-v1.json#members",
      evidenceIds: ["CGB-SHARP-HRTFT-1997"],
      fallbackBehavior: "regenerate the addressed cell from the normalized policy rate field",
    },
    "derived-identity-anchor": {
      equationId: CGB_WS4_EQUATION_ID,
      sourceClass: "derived-identity-anchor",
      parameterRangeId: "data/ws4-response-policy-v1.json#rateField.identityCell",
      evidenceIds: ["CGB-SHARP-HRTFT-1997"],
      fallbackBehavior: "state==target bypasses rate evaluation and returns the target exactly",
    },
  },
  fallbackDictionary: {
    "policy-analytic-rate-field": policy.rateField,
  },
  specimenOverrideContract: policy.specimenOverride,
  cells,
};
const descriptorBuffer = jsonBuffer(descriptor);

const anchorFixtures = [];
let maximumAnchorErrorMilliseconds = 0;
for (const member of policy.members) {
  for (const fixture of [
    { id: "full-increasing", fromCode: 0, toCode: 31, expected: member.parameters.onAndOffT10To90Milliseconds },
    { id: "full-decreasing", fromCode: 31, toCode: 0, expected: member.parameters.onAndOffT10To90Milliseconds },
    { id: "middle-adjacent-increasing", fromCode: 15, toCode: 16, expected: member.parameters.grayT10To90Milliseconds },
    { id: "middle-adjacent-decreasing", fromCode: 16, toCode: 15, expected: member.parameters.grayT10To90Milliseconds },
  ]) {
    const parameters = transitionParameters(member, fixture.fromCode, fixture.toCode);
    const actual = t10To90MillisecondsFromRate(parameters.ratePerSecond);
    const packedActual = t10To90MillisecondsFromRate(f32(parameters.ratePerSecond));
    const absoluteErrorMilliseconds = Math.abs(actual - fixture.expected);
    maximumAnchorErrorMilliseconds = Math.max(maximumAnchorErrorMilliseconds, absoluteErrorMilliseconds);
    anchorFixtures.push({ memberId: member.id, ...fixture, actual, packedFloat32Actual: packedActual,
      absoluteErrorMilliseconds, packedAbsoluteErrorMilliseconds: Math.abs(packedActual - fixture.expected) });
  }
}
assert(maximumAnchorErrorMilliseconds <= 1e-12, "selected model does not reproduce declared anchors");

const twoStateAnchorFixtures = [];
let maximumTwoStateAnchorErrorMilliseconds = 0;
for (const anchor of anchorFixtures) {
  const rate = cascadeRateForT10To90Milliseconds(anchor.expected);
  const actual = (cascadeTimeAtFraction(rate, 0.9) - cascadeTimeAtFraction(rate, 0.1)) * 1_000;
  maximumTwoStateAnchorErrorMilliseconds = Math.max(maximumTwoStateAnchorErrorMilliseconds,
    Math.abs(actual - anchor.expected));
  twoStateAnchorFixtures.push({
    memberId: anchor.memberId,
    fixtureId: anchor.id,
    expectedMilliseconds: anchor.expected,
    equalCascadeRatePerSecond: rate,
    actualMilliseconds: actual,
    absoluteErrorMilliseconds: Math.abs(actual - anchor.expected),
  });
}

const modelSelection = {
  schemaVersion: 1,
  reportId: "cgb001-ws4-model-selection-v1",
  modelId: policy.modelId,
  classification: "period-model-selection-not-panel-identification",
  evidenceInventory: { path: inputRelatives[0], sha256: inputHashes[inputRelatives[0]] },
  sourceResponseDefinition: {
    reportedLabels: ["on and off", "gray scales"],
    thresholdDefinition: null,
    directionSeparation: null,
    grayPair: null,
    temperatureC: null,
  },
  commonCompatibilityDefinition: policy.runtimeResponseDefinition,
  candidates: [
    {
      candidateId: "symmetric-first-order-rate-field",
      stateCountPerChannel: 1,
      independentDirectionParametersPerMember: 0,
      maximumScalarAnchorErrorMilliseconds: maximumAnchorErrorMilliseconds,
      monotone: true,
      bounded: true,
      exactFixedPoint: true,
      identifiableFromAcceptedEvidence: "scalar anchors only; interior rate field remains reconstructed",
      selection: "selected",
      reason: "Smallest causal model that matches all accepted scalar compatibility anchors; table rates remain replaceable by future measurements.",
    },
    {
      candidateId: "asymmetric-first-order-rate-field",
      stateCountPerChannel: 1,
      independentDirectionParametersPerMember: 2,
      maximumScalarAnchorErrorMilliseconds: maximumAnchorErrorMilliseconds,
      monotone: true,
      bounded: true,
      exactFixedPoint: true,
      identifiableFromAcceptedEvidence: false,
      selection: "rejected-for-default",
      reason: "It can duplicate the symmetric fit, but the source reports no direction split, so two added directional parameters are unconstrained.",
    },
    {
      candidateId: "two-state-cascade",
      stateCountPerChannel: 2,
      independentDirectionParametersPerMember: 0,
      maximumScalarAnchorErrorMilliseconds: maximumTwoStateAnchorErrorMilliseconds,
      monotone: true,
      bounded: true,
      exactFixedPoint: true,
      identifiableFromAcceptedEvidence: false,
      selection: "rejected-for-default",
      reason: "An equal-rate cascade can match every scalar interval, but the hidden-state split is non-unique without a waveform; adding it would claim unsupported shape.",
    },
  ],
  selectedCandidate: policy.selection.selectedCandidate,
  anchorFixtures,
  twoStateAnchorFixtures,
  rejectedRuntimeFeatures: policy.selection.rejectedFeatures,
  pass: true,
};
const modelSelectionBuffer = jsonBuffer(modelSelection);

const fixedTimesteps = [0, lineSeconds, frameSeconds / 4, frameSeconds, 3 * frameSeconds];
const aggregateMap = new Map();
const exemplarPairs = new Set(["0>31", "31>0", "15>16", "16>15", "7>24"]);
const exemplars = [];
let equationCaseCount = 0;
let maximumCpuFutureShaderAbsoluteError = 0;
let nonFiniteCount = 0;
let outOfBoundsCount = 0;
let nonMonotoneCount = 0;
let identityMismatchCount = 0;
let worstCase = null;
for (const cell of cells) {
  const start = commandCoordinate(cell.address.fromCode);
  const target = commandCoordinate(cell.address.toCode);
  const aggregateId = `${cell.address.memberId}/${cell.address.channel}`;
  const aggregate = aggregateMap.get(aggregateId) ?? {
    memberId: cell.address.memberId,
    channel: cell.address.channel,
    cases: 0,
    maximumAbsoluteError: 0,
  };
  for (const seconds of fixedTimesteps) {
    const cpu = stepFirstOrder(start, target, cell.packedFloat32RatePerSecond, seconds);
    const shader = shaderFloatStep(start, target, cell.packedFloat32RatePerSecond, seconds);
    const absoluteError = Math.abs(cpu - shader);
    if (!Number.isFinite(cpu) || !Number.isFinite(shader)) nonFiniteCount += 1;
    const minimum = Math.min(start, target);
    const maximum = Math.max(start, target);
    const shaderMinimum = Math.min(f32(start), f32(target));
    const shaderMaximum = Math.max(f32(start), f32(target));
    if (cpu < minimum || cpu > maximum || shader < shaderMinimum || shader > shaderMaximum) outOfBoundsCount += 1;
    if ((target > start && (cpu < start || shader < f32(start)))
        || (target < start && (cpu > start || shader > f32(start)))) nonMonotoneCount += 1;
    if (start === target && (cpu !== target || shader !== f32(target))) identityMismatchCount += 1;
    equationCaseCount += 1;
    aggregate.cases += 1;
    aggregate.maximumAbsoluteError = Math.max(aggregate.maximumAbsoluteError, absoluteError);
    if (absoluteError > maximumCpuFutureShaderAbsoluteError) {
      maximumCpuFutureShaderAbsoluteError = absoluteError;
      worstCase = { cellId: cell.id, seconds, cpu, shader, absoluteError };
    }
    if (cell.address.channel === "r"
        && exemplarPairs.has(`${cell.address.fromCode}>${cell.address.toCode}`)) {
      exemplars.push({ cellId: cell.id, seconds, packedRatePerSecond: cell.packedFloat32RatePerSecond,
        cpu, futureShaderFloat32: shader, absoluteError });
    }
  }
  aggregateMap.set(aggregateId, aggregate);
}
const cpuFutureShaderTolerance = 2e-7;
assert(equationCaseCount === 9_216 * fixedTimesteps.length, "all GtG cells were not equation-tested");
assert(maximumCpuFutureShaderAbsoluteError <= cpuFutureShaderTolerance,
  "CPU/future-Shader float32 response equation tolerance failed");
assert(nonFiniteCount === 0 && outOfBoundsCount === 0 && nonMonotoneCount === 0
    && identityMismatchCount === 0,
`response equation safety gates failed: nonFinite=${nonFiniteCount}, outOfBounds=${outOfBoundsCount}, nonMonotone=${nonMonotoneCount}, identityMismatch=${identityMismatchCount}`);

let maximumFramesToExactTarget = 0;
let convergenceFailureCount = 0;
for (const cell of cells) {
  let state = commandCoordinate(cell.address.fromCode);
  const target = commandCoordinate(cell.address.toCode);
  let frames = 0;
  while (state !== target && frames < 240) {
    state = stepFirstOrder(state, target, cell.packedFloat32RatePerSecond, frameSeconds);
    frames += 1;
  }
  if (state !== target) convergenceFailureCount += 1;
  maximumFramesToExactTarget = Math.max(maximumFramesToExactTarget, frames);
  const held = stepFirstOrder(state, target, cell.packedFloat32RatePerSecond, frameSeconds);
  if (held !== target) convergenceFailureCount += 1;
}
assert(convergenceFailureCount === 0, "one or more response cells failed exact convergence/fixed-point checks");

function runPrefix(member, targets) {
  let state = commandCoordinate(0);
  let sourceCode = 0;
  const output = [];
  for (const targetCode of targets) {
    const parameters = transitionParameters(member, sourceCode, targetCode);
    state = stepFirstOrder(state, commandCoordinate(targetCode), f32(parameters.ratePerSecond), frameSeconds);
    output.push(state);
    sourceCode = targetCode;
  }
  return output;
}
const sharedPrefix = [31, 7, 24, 12];
const sequenceA = runPrefix(policy.members[1], [...sharedPrefix, 31]);
const sequenceB = runPrefix(policy.members[1], [...sharedPrefix, 0]);
const futureGhostMaximumDifference = Math.max(...sharedPrefix.map((_value, index) =>
  Math.abs(sequenceA[index] - sequenceB[index])));
assert(futureGhostMaximumDifference === 0, "response prefix depends on a future target");

const equationReport = {
  schemaVersion: 1,
  reportId: "cgb001-ws4-equation-vectors-v1",
  modelId: policy.modelId,
  classification: "cpu-versus-future-shader-float32-equation-receipt",
  sourceRateArtifact: outputRelatives.binary,
  coverage: {
    cells: cells.length,
    timestepsSeconds: fixedTimesteps,
    cases: equationCaseCount,
    members: policy.members.map((member) => member.id),
    channels: CGB_WS4_CHANNELS,
    fromCodeRange: [0, 31],
    toCodeRange: [0, 31],
  },
  agreement: {
    tolerance: cpuFutureShaderTolerance,
    maximumAbsoluteError: maximumCpuFutureShaderAbsoluteError,
    worstCase,
    perMemberChannel: [...aggregateMap.values()],
    pass: true,
  },
  safety: {
    nonFiniteCount,
    outOfBoundsCount,
    nonMonotoneCount,
    identityMismatchCount,
    convergenceFailureCount,
    maximumFramesToExactTarget,
    snapEpsilon: CGB_WS4_SNAP_EPSILON,
    futurePrefixCases: sharedPrefix.length,
    futureGhostMaximumDifference,
    pass: true,
  },
  exemplars,
  actualGpuReadback: false,
  limits: "Validates an independent future-Shader float32 transcription against CPU double precision using packed float32 rates. Actual GPU compilation/readback remains an WS8/WS9 gate.",
};
const equationReportBuffer = jsonBuffer(equationReport);

const motionDefinitions = [
  { fixtureId: "full-increasing-neutral", startRgb555: [0, 0, 0], targetRgb555: [31, 31, 31] },
  { fixtureId: "full-decreasing-neutral", startRgb555: [31, 31, 31], targetRgb555: [0, 0, 0] },
  { fixtureId: "middle-adjacent-neutral", startRgb555: [15, 15, 15], targetRgb555: [16, 16, 16] },
  { fixtureId: "mixed-command", startRgb555: [31, 0, 15], targetRgb555: [0, 31, 16] },
];
const sampledFrames = new Set([0, 1, 2, 3, 6, 12, 24, 48, 90]);
const motionTraces = [];
for (const member of policy.members) {
  for (const fixture of motionDefinitions) {
    let state = fixture.startRgb555.map(commandCoordinate);
    const rates = fixture.startRgb555.map((fromCode, channel) =>
      f32(transitionParameters(member, fromCode, fixture.targetRgb555[channel]).ratePerSecond));
    const samples = [];
    for (let frame = 0; frame <= 90; frame += 1) {
      if (sampledFrames.has(frame)) samples.push({ frame, seconds: frame * frameSeconds, state: [...state] });
      if (frame < 90) {
        state = state.map((value, channel) => stepFirstOrder(
          value,
          commandCoordinate(fixture.targetRgb555[channel]),
          rates[channel],
          frameSeconds,
        ));
      }
    }
    motionTraces.push({
      memberId: member.id,
      role: member.role,
      fixtureId: fixture.fixtureId,
      startRgb555: fixture.startRgb555,
      targetRgb555: fixture.targetRgb555,
      ratePerSecond: rates,
      samples,
      settledState: state,
      settledLutRgba32fHex: lutEntryHex(lutBuffer, fixture.targetRgb555),
    });
  }
}

let distinctTransientFixtureCount = 0;
let settledStateMismatchCount = 0;
let settledColorByteMismatchCount = 0;
for (const fixture of motionDefinitions) {
  const traces = policy.members.map((member) =>
    motionTraces.find((trace) => trace.memberId === member.id && trace.fixtureId === fixture.fixtureId));
  const distancesAfterOneFrame = traces.map((trace) => trace.samples.find((sample) => sample.frame === 1).state
    .reduce((sum, value, channel) => sum + Math.abs(value - commandCoordinate(fixture.targetRgb555[channel])), 0));
  if (distancesAfterOneFrame[0] < distancesAfterOneFrame[1]
      && distancesAfterOneFrame[1] < distancesAfterOneFrame[2]) distinctTransientFixtureCount += 1;
  const expectedState = fixture.targetRgb555.map(commandCoordinate);
  if (!traces.every((trace) => trace.settledState.every((value, channel) => value === expectedState[channel]))) {
    settledStateMismatchCount += 1;
  }
  if (new Set(traces.map((trace) => trace.settledLutRgba32fHex)).size !== 1) settledColorByteMismatchCount += 1;
}
assert(distinctTransientFixtureCount === motionDefinitions.length,
  "fast/nominal/slow motion fixtures do not all differ in transient response");
assert(settledStateMismatchCount === 0 && settledColorByteMismatchCount === 0,
  "ensemble members do not settle to identical state/color endpoints");
const motionReport = {
  schemaVersion: 1,
  reportId: "cgb001-ws4-motion-fixtures-v1",
  modelId: policy.modelId,
  classification: "deterministic-cpu-motion-fixtures-not-device-capture",
  frameSeconds,
  sampledFrames: [...sampledFrames],
  fixtures: motionDefinitions,
  traces: motionTraces,
  validation: {
    distinctTransientFixtureCount,
    expectedDistinctTransientFixtureCount: motionDefinitions.length,
    settledStateMismatchCount,
    settledColorByteMismatchCount,
    ws1LutSha256Before: lutSha256,
    ws1LutSha256After: sha256(readBuffer(inputRelatives[7])),
    ws1StaticColorDifference: 0,
    pass: true,
  },
  limits: "CPU deterministic traces compare only the selected response ensemble. WS5 will integrate continuous optical exposure through the fixed-angle WS1 color model.",
};
const motionReportBuffer = jsonBuffer(motionReport);

const responseEnsemble = {
  schemaVersion: 1,
  ensembleId: "cgb001-ws4-response-ensemble-v1",
  modelId: policy.modelId,
  classification: "period-reconstructed",
  evidenceIds: policy.evidenceIds,
  referenceTemperatureC: policy.heldNeutralDimensions.referenceTemperatureC,
  stateDefinition: {
    coordinate: policy.state.coordinate,
    range: policy.state.range,
    units: policy.state.units,
    codeMapping: policy.state.codeMapping,
    endpointPolicy: "state==target is exact; residual below 1/65536 snaps exactly to the target",
    colorBoundary: policy.state.settledColor,
  },
  responseDefinition: {
    runtimeDefinition: policy.runtimeResponseDefinition.name,
    sourceDefinition: policy.familyAnchors.sourceDefinition,
    conversionStatus: policy.runtimeResponseDefinition.classification,
    equation: policy.runtimeResponseDefinition.equation,
    fullScaleReference: policy.runtimeResponseDefinition.fullScaleReference,
    grayReference: policy.runtimeResponseDefinition.grayReference,
  },
  selectedModel: {
    candidateId: policy.selection.selectedCandidate,
    equationId: CGB_WS4_EQUATION_ID,
    stateEquation: "xNext = target + (x - target) * exp(-rate * dt)",
    rateEquation: policy.rateField,
    snapEpsilon: CGB_WS4_SNAP_EPSILON,
    modelSelectionReason: modelSelection.candidates.find((candidate) => candidate.selection === "selected").reason,
  },
  members: policy.members,
  uncertaintyDimensions: {
    channel: policy.heldNeutralDimensions.channelMultipliers,
    temperature: policy.heldNeutralDimensions.referenceTemperatureC,
    direction: policy.heldNeutralDimensions.directionAsymmetry,
    waveform: "Sharp family source has no waveform; first-order is the minimum selected shape",
    exactCgbPanel: "no accepted CGB-specific response data",
    overshoot: policy.heldNeutralDimensions.overshoot,
    retention: policy.heldNeutralDimensions.retention,
  },
  specimenOverrideContract: policy.specimenOverride,
  runtimeArtifact: {
    path: "../generated/cgb001-ws4-gtg-rates-v1.r32f",
    descriptor: "../generated/cgb001-ws4-gtg-rates-v1.json",
    sha256: sha256(rateBinary),
    format: "little-endian R32_SFLOAT",
    dimensions: descriptor.dimensions,
    equationRevision: CGB_WS4_EQUATION_ID,
  },
  validation: {
    status: "pass",
    cpuFutureShaderTolerance,
    modelSelectionReport: "../generated/ws4-model-selection-v1.json",
    equationReport: "../generated/ws4-equation-vectors-v1.json",
    motionFixtureReport: "../generated/ws4-motion-fixtures-v1.json",
    generatedCellCount: cells.length,
    measuredOverrideCellCount: 0,
    maximumFramesToExactTarget,
    ws1StaticColorDifference: 0,
    actualGpuReadback: false,
  },
};
checkTopLevelSchema(responseEnsemble, schema, "response-ensemble-v1.json");
const responseEnsembleBuffer = jsonBuffer(responseEnsemble);

const outputBuffers = {
  [outputRelatives.ensemble]: responseEnsembleBuffer,
  [outputRelatives.binary]: rateBinary,
  [outputRelatives.descriptor]: descriptorBuffer,
  [outputRelatives.selection]: modelSelectionBuffer,
  [outputRelatives.equations]: equationReportBuffer,
  [outputRelatives.motion]: motionReportBuffer,
};
const outputHashes = {};
for (const [relative, buffer] of Object.entries(outputBuffers)) outputHashes[relative] = sha256(buffer);

const receipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws4-receipt-v1",
  modelId: policy.modelId,
  workstream: "WS4",
  completedOn: "2026-08-24",
  generatedBy: "tools/build-cgb001-ws4.mjs",
  evidenceBoundary: {
    manufacturerFamilyBounds: "Sharp 6.5-inch HCR 50/80 ms and GH 80/150 ms labels",
    periodReconstructed: "10-to-90 conversion, midpoint member, distance rate field, and numeric snap threshold",
    heldNeutral: "RGB channel multipliers, direction split, temperature coefficient, and overshoot",
    unresolved: "exact CGB mode, waveform, GtG matrix, response definition, temperature dependence, and specimen spread",
  },
  trackedInputHashes: inputHashes,
  outputHashes,
  gates: {
    evidenceIdsResolve: true,
    sourceConditionsAndLimitsNormalized: true,
    familyBoundsPreservedWithoutCgbClaim: true,
    oneCommonResponseDefinitionUsed: true,
    symmetricAsymmetricAndTwoStateCandidatesEvaluated: modelSelection.candidates.length === 3,
    smallestEvidenceCompatibleModelSelected: modelSelection.selectedCandidate === "symmetric-first-order-rate-field",
    fastNominalSlowMembersComplete: policy.members.length === 3,
    fullScaleAndGrayAnchorsReproduced: maximumAnchorErrorMilliseconds <= 1e-12,
    generatedThreeByThreeByThirtyTwoByThirtyTwoCells: cells.length === 9_216,
    everyCellHasProvenanceAndFallback: cells.every((cell) => cell.provenanceId && cell.fallbackId),
    channelAndTemperatureUncertaintyHeldNeutral: true,
    futureMeasuredOverridesRequireNoShaderInterfaceChange: policy.specimenOverride.shaderInterfaceChangesRequired === false,
    cpuAndFutureShaderAllCellsAgree: equationReport.agreement.pass,
    transitionsCausalFiniteBoundedAndMonotone: equationReport.safety.pass,
    fixedPointsAndExactConvergencePass: convergenceFailureCount === 0,
    noFutureFrameGhosts: futureGhostMaximumDifference === 0,
    ensembleMotionDiffersOnlyInResponse: distinctTransientFixtureCount === motionDefinitions.length,
    settledStateAndWs1ColorByteIdentical: settledStateMismatchCount === 0 && settledColorByteMismatchCount === 0,
    ws1LutHashInvariant: motionReport.validation.ws1LutSha256Before === motionReport.validation.ws1LutSha256After,
    retentionStateCreated: false,
    shaderOrPresetCreated: false,
  },
  result: {
    status: "pass",
    ws4Complete: true,
    nextEligibleWorkstreams: ["WS5", "WS6", "WS7"],
    referenceV1ShaderOrPresetAllowed: false,
  },
  limits: "WS4 is a bounded period-family response ensemble and future-Shader equation contract, not a CGB waveform measurement, GPU readback, retention model, Shader, or preset.",
};
outputBuffers[outputRelatives.receipt] = jsonBuffer(receipt);

for (const [relative, buffer] of Object.entries(outputBuffers)) writeOrCheck(relative, buffer);
console.log(checkOnly
  ? "CGB-001 WS4 optical-response artifacts are current."
  : "CGB-001 WS4 optical-response ensemble generated and validated.");
