import {
  effectiveDriveCode,
  PANEL_FRAME_SECONDS,
  stepResidualDc,
} from "./drive-retention.mjs";
import { scanEvent, sourcePairForEvent } from "./scan-timing.mjs";
import {
  analyticRate,
  rateToAlpha,
} from "./gtg-response.mjs";
import { clamp, srgbDecodeChannel } from "./color-pipeline.mjs";

export const BALANCED_DRIVE = Object.freeze({
  driveDcOffset: 0,
  adsorptionRatePerSecond: 0,
  desorptionRatePerSecond: 0,
  driveCodeCoupling: 0,
});

export function opticalToCode(optical, eotf = (code) => srgbDecodeChannel(code / 31)) {
  const value = clamp(optical);
  for (let index = 0; index < 31; index += 1) {
    const low = eotf(index);
    const high = eotf(index + 1);
    if (value <= high) {
      return index + clamp((value - low) / Math.max(high - low, 1e-12));
    }
  }
  return 31;
}

export function integrateResidualDc(state, seconds, drive = BALANCED_DRIVE) {
  return stepResidualDc({
    state,
    driveDcOffset: drive.driveDcOffset,
    adsorptionRatePerSecond: drive.adsorptionRatePerSecond,
    desorptionRatePerSecond: drive.desorptionRatePerSecond,
    dtSeconds: seconds,
  });
}

export function integrateOptical(
  panel,
  target,
  residualDc,
  seconds,
  drive = BALANCED_DRIVE,
  polarity = 1,
) {
  const from = panel.map((value) => opticalToCode(value));
  return panel.map((value, channel) => {
    const effectiveCode = effectiveDriveCode({
      sourceCode: target[channel] / 31,
      polarity,
      driveDcOffset: drive.driveDcOffset,
      residualDcState: residualDc,
      driveCodeCoupling: drive.driveCodeCoupling,
    });
    const effectiveTarget = srgbDecodeChannel(effectiveCode);
    const alpha = rateToAlpha(analyticRate(from[channel], target[channel]), seconds);
    return clamp(value + (effectiveTarget - value) * alpha);
  });
}

export function integrateSegment(
  state,
  target,
  seconds,
  drive = BALANCED_DRIVE,
  polarity = 1,
) {
  const residualDc = integrateResidualDc(state.residualDc, seconds, drive);
  return {
    panel: integrateOptical(state.panel, target, residualDc, seconds, drive, polarity),
    residualDc,
  };
}

export function integrateScanoutFrame(
  state,
  previousTarget,
  currentTarget,
  sourceRow,
  baked = true,
  drive = BALANCED_DRIVE,
  polarity = 1,
  timing = {},
) {
  if (!baked) {
    return integrateSegment(state, currentTarget, PANEL_FRAME_SECONDS, drive, polarity);
  }

  const event = scanEvent({
    row: sourceRow,
    latchOffsetLines: timing.latchOffsetLines ?? 0.5,
    opticalDelaySeconds: timing.opticalDelaySeconds ?? 0,
  });
  const pair = sourcePairForEvent({
    current: currentTarget,
    previous: previousTarget,
    older: timing.olderTarget ?? previousTarget,
    olderAvailable: timing.olderAvailable ?? true,
    sourceFrameOffset: event.sourceFrameOffset,
  });
  if (pair.oldTarget.every((value, channel) => value === pair.newTarget[channel])) {
    return integrateSegment(state, pair.newTarget, PANEL_FRAME_SECONDS, drive, polarity);
  }

  const firstSeconds = event.beforeOpticalSeconds;
  const secondSeconds = event.afterOpticalSeconds;
  const residualAtLatch = integrateResidualDc(state.residualDc, firstSeconds, drive);
  const residualAtFrameEnd = integrateResidualDc(residualAtLatch, secondSeconds, drive);
  const splitAtLatch = integrateOptical(
    state.panel,
    pair.oldTarget,
    residualAtLatch,
    firstSeconds,
    drive,
    polarity,
  );
  const splitAtEnd = integrateOptical(
    splitAtLatch,
    pair.newTarget,
    residualAtFrameEnd,
    secondSeconds,
    drive,
    polarity,
  );
  const singleAtEnd = integrateOptical(
    state.panel,
    pair.newTarget,
    residualAtFrameEnd,
    PANEL_FRAME_SECONDS,
    drive,
    polarity,
  );
  return {
    panel: splitAtEnd.map((value, channel) => (
      pair.oldTarget[channel] === pair.newTarget[channel] ? singleAtEnd[channel] : value
    )),
    residualDc: residualAtFrameEnd,
  };
}
