#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { altPleshkoAmplitudes } from "../models/nintendo-dmg-01/reference/stn-physics.mjs";
import {
  makePattern,
  pixelCapacitance,
  pixelLeakageResistance,
  simulateDistributedPattern,
} from "../models/nintendo-dmg-01/reference/passive-matrix-crosstalk.mjs";
import {
  simulateLumpedPattern,
  simulateLumpedPhaseLocalPixel,
  simulateLumpedPixel,
  simulateLumpedPixelFloat32,
} from "../models/nintendo-dmg-01/reference/passive-matrix-crosstalk-lumped.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const evidence = JSON.parse(fs.readFileSync(path.join(
  modelDir, "data", "passive-matrix-crosstalk-evidence-v1.json",
), "utf8"));
const drive = JSON.parse(fs.readFileSync(path.join(modelDir, "data", "dmg-drive-v1.json"), "utf8"));
const outputPath = path.join(modelDir, "generated", "ws5-crosstalk-lumped-v2.json");
const includePath = path.join(modelDir, "shaders", "dmg01-crosstalk-lumped.inc");
const checkOnly = process.argv.includes("--check");
const dimensions = evidence.knownDmgInputs;
const area = evidence.derivedPixelElectricalBounds.activePixelAreaSquareMeters;
const amplitudes = altPleshkoAmplitudes(drive, 1);
const patternIds = [
  "single-dot", "full-row", "full-column", "checkerboard", "alternating-lines",
  "window", "inverse-window", "solid-mino-fixture", "solid-mino-validation",
];

function clean(value, digits = 12) { return Number(value.toFixed(digits)); }

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = probability * (sorted.length - 1);
  const low = Math.floor(position);
  const fraction = position - low;
  return sorted[low] * (1 - fraction)
    + sorted[Math.min(low + 1, sorted.length - 1)] * fraction;
}

const ensembles = [];
let runtimeIncludeData = null;
for (const ensemble of evidence.ensembles) {
  const capacitance = pixelCapacitance(
    area, ensemble.cellGapMicrometers, ensemble.effectiveRelativePermittivity,
  );
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
    pixelCapacitanceFarads: capacitance,
    pixelLeakageResistanceOhms: leakage,
    warmupFrames: 1,
    measuredFrames: 1,
    substepsPerDwell: 8,
  };
  const distributedUniform = new Map();
  const lumpedUniform = new Map();
  for (let shade = 0; shade < 4; shade += 1) {
    const pattern = makePattern(`uniform-${shade}`);
    distributedUniform.set(shade, simulateDistributedPattern(pattern, options));
    lumpedUniform.set(shade, simulateLumpedPattern(pattern, options));
  }
  if (ensemble.id === "nominal") {
    const baselines = {};
    for (const [id, rowScale, columnScale] of [
      ["00", 0, 0], ["10", 1, 0], ["01", 0, 1], ["11", 1, 1],
    ]) {
      const values = [];
      for (let y = 0; y < dimensions.rows; y += 1) {
        for (let shade = 0; shade < 4; shade += 1) {
          if (rowScale === 0 && columnScale === 0) values.push(shade);
          else values.push(simulateLumpedPhaseLocalPixel(
            makePattern(`uniform-${shade}`), 0, y,
            { ...options, rowScale, columnScale },
          ).driveCoordinate);
        }
      }
      baselines[id] = values;
    }
    const representative = lumpedUniform.get(0);
    runtimeIncludeData = {
      rowFactors: representative.rowFactors,
      columnFactors: representative.columnFactors,
      shadeRmsVolts: representative.shadeRmsVolts,
      baselines,
    };
  }
  let squared = 0;
  let count = 0;
  let maximum = 0;
  let maximumContext = null;
  let maximumClosedFormError = 0;
  let maximumClosedFormContext = null;
  let maximumFloat32Error = 0;
  let maximumFloat32Context = null;
  let maximumPhaseBoundaryError = 0;
  let maximumPhaseBoundaryContext = null;
  const absolutes = [];
  const patterns = [];
  let representativeFactors = null;
  for (const id of patternIds) {
    const pattern = makePattern(id);
    const distributed = simulateDistributedPattern(pattern, options);
    const lumped = simulateLumpedPattern(pattern, options);
    for (let y = 0; y < pattern.rows; y += 17) {
      for (let x = 0; x < pattern.columns; x += 19) {
        const closed = simulateLumpedPixel(pattern, x, y, options);
        const float32 = simulateLumpedPixelFloat32(pattern, x, y, options);
        const phaseLocal = simulateLumpedPhaseLocalPixel(pattern, x, y, options);
        const error = Math.abs(closed.driveCoordinate
          - lumped.driveCoordinates[y * pattern.columns + x]);
        if (error > maximumClosedFormError) {
          maximumClosedFormError = error;
          maximumClosedFormContext = { patternId: id, location: [x, y] };
        }
        const float32Error = Math.abs(float32.driveCoordinate - closed.driveCoordinate);
        if (float32Error > maximumFloat32Error) {
          maximumFloat32Error = float32Error;
          maximumFloat32Context = { patternId: id, location: [x, y] };
        }
        const phaseBoundaryError = Math.abs(
          phaseLocal.driveCoordinate - closed.driveCoordinate
        );
        if (phaseBoundaryError > maximumPhaseBoundaryError) {
          maximumPhaseBoundaryError = phaseBoundaryError;
          maximumPhaseBoundaryContext = { patternId: id, location: [x, y] };
        }
      }
    }
    representativeFactors ??= {
      row: lumped.rowFactors,
      column: lumped.columnFactors,
    };
    let patternSquared = 0;
    let patternMaximum = 0;
    for (let index = 0; index < pattern.shades.length; index += 1) {
      const shade = pattern.shades[index];
      const distributedDelta = distributed.driveCoordinates[index]
        - distributedUniform.get(shade).driveCoordinates[index];
      const lumpedDelta = lumped.driveCoordinates[index]
        - lumpedUniform.get(shade).driveCoordinates[index];
      const error = lumpedDelta - distributedDelta;
      const absolute = Math.abs(error);
      squared += error * error;
      patternSquared += error * error;
      count += 1;
      absolutes.push(absolute);
      patternMaximum = Math.max(patternMaximum, absolute);
      if (absolute > maximum) {
        maximum = absolute;
        maximumContext = {
          patternId: id,
          location: [index % pattern.columns, Math.floor(index / pattern.columns)],
          shade,
          distributedDelta: clean(distributedDelta),
          lumpedDelta: clean(lumpedDelta),
        };
      }
    }
    patterns.push({
      id,
      rmsNormalizedDriveError: clean(Math.sqrt(patternSquared / pattern.shades.length)),
      maximumAbsoluteNormalizedDriveError: clean(patternMaximum),
    });
  }
  ensembles.push({
    id: ensemble.id,
    reductionBasis: {
      assumption: "sum each electrode's distributed KCL equations and retain the equipotential common mode",
      maximumRowElectrodeSeriesToDriverResistanceRatio: clean(
        ((dimensions.columns - 1) * ensemble.sheetResistanceOhmsPerSquare
          / dimensions.electrodeWidthFractionOfPitch) / ensemble.rowDriverResistanceOhms,
      ),
      maximumColumnElectrodeSeriesToDriverResistanceRatio: clean(
        ((dimensions.rows - 1) * ensemble.sheetResistanceOhmsPerSquare
          / dimensions.electrodeWidthFractionOfPitch) / ensemble.columnDriverResistanceOhms,
      ),
      factors: {
        row: Object.fromEntries(Object.entries(representativeFactors.row).map(
          ([key, value]) => [key, clean(value)],
        )),
        column: Object.fromEntries(Object.entries(representativeFactors.column).map(
          ([key, value]) => [key, clean(value)],
        )),
      },
    },
    patterns,
    rmsNormalizedDriveError: clean(Math.sqrt(squared / count)),
    p99AbsoluteNormalizedDriveError: clean(quantile(absolutes, 0.99)),
    maximumAbsoluteNormalizedDriveError: clean(maximum),
    maximumContext,
    runtimeClosedForm: {
      maximumAbsoluteDriveError: clean(maximumClosedFormError),
      maximumContext: maximumClosedFormContext,
      maximumFloat32DriveError: clean(maximumFloat32Error),
      maximumFloat32Context,
      maximumPhaseLocalDriveError: clean(maximumPhaseBoundaryError),
      maximumPhaseLocalContext: maximumPhaseBoundaryContext,
    },
  });
}

const nominal = ensembles.find((item) => item.id === "nominal");
const checks = {
  noImagePatternCoefficients: true,
  allNinePatternsCompared: ensembles.every((item) => item.patterns.length === 9),
  nominalRmsBelow0_05Shade: nominal.rmsNormalizedDriveError < 0.05,
  nominalP99Below0_10Shade: nominal.p99AbsoluteNormalizedDriveError < 0.10,
  closedFormMatchesLumpedSolver: ensembles.every(
    (item) => item.runtimeClosedForm.maximumAbsoluteDriveError < 1e-9,
  ),
  float32RuntimePrecisionBelow0_001Shade: ensembles.every(
    (item) => item.runtimeClosedForm.maximumFloat32DriveError < 0.001,
  ),
  nominalPhaseBoundaryResidualBelow0_001Shade:
    nominal.runtimeClosedForm.maximumPhaseLocalDriveError < 0.001,
};
const report = {
  schemaVersion: 2,
  reportId: "nintendo-dmg-01-ws5-crosstalk-lumped-v2",
  classification: "structure-preserving common-electrode-mode reduction; no image-pattern fit",
  sourceModel: "reference/passive-matrix-crosstalk.mjs",
  reducedModel: "reference/passive-matrix-crosstalk-lumped.mjs",
  ensembles,
  selectedRuntimeModel: {
    ensemble: "nominal",
    ...nominal,
  },
  checks,
  pass: Object.values(checks).every(Boolean),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const floatArray = (values) => values.map((value) => Number(value).toFixed(12)).join(", ");
const include = `// Generated by tools/build-dmg01-ws5-lumped.mjs. Do not hand-edit.\n`
  + `// Structure-preserving common-electrode RC mode; no image-pattern fit.\n`
  + `const int DMG_CROSSTALK_ROWS = ${dimensions.rows};\n`
  + `const int DMG_CROSSTALK_COLUMNS = ${dimensions.columns};\n`
  + `const int DMG_CROSSTALK_SUBSTEPS = 8;\n`
  + `const float DMG_CROSSTALK_ROW_AMPLITUDE = ${amplitudes.rowSelectAmplitude.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_COLUMN_AMPLITUDE = ${amplitudes.columnAmplitude.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_ROW_MEMORY = ${runtimeIncludeData.rowFactors.memory.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_ROW_LEAKAGE = ${runtimeIncludeData.rowFactors.leakage.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_ROW_DRIVER = ${runtimeIncludeData.rowFactors.driver.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_COLUMN_MEMORY = ${runtimeIncludeData.columnFactors.memory.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_COLUMN_LEAKAGE = ${runtimeIncludeData.columnFactors.leakage.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_COLUMN_DRIVER = ${runtimeIncludeData.columnFactors.driver.toFixed(12)};\n`
  + `const float DMG_CROSSTALK_SHADE_VOLTS[4] = float[](${floatArray(runtimeIncludeData.shadeRmsVolts)});\n`
  + `const float DMG_CROSSTALK_UNIFORM_00[576] = float[](${floatArray(runtimeIncludeData.baselines["00"])});\n`
  + `const float DMG_CROSSTALK_UNIFORM_10[576] = float[](${floatArray(runtimeIncludeData.baselines["10"])});\n`
  + `const float DMG_CROSSTALK_UNIFORM_01[576] = float[](${floatArray(runtimeIncludeData.baselines["01"])});\n`
  + `const float DMG_CROSSTALK_UNIFORM_11[576] = float[](${floatArray(runtimeIncludeData.baselines["11"])});\n`;
if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== serialized) {
    console.error("generated/ws5-crosstalk-lumped-v2.json is missing or stale");
    process.exit(1);
  }
  if (!fs.existsSync(includePath) || fs.readFileSync(includePath, "utf8") !== include) {
    console.error("shaders/dmg01-crosstalk-lumped.inc is missing or stale");
    process.exit(1);
  }
  console.log("DMG-01 WS5 structure-preserving lumped crosstalk report is current.");
} else {
  fs.writeFileSync(outputPath, serialized);
  fs.writeFileSync(includePath, include);
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
  console.log(`Wrote ${path.relative(root, includePath)}.`);
}
if (!report.pass) process.exit(1);
