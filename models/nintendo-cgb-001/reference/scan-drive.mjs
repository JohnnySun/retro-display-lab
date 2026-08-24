import { pathToFileURL } from "node:url";

export const CGB_MASTER_CLOCK_HZ = 4_194_304;
export const CGB_DOTS_PER_LINE = 456;
export const CGB_TOTAL_LINES = 154;
export const CGB_VISIBLE_LINES = 144;
export const CGB_VERTICAL_BLANK_LINES = CGB_TOTAL_LINES - CGB_VISIBLE_LINES;
export const CGB_DOTS_PER_FRAME = CGB_DOTS_PER_LINE * CGB_TOTAL_LINES;
export const CGB_LINE_SECONDS = CGB_DOTS_PER_LINE / CGB_MASTER_CLOCK_HZ;
export const CGB_FRAME_SECONDS = CGB_DOTS_PER_FRAME / CGB_MASTER_CLOCK_HZ;
export const CGB_FRAME_HZ = 1 / CGB_FRAME_SECONDS;
export const INVERSION_TOPOLOGIES = Object.freeze([
  "none",
  "frame-global",
  "row-alternating",
  "column-alternating",
  "dot-checkerboard",
]);

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function code5(value, name = "code") {
  if (!Number.isInteger(value) || value < 0 || value > 31) {
    throw new RangeError(`${name} must be an integer in [0, 31]`);
  }
  return value;
}

export function scanEvent({ row, latchOffsetLines = 0, rowActivationDelayLines = 0 }) {
  if (!Number.isInteger(row) || row < 0 || row >= CGB_TOTAL_LINES) {
    throw new RangeError(`row must be an integer in [0, ${CGB_TOTAL_LINES - 1}]`);
  }
  const latch = clamp(finite("latchOffsetLines", latchOffsetLines), 0, 1);
  const activationDelay = clamp(finite("rowActivationDelayLines", rowActivationDelayLines), 0, 1);
  const rowStartSeconds = row * CGB_LINE_SECONDS;
  const latchSeconds = rowStartSeconds + latch * CGB_LINE_SECONDS;
  const activationAbsoluteSeconds = latchSeconds + activationDelay * CGB_LINE_SECONDS;
  const sourceFrameOffset = Math.floor(activationAbsoluteSeconds / CGB_FRAME_SECONDS);
  const activationTimeInFrame = activationAbsoluteSeconds - sourceFrameOffset * CGB_FRAME_SECONDS;
  return Object.freeze({
    row,
    visible: row < CGB_VISIBLE_LINES,
    rowStartSeconds,
    latchOffsetLines: latch,
    latchSeconds,
    rowActivationDelayLines: activationDelay,
    activationAbsoluteSeconds,
    sourceFrameOffset,
    activationTimeInFrame,
    normalizedRowPhase: activationTimeInFrame / CGB_FRAME_SECONDS,
  });
}

export function inversionSpatialPhase({ x, y, topology = "row-alternating" }) {
  if (!Number.isInteger(x) || x < 0 || !Number.isInteger(y) || y < 0) {
    throw new RangeError("x and y must be non-negative integers");
  }
  if (!INVERSION_TOPOLOGIES.includes(topology)) throw new RangeError(`unknown inversion topology: ${topology}`);
  if (topology === "row-alternating") return y & 1;
  if (topology === "column-alternating") return x & 1;
  if (topology === "dot-checkerboard") return (x + y) & 1;
  return 0;
}

export function drivePolarity({ frameCount, x, y, parityPhase = 0, topology = "row-alternating" }) {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new RangeError("frameCount must be a non-negative integer");
  if (!Number.isInteger(parityPhase) || parityPhase < 0 || parityPhase > 1) throw new RangeError("parityPhase must be 0 or 1");
  if (topology === "none") return 1;
  const spatial = inversionSpatialPhase({ x, y, topology });
  return (frameCount + parityPhase + spatial) % 2 === 0 ? 1 : -1;
}

export function sourceCommandCoordinate(code) {
  return code5(code) / 31;
}

export function effectiveDrive({ code, polarity }) {
  if (polarity !== -1 && polarity !== 1) throw new RangeError("polarity must be -1 or 1");
  return polarity * sourceCommandCoordinate(code);
}

export function splitChangedPixel({ previousCode, currentCode, event }) {
  code5(previousCode, "previousCode");
  code5(currentCode, "currentCode");
  if (!event || !Number.isFinite(event.activationAbsoluteSeconds)) throw new TypeError("event must come from scanEvent");
  const previousSeconds = Math.min(event.activationAbsoluteSeconds, CGB_FRAME_SECONDS);
  const currentSeconds = Math.max(0, CGB_FRAME_SECONDS - event.activationAbsoluteSeconds);
  return Object.freeze({
    previousCode,
    currentCode,
    previousSeconds,
    currentSeconds,
    deferredSeconds: Math.max(0, event.activationAbsoluteSeconds - CGB_FRAME_SECONDS),
    previousFraction: previousSeconds / CGB_FRAME_SECONDS,
    currentFraction: currentSeconds / CGB_FRAME_SECONDS,
  });
}

export function integratedCommandCoordinate({ previousCode, currentCode, event }) {
  const split = splitChangedPixel({ previousCode, currentCode, event });
  return (
    sourceCommandCoordinate(previousCode) * split.previousSeconds
    + sourceCommandCoordinate(currentCode) * split.currentSeconds
  ) / CGB_FRAME_SECONDS;
}

export function noScanCommandCoordinate(currentCode) {
  return sourceCommandCoordinate(currentCode);
}

export function diagnosticSixBitMapping(code, candidate) {
  const source = code5(code);
  if (candidate === "zero-fill-lsb") return source << 1;
  if (candidate === "replicate-msb-to-lsb") return (source << 1) | (source >> 4);
  if (candidate === "unknown-monotone-controller-map") return null;
  throw new RangeError(`unknown six-bit mapping candidate: ${candidate}`);
}

export function debugState({ code, frameCount, x, y, row, parityPhase = 0, topology = "row-alternating", latchOffsetLines = 0, rowActivationDelayLines = 0 }) {
  const event = scanEvent({ row, latchOffsetLines, rowActivationDelayLines });
  const polarity = drivePolarity({ frameCount, x, y, parityPhase, topology });
  return Object.freeze({
    rowPhase: event.normalizedRowPhase,
    frameParity: (frameCount + parityPhase) & 1,
    inversionSign: polarity,
    sourceCode: code5(code),
    effectiveDrive: effectiveDrive({ code, polarity }),
    units: { sourceCode: "RGB555 integer", effectiveDrive: "dimensionless signed command coordinate; not volts" },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify({
    model: "cgb001-scan-drive-v1",
    timing: {
      masterClockHz: CGB_MASTER_CLOCK_HZ,
      dotsPerLine: CGB_DOTS_PER_LINE,
      totalLines: CGB_TOTAL_LINES,
      visibleLines: CGB_VISIBLE_LINES,
      lineSeconds: CGB_LINE_SECONDS,
      frameSeconds: CGB_FRAME_SECONDS,
      frameRateHz: CGB_FRAME_HZ,
    },
    defaultEvents: [0, 71, 143, 144, 153].map((row) => scanEvent({ row })),
  }, null, 2)}\n`);
}
