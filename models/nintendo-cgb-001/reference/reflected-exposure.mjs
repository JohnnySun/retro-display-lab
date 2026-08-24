import { pathToFileURL } from "node:url";
import {
  CGB_FRAME_SECONDS,
  scanEvent,
} from "./scan-drive.mjs";
import {
  CGB_WS4_SNAP_EPSILON,
  commandCoordinate,
  stepFirstOrder,
} from "./optical-response.mjs";

export const CGB_WS5_EQUATION_ID = "CGB-WS5-REFLECTED-EXPOSURE-V1";
export const CGB_WS5_LUT_SIZE = 32;
export const CGB_WS5_CHANNELS = 3;
export const CGB_WS5_GAUSS_NODES = Object.freeze([
  -0.9602898564975363,
  -0.7966664774136267,
  -0.525532409916329,
  -0.1834346424956498,
  0.1834346424956498,
  0.525532409916329,
  0.7966664774136267,
  0.9602898564975363,
]);
export const CGB_WS5_GAUSS_WEIGHTS = Object.freeze([
  0.1012285362903763,
  0.2223810344533745,
  0.3137066458778873,
  0.362683783378362,
  0.362683783378362,
  0.3137066458778873,
  0.2223810344533745,
  0.1012285362903763,
]);
export const CGB_WS5_GAUSS_RULES = Object.freeze({
  2: Object.freeze({
    nodes: Object.freeze([-0.5773502691896257, 0.5773502691896257]),
    weights: Object.freeze([1, 1]),
  }),
  4: Object.freeze({
    nodes: Object.freeze([
      -0.8611363115940526,
      -0.3399810435848563,
      0.3399810435848563,
      0.8611363115940526,
    ]),
    weights: Object.freeze([
      0.3478548451374538,
      0.6521451548625461,
      0.6521451548625461,
      0.3478548451374538,
    ]),
  }),
  8: Object.freeze({ nodes: CGB_WS5_GAUSS_NODES, weights: CGB_WS5_GAUSS_WEIGHTS }),
});

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const f32 = Math.fround;

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function validateRgbState(name, state) {
  if (!Array.isArray(state) || state.length !== CGB_WS5_CHANNELS) {
    throw new TypeError(`${name} must contain three channels`);
  }
  return state.map((value, channel) => clamp(finite(`${name}[${channel}]`, value)));
}

function validateRgb555(name, rgb555) {
  if (!Array.isArray(rgb555) || rgb555.length !== CGB_WS5_CHANNELS
      || !rgb555.every((code) => Number.isInteger(code) && code >= 0 && code < CGB_WS5_LUT_SIZE)) {
    throw new RangeError(`${name} must contain three RGB555 codes in [0, 31]`);
  }
  return [...rgb555];
}

function validateLut(lutBuffer) {
  if (!Buffer.isBuffer(lutBuffer) || lutBuffer.length !== CGB_WS5_LUT_SIZE ** 3 * 16) {
    throw new RangeError("lutBuffer must be a 32-cubed little-endian RGBA32F artifact");
  }
}

function validateRateBuffer(rateBuffer) {
  if (!Buffer.isBuffer(rateBuffer) || rateBuffer.length !== 3 * 3 * 32 * 32 * 4) {
    throw new RangeError("rateBuffer must contain 3 members x 3 channels x 32 x 32 R32F rates");
  }
}

export function nearestCodeFromState(state) {
  return Math.min(31, Math.max(0, Math.floor(clamp(finite("state", state)) * 31 + 0.5)));
}

export function rateTableIndex(memberIndex, channelIndex, fromCode, toCode) {
  if (!Number.isInteger(memberIndex) || memberIndex < 0 || memberIndex >= 3) {
    throw new RangeError("memberIndex must be in [0, 2]");
  }
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex >= 3) {
    throw new RangeError("channelIndex must be in [0, 2]");
  }
  for (const [name, code] of [["fromCode", fromCode], ["toCode", toCode]]) {
    if (!Number.isInteger(code) || code < 0 || code >= 32) throw new RangeError(`${name} must be in [0, 31]`);
  }
  return (((memberIndex * 3 + channelIndex) * 32 + fromCode) * 32 + toCode);
}

export function packedRate(rateBuffer, memberIndex, channelIndex, fromCode, toCode) {
  validateRateBuffer(rateBuffer);
  const index = rateTableIndex(memberIndex, channelIndex, fromCode, toCode);
  const rate = rateBuffer.readFloatLE(index * 4);
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`invalid packed rate at index ${index}`);
  return rate;
}

export function segmentRateVector(rateBuffer, memberIndex, startState, targetRgb555) {
  const state = validateRgbState("startState", startState);
  const target = validateRgb555("targetRgb555", targetRgb555);
  const fromCodes = state.map(nearestCodeFromState);
  const rates = fromCodes.map((fromCode, channel) => (
    packedRate(rateBuffer, memberIndex, channel, fromCode, target[channel])
  ));
  return Object.freeze({ fromCodes, targetCodes: target, rates });
}

function lutVertex(lutBuffer, r, g, b) {
  const voxel = (b * 32 + g) * 32 + r;
  const offset = voxel * 16;
  return [
    lutBuffer.readFloatLE(offset),
    lutBuffer.readFloatLE(offset + 4),
    lutBuffer.readFloatLE(offset + 8),
  ];
}

export function sampleTrilinearXyz(lutBuffer, state, float32 = false) {
  validateLut(lutBuffer);
  const rgb = validateRgbState("state", state);
  const coordinate = rgb.map((value) => (float32 ? f32(f32(value) * f32(31)) : value * 31));
  const low = coordinate.map((value) => Math.min(30, Math.max(0, Math.floor(value))));
  const amount = coordinate.map((value, channel) => {
    const result = value - low[channel];
    return float32 ? f32(result) : result;
  });
  const output = [0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    const bits = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    let weight = float32 ? f32(1) : 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const factor = bits[channel] ? amount[channel] : (float32 ? f32(1 - amount[channel]) : 1 - amount[channel]);
      weight = float32 ? f32(weight * f32(factor)) : weight * factor;
    }
    const vertex = lutVertex(lutBuffer, low[0] + bits[0], low[1] + bits[1], low[2] + bits[2]);
    for (let component = 0; component < 3; component += 1) {
      output[component] = float32
        ? f32(output[component] + f32(f32(vertex[component]) * weight))
        : output[component] + vertex[component] * weight;
    }
  }
  return output;
}

export function continuousStateAt(startState, targetRgb555, rates, seconds, float32 = false) {
  const start = validateRgbState("startState", startState);
  const targetCodes = validateRgb555("targetRgb555", targetRgb555);
  if (!Array.isArray(rates) || rates.length !== 3) throw new TypeError("rates must contain three channels");
  const duration = Math.max(0, finite("seconds", seconds));
  return start.map((value, channel) => {
    const target = commandCoordinate(targetCodes[channel]);
    const rate = finite(`rates[${channel}]`, rates[channel]);
    if (rate <= 0) throw new RangeError("rates must be positive");
    if (!float32) return target + (value - target) * Math.exp(-rate * duration);
    const x = f32(value);
    const q = f32(target);
    const k = f32(rate);
    const dt = f32(duration);
    const decay = f32(Math.exp(f32(-f32(k * dt))));
    return f32(q + f32(f32(x - q) * decay));
  });
}

export function segmentEndpoint(startState, targetRgb555, rates, seconds, float32 = false) {
  const start = validateRgbState("startState", startState);
  const targetCodes = validateRgb555("targetRgb555", targetRgb555);
  const duration = Math.max(0, finite("seconds", seconds));
  if (!float32) {
    return start.map((value, channel) => stepFirstOrder(
      value,
      commandCoordinate(targetCodes[channel]),
      rates[channel],
      duration,
    ));
  }
  const raw = continuousStateAt(start, targetCodes, rates, duration, true);
  return raw.map((value, channel) => {
    const current = f32(start[channel]);
    const target = f32(commandCoordinate(targetCodes[channel]));
    if (current === target || duration === 0) return current === target ? target : current;
    if (Math.abs(f32(target - value)) <= f32(CGB_WS4_SNAP_EPSILON)) return target;
    return f32(Math.min(Math.max(value, Math.min(current, target)), Math.max(current, target)));
  });
}

function integrateExponential(rate, startSeconds, endSeconds) {
  if (rate === 0) return endSeconds - startSeconds;
  return (Math.exp(-rate * startSeconds) - Math.exp(-rate * endSeconds)) / rate;
}

function cellBreakpoints(startState, targetRgb555, rates, seconds) {
  const rawEnd = continuousStateAt(startState, targetRgb555, rates, seconds);
  const points = [0, seconds];
  for (let channel = 0; channel < 3; channel += 1) {
    const start = startState[channel];
    const target = commandCoordinate(targetRgb555[channel]);
    if (start === target) continue;
    const minimum = Math.min(start, rawEnd[channel]);
    const maximum = Math.max(start, rawEnd[channel]);
    for (let code = 1; code < 31; code += 1) {
      const boundary = code / 31;
      if (!(boundary > minimum + 1e-15 && boundary < maximum - 1e-15)) continue;
      const ratio = (boundary - target) / (start - target);
      if (!(ratio > 0 && ratio < 1)) continue;
      const time = -Math.log(ratio) / rates[channel];
      if (time > 0 && time < seconds) points.push(time);
    }
  }
  points.sort((a, b) => a - b);
  return points.filter((value, index) => index === 0 || Math.abs(value - points[index - 1]) > 1e-14);
}

// Exact double-precision integral of the packed WS1 trilinear XYZ field along
// one constant-target first-order RGB segment. The path is split only when a
// channel crosses a LUT-cell boundary; within each cell the trilinear basis is
// a finite sum of exponentials and is integrated analytically.
export function integrateSegmentExact({
  lutBuffer,
  startState,
  targetRgb555,
  rates,
  seconds,
}) {
  validateLut(lutBuffer);
  const start = validateRgbState("startState", startState);
  const targetCodes = validateRgb555("targetRgb555", targetRgb555);
  const duration = Math.max(0, finite("seconds", seconds));
  if (!Array.isArray(rates) || rates.length !== 3 || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) {
    throw new RangeError("rates must contain three positive finite values");
  }
  if (duration === 0) return { integralXyz: [0, 0, 0], endpoint: start, cellIntervals: 0 };
  const target = targetCodes.map(commandCoordinate);
  const breakpoints = cellBreakpoints(start, targetCodes, rates, duration);
  const integralXyz = [0, 0, 0];
  for (let interval = 0; interval < breakpoints.length - 1; interval += 1) {
    const begin = breakpoints[interval];
    const end = breakpoints[interval + 1];
    const middleState = continuousStateAt(start, targetCodes, rates, (begin + end) / 2);
    const low = middleState.map((value) => Math.min(30, Math.max(0, Math.floor(value * 31))));
    const localConstant = target.map((value, channel) => value * 31 - low[channel]);
    const localExponential = start.map((value, channel) => (value - target[channel]) * 31);
    for (let corner = 0; corner < 8; corner += 1) {
      const bits = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
      const vertex = lutVertex(lutBuffer, low[0] + bits[0], low[1] + bits[1], low[2] + bits[2]);
      for (let exponentialMask = 0; exponentialMask < 8; exponentialMask += 1) {
        let coefficient = 1;
        let combinedRate = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const base = bits[channel] ? localConstant[channel] : 1 - localConstant[channel];
          const exponential = bits[channel] ? localExponential[channel] : -localExponential[channel];
          if ((exponentialMask >> channel) & 1) {
            coefficient *= exponential;
            combinedRate += rates[channel];
          } else {
            coefficient *= base;
          }
        }
        if (coefficient === 0) continue;
        const basisIntegral = coefficient * integrateExponential(combinedRate, begin, end);
        for (let component = 0; component < 3; component += 1) {
          integralXyz[component] += vertex[component] * basisIntegral;
        }
      }
    }
  }
  return {
    integralXyz,
    endpoint: segmentEndpoint(start, targetCodes, rates, duration),
    cellIntervals: breakpoints.length - 1,
  };
}

export function integrateSegmentGauss({
  lutBuffer,
  startState,
  targetRgb555,
  rates,
  seconds,
  panels = 1,
  order = 8,
  float32 = false,
}) {
  validateLut(lutBuffer);
  const start = validateRgbState("startState", startState);
  const targetCodes = validateRgb555("targetRgb555", targetRgb555);
  const duration = Math.max(0, finite("seconds", seconds));
  const panelCount = Math.max(1, Math.trunc(finite("panels", panels)));
  const rule = CGB_WS5_GAUSS_RULES[order];
  if (!rule) throw new RangeError("order must be 2, 4, or 8");
  if (!Array.isArray(rates) || rates.length !== 3 || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) {
    throw new RangeError("rates must contain three positive finite values");
  }
  if (duration === 0) return { integralXyz: [0, 0, 0], endpoint: start, samples: 0 };
  const integralXyz = [0, 0, 0];
  for (let panel = 0; panel < panelCount; panel += 1) {
    const begin = float32 ? f32(f32(duration) * f32(panel / panelCount)) : duration * panel / panelCount;
    const end = float32 ? f32(f32(duration) * f32((panel + 1) / panelCount)) : duration * (panel + 1) / panelCount;
    const middle = float32 ? f32(f32(begin + end) * f32(0.5)) : (begin + end) / 2;
    const half = float32 ? f32(f32(end - begin) * f32(0.5)) : (end - begin) / 2;
    const panelSum = [0, 0, 0];
    for (let sample = 0; sample < rule.nodes.length; sample += 1) {
      const node = float32 ? f32(rule.nodes[sample]) : rule.nodes[sample];
      const weight = float32 ? f32(rule.weights[sample]) : rule.weights[sample];
      const time = float32 ? f32(middle + f32(half * node)) : middle + half * node;
      const state = continuousStateAt(start, targetCodes, rates, time, float32);
      const xyz = sampleTrilinearXyz(lutBuffer, state, float32);
      for (let component = 0; component < 3; component += 1) {
        panelSum[component] = float32
          ? f32(panelSum[component] + f32(weight * xyz[component]))
          : panelSum[component] + weight * xyz[component];
      }
    }
    for (let component = 0; component < 3; component += 1) {
      const contribution = float32 ? f32(half * panelSum[component]) : half * panelSum[component];
      integralXyz[component] = float32
        ? f32(integralXyz[component] + contribution)
        : integralXyz[component] + contribution;
    }
  }
  return {
    integralXyz,
    endpoint: segmentEndpoint(start, targetCodes, rates, duration, float32),
    samples: panelCount * rule.nodes.length,
  };
}

function integrateSegment(method, parameters) {
  if (method === "exact") return integrateSegmentExact(parameters);
  if (method === "gauss-double") return integrateSegmentGauss({ ...parameters, float32: false });
  if (method === "gauss-float32") return integrateSegmentGauss({ ...parameters, float32: true });
  throw new RangeError(`unknown integration method: ${method}`);
}

export function integrateScannedFrame({
  lutBuffer,
  rateBuffer,
  memberIndex,
  initialState,
  previousRgb555,
  currentRgb555,
  row,
  latchOffsetLines = 0,
  rowActivationDelayLines = 0,
  method = "gauss-double",
  panels = 1,
  order = 8,
}) {
  validateLut(lutBuffer);
  validateRateBuffer(rateBuffer);
  const initial = validateRgbState("initialState", initialState);
  const previous = validateRgb555("previousRgb555", previousRgb555);
  const current = validateRgb555("currentRgb555", currentRgb555);
  const event = scanEvent({ row, latchOffsetLines, rowActivationDelayLines });
  const firstSeconds = Math.min(CGB_FRAME_SECONDS, event.activationAbsoluteSeconds);
  const secondSeconds = Math.max(0, CGB_FRAME_SECONDS - event.activationAbsoluteSeconds);
  const firstRate = segmentRateVector(rateBuffer, memberIndex, initial, previous);
  const allUnchanged = previous.every((code, channel) => code === current[channel]);
  const firstDuration = allUnchanged ? CGB_FRAME_SECONDS : firstSeconds;
  const firstPanels = Math.max(1, Math.ceil(panels * firstDuration / CGB_FRAME_SECONDS));
  const first = integrateSegment(method, {
    lutBuffer,
    startState: initial,
    targetRgb555: previous,
    rates: firstRate.rates,
    seconds: firstDuration,
    panels: firstPanels,
    order,
  });
  const segments = [{
    id: allUnchanged ? "held-full-frame" : "before-row-activation",
    seconds: firstDuration,
    targetRgb555: previous,
    fromCodes: firstRate.fromCodes,
    rates: firstRate.rates,
    integralXyz: first.integralXyz,
    quadraturePanels: method === "exact" ? null : firstPanels,
  }];
  let endpoint = first.endpoint;
  let integralXyz = [...first.integralXyz];
  if (!allUnchanged && secondSeconds > 0) {
    const rawFirstEndpoint = continuousStateAt(initial, previous, firstRate.rates, firstSeconds);
    const boundaryState = endpoint.map((value, channel) => (
      previous[channel] === current[channel] ? rawFirstEndpoint[channel] : value
    ));
    const candidateRate = segmentRateVector(rateBuffer, memberIndex, boundaryState, current);
    const secondRates = candidateRate.rates.map((rate, channel) => (
      previous[channel] === current[channel] ? firstRate.rates[channel] : rate
    ));
    const secondFromCodes = candidateRate.fromCodes.map((fromCode, channel) => (
      previous[channel] === current[channel] ? firstRate.fromCodes[channel] : fromCode
    ));
    const secondPanels = Math.max(1, Math.ceil(panels * secondSeconds / CGB_FRAME_SECONDS));
    const second = integrateSegment(method, {
      lutBuffer,
      startState: boundaryState,
      targetRgb555: current,
      rates: secondRates,
      seconds: secondSeconds,
      panels: secondPanels,
      order,
    });
    endpoint = second.endpoint;
    integralXyz = integralXyz.map((value, component) => (
      method === "gauss-float32"
        ? f32(value + second.integralXyz[component])
        : value + second.integralXyz[component]
    ));
    segments.push({
      id: "after-row-activation",
      seconds: secondSeconds,
      targetRgb555: current,
      fromCodes: secondFromCodes,
      rates: secondRates,
      integralXyz: second.integralXyz,
      quadraturePanels: method === "exact" ? null : secondPanels,
    });
  }
  const averageXyz = integralXyz.map((value) => (
    method === "gauss-float32" ? f32(value / f32(CGB_FRAME_SECONDS)) : value / CGB_FRAME_SECONDS
  ));
  return {
    equationId: CGB_WS5_EQUATION_ID,
    method,
    event,
    endpoint,
    integralXyz,
    averageXyz,
    segments,
  };
}

export function integrateNoScanFrame({
  lutBuffer,
  rateBuffer,
  memberIndex,
  initialState,
  currentRgb555,
  method = "gauss-double",
  panels = 1,
  order = 8,
}) {
  validateLut(lutBuffer);
  validateRateBuffer(rateBuffer);
  const initial = validateRgbState("initialState", initialState);
  const current = validateRgb555("currentRgb555", currentRgb555);
  const rate = segmentRateVector(rateBuffer, memberIndex, initial, current);
  const segment = integrateSegment(method, {
    lutBuffer,
    startState: initial,
    targetRgb555: current,
    rates: rate.rates,
    seconds: CGB_FRAME_SECONDS,
    panels,
    order,
  });
  return {
    equationId: CGB_WS5_EQUATION_ID,
    method,
    endpoint: segment.endpoint,
    integralXyz: segment.integralXyz,
    averageXyz: segment.integralXyz.map((value) => (
      method === "gauss-float32" ? f32(value / f32(CGB_FRAME_SECONDS)) : value / CGB_FRAME_SECONDS
    )),
    segments: [{
      id: "no-scan-full-frame",
      seconds: CGB_FRAME_SECONDS,
      targetRgb555: current,
      fromCodes: rate.fromCodes,
      rates: rate.rates,
      integralXyz: segment.integralXyz,
    }],
  };
}

export function staticXyz(lutBuffer, rgb555) {
  const codes = validateRgb555("rgb555", rgb555);
  return sampleTrilinearXyz(lutBuffer, codes.map(commandCoordinate));
}

export function normalizeByReferenceWhiteY(xyz, lutBuffer) {
  if (!Array.isArray(xyz) || xyz.length !== 3) throw new TypeError("xyz must contain three components");
  const value = xyz.map((component, index) => finite(`xyz[${index}]`, component));
  const whiteY = staticXyz(lutBuffer, [31, 31, 31])[1];
  return value.map((component) => component / whiteY);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify({
    equationId: CGB_WS5_EQUATION_ID,
    frameSeconds: CGB_FRAME_SECONDS,
    quadrature: {
      family: "eight-point Gauss-Legendre",
      nodes: CGB_WS5_GAUSS_NODES,
      weights: CGB_WS5_GAUSS_WEIGHTS,
    },
    physicalOutput: "native-frame average XYZ absolute relative reflectance at the frozen WS1 45-degree/0-degree D65 condition",
  }, null, 2)}\n`);
}
