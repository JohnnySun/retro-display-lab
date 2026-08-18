// One-dimensional reflective STN reference model for the DMG-01 reconstruction.
// This is deliberately an offline model: the runtime shader consumes a generated
// modal surrogate, not a hand-authored response time.

export const EPSILON_0 = 8.8541878128e-12;
export const DEFAULT_GRID_POINTS = 17;
export const DEFAULT_TIMESTEP_SECONDS = 0.00005;
export const DEFAULT_WAVELENGTHS_NM = Object.freeze([
  420, 440, 460, 480, 500, 520, 540, 560,
  580, 600, 620, 640, 660, 680, 700,
]);

export function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function radians(degrees) {
  return degrees * Math.PI / 180;
}

export function selectionRatio(rows) {
  const root = Math.sqrt(rows);
  return Math.sqrt((root + 1) / (root - 1));
}

export function altPleshkoAmplitudes(drive, contrastScale = 1) {
  const rows = drive.panel.visibleRows;
  const root = Math.sqrt(rows);
  const nonselectRms = drive.multiplexModel.nominalNonselectRmsVolts * contrastScale;
  const columnAmplitude = nonselectRms / Math.sqrt(2 - 2 / root);
  return {
    rowSelectAmplitude: root * columnAmplitude,
    columnAmplitude,
    nonselectRms,
  };
}

export function shadeRmsVoltages(drive, contrastScale = 1) {
  const rows = drive.panel.visibleRows;
  const amplitudes = altPleshkoAmplitudes(drive, contrastScale);
  const row = amplitudes.rowSelectAmplitude;
  const column = amplitudes.columnAmplitude;
  return drive.multiplexModel.fourShadeSelectedEnergyFractions.map((fraction) => Math.sqrt(
    (fraction * (row + column) ** 2
      + (1 - fraction) * (row - column) ** 2
      + (rows - 1) * column ** 2) / rows,
  ));
}

export function materialToSI(member, sharedGeometry, temperatureCelsius = 20) {
  const referenceKelvin = 293.15;
  const kelvin = temperatureCelsius + 273.15;
  // The unidentified DMG mixture has no published temperature curve. This
  // bounded Andrade coefficient is used only to propagate the known strong
  // temperature sensitivity of rotational viscosity.
  const viscosityActivationKelvin = member.viscosityActivationKelvin ?? 3800;
  const viscosityScale = Math.exp(viscosityActivationKelvin * (1 / kelvin - 1 / referenceKelvin));
  const cellGap = member.cellGapMicrometers * 1e-6;
  return Object.freeze({
    id: member.id,
    temperatureCelsius,
    cellGap,
    deltaN589: member.birefringence589nm,
    ordinaryIndex589: member.ordinaryIndex589nm,
    gamma1: member.rotationalViscosityPascalSeconds * viscosityScale,
    viscosityActivationKelvin,
    K11: member.K11Piconewtons * 1e-12,
    K22: member.K22Piconewtons * 1e-12,
    K33: member.K33Piconewtons * 1e-12,
    deltaEpsilon: member.dielectricAnisotropy,
    twist: radians(sharedGeometry.twistDegrees),
    pitch: cellGap / sharedGeometry.thicknessToPitch,
    pretilt: radians(sharedGeometry.pretiltDegrees),
    anchoring: sharedGeometry.surfaceAnchoringJPerSquareMeter,
    polarizerFrontOffset: radians(sharedGeometry.polarizerFrontDegreesFromEntranceDirector),
    polarizerRearOffset: radians(sharedGeometry.polarizerRearDegreesFromExitDirector),
    reflectorAmplitude: sharedGeometry.reflectorAmplitude,
  });
}

function director(theta, phi) {
  const cosTheta = Math.cos(theta);
  return [
    cosTheta * Math.cos(phi),
    cosTheta * Math.sin(phi),
    Math.sin(theta),
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normSquared(v) {
  return dot(v, v);
}

function normalized(v) {
  const length = Math.sqrt(normSquared(v));
  return v.map((component) => component / Math.max(length, Number.EPSILON));
}

export function initialDirector(material, gridPoints = DEFAULT_GRID_POINTS) {
  const theta = [];
  const phi = [];
  for (let index = 0; index < gridPoints; index += 1) {
    const position = index / (gridPoints - 1);
    theta.push(material.pretilt);
    phi.push(material.twist * position);
  }
  return { theta, phi };
}

export function cloneDirector(state) {
  return { theta: [...state.theta], phi: [...state.phi] };
}

function segmentEnergy(state, index, material, electricField) {
  const points = state.theta.length;
  const dz = material.cellGap / (points - 1);
  const a = director(state.theta[index], state.phi[index]);
  const b = director(state.theta[index + 1], state.phi[index + 1]);
  const middle = normalized(a.map((value, axis) => value + b[axis]));
  const derivative = b.map((value, axis) => (value - a[axis]) / dz);
  const divergence = derivative[2];
  const curl = [-derivative[1], derivative[0], 0];
  const twist = dot(middle, curl) + 2 * Math.PI / material.pitch;
  const bend = cross(middle, curl);
  const elasticDensity = 0.5 * material.K11 * divergence ** 2
    + 0.5 * material.K22 * twist ** 2
    + 0.5 * material.K33 * normSquared(bend);
  const dielectricDensity = -0.5 * EPSILON_0 * material.deltaEpsilon
    * electricField ** 2 * middle[2] ** 2;
  return (elasticDensity + dielectricDensity) * dz;
}

function anchoringEnergy(state, index, material) {
  const boundaryPhi = index === 0 ? 0 : material.twist;
  const anchor = director(material.pretilt, boundaryPhi);
  const value = director(state.theta[index], state.phi[index]);
  return 0.5 * material.anchoring * (1 - dot(value, anchor) ** 2);
}

function localEnergy(state, index, material, electricField) {
  let energy = 0;
  if (index > 0) energy += segmentEnergy(state, index - 1, material, electricField);
  if (index < state.theta.length - 1) energy += segmentEnergy(state, index, material, electricField);
  if (index === 0 || index === state.theta.length - 1) {
    energy += anchoringEnergy(state, index, material);
  }
  return energy;
}

export function freeEnergy(state, material, rmsVolts) {
  const electricField = rmsVolts / material.cellGap;
  let energy = 0;
  for (let index = 0; index < state.theta.length - 1; index += 1) {
    energy += segmentEnergy(state, index, material, electricField);
  }
  energy += anchoringEnergy(state, 0, material);
  energy += anchoringEnergy(state, state.theta.length - 1, material);
  return energy;
}

export function stepDirector(state, material, rmsVolts, seconds) {
  const electricField = rmsVolts / material.cellGap;
  const dz = material.cellGap / (state.theta.length - 1);
  const angleEpsilon = 1e-5;
  const thetaGradient = new Array(state.theta.length);
  const phiGradient = new Array(state.phi.length);

  for (let index = 0; index < state.theta.length; index += 1) {
    const originalTheta = state.theta[index];
    state.theta[index] = originalTheta + angleEpsilon;
    const thetaPlus = localEnergy(state, index, material, electricField);
    state.theta[index] = originalTheta - angleEpsilon;
    const thetaMinus = localEnergy(state, index, material, electricField);
    state.theta[index] = originalTheta;
    thetaGradient[index] = (thetaPlus - thetaMinus) / (2 * angleEpsilon);

    const originalPhi = state.phi[index];
    state.phi[index] = originalPhi + angleEpsilon;
    const phiPlus = localEnergy(state, index, material, electricField);
    state.phi[index] = originalPhi - angleEpsilon;
    const phiMinus = localEnergy(state, index, material, electricField);
    state.phi[index] = originalPhi;
    phiGradient[index] = (phiPlus - phiMinus) / (2 * angleEpsilon);
  }

  const next = cloneDirector(state);
  for (let index = 0; index < state.theta.length; index += 1) {
    const rotationalArea = material.gamma1 * dz;
    const azimuthMetric = Math.max(Math.cos(state.theta[index]) ** 2, 0.04);
    next.theta[index] = clamp(
      state.theta[index] - seconds * thetaGradient[index] / rotationalArea,
      -0.02,
      Math.PI / 2 - 0.02,
    );
    next.phi[index] = state.phi[index]
      - seconds * phiGradient[index] / (rotationalArea * azimuthMetric);
  }
  return next;
}

export function integrateDirector(initial, material, rmsVolts, durationSeconds, options = {}) {
  const timestep = options.timestepSeconds ?? DEFAULT_TIMESTEP_SECONDS;
  const sampleSeconds = options.sampleSeconds ?? Infinity;
  const state = cloneDirector(initial);
  let current = state;
  let elapsed = 0;
  let nextSample = sampleSeconds;
  const samples = [];
  while (elapsed < durationSeconds - 1e-15) {
    const step = Math.min(timestep, durationSeconds - elapsed);
    current = stepDirector(current, material, rmsVolts, step);
    elapsed += step;
    if (elapsed + timestep * 0.25 >= nextSample) {
      samples.push({
        seconds: elapsed,
        energyJPerSquareMeter: freeEnergy(current, material, rmsVolts),
        director: cloneDirector(current),
      });
      nextSample += sampleSeconds;
    }
  }
  return { state: current, samples };
}

function complex(re, im = 0) {
  return [re, im];
}

function cAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function cMultiply(a, b) {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function cAbsSquared(a) {
  return a[0] ** 2 + a[1] ** 2;
}

function matrixMultiply(a, b) {
  return [
    [cAdd(cMultiply(a[0][0], b[0][0]), cMultiply(a[0][1], b[1][0])),
      cAdd(cMultiply(a[0][0], b[0][1]), cMultiply(a[0][1], b[1][1]))],
    [cAdd(cMultiply(a[1][0], b[0][0]), cMultiply(a[1][1], b[1][0])),
      cAdd(cMultiply(a[1][0], b[0][1]), cMultiply(a[1][1], b[1][1]))],
  ];
}

function matrixVector(matrix, vector) {
  return [
    cAdd(cMultiply(matrix[0][0], vector[0]), cMultiply(matrix[0][1], vector[1])),
    cAdd(cMultiply(matrix[1][0], vector[0]), cMultiply(matrix[1][1], vector[1])),
  ];
}

function identityMatrix() {
  return [[complex(1), complex(0)], [complex(0), complex(1)]];
}

function polarizer(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [complex(c * c), complex(c * s)],
    [complex(c * s), complex(s * s)],
  ];
}

function retarder(angle, retardance) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const fast = complex(Math.cos(retardance / 2), Math.sin(retardance / 2));
  const slow = complex(Math.cos(retardance / 2), -Math.sin(retardance / 2));
  return [
    [cAdd(complex(c * c * fast[0], c * c * fast[1]), complex(s * s * slow[0], s * s * slow[1])),
      complex(c * s * (fast[0] - slow[0]), c * s * (fast[1] - slow[1]))],
    [complex(c * s * (fast[0] - slow[0]), c * s * (fast[1] - slow[1])),
      cAdd(complex(s * s * fast[0], s * s * fast[1]), complex(c * c * slow[0], c * c * slow[1]))],
  ];
}

function extraordinaryIndex(material, theta, wavelengthNm) {
  const dispersion = (589 / wavelengthNm) ** 2;
  const no = material.ordinaryIndex589;
  const ne = no + material.deltaN589 * dispersion;
  const nz = Math.sin(theta);
  const inPlane = Math.cos(theta);
  return no * ne / Math.sqrt(ne ** 2 * nz ** 2 + no ** 2 * inPlane ** 2);
}

export function reflectedSpectrum(state, material, wavelengthsNm = DEFAULT_WAVELENGTHS_NM) {
  const dz = material.cellGap / (state.theta.length - 1);
  const frontAngle = state.phi[0] + material.polarizerFrontOffset;
  const rearAngle = state.phi[state.phi.length - 1] + material.polarizerRearOffset;
  const frontVector = [complex(Math.cos(frontAngle)), complex(Math.sin(frontAngle))];
  const rearPolarizer = polarizer(rearAngle);

  return wavelengthsNm.map((wavelengthNm) => {
    let forward = identityMatrix();
    const layers = [];
    for (let index = 0; index < state.theta.length - 1; index += 1) {
      const theta = 0.5 * (state.theta[index] + state.theta[index + 1]);
      const phi = 0.5 * (state.phi[index] + state.phi[index + 1]);
      const deltaN = extraordinaryIndex(material, theta, wavelengthNm)
        - material.ordinaryIndex589;
      const phase = 2 * Math.PI * deltaN * dz / (wavelengthNm * 1e-9);
      const layer = retarder(phi, phase);
      layers.push(layer);
      forward = matrixMultiply(layer, forward);
    }
    let reverse = identityMatrix();
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      reverse = matrixMultiply(layers[index], reverse);
    }
    let field = matrixVector(forward, frontVector);
    field = matrixVector(rearPolarizer, field);
    field = matrixVector(reverse, field);
    const amplitude = cAdd(
      cMultiply(frontVector[0], field[0]),
      cMultiply(frontVector[1], field[1]),
    );
    return {
      wavelengthNm,
      reflectance: clamp(cAbsSquared(amplitude) * material.reflectorAmplitude ** 2),
    };
  });
}

function asymmetricGaussian(wavelength, mean, leftWidth, rightWidth) {
  const width = wavelength < mean ? leftWidth : rightWidth;
  return Math.exp(-0.5 * ((wavelength - mean) / width) ** 2);
}

function cie1931Approx(wavelength) {
  const x = 1.056 * asymmetricGaussian(wavelength, 599.8, 37.9, 31)
    + 0.362 * asymmetricGaussian(wavelength, 442, 16, 26.7)
    - 0.065 * asymmetricGaussian(wavelength, 501.1, 20.4, 26.2);
  const y = 0.821 * asymmetricGaussian(wavelength, 568.8, 46.9, 40.5)
    + 0.286 * asymmetricGaussian(wavelength, 530.9, 16.3, 31.1);
  const z = 1.217 * asymmetricGaussian(wavelength, 437, 11.8, 36)
    + 0.681 * asymmetricGaussian(wavelength, 459, 26, 13.8);
  return [Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)];
}

function planckRelative(wavelengthNm, kelvin = 6504) {
  const wavelength = wavelengthNm * 1e-9;
  const c2 = 0.01438776877;
  return 1 / (wavelength ** 5 * Math.expm1(c2 / (wavelength * kelvin)));
}

export function spectrumXYZ(spectrum) {
  let x = 0;
  let y = 0;
  let z = 0;
  let whiteY = 0;
  for (const sample of spectrum) {
    const observer = cie1931Approx(sample.wavelengthNm);
    const illuminant = planckRelative(sample.wavelengthNm);
    x += sample.reflectance * illuminant * observer[0];
    y += sample.reflectance * illuminant * observer[1];
    z += sample.reflectance * illuminant * observer[2];
    whiteY += illuminant * observer[1];
  }
  return [x / whiteY, y / whiteY, z / whiteY];
}

export function opticalObservation(state, material) {
  const spectrum = reflectedSpectrum(state, material);
  const xyz = spectrumXYZ(spectrum);
  return { spectrum, xyz, luminance: xyz[1] };
}

export function buildOpticalCalibration(equilibria) {
  const luminances = equilibria.map((entry) => entry.optical.luminance);
  const targets = [0.25, 0.5, 0.75, 1];
  return {
    luminances,
    targets,
    stateForLuminance(luminance) {
      for (let index = 0; index < luminances.length - 1; index += 1) {
        const a = luminances[index];
        const b = luminances[index + 1];
        if ((luminance <= a && luminance >= b) || (luminance >= a && luminance <= b)) {
          const mix = (luminance - a) / Math.max(Math.abs(b - a), 1e-12)
            * Math.sign(b - a);
          return targets[index] + (targets[index + 1] - targets[index]) * mix;
        }
      }
      if (luminance >= Math.max(...luminances)) return targets[luminances.indexOf(Math.max(...luminances))];
      return targets[luminances.indexOf(Math.min(...luminances))];
    },
  };
}

export function fitBiExponential(samples) {
  const usable = samples.filter((sample) => sample.seconds > 0 && Number.isFinite(sample.progress));
  let best = null;
  for (let weightIndex = 0; weightIndex <= 20; weightIndex += 1) {
    const slowWeight = weightIndex * 0.025;
    for (let rateIndex = 0; rateIndex <= 70; rateIndex += 1) {
      const fastRate = 0.5 * (1000 ** (rateIndex / 70));
      for (let ratioIndex = 0; ratioIndex <= 24; ratioIndex += 1) {
        const slowRatio = 0.04 * (20 ** (ratioIndex / 24));
        let squaredError = 0;
        let maximumError = 0;
        for (const sample of usable) {
          const predicted = 1 - (1 - slowWeight) * Math.exp(-fastRate * sample.seconds)
            - slowWeight * Math.exp(-fastRate * slowRatio * sample.seconds);
          const error = predicted - sample.progress;
          squaredError += error ** 2;
          maximumError = Math.max(maximumError, Math.abs(error));
        }
        const rmsError = Math.sqrt(squaredError / Math.max(usable.length, 1));
        if (!best || rmsError < best.rmsError) {
          best = { fastRate, slowRatio, slowWeight, rmsError, maximumError };
        }
      }
    }
  }
  return best;
}

export function modalProgress(fit, seconds) {
  return 1 - (1 - fit.slowWeight) * Math.exp(-fit.fastRate * seconds)
    - fit.slowWeight * Math.exp(-fit.fastRate * fit.slowRatio * seconds);
}

export function solveT90(fit) {
  let low = 0;
  let high = 0.01;
  while (modalProgress(fit, high) < 0.9 && high < 100) high *= 2;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = 0.5 * (low + high);
    if (modalProgress(fit, middle) < 0.9) low = middle;
    else high = middle;
  }
  return 0.5 * (low + high);
}
