import { GTG_CHANNELS, GTG_CODE_COUNT } from "./gtg-response.mjs";

export const WS4_ENSEMBLE_VERSION = "literature-constrained-rate-field-v1";
export const WS4_EQUATION_ID = "WS4-FIRST-ORDER-DISTANCE-V1";
export const FIRST_ORDER_T10_TO_90_LOG_RATIO = Math.log(9);

const finite = (name, value) => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};

export function rateFromT10To90Ms(milliseconds) {
  const value = finite("t10To90 milliseconds", milliseconds);
  if (value <= 0) throw new RangeError("t10To90 milliseconds must be positive");
  return FIRST_ORDER_T10_TO_90_LOG_RATIO / (value * 0.001);
}

export function t10To90MsFromRate(ratePerSecond) {
  const value = finite("ratePerSecond", ratePerSecond);
  if (value <= 0) throw new RangeError("ratePerSecond must be positive");
  return FIRST_ORDER_T10_TO_90_LOG_RATIO * 1_000 / value;
}

export function transitionGeometry(fromCode, toCode) {
  const from = finite("fromCode", fromCode);
  const to = finite("toCode", toCode);
  if (from < 0 || from > 31 || to < 0 || to > 31) {
    throw new RangeError("fromCode and toCode must be in 0..31");
  }
  const distance = Math.abs(to - from) / 31;
  const midpoint = 0.5 * (from + to) / 31;
  const nearWeight = (1 - distance) ** 2;
  const middleWeight = 4 * midpoint * (1 - midpoint) * nearWeight;
  return Object.freeze({ distance, midpoint, nearWeight, middleWeight });
}

export function reconstructedTransition(profile, fromCode, toCode) {
  if (fromCode === toCode) throw new RangeError("identity cells require a derived anchor");
  const direction = toCode > fromCode ? "optical-brightening" : "optical-darkening";
  const endpointT10To90Ms = direction === "optical-brightening"
    ? profile.opticalBrighteningEndpointT10To90Ms
    : profile.opticalDarkeningEndpointT10To90Ms;
  const geometry = transitionGeometry(fromCode, toCode);
  const timeMultiplier = 1
    + profile.nearTransitionPenalty * geometry.nearWeight
    + profile.midGrayPenalty * geometry.middleWeight;
  const t10To90Ms = endpointT10To90Ms * timeMultiplier;
  return Object.freeze({
    direction,
    endpointT10To90Ms,
    timeMultiplier,
    t10To90Ms,
    ratePerSecond: rateFromT10To90Ms(t10To90Ms),
    ...geometry,
  });
}

function identityAnchorRate(profile, code) {
  const rates = [];
  for (const neighbor of [code - 1, code + 1]) {
    if (neighbor < 0 || neighbor >= GTG_CODE_COUNT) continue;
    rates.push(reconstructedTransition(profile, code, neighbor).ratePerSecond);
    rates.push(reconstructedTransition(profile, neighbor, code).ratePerSecond);
  }
  return Math.exp(rates.reduce((sum, rate) => sum + Math.log(rate), 0) / rates.length);
}

export function buildReconstructedCells(profile) {
  const cells = [];
  for (const channel of GTG_CHANNELS) {
    for (let fromCode = 0; fromCode < GTG_CODE_COUNT; fromCode += 1) {
      for (let toCode = 0; toCode < GTG_CODE_COUNT; toCode += 1) {
        const id = `${channel}:${fromCode}>${toCode}`;
        if (fromCode === toCode) {
          const ratePerSecond = identityAnchorRate(profile, fromCode);
          cells.push(Object.freeze({
            id,
            channel,
            fromCode,
            toCode,
            status: "derived-identity-anchor",
            runtimeEligible: true,
            ensembleMember: profile.id,
            sourceClass: "reconstructed-identity-anchor",
            equationId: WS4_EQUATION_ID,
            parameterRangeId: "ws4-ensemble-v1",
            ratePerSecond,
            t10To90Ms: t10To90MsFromRate(ratePerSecond),
            sourceEvidenceIds: profile.endpointEvidenceIds,
            fallbackBehavior: "legacy-analytic-prior-if-any-required-corner-unavailable",
          }));
          continue;
        }
        const transition = reconstructedTransition(profile, fromCode, toCode);
        cells.push(Object.freeze({
          id,
          channel,
          fromCode,
          toCode,
          status: "reconstructed",
          runtimeEligible: true,
          ensembleMember: profile.id,
          sourceClass: "literature-constrained-reconstruction-not-measured",
          equationId: WS4_EQUATION_ID,
          parameterRangeId: "ws4-ensemble-v1",
          direction: transition.direction,
          ratePerSecond: transition.ratePerSecond,
          t10To90Ms: transition.t10To90Ms,
          endpointT10To90Ms: transition.endpointT10To90Ms,
          distance: transition.distance,
          midpoint: transition.midpoint,
          nearWeight: transition.nearWeight,
          middleWeight: transition.middleWeight,
          timeMultiplier: transition.timeMultiplier,
          sourceEvidenceIds: profile.endpointEvidenceIds,
          fallbackBehavior: "legacy-analytic-prior-if-any-required-corner-unavailable",
        }));
      }
    }
  }
  return Object.freeze(cells);
}

export function validateEnsembleDefinition(ensemble, evidence) {
  const errors = [];
  if (ensemble?.schemaVersion !== 1) errors.push("unsupported ensemble schemaVersion");
  if (ensemble?.runtimeModel?.equationId !== WS4_EQUATION_ID) errors.push("equationId mismatch");
  if (!Array.isArray(ensemble?.members) || ensemble.members.length !== 3) {
    errors.push("ensemble must contain three members");
  }
  const ids = new Set(ensemble?.members?.map((member) => member.id));
  for (const id of ["fast", "nominal", "slow"]) {
    if (!ids.has(id)) errors.push(`missing ${id} member`);
  }
  if (!ids.has(ensemble?.defaultMember)) errors.push("defaultMember is not an ensemble member");
  const evidenceIds = new Set(evidence?.items?.map((item) => item.evidenceId));
  for (const member of ensemble?.members ?? []) {
    for (const name of [
      "opticalDarkeningEndpointT10To90Ms",
      "opticalBrighteningEndpointT10To90Ms",
      "nearTransitionPenalty",
      "midGrayPenalty",
    ]) {
      if (!Number.isFinite(member[name]) || member[name] < 0) errors.push(`${member.id}.${name} is invalid`);
    }
    for (const evidenceId of member.endpointEvidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) errors.push(`${member.id} has unknown evidence ${evidenceId}`);
    }
  }
  const ordered = ensemble?.members ?? [];
  for (let index = 1; index < ordered.length; index += 1) {
    if (!(ordered[index].opticalDarkeningEndpointT10To90Ms
          > ordered[index - 1].opticalDarkeningEndpointT10To90Ms)
        || !(ordered[index].opticalBrighteningEndpointT10To90Ms
          > ordered[index - 1].opticalBrighteningEndpointT10To90Ms)) {
      errors.push("ensemble endpoint timings must increase fast < nominal < slow");
    }
  }
  return errors;
}
