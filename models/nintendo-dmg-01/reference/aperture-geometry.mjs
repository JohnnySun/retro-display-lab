import { clamp } from "./optical-pipeline.mjs";

export function apertureCoverage1d(sourceCoordinate, hostPixelsPerSourcePixel,
  pixelFill = 0.875, pixelEdge = 1) {
  const cell = sourceCoordinate - Math.floor(sourceCoordinate);
  const footprint = Math.max(
    Math.max(pixelEdge, 0.001) / Math.max(hostPixelsPerSourcePixel, 0.0001),
    0.0001,
  );
  const apertureLow = 0.5 - pixelFill * 0.5;
  const apertureHigh = 0.5 + pixelFill * 0.5;
  const sampleLow = cell - footprint * 0.5;
  const sampleHigh = cell + footprint * 0.5;
  let overlap = 0;
  for (const period of [-1, 0, 1]) {
    overlap += Math.max(
      Math.min(sampleHigh, apertureHigh + period)
        - Math.max(sampleLow, apertureLow + period),
      0,
    );
  }
  return clamp(overlap / footprint);
}

export function apertureCoverage2d(sourceX, sourceY, scaleX, scaleY,
  pixelFill = 0.875, pixelEdge = 1) {
  return apertureCoverage1d(sourceX, scaleX, pixelFill, pixelEdge)
    * apertureCoverage1d(sourceY, scaleY, pixelFill, pixelEdge);
}

export function outputSampleSourceCoordinate(hostPixel, outputPixels, sourcePixels) {
  return (hostPixel + 0.5) * sourcePixels / outputPixels;
}

export function averageApertureCoverage(outputWidth, outputHeight, sourceWidth, sourceHeight,
  pixelFill = 0.875, pixelEdge = 1) {
  const scaleX = outputWidth / sourceWidth;
  const scaleY = outputHeight / sourceHeight;
  let total = 0;
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = outputSampleSourceCoordinate(y, outputHeight, sourceHeight);
    const coverageY = apertureCoverage1d(sourceY, scaleY, pixelFill, pixelEdge);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = outputSampleSourceCoordinate(x, outputWidth, sourceWidth);
      total += coverageY * apertureCoverage1d(sourceX, scaleX, pixelFill, pixelEdge);
    }
  }
  return total / (outputWidth * outputHeight);
}

export function shadowEnergySample(sourceX, sourceY, scaleX, scaleY, options = {}) {
  const {
    pixelFill = 0.875,
    pixelEdge = 1,
    offsetX = 0.11,
    offsetY = 0.13,
  } = options;
  const shadowMask = apertureCoverage2d(
    sourceX - offsetX,
    sourceY - offsetY,
    scaleX,
    scaleY,
    pixelFill,
    pixelEdge,
  );
  const jointX = jointApertureCoverage1d(
    sourceX, offsetX, scaleX, pixelFill, pixelEdge,
  );
  const jointY = jointApertureCoverage1d(
    sourceY, offsetY, scaleY, pixelFill, pixelEdge,
  );
  return clamp(shadowMask - jointX * jointY);
}

export function jointApertureCoverage1d(sourceCoordinate, shadowOffset,
  hostPixelsPerSourcePixel, pixelFill = 0.875, pixelEdge = 1) {
  const footprint = Math.max(
    Math.max(pixelEdge, 0.001) / Math.max(hostPixelsPerSourcePixel, 0.0001),
    0.0001,
  );
  const apertureLow = 0.5 - pixelFill * 0.5;
  const apertureHigh = 0.5 + pixelFill * 0.5;
  const sampleLow = sourceCoordinate - footprint * 0.5;
  const sampleHigh = sourceCoordinate + footprint * 0.5;
  const activeBase = Math.floor(sourceCoordinate);
  const shadowBase = Math.floor(sourceCoordinate - shadowOffset);
  let overlap = 0;
  for (let activePeriod = -1; activePeriod <= 1; activePeriod += 1) {
    const activeLow = activeBase + activePeriod + apertureLow;
    const activeHigh = activeBase + activePeriod + apertureHigh;
    for (let shadowPeriod = -1; shadowPeriod <= 1; shadowPeriod += 1) {
      const shadowLow = shadowBase + shadowPeriod + shadowOffset + apertureLow;
      const shadowHigh = shadowBase + shadowPeriod + shadowOffset + apertureHigh;
      overlap += Math.max(
        Math.min(sampleHigh, activeHigh, shadowHigh)
          - Math.max(sampleLow, activeLow, shadowLow),
        0,
      );
    }
  }
  return clamp(overlap / footprint);
}
