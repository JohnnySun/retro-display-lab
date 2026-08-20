import { clamp } from "./color-pipeline.mjs";

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function firstOrderState(start, target, ratePerSecond, seconds) {
  const x0 = finite("start", start);
  const q = finite("target", target);
  const rate = Math.max(0, finite("ratePerSecond", ratePerSecond));
  const dt = Math.max(0, finite("seconds", seconds));
  return q + (x0 - q) * Math.exp(-rate * dt);
}

export function firstOrderIntegral(start, target, ratePerSecond, seconds) {
  const x0 = finite("start", start);
  const q = finite("target", target);
  const rate = Math.max(0, finite("ratePerSecond", ratePerSecond));
  const dt = Math.max(0, finite("seconds", seconds));
  if (dt === 0) return 0;
  if (rate < 1e-12) return x0 * dt;
  return q * dt + (x0 - q) * (-Math.expm1(-rate * dt)) / rate;
}

export function firstOrderAverage(start, target, ratePerSecond, seconds) {
  const dt = Math.max(0, finite("seconds", seconds));
  return dt === 0 ? finite("start", start)
    : firstOrderIntegral(start, target, ratePerSecond, dt) / dt;
}

export function compositeSimpsonFirstOrder(
  start,
  target,
  ratePerSecond,
  seconds,
  subintervals = 4096,
) {
  const count = Math.max(2, Math.trunc(subintervals));
  const evenCount = count % 2 === 0 ? count : count + 1;
  const dt = Math.max(0, finite("seconds", seconds));
  if (dt === 0) return 0;
  const step = dt / evenCount;
  let sum = firstOrderState(start, target, ratePerSecond, 0)
    + firstOrderState(start, target, ratePerSecond, dt);
  for (let index = 1; index < evenCount; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4)
      * firstOrderState(start, target, ratePerSecond, index * step);
  }
  return sum * step / 3;
}

export function opticalToContinuousCode(optical, eotfByCode, channel) {
  const value = clamp(optical);
  for (let code = 0; code < 31; code += 1) {
    const low = eotfByCode[code][channel];
    const high = eotfByCode[code + 1][channel];
    if (value <= high) return code + clamp((value - low) / Math.max(high - low, 1e-15));
  }
  return 31;
}

export function integrateOpticalExposureSegment({
  start,
  target,
  ratePerSecond,
  seconds,
}) {
  const endpoint = firstOrderState(start, target, ratePerSecond, seconds);
  const integral = firstOrderIntegral(start, target, ratePerSecond, seconds);
  return { endpoint: clamp(endpoint), integral };
}

export function integrateScannedExposure({
  initialPanel,
  oldTargetRgb555,
  newTargetRgb555,
  opticalOnsetSeconds,
  frameSeconds,
  eotfByCode,
  rateProvider,
}) {
  const firstSeconds = clamp(opticalOnsetSeconds, 0, frameSeconds);
  const secondSeconds = frameSeconds - firstSeconds;
  const endpoint = [];
  const average = [];
  const segments = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const start = initialPanel[channel];
    const oldCode = oldTargetRgb555[channel];
    const newCode = newTargetRgb555[channel];
    if (oldCode === newCode) {
      const fromCode = opticalToContinuousCode(start, eotfByCode, channel);
      const rate = rateProvider(fromCode, newCode, channel);
      const result = integrateOpticalExposureSegment({
        start,
        target: eotfByCode[newCode][channel],
        ratePerSecond: rate,
        seconds: frameSeconds,
      });
      endpoint[channel] = result.endpoint;
      average[channel] = result.integral / frameSeconds;
      segments.push({ channel, kind: "single", seconds: frameSeconds, fromCode, toCode: newCode, rate });
      continue;
    }
    const firstFromCode = opticalToContinuousCode(start, eotfByCode, channel);
    const firstRate = rateProvider(firstFromCode, oldCode, channel);
    const first = integrateOpticalExposureSegment({
      start,
      target: eotfByCode[oldCode][channel],
      ratePerSecond: firstRate,
      seconds: firstSeconds,
    });
    const secondFromCode = opticalToContinuousCode(first.endpoint, eotfByCode, channel);
    const secondRate = rateProvider(secondFromCode, newCode, channel);
    const second = integrateOpticalExposureSegment({
      start: first.endpoint,
      target: eotfByCode[newCode][channel],
      ratePerSecond: secondRate,
      seconds: secondSeconds,
    });
    endpoint[channel] = second.endpoint;
    average[channel] = (first.integral + second.integral) / frameSeconds;
    segments.push(
      { channel, kind: "before-optical", seconds: firstSeconds, fromCode: firstFromCode, toCode: oldCode, rate: firstRate },
      { channel, kind: "after-optical", seconds: secondSeconds, fromCode: secondFromCode, toCode: newCode, rate: secondRate },
    );
  }
  return { endpoint, average, segments };
}

export function applyStaticBacklight(nativeLinearRgb, relativeGain = 1) {
  const gain = Math.max(0, finite("relativeGain", relativeGain));
  return nativeLinearRgb.map((value) => value * gain);
}
