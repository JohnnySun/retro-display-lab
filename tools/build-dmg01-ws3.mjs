#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  integrateScanoutFrame,
  scanConstants,
  scanEvent,
} from "../models/nintendo-dmg-01/reference/scanout-timing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const timingPath = path.join(modelDir, "data", "dmg-scan-timing-v1.json");
const physicsPath = path.join(modelDir, "generated", "ws2-stn-physics-v1.json");
const outputPath = path.join(modelDir, "generated", "ws3-scanout-v1.json");
const checkOnly = process.argv.includes("--check");
const timing = JSON.parse(fs.readFileSync(timingPath, "utf8"));
const physics = JSON.parse(fs.readFileSync(physicsPath, "utf8"));
const bins = physics.runtimeContrastConditions[0].driftDeltaPerReferenceFrame.length / 4;
const drift = physics.runtimeContrastConditions.flatMap(
  (condition) => condition.driftDeltaPerReferenceFrame,
);
const nominal = physics.runtimeContrastConditions.findIndex(
  (condition) => condition.contrastScale === 1,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function round(value, digits = 12) {
  return Number(value.toFixed(digits));
}

function close(a, b, tolerance = 1e-12) {
  return Math.abs(a - b) <= tolerance;
}

const constants = scanConstants(timing);
const first = scanEvent(timing, 0);
const middle = scanEvent(timing, 72);
const last = scanEvent(timing, 143);
const nominalCondition = physics.runtimeContrastConditions[nominal];
const light = nominalCondition.equilibriumDirectorCoordinates[0];
const dark = nominalCondition.equilibriumDirectorCoordinates[3];
const common = {
  record: timing,
  coordinate: light,
  ionicCharge: 0,
  previousDriveIndex: 0,
  currentDriveIndex: 3,
  drift,
  bins,
  condition: nominal,
};
const topChange = integrateScanoutFrame({ ...common, row: 0 });
const middleChange = integrateScanoutFrame({ ...common, row: 72 });
const bottomChange = integrateScanoutFrame({ ...common, row: 143 });
const middleTwoShadeChange = integrateScanoutFrame({
  ...common,
  row: 72,
  currentDriveIndex: 2,
});
const topSecondFrame = integrateScanoutFrame({
  ...common,
  row: 0,
  coordinate: topChange.coordinate,
  ionicCharge: topChange.ionicCharge,
  previousDriveIndex: 3,
  currentDriveIndex: 3,
});
const unchanged = integrateScanoutFrame({
  ...common,
  row: 72,
  previousDriveIndex: 3,
  coordinate: dark,
});
const temporalUnchanged = integrateScanoutFrame({
  ...common,
  row: 72,
  previousDriveIndex: 3,
  coordinate: dark,
  bakedScanout: false,
});
const temporalChanged = integrateScanoutFrame({
  ...common,
  row: 72,
  bakedScanout: false,
});

const checks = {
  manualVisibleRows: timing.frame.visibleRows === 144,
  manualBlankRows: timing.frame.blankRows === 10,
  totalRows: timing.frame.totalRows === 154,
  modelLineMatchesManualRounded: Math.abs(
    constants.lineSeconds * 1e6 - timing.frame.manualRoundedLineMicroseconds,
  ) < 0.05,
  modelLineMatchesCapture: Math.abs(
    constants.lineSeconds * 1e6 - timing.frame.capturedMeanLineMicroseconds,
  ) < 0.05,
  eventFractionsPartitionFrame: [first, middle, last].every((event) => close(
    event.beforeLatchFraction + event.afterLatchFraction,
    1,
  )),
  topReceivesMoreCurrentDriveThanMiddle: topChange.coordinate > middleChange.coordinate,
  middleReceivesMoreCurrentDriveThanBottom: middleChange.coordinate > bottomChange.coordinate,
  sameRowDeeperDriveAdvancesFurther: middleChange.coordinate > middleTwoShadeChange.coordinate,
  crossFrameContinuesTowardCurrentTarget: topSecondFrame.coordinate > topChange.coordinate
    && topSecondFrame.coordinate <= dark,
  unchangedEqualsTemporalOnly: close(unchanged.coordinate, temporalUnchanged.coordinate)
    && close(unchanged.ionicCharge, temporalUnchanged.ionicCharge),
  constantFrameIndependentOfRowLatch: close(
    integrateScanoutFrame({
      ...common,
      row: 0,
      previousDriveIndex: 3,
      coordinate: dark,
    }).coordinate,
    integrateScanoutFrame({
      ...common,
      row: 143,
      previousDriveIndex: 3,
      coordinate: dark,
    }).coordinate,
  ),
  noScanoutIgnoresPreviousTarget: close(
    temporalChanged.coordinate,
    integrateScanoutFrame({
      ...common,
      row: 72,
      previousDriveIndex: 2,
      bakedScanout: false,
    }).coordinate,
  ),
  boundedDirectorCoordinates: [topChange, middleChange, bottomChange, unchanged]
    .every((state) => state.coordinate >= 0 && state.coordinate <= 1),
  monotoneIonicCharge: topChange.ionicCharge > middleChange.ionicCharge
    && middleChange.ionicCharge > bottomChange.ionicCharge,
};

const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws3-scanout-v1",
  classification: "DMG-specific frame and latch timing applied to the WS2 physical surrogate",
  generatedFrom: {
    timing: "data/dmg-scan-timing-v1.json",
    physicalSurrogate: "generated/ws2-stn-physics-v1.json",
    cpuReference: "reference/scanout-timing.mjs",
  },
  timing: {
    frameSeconds: round(constants.frameSeconds),
    lineSeconds: round(constants.lineSeconds),
    totalRows: constants.totalRows,
    visibleRows: constants.visibleRows,
    latchOffsetLines: 1,
    latchBasis: timing.runtimeModel.normalLatchBasis,
    firstVisibleLatchMilliseconds: round(first.latchSeconds * 1000, 6),
    lastVisibleLatchMilliseconds: round(last.latchSeconds * 1000, 6),
  },
  causalProbe: {
    transition: "shade 0 to shade 3",
    initialDirectorCoordinate: round(light),
    targetDirectorCoordinate: round(dark),
    topRowAfterOneFrame: round(topChange.coordinate),
    middleRowAfterOneFrame: round(middleChange.coordinate),
    bottomRowAfterOneFrame: round(bottomChange.coordinate),
    middleRowShade2AfterOneFrame: round(middleTwoShadeChange.coordinate),
    topRowAfterSecondFrame: round(topSecondFrame.coordinate),
  },
  validation: {
    ...checks,
    pass: Object.values(checks).every(Boolean),
  },
  claimBoundary: "CPL line-end latch behavior is captured DMG evidence. The sub-line analogue settling and exact panel optical onset remain unknown; no separate dead time is invented.",
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
    fail("DMG WS3 scanout report is missing or stale; run node tools/build-dmg01-ws3.mjs");
  }
  if (!report.validation.pass) fail("DMG WS3 scanout validation failed");
  console.log("DMG-01 WS3 row timing and causal scanout report is current.");
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  if (!report.validation.pass) fail("Wrote WS3 report, but validation failed");
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
}
