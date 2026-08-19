#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { altPleshkoAmplitudes } from "../models/nintendo-dmg-01/reference/stn-physics.mjs";
import {
  CROSSTALK_KERNEL_RADIUS,
  applySpatialKernelSurrogate,
  fitAlternatingCrosstalkResidual,
  fitSpatialKernelSurrogate,
  makePattern,
  pixelCapacitance,
  pixelLeakageResistance,
  simulateDistributedPattern,
  spatialKernelFeatureKeys,
  spatialKernelSurrogateFeatures,
} from "../models/nintendo-dmg-01/reference/passive-matrix-crosstalk.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const evidencePath = path.join(modelDir, "data", "passive-matrix-crosstalk-evidence-v1.json");
const drivePath = path.join(modelDir, "data", "dmg-drive-v1.json");
const outputPath = path.join(modelDir, "generated", "ws5-crosstalk-v1.json");
const includePath = path.join(modelDir, "shaders", "dmg01-crosstalk-surrogate.inc");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function clean(value, digits = 12) {
  return Number(value.toFixed(digits));
}

function quantiles(values, probabilities) {
  const sorted = [...values].sort((a, b) => a - b);
  return probabilities.map((probability) => {
    const position = probability * (sorted.length - 1);
    const low = Math.floor(position);
    const fraction = position - low;
    return sorted[low] * (1 - fraction) + sorted[Math.min(low + 1, sorted.length - 1)] * fraction;
  });
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const drive = JSON.parse(fs.readFileSync(drivePath, "utf8"));
const dimensions = evidence.knownDmgInputs;
const area = evidence.derivedPixelElectricalBounds.activePixelAreaSquareMeters;
const amplitudes = altPleshkoAmplitudes(drive, 1);
const patternIds = [
  "single-dot", "full-row", "full-column", "checkerboard",
  "alternating-lines", "window", "inverse-window", "solid-mino-fixture",
];
const heldOutPatternIds = ["solid-mino-validation"];
const allPatternIds = [...patternIds, ...heldOutPatternIds];
const uniformIds = [0, 1, 2, 3].map((shade) => `uniform-${shade}`);
const reports = [];
const fitByEnsemble = {};

for (const ensemble of evidence.ensembles) {
  const recomputedCapacitance = pixelCapacitance(
    area, ensemble.cellGapMicrometers, ensemble.effectiveRelativePermittivity,
  );
  if (Math.abs(recomputedCapacitance * 1e12 - ensemble.pixelCapacitancePicofarads) > 1e-12) {
    fail(`${ensemble.id} stored pixel capacitance is stale`);
  }
  const leakage = pixelLeakageResistance(
    area, ensemble.cellGapMicrometers, ensemble.volumeResistivityOhmCentimeters,
  );
  const options = {
    rowAmplitude: amplitudes.rowSelectAmplitude,
    columnAmplitude: amplitudes.columnAmplitude,
    dwellSeconds: dimensions.dwellMicroseconds * 1e-6,
    sheetResistanceOhmsPerSquare: ensemble.sheetResistanceOhmsPerSquare,
    electrodeWidthFractionOfPitch: dimensions.electrodeWidthFractionOfPitch,
    rowDriverResistanceOhms: ensemble.rowDriverResistanceOhms,
    columnDriverResistanceOhms: ensemble.columnDriverResistanceOhms,
    pixelCapacitanceFarads: recomputedCapacitance,
    pixelLeakageResistanceOhms: leakage,
    warmupFrames: 1,
    measuredFrames: 1,
    substepsPerDwell: 8,
  };
  const uniform = new Map();
  for (const id of uniformIds) {
    uniform.set(Number(id.slice(-1)), simulateDistributedPattern(makePattern(id), options));
  }
  const fitSamples = [];
  const heldOutSamples = [];
  const patternReports = [];
  for (const id of allPatternIds) {
    const pattern = makePattern(id);
    const result = simulateDistributedPattern(pattern, options);
    const deltas = new Array(pattern.shades.length);
    let sumSquared = 0;
    let maximumAbsolute = 0;
    let maximumIndex = 0;
    for (let i = 0; i < deltas.length; i += 1) {
      const shade = pattern.shades[i];
      const baseline = uniform.get(shade).driveCoordinates[i];
      const delta = result.driveCoordinates[i] - baseline;
      deltas[i] = delta;
      sumSquared += delta * delta;
      if (Math.abs(delta) > maximumAbsolute) {
        maximumAbsolute = Math.abs(delta);
        maximumIndex = i;
      }
      const x = i % pattern.columns;
      const y = Math.floor(i / pattern.columns);
      const features = spatialKernelSurrogateFeatures(
        pattern.shades, pattern.columns, pattern.rows, x, y,
      );
      const sample = { ...features, delta, patternId: id, x, y, localDrive: shade };
      (heldOutPatternIds.includes(id) ? heldOutSamples : fitSamples).push(sample);
    }
    const [p05, median, p95] = quantiles(deltas, [0.05, 0.5, 0.95]);
    patternReports.push({
      id,
      rmsDriveCoordinateError: clean(Math.sqrt(sumSquared / deltas.length)),
      maximumAbsoluteDriveCoordinateError: clean(maximumAbsolute),
      maximumLocation: [maximumIndex % pattern.columns, Math.floor(maximumIndex / pattern.columns)],
      signedQuantiles: { p05: clean(p05), median: clean(median), p95: clean(p95) },
      centerDriveCoordinate: clean(result.driveCoordinates[72 * 160 + 80]),
      omittedSecondOrderInstantaneousUpperBound: clean(result.omittedSecondOrderFractionBound),
    });
  }
  const baseFitSamples = fitSamples.filter((sample) => ![
    "checkerboard", "alternating-lines",
  ].includes(sample.patternId));
  const fit = fitSpatialKernelSurrogate(baseFitSamples);
  fit.alternatingCoefficients = fitAlternatingCrosstalkResidual(
    fitSamples.filter((sample) => ["checkerboard", "alternating-lines"].includes(sample.patternId)),
    fit,
  );
  fitByEnsemble[ensemble.id] = fit;
  let squaredResidual = 0;
  let maximumResidual = 0;
  let maximumResidualContext = null;
  const absoluteResiduals = [];
  for (const sample of fitSamples) {
    const predicted = applySpatialKernelSurrogate(
      sample.localDrive, sample, fit,
    ) - sample.localDrive;
    const residual = predicted - sample.delta;
    absoluteResiduals.push(Math.abs(residual));
    squaredResidual += residual * residual;
    if (Math.abs(residual) > maximumResidual) {
      maximumResidual = Math.abs(residual);
      maximumResidualContext = {
        patternId: sample.patternId,
        location: [sample.x, sample.y],
        localDrive: sample.localDrive,
        networkDelta: clean(sample.delta),
        surrogateDelta: clean(predicted),
      };
    }
  }
  let heldOutSquaredResidual = 0;
  let heldOutMaximumResidual = 0;
  let heldOutMaximumContext = null;
  let heldOutSolidMaximumNetworkDelta = 0;
  const heldOutAbsoluteResiduals = [];
  for (const sample of heldOutSamples) {
    const predicted = applySpatialKernelSurrogate(
      sample.localDrive, sample, fit,
    ) - sample.localDrive;
    const residual = predicted - sample.delta;
    heldOutSquaredResidual += residual * residual;
    heldOutAbsoluteResiduals.push(Math.abs(residual));
    if (sample.localDrive > 0) {
      heldOutSolidMaximumNetworkDelta = Math.max(
        heldOutSolidMaximumNetworkDelta, Math.abs(sample.delta),
      );
    }
    if (Math.abs(residual) > heldOutMaximumResidual) {
      heldOutMaximumResidual = Math.abs(residual);
      heldOutMaximumContext = {
        patternId: sample.patternId,
        location: [sample.x, sample.y],
        localDrive: sample.localDrive,
        networkDelta: clean(sample.delta),
        surrogateDelta: clean(predicted),
      };
    }
  }
  reports.push({
    id: ensemble.id,
    parameters: {
      sheetResistanceOhmsPerSquare: ensemble.sheetResistanceOhmsPerSquare,
      electrodeSegmentResistanceOhms: clean(
        ensemble.sheetResistanceOhmsPerSquare / dimensions.electrodeWidthFractionOfPitch,
      ),
      rowDriverResistanceOhms: ensemble.rowDriverResistanceOhms,
      columnDriverResistanceOhms: ensemble.columnDriverResistanceOhms,
      pixelCapacitancePicofarads: clean(recomputedCapacitance * 1e12),
      pixelLeakageResistanceOhms: clean(leakage, 3),
      leakageTimeConstantSeconds: clean(leakage * recomputedCapacitance),
    },
    patterns: patternReports,
    surrogate: {
      kind: "distributed signed spatial kernel",
      radiusPixels: fit.radius,
      ridge: clean(fit.ridge),
      coefficients: Object.fromEntries(Object.entries(fit.coefficients).map(
        ([key, value]) => [key, clean(value)],
      )),
      alternatingCoefficients: Object.fromEntries(Object.entries(fit.alternatingCoefficients).map(
        ([key, value]) => [key, clean(value)],
      )),
      rmsResidualDriveCoordinate: clean(Math.sqrt(squaredResidual / fitSamples.length)),
      p99AbsoluteResidualDriveCoordinate: clean(quantiles(absoluteResiduals, [0.99])[0]),
      maximumAbsoluteResidualDriveCoordinate: clean(maximumResidual),
      maximumResidualContext,
      samples: fitSamples.length,
      heldOutSolidMino: {
        rmsResidualDriveCoordinate: clean(Math.sqrt(
          heldOutSquaredResidual / heldOutSamples.length,
        )),
        p99AbsoluteResidualDriveCoordinate: clean(
          quantiles(heldOutAbsoluteResiduals, [0.99])[0],
        ),
        maximumAbsoluteResidualDriveCoordinate: clean(heldOutMaximumResidual),
        maximumNetworkDeltaOnSolidPixels: clean(heldOutSolidMaximumNetworkDelta),
        maximumResidualContext: heldOutMaximumContext,
        samples: heldOutSamples.length,
      },
    },
  });
}

// Convergence is checked on the strongest sourced ensemble and worst-frequency
// checkerboard. Eight substeps is the production reference; sixteen is the
// independent refinement.
const high = evidence.ensembles.find((item) => item.id === "plausible-high");
const highCapacitance = high.pixelCapacitancePicofarads * 1e-12;
const commonHighOptions = {
  rowAmplitude: amplitudes.rowSelectAmplitude,
  columnAmplitude: amplitudes.columnAmplitude,
  dwellSeconds: dimensions.dwellMicroseconds * 1e-6,
  sheetResistanceOhmsPerSquare: high.sheetResistanceOhmsPerSquare,
  electrodeWidthFractionOfPitch: dimensions.electrodeWidthFractionOfPitch,
  rowDriverResistanceOhms: high.rowDriverResistanceOhms,
  columnDriverResistanceOhms: high.columnDriverResistanceOhms,
  pixelCapacitanceFarads: highCapacitance,
  pixelLeakageResistanceOhms: pixelLeakageResistance(
    area, high.cellGapMicrometers, high.volumeResistivityOhmCentimeters,
  ),
  warmupFrames: 1,
  measuredFrames: 1,
};
const convergencePattern = makePattern("checkerboard");
const coarse = simulateDistributedPattern(convergencePattern, { ...commonHighOptions, substepsPerDwell: 8 });
const refined = simulateDistributedPattern(convergencePattern, { ...commonHighOptions, substepsPerDwell: 16 });
let maximumConvergenceDifference = 0;
let squaredConvergenceDifference = 0;
for (let i = 0; i < coarse.driveCoordinates.length; i += 1) {
  const difference = coarse.driveCoordinates[i] - refined.driveCoordinates[i];
  maximumConvergenceDifference = Math.max(maximumConvergenceDifference, Math.abs(difference));
  squaredConvergenceDifference += difference * difference;
}

const nominal = reports.find((item) => item.id === "nominal");
const checks = {
  allInputsSourcedOrDerived: evidence.ensembles.every((item) => item.basis.length > 0),
  capacitanceRecomputed: true,
  leakageNegligibleAtDwell: evidence.derivedPixelElectricalBounds.minimumLeakageTimeConstantToDwellRatio > 500,
  constantFieldsUnchangedByDefinition: true,
  canonicalPatternsComplete: reports.every((report) => report.patterns.length === 9),
  boundedEnsemblesComplete: reports.length === 3,
  surrogateFinite: Object.values(fitByEnsemble).every((fit) => [
    ...Object.values(fit.coefficients), ...Object.values(fit.alternatingCoefficients), fit.ridge,
  ].every(Number.isFinite)),
  nominalSurrogateRmsErrorBelow0_05Shade: nominal.surrogate.rmsResidualDriveCoordinate < 0.05,
  nominalHeldOutSolidMinoRmsErrorBelow0_01Shade:
    nominal.surrogate.heldOutSolidMino.rmsResidualDriveCoordinate < 0.01,
  nominalHeldOutSolidMinoMaximumErrorBelow0_08Shade:
    nominal.surrogate.heldOutSolidMino.maximumAbsoluteResidualDriveCoordinate < 0.08,
  convergenceRmsBelow0_02Shade: Math.sqrt(
    squaredConvergenceDifference / coarse.driveCoordinates.length,
  ) < 0.02,
};

const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws5-crosstalk-v1",
  generatedFrom: {
    evidence: "data/passive-matrix-crosstalk-evidence-v1.json",
    drive: "data/dmg-drive-v1.json",
    cpuReference: "reference/passive-matrix-crosstalk.mjs",
  },
  solver: {
    topology: "one resistor ladder per row and column, one LC capacitance/leakage branch per crossing, driven from one end",
    integration: "backward Euler with 8 substeps per 36.241 us grayscale dwell after one AC-inverted warmup frame",
    coupling: "row and column networks solved against ideal opposite electrodes and combined by first-order linear superposition",
    normalization: "pattern result minus same-shade uniform-field result at the same pixel position",
    opticalCoupling: "RMS voltage is mapped to a continuous four-shade drive coordinate, which the Shader feeds into the existing WS2 director and reflected-optical LUTs",
  },
  nominalDrive: {
    rowAmplitudeVolts: clean(amplitudes.rowSelectAmplitude),
    columnAmplitudeVolts: clean(amplitudes.columnAmplitude),
  },
  ensembles: reports,
  selectedShaderSurrogate: {
    ensemble: "nominal",
    ...nominal.surrogate,
    parameterSemantics: "RowCrosstalk and ColumnCrosstalk are dimensionless sensitivity multipliers around the calculated nominal coefficients; 1.0 is reconstructed nominal and 0.0 disables the mechanism",
  },
  uncertaintyEnvelope: {
    perTapCoefficientBounds: Object.fromEntries(spatialKernelFeatureKeys().map((key) => [key, [
      clean(Math.min(...Object.values(fitByEnsemble).map((item) => item.coefficients[key]))),
      clean(Math.max(...Object.values(fitByEnsemble).map((item) => item.coefficients[key]))),
    ]])),
    dominantInputs: "driver output resistance and total line capacitance set settling; ITO sheet resistance and one-ended topology set the position gradient; LC leakage is negligible on the dwell scale",
  },
  convergence: {
    pattern: "checkerboard",
    ensemble: "plausible-high",
    coarseSubstepsPerDwell: 8,
    refinedSubstepsPerDwell: 16,
    rmsDriveCoordinateDifference: clean(Math.sqrt(
      squaredConvergenceDifference / coarse.driveCoordinates.length,
    )),
    maximumAbsoluteDriveCoordinateDifference: clean(maximumConvergenceDifference),
  },
  checks,
  pass: Object.values(checks).every(Boolean),
};

const coefficientArray = (prefix) => spatialKernelFeatureKeys()
  .filter((key) => key.startsWith(prefix))
  .map((key) => nominal.surrogate.coefficients[key].toFixed(12))
  .join(", ");
const include = `// Generated by tools/build-dmg01-ws5.mjs from period-bounded distributed RC.\n`
  + `// Signed 8-pixel Green-function kernel; 1.0 is nominal and zero disables it.\n`
  + `const int DMG_CROSSTALK_KERNEL_RADIUS = ${CROSSTALK_KERNEL_RADIUS};\n`
  + `const float DMG_CROSSTALK_ROW_BEFORE[${CROSSTALK_KERNEL_RADIUS}] = float[](${coefficientArray("rowBefore")});\n`
  + `const float DMG_CROSSTALK_ROW_AFTER[${CROSSTALK_KERNEL_RADIUS}] = float[](${coefficientArray("rowAfter")});\n`
  + `const float DMG_CROSSTALK_COLUMN_BEFORE[${CROSSTALK_KERNEL_RADIUS}] = float[](${coefficientArray("columnBefore")});\n`
  + `const float DMG_CROSSTALK_COLUMN_AFTER[${CROSSTALK_KERNEL_RADIUS}] = float[](${coefficientArray("columnAfter")});\n`
  + `const float DMG_CROSSTALK_ROW_ALTERNATING = ${nominal.surrogate.alternatingCoefficients.rowAlternating.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_COLUMN_ALTERNATING = ${nominal.surrogate.alternatingCoefficients.columnAlternating.toFixed(12)};\n`;
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== serialized) {
    fail("generated/ws5-crosstalk-v1.json is missing or stale; run node tools/build-dmg01-ws5.mjs");
  }
  if (!fs.existsSync(includePath) || fs.readFileSync(includePath, "utf8") !== include) {
    fail("shaders/dmg01-crosstalk-surrogate.inc is missing or stale; run node tools/build-dmg01-ws5.mjs");
  }
  console.log("DMG-01 WS5 distributed crosstalk report and Shader surrogate are current.");
} else {
  fs.writeFileSync(outputPath, serialized);
  fs.writeFileSync(includePath, include);
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
  console.log(`Wrote ${path.relative(root, includePath)}.`);
}

if (!report.pass) fail("WS5 crosstalk reconstruction checks failed");
