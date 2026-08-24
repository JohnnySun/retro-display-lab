// Nintendo CGB-001 fixed-angle D65 color reference equations.
// Evidence: CGB-HCS-REFLECTANCE-2026 and the verbatim CIE datasets under
// reference/upstream/. Raw readings remain immutable; every repair here is a
// derived model operation and is reported by tools/build-cgb001-ws1.mjs.

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const add3 = (a, b) => a.map((value, index) => value + b[index]);
const sub3 = (a, b) => a.map((value, index) => value - b[index]);
const scale3 = (value, scale) => value.map((item) => item * scale);
const length3 = (value) => Math.hypot(...value);

export const SRGB_XYZ_TO_LINEAR_RGB = [
  [3.2406255, -1.537208, -0.4986286],
  [-0.9689307, 1.8757561, 0.0415175],
  [0.0557101, -0.2040211, 1.0569959],
];

function multiplyMatrix3(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function sampleLinear(values, position) {
  const coordinate = clamp(position) * (values.length - 1);
  const lower = Math.floor(coordinate);
  const upper = Math.min(values.length - 1, lower + 1);
  const amount = coordinate - lower;
  return values[lower].map((value, channel) => value * (1 - amount) + values[upper][channel] * amount);
}

function pava(values, weights = values.map(() => 1)) {
  const blocks = values.map((value, index) => ({
    start: index,
    end: index,
    weight: weights[index],
    sum: value * weights[index],
  }));
  for (let index = 1; index < blocks.length; index += 1) {
    while (index > 0) {
      const prior = blocks[index - 1];
      const current = blocks[index];
      if (prior.sum / prior.weight <= current.sum / current.weight) break;
      prior.end = current.end;
      prior.weight += current.weight;
      prior.sum += current.sum;
      blocks.splice(index, 1);
      index -= 1;
    }
  }
  const output = Array(values.length).fill(0);
  for (const block of blocks) {
    const mean = block.sum / block.weight;
    for (let index = block.start; index <= block.end; index += 1) output[index] = mean;
  }
  return output;
}

export function isotonicRegression(values) {
  const output = pava(values.map((value) => Math.max(0, value)));
  output[0] = 0;
  return output;
}

function monotonicProjectDeltaRamp(deltaRamp) {
  const originalY = deltaRamp.map((xyz) => xyz[1]);
  const projectedY = isotonicRegression(originalY);
  const projected = deltaRamp.map((xyz, index) => {
    if (projectedY[index] === 0) return [0, 0, 0];
    if (xyz[1] > 1e-12) return scale3(xyz, projectedY[index] / xyz[1]);
    const next = deltaRamp.slice(index).find((candidate) => candidate[1] > 1e-12)
      ?? deltaRamp.slice(0, index).reverse().find((candidate) => candidate[1] > 1e-12);
    return next ? scale3(next, projectedY[index] / next[1]) : [0, projectedY[index], 0];
  });
  return {
    projected,
    audit: {
      originalY,
      projectedY,
      adjustedIndices: originalY
        .map((value, index) => ({ index, before: value, after: projectedY[index] }))
        .filter((item) => Math.abs(item.before - item.after) > 1e-12),
    },
  };
}

function resampleSeries(series, globalBlack, options = {}) {
  const field = options.field ?? "d65XyzRecordedRange";
  const source = series.readings.map((reading) => reading[field]);
  const sourceBlack = source[0];
  const rawDelta = Array.from({ length: 32 }, (_, code) => sub3(sampleLinear(source, code / 31), sourceBlack));
  const projected = options.monotonic === false
    ? { projected: rawDelta, audit: { originalY: rawDelta.map((xyz) => xyz[1]), projectedY: rawDelta.map((xyz) => xyz[1]), adjustedIndices: [] } }
    : monotonicProjectDeltaRamp(rawDelta);
  return {
    sourceBlack,
    globalBlack,
    sourcePatchCount: source.length,
    mappingPolicy: series.codeMappingPolicy,
    rawDelta,
    delta: projected.projected,
    monotonicAudit: projected.audit,
  };
}

function subtractRamps(target, ...components) {
  return target.map((xyz, index) => components.reduce(
    (value, ramp) => sub3(value, ramp[index]),
    xyz,
  ));
}

export function buildColorModel(measurementRecord, options = {}) {
  const summary = Object.fromEntries(measurementRecord.summaryReadings.map((reading) => [reading.sourceReading, reading]));
  const field = options.field ?? "d65XyzRecordedRange";
  const globalBlack = summary.Black[field];
  const ramp = Object.fromEntries(Object.entries(measurementRecord.normalizedSeries).map(([name, series]) => [
    name,
    resampleSeries(series, globalBlack, { field, monotonic: options.monotonic !== false }),
  ]));
  const residual = {
    RG: subtractRamps(ramp.Y.delta, ramp.R.delta, ramp.G.delta),
    GB: subtractRamps(ramp.C.delta, ramp.G.delta, ramp.B.delta),
    BR: subtractRamps(ramp.M.delta, ramp.B.delta, ramp.R.delta),
  };
  residual.RGB = subtractRamps(
    ramp.Greyscale.delta,
    ramp.R.delta,
    ramp.G.delta,
    ramp.B.delta,
    residual.RG,
    residual.GB,
    residual.BR,
  );
  return {
    id: options.id ?? "cgb001-reference-d65-v1",
    field,
    monotonic: options.monotonic !== false,
    globalBlack,
    referenceWhite: measurementRecord.d65Integration[
      field === "d65XyzAuthorUsableRange" ? "authorUsableRangeWhiteXyz" : "recordedRangeWhiteXyz"
    ],
    ramp,
    residual,
  };
}

function pairCoordinate(a, b) {
  return Math.sqrt(clamp(a) * clamp(b));
}

function tripleCoordinate(r, g, b) {
  return Math.cbrt(clamp(r) * clamp(g) * clamp(b));
}

export function evaluateColorModel(model, rgb, candidate = "pairwise-neutral") {
  const [r, g, b] = rgb.map((value) => clamp(value));
  let xyz = [...model.globalBlack];
  xyz = add3(xyz, sampleLinear(model.ramp.R.delta, r));
  xyz = add3(xyz, sampleLinear(model.ramp.G.delta, g));
  xyz = add3(xyz, sampleLinear(model.ramp.B.delta, b));
  if (candidate === "primary-only") return xyz;
  xyz = add3(xyz, sampleLinear(model.residual.RG, pairCoordinate(r, g)));
  xyz = add3(xyz, sampleLinear(model.residual.GB, pairCoordinate(g, b)));
  xyz = add3(xyz, sampleLinear(model.residual.BR, pairCoordinate(b, r)));
  if (candidate === "pairwise") return xyz;
  if (candidate !== "pairwise-neutral") throw new Error(`unknown CGB color candidate: ${candidate}`);
  return add3(xyz, sampleLinear(model.residual.RGB, tripleCoordinate(r, g, b)));
}

function gammaPolynomial(coefficients, value) {
  return coefficients.reduce((sum, coefficient, degree) => sum + coefficient * value ** degree, 0);
}

function upstreamLuminanceScale(rgb, secondaryScales) {
  const maximum = Math.max(...rgb);
  if (maximum <= 0) return 1;
  const c = rgb.map((value) => value / maximum);
  const neutral = Math.min(...c);
  const p = c.map((value) => value - neutral);
  const yellow = Math.min(p[0], p[1]);
  const cyan = Math.min(p[1], p[2]);
  const magenta = Math.min(p[2], p[0]);
  return 1
    + yellow * (secondaryScales.yellow.k - 1)
    + cyan * (secondaryScales.cyan.k - 1)
    + magenta * (secondaryScales.magenta.k - 1)
    + neutral * (secondaryScales.gray.k - 1);
}

export function evaluateUpstreamD65(parameters, rgb, options = {}) {
  const channels = ["R", "G", "B"];
  const linear = rgb.map((value, channel) => {
    const drive = clamp(value);
    if (drive === 0) return 0;
    const gamma = gammaPolynomial(parameters.polynomials[channels[channel]].coefficients, drive)
      + (options.simulate45Degrees ? 1.05 : 0);
    return drive ** gamma;
  });
  const xyz = [0, 1, 2].map((component) => channels.reduce(
    (sum, channel, index) => sum + parameters.matrixColumns[channel][component] * linear[index],
    0,
  ));
  const scaled = scale3(xyz, upstreamLuminanceScale(linear, parameters.secondaryScales));
  if (!options.includeBlack) return scaled;
  const black = (parameters.blackPoints[options.blackId ?? "red"] ?? parameters.blackPoints.global_minimum)
    .map((value) => value / 100);
  return add3(black, scaled);
}

export function xyzToXyY(xyz) {
  const sum = xyz[0] + xyz[1] + xyz[2];
  return sum > 0 ? [xyz[0] / sum, xyz[1] / sum, xyz[1]] : [0, 0, xyz[1]];
}

export function xyzToLab(xyz, white) {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const f = (value) => value > epsilon ? Math.cbrt(value) : (kappa * value + 16) / 116;
  const fx = f(xyz[0] / white[0]);
  const fy = f(xyz[1] / white[1]);
  const fz = f(xyz[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE00Lab(labA, labB) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const degrees = (angle) => angle * 180 / Math.PI;
  const [l1, a1, b1] = labA;
  const [l2, a2, b2] = labB;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cMean = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const value = degrees(Math.atan2(b, a));
    return value >= 0 ? value : value + 360;
  };
  const hp1 = hue(ap1, b1);
  const hp2 = hue(ap2, b2);
  const deltaL = l2 - l1;
  const deltaC = cp2 - cp1;
  let deltaHue = hp2 - hp1;
  if (cp1 * cp2 === 0) deltaHue = 0;
  else if (deltaHue > 180) deltaHue -= 360;
  else if (deltaHue < -180) deltaHue += 360;
  const deltaH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(radians(deltaHue / 2));
  const lMean = (l1 + l2) / 2;
  const cpMean = (cp1 + cp2) / 2;
  let hpMean;
  if (cp1 * cp2 === 0) hpMean = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hpMean = (hp1 + hp2) / 2;
  else if (hp1 + hp2 < 360) hpMean = (hp1 + hp2 + 360) / 2;
  else hpMean = (hp1 + hp2 - 360) / 2;
  const t = 1
    - 0.17 * Math.cos(radians(hpMean - 30))
    + 0.24 * Math.cos(radians(2 * hpMean))
    + 0.32 * Math.cos(radians(3 * hpMean + 6))
    - 0.20 * Math.cos(radians(4 * hpMean - 63));
  const sL = 1 + 0.015 * (lMean - 50) ** 2 / Math.sqrt(20 + (lMean - 50) ** 2);
  const sC = 1 + 0.045 * cpMean;
  const sH = 1 + 0.015 * cpMean * t;
  const deltaTheta = 30 * Math.exp(-(((hpMean - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
  const rT = -rC * Math.sin(radians(2 * deltaTheta));
  const lTerm = deltaL / sL;
  const cTerm = deltaC / sC;
  const hTerm = deltaH / sH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm);
}

export function deltaE00Xyz(xyzA, xyzB, white) {
  return deltaE00Lab(xyzToLab(xyzA, white), xyzToLab(xyzB, white));
}

const CAM16_MATRIX = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
];

function cam16AdaptedResponse(rgb, fl) {
  return rgb.map((value) => {
    const power = (fl * Math.abs(value) / 100) ** 0.42;
    return Math.sign(value) * 400 * power / (power + 27.13) + 0.1;
  });
}

export function xyzToCam16Ucs(xyz, white, viewing = {}) {
  const xyz100 = xyz.map((value) => value * 100);
  const white100 = white.map((value) => value * 100);
  const la = viewing.adaptingLuminanceCdM2 ?? (64 / Math.PI / 5);
  const yb = viewing.backgroundLuminance ?? 20;
  const f = viewing.surroundF ?? 1;
  const c = viewing.surroundC ?? 0.69;
  const nc = viewing.surroundNc ?? 1;
  const n = yb / white100[1];
  const z = 1.48 + Math.sqrt(n);
  const nbb = 0.725 * (1 / n) ** 0.2;
  const ncb = nbb;
  const k = 1 / (5 * la + 1);
  const fl = 0.2 * k ** 4 * 5 * la + 0.1 * (1 - k ** 4) ** 2 * Math.cbrt(5 * la);
  const d = clamp(f * (1 - Math.exp((-la - 42) / 92) / 3.6));
  const rgbW = multiplyMatrix3(CAM16_MATRIX, white100);
  const adaptation = rgbW.map((value) => d * white100[1] / value + 1 - d);
  const rgbAw = cam16AdaptedResponse(rgbW.map((value, index) => value * adaptation[index]), fl);
  const aw = (2 * rgbAw[0] + rgbAw[1] + 0.05 * rgbAw[2] - 0.305) * nbb;
  const rgb = multiplyMatrix3(CAM16_MATRIX, xyz100).map((value, index) => value * adaptation[index]);
  const rgbA = cam16AdaptedResponse(rgb, fl);
  const a = rgbA[0] - 12 * rgbA[1] / 11 + rgbA[2] / 11;
  const b = (rgbA[0] + rgbA[1] - 2 * rgbA[2]) / 9;
  let h = Math.atan2(b, a);
  if (h < 0) h += 2 * Math.PI;
  const et = 0.25 * (Math.cos(h + 2) + 3.8);
  const aa = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2] - 0.305) * nbb;
  const j = 100 * Math.max(0, aa / aw) ** (c * z);
  const denominator = rgbA[0] + rgbA[1] + 21 * rgbA[2] / 20;
  const t = denominator === 0 ? 0 : (50000 / 13) * nc * ncb * et * Math.hypot(a, b) / denominator;
  const alpha = Math.max(0, t) ** 0.9 * (1.64 - 0.29 ** n) ** 0.73;
  const chroma = alpha * Math.sqrt(j / 100);
  const colorfulness = chroma * fl ** 0.25;
  const jp = 1.7 * j / (1 + 0.007 * j);
  const mp = Math.log1p(0.0228 * colorfulness) / 0.0228;
  return [jp, mp * Math.cos(h), mp * Math.sin(h)];
}

export function deltaECam16Ucs(xyzA, xyzB, white, viewing) {
  const a = xyzToCam16Ucs(xyzA, white, viewing);
  const b = xyzToCam16Ucs(xyzB, white, viewing);
  return length3(sub3(a, b));
}

export function xyzToLinearSrgb(xyz) {
  return multiplyMatrix3(SRGB_XYZ_TO_LINEAR_RGB, xyz);
}

export function linearToSrgbChannel(value) {
  if (value <= 0.0031308) return 12.92 * value;
  return 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
}

export function xyzToSrgb(xyz) {
  return xyzToLinearSrgb(xyz).map(linearToSrgbChannel);
}

export function buildXyzLut(model, candidate = "pairwise-neutral", size = 32) {
  const values = new Float64Array(size ** 3 * 3);
  let offset = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const xyz = evaluateColorModel(model, [r / (size - 1), g / (size - 1), b / (size - 1)], candidate);
        values[offset++] = xyz[0];
        values[offset++] = xyz[1];
        values[offset++] = xyz[2];
      }
    }
  }
  return { size, values };
}

function projectLuminanceAxis(values, weights, size, axis) {
  const output = new Float64Array(values);
  const indexOf = (r, g, b) => (b * size + g) * size + r;
  const line = new Array(size);
  const lineWeights = new Array(size);
  if (axis === 0) {
    for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        line[r] = values[indexOf(r, g, b)];
        lineWeights[r] = weights[indexOf(r, g, b)];
      }
      const projected = pava(line, lineWeights);
      for (let r = 0; r < size; r += 1) output[indexOf(r, g, b)] = projected[r];
    }
  } else if (axis === 1) {
    for (let b = 0; b < size; b += 1) for (let r = 0; r < size; r += 1) {
      for (let g = 0; g < size; g += 1) {
        line[g] = values[indexOf(r, g, b)];
        lineWeights[g] = weights[indexOf(r, g, b)];
      }
      const projected = pava(line, lineWeights);
      for (let g = 0; g < size; g += 1) output[indexOf(r, g, b)] = projected[g];
    }
  } else if (axis === 2) {
    for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) {
      for (let b = 0; b < size; b += 1) {
        line[b] = values[indexOf(r, g, b)];
        lineWeights[b] = weights[indexOf(r, g, b)];
      }
      const projected = pava(line, lineWeights);
      for (let b = 0; b < size; b += 1) output[indexOf(r, g, b)] = projected[b];
    }
  } else throw new Error(`unknown LUT projection axis: ${axis}`);
  return output;
}

function monotonicLuminanceAudit(values, size, tolerance = 1e-12) {
  const indexOf = (r, g, b) => (b * size + g) * size + r;
  let violationCount = 0;
  let largestDrop = 0;
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) {
    const current = values[indexOf(r, g, b)];
    if (r > 0) {
      const difference = current - values[indexOf(r - 1, g, b)];
      if (difference < -tolerance) { violationCount += 1; largestDrop = Math.min(largestDrop, difference); }
    }
    if (g > 0) {
      const difference = current - values[indexOf(r, g - 1, b)];
      if (difference < -tolerance) { violationCount += 1; largestDrop = Math.min(largestDrop, difference); }
    }
    if (b > 0) {
      const difference = current - values[indexOf(r, g, b - 1)];
      if (difference < -tolerance) { violationCount += 1; largestDrop = Math.min(largestDrop, difference); }
    }
  }
  return { violationCount, largestDrop };
}

export function projectLutLuminanceMonotonic(lut, globalBlack, options = {}) {
  const tolerance = options.tolerance ?? 1e-12;
  const maxIterations = options.maxIterations ?? 5000;
  const measuredAxisWeight = options.measuredAxisWeight ?? 256;
  const voxelCount = lut.size ** 3;
  const originalY = new Float64Array(voxelCount);
  for (let voxel = 0; voxel < voxelCount; voxel += 1) originalY[voxel] = lut.values[voxel * 3 + 1];
  let current = new Float64Array(originalY);
  const weights = new Float64Array(voxelCount).fill(1);
  const indexOf = (r, g, b) => (b * lut.size + g) * lut.size + r;
  for (let code = 0; code < lut.size; code += 1) {
    for (const [r, g, b] of [
      [code, 0, 0], [0, code, 0], [0, 0, code],
      [code, code, 0], [0, code, code], [code, 0, code], [code, code, code],
    ]) weights[indexOf(r, g, b)] = measuredAxisWeight;
  }
  const corrections = [0, 1, 2].map(() => new Float64Array(voxelCount));
  let iterationCount = 0;
  let maximumIterationChange = Infinity;
  for (; iterationCount < maxIterations && maximumIterationChange > tolerance; iterationCount += 1) {
    maximumIterationChange = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const shifted = new Float64Array(voxelCount);
      for (let index = 0; index < voxelCount; index += 1) shifted[index] = current[index] + corrections[axis][index];
      const projected = projectLuminanceAxis(shifted, weights, lut.size, axis);
      for (let index = 0; index < voxelCount; index += 1) {
        corrections[axis][index] = shifted[index] - projected[index];
        maximumIterationChange = Math.max(maximumIterationChange, Math.abs(projected[index] - current[index]));
      }
      current = projected;
    }
  }
  const values = new Float64Array(lut.values.length);
  let maximumAbsoluteYAdjustment = 0;
  let rootMeanSquareYAdjustment = 0;
  let adjustedVoxelCount = 0;
  for (let voxel = 0; voxel < voxelCount; voxel += 1) {
    const sourceOffset = voxel * 3;
    const sourceYDelta = originalY[voxel] - globalBlack[1];
    const targetYDelta = Math.max(0, current[voxel] - globalBlack[1]);
    const adjustment = current[voxel] - originalY[voxel];
    maximumAbsoluteYAdjustment = Math.max(maximumAbsoluteYAdjustment, Math.abs(adjustment));
    rootMeanSquareYAdjustment += adjustment ** 2;
    if (Math.abs(adjustment) > tolerance) adjustedVoxelCount += 1;
    if (targetYDelta <= tolerance) {
      values[sourceOffset] = globalBlack[0];
      values[sourceOffset + 1] = globalBlack[1];
      values[sourceOffset + 2] = globalBlack[2];
      continue;
    }
    const scale = sourceYDelta > tolerance ? targetYDelta / sourceYDelta : 1;
    values[sourceOffset] = globalBlack[0] + (lut.values[sourceOffset] - globalBlack[0]) * scale;
    values[sourceOffset + 1] = globalBlack[1] + targetYDelta;
    values[sourceOffset + 2] = globalBlack[2] + (lut.values[sourceOffset + 2] - globalBlack[2]) * scale;
  }
  const before = monotonicLuminanceAudit(originalY, lut.size, tolerance);
  const afterY = new Float64Array(voxelCount);
  for (let voxel = 0; voxel < voxelCount; voxel += 1) afterY[voxel] = values[voxel * 3 + 1];
  const after = monotonicLuminanceAudit(afterY, lut.size, tolerance);
  return {
    lut: { size: lut.size, values },
    audit: {
      method: "weighted Dykstra projection onto the three axis-wise isotonic luminance cones; measured ramp axes receive greater weight and black-relative XYZ chromatic direction is retained per voxel",
      tolerance,
      maxIterations,
      measuredAxisWeight,
      iterationCount,
      converged: maximumIterationChange <= tolerance,
      maximumIterationChange,
      adjustedVoxelCount,
      maximumAbsoluteYAdjustment,
      rootMeanSquareYAdjustment: Math.sqrt(rootMeanSquareYAdjustment / voxelCount),
      before,
      after,
    },
  };
}

export function lutIndex(size, r, g, b) {
  return ((b * size + g) * size + r) * 3;
}

export function sampleXyzLutTrilinear(lut, rgb) {
  const coordinate = rgb.map((value) => clamp(value) * (lut.size - 1));
  const lower = coordinate.map(Math.floor);
  const upper = lower.map((value) => Math.min(lut.size - 1, value + 1));
  const amount = coordinate.map((value, index) => value - lower[index]);
  const output = [0, 0, 0];
  for (let bz = 0; bz <= 1; bz += 1) {
    for (let gy = 0; gy <= 1; gy += 1) {
      for (let rx = 0; rx <= 1; rx += 1) {
        const r = rx ? upper[0] : lower[0];
        const g = gy ? upper[1] : lower[1];
        const b = bz ? upper[2] : lower[2];
        const weight = (rx ? amount[0] : 1 - amount[0])
          * (gy ? amount[1] : 1 - amount[1])
          * (bz ? amount[2] : 1 - amount[2]);
        const index = lutIndex(lut.size, r, g, b);
        for (let channel = 0; channel < 3; channel += 1) output[channel] += lut.values[index + channel] * weight;
      }
    }
  }
  return output;
}

export function packXyzLutRgba32f(lut) {
  const output = Buffer.alloc(lut.size ** 3 * 4 * 4);
  let writeOffset = 0;
  for (let index = 0; index < lut.values.length; index += 3) {
    output.writeFloatLE(lut.values[index], writeOffset);
    output.writeFloatLE(lut.values[index + 1], writeOffset + 4);
    output.writeFloatLE(lut.values[index + 2], writeOffset + 8);
    output.writeFloatLE(1, writeOffset + 12);
    writeOffset += 16;
  }
  return output;
}
