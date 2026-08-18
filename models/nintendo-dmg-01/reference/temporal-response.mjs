export const DMG_REFRESH_HZ = 59.7275;
export const DMG_FRAME_SECONDS = 1 / DMG_REFRESH_HZ;
export const DMG_DRIVEN_STATES = Object.freeze([0.25, 0.5, 0.75, 1]);

export function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function frameAlphaToRate(alpha, frameSeconds = DMG_FRAME_SECONDS) {
  const bounded = clamp(finite("alpha", alpha), 0, 1 - 1e-12);
  return -Math.log1p(-bounded) / Math.max(Number.EPSILON, finite("frameSeconds", frameSeconds));
}

export function rateToAlpha(ratePerSecond, seconds) {
  return -Math.expm1(-Math.max(0, finite("ratePerSecond", ratePerSecond))
    * Math.max(0, finite("seconds", seconds)));
}

export function stepFirstOrder(value, target, ratePerSecond, seconds) {
  return value + (target - value) * rateToAlpha(ratePerSecond, seconds);
}

export function intermediateShadeWeight(index) {
  const state = DMG_DRIVEN_STATES[clamp(Math.round(index), 0, 3)];
  return clamp(1 - Math.abs(state - 0.625) / 0.375);
}

export function pairRateScale(fromIndex, toIndex, family) {
  const distance = Math.abs(toIndex - fromIndex) / 3;
  const nearWeight = (1 - distance) ** 2;
  const middleWeight = Math.max(
    intermediateShadeWeight(fromIndex),
    intermediateShadeWeight(toIndex),
  );
  return (1 - family.distanceDrag * nearWeight)
    * (1 - family.intermediateDrag * middleWeight);
}

export function mixedProgress(ratePerSecond, seconds, slowTailWeight, slowRateScale) {
  return 1 - (1 - slowTailWeight) * Math.exp(-ratePerSecond * seconds)
    - slowTailWeight * Math.exp(-ratePerSecond * slowRateScale * seconds);
}

export function solveRateForT90(t90Seconds, slowTailWeight, slowRateScale) {
  const targetTime = finite("t90Seconds", t90Seconds);
  if (!(targetTime > 0)) throw new RangeError("t90Seconds must be positive");
  let low = 0;
  let high = 100_000;
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const rate = (low + high) / 2;
    if (mixedProgress(rate, targetTime, slowTailWeight, slowRateScale) < 0.9) low = rate;
    else high = rate;
  }
  return (low + high) / 2;
}

export function solveT90(ratePerSecond, slowTailWeight, slowRateScale) {
  let low = 0;
  let high = 10;
  while (mixedProgress(ratePerSecond, high, slowTailWeight, slowRateScale) < 0.9) high *= 2;
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const seconds = (low + high) / 2;
    if (mixedProgress(ratePerSecond, seconds, slowTailWeight, slowRateScale) < 0.9) low = seconds;
    else high = seconds;
  }
  return (low + high) / 2;
}

export function deriveFamily(candidate) {
  const ratio = finite("clearingToDarkeningT90Ratio", candidate.clearingToDarkeningT90Ratio);
  const combined = finite("combinedEndpointT90Seconds", candidate.combinedEndpointT90Seconds);
  const darkeningT90Seconds = combined / (1 + ratio);
  const clearingT90Seconds = combined - darkeningT90Seconds;
  const family = Object.freeze({
    id: candidate.id,
    classification: candidate.classification,
    combinedEndpointT90Seconds: combined,
    clearingToDarkeningT90Ratio: ratio,
    darkeningT90Seconds,
    clearingT90Seconds,
    slowTailWeight: finite("slowTailWeight", candidate.slowTailWeight),
    slowRateScale: finite("slowRateScale", candidate.slowRateScale),
    intermediateDrag: finite("intermediateDrag", candidate.intermediateDrag),
    distanceDrag: finite("distanceDrag", candidate.distanceDrag),
    rationale: candidate.rationale,
  });
  const darkeningRatePerSecond = solveRateForT90(
    family.darkeningT90Seconds,
    family.slowTailWeight,
    family.slowRateScale,
  );
  const clearingRatePerSecond = solveRateForT90(
    family.clearingT90Seconds,
    family.slowTailWeight,
    family.slowRateScale,
  );
  return Object.freeze({
    ...family,
    darkeningRatePerSecond,
    clearingRatePerSecond,
    referenceParameters: Object.freeze({
      DarkenResponse: rateToAlpha(darkeningRatePerSecond, DMG_FRAME_SECONDS),
      ClearResponse: rateToAlpha(clearingRatePerSecond, DMG_FRAME_SECONDS),
      SlowTail: family.slowTailWeight,
      SlowRateScale: family.slowRateScale,
      GrayDrag: family.intermediateDrag,
      DistanceDrag: family.distanceDrag,
    }),
  });
}

export function transitionT90Seconds(family, fromIndex, toIndex) {
  if (fromIndex === toIndex) return 0;
  const scale = pairRateScale(fromIndex, toIndex, family);
  const baseRate = toIndex > fromIndex
    ? family.darkeningRatePerSecond
    : family.clearingRatePerSecond;
  return solveT90(
    baseRate * scale,
    family.slowTailWeight,
    family.slowRateScale,
  );
}

export function initialTemporalState(index) {
  const driveIndex = clamp(Math.round(index), 0, 3);
  const value = DMG_DRIVEN_STATES[driveIndex];
  return Object.freeze({
    fast: value,
    slow: value,
    displayed: value,
    targetIndex: driveIndex,
    originIndex: driveIndex,
  });
}

export function stepTemporal(state, requestedTargetIndex, family, seconds) {
  const targetIndex = clamp(Math.round(requestedTargetIndex), 0, 3);
  const changed = targetIndex !== state.targetIndex;
  const originIndex = changed ? state.targetIndex : state.originIndex;
  const target = DMG_DRIVEN_STATES[targetIndex];
  const scale = pairRateScale(originIndex, targetIndex, family);
  const baseRate = target > state.displayed
    ? family.darkeningRatePerSecond
    : family.clearingRatePerSecond;
  const fast = stepFirstOrder(state.fast, target, baseRate * scale, seconds);
  const slow = stepFirstOrder(
    state.slow,
    target,
    baseRate * scale * family.slowRateScale,
    seconds,
  );
  return Object.freeze({
    fast,
    slow,
    displayed: fast * (1 - family.slowTailWeight) + slow * family.slowTailWeight,
    targetIndex,
    originIndex,
  });
}

export function partitionError(initialState, targetIndex, family, seconds, partitions) {
  const oneStep = stepTemporal(initialState, targetIndex, family, seconds);
  let partitioned = initialState;
  for (let index = 0; index < partitions; index += 1) {
    partitioned = stepTemporal(partitioned, targetIndex, family, seconds / partitions);
  }
  return Math.max(
    Math.abs(oneStep.fast - partitioned.fast),
    Math.abs(oneStep.slow - partitioned.slow),
    Math.abs(oneStep.displayed - partitioned.displayed),
  );
}
