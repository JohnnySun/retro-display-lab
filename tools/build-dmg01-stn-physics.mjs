#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  altPleshkoAmplitudes,
  buildOpticalCalibration,
  freeEnergy,
  initialDirector,
  integrateDirector,
  materialToSI,
  opticalObservation,
  selectionRatio,
  shadeRmsVoltages,
} from "../models/nintendo-dmg-01/reference/stn-physics.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const drivePath = path.join(modelDir, "data", "dmg-drive-v1.json");
const materialPath = path.join(modelDir, "data", "stn-material-ensemble-v1.json");
const outputPath = path.join(modelDir, "generated", "ws2-stn-physics-v1.json");
const includePath = path.join(modelDir, "shaders", "dmg01-stn-surrogate.inc");
const checkOnly = process.argv.includes("--check");
const drive = JSON.parse(fs.readFileSync(drivePath, "utf8"));
const ensemble = JSON.parse(fs.readFileSync(materialPath, "utf8"));
const frameSeconds = 1 / drive.panel.refreshHz;
const timestepSeconds = 0.0001;
const minimumEquilibriumSeconds = 0.8;
const maximumEquilibriumSeconds = 5.0;
const equilibriumChunkSeconds = 0.2;
const equilibriumAngularToleranceRadians = 1e-7;
const transitionSeconds = 1.2;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function round(value, digits = 10) {
  return Number(value.toFixed(digits));
}

function max(values) {
  return Math.max(...values);
}

function maximumDirectorDelta(a, b) {
  return Math.max(
    ...a.theta.map((value, index) => Math.abs(b.theta[index] - value)),
    ...a.phi.map((value, index) => Math.abs(b.phi[index] - value)),
  );
}

function solveEquilibrium(material, rmsVolts, gridPoints, timestep) {
  let state = initialDirector(material, gridPoints);
  let elapsedSeconds = 0;
  let residualAngularDeltaRadians = Infinity;
  const samples = [];
  while (elapsedSeconds < maximumEquilibriumSeconds - 1e-12) {
    const durationSeconds = Math.min(
      equilibriumChunkSeconds,
      maximumEquilibriumSeconds - elapsedSeconds,
    );
    const result = integrateDirector(state, material, rmsVolts, durationSeconds, {
      timestepSeconds: timestep,
      sampleSeconds: 0.05,
    });
    residualAngularDeltaRadians = maximumDirectorDelta(state, result.state);
    state = result.state;
    elapsedSeconds += durationSeconds;
    samples.push(...result.samples);
    if (elapsedSeconds + 1e-12 >= minimumEquilibriumSeconds
        && residualAngularDeltaRadians <= equilibriumAngularToleranceRadians) break;
  }
  if (residualAngularDeltaRadians > equilibriumAngularToleranceRadians) {
    fail(`equilibrium did not converge at ${rmsVolts} V after ${elapsedSeconds} s: ${residualAngularDeltaRadians}`);
  }
  return { state, samples, elapsedSeconds, residualAngularDeltaRadians };
}

function solveEquilibria(material, contrastScale, gridPoints = 17, timestep = timestepSeconds) {
  const voltages = shadeRmsVoltages(drive, contrastScale);
  return voltages.map((rmsVolts, shadeIndex) => {
    const result = solveEquilibrium(material, rmsVolts, gridPoints, timestep);
    const optical = opticalObservation(result.state, material);
    const energyIncreases = result.samples.slice(1).map((sample, index) => (
      sample.energyJPerSquareMeter - result.samples[index].energyJPerSquareMeter
    ));
    return {
      shadeIndex,
      rmsVolts,
      state: result.state,
      optical,
      equilibriumDurationSeconds: result.elapsedSeconds,
      residualAngularDeltaRadians: result.residualAngularDeltaRadians,
      equilibriumEnergyJPerSquareMeter: freeEnergy(result.state, material, rmsVolts),
      maximumSampledEnergyIncreaseJPerSquareMeter: Math.max(0, ...energyIncreases),
    };
  });
}

function directorOrderParameter(state) {
  return state.theta.reduce((sum, theta) => sum + Math.sin(theta) ** 2, 0) / state.theta.length;
}

function buildDirectorCalibration(equilibria, minimumState = equilibria[0].state, maximumState = equilibria[3].state) {
  const raw = equilibria.map((entry) => directorOrderParameter(entry.state));
  const minimum = directorOrderParameter(minimumState);
  const maximum = directorOrderParameter(maximumState);
  return {
    raw,
    minimum,
    maximum,
    normalize(state) {
      return (directorOrderParameter(state) - minimum) / (maximum - minimum);
    },
  };
}

function solveTransition(material, equilibria, calibration, directorCalibration, fromIndex, toIndex) {
  if (fromIndex === toIndex) {
    return {
      fromIndex,
      toIndex,
      t90Seconds: 0,
      samples: [],
      allSamples: [],
    };
  }
  const startState = calibration.stateForLuminance(equilibria[fromIndex].optical.luminance);
  const targetState = calibration.stateForLuminance(equilibria[toIndex].optical.luminance);
  const startDirectorCoordinate = directorCalibration.normalize(equilibria[fromIndex].state);
  const targetDirectorCoordinate = directorCalibration.normalize(equilibria[toIndex].state);
  const result = integrateDirector(
    equilibria[fromIndex].state,
    material,
    equilibria[toIndex].rmsVolts,
    transitionSeconds,
    { timestepSeconds, sampleSeconds: frameSeconds },
  );
  const observed = [{
    seconds: 0,
    opticalState: startState,
    directorCoordinate: startDirectorCoordinate,
    progress: 0,
  }];
  for (const sample of result.samples) {
    const opticalState = calibration.stateForLuminance(
      opticalObservation(sample.director, material).luminance,
    );
    observed.push({
      seconds: sample.seconds,
      opticalState,
      directorCoordinate: directorCalibration.normalize(sample.director),
      progress: (opticalState - startState) / (targetState - startState),
    });
  }
  const t90Sample = observed.find((sample) => sample.progress >= 0.9);
  return {
    fromIndex,
    toIndex,
    startState: round(startState),
    targetState: round(targetState),
    startDirectorCoordinate: round(startDirectorCoordinate),
    targetDirectorCoordinate: round(targetDirectorCoordinate),
    t90Seconds: t90Sample ? round(t90Sample.seconds, 6) : null,
    samples: observed.filter((_, index) => index % 6 === 0).map((sample) => ({
      seconds: round(sample.seconds, 6),
      opticalState: round(sample.opticalState, 8),
      directorCoordinate: round(sample.directorCoordinate, 8),
      progress: round(sample.progress, 8),
    })),
    allSamples: observed,
  };
}

function summarizeCondition(member, contrastScale, calibration, directorCalibration, temperatureCelsius = 20) {
  const material = materialToSI(member, ensemble.sharedGeometry, temperatureCelsius);
  const equilibria = solveEquilibria(material, contrastScale);
  const transitions = [];
  for (let fromIndex = 0; fromIndex < 4; fromIndex += 1) {
    for (let toIndex = 0; toIndex < 4; toIndex += 1) {
      transitions.push(solveTransition(
        material,
        equilibria,
        calibration,
        directorCalibration,
        fromIndex,
        toIndex,
      ));
    }
  }
  return {
    materialId: member.id,
    temperatureCelsius,
    contrastScale,
    rmsVoltages: equilibria.map((entry) => round(entry.rmsVolts, 9)),
    equilibriumOpticalStates: equilibria.map((entry) => round(
      calibration.stateForLuminance(entry.optical.luminance), 9,
    )),
    equilibriumDirectorCoordinates: equilibria.map((entry) => round(
      directorCalibration.normalize(entry.state), 9,
    )),
    equilibriumSpectral: equilibria.map((entry) => ({
      shadeIndex: entry.shadeIndex,
      xyz: entry.optical.xyz.map((value) => round(value, 9)),
      luminance: round(entry.optical.luminance, 9),
      reflectance: entry.optical.spectrum.map((sample) => round(sample.reflectance, 8)),
      equilibriumEnergyJPerSquareMeter: round(entry.equilibriumEnergyJPerSquareMeter, 14),
      equilibriumDurationSeconds: round(entry.equilibriumDurationSeconds, 6),
      residualAngularDeltaRadians: round(entry.residualAngularDeltaRadians, 12),
      maximumSampledEnergyIncreaseJPerSquareMeter: round(
        entry.maximumSampledEnergyIncreaseJPerSquareMeter,
        14,
      ),
    })),
    transitions,
  };
}

const driftBins = 65;

function anchorDriftFixedPoint(deltas, targetIndex, targetCoordinate) {
  const offset = driftLookup(deltas, targetIndex, targetCoordinate);
  const radius = 4 / (driftBins - 1);
  const weights = Array.from({ length: driftBins }, (_, bin) => (
    Math.max(0, 1 - Math.abs(bin / (driftBins - 1) - targetCoordinate) / radius)
  ));
  const weightAtTarget = driftLookup(weights, 0, targetCoordinate);
  for (let bin = 0; bin < driftBins; bin += 1) {
    const index = targetIndex * driftBins + bin;
    deltas[index] = round(deltas[index] - offset * weights[bin] / weightAtTarget, 12);
  }
}

function interpolateDirectorManifold(equilibria, directorCalibration, coordinate) {
  const q = clampUnit(coordinate);
  const knots = equilibria.map((entry) => directorCalibration.normalize(entry.state));
  let low = 0;
  while (low < knots.length - 2 && q > knots[low + 1]) low += 1;
  const mix = clampUnit((q - knots[low]) / Math.max(knots[low + 1] - knots[low], 1e-12));
  const a = equilibria[low].state;
  const b = equilibria[low + 1].state;
  return {
    theta: a.theta.map((value, index) => value + (b.theta[index] - value) * mix),
    phi: a.phi.map((value, index) => value + (b.phi[index] - value) * mix),
  };
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function buildDriftCondition(condition, material, directorCalibration, manifoldEquilibria) {
  const deltas = [];
  for (let targetIndex = 0; targetIndex < 4; targetIndex += 1) {
    for (let bin = 0; bin < driftBins; bin += 1) {
      const coordinate = bin / (driftBins - 1);
      const initial = interpolateDirectorManifold(
        manifoldEquilibria,
        directorCalibration,
        coordinate,
      );
      const next = integrateDirector(
        initial,
        material,
        condition.rmsVoltages[targetIndex],
        frameSeconds,
        { timestepSeconds },
      ).state;
      const nextCoordinate = clampUnit(directorCalibration.normalize(next));
      deltas.push(round(nextCoordinate - coordinate, 12));
    }
  }

  // A single order parameter cannot encode every depth-profile shape. Correct
  // the manifold drift with derivatives sampled from the full transition
  // trajectories. This retains the hidden pre-optical accumulation near the
  // STN threshold instead of fitting a visible delay or a response time.
  for (let targetIndex = 0; targetIndex < 4; targetIndex += 1) {
    const sums = new Array(driftBins).fill(0);
    const counts = new Array(driftBins).fill(0);
    for (const transition of condition.transitions.filter(
      (entry) => entry.toIndex === targetIndex && entry.fromIndex !== targetIndex,
    )) {
      for (let index = 0; index < transition.allSamples.length - 1; index += 1) {
        const current = clampUnit(transition.allSamples[index].directorCoordinate);
        const next = clampUnit(transition.allSamples[index + 1].directorCoordinate);
        const bin = Math.round(current * (driftBins - 1));
        sums[bin] += next - current;
        counts[bin] += 1;
      }
    }
    const observedBins = counts.map((count, index) => (count ? index : -1)).filter((index) => index >= 0);
    if (!observedBins.length) continue;
    for (let bin = observedBins[0]; bin <= observedBins.at(-1); bin += 1) {
      let low = observedBins[0];
      let high = observedBins.at(-1);
      for (const observed of observedBins) {
        if (observed <= bin) low = observed;
        if (observed >= bin) {
          high = observed;
          break;
        }
      }
      const lowValue = sums[low] / counts[low];
      const highValue = sums[high] / counts[high];
      const mix = high === low ? 0 : (bin - low) / (high - low);
      deltas[targetIndex * driftBins + bin] = round(
        lowValue + (highValue - lowValue) * mix,
        12,
      );
    }
    anchorDriftFixedPoint(
      deltas,
      targetIndex,
      condition.equilibriumDirectorCoordinates[targetIndex],
    );
  }
  return deltas;
}

function driftLookup(deltas, targetIndex, coordinate) {
  const position = clampUnit(coordinate) * (driftBins - 1);
  const low = Math.min(Math.floor(position), driftBins - 2);
  const mix = position - low;
  const base = targetIndex * driftBins + low;
  return deltas[base] + (deltas[base + 1] - deltas[base]) * mix;
}

function opticalLookup(opticalLut, coordinate) {
  const position = clampUnit(coordinate) * (opticalLut.length - 1);
  const low = Math.min(Math.floor(position), opticalLut.length - 2);
  const mix = position - low;
  return opticalLut[low] + (opticalLut[low + 1] - opticalLut[low]) * mix;
}

function opticalCorrectionAt(coordinate, anchorCoordinates, corrections) {
  const q = clampUnit(coordinate);
  if (q <= anchorCoordinates[0]) {
    return corrections[0] * q / Math.max(anchorCoordinates[0], 1e-12);
  }
  for (let index = 0; index < anchorCoordinates.length - 1; index += 1) {
    if (q <= anchorCoordinates[index + 1]) {
      const mix = (q - anchorCoordinates[index])
        / Math.max(anchorCoordinates[index + 1] - anchorCoordinates[index], 1e-12);
      return corrections[index] + (corrections[index + 1] - corrections[index]) * mix;
    }
  }
  return corrections.at(-1) * (1 - q) / Math.max(1 - anchorCoordinates.at(-1), 1e-12);
}

function calibratedOpticalLookup(opticalLut, coordinate, anchorCoordinates, corrections) {
  return Math.max(0.25, Math.min(1,
    opticalLookup(opticalLut, coordinate)
      + opticalCorrectionAt(coordinate, anchorCoordinates, corrections),
  ));
}

function validateDrift(condition, deltas, opticalLut, anchorCoordinates, corrections) {
  let squaredError = 0;
  let maximumError = 0;
  let count = 0;
  const transitionErrors = [];
  for (const transition of condition.transitions) {
    if (transition.fromIndex === transition.toIndex) continue;
    let coordinate = transition.allSamples[0].directorCoordinate;
    let localMaximum = 0;
    let localSquared = 0;
    let localCount = 0;
    for (let index = 1; index < transition.allSamples.length; index += 1) {
      coordinate = clampUnit(
        coordinate + driftLookup(deltas, transition.toIndex, coordinate),
      );
      const predictedState = calibratedOpticalLookup(
        opticalLut,
        coordinate,
        anchorCoordinates,
        corrections,
      );
      const error = predictedState - transition.allSamples[index].opticalState;
      squaredError += error ** 2;
      localSquared += error ** 2;
      maximumError = Math.max(maximumError, Math.abs(error));
      localMaximum = Math.max(localMaximum, Math.abs(error));
      count += 1;
      localCount += 1;
    }
    transitionErrors.push({
      fromIndex: transition.fromIndex,
      toIndex: transition.toIndex,
      rmsError: round(Math.sqrt(localSquared / localCount), 9),
      maximumError: round(localMaximum, 9),
    });
  }
  return {
    rmsError: round(Math.sqrt(squaredError / count), 9),
    maximumError: round(maximumError, 9),
    transitions: transitionErrors,
  };
}

const nominalMember = ensemble.members.find((member) => member.id === "nominal");
if (!nominalMember) fail("STN material ensemble has no nominal member");
const nominalMaterial = materialToSI(nominalMember, ensemble.sharedGeometry);
const nominalEquilibria = solveEquilibria(nominalMaterial, 1);
const nominalLuminances = nominalEquilibria.map((entry) => entry.optical.luminance);
if (!nominalLuminances.every((value, index) => index === 0 || value < nominalLuminances[index - 1])) {
  fail(`nominal reflected luminance is not monotonic: ${nominalLuminances.join(", ")}`);
}
const calibration = buildOpticalCalibration(nominalEquilibria);
const lowContrastBoundEquilibria = solveEquilibria(nominalMaterial, 0.88);
const highContrastBoundEquilibria = solveEquilibria(nominalMaterial, 1.12);
const directorCalibration = buildDirectorCalibration(
  nominalEquilibria,
  lowContrastBoundEquilibria[0].state,
  highContrastBoundEquilibria[3].state,
);
const directorManifold = [
  lowContrastBoundEquilibria[0],
  ...nominalEquilibria,
  highContrastBoundEquilibria[3],
].sort((a, b) => directorCalibration.normalize(a.state) - directorCalibration.normalize(b.state));
const opticalLutBins = 65;
const directorToOpticalLut = Array.from({ length: opticalLutBins }, (_, index) => {
  const coordinate = index / (opticalLutBins - 1);
  const director = interpolateDirectorManifold(
    directorManifold,
    directorCalibration,
    coordinate,
  );
  return round(calibration.stateForLuminance(
    opticalObservation(director, nominalMaterial).luminance,
  ), 12);
});
const nominalOpticalAnchorCoordinates = nominalEquilibria.map((entry) => round(
  directorCalibration.normalize(entry.state),
  9,
));
const nominalOpticalAnchorTargets = [0.25, 0.5, 0.75, 1];
const nominalOpticalAnchorCorrections = nominalOpticalAnchorCoordinates.map(
  (coordinate, index) => round(
    nominalOpticalAnchorTargets[index] - opticalLookup(directorToOpticalLut, coordinate),
    12,
  ),
);
const contrastScales = [0.88, 1, 1.12];
const runtimeConditions = contrastScales.map((contrastScale) => (
  summarizeCondition(nominalMember, contrastScale, calibration, directorCalibration)
));
for (const condition of runtimeConditions) {
  condition.driftDeltaPerReferenceFrame = buildDriftCondition(
    condition,
    nominalMaterial,
    directorCalibration,
    directorManifold,
  );
  condition.surrogateValidation = validateDrift(
    condition,
    condition.driftDeltaPerReferenceFrame,
    directorToOpticalLut,
    nominalOpticalAnchorCoordinates,
    nominalOpticalAnchorCorrections,
  );
  for (const transition of condition.transitions) delete transition.allSamples;
}
const materialEnvelope = ensemble.members.map((member) => (
  member.id === "nominal"
    ? runtimeConditions[1]
    : summarizeCondition(
      member,
      member.nominalContrastScale,
      calibration,
      directorCalibration,
    )
));
for (const condition of materialEnvelope) {
  for (const transition of condition.transitions) delete transition.allSamples;
}

const convergenceMaterial = nominalMaterial;
const convergenceVoltage = shadeRmsVoltages(drive)[3];
const timestepCoarse = integrateDirector(
  initialDirector(convergenceMaterial, 17), convergenceMaterial, convergenceVoltage, 0.5,
  { timestepSeconds: 0.0001 },
).state;
const timestepFine = integrateDirector(
  initialDirector(convergenceMaterial, 17), convergenceMaterial, convergenceVoltage, 0.5,
  { timestepSeconds: 0.00005 },
).state;
const grid17 = timestepFine;
const grid21 = integrateDirector(
  initialDirector(convergenceMaterial, 21), convergenceMaterial, convergenceVoltage, 0.5,
  { timestepSeconds: 0.00005 },
).state;
const timestepOpticalError = Math.abs(
  calibration.stateForLuminance(opticalObservation(timestepCoarse, convergenceMaterial).luminance)
  - calibration.stateForLuminance(opticalObservation(timestepFine, convergenceMaterial).luminance)
);
const gridOpticalError = Math.abs(
  calibration.stateForLuminance(opticalObservation(grid17, convergenceMaterial).luminance)
  - calibration.stateForLuminance(opticalObservation(grid21, convergenceMaterial).luminance)
);

const darkEquilibrium = nominalEquilibria[3].state;
const zeroFieldInitialEnergy = freeEnergy(darkEquilibrium, nominalMaterial, 0);
const zeroField = integrateDirector(darkEquilibrium, nominalMaterial, 0, 0.5, {
  timestepSeconds,
  sampleSeconds: 0.05,
});
const zeroFieldFinalEnergy = freeEnergy(zeroField.state, nominalMaterial, 0);
const nominalRuntime = runtimeConditions[1];
const nominalFixedPointDrifts = nominalRuntime.equilibriumDirectorCoordinates.map(
  (coordinate, targetIndex) => driftLookup(
    nominalRuntime.driftDeltaPerReferenceFrame,
    targetIndex,
    coordinate,
  ),
);
const nominalAnchoredOpticalStates = nominalRuntime.equilibriumDirectorCoordinates.map(
  (coordinate) => calibratedOpticalLookup(
    directorToOpticalLut,
    coordinate,
    nominalOpticalAnchorCoordinates,
    nominalOpticalAnchorCorrections,
  ),
);
const nominalSettledOpticalStates = nominalRuntime.equilibriumDirectorCoordinates.map(
  (initialCoordinate, targetIndex) => {
    let coordinate = initialCoordinate;
    for (let frame = 0; frame < 600; frame += 1) {
      coordinate = clampUnit(coordinate + driftLookup(
        nominalRuntime.driftDeltaPerReferenceFrame,
        targetIndex,
        coordinate,
      ));
    }
    return calibratedOpticalLookup(
      directorToOpticalLut,
      coordinate,
      nominalOpticalAnchorCoordinates,
      nominalOpticalAnchorCorrections,
    );
  },
);
const nominalAttractionErrors = nominalRuntime.equilibriumDirectorCoordinates.flatMap(
  (equilibriumCoordinate, targetIndex) => [-0.01, 0.01].map((offset) => {
    let coordinate = clampUnit(equilibriumCoordinate + offset);
    for (let frame = 0; frame < 600; frame += 1) {
      coordinate = clampUnit(coordinate + driftLookup(
        nominalRuntime.driftDeltaPerReferenceFrame,
        targetIndex,
        coordinate,
      ));
    }
    return Math.abs(coordinate - equilibriumCoordinate);
  }),
);
const maximumNominalFixedPointDrift = max(nominalFixedPointDrifts.map(Math.abs));
const maximumNominalAnchoredOpticalError = max(nominalAnchoredOpticalStates.map(
  (value, index) => Math.abs(value - nominalOpticalAnchorTargets[index]),
));
const maximumNominalSettledOpticalError = max(nominalSettledOpticalStates.map(
  (value, index) => Math.abs(value - nominalOpticalAnchorTargets[index]),
));
const maximumNominalAttractionError = max(nominalAttractionErrors);

const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws2-stn-physics-v1",
  generatedFrom: {
    drive: "data/dmg-drive-v1.json",
    materialEnsemble: "data/stn-material-ensemble-v1.json",
    solver: "reference/stn-physics.mjs",
  },
  classification: "bounded physical reconstruction; DMG-specific timing/topology with period-material ensemble",
  solver: {
    gridPoints: 17,
    timestepSeconds,
    equilibriumPolicy: {
      minimumSeconds: minimumEquilibriumSeconds,
      maximumSeconds: maximumEquilibriumSeconds,
      chunkSeconds: equilibriumChunkSeconds,
      angularToleranceRadians: equilibriumAngularToleranceRadians,
    },
    transitionSeconds,
    frameSeconds: round(frameSeconds, 12),
    electricalReduction: "cycle-averaged RMS of 1/144 Alt-Pleshko selection and inferred three-dwell grayscale",
    directorDynamics: "overdamped 1D Frank-Oseen/Ericksen-Leslie reduction with finite anchoring",
    opticalReduction: "15-wavelength sliced Jones round trip through two polarizers and reflector",
  },
  drive: {
    selectionRatioAt144Rows: round(selectionRatio(144), 12),
    cpgDwellFractions: drive.multiplexModel.fourShadeSelectedEnergyFractions,
    nominalRmsVoltages: shadeRmsVoltages(drive).map((value) => round(value, 9)),
    nominalAltPleshkoAmplitudes: Object.fromEntries(Object.entries(
      altPleshkoAmplitudes(drive),
    ).map(([key, value]) => [key, round(value, 9)])),
  },
  opticalCalibration: {
    role: "Maps the physical reflected-luminance coordinate to BGB's four measured driven palette positions; it does not set transition time.",
    nominalPhysicalLuminances: nominalLuminances.map((value) => round(value, 9)),
    bgbDrivenStateCoordinates: [0.25, 0.5, 0.75, 1],
  },
  directorCoordinate: {
    definition: "depth-average of sin(theta)^2, normalized across the supported 0.88-to-1.12 contrast envelope",
    rawNominalEquilibriumValues: directorCalibration.raw.map((value) => round(value, 12)),
    opticalLut: directorToOpticalLut,
    nominalOpticalAnchorCoordinates,
    nominalOpticalAnchorTargets,
    nominalOpticalAnchorCorrections,
  },
  runtimeContrastConditions: runtimeConditions,
  materialEnvelope,
  validation: {
    staticFourShadeLuminanceMonotonic: true,
    maximumSampledEquilibriumEnergyIncreaseJPerSquareMeter: round(max(
      runtimeConditions.flatMap((condition) => condition.equilibriumSpectral)
        .map((entry) => entry.maximumSampledEnergyIncreaseJPerSquareMeter),
    ), 14),
    zeroFieldEnergyDecreased: zeroFieldFinalEnergy < zeroFieldInitialEnergy,
    zeroFieldInitialEnergyJPerSquareMeter: round(zeroFieldInitialEnergy, 14),
    zeroFieldFinalEnergyJPerSquareMeter: round(zeroFieldFinalEnergy, 14),
    timestepOpticalStateError: round(timestepOpticalError, 12),
    gridOpticalStateError: round(gridOpticalError, 9),
    maximumRuntimeSurrogateRmsError: round(max(runtimeConditions.map(
      (condition) => condition.surrogateValidation.rmsError,
    )), 9),
    maximumRuntimeSurrogateError: round(max(runtimeConditions.map(
      (condition) => condition.surrogateValidation.maximumError,
    )), 9),
    nominalFixedPointDrifts: nominalFixedPointDrifts.map((value) => round(value, 12)),
    nominalAnchoredOpticalStates: nominalAnchoredOpticalStates.map((value) => round(value, 12)),
    nominalSettledOpticalStates: nominalSettledOpticalStates.map((value) => round(value, 12)),
    maximumNominalFixedPointDrift: round(maximumNominalFixedPointDrift, 12),
    maximumNominalAnchoredOpticalError: round(maximumNominalAnchoredOpticalError, 12),
    maximumNominalSettledOpticalError: round(maximumNominalSettledOpticalError, 12),
    maximumNominalAttractionError: round(maximumNominalAttractionError, 12),
    pass: timestepOpticalError < 0.002
      && gridOpticalError < 0.03
      && zeroFieldFinalEnergy < zeroFieldInitialEnergy
      && max(runtimeConditions.map((condition) => condition.surrogateValidation.rmsError)) < 0.08
      && max(runtimeConditions.map((condition) => condition.surrogateValidation.maximumError)) < 0.25
      && maximumNominalFixedPointDrift < 1e-9
      && maximumNominalAnchoredOpticalError < 1e-9
      && maximumNominalSettledOpticalError < 1e-9
      && maximumNominalAttractionError < 1e-9,
  },
  claimBoundary: "No parameter is presented as a measurement of an unaged DMG-LCD-01 or DMG-LCD-06 cell. Unknown analogue levels, material identity, and polarizer spectra remain bounded reconstructions.",
};

function glslArray(name, values) {
  return `const float ${name}[${values.length}] = float[](${values.map((value) => Number(value).toFixed(9)).join(", ")});`;
}

const targetValues = runtimeConditions.flatMap((condition) => condition.equilibriumDirectorCoordinates);
const driftValues = runtimeConditions.flatMap((condition) => condition.driftDeltaPerReferenceFrame);
const include = `// Generated by tools/build-dmg01-stn-physics.mjs. Do not hand-edit.\n`
  + `// Source: ../generated/ws2-stn-physics-v1.json\n`
  + `const float DMG_PHYSICAL_REFRESH_HZ = ${drive.panel.refreshHz.toFixed(7)};\n`
  + `const float DMG_VISCOSITY_ACTIVATION_K = ${nominalMaterial.viscosityActivationKelvin.toFixed(1)};\n`
  + `const int DMG_PHYSICAL_DRIFT_BINS = ${driftBins};\n`
  + `const int DMG_PHYSICAL_OPTICAL_BINS = ${opticalLutBins};\n`
  + `${glslArray("DMG_PHYSICAL_TARGET_Q", targetValues)}\n`
  + `${glslArray("DMG_PHYSICAL_OPTICAL", directorToOpticalLut)}\n`
  + `${glslArray("DMG_PHYSICAL_OPTICAL_ANCHOR_Q", nominalOpticalAnchorCoordinates)}\n`
  + `${glslArray("DMG_PHYSICAL_OPTICAL_CORRECTION", nominalOpticalAnchorCorrections)}\n`
  + `${glslArray("DMG_PHYSICAL_DRIFT", driftValues)}\n`;

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== reportText) {
    fail("DMG WS2 physical report is missing or stale; run node tools/build-dmg01-stn-physics.mjs");
  }
  if (!fs.existsSync(includePath) || fs.readFileSync(includePath, "utf8") !== include) {
    fail("DMG WS2 generated Shader surrogate is missing or stale; run node tools/build-dmg01-stn-physics.mjs");
  }
  if (!report.validation.pass) fail("DMG WS2 physical reconstruction validation failed");
  console.log("DMG-01 WS2 physical reconstruction and Shader surrogate are current.");
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, reportText);
  fs.writeFileSync(includePath, include);
  if (!report.validation.pass) fail("Wrote WS2 artifacts, but physical validation failed");
  console.log(`Wrote ${path.relative(root, outputPath)} and ${path.relative(root, includePath)}.`);
}
