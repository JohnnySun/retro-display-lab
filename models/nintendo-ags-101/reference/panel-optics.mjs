export const APERTURE_X = Object.freeze([
  1, -2 / 3, -1 / 5, 4 / 7, -1 / 9, -2 / 11, 1 / 13,
]);

export const APERTURE_Y = Object.freeze([
  1, 0, -4 / 5, 2 / 7, 4 / 9, -4 / 11, 1 / 13,
]);

export const GENERIC_APERTURE_GEOMETRY = Object.freeze({
  horizontalRadiusSubpixels: 1.5,
  verticalRadiusPixels: 0.63,
  order: "bgr",
});

export const SHADER_PIXEL_CENTER_BIAS = 0.4999;

export function apertureAntiderivative(position, coefficients) {
  const squared = position * position;
  let power = position;
  let integral = 0;
  for (const coefficient of coefficients) {
    integral += power * coefficient;
    power *= squared;
  }
  return integral;
}

export function apertureKernelIntegral(coefficients) {
  return apertureAntiderivative(1, coefficients)
    - apertureAntiderivative(-1, coefficients);
}

export function integrateAperture(center, footprint, radius, coefficients) {
  const safeFootprint = Math.max(footprint, 1e-12);
  const safeRadius = Math.max(radius, 1e-12);
  const low = Math.max(-1, Math.min(1, (center - safeFootprint * 0.5) / safeRadius));
  const high = Math.max(-1, Math.min(1, (center + safeFootprint * 0.5) / safeRadius));
  return safeRadius * (
    apertureAntiderivative(high, coefficients)
    - apertureAntiderivative(low, coefficients)
  ) / safeFootprint;
}

export function apertureEnergyNormalization(horizontalRadius, verticalRadius) {
  const horizontalEnergy = horizontalRadius * apertureKernelIntegral(APERTURE_X);
  const verticalEnergy = verticalRadius * apertureKernelIntegral(APERTURE_Y);
  // Each color occupies one of three horizontal stripe periods.  Normalize
  // each source channel, not the sum of the three mutually exclusive stripes.
  return 3 / (horizontalEnergy * verticalEnergy);
}

export function apertureUniformSample(sourceX, sourceY, scaleX, scaleY, options = {}) {
  const horizontalRadius = options.horizontalRadiusSubpixels
    ?? GENERIC_APERTURE_GEOMETRY.horizontalRadiusSubpixels;
  const verticalRadius = options.verticalRadiusPixels
    ?? GENERIC_APERTURE_GEOMETRY.verticalRadiusPixels;
  const bgr = (options.order ?? GENERIC_APERTURE_GEOMETRY.order) === "bgr";
  const pixelX = Math.floor(sourceX - SHADER_PIXEL_CENTER_BIAS);
  const pixelY = Math.floor(sourceY - SHADER_PIXEL_CENTER_BIAS);
  const subpixel = (sourceX - SHADER_PIXEL_CENTER_BIAS - pixelX) * 3;
  const subpixelFootprint = 3 / scaleX;
  let left = [1, 0, -1].map((shift) => integrateAperture(
    subpixel + shift, subpixelFootprint, horizontalRadius, APERTURE_X,
  ));
  let right = [2, 3, 4].map((shift) => integrateAperture(
    subpixel - shift, subpixelFootprint, horizontalRadius, APERTURE_X,
  ));
  if (bgr) {
    left = [...left].reverse();
    right = [...right].reverse();
  }
  const row = sourceY - SHADER_PIXEL_CENTER_BIAS - pixelY;
  const rowFootprint = 1 / scaleY;
  const top = integrateAperture(row, rowFootprint, verticalRadius, APERTURE_Y);
  const bottom = integrateAperture(row - 1, rowFootprint, verticalRadius, APERTURE_Y);
  const normalization = apertureEnergyNormalization(horizontalRadius, verticalRadius);
  return left.map((value, channel) => normalization
    * (value + right[channel]) * (top + bottom));
}

export function averageUniformAperture(sourceWidth, sourceHeight, scaleX, scaleY, options = {}) {
  const outputWidth = Math.round(sourceWidth * scaleX);
  const outputHeight = Math.round(sourceHeight * scaleY);
  const actualScaleX = outputWidth / sourceWidth;
  const actualScaleY = outputHeight / sourceHeight;
  const sums = [0, 0, 0];
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = (y + 0.5) / actualScaleY;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = (x + 0.5) / actualScaleX;
      const sample = apertureUniformSample(sourceX, sourceY, actualScaleX, actualScaleY, options);
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += sample[channel];
    }
  }
  const count = outputWidth * outputHeight;
  return sums.map((sum) => sum / count);
}

export function relativeBacklightGain({ enabled = false, ratio = 1 } = {}) {
  return enabled ? Math.max(0, ratio) : 1;
}
