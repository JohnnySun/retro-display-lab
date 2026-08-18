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

export function opticalColor(state, paletteSrgb8) {
  if (!Array.isArray(paletteSrgb8) || paletteSrgb8.length !== 5) {
    throw new TypeError("DMG optical palette must contain five sRGB states");
  }
  const x = clamp(state) * 4;
  const low = Math.min(Math.floor(x), 3);
  const mix = x - low;
  return paletteSrgb8[low].map((value, channel) => {
    const a = srgbDecodeChannel(value / 255);
    const b = srgbDecodeChannel(paletteSrgb8[low + 1][channel] / 255);
    return srgbEncodeChannel(a + (b - a) * mix);
  });
}

export function contrastState(state, contrast = 1, bias = 0) {
  return clamp((state - 0.25) * contrast + 0.25 + bias);
}

export function apertureCoverage(cell, hostPixelsPerSourcePixel, pixelFill = 0.875) {
  const footprint = 1 / Math.max(hostPixelsPerSourcePixel, 0.0001);
  const low = 0.5 - pixelFill * 0.5;
  const high = 0.5 + pixelFill * 0.5;
  const sampleLow = cell - footprint * 0.5;
  const sampleHigh = cell + footprint * 0.5;
  const overlap = Math.max(Math.min(sampleHigh, high) - Math.max(sampleLow, low), 0);
  return clamp(overlap / footprint);
}

function srgb8ToLab(rgb) {
  const [r, g, b] = rgb.map((value) => srgbDecodeChannel(value / 255));
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (value) => (value > 216 / 24389
    ? Math.cbrt(value)
    : (24389 / 27 * value + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function degrees(radians) {
  const value = radians * 180 / Math.PI;
  return value < 0 ? value + 360 : value;
}

function radians(degreesValue) {
  return degreesValue * Math.PI / 180;
}

export function deltaE00Lab(labA, labB) {
  const [l1, a1, b1] = labA;
  const [l2, a2, b2] = labB;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const meanC7 = meanC ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + 25 ** 7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = c1Prime === 0 ? 0 : degrees(Math.atan2(b1, a1Prime));
  const h2Prime = c2Prime === 0 ? 0 : degrees(Math.atan2(b2, a2Prime));
  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;
  let deltaHDegrees = h2Prime - h1Prime;
  if (c1Prime * c2Prime === 0) deltaHDegrees = 0;
  else if (deltaHDegrees > 180) deltaHDegrees -= 360;
  else if (deltaHDegrees < -180) deltaHDegrees += 360;
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(radians(deltaHDegrees / 2));
  const meanLPrime = (l1 + l2) / 2;
  const meanCPrime = (c1Prime + c2Prime) / 2;
  let meanHPrime = h1Prime + h2Prime;
  if (c1Prime * c2Prime === 0) meanHPrime = h1Prime + h2Prime;
  else if (Math.abs(h1Prime - h2Prime) <= 180) meanHPrime /= 2;
  else if (meanHPrime < 360) meanHPrime = (meanHPrime + 360) / 2;
  else meanHPrime = (meanHPrime - 360) / 2;
  const t = 1
    - 0.17 * Math.cos(radians(meanHPrime - 30))
    + 0.24 * Math.cos(radians(2 * meanHPrime))
    + 0.32 * Math.cos(radians(3 * meanHPrime + 6))
    - 0.20 * Math.cos(radians(4 * meanHPrime - 63));
  const deltaTheta = 30 * Math.exp(-1 * (((meanHPrime - 275) / 25) ** 2));
  const meanLMinus50Squared = (meanLPrime - 50) ** 2;
  const sL = 1 + 0.015 * meanLMinus50Squared / Math.sqrt(20 + meanLMinus50Squared);
  const sC = 1 + 0.045 * meanCPrime;
  const sH = 1 + 0.015 * meanCPrime * t;
  const rC = 2 * Math.sqrt(meanCPrime ** 7 / (meanCPrime ** 7 + 25 ** 7));
  const rT = -rC * Math.sin(radians(2 * deltaTheta));
  const lTerm = deltaLPrime / sL;
  const cTerm = deltaCPrime / sC;
  const hTerm = deltaHPrime / sH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm);
}

export function deltaE00(rgbA, rgbB) {
  return deltaE00Lab(srgb8ToLab(rgbA), srgb8ToLab(rgbB));
}

export function srgbFloatTo8(rgb) {
  return rgb.map((value) => Math.round(clamp(value) * 255));
}
