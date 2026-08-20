import {
  effectiveDriveCode,
  PANEL_FRAME_SECONDS,
  spatialDriveExcitation,
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
  spatialRetentionEnabled: true,
  spatialCodeWeight: 0.5,
  polarityDriveWeight: 0.25,
});

export function excitationForTarget(target, drive = BALANCED_DRIVE, polarity = 1) {
  return spatialDriveExcitation({
    sourceRgb555: target,
    polarity,
    driveDcOffset: drive.driveDcOffset,
    spatialRetentionEnabled: drive.spatialRetentionEnabled ?? false,
    codeWeight: drive.spatialCodeWeight ?? 0.5,
    polarityWeight: drive.polarityDriveWeight ?? 0.25,
  });
}

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

export function integrateSpatialResidualDc(
  state,
  target,
  seconds,
  drive = BALANCED_DRIVE,
  polarity = 1,
) {
  return stepResidualDc({
    state,
    driveDcOffset: excitationForTarget(target, drive, polarity),
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
  const excitation = excitationForTarget(target, drive, polarity);
  return panel.map((value, channel) => {
    const effectiveCode = effectiveDriveCode({
      sourceCode: target[channel] / 31,
      polarity,
      driveDcOffset: drive.driveDcOffset,
      driveExcitation: excitation,
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
  const residualDc = integrateSpatialResidualDc(
    state.residualDc,
    target,
    seconds,
    drive,
    polarity,
  );
  return {
    panel: integrateOptical(state.panel, target, residualDc, seconds, drive, polarity),
    residualDc,
  };
}

export function integrateElectricalUntil({
  state,
  oldTarget,
  newTarget,
  polarity,
  latchSeconds,
  endSeconds,
  drive = BALANCED_DRIVE,
}) {
  const boundedEnd = Math.max(0, Math.min(PANEL_FRAME_SECONDS, endSeconds));
  const boundedLatch = Math.max(0, Math.min(PANEL_FRAME_SECONDS, latchSeconds));
  const oldSeconds = Math.min(boundedEnd, boundedLatch);
  const newSeconds = Math.max(0, boundedEnd - boundedLatch);
  const atLatch = integrateSpatialResidualDc(
    state,
    oldTarget,
    oldSeconds,
    drive,
    polarity,
  );
  return integrateSpatialResidualDc(
    atLatch,
    newTarget,
    newSeconds,
    drive,
    polarity,
  );
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
  const residualAtOptical = integrateElectricalUntil({
    state: state.residualDc,
    oldTarget: previousTarget,
    newTarget: currentTarget,
    polarity,
    latchSeconds: event.latchSeconds,
    endSeconds: event.opticalTimeInFrame,
    drive,
  });
  const residualAtFrameEnd = integrateElectricalUntil({
    state: state.residualDc,
    oldTarget: previousTarget,
    newTarget: currentTarget,
    polarity,
    latchSeconds: event.latchSeconds,
    endSeconds: PANEL_FRAME_SECONDS,
    drive,
  });
  if (pair.oldTarget.every((value, channel) => value === pair.newTarget[channel])) {
    return {
      panel: integrateOptical(
        state.panel,
        pair.newTarget,
        residualAtFrameEnd,
        PANEL_FRAME_SECONDS,
        drive,
        polarity,
      ),
      residualDc: residualAtFrameEnd,
    };
  }

  const firstSeconds = event.beforeOpticalSeconds;
  const secondSeconds = event.afterOpticalSeconds;
  const splitAtLatch = integrateOptical(
    state.panel,
    pair.oldTarget,
    residualAtOptical,
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
