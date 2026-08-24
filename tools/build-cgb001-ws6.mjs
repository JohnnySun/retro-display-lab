#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CGB_APERTURE_EQUATION_ID,
  composeRgbAperture,
  composeRgbApertureFloat32,
  linearSrgbToXyz,
  periodicIntervalLength,
  rgbStripeCoverage,
  xyzToLinearSrgb,
} from "../models/nintendo-cgb-001/reference/rgb-aperture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const checkOnly = process.argv.includes("--check");

const inputRelatives = [
  `${modelRelative}/data/ws6-evidence-inventory-v1.json`,
  `${modelRelative}/data/aperture-v1.json`,
  `${modelRelative}/data/aperture.schema.json`,
  `${modelRelative}/reference/rgb-aperture.mjs`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/ws5-receipt-v1.json`,
  `${modelRelative}/REFERENCES.md`,
  "tools/build-cgb001-ws6.mjs",
];

const outputRelatives = {
  validation: `${modelRelative}/generated/ws6-aperture-validation-v1.json`,
  receipt: `${modelRelative}/generated/ws6-receipt-v1.json`,
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

function maximumDifference(a, b) {
  return Math.max(...a.map((value, channel) => Math.abs(value - b[channel])));
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

assert(process.argv.slice(2).every((argument) => argument === "--check"),
  "Usage: node tools/build-cgb001-ws6.mjs [--check]");

const evidence = readJson(inputRelatives[0]);
const aperture = readJson(inputRelatives[1]);
const schema = readJson(inputRelatives[2]);
const lutDescriptor = readJson(inputRelatives[4]);
const lutBuffer = readBuffer(inputRelatives[5]);
const ws5Receipt = readJson(inputRelatives[6]);
const referencesMarkdown = readBuffer(inputRelatives[7]).toString("utf8");

checkTopLevelSchema(aperture, schema, "aperture-v1.json");
assert(evidence.inventoryId === "cgb001-ws6-evidence-inventory-v1", "WS6 evidence identity drifted");
assert(aperture.apertureModelId === "cgb001-ws6-equal-third-rgb-v1", "WS6 aperture identity drifted");
assert(aperture.subpixelOrder === "RGB", "WS6 selected order is not RGB");
assert(aperture.geometry.activeFill.value === 1 && aperture.geometry.inactiveGap.fraction === 0,
  "WS6 accepted geometry must remain the zero-gap minimum assumption");
assert(aperture.surface.angleGainAlreadyInColorReference === true
    && aperture.surface.visibleSurfaceGrain.enabled === false,
"WS6 must not double-apply MRS/angle gain or invent surface grain");
assert(aperture.integration.scaleInvariant === true && aperture.integration.hostFootprintAware === true,
  "WS6 aperture integration contract drifted");
assert(ws5Receipt.result?.status === "pass" && ws5Receipt.result?.ws5Complete === true,
  "WS5 receipt does not pass");
assert(lutDescriptor.sha256 === sha256(lutBuffer), "WS1 LUT descriptor/hash mismatch");
// WS6's receipt describes its historical scope; WS8 may consume this aperture.

const definedEvidence = new Set(
  [...referencesMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
for (const id of aperture.evidenceIds) assert(definedEvidence.has(id), `WS6 references undefined evidence ID ${id}`);

const inputHashes = Object.fromEntries(inputRelatives.map((relative) => [relative, sha256(readBuffer(relative))]));
const lut = new Float32Array(lutBuffer.buffer, lutBuffer.byteOffset, lutBuffer.byteLength / 4);
const sampleIndices = new Set([0, 31, 31 * 32, 31 * 32 * 32, 32 ** 3 - 1]);
for (let index = 0; index < 96; index += 1) sampleIndices.add((index * 811 + 97) % (32 ** 3));
const sourceSamples = [...sampleIndices].map((index) => ({
  index,
  xyz: Array.from(lut.subarray(index * 4, index * 4 + 3)),
}));
for (const sample of sourceSamples) sample.linearRgb = xyzToLinearSrgb(sample.xyz);

let maximumMatrixRoundTripError = 0;
for (const sample of sourceSamples) {
  maximumMatrixRoundTripError = Math.max(
    maximumMatrixRoundTripError,
    maximumDifference(linearSrgbToXyz(sample.linearRgb), sample.xyz),
  );
}

const scaleFixtures = [];
let maximumChannelEnergyError = 0;
let maximumAverageXyzError = 0;
let maximumCoveragePartitionError = 0;
let maximumFloat32AverageError = 0;
for (const scale of aperture.validation.scales) {
  for (const viewportOffset of aperture.validation.viewportOffsets) {
    const periods = 20;
    const hostSamples = Math.round(periods * scale);
    assert(Math.abs(hostSamples / scale - periods) < 1e-12,
      `fixture scale ${scale} does not tile ${periods} source periods`);
    let fixtureChannelError = 0;
    let fixtureXyzError = 0;
    let fixtureFloatError = 0;
    let fixturePartitionError = 0;
    for (const sample of sourceSamples) {
      const sum = [0, 0, 0];
      const sumFloat = [0, 0, 0];
      for (let host = 0; host < hostSamples; host += 1) {
        const sourceX = viewportOffset + (host + 0.5) / scale;
        const coverage = rgbStripeCoverage({ sourceX, hostPixelsPerSourcePixel: scale });
        fixturePartitionError = Math.max(fixturePartitionError, Math.abs(coverage.sum - 1));
        const output = composeRgbAperture({
          sourceLinearRgb: sample.linearRgb,
          sourceX,
          hostPixelsPerSourcePixel: scale,
        });
        const outputFloat = composeRgbApertureFloat32({
          sourceLinearRgb: sample.linearRgb,
          sourceX,
          hostPixelsPerSourcePixel: scale,
        });
        for (let channel = 0; channel < 3; channel += 1) {
          sum[channel] += output[channel];
          sumFloat[channel] += outputFloat[channel];
        }
      }
      const average = sum.map((value) => value / hostSamples);
      const averageFloat = sumFloat.map((value) => value / hostSamples);
      fixtureChannelError = Math.max(fixtureChannelError, maximumDifference(average, sample.linearRgb));
      fixtureFloatError = Math.max(fixtureFloatError, maximumDifference(averageFloat, average));
      fixtureXyzError = Math.max(
        fixtureXyzError,
        maximumDifference(linearSrgbToXyz(average), sample.xyz),
      );
    }
    maximumChannelEnergyError = Math.max(maximumChannelEnergyError, fixtureChannelError);
    maximumAverageXyzError = Math.max(maximumAverageXyzError, fixtureXyzError);
    maximumCoveragePartitionError = Math.max(maximumCoveragePartitionError, fixturePartitionError);
    maximumFloat32AverageError = Math.max(maximumFloat32AverageError, fixtureFloatError);
    scaleFixtures.push({
      scale,
      viewportOffset,
      sourcePeriods: periods,
      hostSamples,
      maximumChannelEnergyError: clean(fixtureChannelError),
      maximumAverageXyzError: clean(fixtureXyzError),
      maximumCoveragePartitionError: clean(fixturePartitionError),
      maximumFutureShaderFloat32AverageError: clean(fixtureFloatError),
    });
  }
}

const cropFixtures = [];
let maximumCropIntegrationError = 0;
for (const crop of [
  { start: -1.271, hostSamples: 7 },
  { start: -0.173, hostSamples: 13 },
  { start: 0.271, hostSamples: 23 },
  { start: 2.625, hostSamples: 41 },
]) {
  for (const scale of [4, 5, 6, 3.5, 4.25, 4.75]) {
    const hostSamples = crop.hostSamples;
    const footprint = 1 / scale;
    const cropLength = hostSamples * footprint;
    const coverageSum = [0, 0, 0];
    for (let host = 0; host < hostSamples; host += 1) {
      const center = crop.start + (host + 0.5) * footprint;
      const coverage = rgbStripeCoverage({ sourceX: center, hostPixelsPerSourcePixel: scale });
      for (let channel = 0; channel < 3; channel += 1) coverageSum[channel] += coverage.channels[channel] * footprint;
    }
    const expected = [0, 1, 2].map((channel) => periodicIntervalLength(
      crop.start,
      crop.start + cropLength,
      channel / 3,
      (channel + 1) / 3,
    ));
    const error = maximumDifference(coverageSum, expected);
    maximumCropIntegrationError = Math.max(maximumCropIntegrationError, error);
    cropFixtures.push({
      scale,
      start: crop.start,
      length: clean(cropLength),
      hostSamples,
      analyticCoverageLength: expected.map((value) => clean(value)),
      tiledFootprintCoverageLength: coverageSum.map((value) => clean(value)),
      maximumError: clean(error),
    });
  }
}

const bypassSamples = sourceSamples.map((sample, index) => composeRgbAperture({
  sourceLinearRgb: sample.linearRgb,
  sourceX: index * 0.271 - 2,
  hostPixelsPerSourcePixel: 4.25,
  enabled: false,
}));
const maximumBypassError = Math.max(...bypassSamples.map(
  (output, index) => maximumDifference(output, sourceSamples[index].linearRgb),
));

const tolerances = {
  matrixRoundTrip: 5e-15,
  channelEnergy: 2e-13,
  averageXyz: 2e-13,
  coveragePartition: 5e-14,
  cropIntegration: 2e-13,
  futureShaderFloat32Average: 2e-6,
  bypass: 0,
};
const checks = {
  evidenceAuditedWithoutDerivativeImage: evidence.auditRules.length >= 4,
  selectedRgbOrderAndEqualThirds: aperture.subpixelOrder === "RGB"
    && aperture.geometry.stripeIntervals.R[0] === 0
    && aperture.geometry.stripeIntervals.B[1] === 1,
  noUnsupportedGapNotchOrGrain: aperture.geometry.inactiveGap.fraction === 0
    && aperture.surface.visibleSurfaceGrain.enabled === false,
  barePanelNoSecondAngleGain: aperture.surface.angleGainAlreadyInColorReference === true,
  matrixRoundTrip: maximumMatrixRoundTripError <= tolerances.matrixRoundTrip,
  channelEnergyConserved: maximumChannelEnergyError <= tolerances.channelEnergy,
  averageXyzConserved: maximumAverageXyzError <= tolerances.averageXyz,
  coveragePartitionsUnity: maximumCoveragePartitionError <= tolerances.coveragePartition,
  cropAndViewportPhaseStable: maximumCropIntegrationError <= tolerances.cropIntegration,
  futureShaderFloat32AverageAgrees: maximumFloat32AverageError <= tolerances.futureShaderFloat32Average,
  bypassExact: maximumBypassError === tolerances.bypass,
  ws1LutHashInvariant: sha256(lutBuffer) === lutDescriptor.sha256,
  shaderOrPresetCreated: false,
};
const pass = Object.entries(checks).every(([name, value]) => (
  name === "shaderOrPresetCreated" ? value === false : value === true
));
assert(pass, `WS6 validation failed: ${JSON.stringify(checks)}`);

const validation = {
  schemaVersion: 1,
  reportId: "cgb001-ws6-aperture-validation-v1",
  modelId: aperture.modelId,
  equationId: CGB_APERTURE_EQUATION_ID,
  generatedBy: "tools/build-cgb001-ws6.mjs",
  classification: "minimum-assumption period reconstruction with analytic host-footprint integration",
  sourceSampleCount: sourceSamples.length,
  acceptedGeometry: {
    order: aperture.subpixelOrder,
    activeFill: aperture.geometry.activeFill.value,
    inactiveGapFraction: aperture.geometry.inactiveGap.fraction,
    surfaceGrainEnabled: aperture.surface.visibleSurfaceGrain.enabled,
    decomposition: aperture.decomposition.modelSpace,
  },
  maxima: {
    matrixRoundTripAbsolute: clean(maximumMatrixRoundTripError),
    channelEnergyAbsolute: clean(maximumChannelEnergyError),
    averageXyzAbsolute: clean(maximumAverageXyzError),
    coveragePartitionAbsolute: clean(maximumCoveragePartitionError),
    cropIntegrationAbsolute: clean(maximumCropIntegrationError),
    futureShaderFloat32AverageAbsolute: clean(maximumFloat32AverageError),
    bypassAbsolute: clean(maximumBypassError),
  },
  tolerances,
  scaleFixtures,
  cropFixtures,
  invariants: {
    ws1LutSha256Before: lutDescriptor.sha256,
    ws1LutSha256After: sha256(lutBuffer),
    ws4OrWs5StateChanged: false,
    secondMrsOrAngleGainApplied: false,
    coverLensOrGlareApplied: false,
    targetCompensationApplied: false,
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
  receiptId: "cgb001-ws6-receipt-v1",
  modelId: aperture.modelId,
  workstream: "WS6",
  completedOn: "2026-08-24",
  generatedBy: "tools/build-cgb001-ws6.mjs",
  trackedInputHashes: inputHashes,
  outputHashes: {
    [outputRelatives.validation]: sha256(validationBuffer),
  },
  gates: {
    evidenceAndImageProvenanceAudited: checks.evidenceAuditedWithoutDerivativeImage,
    rgbOrderSelectedWithoutClaimingNumericFill: checks.selectedRgbOrderAndEqualThirds,
    equalThirdZeroGapMinimumGeometryFrozen: checks.noUnsupportedGapNotchOrGrain,
    analyticHostFootprintIntegrationImplemented: true,
    integerAndFractionalEnergyConservationPasses: checks.channelEnergyConserved,
    d65AverageColorConservationPasses: checks.averageXyzConserved,
    viewportOffsetCropAndBorderPhasePasses: checks.cropAndViewportPhaseStable,
    apertureBypassReturnsWs5Exactly: checks.bypassExact,
    futureShaderFloat32EquationAgrees: checks.futureShaderFloat32AverageAgrees,
    barePanelFixedAngleNotDoubleApplied: checks.barePanelNoSecondAngleGain,
    ws1LutHashInvariant: checks.ws1LutHashInvariant,
    shaderOrPresetCreated: false,
  },
  result: {
    status: "pass",
    ws6Complete: true,
    nextEligibleWorkstreams: ["WS7", "WS8-after-WS7"],
    referenceV1ShaderOrPresetAllowed: false,
  },
  limits: "WS6 freezes a conservative CPU/reference aperture equation and future-Shader contract. It does not claim a measured CGB fill factor, gap, notch, MRS texture, lens/glare layer, Shader, preset, or actual GPU readback.",
};
writeOrCheck(outputRelatives.receipt, jsonBuffer(receipt));

console.log(`CGB-001 WS6 ${checkOnly ? "check" : "build"} passed: ${scaleFixtures.length} scale/phase fixtures, ${cropFixtures.length} crop fixtures, max channel-energy error ${maximumChannelEnergyError}.`);
