import { pathToFileURL } from "node:url";

export const GTG_SCHEMA_VERSION = "1.0.0";
export const GTG_FIT_VERSION = "monotone-first-order-rate-field-v1";
export const GTG_CHANNELS = Object.freeze(["r", "g", "b"]);
export const GTG_CODE_COUNT = 32;
export const GTG_FRAME_SECONDS = (1_232 * 228) / 16_777_216;
export const GTG_RATE_MIN = 1;
export const GTG_RATE_MAX = 1_024;

export const GTG_ANALYTIC_PRIOR = Object.freeze({
  riseFrameAlpha: 0.620,
  fallFrameAlpha: 0.450,
  nearTransitionDrag: 0.250,
  midGrayDrag: 0.200,
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function analyticFrameAlpha(fromCode, toCode, prior = GTG_ANALYTIC_PRIOR) {
  const from = clamp(finite("fromCode", fromCode), 0, 31) / 31;
  const to = clamp(finite("toCode", toCode), 0, 31) / 31;
  const distance = Math.abs(to - from);
  const nearWeight = (1 - distance) ** 2;
  const midpoint = 0.5 * (from + to);
  const middleWeight = 4 * midpoint * (1 - midpoint) * nearWeight;
  const base = to >= from ? prior.riseFrameAlpha : prior.fallFrameAlpha;
  return clamp(
    base
      * (1 - prior.nearTransitionDrag * nearWeight)
      * (1 - prior.midGrayDrag * middleWeight),
    0.025,
    1 - 1e-7,
  );
}

export function frameAlphaToRate(frameAlpha, frameSeconds = GTG_FRAME_SECONDS) {
  const alpha = clamp(finite("frameAlpha", frameAlpha), 0, 1 - 1e-12);
  const seconds = Math.max(Number.EPSILON, finite("frameSeconds", frameSeconds));
  return -Math.log1p(-alpha) / seconds;
}

export function rateToAlpha(ratePerSecond, seconds) {
  const rate = Math.max(0, finite("ratePerSecond", ratePerSecond));
  const dt = Math.max(0, finite("seconds", seconds));
  return -Math.expm1(-rate * dt);
}

export function stepFirstOrder(value, target, ratePerSecond, seconds) {
  const alpha = rateToAlpha(ratePerSecond, seconds);
  return value + (target - value) * alpha;
}

export function analyticRate(fromCode, toCode, prior = GTG_ANALYTIC_PRIOR) {
  return frameAlphaToRate(analyticFrameAlpha(fromCode, toCode, prior));
}

function crossingTime(times, values, threshold) {
  for (let index = 1; index < values.length; index += 1) {
    const a = values[index - 1];
    const b = values[index];
    if ((a <= threshold && b >= threshold) || (a >= threshold && b <= threshold)) {
      if (a === b) return times[index];
      const fraction = (threshold - a) / (b - a);
      return times[index - 1] + fraction * (times[index] - times[index - 1]);
    }
  }
  return null;
}

export function deriveWaveformMetrics(timesSeconds, opticalResponse, settlingTolerance = 0.02) {
  if (!Array.isArray(timesSeconds) || !Array.isArray(opticalResponse)
      || timesSeconds.length !== opticalResponse.length || timesSeconds.length < 2) {
    throw new TypeError("timesSeconds and opticalResponse must be equal arrays with at least two values");
  }
  const times = timesSeconds.map((value) => finite("sample time", value));
  const values = opticalResponse.map((value) => finite("optical response", value));
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] <= times[index - 1]) throw new RangeError("sample times must be strictly increasing");
  }
  let settlingTimeSeconds = null;
  for (let index = 0; index < values.length; index += 1) {
    if (values.slice(index).every((value) => Math.abs(1 - value) <= settlingTolerance)) {
      settlingTimeSeconds = times[index];
      break;
    }
  }
  let monotonicViolations = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] + 1e-6 < values[index - 1]) monotonicViolations += 1;
  }
  const t10 = crossingTime(times, values, 0.1);
  const t50 = crossingTime(times, values, 0.5);
  const t90 = crossingTime(times, values, 0.9);
  return Object.freeze({
    t10Seconds: t10,
    t50Seconds: t50,
    t90Seconds: t90,
    t10To90Seconds: t10 === null || t90 === null ? null : t90 - t10,
    settlingTolerance,
    settlingTimeSeconds,
    overshoot: Math.max(0, Math.max(...values) - 1),
    undershoot: Math.max(0, -Math.min(...values)),
    monotonicViolations,
  });
}

function fitError(times, values, rate) {
  const errors = values.map((value, index) => rateToAlpha(rate, times[index]) - value);
  return {
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
    maxAbsError: Math.max(...errors.map(Math.abs)),
  };
}

export function fitFirstOrder(timesSeconds, opticalResponse) {
  const metrics = deriveWaveformMetrics(timesSeconds, opticalResponse);
  const times = timesSeconds;
  const values = opticalResponse;
  let low = Math.log(0.01);
  let high = Math.log(100_000);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = high - ratio * (high - low);
  let d = low + ratio * (high - low);
  for (let iteration = 0; iteration < 96; iteration += 1) {
    const cError = fitError(times, values, Math.exp(c)).rmse;
    const dError = fitError(times, values, Math.exp(d)).rmse;
    if (cError <= dError) {
      high = d;
      d = c;
      c = high - ratio * (high - low);
    } else {
      low = c;
      c = d;
      d = low + ratio * (high - low);
    }
  }
  const ratePerSecond = Math.exp(0.5 * (low + high));
  const error = fitError(times, values, ratePerSecond);
  const runtimeEligible = metrics.monotonicViolations === 0
    && metrics.overshoot <= 0.02
    && metrics.undershoot <= 0.02
    && error.rmse <= 0.02
    && error.maxAbsError <= 0.05;
  return Object.freeze({
    model: "normalizedProgress=1-exp(-rate*t)",
    ratePerSecond,
    ...error,
    runtimeEligible,
    rejectionReasons: [
      ...(metrics.monotonicViolations ? ["non-monotone"] : []),
      ...(metrics.overshoot > 0.02 ? ["overshoot"] : []),
      ...(metrics.undershoot > 0.02 ? ["undershoot"] : []),
      ...(error.rmse > 0.02 ? ["rmse"] : []),
      ...(error.maxAbsError > 0.05 ? ["max-absolute-error"] : []),
    ],
    metrics,
  });
}

export function encodeRate16(ratePerSecond) {
  const rate = clamp(finite("ratePerSecond", ratePerSecond), GTG_RATE_MIN, GTG_RATE_MAX);
  const normalized = Math.log2(rate / GTG_RATE_MIN) / Math.log2(GTG_RATE_MAX / GTG_RATE_MIN);
  return Math.round(clamp(normalized, 0, 1) * 65_535);
}

export function decodeRate16(encoded) {
  const code = clamp(Math.round(finite("encoded", encoded)), 0, 65_535);
  const normalized = code / 65_535;
  return GTG_RATE_MIN * (GTG_RATE_MAX / GTG_RATE_MIN) ** normalized;
}

export function sampleRateField({ fromCode, toCode, channel, getCell, fallbackRate }) {
  if (!GTG_CHANNELS.includes(channel)) throw new RangeError("channel must be r, g, or b");
  const from = clamp(finite("fromCode", fromCode), 0, 31);
  const to = clamp(finite("toCode", toCode), 0, 31);
  const from0 = Math.floor(from);
  const from1 = Math.min(from0 + 1, 31);
  const to0 = Math.floor(to);
  const to1 = Math.min(to0 + 1, 31);
  const corners = [
    getCell(channel, from0, to0),
    getCell(channel, from0, to1),
    getCell(channel, from1, to0),
    getCell(channel, from1, to1),
  ];
  if (corners.some((cell) => !cell?.runtimeEligible)) {
    return Object.freeze({ ratePerSecond: fallbackRate, backend: "analytic-fallback" });
  }
  const fx = to - to0;
  const fy = from - from0;
  const top = corners[0].ratePerSecond * (1 - fx) + corners[1].ratePerSecond * fx;
  const bottom = corners[2].ratePerSecond * (1 - fx) + corners[3].ratePerSecond * fx;
  return Object.freeze({
    ratePerSecond: top * (1 - fy) + bottom * fy,
    backend: "table",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pairs = [[0, 31], [31, 0], [15, 16], [16, 15]];
  process.stdout.write(`${JSON.stringify({
    model: GTG_FIT_VERSION,
    frameSeconds: GTG_FRAME_SECONDS,
    analyticPrior: GTG_ANALYTIC_PRIOR,
    anchors: pairs.map(([fromCode, toCode]) => ({
      fromCode,
      toCode,
      frameAlpha: analyticFrameAlpha(fromCode, toCode),
      ratePerSecond: analyticRate(fromCode, toCode),
    })),
  }, null, 2)}\n`);
}
