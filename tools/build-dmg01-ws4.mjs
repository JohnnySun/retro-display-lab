#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  integrateRetention,
  integrateRetentionFrame,
  opticalBias,
  responseFromRate,
  stickingVoltage,
} from "../models/nintendo-dmg-01/reference/ionic-retention.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const evidencePath = path.join(modelDir, "data", "stn-retention-evidence-v1.json");
const reconstructionPath = path.join(modelDir, "data", "reconstruction-v1.json");
const outputPath = path.join(modelDir, "generated", "ws4-retention-v1.json");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function clean(value, digits = 12) {
  return Number(value.toFixed(digits));
}

function close(a, b, tolerance = 1e-12) {
  return Math.abs(a - b) <= tolerance;
}

function integrateFrames(initial, target, frames, parameters, timeScale = 1) {
  let state = initial;
  for (let frame = 0; frame < frames; frame += 1) {
    state = integrateRetentionFrame(state, target, 1, parameters, timeScale);
  }
  return state;
}

function integrateFramesFloat32(initial, target, frames, parameters, timeScale = 1) {
  let state = Math.fround(initial);
  for (let frame = 0; frame < frames; frame += 1) {
    state = Math.fround(integrateRetentionFrame(state, target, 1, parameters, timeScale));
  }
  return state;
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const reconstruction = JSON.parse(fs.readFileSync(reconstructionPath, "utf8"));
const fps = evidence.derivation.referenceRefreshHz;
const formationRate = evidence.derivation.formation.selectedPerSecond;
const releaseRate = evidence.derivation.desorption.selectedPerSecond;
const parameters = {
  formationPerFrame: evidence.derivation.formation.perFrameResponse,
  releasePerFrame: evidence.derivation.desorption.perFrameResponse,
};
const rates = {
  formationPerSecond: formationRate,
  releasePerSecond: releaseRate,
};

const protocol = evidence.sources.find((source) => source.evidenceId === "DMG-STN-05");
const reconstructedProtocolFraction = integrateRetention(
  integrateRetention(0, 1, protocol.stress.seconds, rates),
  0,
  protocol.stress.openCircuitObservationSeconds,
  rates,
);
const periodReleaseUpperBound = -Math.log(protocol.reportedAdsorbedIonFraction)
  / protocol.stress.openCircuitObservationSeconds;

const paperRows = [
  [0.0406, 0.140], [0.0661, 0.280], [0.0653, 0.320], [0.0682, 0.414],
  [0.0565, 0.204], [0.0569, 0.184], [0.0524, 0.118], [0.0452, 0.104],
  [0.0446, 0.192], [0.0352, 0.032], [0.0293, 0.096],
];
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanX = mean(paperRows.map(([x]) => x));
const meanY = mean(paperRows.map(([, y]) => y));
const covariance = paperRows.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
const varianceX = paperRows.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
const varianceY = paperRows.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
const slope = covariance / varianceX;
const intercept = meanY - slope * meanX;
const rSquared = covariance ** 2 / (varianceX * varianceY);

const acceleratedFrames = 1792;
const normalFrames = acceleratedFrames * 60;
const normalExposure = integrateFrames(0, 1, normalFrames, parameters, 1);
const acceleratedExposure = integrateFrames(0, 1, acceleratedFrames, parameters, 60);
const releaseAcceleratedFrames = 600;
const releaseNormalFrames = releaseAcceleratedFrames * 60;
const normalRelease = integrateFrames(normalExposure, 0, releaseNormalFrames, parameters, 1);
const acceleratedRelease = integrateFrames(acceleratedExposure, 0, releaseAcceleratedFrames, parameters, 60);
const float32Exposure = integrateFramesFloat32(0, 1, normalFrames, parameters, 1);
const float32Release = integrateFramesFloat32(float32Exposure, 0, releaseNormalFrames, parameters, 1);

const oneFrame = integrateRetentionFrame(0.2, 1, 1, parameters);
const splitFrame = integrateRetentionFrame(
  integrateRetentionFrame(0.2, 1, 0.37, parameters),
  1,
  0.63,
  parameters,
);
const noChange = integrateRetentionFrame(0.5, 0.5, 1, parameters);
const chargeSamples = [0, 60, 120, 300, 600, 1800].map((seconds) => ({
  seconds,
  state: clean(integrateRetention(0, 1, seconds, rates)),
}));
const releaseStart = integrateRetention(0, 1, 1800, rates);
const releaseSamples = [0, 60, 300, 600, 1800, 3600].map((seconds) => ({
  seconds,
  state: clean(integrateRetention(releaseStart, 0, seconds, rates)),
}));
const sceneChangeStates = [];
let sceneState = 0;
for (const segment of [
  { target: 1, seconds: 600 },
  { target: 1 / 3, seconds: 120 },
  { target: 0, seconds: 600 },
  { target: 2 / 3, seconds: 300 },
]) {
  sceneState = integrateRetention(sceneState, segment.target, segment.seconds, rates);
  sceneChangeStates.push({ ...segment, state: clean(sceneState) });
}

const mobility = evidence.derivation.opticalBridge.mobilityOverViscosity;
const gain = evidence.derivation.opticalBridge.stickingOpticalGainPerVolt;
const maximumBias = opticalBias(1, 0, mobility, gain);
const reconstructionParameters = reconstruction.temporal.ionicModel.referenceParameters;
const checks = {
  periodProtocolFractionRecovered: close(
    reconstructedProtocolFraction,
    protocol.reportedAdsorbedIonFraction,
    1e-12,
  ),
  releaseRateSatisfiesPeriodBound: releaseRate <= periodReleaseUpperBound,
  paperRegressionSlope: Math.abs(slope - 7.390426) < 0.001,
  paperRegressionIntercept: Math.abs(intercept + 0.186987) < 0.001,
  paperRegressionRSquared: rSquared >= 0.74 && rSquared <= 0.76,
  generatedFrameResponsesMatchRates: close(
    parameters.formationPerFrame,
    responseFromRate(formationRate, 1 / fps),
    1e-15,
  ) && close(
    parameters.releasePerFrame,
    responseFromRate(releaseRate, 1 / fps),
    1e-15,
  ),
  reconstructionParametersMatch: close(
    reconstructionParameters.IonicChargeResponse,
    parameters.formationPerFrame,
    1e-12,
  ) && close(
    reconstructionParameters.IonicReleaseResponse,
    parameters.releasePerFrame,
    1e-12,
  ),
  noChangeEquilibrium: noChange === 0.5,
  framePartitionInvariant: close(oneFrame, splitFrame, 1e-15),
  monotoneCharge: chargeSamples.every(
    (sample, index) => index === 0 || sample.state >= chargeSamples[index - 1].state,
  ),
  monotoneRelease: releaseSamples.every(
    (sample, index) => index === 0 || sample.state <= releaseSamples[index - 1].state,
  ),
  normalAcceleratedExposureEquivalent: close(normalExposure, acceleratedExposure, 1e-11),
  normalAcceleratedReleaseEquivalent: close(normalRelease, acceleratedRelease, 1e-11),
  boundedOpticalBias: maximumBias > 0 && maximumBias < 0.02,
  float32ExposureClose: Math.abs(float32Exposure - normalExposure) < 0.001,
  float32ReleaseClose: Math.abs(float32Release - normalRelease) < 0.001,
  sceneChangesBounded: sceneChangeStates.every((sample) => sample.state >= 0 && sample.state <= 1),
};

const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws4-retention-v1",
  generatedFrom: {
    evidence: "data/stn-retention-evidence-v1.json",
    reconstruction: "data/reconstruction-v1.json",
    cpuReference: "reference/ionic-retention.mjs",
  },
  classification: "period-protocol and later-kinetic constrained first-order ionic retention reconstruction",
  kinetics: {
    formationPerSecond: clean(formationRate, 15),
    formationTimeConstantSeconds: clean(1 / formationRate),
    formationPerFrame: clean(parameters.formationPerFrame, 15),
    releasePerSecond: clean(releaseRate, 15),
    releaseTimeConstantSeconds: clean(1 / releaseRate),
    releasePerFrame: clean(parameters.releasePerFrame, 15),
    periodReleaseUpperBoundPerSecond: clean(periodReleaseUpperBound, 15),
  },
  periodProtocolReconstruction: {
    stressSeconds: protocol.stress.seconds,
    recoverySeconds: protocol.stress.openCircuitObservationSeconds,
    reportedFinalAdsorbedFraction: protocol.reportedAdsorbedIonFraction,
    reconstructedFinalFraction: clean(reconstructedProtocolFraction),
  },
  regression1994: {
    rows: paperRows.length,
    slope: clean(slope, 9),
    intercept: clean(intercept, 9),
    rSquared: clean(rSquared, 9),
    visibilityVoltsAtReferenceMobility: clean(stickingVoltage(mobility), 9),
  },
  opticalBridge: {
    mobilityOverViscosity: mobility,
    gainPerVolt: gain,
    maximumOpticalStateBias: clean(maximumBias),
    classification: evidence.derivation.opticalBridge.classification,
  },
  trajectories: {
    chargeSamples,
    releaseSamples,
    sceneChangeStates,
  },
  accelerationEquivalence: {
    normalFrames,
    acceleratedFrames,
    normalExposure: clean(normalExposure),
    acceleratedExposure: clean(acceleratedExposure),
    normalReleaseFrames: releaseNormalFrames,
    acceleratedReleaseFrames: releaseAcceleratedFrames,
    normalRelease: clean(normalRelease),
    acceleratedRelease: clean(acceleratedRelease),
  },
  precision: {
    feedbackFormat: "R32G32B32A32_SFLOAT",
    float64Exposure: clean(normalExposure),
    float32Exposure: clean(float32Exposure),
    float64Release: clean(normalRelease),
    float32Release: clean(float32Release),
  },
  validation: {
    ...checks,
    pass: Object.values(checks).every(Boolean),
  },
  claimBoundary: "Kinetics are a reconstruction from period protocols and a later direct adsorption/desorption measurement satisfying the period bound. The optical gain is still an explicit low-amplitude bridge because no long-exposure DMG optical trace survives.",
};
const output = `${JSON.stringify(report, null, 2)}\n`;

if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
    fail("DMG WS4 retention report is missing or stale; run node tools/build-dmg01-ws4.mjs");
  }
  if (!report.validation.pass) fail("DMG WS4 retention validation failed");
  console.log("DMG-01 WS4 ionic-retention reconstruction and acceleration checks are current.");
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  if (!report.validation.pass) fail("Wrote WS4 report, but retention validation failed");
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
}
