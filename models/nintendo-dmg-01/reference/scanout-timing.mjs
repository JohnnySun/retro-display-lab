export function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function scanConstants(record) {
  const frameSeconds = 1 / record.frame.nominalRefreshHz;
  const lineSeconds = frameSeconds / record.frame.totalRows;
  return Object.freeze({
    frameSeconds,
    lineSeconds,
    totalRows: record.frame.totalRows,
    visibleRows: record.frame.visibleRows,
  });
}

export function scanEvent(record, row, latchOffsetLines = 1) {
  const timing = scanConstants(record);
  const boundedRow = clamp(Math.trunc(row), 0, timing.visibleRows - 1);
  const rowStartSeconds = boundedRow * timing.lineSeconds;
  const latchSeconds = rowStartSeconds
    + clamp(latchOffsetLines) * timing.lineSeconds;
  return Object.freeze({
    row: boundedRow,
    rowStartSeconds,
    latchSeconds,
    beforeLatchFraction: latchSeconds / timing.frameSeconds,
    afterLatchFraction: 1 - latchSeconds / timing.frameSeconds,
  });
}

export function lookup(values, bins, condition, driveIndex, coordinate) {
  const position = clamp(coordinate) * (bins - 1);
  const low = Math.min(Math.floor(position), bins - 2);
  const fraction = position - low;
  const base = condition * 4 * bins + driveIndex * bins + low;
  return values[base] + (values[base + 1] - values[base]) * fraction;
}

export function integrateDirectorSegment({
  coordinate,
  driveIndex,
  frameFraction,
  condition = 1,
  drift,
  bins = 65,
}) {
  return clamp(coordinate + lookup(
    drift,
    bins,
    condition,
    driveIndex,
    coordinate,
  ) * clamp(frameFraction));
}

export function integrateIonicSegment({
  charge,
  driveIndex,
  frameFraction,
  chargeResponse,
  releaseResponse,
  timeScale = 1,
}) {
  const drive = driveIndex / 3;
  const base = drive > charge ? chargeResponse : releaseResponse;
  const response = 1 - (1 - base) ** (clamp(frameFraction) * timeScale);
  return charge + (drive - charge) * response;
}

export function integrateScanoutFrame({
  record,
  row,
  coordinate,
  ionicCharge,
  previousDriveIndex,
  currentDriveIndex,
  drift,
  bins = 65,
  condition = 1,
  latchOffsetLines = 1,
  bakedScanout = true,
  chargeResponse = 0.000126777389,
  releaseResponse = 0.000007115625,
  timeScale = 1,
}) {
  if (!bakedScanout || previousDriveIndex === currentDriveIndex) {
    return {
      coordinate: integrateDirectorSegment({
        coordinate,
        driveIndex: currentDriveIndex,
        frameFraction: 1,
        condition,
        drift,
        bins,
      }),
      ionicCharge: integrateIonicSegment({
        charge: ionicCharge,
        driveIndex: currentDriveIndex,
        frameFraction: 1,
        chargeResponse,
        releaseResponse,
        timeScale,
      }),
    };
  }
  const event = scanEvent(record, row, latchOffsetLines);
  const before = integrateDirectorSegment({
    coordinate,
    driveIndex: previousDriveIndex,
    frameFraction: event.beforeLatchFraction,
    condition,
    drift,
    bins,
  });
  const atEnd = integrateDirectorSegment({
    coordinate: before,
    driveIndex: currentDriveIndex,
    frameFraction: event.afterLatchFraction,
    condition,
    drift,
    bins,
  });
  const ionicAtLatch = integrateIonicSegment({
    charge: ionicCharge,
    driveIndex: previousDriveIndex,
    frameFraction: event.beforeLatchFraction,
    chargeResponse,
    releaseResponse,
    timeScale,
  });
  return {
    coordinate: atEnd,
    ionicCharge: integrateIonicSegment({
      charge: ionicAtLatch,
      driveIndex: currentDriveIndex,
      frameFraction: event.afterLatchFraction,
      chargeResponse,
      releaseResponse,
      timeScale,
    }),
  };
}
