#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildMeasurementRecord } from "./import-cgb001-hcs.mjs";
import {
  buildColorModel,
  buildXyzLut,
  deltaE00Lab,
  deltaE00Xyz,
  deltaECam16Ucs,
  evaluateColorModel,
  evaluateUpstreamD65,
  lutIndex,
  packXyzLutRgba32f,
  projectLutLuminanceMonotonic,
  sampleXyzLutTrilinear,
  xyzToLinearSrgb,
  xyzToSrgb,
  xyzToXyY,
} from "../models/nintendo-cgb-001/reference/color-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const dataDir = path.join(modelDir, "data");
const generatedDir = path.join(modelDir, "generated");
const measurementRelative = `${modelRelative}/data/hcs-source-v1.json`;
const colorRecordRelative = `${modelRelative}/data/color-reference-v1.json`;
const lutBinaryRelative = `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`;
const lutDescriptorRelative = `${modelRelative}/generated/cgb001-d65-lut-v1.json`;
const auditRelative = `${modelRelative}/generated/ws1-color-audit-v1.json`;
const perceptualRelative = `${modelRelative}/generated/ws1-perceptual-v1.json`;
const fixturesRelative = `${modelRelative}/generated/ws1-static-fixtures-v1.json`;
const receiptRelative = `${modelRelative}/generated/ws1-receipt-v1.json`;

const jsonOutputs = [
  measurementRelative,
  colorRecordRelative,
  lutDescriptorRelative,
  auditRelative,
  perceptualRelative,
  fixturesRelative,
  receiptRelative,
];

const seriesRgb = {
  R: (t) => [t, 0, 0],
  G: (t) => [0, t, 0],
  B: (t) => [0, 0, t],
  Y: (t) => [t, t, 0],
  C: (t) => [0, t, t],
  M: (t) => [t, 0, t],
  Greyscale: (t) => [t, t, t],
};

const frozenUpstreamFixture = {
  polynomials: {
    R: { degree: 3, rmse: 0.08144119, coefficients: [1.3748424203, -4.2178569943, 8.1988201894, -5.5958230464] },
    G: { degree: 3, rmse: 0.04695937, coefficients: [1.4367789551, -3.5303924918, 5.8167692384, -3.53003937] },
    B: { degree: 3, rmse: 0.11911794, coefficients: [1.2427509369, -2.3147239664, 3.5072230209, -2.4378295542] },
  },
  matrixColumns: {
    R: [0.40412446, 0.273465686, 0.202098205],
    G: [0.377494478, 0.562442035, 0.402783669],
    B: [0.14683339, 0.206531164, 0.559688377],
  },
  secondaryScales: {
    yellow: 0.946776,
    cyan: 0.969184,
    magenta: 0.897847,
    gray: 0.959289,
  },
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanNumber(value, digits = 11) {
  if (!Number.isFinite(value)) return value;
  // Transcendental color-difference functions can differ by a few ULPs across
  // operating-system math libraries even on the same Node major. Eleven
  // significant digits remain far above Shader float32 precision while making
  // generated JSON byte-identical on the supported Linux/macOS matrix.
  const cleaned = Number(value.toPrecision(digits));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function cleanDeep(value) {
  if (typeof value === "number") return cleanNumber(value);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

function maxAbsoluteDifference(a, b) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

function add3(a, b) {
  return a.map((value, index) => value + b[index]);
}

function sub3(a, b) {
  return a.map((value, index) => value - b[index]);
}

function summarize(values) {
  assert(values.length > 0, "cannot summarize an empty value set");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    count: values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    mean,
    standardDeviation: Math.sqrt(variance),
  };
}

function upstreamFixtureAudit(parameters) {
  const comparisons = [];
  for (const channel of ["R", "G", "B"]) {
    comparisons.push({
      field: `${channel}.degree`,
      expected: frozenUpstreamFixture.polynomials[channel].degree,
      actual: parameters.polynomials[channel].degree,
      difference: Math.abs(parameters.polynomials[channel].degree - frozenUpstreamFixture.polynomials[channel].degree),
    });
    comparisons.push({
      field: `${channel}.rmse`,
      expected: frozenUpstreamFixture.polynomials[channel].rmse,
      actual: parameters.polynomials[channel].rmse,
      difference: Math.abs(parameters.polynomials[channel].rmse - frozenUpstreamFixture.polynomials[channel].rmse),
    });
    parameters.polynomials[channel].coefficients.forEach((actual, index) => comparisons.push({
      field: `${channel}.coefficient.${index}`,
      expected: frozenUpstreamFixture.polynomials[channel].coefficients[index],
      actual,
      difference: Math.abs(actual - frozenUpstreamFixture.polynomials[channel].coefficients[index]),
    }));
    parameters.matrixColumns[channel].forEach((actual, index) => comparisons.push({
      field: `matrix.${channel}.${index}`,
      expected: frozenUpstreamFixture.matrixColumns[channel][index],
      actual,
      difference: Math.abs(actual - frozenUpstreamFixture.matrixColumns[channel][index]),
    }));
  }
  for (const name of ["yellow", "cyan", "magenta", "gray"]) {
    comparisons.push({
      field: `secondary.${name}.k`,
      expected: frozenUpstreamFixture.secondaryScales[name],
      actual: parameters.secondaryScales[name].k,
      difference: Math.abs(parameters.secondaryScales[name].k - frozenUpstreamFixture.secondaryScales[name]),
    });
  }
  return {
    tolerance: 1e-6,
    maximumDifference: Math.max(...comparisons.map((item) => item.difference)),
    pass: comparisons.every((item) => item.difference <= 1e-6),
    comparisons,
  };
}

function colorMathAudit() {
  // Sharma, Wu, and Dalal (2005), CIEDE2000 supplementary test data.
  const referencePairs = [
    { a: [50, 2.6772, -79.7751], b: [50, 0, -82.7485], expected: 2.0425 },
    { a: [50, 3.1571, -77.2803], b: [50, 0, -82.7485], expected: 2.8615 },
    { a: [50, 2.8361, -74.02], b: [50, 0, -82.7485], expected: 3.4412 },
    { a: [50, -1.3802, -84.2814], b: [50, 0, -82.7485], expected: 1 },
  ].map((fixture) => {
    const actual = deltaE00Lab(fixture.a, fixture.b);
    return { ...fixture, actual, difference: Math.abs(actual - fixture.expected) };
  });
  return {
    fixtureSource: "Sharma, Wu, and Dalal (2005) CIEDE2000 supplementary test data",
    tolerance: 5e-5,
    maximumDifference: Math.max(...referencePairs.map((fixture) => fixture.difference)),
    pass: referencePairs.every((fixture) => fixture.difference <= 5e-5),
    referencePairs,
  };
}

function modelRepairAudit(model) {
  return Object.fromEntries(Object.entries(model.ramp).map(([name, ramp]) => {
    const changes = ramp.monotonicAudit.adjustedIndices;
    return [name, {
      sourcePatchCount: ramp.sourcePatchCount,
      mappingPolicy: ramp.mappingPolicy,
      adjustedCodeCount: changes.length,
      maximumLuminanceAdjustment: changes.length
        ? Math.max(...changes.map((item) => Math.abs(item.after - item.before)))
        : 0,
      adjustments: changes,
    }];
  }));
}

function comparisonMetrics(measured, predicted, white) {
  return {
    measuredXyz: measured,
    predictedXyz: predicted,
    measuredXyY: xyzToXyY(measured),
    predictedXyY: xyzToXyY(predicted),
    maximumAbsoluteXyzError: maxAbsoluteDifference(measured, predicted),
    deltaE00: deltaE00Xyz(measured, predicted, white),
    deltaECam16Ucs: deltaECam16Ucs(measured, predicted, white),
  };
}

function buildPerceptualReport(measurement, model, runtimeLut) {
  const white = model.referenceWhite;
  const candidates = ["primary-only", "pairwise", "pairwise-neutral", "runtime-monotonic-lut"];
  const series = {};
  const aggregateBuckets = Object.fromEntries(candidates.map((candidate) => [candidate, { deltaE00: [], deltaECam16Ucs: [] }]));
  const upstreamBuckets = { deltaE00: [], deltaECam16Ucs: [] };
  const upstreamAlignedBuckets = { deltaE00: [], deltaECam16Ucs: [] };
  const upstreamWhite = evaluateUpstreamD65(measurement.upstreamD65Fixture.parameters, [1, 1, 1]);
  const measuredWhiteDelta = model.ramp.Greyscale.delta.at(-1);
  const upstreamAbsoluteScale = upstreamWhite.map((value, index) => measuredWhiteDelta[index] / value);

  for (const [name, inputFor] of Object.entries(seriesRgb)) {
    const sourceSeries = measurement.normalizedSeries[name];
    const sourceBlack = sourceSeries.readings[0].d65XyzRecordedRange;
    const rows = sourceSeries.readings.map((reading, index) => {
      const sourceCoordinate = sourceSeries.readings.length === 1 ? 0 : index / (sourceSeries.readings.length - 1);
      const rgb = inputFor(sourceCoordinate);
      const measuredBlackAligned = add3(model.globalBlack, sub3(reading.d65XyzRecordedRange, sourceBlack));
      const comparisons = {};
      for (const candidate of candidates) {
        const predicted = candidate === "runtime-monotonic-lut"
          ? sampleXyzLutTrilinear(runtimeLut, rgb)
          : evaluateColorModel(model, rgb, candidate);
        comparisons[candidate] = comparisonMetrics(
          measuredBlackAligned,
          predicted,
          white,
        );
        aggregateBuckets[candidate].deltaE00.push(comparisons[candidate].deltaE00);
        aggregateBuckets[candidate].deltaECam16Ucs.push(comparisons[candidate].deltaECam16Ucs);
      }
      const upstream = comparisonMetrics(
        measuredBlackAligned,
        evaluateUpstreamD65(measurement.upstreamD65Fixture.parameters, rgb),
        white,
      );
      const upstreamAlignedXyz = add3(
        model.globalBlack,
        evaluateUpstreamD65(measurement.upstreamD65Fixture.parameters, rgb)
          .map((value, component) => value * upstreamAbsoluteScale[component]),
      );
      const upstreamAligned = comparisonMetrics(measuredBlackAligned, upstreamAlignedXyz, white);
      upstreamBuckets.deltaE00.push(upstream.deltaE00);
      upstreamBuckets.deltaECam16Ucs.push(upstream.deltaECam16Ucs);
      upstreamAlignedBuckets.deltaE00.push(upstreamAligned.deltaE00);
      upstreamAlignedBuckets.deltaECam16Ucs.push(upstreamAligned.deltaECam16Ucs);
      return {
        sourceReading: reading.sourceReading,
        sourceCoordinate,
        rgb555Continuous: rgb.map((value) => value * 31),
        sourceBlackXyz: sourceBlack,
        measuredBlackAlignedXyz: measuredBlackAligned,
        candidates: comparisons,
        upstreamShaderExactNoBlack: upstream,
        upstreamWhiteAndBlackAligned: upstreamAligned,
      };
    });
    series[name] = {
      sourcePatchCount: rows.length,
      codeMappingPolicy: sourceSeries.codeMappingPolicy,
      rows,
      summary: Object.fromEntries(candidates.map((candidate) => [candidate, {
        deltaE00: summarize(rows.map((row) => row.candidates[candidate].deltaE00)),
        deltaECam16Ucs: summarize(rows.map((row) => row.candidates[candidate].deltaECam16Ucs)),
      }])),
    };
  }

  const aggregates = Object.fromEntries(candidates.map((candidate) => [candidate, {
    deltaE00: summarize(aggregateBuckets[candidate].deltaE00),
    deltaECam16Ucs: summarize(aggregateBuckets[candidate].deltaECam16Ucs),
  }]));
  aggregates.upstreamShaderExactNoBlack = {
    deltaE00: summarize(upstreamBuckets.deltaE00),
    deltaECam16Ucs: summarize(upstreamBuckets.deltaECam16Ucs),
  };
  aggregates.upstreamWhiteAndBlackAligned = {
    deltaE00: summarize(upstreamAlignedBuckets.deltaE00),
    deltaECam16Ucs: summarize(upstreamAlignedBuckets.deltaECam16Ucs),
  };

  const gray = series.Greyscale;
  const pairwiseGray = summarize(gray.rows.map((row) => row.candidates.pairwise.deltaE00));
  const pairwiseNeutralGray = summarize(gray.rows.map((row) => row.candidates["pairwise-neutral"].deltaE00));
  return cleanDeep({
    schemaVersion: 1,
    reportId: "cgb001-ws1-perceptual-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    evidenceIds: ["CGB-HCS-REFLECTANCE-2026"],
    referenceCondition: {
      illuminant: "CIE D65",
      illuminationAngleDegrees: 45,
      viewAngleDegrees: 0,
      observer: "CIE 1931 2 degree",
      recordedSpectrumRangeNm: [380, 730],
    },
    comparisonPolicy: {
      measured: "source reading minus its own series black plus the dedicated Summary black",
      sourceCoordinate: "ordered source index normalized from zero to one; no missing R code or extra G code identity is invented",
      deltaE00White: white,
      cam16UcsViewingConditions: {
        adaptingLuminanceCdM2: 64 / Math.PI / 5,
        backgroundLuminance: 20,
        surround: "average (F=1, c=0.69, Nc=1)",
      },
      upstreamComparison: "exact pinned Shader equation without measured black; reported as a regression fixture, not a fair absolute-reflectance candidate",
      upstreamAbsoluteComparison: {
        policy: "component-wise map the upstream normalized white to the black-subtracted measured Greyscale endpoint, then add the project's dedicated measured black",
        upstreamNormalizedWhiteXyz: upstreamWhite,
        measuredWhiteDeltaXyz: measuredWhiteDelta,
        componentScale: upstreamAbsoluteScale,
      },
    },
    aggregates,
    heldOutGrayComparison: {
      policy: "pairwise uses R/G/B plus Y/C/M and does not use Greyscale; pairwise-neutral then adds the measured Greyscale residual; runtime-monotonic-lut applies the declared global 3D luminance projection",
      pairwiseDeltaE00: pairwiseGray,
      pairwiseNeutralDeltaE00: pairwiseNeutralGray,
      changeInMeanDeltaE00: pairwiseNeutralGray.mean - pairwiseGray.mean,
      runtimeMonotonicLutDeltaE00: summarize(gray.rows.map((row) => row.candidates["runtime-monotonic-lut"].deltaE00)),
    },
    series,
  });
}

function buildCandidateSelectionAudit(perceptual) {
  const tolerance = 1e-9;
  const cornerComparisons = Object.entries(perceptual.series).map(([series, report]) => {
    const endpoint = report.rows.at(-1);
    const runtime = endpoint.candidates["runtime-monotonic-lut"];
    const upstream = endpoint.upstreamWhiteAndBlackAligned;
    return {
      series,
      sourceReading: endpoint.sourceReading,
      runtimeDeltaE00: runtime.deltaE00,
      upstreamWhiteAndBlackAlignedDeltaE00: upstream.deltaE00,
      runtimeNoWorse: runtime.deltaE00 <= upstream.deltaE00 + tolerance,
    };
  });
  const runtime = perceptual.aggregates["runtime-monotonic-lut"];
  const upstream = perceptual.aggregates.upstreamWhiteAndBlackAligned;
  const gray = perceptual.heldOutGrayComparison;
  return cleanDeep({
    selectedCandidate: "runtime-monotonic-lut",
    comparisonToleranceDeltaE00: tolerance,
    selectionPolicy: "finite and non-negative output, coordinate-wise luminance monotonicity, measured endpoint comparison, held-out gray improvement, and perceptual error",
    cornerComparisons,
    measuredPatchAggregate: {
      runtimeDeltaE00: runtime.deltaE00,
      upstreamWhiteAndBlackAlignedDeltaE00: upstream.deltaE00,
      runtimeNoWorse: runtime.deltaE00.mean <= upstream.deltaE00.mean + tolerance
        && runtime.deltaE00.maximum <= upstream.deltaE00.maximum + tolerance,
    },
    heldOutGray: {
      pairwiseMeanDeltaE00: gray.pairwiseDeltaE00.mean,
      runtimeMeanDeltaE00: gray.runtimeMonotonicLutDeltaE00.mean,
      improved: gray.runtimeMonotonicLutDeltaE00.mean <= gray.pairwiseDeltaE00.mean + tolerance,
    },
    pass: cornerComparisons.every((comparison) => comparison.runtimeNoWorse)
      && runtime.deltaE00.mean <= upstream.deltaE00.mean + tolerance
      && runtime.deltaE00.maximum <= upstream.deltaE00.maximum + tolerance
      && gray.runtimeMonotonicLutDeltaE00.mean <= gray.pairwiseDeltaE00.mean + tolerance,
  });
}

function validateLut(lut, model, packed) {
  let nonFiniteCount = 0;
  let negativeCount = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of lut.values) {
    if (!Number.isFinite(value)) nonFiniteCount += 1;
    if (value < 0) negativeCount += 1;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  let maximumAnalyticSeedGridDifference = 0;
  let maximumCpuGridError = 0;
  let maximumTrilinearGridError = 0;
  let maximumFloat32PackingError = 0;
  let monotonicLuminanceViolationCount = 0;
  let largestMonotonicLuminanceDrop = 0;
  for (let b = 0; b < lut.size; b += 1) {
    for (let g = 0; g < lut.size; g += 1) {
      for (let r = 0; r < lut.size; r += 1) {
        const index = lutIndex(lut.size, r, g, b);
        const actual = Array.from(lut.values.slice(index, index + 3));
        const rgb = [r, g, b].map((value) => value / (lut.size - 1));
        maximumAnalyticSeedGridDifference = Math.max(maximumAnalyticSeedGridDifference,
          maxAbsoluteDifference(actual, evaluateColorModel(model, rgb, "pairwise-neutral")));
        const sampled = sampleXyzLutTrilinear(lut, rgb);
        maximumCpuGridError = Math.max(maximumCpuGridError, maxAbsoluteDifference(actual, sampled));
        maximumTrilinearGridError = Math.max(maximumTrilinearGridError, maxAbsoluteDifference(actual, sampled));
        const packedOffset = ((b * lut.size + g) * lut.size + r) * 16;
        maximumFloat32PackingError = Math.max(maximumFloat32PackingError,
          Math.abs(actual[0] - packed.readFloatLE(packedOffset)),
          Math.abs(actual[1] - packed.readFloatLE(packedOffset + 4)),
          Math.abs(actual[2] - packed.readFloatLE(packedOffset + 8)));
        for (let axis = 0; axis < 3; axis += 1) {
          if ([r, g, b][axis] === 0) continue;
          const previous = [r, g, b];
          previous[axis] -= 1;
          const previousIndex = lutIndex(lut.size, previous[0], previous[1], previous[2]);
          const drop = actual[1] - lut.values[previousIndex + 1];
          if (drop < -1e-12) {
            monotonicLuminanceViolationCount += 1;
            largestMonotonicLuminanceDrop = Math.min(largestMonotonicLuminanceDrop, drop);
          }
        }
      }
    }
  }
  return cleanDeep({
    entryCount: lut.size ** 3,
    componentCount: lut.values.length,
    minimumComponent: minimum,
    maximumComponent: maximum,
    nonFiniteCount,
    negativeComponentCount: negativeCount,
    maximumAnalyticSeedIntegerGridDifference: maximumAnalyticSeedGridDifference,
    maximumCpuIntegerGridError: maximumCpuGridError,
    maximumTrilinearIntegerGridError: maximumTrilinearGridError,
    maximumFloat32PackingError,
    monotonicLuminanceViolationCount,
    largestMonotonicLuminanceDrop,
    pass: nonFiniteCount === 0
      && negativeCount === 0
      && maximumCpuGridError <= 1e-12
      && maximumTrilinearGridError <= 1e-12
      && maximumFloat32PackingError <= 1e-6
      && monotonicLuminanceViolationCount === 0,
  });
}

function buildFixtures(model, usableModel, runtimeLut, usableRuntimeLut) {
  const fixtures = [
    ["K", [0, 0, 0]],
    ["R", [31, 0, 0]],
    ["G", [0, 31, 0]],
    ["B", [0, 0, 31]],
    ["Y", [31, 31, 0]],
    ["C", [0, 31, 31]],
    ["M", [31, 0, 31]],
    ["W", [31, 31, 31]],
    ["gray-08", [8, 8, 8]],
    ["gray-16", [16, 16, 16]],
    ["gray-24", [24, 24, 24]],
    ["mixed-07-19-29", [7, 19, 29]],
    ["mixed-27-11-04", [27, 11, 4]],
  ].map(([id, rgb555]) => {
    const rgb = rgb555.map((value) => value / 31);
    const xyz = sampleXyzLutTrilinear(runtimeLut, rgb);
    const analyticSeedXyz = evaluateColorModel(model, rgb, "pairwise-neutral");
    const usableXyz = sampleXyzLutTrilinear(usableRuntimeLut, rgb);
    const linearSrgb = xyzToLinearSrgb(xyz);
    return {
      id,
      rgb555,
      xyzReflectance: xyz,
      analyticSeedXyz,
      monotonicProjection: {
        maximumAbsoluteXyzDifference: maxAbsoluteDifference(xyz, analyticSeedXyz),
        deltaE00: deltaE00Xyz(xyz, analyticSeedXyz, model.referenceWhite),
      },
      xyY: xyzToXyY(xyz),
      linearSrgbAbsolute: linearSrgb,
      srgbAbsoluteUnclipped: xyzToSrgb(xyz),
      sourceRangeSensitivity: {
        authorUsable440To700Xyz: usableXyz,
        maximumAbsoluteXyzDifference: maxAbsoluteDifference(xyz, usableXyz),
        deltaE00UsingRecordedRangeWhite: deltaE00Xyz(xyz, usableXyz, model.referenceWhite),
      },
    };
  });
  return cleanDeep({
    schemaVersion: 1,
    fixtureId: "cgb001-ws1-static-fixtures-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    encoding: {
      source: "RGB555 integer codes",
      modelOutput: "absolute relative-reflectance XYZ under the declared D65 integration",
      presentation: "unclipped sRGB D65 values are diagnostic only; target exposure is not baked in",
    },
    fixtures,
  });
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(cleanDeep(value), null, 2)}\n`);
}

function sourceJsonBuffer(value) {
  // Keep the imported measurement record byte-identical to the canonical
  // importer. Cross-platform cleanup belongs only to derived WS1 artifacts.
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function buildArtifacts() {
  const measurement = buildMeasurementRecord();
  const measurementBuffer = sourceJsonBuffer(measurement);
  const model = buildColorModel(measurement, { field: "d65XyzRecordedRange", monotonic: true });
  const usableModel = buildColorModel(measurement, { field: "d65XyzAuthorUsableRange", monotonic: true, id: "cgb001-d65-440-700-sensitivity-v1" });
  const upstreamAudit = upstreamFixtureAudit(measurement.upstreamD65Fixture.parameters);
  const mathAudit = colorMathAudit();
  const analyticLut = buildXyzLut(model, "pairwise-neutral", 32);
  const projection = projectLutLuminanceMonotonic(analyticLut, model.globalBlack);
  const lut = projection.lut;
  const usableProjection = projectLutLuminanceMonotonic(
    buildXyzLut(usableModel, "pairwise-neutral", 32),
    usableModel.globalBlack,
  );
  const perceptual = buildPerceptualReport(measurement, model, lut);
  const selectionAudit = buildCandidateSelectionAudit(perceptual);
  const fixtures = buildFixtures(model, usableModel, lut, usableProjection.lut);
  const lutBinary = packXyzLutRgba32f(lut);
  const lutHash = sha256(lutBinary);
  const lutValidation = validateLut(lut, model, lutBinary);
  const repairs = modelRepairAudit(model);
  const residualEndpointNorms = Object.fromEntries(Object.entries(model.residual).map(([name, values]) => [
    name,
    Math.hypot(...values.at(-1)),
  ]));

  const audit = cleanDeep({
    schemaVersion: 1,
    reportId: "cgb001-ws1-color-audit-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    evidenceIds: ["CGB-HCS-REFLECTANCE-2026"],
    rawSourceAudit: measurement.audit,
    colorMathRegression: mathAudit,
    candidateSelection: selectionAudit,
    upstreamParameterRegression: upstreamAudit,
    normalizationRepairs: repairs,
    interactionEvidence: {
      residualDefinition: "black-aligned measured Y/C/M/Greyscale ramps minus their primary, pair, and neutral lower-order components",
      endpointResidualEuclideanXyz: residualEndpointNorms,
      additivityFailurePresent: Object.values(residualEndpointNorms).some((value) => value > 1e-6),
    },
    monotonicRuntimeProjection: projection.audit,
    shortWavelengthSensitivity: {
      recordedReferenceRangeNm: [380, 730],
      authorUsableDiagnosticRangeNm: [440, 700],
      defaultPolicy: "preserve source-recorded range because the user accepts the pinned spectra as reference; retain the author-usable range as a sensitivity report",
      fixtureDeltaE00: fixtures.fixtures.map((fixture) => ({
        id: fixture.id,
        deltaE00: fixture.sourceRangeSensitivity.deltaE00UsingRecordedRangeWhite,
      })),
    },
    lutValidation,
    result: {
      pass: upstreamAudit.pass
        && mathAudit.pass
        && measurement.audit.txtCrossCheck.pass
        && selectionAudit.pass
        && projection.audit.converged
        && projection.audit.after.violationCount === 0
        && lutValidation.pass,
    },
  });

  const auditBuffer = jsonBuffer(audit);
  const perceptualBuffer = jsonBuffer(perceptual);
  const fixturesBuffer = jsonBuffer(fixtures);
  const lutDescriptor = cleanDeep({
    schemaVersion: 1,
    artifactId: "cgb001-d65-lut-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    classification: "derived runtime artifact",
    evidenceIds: ["CGB-HCS-REFLECTANCE-2026"],
    sourceRecord: "../data/hcs-source-v1.json",
    colorRecord: "../data/color-reference-v1.json",
    dimensions: [32, 32, 32],
    axisOrder: "R fastest, then G, then B",
    domain: "continuous RGB555 code space normalized to 0..1",
    texelFormat: "little-endian R32G32B32A32_SFLOAT",
    channels: ["X absolute relative reflectance", "Y absolute relative reflectance", "Z absolute relative reflectance", "1"],
    interpolation: "trilinear; every integer RGB555 code is a texel center",
    byteLength: lutBinary.length,
    sha256: lutHash,
    validation: lutValidation,
  });
  const lutDescriptorBuffer = jsonBuffer(lutDescriptor);

  const colorRecord = cleanDeep({
    schemaVersion: 1,
    colorModelId: "cgb001-reference-d65-v1",
    modelId: "nintendo-cgb-001-period-reconstruction",
    classification: "measured-constrained-derived",
    evidenceIds: ["CGB-HCS-REFLECTANCE-2026"],
    inputRecord: "hcs-source-v1.json",
    sourceOfRecord: {
      policy: "verbatim upstream measurement is the reference; this model is a runtime reduction and never replaces it",
      ods: "../reference/upstream/hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b/measurements/gbc_reflectance.ods",
      txt: "../reference/upstream/hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b/measurements/gbc_reflectance.txt",
    },
    referenceCondition: {
      illuminant: "CIE D65",
      illuminationAngleDegrees: 45,
      viewAngleDegrees: 0,
      encoding: "sRGB D65",
      spectralIntegrationRangeNm: [380, 730],
      runtimeAngleModel: false,
    },
    blackPolicy: {
      id: "dedicated-summary-black-v1",
      description: "Use the dedicated Summary Black spectrum as global absolute black; subtract each ramp's own first reading before combining it so measured series drift remains auditable without contaminating response amplitude.",
      classification: "measured-constrained-derived",
      xyz: model.globalBlack,
    },
    interactionPolicy: {
      id: "pairwise-plus-neutral-diagonal-residual-v1",
      description: "Use black-aligned R/G/B ramps, measured Y/C/M diagonal residuals extended by geometric-mean pair coordinates, and the measured Greyscale residual extended by the geometric-mean triple coordinate; then project the derived 32-cubed luminance field onto the three axis-wise isotonic cones.",
      classification: "measured-constrained-derived",
      selectedCandidate: "runtime-monotonic-lut",
      candidates: [
        { id: "primary-only", role: "additivity diagnostic" },
        { id: "pairwise", role: "Y/C/M constrained candidate with Greyscale held out" },
        { id: "pairwise-neutral", role: "analytic seed candidate using every measured ramp" },
        { id: "runtime-monotonic-lut", role: "released LUT after explicit 3D luminance projection of pairwise-neutral" },
        { id: "hcs-upstream-shader-v1", role: "exact pinned upstream equation comparison; omits measured black" },
        { id: "hcs-upstream-white-and-black-aligned-v1", role: "fair absolute-reflectance comparison after mapping upstream normalized white and adding measured black" },
      ],
    },
    normalization: {
      codeMappingPolicy: "identity for 32-reading ramps; endpoint-preserving uniform source-index resampling for R=31 and G=33",
      monotonicPolicy: "PAVA projection of each black-subtracted measured ramp, then Dykstra projection of the derived 32-cubed Y field onto all three axis-wise isotonic cones; XYZ direction relative to black is scaled per voxel and raw values remain untouched",
      repairReport: "../generated/ws1-color-audit-v1.json",
    },
    runtimeLut: {
      dimensions: [32, 32, 32],
      domain: "continuous RGB555 code space",
      encoding: "absolute relative-reflectance XYZ in RGBA32F",
      artifact: "../generated/cgb001-d65-lut-v1.rgba32f",
      descriptor: "../generated/cgb001-d65-lut-v1.json",
      sha256: lutHash,
    },
    validation: {
      status: audit.result.pass ? "pass" : "fail",
      report: "../generated/ws1-perceptual-v1.json",
      staticFixtures: "../generated/ws1-static-fixtures-v1.json",
      upstreamParameterTolerance: 1e-6,
      upstreamParameterMaximumDifference: upstreamAudit.maximumDifference,
      lut: lutValidation,
      targetExposureBakedIn: false,
    },
    limitations: [
      "The accepted source contains invalid short wavelengths, negative reflectance, black drift, R/G patch-count mismatch, and unrecorded measurement conditions.",
      "Only seven one-dimensional RGB axes/diagonals are measured; arbitrary mixed colors use a declared geometric-mean interaction extension.",
      "The project monotonic model is a transparent runtime reduction; the verbatim ODS/TXT remain the reference of record.",
      "The result applies only to the frozen D65 45 degree illumination and 0 degree panel-normal viewing condition.",
    ],
  });
  const colorRecordBuffer = jsonBuffer(colorRecord);

  const outputsBeforeReceipt = {
    [measurementRelative]: measurementBuffer,
    [colorRecordRelative]: colorRecordBuffer,
    [lutDescriptorRelative]: lutDescriptorBuffer,
    [auditRelative]: auditBuffer,
    [perceptualRelative]: perceptualBuffer,
    [fixturesRelative]: fixturesBuffer,
    [lutBinaryRelative]: lutBinary,
  };
  const trackedInputs = [
    `${modelRelative}/reference/upstream/README.md`,
    ...measurement.sourceArtifacts.map((artifact) => artifact.repositoryPath),
    ...measurement.cieReferences.map((artifact) => artifact.repositoryPath),
    `${modelRelative}/reference/color-reference.mjs`,
    `${modelRelative}/data/measurement-normalization.schema.json`,
    `${modelRelative}/data/color-model.schema.json`,
    "tools/import-cgb001-hcs.mjs",
    "tools/build-cgb001-ws1.mjs",
  ];
  const receipt = cleanDeep({
    schemaVersion: 1,
    receiptId: "cgb001-ws1-receipt-v1",
    generatedBy: "tools/build-cgb001-ws1.mjs",
    modelId: "nintendo-cgb-001-period-reconstruction",
    workstream: "WS1",
    completedOn: "2026-08-24",
    sourcePolicy: "verbatim raw reference retained with attribution; derived layers remain separate",
    trackedInputHashes: Object.fromEntries(trackedInputs.map((relative) => [
      relative,
      sha256(fs.readFileSync(path.join(root, relative))),
    ])),
    outputHashes: Object.fromEntries(Object.entries(outputsBeforeReceipt).map(([relative, buffer]) => [relative, sha256(buffer)])),
    gates: {
      rawOdsHashVerified: true,
      rawTxtHashVerified: true,
      txtOdsCrossCheck: measurement.audit.txtCrossCheck.pass,
      upstreamParametersReproduced: upstreamAudit.pass,
      colorMathRegression: mathAudit.pass,
      candidateSelection: selectionAudit.pass,
      allLutEntriesFinite: lutValidation.nonFiniteCount === 0,
      allLutEntriesNonNegative: lutValidation.negativeComponentCount === 0,
      monotonicProjectionConverged: projection.audit.converged,
      integerGridDeterministic: lutValidation.maximumCpuIntegerGridError <= 1e-12,
      float32PackingWithinTolerance: lutValidation.maximumFloat32PackingError <= 1e-6,
      monotonicLuminance: lutValidation.monotonicLuminanceViolationCount === 0,
      targetExposureNotBakedIn: true,
      shaderOrPresetCreated: false,
    },
    result: {
      status: audit.result.pass ? "pass" : "fail",
      ws1Complete: audit.result.pass,
      referenceV1ShaderOrPresetAllowed: false,
      nextEligibleWorkstreams: audit.result.pass ? ["WS2", "WS3", "WS6"] : [],
    },
  });
  const receiptBuffer = jsonBuffer(receipt);
  return {
    outputs: { ...outputsBeforeReceipt, [receiptRelative]: receiptBuffer },
    audit,
    colorRecord,
    receipt,
  };
}

function parseArguments(argv) {
  const options = { checkOnly: false, allowFailedArtifacts: false };
  for (const argument of argv) {
    if (argument === "--check") options.checkOnly = true;
    else if (argument === "--allow-failed-artifacts") options.allowFailedArtifacts = true;
    else if (argument === "--help") {
      console.log("Usage: node tools/build-cgb001-ws1.mjs [--check] [--allow-failed-artifacts]");
      return null;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  const artifacts = buildArtifacts();
  if (options.checkOnly) {
    for (const [relative, expected] of Object.entries(artifacts.outputs)) {
      const file = path.join(root, relative);
      assert(fs.existsSync(file), `missing WS1 artifact: ${relative}`);
      assert(fs.readFileSync(file).equals(expected), `${relative} is stale; run node tools/build-cgb001-ws1.mjs`);
    }
    console.log("CGB-001 WS1 color-reference artifacts are current.");
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(generatedDir, { recursive: true });
    for (const [relative, buffer] of Object.entries(artifacts.outputs)) {
      fs.writeFileSync(path.join(root, relative), buffer);
      console.log(`Wrote ${relative}`);
    }
  }
  if (artifacts.receipt.result.status !== "pass" && !options.allowFailedArtifacts) {
    throw new Error("WS1 acceptance gates failed; inspect generated/ws1-color-audit-v1.json");
  }
}

try {
  main();
} catch (error) {
  console.error(`CGB-001 WS1 build failed: ${error.message}`);
  process.exitCode = 1;
}
