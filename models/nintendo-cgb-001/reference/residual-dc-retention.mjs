// Nintendo CGB-001 WS7 residual-DC reference.
//
// This is a one-state reduction of the cited ion adsorption/desorption model.
// It is intentionally independent of the WS4 short-term RGB response.  The
// CGB reference default has zero resultant DC and zero optical coupling because
// no healthy CGB measurement identifies either amplitude.

import { drivePolarity } from "./scan-drive.mjs";

export const CGB_RETENTION_EQUATION_ID = "CGB-WS7-MIZUSAKI-ONE-STATE-V1";

export const LITERATURE_KINETIC_ENSEMBLE = Object.freeze([
  Object.freeze({
    id: "low-rate",
    adsorptionRatePerSecond: 0.060 / 60,
    desorptionRatePerSecond: 0.023 / 60,
  }),
  Object.freeze({
    id: "nominal-midpoint",
    adsorptionRatePerSecond: 0.0635 / 60,
    desorptionRatePerSecond: 0.0255 / 60,
  }),
  Object.freeze({
    id: "high-rate",
    adsorptionRatePerSecond: 0.067 / 60,
    desorptionRatePerSecond: 0.028 / 60,
  }),
]);

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function clamp(value, low = -1, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function rgb555ElectricalProxy(sourceRgb555) {
  if (!Array.isArray(sourceRgb555) || sourceRgb555.length !== 3) {
    throw new TypeError("sourceRgb555 must be a three-channel array");
  }
  return sourceRgb555.reduce((total, value, channel) => {
    if (!Number.isInteger(value) || value < 0 || value > 31) {
      throw new RangeError(`sourceRgb555[${channel}] must be an integer in [0, 31]`);
    }
    return total + value;
  }, 0) / (3 * 31);
}

export function residualDcExcitation({
  sourceRgb555,
  polarity,
  resultantDcOffset = 0,
  codeWeight = 0.5,
  polarityWeight = 0.25,
}) {
  if (polarity !== -1 && polarity !== 1) throw new RangeError("polarity must be -1 or 1");
  const offset = clamp(finite("resultantDcOffset", resultantDcOffset));
  const q = rgb555ElectricalProxy(sourceRgb555);
  const codeScale = clamp(finite("codeWeight", codeWeight), 0, 1);
  const polarityScale = clamp(finite("polarityWeight", polarityWeight), 0, 1);
  return clamp(offset * (1 + codeScale * (2 * q - 1) + polarityScale * polarity));
}

export function stepResidualDc({
  state,
  excitation,
  adsorptionRatePerSecond,
  desorptionRatePerSecond,
  dtSeconds,
}) {
  const current = clamp(finite("state", state));
  const target = clamp(finite("excitation", excitation));
  const adsorption = Math.max(0, finite("adsorptionRatePerSecond", adsorptionRatePerSecond));
  const desorption = Math.max(0, finite("desorptionRatePerSecond", desorptionRatePerSecond));
  const seconds = Math.max(0, finite("dtSeconds", dtSeconds));
  if (seconds === 0) return current;
  if (Math.abs(target) <= Number.EPSILON) {
    return clamp(current * Math.exp(-desorption * seconds));
  }
  const rate = adsorption + desorption;
  if (rate === 0) return current;
  const equilibrium = adsorption * target / rate;
  return clamp(equilibrium + (current - equilibrium) * Math.exp(-rate * seconds));
}

export function stepResidualDcFloat32(options) {
  const current = Math.fround(clamp(Math.fround(options.state)));
  const target = Math.fround(clamp(Math.fround(options.excitation)));
  const adsorption = Math.fround(Math.max(0, Math.fround(options.adsorptionRatePerSecond)));
  const desorption = Math.fround(Math.max(0, Math.fround(options.desorptionRatePerSecond)));
  const seconds = Math.fround(Math.max(0, Math.fround(options.dtSeconds)));
  if (seconds === 0) return current;
  if (Math.abs(target) <= Number.EPSILON) {
    return Math.fround(clamp(Math.fround(current * Math.fround(Math.exp(Math.fround(-desorption * seconds))))));
  }
  const rate = Math.fround(adsorption + desorption);
  if (rate === 0) return current;
  const equilibrium = Math.fround(Math.fround(adsorption * target) / rate);
  const decay = Math.fround(Math.exp(Math.fround(-rate * seconds)));
  return Math.fround(clamp(Math.fround(equilibrium + Math.fround(Math.fround(current - equilibrium) * decay))));
}

export function stepRetentionPixel({
  state,
  sourceRgb555,
  frameCount,
  x,
  y,
  parityPhase = 0,
  topology = "row-alternating",
  resultantDcOffset = 0,
  codeWeight = 0.5,
  polarityWeight = 0.25,
  adsorptionRatePerSecond,
  desorptionRatePerSecond,
  dtSeconds,
  enabled = true,
}) {
  if (!enabled) return Object.freeze({ state, excitation: 0, polarity: 0 });
  const polarity = drivePolarity({ frameCount, x, y, parityPhase, topology });
  const excitation = residualDcExcitation({
    sourceRgb555,
    polarity,
    resultantDcOffset,
    codeWeight,
    polarityWeight,
  });
  return Object.freeze({
    polarity,
    excitation,
    state: stepResidualDc({
      state,
      excitation,
      adsorptionRatePerSecond,
      desorptionRatePerSecond,
      dtSeconds,
    }),
  });
}

export function applyRetentionBridge({
  ordinaryRgbState,
  residualDcState,
  opticalCoupling = 0,
  enabled = true,
}) {
  if (!Array.isArray(ordinaryRgbState) || ordinaryRgbState.length !== 3
      || !ordinaryRgbState.every(Number.isFinite)) {
    throw new TypeError("ordinaryRgbState must be a finite three-component array");
  }
  if (!enabled || opticalCoupling === 0) return [...ordinaryRgbState];
  const offset = finite("opticalCoupling", opticalCoupling) * clamp(
    finite("residualDcState", residualDcState),
  );
  return ordinaryRgbState.map((value) => clamp(value + offset, 0, 1));
}
