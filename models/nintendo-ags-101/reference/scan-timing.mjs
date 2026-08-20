import { pathToFileURL } from "node:url";

export const GBA_MASTER_CLOCK_HZ = 16_777_216;
export const GBA_CYCLES_PER_LINE = 1_232;
export const GBA_TOTAL_LINES = 228;
export const GBA_VISIBLE_LINES = 160;
export const GBA_LINE_SECONDS = GBA_CYCLES_PER_LINE / GBA_MASTER_CLOCK_HZ;
export const GBA_FRAME_SECONDS = GBA_LINE_SECONDS * GBA_TOTAL_LINES;
export const GBA_FRAME_HZ = 1 / GBA_FRAME_SECONDS;
export const INVERSION_TOPOLOGIES = Object.freeze({
  FRAME_GLOBAL: 0,
  ROW_ALTERNATING: 1,
  COLUMN_ALTERNATING: 2,
  DOT_CHECKERBOARD: 3,
});

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function scanEvent({
  row,
  latchOffsetLines = 0.5,
  opticalDelaySeconds = 0,
}) {
  if (!Number.isInteger(row) || row < 0 || row >= GBA_VISIBLE_LINES) {
    throw new RangeError(`row must be an integer in [0, ${GBA_VISIBLE_LINES - 1}]`);
  }
  const latchOffset = clamp(finite("latchOffsetLines", latchOffsetLines), 0, 1);
  const opticalDelay = clamp(
    finite("opticalDelaySeconds", opticalDelaySeconds),
    0,
    GBA_FRAME_SECONDS,
  );
  const rowStartSeconds = row * GBA_LINE_SECONDS;
  const latchSeconds = rowStartSeconds + latchOffset * GBA_LINE_SECONDS;
  const opticalAbsoluteSeconds = latchSeconds + opticalDelay;
  const sourceFrameOffset = opticalAbsoluteSeconds >= GBA_FRAME_SECONDS ? 1 : 0;
  const opticalTimeInFrame = opticalAbsoluteSeconds
    - sourceFrameOffset * GBA_FRAME_SECONDS;
  return Object.freeze({
    row,
    rowStartSeconds,
    latchSeconds,
    opticalDelaySeconds: opticalDelay,
    opticalAbsoluteSeconds,
    sourceFrameOffset,
    opticalTimeInFrame,
    beforeOpticalSeconds: opticalTimeInFrame,
    afterOpticalSeconds: GBA_FRAME_SECONDS - opticalTimeInFrame,
  });
}

export function sourcePairForEvent({
  current,
  previous,
  older,
  olderAvailable = true,
  sourceFrameOffset,
}) {
  if (sourceFrameOffset === 0) {
    return Object.freeze({ oldTarget: previous, newTarget: current });
  }
  if (sourceFrameOffset === 1) {
    return Object.freeze({
      oldTarget: olderAvailable ? older : previous,
      newTarget: previous,
    });
  }
  throw new RangeError("sourceFrameOffset must be 0 or 1");
}

export function inversionSpatialPhase({ x, y, inversionTopology = 0 }) {
  if (!Number.isInteger(x) || x < 0 || !Number.isInteger(y) || y < 0) {
    throw new RangeError("x and y must be non-negative integers");
  }
  const topology = Math.round(clamp(
    finite("inversionTopology", inversionTopology),
    INVERSION_TOPOLOGIES.FRAME_GLOBAL,
    INVERSION_TOPOLOGIES.DOT_CHECKERBOARD,
  ));
  if (topology === INVERSION_TOPOLOGIES.ROW_ALTERNATING) return y % 2;
  if (topology === INVERSION_TOPOLOGIES.COLUMN_ALTERNATING) return x % 2;
  if (topology === INVERSION_TOPOLOGIES.DOT_CHECKERBOARD) return (x + y) % 2;
  return 0;
}

export function drivePolarity({
  frameCount,
  x,
  y,
  parityPhase = 0,
  inversionTopology = 0,
}) {
  if (!Number.isInteger(frameCount) || frameCount < 0) {
    throw new RangeError("frameCount must be a non-negative integer");
  }
  const phase = Math.round(clamp(finite("parityPhase", parityPhase), 0, 1));
  const spatial = inversionSpatialPhase({ x, y, inversionTopology });
  return (frameCount + phase + spatial) % 2 === 0 ? 1 : -1;
}

function parseCli(argv) {
  const options = { latchOffsetLines: 0.5, opticalDelaySeconds: 0 };
  for (let index = 0; index < argv.length; index += 2) {
    const value = Number(argv[index + 1]);
    if (argv[index] === "--latch-lines") options.latchOffsetLines = value;
    else if (argv[index] === "--optical-delay") options.opticalDelaySeconds = value;
    else throw new Error(`unknown or incomplete argument: ${argv[index] ?? "<missing>"}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({
    model: "gba-row-latch-optical-v1",
    units: "seconds",
    timing: {
      masterClockHz: GBA_MASTER_CLOCK_HZ,
      cyclesPerLine: GBA_CYCLES_PER_LINE,
      totalLines: GBA_TOTAL_LINES,
      lineSeconds: GBA_LINE_SECONDS,
      frameSeconds: GBA_FRAME_SECONDS,
      frameHz: GBA_FRAME_HZ,
    },
    options,
    firstVisibleRow: scanEvent({ row: 0, ...options }),
    lastVisibleRow: scanEvent({ row: 159, ...options }),
  }, null, 2)}\n`);
}
