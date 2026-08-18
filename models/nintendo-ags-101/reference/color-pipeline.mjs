export function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function srgbDecodeChannel(value) {
  const encoded = clamp(value);
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function srgbEncodeChannel(value) {
  const linear = Number.isFinite(value) ? value : 0;
  return clamp(linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * Math.max(linear, 0) ** (1 / 2.4) - 0.055);
}

export function multiplyMatrixVector(matrix, vector) {
  if (!Array.isArray(matrix) || matrix.length !== 3
      || !Array.isArray(vector) || vector.length !== 3) {
    throw new TypeError("matrix and vector must be 3x3 and length 3");
  }
  return matrix.map((row) => row.reduce(
    (sum, value, column) => sum + value * vector[column],
    0,
  ));
}

export function sourceEotfRgb555(indices, measuredEotf = null) {
  if (!Array.isArray(indices) || indices.length !== 3) {
    throw new TypeError("indices must contain R, G, and B codes");
  }
  return indices.map((code, channel) => {
    const index = clamp(Math.round(code), 0, 31);
    return measuredEotf
      ? measuredEotf[index][channel]
      : srgbDecodeChannel(index / 31);
  });
}

export function hcsHostLinear(native, profile, {
  adaptToD65 = false,
  improveContrast = true,
} = {}) {
  let xyz = multiplyMatrixVector(profile.nativeRgbToXyz, native);
  if (!improveContrast) {
    xyz = xyz.map((value, channel) => (
      value + profile.blackXyzNormalizedByRawWhiteY[channel]
    ));
  }
  if (adaptToD65) {
    xyz = multiplyMatrixVector(
      improveContrast
        ? profile.bradfordNativeToD65
        : profile.bradfordNativeWithBlackToD65,
      xyz,
    );
  }
  return multiplyMatrixVector(profile.srgbXyzToLinearRgb, xyz);
}

export function renderStaticRgb555(indices, profile, {
  measured = true,
  adaptToD65 = false,
  improveContrast = true,
} = {}) {
  const native = sourceEotfRgb555(
    indices,
    measured ? profile.eotfRgb555Runtime : null,
  );
  const hostLinear = measured
    ? hcsHostLinear(native, profile, { adaptToD65, improveContrast })
    : native;
  return hostLinear.map(srgbEncodeChannel);
}
