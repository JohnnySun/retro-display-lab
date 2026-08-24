// Nintendo CGB-001 WS6 conservative aperture reference.
//
// The accepted geometry is deliberately minimal: a left-to-right RGB period
// with equal thirds and no claimed inactive area.  The three rectangles are
// integrated over the host-pixel footprint, rather than point-sampled.  This
// makes the result invariant to integer/fractional scale and viewport phase.
// Fill-factor, notches, bus masks, MRS grain, cover-lens tint, and glare remain
// unresolved and are not hidden in these equations.

export const CGB_APERTURE_EQUATION_ID = "CGB-WS6-EQUAL-THIRD-RGB-FOOTPRINT-V1";

// Exact inverse of the WS1 XYZ-to-linear-sRGB matrix.  Keeping both matrices
// here freezes the model-space decomposition used by the future Shader.  This
// is an energy-preserving presentation decomposition, not a measurement of the
// three microscopic color-filter spectra.
export const XYZ_TO_LINEAR_SRGB = Object.freeze([
  Object.freeze([3.2406255, -1.537208, -0.4986286]),
  Object.freeze([-0.9689307, 1.8757561, 0.0415175]),
  Object.freeze([0.0557101, -0.2040211, 1.0569959]),
]);

export const LINEAR_SRGB_TO_XYZ = Object.freeze([
  Object.freeze([0.4123999971730992, 0.3576000026510085, 0.18050001435233873]),
  Object.freeze([0.21259999073612257, 0.7151999842346092, 0.07220001553015049]),
  Object.freeze([0.019300017045913293, 0.11920004192621718, 0.9505000471041641]),
]);

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function vector3(name, value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must be a finite three-component array`);
  }
  return value;
}

function multiply3(matrix, vector) {
  return matrix.map((row) => row.reduce(
    (sum, coefficient, channel) => sum + coefficient * vector[channel],
    0,
  ));
}

export function xyzToLinearSrgb(xyz) {
  return multiply3(XYZ_TO_LINEAR_SRGB, vector3("xyz", xyz));
}

export function linearSrgbToXyz(linearRgb) {
  return multiply3(LINEAR_SRGB_TO_XYZ, vector3("linearRgb", linearRgb));
}

// Integral of the indicator for [intervalLow, intervalHigh) repeated every
// unit period over [low, high].  The implementation is analytic and remains
// stable for negative viewport phases.
export function periodicIntervalLength(low, high, intervalLow, intervalHigh) {
  const a = finite("low", low);
  const b = finite("high", high);
  const start = finite("intervalLow", intervalLow);
  const end = finite("intervalHigh", intervalHigh);
  if (!(b >= a)) throw new RangeError("high must be greater than or equal to low");
  if (!(start >= 0 && end >= start && end <= 1)) {
    throw new RangeError("periodic interval must be inside [0, 1]");
  }
  if (a === b || start === end) return 0;

  const width = end - start;
  const primitive = (position) => {
    const period = Math.floor(position);
    const phase = position - period;
    return period * width + Math.min(Math.max(phase - start, 0), width);
  };
  return primitive(b) - primitive(a);
}

export function rgbStripeCoverage({
  sourceX,
  hostPixelsPerSourcePixel,
  activeFill = 1,
}) {
  const center = finite("sourceX", sourceX);
  const scale = finite("hostPixelsPerSourcePixel", hostPixelsPerSourcePixel);
  const fill = finite("activeFill", activeFill);
  if (!(scale > 0)) throw new RangeError("hostPixelsPerSourcePixel must be positive");
  if (!(fill > 0 && fill <= 1)) throw new RangeError("activeFill must be in (0, 1]");

  const footprint = 1 / scale;
  const low = center - footprint / 2;
  const high = center + footprint / 2;
  const stripeWidth = fill / 3;
  const channels = [0, 1, 2].map((channel) => (
    periodicIntervalLength(low, high, channel * stripeWidth, (channel + 1) * stripeWidth)
      / footprint
  ));
  const gap = periodicIntervalLength(low, high, fill, 1) / footprint;
  return Object.freeze({
    channels: Object.freeze(channels),
    gap,
    sum: channels.reduce((total, value) => total + value, gap),
    footprint,
  });
}

export function composeRgbAperture({
  sourceLinearRgb,
  sourceX,
  hostPixelsPerSourcePixel,
  activeFill = 1,
  gapLinearRgb = [0, 0, 0],
  enabled = true,
}) {
  const source = vector3("sourceLinearRgb", sourceLinearRgb);
  if (!enabled) return [...source];
  const gapColor = vector3("gapLinearRgb", gapLinearRgb);
  const coverage = rgbStripeCoverage({ sourceX, hostPixelsPerSourcePixel, activeFill });
  const normalization = 3 / activeFill;
  return source.map((value, channel) => (
    value * normalization * coverage.channels[channel]
      + gapColor[channel] * coverage.gap
  ));
}

// Float32 transcription of the future-Shader arithmetic.  It shares the exact
// analytic coverage because the Shader will implement the same floor/clamp
// primitive; the final multiply/add sequence is rounded explicitly here.
export function composeRgbApertureFloat32(options) {
  const source = vector3("sourceLinearRgb", options.sourceLinearRgb).map(Math.fround);
  if (options.enabled === false) return source;
  const gap = vector3("gapLinearRgb", options.gapLinearRgb ?? [0, 0, 0]).map(Math.fround);
  const fill = Math.fround(options.activeFill ?? 1);
  const coverage = rgbStripeCoverage({
    sourceX: Math.fround(options.sourceX),
    hostPixelsPerSourcePixel: Math.fround(options.hostPixelsPerSourcePixel),
    activeFill: fill,
  });
  const normalization = Math.fround(Math.fround(3) / fill);
  return source.map((value, channel) => Math.fround(
    Math.fround(value * Math.fround(normalization * Math.fround(coverage.channels[channel])))
      + Math.fround(gap[channel] * Math.fround(coverage.gap)),
  ));
}
