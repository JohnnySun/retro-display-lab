import { pathToFileURL } from "node:url";

export const CGB_WS4_EQUATION_ID = "CGB-WS4-FIRST-ORDER-RATE-FIELD-V1";
export const CGB_WS4_LOG_10_TO_90 = Math.log(9);
export const CGB_WS4_SNAP_EPSILON = 1 / 65_536;
export const CGB_WS4_CHANNELS = Object.freeze(["r", "g", "b"]);
export const CGB_WS4_CODE_COUNT = 32;

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function code5(name, value) {
  if (!Number.isInteger(value) || value < 0 || value >= CGB_WS4_CODE_COUNT) {
    throw new RangeError(`${name} must be an integer in [0, 31]`);
  }
  return value;
}

export function commandCoordinate(code) {
  return code5("code", code) / 31;
}

export function rateFromT10To90Milliseconds(milliseconds) {
  const value = finite("milliseconds", milliseconds);
  if (value <= 0) throw new RangeError("milliseconds must be positive");
  return CGB_WS4_LOG_10_TO_90 / (value * 0.001);
}

export function t10To90MillisecondsFromRate(ratePerSecond) {
  const value = finite("ratePerSecond", ratePerSecond);
  if (value <= 0) throw new RangeError("ratePerSecond must be positive");
  return CGB_WS4_LOG_10_TO_90 * 1_000 / value;
}

export function transitionGeometry(fromCode, toCode) {
  const from = code5("fromCode", fromCode);
  const to = code5("toCode", toCode);
  const distance = Math.abs(to - from) / 31;
  const grayWeight = clamp(((1 - distance) / (30 / 31)) ** 2, 0, 1);
  return Object.freeze({
    fromCode: from,
    toCode: to,
    direction: to === from ? "identity" : to > from ? "increasing-command" : "decreasing-command",
    distance,
    grayWeight,
  });
}

export function transitionParameters(member, fromCode, toCode) {
  const geometry = transitionGeometry(fromCode, toCode);
  const onAndOff = finite(
    "member.parameters.onAndOffT10To90Milliseconds",
    member?.parameters?.onAndOffT10To90Milliseconds,
  );
  const gray = finite(
    "member.parameters.grayT10To90Milliseconds",
    member?.parameters?.grayT10To90Milliseconds,
  );
  if (onAndOff <= 0 || gray < onAndOff) {
    throw new RangeError("member response anchors must satisfy 0 < onAndOff <= gray");
  }
  const t10To90Milliseconds = onAndOff + (gray - onAndOff) * geometry.grayWeight;
  return Object.freeze({
    ...geometry,
    t10To90Milliseconds,
    ratePerSecond: rateFromT10To90Milliseconds(t10To90Milliseconds),
    equationId: CGB_WS4_EQUATION_ID,
  });
}

export function stepFirstOrder(state, target, ratePerSecond, seconds, snapEpsilon = CGB_WS4_SNAP_EPSILON) {
  const current = clamp(finite("state", state), 0, 1);
  const destination = clamp(finite("target", target), 0, 1);
  const rate = finite("ratePerSecond", ratePerSecond);
  const duration = finite("seconds", seconds);
  const snap = finite("snapEpsilon", snapEpsilon);
  if (rate <= 0) throw new RangeError("ratePerSecond must be positive");
  if (duration < 0) throw new RangeError("seconds must be non-negative");
  if (snap < 0 || snap >= 1) throw new RangeError("snapEpsilon must be in [0, 1)");
  if (current === destination || duration === 0) return current === destination ? destination : current;
  const next = destination + (current - destination) * Math.exp(-rate * duration);
  if (Math.abs(destination - next) <= snap) return destination;
  return clamp(next, Math.min(current, destination), Math.max(current, destination));
}

export function stepCodeTransition(state, targetCode, member, fromCode, seconds) {
  const parameters = transitionParameters(member, fromCode, targetCode);
  return stepFirstOrder(state, commandCoordinate(targetCode), parameters.ratePerSecond, seconds);
}

export function cascadeUnitStep(ratePerSecond, seconds) {
  const rate = finite("ratePerSecond", ratePerSecond);
  const duration = finite("seconds", seconds);
  if (rate <= 0 || duration < 0) throw new RangeError("cascade rate must be positive and seconds non-negative");
  const scaled = rate * duration;
  return 1 - (1 + scaled) * Math.exp(-scaled);
}

export function cascadeRateForT10To90Milliseconds(milliseconds) {
  const targetSeconds = finite("milliseconds", milliseconds) * 0.001;
  if (targetSeconds <= 0) throw new RangeError("milliseconds must be positive");
  const timeAtFraction = (fraction) => {
    let low = 0;
    let high = 20;
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const middle = 0.5 * (low + high);
      if (cascadeUnitStep(1, middle) < fraction) low = middle;
      else high = middle;
    }
    return 0.5 * (low + high);
  };
  const unitInterval = timeAtFraction(0.9) - timeAtFraction(0.1);
  return unitInterval / targetSeconds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const members = [
    { id: "hcr-like-fast", parameters: { onAndOffT10To90Milliseconds: 50, grayT10To90Milliseconds: 80 } },
    { id: "mid-envelope-nominal", parameters: { onAndOffT10To90Milliseconds: 65, grayT10To90Milliseconds: 115 } },
    { id: "gh-like-slow", parameters: { onAndOffT10To90Milliseconds: 80, grayT10To90Milliseconds: 150 } },
  ];
  process.stdout.write(`${JSON.stringify({
    equationId: CGB_WS4_EQUATION_ID,
    snapEpsilon: CGB_WS4_SNAP_EPSILON,
    anchors: members.flatMap((member) => [[0, 31], [15, 16]].map(([fromCode, toCode]) => ({
      member: member.id,
      fromCode,
      toCode,
      ...transitionParameters(member, fromCode, toCode),
    }))),
  }, null, 2)}\n`);
}
