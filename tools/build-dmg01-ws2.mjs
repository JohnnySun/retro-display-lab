#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DMG_FRAME_SECONDS,
  deriveFamily,
  initialTemporalState,
  partitionError,
  transitionT90Seconds,
} from "../models/nintendo-dmg-01/reference/temporal-response.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const reconstructionPath = path.join(modelDir, "data", "reconstruction-v1.json");
const evidencePath = path.join(modelDir, "data", "stn-response-evidence-v1.json");
const outputPath = path.join(modelDir, "generated", "ws2-temporal-fit-v1.json");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function cleanDeep(value) {
  if (typeof value === "number") {
    if (Math.abs(value) < 1e-12) return 0;
    return Number(value.toPrecision(9));
  }
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

function validateEvidence(record) {
  if (record.schemaVersion !== 1 || !Array.isArray(record.rows) || record.rows.length !== 3) {
    fail("WS2 historical evidence record is incomplete");
  }
  const required = [
    "responseDefinition", "tonSeconds", "toffSeconds", "aggregateMetric",
    "temperatureC", "duty", "cellGapMicrometers", "viscosityCentipoise",
    "twistDegrees", "opticalConfiguration", "productionStatus", "fitRole",
    "directlyApplicableToDmg", "limits",
  ];
  for (const row of record.rows) {
    for (const field of required) {
      if (!Object.hasOwn(row, field)) fail(`${row.id}: missing normalized field ${field}`);
    }
    if (row.directlyApplicableToDmg !== false) fail(`${row.id}: literature row overclaims DMG applicability`);
  }
  const okada = record.rows.find((row) => row.id === "okada-1988-fast-270-stn");
  if (okada?.aggregateMetric !== "mean-ton-toff" || okada.temperatureC !== 20
      || okada.duty !== "1/200" || okada.cellGapMicrometers !== 4
      || okada.twistDegrees !== 270 || okada.reportedValueSeconds !== 0.08) {
    fail("Okada 1988 normalized conditions drifted");
  }
  const conventional = record.rows.find((row) => row.id === "takatsu-1999-conventional-stn");
  if (conventional?.reportedValueSeconds !== 0.3
      || conventional.aggregateMetric !== "unspecified") {
    fail("Takatsu conventional STN anchor drifted or overstates its metric");
  }
}

function presetNumber(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? Number(match[1]) : Number.NaN;
}

function validateCandidatePreset(candidate) {
  const presetName = candidate.id === "nominal" ? "reference" : candidate.id;
  const presetPath = path.join(modelDir, "presets", `${presetName}-v1.slangp`);
  if (!fs.existsSync(presetPath)) fail(`${candidate.id}: missing preset ${presetName}-v1.slangp`);
  const source = fs.readFileSync(presetPath, "utf8");
  for (const [name, expected] of Object.entries(candidate.fit.referenceParameters)) {
    const actual = presetNumber(source, name);
    if (Math.abs(actual - expected) > 1e-8) {
      fail(`${candidate.id}: preset ${name} ${actual} does not match generated ${expected}`);
    }
  }
  return `presets/${presetName}-v1.slangp`;
}

function deriveCandidate(candidate) {
  const family = deriveFamily(candidate);
  const transitions = [];
  let maximumPartitionError = 0;
  for (let fromIndex = 0; fromIndex < 4; fromIndex += 1) {
    for (let toIndex = 0; toIndex < 4; toIndex += 1) {
      if (fromIndex === toIndex) continue;
      const t90Seconds = transitionT90Seconds(family, fromIndex, toIndex);
      const partitionErrors = [2, 3, 7, 16].map((partitions) => ({
        partitions,
        error: partitionError(
          initialTemporalState(fromIndex),
          toIndex,
          family,
          DMG_FRAME_SECONDS,
          partitions,
        ),
      }));
      maximumPartitionError = Math.max(
        maximumPartitionError,
        ...partitionErrors.map((item) => item.error),
      );
      transitions.push({ fromIndex, toIndex, t90Seconds, partitionErrors });
    }
  }
  if (maximumPartitionError > 1e-12) {
    fail(`${candidate.id}: continuous response is not frame-partition equivalent (${maximumPartitionError})`);
  }
  const endpointDark = transitions.find((item) => item.fromIndex === 0 && item.toIndex === 3);
  const endpointClear = transitions.find((item) => item.fromIndex === 3 && item.toIndex === 0);
  if (Math.abs(endpointDark.t90Seconds - family.darkeningT90Seconds) > 1e-10
      || Math.abs(endpointClear.t90Seconds - family.clearingT90Seconds) > 1e-10) {
    fail(`${candidate.id}: endpoint fit missed its target`);
  }
  return {
    id: family.id,
    classification: family.classification,
    input: {
      combinedEndpointT90Seconds: family.combinedEndpointT90Seconds,
      clearingToDarkeningT90Ratio: family.clearingToDarkeningT90Ratio,
      slowTailWeight: family.slowTailWeight,
      slowRateScale: family.slowRateScale,
      intermediateDrag: family.intermediateDrag,
      distanceDrag: family.distanceDrag,
    },
    fit: {
      darkeningT90Seconds: family.darkeningT90Seconds,
      clearingT90Seconds: family.clearingT90Seconds,
      darkeningRatePerSecond: family.darkeningRatePerSecond,
      clearingRatePerSecond: family.clearingRatePerSecond,
      referenceFrameSeconds: DMG_FRAME_SECONDS,
      referenceParameters: family.referenceParameters,
    },
    transitions,
    validation: {
      endpointT90FitMaximumErrorSeconds: Math.max(
        Math.abs(endpointDark.t90Seconds - family.darkeningT90Seconds),
        Math.abs(endpointClear.t90Seconds - family.clearingT90Seconds),
      ),
      maximumFramePartitionError: maximumPartitionError,
      partitionsTested: [2, 3, 7, 16],
      pass: true,
    },
    rationale: family.rationale,
  };
}

const reconstructionBuffer = fs.readFileSync(reconstructionPath);
const evidenceBuffer = fs.readFileSync(evidencePath);
const reconstruction = JSON.parse(reconstructionBuffer);
const evidence = JSON.parse(evidenceBuffer);
validateEvidence(evidence);
if (reconstruction.temporal.fitModel.referenceFrameSeconds.toFixed(9)
    !== DMG_FRAME_SECONDS.toFixed(9)) {
  fail("WS2 reference frame duration drifted from the CPU model");
}
const candidates = reconstruction.temporal.candidates.map(deriveCandidate);
const candidatePresetPaths = Object.fromEntries(candidates.map((candidate) => [
  candidate.id,
  validateCandidatePreset(candidate),
]));
const nominal = candidates.find((candidate) => candidate.id === "nominal");
if (!nominal || nominal.input.combinedEndpointT90Seconds !== 0.3) {
  fail("normal DMG candidate no longer uses the conventional 300 ms scale");
}
if (nominal.input.combinedEndpointT90Seconds === 0.08
    || (nominal.input.combinedEndpointT90Seconds >= 0.12
      && nominal.input.combinedEndpointT90Seconds <= 0.13)) {
  fail("normal DMG candidate incorrectly adopted a later or optimized fast anchor");
}

const report = cleanDeep({
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws2-temporal-fit-v1",
  classification: "superseded literature-constrained regression envelope; retained only for output comparison",
  generatedFrom: {
    reconstruction: "data/reconstruction-v1.json",
    reconstructionSha256: sha256(reconstructionBuffer),
    normalizedEvidence: "data/stn-response-evidence-v1.json",
    normalizedEvidenceSha256: sha256(evidenceBuffer),
    cpuReference: "reference/temporal-response.mjs",
  },
  model: reconstruction.temporal.fitModel,
  evidenceRows: evidence.rows.map((row) => ({
    id: row.id,
    evidenceId: row.evidenceId,
    fitRole: row.fitRole,
    directlyApplicableToDmg: row.directlyApplicableToDmg,
  })),
  candidates,
  selection: {
    referencePresetCandidate: "nominal",
    candidatePresetPaths,
    fastAndSlowCandidatesAreDmgRevisionClaims: false,
    ws2CompletionArtifact: false,
    claimBoundary: "The fit is an interim engineering baseline and output-validation envelope. It is not a measured DMG transition matrix and does not replace the required voltage, STN director, and reflective-optical reconstruction.",
  },
});
const output = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);

if (checkOnly) {
  if (!fs.existsSync(outputPath) || !fs.readFileSync(outputPath).equals(output)) {
    fail("DMG WS2 temporal fit is missing or stale; run node tools/build-dmg01-ws2.mjs");
  }
  console.log("DMG-01 WS2 superseded timing envelope and partition checks are current.");
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote superseded WS2 timing envelope ${path.relative(root, outputPath)}.`);
}
