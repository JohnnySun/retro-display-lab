export function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function responseFromRate(ratePerSecond, seconds) {
  if (!(ratePerSecond >= 0) || !(seconds >= 0)) {
    throw new RangeError("retention rate and elapsed seconds must be nonnegative");
  }
  return 1 - Math.exp(-ratePerSecond * seconds);
}

export function responseFromPerFrame(baseResponse, frameFraction, timeScale = 1) {
  return 1 - (1 - baseResponse) ** (frameFraction * timeScale);
}

export function integrateRetention(state, target, seconds, rates) {
  const current = clamp(state);
  const destination = clamp(target);
  const rate = destination > current
    ? rates.formationPerSecond
    : rates.releasePerSecond;
  return current + (destination - current) * responseFromRate(rate, seconds);
}

export function integrateRetentionFrame(state, target, frameFraction, parameters,
  timeScale = 1) {
  const current = clamp(state);
  const destination = clamp(target);
  const response = destination > current
    ? parameters.formationPerFrame
    : parameters.releasePerFrame;
  return current + (destination - current)
    * responseFromPerFrame(response, frameFraction, timeScale);
}

export function stickingVoltage(mobilityOverViscosity) {
  return Math.max(7.390426 * mobilityOverViscosity - 0.186987, 0);
}

export function opticalBias(state, target, mobilityOverViscosity, gainPerVolt) {
  return Math.max(clamp(state) - clamp(target), 0)
    * stickingVoltage(mobilityOverViscosity) * gainPerVolt;
}
