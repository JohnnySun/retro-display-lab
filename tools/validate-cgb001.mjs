#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const generatedDir = path.join(modelDir, "generated");
const failures = [];

const requiredSchemas = [
  "measurement-normalization.schema.json",
  "color-model.schema.json",
  "scan-candidates.schema.json",
  "response-ensemble.schema.json",
  "exposure-integration.schema.json",
  "retention.schema.json",
  "aperture.schema.json",
  "frontend-contract.schema.json",
  "release-receipt.schema.json",
];

const expectedEvidenceIds = [
  "CGB-NIN-SERVICE-1999",
  "CGB-NIN-PROG-1999",
  "CGB-HCS-REFLECTANCE-2026",
  "CGB-SHARP-HRTFT-1997",
  "CGB-SHARP-REFLECTIVE-1999",
  "CGB-TN-SEKIYA-2001",
  "CGB-SHARP-HR-MODULE",
  "CGB-NIST-BRDF-1998",
  "CGB-BECKER-RLCD-2001",
  "CGB-VCOM-LEE-2008",
  "CGB-MIZUSAKI-2011",
  "CGB-DRIVE-RECON-2026",
  "CGB-GEKKIO-CENSUS",
  "CGB-NATALIE-CPU04",
  "CGB-GBDEV-EXTLCD",
  "CGB-PRIOR-SAMEBOY",
  "CGB-PRIOR-LIBRETRO",
  "CGB-GBCC-SUBPIXEL",
  "CGB-BGB-REALITY",
];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
    return {};
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function checkTopLevelSchema(instance, schema, label) {
  for (const required of schema.required ?? []) {
    check(Object.hasOwn(instance, required), `${label}: missing required property ${required}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(instance)) {
      check(Object.hasOwn(schema.properties ?? {}, key), `${label}: unexpected top-level property ${key}`);
    }
  }
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(property, "const") && Object.hasOwn(instance, key)) {
      check(JSON.stringify(instance[key]) === JSON.stringify(property.const), `${label}: ${key} violates schema const`);
    }
  }
}

const requiredFiles = [
  `${modelRelative}/README.md`,
  `${modelRelative}/REFERENCES.md`,
  `${modelRelative}/IMPLEMENTATION-TODO.md`,
  `${modelRelative}/model.json`,
  `${modelRelative}/data/reconstruction-v1.json`,
  `${modelRelative}/data/hcs-source-v1.json`,
  `${modelRelative}/data/color-reference-v1.json`,
  `${modelRelative}/data/ws2-frontend-policy-v1.json`,
  `${modelRelative}/data/ws2-stimulus-scenes-v1.json`,
  `${modelRelative}/data/frontend-contract-v1.json`,
  `${modelRelative}/data/ws3-evidence-inventory-v1.json`,
  `${modelRelative}/data/scan-candidates-v1.json`,
  `${modelRelative}/data/ws4-evidence-inventory-v1.json`,
  `${modelRelative}/data/ws4-response-policy-v1.json`,
  `${modelRelative}/data/response-ensemble-v1.json`,
  `${modelRelative}/data/ws5-exposure-policy-v1.json`,
  `${modelRelative}/data/ws6-evidence-inventory-v1.json`,
  `${modelRelative}/data/aperture-v1.json`,
  `${modelRelative}/data/ws7-evidence-inventory-v1.json`,
  `${modelRelative}/data/retention-v1.json`,
  `${modelRelative}/generated/ws0-scaffold-v1.json`,
  `${modelRelative}/generated/ws1-receipt-v1.json`,
  `${modelRelative}/generated/ws1-color-audit-v1.json`,
  `${modelRelative}/generated/ws1-perceptual-v1.json`,
  `${modelRelative}/generated/ws1-static-fixtures-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.json`,
  `${modelRelative}/generated/cgb001-d65-lut-v1.rgba32f`,
  `${modelRelative}/generated/ws2-stimulus-v1/manifest.json`,
  `${modelRelative}/generated/ws2-decoder-v1.json`,
  `${modelRelative}/generated/ws2-gambatte-smoke-v1.json`,
  `${modelRelative}/generated/ws2-receipt-v1.json`,
  `${modelRelative}/generated/ws3-runtime-constants-v1.json`,
  `${modelRelative}/generated/ws3-equation-vectors-v1.json`,
  `${modelRelative}/generated/ws3-sensitivity-v1.json`,
  `${modelRelative}/generated/ws3-receipt-v1.json`,
  `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.r32f`,
  `${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.json`,
  `${modelRelative}/generated/ws4-model-selection-v1.json`,
  `${modelRelative}/generated/ws4-equation-vectors-v1.json`,
  `${modelRelative}/generated/ws4-motion-fixtures-v1.json`,
  `${modelRelative}/generated/ws4-receipt-v1.json`,
  `${modelRelative}/generated/ws5-equation-vectors-v1.json`,
  `${modelRelative}/generated/ws5-quadrature-convergence-v1.json`,
  `${modelRelative}/generated/ws5-scan-exposure-fixtures-v1.json`,
  `${modelRelative}/generated/ws5-receipt-v1.json`,
  `${modelRelative}/generated/ws6-aperture-validation-v1.json`,
  `${modelRelative}/generated/ws6-receipt-v1.json`,
  `${modelRelative}/generated/ws7-retention-validation-v1.json`,
  `${modelRelative}/generated/ws7-receipt-v1.json`,
  `${modelRelative}/generated/cgb001-reference-d65-v1.png`,
  `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1.png`,
  `${modelRelative}/generated/cgb001-reference-d65-v1-hi-rgba8.png`,
  `${modelRelative}/generated/cgb001-reference-d65-v1-lo-rgba8.png`,
  `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1-hi-rgba8.png`,
  `${modelRelative}/generated/cgb001-hcs-upstream-d65-v1-lo-rgba8.png`,
  `${modelRelative}/generated/ws8-runtime-textures-v1.json`,
  `${modelRelative}/generated/ws8-shader-compile-v1.json`,
  `${modelRelative}/generated/ws8-manifest-v1.json`,
  `${modelRelative}/generated/ws8-receipt-v1.json`,
  `${modelRelative}/generated/ws9-cpu-golden-v1.json`,
  `${modelRelative}/generated/ws9-sensitivity-v1.json`,
  `${modelRelative}/generated/ws9-prior-art-comparison-v1.json`,
  `${modelRelative}/generated/ws9-preset-manifest-v1.json`,
  `${modelRelative}/generated/ws9-receipt-v1.json`,
  `${modelRelative}/shaders/cgb001-common.inc`,
  `${modelRelative}/shaders/cgb001-runtime-v1.inc`,
  `${modelRelative}/shaders/cgb001-response-v1.slang`,
  `${modelRelative}/shaders/cgb001-color-v1.slang`,
  `${modelRelative}/shaders/cgb001-display-v1.slang`,
  `${modelRelative}/reference/upstream/README.md`,
  `${modelRelative}/reference/color-reference.mjs`,
  `${modelRelative}/reference/scan-drive.mjs`,
  `${modelRelative}/reference/optical-response.mjs`,
  `${modelRelative}/reference/reflected-exposure.mjs`,
  `${modelRelative}/reference/rgb-aperture.mjs`,
  `${modelRelative}/reference/residual-dc-retention.mjs`,
  "docs/research/cgb-001-reference-survey.md",
  "tools/build-cgb001-ws0.mjs",
  "tools/build-cgb001-test-rom.mjs",
  "tools/decode-cgb001-test-rom.mjs",
  "tools/cgb001-libretro-smoke.c",
  "tools/validate-cgb001-ws2-gambatte.mjs",
  "tools/build-cgb001-ws2.mjs",
  "tools/build-cgb001-ws3.mjs",
  "tools/build-cgb001-ws4.mjs",
  "tools/build-cgb001-ws5.mjs",
  "tools/build-cgb001-ws6.mjs",
  "tools/build-cgb001-ws7.mjs",
  "tools/build-cgb001-ws8.mjs",
  "tools/build-cgb001-ws9.mjs",
  "tools/build-cgb001-ws9-receipt.mjs",
  "tools/validate-cgb001.mjs",
  ...requiredSchemas.map((name) => `${modelRelative}/data/${name}`),
];
for (const relative of requiredFiles) check(fs.existsSync(path.join(root, relative)), `missing WS0 file: ${relative}`);

const model = readJson(`${modelRelative}/model.json`);
const reconstruction = readJson(`${modelRelative}/data/reconstruction-v1.json`);
const receipt = readJson(`${modelRelative}/generated/ws0-scaffold-v1.json`);
const ws1Receipt = readJson(`${modelRelative}/generated/ws1-receipt-v1.json`);
const measurement = readJson(`${modelRelative}/data/hcs-source-v1.json`);
const colorRecord = readJson(`${modelRelative}/data/color-reference-v1.json`);
const colorAudit = readJson(`${modelRelative}/generated/ws1-color-audit-v1.json`);
const lutDescriptor = readJson(`${modelRelative}/generated/cgb001-d65-lut-v1.json`);
const frontendContract = readJson(`${modelRelative}/data/frontend-contract-v1.json`);
const ws2Manifest = readJson(`${modelRelative}/generated/ws2-stimulus-v1/manifest.json`);
const ws2Decoder = readJson(`${modelRelative}/generated/ws2-decoder-v1.json`);
const ws2Smoke = readJson(`${modelRelative}/generated/ws2-gambatte-smoke-v1.json`);
const ws2Receipt = readJson(`${modelRelative}/generated/ws2-receipt-v1.json`);
const ws3Evidence = readJson(`${modelRelative}/data/ws3-evidence-inventory-v1.json`);
const scanCandidates = readJson(`${modelRelative}/data/scan-candidates-v1.json`);
const ws3Constants = readJson(`${modelRelative}/generated/ws3-runtime-constants-v1.json`);
const ws3Vectors = readJson(`${modelRelative}/generated/ws3-equation-vectors-v1.json`);
const ws3Sensitivity = readJson(`${modelRelative}/generated/ws3-sensitivity-v1.json`);
const ws3Receipt = readJson(`${modelRelative}/generated/ws3-receipt-v1.json`);
const ws4Evidence = readJson(`${modelRelative}/data/ws4-evidence-inventory-v1.json`);
const ws4Policy = readJson(`${modelRelative}/data/ws4-response-policy-v1.json`);
const responseEnsemble = readJson(`${modelRelative}/data/response-ensemble-v1.json`);
const ws4RateDescriptor = readJson(`${modelRelative}/generated/cgb001-ws4-gtg-rates-v1.json`);
const ws4ModelSelection = readJson(`${modelRelative}/generated/ws4-model-selection-v1.json`);
const ws4Equations = readJson(`${modelRelative}/generated/ws4-equation-vectors-v1.json`);
const ws4Motion = readJson(`${modelRelative}/generated/ws4-motion-fixtures-v1.json`);
const ws4Receipt = readJson(`${modelRelative}/generated/ws4-receipt-v1.json`);
const ws5Policy = readJson(`${modelRelative}/data/ws5-exposure-policy-v1.json`);
const ws5Equations = readJson(`${modelRelative}/generated/ws5-equation-vectors-v1.json`);
const ws5Convergence = readJson(`${modelRelative}/generated/ws5-quadrature-convergence-v1.json`);
const ws5Fixtures = readJson(`${modelRelative}/generated/ws5-scan-exposure-fixtures-v1.json`);
const ws5Receipt = readJson(`${modelRelative}/generated/ws5-receipt-v1.json`);
const ws6Evidence = readJson(`${modelRelative}/data/ws6-evidence-inventory-v1.json`);
const aperture = readJson(`${modelRelative}/data/aperture-v1.json`);
const ws6Validation = readJson(`${modelRelative}/generated/ws6-aperture-validation-v1.json`);
const ws6Receipt = readJson(`${modelRelative}/generated/ws6-receipt-v1.json`);
const ws7Evidence = readJson(`${modelRelative}/data/ws7-evidence-inventory-v1.json`);
const retention = readJson(`${modelRelative}/data/retention-v1.json`);
const ws7Validation = readJson(`${modelRelative}/generated/ws7-retention-validation-v1.json`);
const ws7Receipt = readJson(`${modelRelative}/generated/ws7-receipt-v1.json`);
const ws8Textures = readJson(`${modelRelative}/generated/ws8-runtime-textures-v1.json`);
const ws8Compile = readJson(`${modelRelative}/generated/ws8-shader-compile-v1.json`);
const ws8Manifest = readJson(`${modelRelative}/generated/ws8-manifest-v1.json`);
const ws8Receipt = readJson(`${modelRelative}/generated/ws8-receipt-v1.json`);
const ws9CpuGolden = readJson(`${modelRelative}/generated/ws9-cpu-golden-v1.json`);
const ws9Sensitivity = readJson(`${modelRelative}/generated/ws9-sensitivity-v1.json`);
const ws9PriorArt = readJson(`${modelRelative}/generated/ws9-prior-art-comparison-v1.json`);
const ws9PresetManifest = readJson(`${modelRelative}/generated/ws9-preset-manifest-v1.json`);
const ws9Receipt = readJson(`${modelRelative}/generated/ws9-receipt-v1.json`);
const ws9TargetReceiptRelative = "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/cgb001-ws9-target-20260824.json";
const ws9TargetReceipt = readJson(ws9TargetReceiptRelative);
const referenceMarkdown = fs.readFileSync(path.join(modelDir, "REFERENCES.md"), "utf8");
const definedEvidence = new Set(
  [...referenceMarkdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
);
const expectedEvidence = new Set(expectedEvidenceIds);

check(sameSet(definedEvidence, expectedEvidence),
  `CGB evidence map drifted: expected ${expectedEvidence.size} IDs, found ${definedEvidence.size}`);
check(sameSet(new Set(model.evidenceIds ?? []), expectedEvidence), "model.json evidence ID set drifted");
check(sameSet(new Set(reconstruction.evidenceIds ?? []), expectedEvidence),
  "reconstruction-v1.json evidence ID set drifted");
for (const id of JSON.stringify({ model, reconstruction }).match(/CGB-[A-Z][A-Z0-9-]*/g) ?? []) {
  check(definedEvidence.has(id), `machine-readable record uses undefined evidence ID ${id}`);
}

check(model.schemaVersion === 1, "model.json schemaVersion must be 1");
check(model.id === "nintendo-cgb-001-period-reconstruction", "model ID drifted");
check(model.modelVersion === "1.0.0", "model version does not identify the WS9 release");
check(model.reconstructionData === "data/reconstruction-v1.json", "model reconstruction path drifted");
check(model.sourceGeometry?.logicalPixels?.join("x") === "160x144", "native source geometry drifted");
check(model.sourceGeometry?.logicalColorEncoding === "RGB555", "source encoding must remain RGB555");
check(model.defaultFrontendContract?.requiredInput === "uncorrected CGB RGB555 raster",
  "frontend default must require uncorrected RGB555");
check(model.defaultFrontendContract?.forbidPreAppliedColorCorrection === true,
  "frontend default must forbid pre-applied color correction");
check(model.defaultFrontendContract?.forbidPreAppliedGhosting === true,
  "frontend default must forbid pre-applied ghosting");
check(model.defaultFrontendContract?.status === "complete-ws2",
  "frontend default does not mark WS2 complete");
check(model.defaultReferenceCondition?.illuminant === "CIE D65", "reference illuminant drifted");
check(model.defaultReferenceCondition?.illuminationAngleDegrees === 45, "reference illumination angle drifted");
check(model.defaultReferenceCondition?.viewAngleDegrees === 0, "reference view angle drifted");
check(model.defaultReferenceCondition?.runtimeAngleModel === false, "runtime angle model must remain disabled");
check(model.generatedArtifacts?.runtimeArtifactHashes?.["generated/cgb001-d65-lut-v1.rgba32f"]
  === "273f1bf7f11c0952f7fabfac42822d0a80b199d37073171f142d1aed2fb42e4f",
"model metadata does not pin the accepted WS1 LUT hash");
check(model.generatedArtifacts?.runtimeArtifactHashes?.["generated/cgb001-ws4-gtg-rates-v1.r32f"]
  === "a43e901fbb103c578d1b26263057148d9ab8524507b5d826309879e50fb0ecf9",
"model metadata does not pin the accepted WS4 rate artifact hash");
check(model.workstreamStatus?.ws0 === "complete", "model metadata does not mark WS0 complete");
check(model.workstreamStatus?.ws1 === "complete", "model metadata does not mark WS1 complete");
check(model.workstreamStatus?.ws2 === "complete", "model metadata does not mark WS2 complete");
check(model.workstreamStatus?.ws3 === "complete", "model metadata does not mark WS3 complete");
check(model.workstreamStatus?.ws4 === "complete", "model metadata does not mark WS4 complete");
check(model.workstreamStatus?.ws5 === "complete", "model metadata does not mark WS5 complete");
check(model.workstreamStatus?.ws6 === "complete", "model metadata does not mark WS6 complete");
check(model.workstreamStatus?.ws7 === "complete", "model metadata does not mark WS7 complete");
check(model.workstreamStatus?.ws8 === "complete", "model metadata does not mark WS8 complete");
check(model.workstreamStatus?.ws9 === "complete", "model metadata does not mark WS9 complete");

check(reconstruction.schemaVersion === 1, "reconstruction schemaVersion must be 1");
check(reconstruction.recordStatus === "ws1-through-ws9-complete-release-v1",
  "canonical reconstruction status does not identify the WS9 release");
check(reconstruction.reconstructionId === "nintendo-cgb-001-reference-v1", "reconstruction ID drifted");
check(reconstruction.modelId === model.id, "model/reconstruction IDs disagree");
check(reconstruction.frozenReferenceCondition?.illuminant === "CIE D65", "frozen illuminant drifted");
check(reconstruction.frozenReferenceCondition?.illuminationAngleDegrees === 45, "frozen illumination angle drifted");
check(reconstruction.frozenReferenceCondition?.detectorAndViewerAngleDegrees === 0, "frozen viewer angle drifted");
check(reconstruction.frozenReferenceCondition?.runtimeAngleModel === false, "frozen runtime angle decision drifted");
check(reconstruction.artifactPolicy?.rawThirdPartyDataVendored === true,
  "attributed HCS source-of-record retention policy drifted");
check(reconstruction.artifactPolicy?.referenceV1NameAllowed === true,
  "reference-v1 runtime name is not enabled by the WS9 release gate");
check(reconstruction.artifactPolicy?.runtimeArtifactsAccepted?.length === 9,
  "WS9 runtime artifact inventory is incomplete");
check(reconstruction.artifactPolicy?.shaderFilesAccepted?.length === 5,
  "WS8 must accept exactly three Shader passes and two includes");
check(reconstruction.artifactPolicy?.presetFilesAccepted?.length === 20,
  "WS9 must accept exactly twenty complete presets");

const hcs = reconstruction.sourceRecords?.hcsGbcReflectance;
check(hcs?.commit === "e688fc51141c0974728aa1bdcb89b94d74123f6b", "pinned HCS commit drifted");
check(hcs?.redistribution?.licenseFoundAtPinnedRevision === false, "HCS license finding drifted");
check(hcs?.redistribution?.vendorRawArtifacts === true, "HCS source-of-record retention policy drifted");
check(hcs?.knownLimitations?.length >= 8, "HCS limitation inventory is incomplete");
const expectedSourceHashes = new Map([
  ["gbc_reflectance.ods", "967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba"],
  ["gbc_reflectance.txt", "b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37"],
]);
for (const artifact of hcs?.artifacts ?? []) {
  check(expectedSourceHashes.get(artifact.fileName) === artifact.sha256,
    `unexpected HCS source identity for ${artifact.fileName}`);
}
check((hcs?.artifacts ?? []).length === expectedSourceHashes.size, "HCS source artifact inventory drifted");
const gambatte = reconstruction.sourceRecords?.gambatteFrontend;
check(gambatte?.commit === "3262c2aa4adae8dba4f6d51cdd931c15cb11569f", "pinned Gambatte commit drifted");
check(gambatte?.sourceArchiveSha256 === "b67b5586f4a038c4e8b88cee537f59ab0878428b94a5c5bb10dd4b1870fac52f",
  "pinned Gambatte archive hash drifted");
check(reconstruction.workstreams?.ws2?.status === "complete", "canonical record does not mark WS2 complete");
check(reconstruction.workstreams?.ws3?.status === "complete", "canonical record does not mark WS3 complete");
check(reconstruction.workstreams?.ws3?.runtimeConstants === "../generated/ws3-runtime-constants-v1.json",
  "canonical record does not bind the WS3 runtime constants");
check(reconstruction.workstreams?.ws4?.status === "complete", "canonical record does not mark WS4 complete");
check(reconstruction.workstreams?.ws4?.responseRecord === "response-ensemble-v1.json",
  "canonical record does not bind the WS4 response ensemble");
check(reconstruction.workstreams?.ws5?.status === "complete",
  "canonical record does not mark WS5 complete");
check(reconstruction.workstreams?.ws5?.policy === "ws5-exposure-policy-v1.json"
    && reconstruction.workstreams?.ws5?.receipt === "../generated/ws5-receipt-v1.json",
  "canonical record does not bind the WS5 policy and receipt");
check(reconstruction.workstreams?.ws6?.status === "complete"
    && reconstruction.workstreams?.ws6?.record === "aperture-v1.json"
    && reconstruction.workstreams?.ws6?.receipt === "../generated/ws6-receipt-v1.json",
  "canonical record does not bind WS6 aperture and receipt");
check(reconstruction.workstreams?.ws7?.status === "complete"
    && reconstruction.workstreams?.ws7?.record === "retention-v1.json"
    && reconstruction.workstreams?.ws7?.receipt === "../generated/ws7-receipt-v1.json",
  "canonical record does not bind WS7 retention and receipt");
check(reconstruction.workstreams?.ws8?.status === "complete"
    && reconstruction.workstreams?.ws8?.shaderAndPresetAllowed === true
    && reconstruction.workstreams?.ws8?.manifest === "../generated/ws8-manifest-v1.json"
    && reconstruction.workstreams?.ws8?.receipt === "../generated/ws8-receipt-v1.json",
  "canonical record does not bind WS8 integration artifacts");
check(reconstruction.workstreams?.ws9?.status === "complete"
    && reconstruction.workstreams?.ws9?.schema === "release-receipt.schema.json"
    && reconstruction.workstreams?.ws9?.receipt === "../generated/ws9-receipt-v1.json"
    && reconstruction.workstreams?.ws9?.targetValidation
      === "../../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/cgb001-ws9-target-20260824.json",
  "canonical record does not bind WS9 release artifacts");

for (const name of requiredSchemas) {
  const relative = `${modelRelative}/data/${name}`;
  const schema = readJson(relative);
  check(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${name}: wrong JSON Schema dialect`);
  check(typeof schema.$id === "string" && schema.$id.length > 0, `${name}: missing $id`);
  check(schema.type === "object", `${name}: top-level type must be object`);
  check(schema.additionalProperties === false, `${name}: top-level additionalProperties must be false`);
  check(schema.required?.includes("schemaVersion"), `${name}: schemaVersion is not required`);
  check(schema.properties?.schemaVersion?.const === 1, `${name}: schemaVersion is not frozen to 1`);
  check(Object.values(reconstruction.schemaRecords ?? {}).includes(name), `${name}: not referenced by reconstruction record`);
}
check(new Set(Object.values(reconstruction.schemaRecords ?? {})).size === requiredSchemas.length,
  "canonical record does not contain exactly the WS0 schema set");

const allModelFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile()) allModelFiles.push(target);
  }
}
walk(modelDir);
const rawReferenceFiles = allModelFiles.filter((file) => [".ods", ".txt"].includes(path.extname(file).toLowerCase()));
check(rawReferenceFiles.length === 2, `expected exactly two retained HCS raw references, found ${rawReferenceFiles.length}`);
for (const file of rawReferenceFiles) {
  const expected = expectedSourceHashes.get(path.basename(file));
  check(expected === sha256(file), `retained raw reference hash drifted: ${path.relative(root, file)}`);
}
const expectedShaderFiles = new Set([
  "cgb001-color-v1.slang",
  "cgb001-common.inc",
  "cgb001-display-v1.slang",
  "cgb001-response-v1.slang",
  "cgb001-runtime-v1.inc",
]);
const expectedPresetFiles = new Set([
  "diagnostic-aperture-coverage-v1.slangp",
  "diagnostic-exposure-v1.slangp",
  "diagnostic-lut-output-v1.slangp",
  "diagnostic-residual-state-v1.slangp",
  "diagnostic-response-state-v1.slangp",
  "diagnostic-response-readback-v1.slangp",
  "diagnostic-retention-readback-v1.slangp",
  "diagnostic-exposure-readback-v1.slangp",
  "diagnostic-lut-readback-v1.slangp",
  "diagnostic-aperture-readback-v1.slangp",
  "diagnostic-row-phase-v1.slangp",
  "diagnostic-source-code-v1.slangp",
  "hcs-upstream-d65-v1.slangp",
  "no-aperture-v1.slangp",
  "no-retention-v1.slangp",
  "no-scan-v1.slangp",
  "reference-d65-v1.slangp",
  "response-fast-v1.slangp",
  "response-slow-v1.slangp",
  "static-color-only-v1.slangp",
]);
check(sameSet(new Set(fs.readdirSync(path.join(modelDir, "shaders"))), expectedShaderFiles),
  "WS8 Shader directory differs from the accepted pass/include set");
check(sameSet(new Set(fs.readdirSync(path.join(modelDir, "presets"))), expectedPresetFiles),
  "WS8 preset directory differs from the complete required set");
const generatedFiles = fs.readdirSync(path.join(modelDir, "generated"));
const expectedGeneratedFiles = new Set([
  "ws0-scaffold-v1.json",
  "ws1-receipt-v1.json",
  "ws1-color-audit-v1.json",
  "ws1-perceptual-v1.json",
  "ws1-static-fixtures-v1.json",
  "cgb001-d65-lut-v1.json",
  "cgb001-d65-lut-v1.rgba32f",
  "ws2-stimulus-v1",
  "ws2-decoder-v1.json",
  "ws2-gambatte-smoke-v1.json",
  "ws2-receipt-v1.json",
  "ws3-runtime-constants-v1.json",
  "ws3-equation-vectors-v1.json",
  "ws3-sensitivity-v1.json",
  "ws3-receipt-v1.json",
  "cgb001-ws4-gtg-rates-v1.r32f",
  "cgb001-ws4-gtg-rates-v1.json",
  "ws4-model-selection-v1.json",
  "ws4-equation-vectors-v1.json",
  "ws4-motion-fixtures-v1.json",
  "ws4-receipt-v1.json",
  "ws5-equation-vectors-v1.json",
  "ws5-quadrature-convergence-v1.json",
  "ws5-scan-exposure-fixtures-v1.json",
  "ws5-receipt-v1.json",
  "ws6-aperture-validation-v1.json",
  "ws6-receipt-v1.json",
  "ws7-retention-validation-v1.json",
  "ws7-receipt-v1.json",
  "cgb001-reference-d65-v1.png",
  "cgb001-hcs-upstream-d65-v1.png",
  "cgb001-reference-d65-v1-hi-rgba8.png",
  "cgb001-reference-d65-v1-lo-rgba8.png",
  "cgb001-hcs-upstream-d65-v1-hi-rgba8.png",
  "cgb001-hcs-upstream-d65-v1-lo-rgba8.png",
  "ws8-runtime-textures-v1.json",
  "ws8-shader-compile-v1.json",
  "ws8-manifest-v1.json",
  "ws8-receipt-v1.json",
  "ws9-cpu-golden-v1.json",
  "ws9-sensitivity-v1.json",
  "ws9-prior-art-comparison-v1.json",
  "ws9-preset-manifest-v1.json",
  "ws9-receipt-v1.json",
]);
check(sameSet(new Set(generatedFiles), expectedGeneratedFiles),
  "generated directory does not exactly match accepted WS0 through WS9 artifacts");

check(receipt.receiptId === "cgb001-ws0-scaffold-v1", "unexpected WS0 receipt ID");
check(receipt.modelId === model.id, "WS0 receipt model ID drifted");
check(receipt.result?.status === "pass", "WS0 receipt does not pass");
check(receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS0 receipt incorrectly allows a reference-v1 Shader or preset");
check(receipt.historicalScopeAtCompletion?.shaderCreated === false
    && receipt.historicalScopeAtCompletion?.presetCreated === false,
  "WS0 receipt incorrectly claims a Shader or preset");
for (const [relative, expectedHash] of Object.entries(receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS0 receipt tracks a missing file: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS0 receipt hash is stale: ${relative}`);
}

checkTopLevelSchema(
  measurement,
  readJson(`${modelRelative}/data/measurement-normalization.schema.json`),
  "hcs-source-v1.json",
);
checkTopLevelSchema(
  colorRecord,
  readJson(`${modelRelative}/data/color-model.schema.json`),
  "color-reference-v1.json",
);
check(measurement.status === "complete", "measurement normalization is not complete at WS1");
check(measurement.audit?.txtCrossCheck?.pass === true, "ODS/TXT cross-check does not pass");
check(measurement.audit?.seriesPatchCounts?.R === 31, "raw R patch count was not preserved");
check(measurement.audit?.seriesPatchCounts?.G === 33, "raw G patch count was not preserved");
check(measurement.audit?.negativeReflectancePresent === true, "raw negative spectra finding was lost");
check(measurement.audit?.blackDriftPresent === true, "raw black-drift finding was lost");
check(measurement.normalizationPolicy?.rawMutation === false, "normalization policy permits raw mutation");
for (const artifact of [...(measurement.sourceArtifacts ?? []), ...(measurement.cieReferences ?? [])]) {
  const file = path.join(root, artifact.repositoryPath ?? "missing");
  check(artifact.verified === true, `source artifact is not marked verified: ${artifact.fileName}`);
  check(fs.existsSync(file), `source artifact is missing: ${artifact.repositoryPath}`);
  if (fs.existsSync(file)) check(sha256(file) === artifact.sha256, `source artifact hash drifted: ${artifact.repositoryPath}`);
}

check(colorRecord.validation?.status === "pass", "color reference validation does not pass");
check(colorRecord.interactionPolicy?.selectedCandidate === "runtime-monotonic-lut",
  "unexpected WS1 selected color candidate");
check(colorRecord.referenceCondition?.runtimeAngleModel === false, "WS1 color record enabled an angle model");
check(colorRecord.validation?.targetExposureBakedIn === false, "WS1 LUT baked in target exposure");
check(colorAudit.result?.pass === true, "WS1 color audit does not pass");
check(colorAudit.candidateSelection?.pass === true, "WS1 candidate-selection gate does not pass");
check(colorAudit.monotonicRuntimeProjection?.after?.violationCount === 0,
  "WS1 runtime LUT retains luminance monotonicity violations");
check(colorAudit.lutValidation?.nonFiniteCount === 0, "WS1 LUT contains non-finite values");
check(colorAudit.lutValidation?.negativeComponentCount === 0, "WS1 LUT contains negative components");

const lutFile = path.join(modelDir, "generated/cgb001-d65-lut-v1.rgba32f");
check(fs.statSync(lutFile).size === 32 ** 3 * 16, "WS1 RGBA32F LUT byte length is incorrect");
check(sha256(lutFile) === lutDescriptor.sha256, "LUT binary hash does not match its descriptor");
check(lutDescriptor.dimensions?.join("x") === "32x32x32", "LUT descriptor dimensions drifted");

check(ws1Receipt.receiptId === "cgb001-ws1-receipt-v1", "unexpected WS1 receipt ID");
check(ws1Receipt.result?.status === "pass" && ws1Receipt.result?.ws1Complete === true,
  "WS1 receipt does not pass");
check(ws1Receipt.gates?.shaderOrPresetCreated === false,
  "WS1 receipt incorrectly claims a Shader or preset");
for (const [relative, expectedHash] of Object.entries(ws1Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS1 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS1 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws1Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS1 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS1 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  frontendContract,
  readJson(`${modelRelative}/data/frontend-contract.schema.json`),
  "frontend-contract-v1.json",
);
check(frontendContract.validation?.status === "pass", "WS2 frontend contract does not pass");
check(frontendContract.validation?.shaderImplemented === false, "WS2 frontend contract claims a Shader");
check(frontendContract.core?.commit === "3262c2aa4adae8dba4f6d51cdd931c15cb11569f",
  "WS2 frontend contract core commit drifted");
check(frontendContract.core?.sourceArchiveSha256 === "b67b5586f4a038c4e8b88cee537f59ab0878428b94a5c5bb10dd4b1870fac52f",
  "WS2 frontend contract source archive drifted");
check(frontendContract.colorCodes?.corePixelFormat === "RETRO_PIXEL_FORMAT_RGB565",
  "WS2 core pixel format drifted");
check(frontendContract.colorCodes?.exhaustiveProof?.testedRgb555Codes === 32768
    && frontendContract.colorCodes?.exhaustiveProof?.uniqueRgb565Words === 32768,
  "WS2 RGB555 transport proof is not exhaustive and injective");
check(frontendContract.correctionPolicy?.requiredCoreOptions?.gambatte_gbc_color_correction === "disabled",
  "WS2 permits Gambatte color correction");
check(frontendContract.correctionPolicy?.requiredCoreOptions?.gambatte_dark_filter_level === "0",
  "WS2 permits the Gambatte dark filter");
check(frontendContract.correctionPolicy?.requiredCoreOptions?.gambatte_mix_frames === "disabled",
  "WS2 permits Gambatte frame blending");
check(frontendContract.validation?.negativeCases?.every((test) => test.status === "pass"),
  "WS2 fail-closed negative cases do not all pass");
check(ws2Manifest.scenes?.length === 16, "WS2 ROM manifest does not contain 16 scenes");
check(ws2Manifest.scenes?.every((scene) => scene.proprietaryNintendoLogoPresent === false),
  "WS2 ROM manifest includes a proprietary Nintendo logo");
for (const scene of ws2Manifest.scenes ?? []) {
  const rom = path.join(modelDir, "generated/ws2-stimulus-v1", scene.filename);
  check(fs.existsSync(rom), `WS2 ROM is missing: ${scene.filename}`);
  if (fs.existsSync(rom)) check(sha256(rom) === scene.sha256, `WS2 ROM hash drifted: ${scene.filename}`);
}
check(ws2Decoder.summary?.pass === true && ws2Decoder.summary?.scenes === 16,
  "WS2 independent ROM decoder does not pass");
check(ws2Smoke.summary?.pass === true && ws2Smoke.summary?.scenes === 16,
  "WS2 pinned Gambatte smoke does not pass");
check(ws2Smoke.transportProof?.testedRgb555Codes === 32768,
  "WS2 Gambatte smoke lacks the exhaustive transport proof");
check(ws2Smoke.summary?.actualCoreExhaustiveRgb555Codes === 32768,
  "WS2 exhaustive ROM did not emit all RGB555 values through the actual core");
check(ws2Receipt.receiptId === "cgb001-ws2-receipt-v1", "unexpected WS2 receipt ID");
check(ws2Receipt.result?.status === "pass" && ws2Receipt.result?.ws2Complete === true,
  "WS2 receipt does not pass");
check(ws2Receipt.gates?.shaderOrPresetCreated === false, "WS2 receipt incorrectly claims a Shader or preset");
for (const [relative, expectedHash] of Object.entries(ws2Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS2 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS2 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws2Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS2 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS2 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  scanCandidates,
  readJson(`${modelRelative}/data/scan-candidates.schema.json`),
  "scan-candidates-v1.json",
);
check(ws3Evidence.inventoryId === "cgb001-ws3-evidence-inventory-v1",
  "unexpected WS3 evidence inventory ID");
check(ws3Evidence.items?.every((item) => Array.isArray(item.claimsUsed)
    && typeof item.limits === "string" && item.limits.length > 0),
"WS3 evidence items do not all retain claims and limits");
const expectedSignals = new Set([
  "LDR0-LDR5", "LDG0-LDG5", "LDB0-LDB5", "DCK", "SPL", "LP", "PS", "SPS", "CLS", "MOD", "REVC",
]);
check(sameSet(new Set(scanCandidates.signalEvidence?.map((entry) => entry.signal) ?? []), expectedSignals),
  "WS3 CGB signal inventory is incomplete or contains extra signals");
check(scanCandidates.signalEvidence?.length === expectedSignals.size,
  "WS3 CGB signal inventory contains duplicate entries");
check(scanCandidates.sourceBusMapping?.formalSelection === null,
  "WS3 improperly selects an RGB555-to-six-line mapping");
check(scanCandidates.sourceBusMapping?.runtimeBoundary?.id === "logical-rgb555-coordinate",
  "WS3 runtime does not preserve the safe RGB555 logical coordinate");
check(Object.values(scanCandidates.selection?.formalCgbSpecificConstants ?? {}).every((value) => value === null),
  "WS3 claims unavailable exact CGB electrical constants");
for (const name of ["sourceLatchPhase", "rowActivationDelay", "frameParityPhase", "inversionTopology"]) {
  const candidateSet = scanCandidates.candidateSets?.[name];
  check(candidateSet?.formalSelection === null, `WS3 ${name} must remain a nullable exact-CGB selection`);
  check(candidateSet?.candidates?.some((candidate) => candidate.id === candidateSet.periodReconstructionDefault),
    `WS3 ${name} default is not present in its candidate list`);
}
const ws3Timing = scanCandidates.timing?.ppuTimebase;
check(ws3Timing?.masterClockHz === 4194304, "WS3 master clock drifted");
check(ws3Timing?.dotsPerLine === 456 && ws3Timing?.totalLines === 154,
  "WS3 line timebase drifted");
check(ws3Timing?.visibleLines === 144 && ws3Timing?.verticalBlankLines === 10,
  "WS3 visible/blank raster drifted");
check(ws3Timing?.dotsPerFrame === 70224 && ws3Timing?.dotsPerLine * ws3Timing?.totalLines === 70224,
  "WS3 frame dot count drifted");
check(ws3Timing?.frameSeconds === 70224 / 4194304,
  "WS3 exact frame duration no longer derives from the selected timebase");
check(scanCandidates.timing?.panelSignalTimingBoundary?.status === "unresolved"
    && scanCandidates.timing?.panelSignalTimingBoundary?.formalCgbPanelTraceAvailable === false,
  "WS3 conflates the PPU timebase with a measured CGB panel trace");

check(ws3Constants.recordId === "cgb001-ws3-runtime-constants-v1",
  "unexpected WS3 runtime constants identity");
check(ws3Constants.sourceOfTruth?.path === `${modelRelative}/data/scan-candidates-v1.json`,
  "WS3 constants do not name the normalized candidate record as source of truth");
check(ws3Constants.sourceOfTruth?.sha256
    === sha256(path.join(modelDir, "data/scan-candidates-v1.json")),
  "WS3 runtime constants source hash is stale");
check(ws3Constants.electricalClaimBoundary?.codeCoordinateIsVoltage === false,
  "WS3 incorrectly labels the logical source coordinate as voltage");
check(ws3Constants.electricalClaimBoundary?.transferredComparableSharpVoltages?.length === 0,
  "WS3 transfers numeric voltages from a comparable Sharp module");

check(ws3Vectors.reportId === "cgb001-ws3-equation-vectors-v1",
  "unexpected WS3 equation-vector identity");
check(ws3Vectors.coverage?.fixtureCount === 450, "WS3 equation coverage count drifted");
check(sameSet(new Set(ws3Vectors.coverage?.rows?.map((entry) => entry.row) ?? []),
  new Set([0, 71, 143, 144, 153])), "WS3 equation vectors omit a required visible/blank row");
check(sameSet(new Set(ws3Vectors.coverage?.parityPhases?.map((entry) => entry.value) ?? []),
  new Set([0, 1])), "WS3 equation vectors do not cover both parity phases");
check(ws3Vectors.agreement?.pass === true
    && ws3Vectors.agreement?.polarityMismatchCount === 0
    && ws3Vectors.agreement?.frameOffsetMismatchCount === 0,
  "WS3 CPU/future-Shader float32 equations do not agree");
check(ws3Vectors.invariance?.constantFieldCases === 864
    && ws3Vectors.invariance?.pass === true,
  "WS3 constant-field invariance coverage does not pass");
check(ws3Vectors.invariance?.spatialImpulse?.actualAffectedPixelCount === 1,
  "WS3 drive is not pixel-local");
check(ws3Vectors.invariance?.ws1Lut?.sha256Before === lutDescriptor.sha256
    && ws3Vectors.invariance?.ws1Lut?.sha256After === lutDescriptor.sha256
    && ws3Vectors.invariance?.ws1Lut?.maximumStaticColorDifferenceCausedByWs3 === 0,
  "WS3 changed or bypassed the accepted WS1 static color artifact");

check(ws3Sensitivity.reportId === "cgb001-ws3-sensitivity-v1" && ws3Sensitivity.pass === true,
  "WS3 sensitivity report does not pass");
check(ws3Sensitivity.timing?.profileCount === 9
    && ws3Sensitivity.timing?.visibleOnsetOffsetRangeLines?.join(",") === "0,2",
  "WS3 timing sensitivity does not span the declared latch/delay candidates");
check(ws3Sensitivity.sourceBusMapping?.formalRgb555ToSixLineSelection === null
    && ws3Sensitivity.sourceBusMapping?.diagnosticsExcludedFromRuntime === true
    && ws3Sensitivity.sourceBusMapping?.differingCodeCount === 16,
  "WS3 sixth-line uncertainty is not preserved as diagnostic-only");
check(ws3Sensitivity.constantFieldAndLocality?.ws1StaticColorDifference === 0
    && ws3Sensitivity.constantFieldAndLocality?.affectedPixelsForSinglePixelImpulse === 1,
  "WS3 sensitivity changed static color or introduced spatial coupling");

check(ws3Receipt.receiptId === "cgb001-ws3-receipt-v1", "unexpected WS3 receipt ID");
check(ws3Receipt.result?.status === "pass" && ws3Receipt.result?.ws3Complete === true,
  "WS3 receipt does not pass");
check(ws3Receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS3 receipt incorrectly permits a reference-v1 Shader or preset");
check(Object.entries(ws3Receipt.gates ?? {}).every(([name, value]) =>
  name === "shaderOrPresetCreated" ? value === false : value === true),
"one or more WS3 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws3Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS3 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS3 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws3Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS3 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS3 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  responseEnsemble,
  readJson(`${modelRelative}/data/response-ensemble.schema.json`),
  "response-ensemble-v1.json",
);
check(ws4Evidence.inventoryId === "cgb001-ws4-evidence-inventory-v1",
  "unexpected WS4 evidence inventory ID");
check(ws4Evidence.items?.length === 6, "WS4 evidence inventory must retain exactly six normalized items");
check(ws4Evidence.items?.every((item) => Array.isArray(item.claimsUsed)
    && typeof item.limits === "string" && item.limits.length > 0),
"WS4 evidence items do not all retain claims and explicit limits");
const sharpResponseEvidence = ws4Evidence.items?.find((item) => item.itemId === "sharp-hr-tft-1997-response");
check(sharpResponseEvidence?.identity?.displaySizeInches === 6.5
    && sharpResponseEvidence?.identity?.dotFormat?.join("x") === "640x240",
  "WS4 Sharp response source identity drifted");
check(sharpResponseEvidence?.responseMilliseconds?.HCR?.onAndOff === 50
    && sharpResponseEvidence?.responseMilliseconds?.HCR?.grayScales === 80
    && sharpResponseEvidence?.responseMilliseconds?.GH?.onAndOff === 80
    && sharpResponseEvidence?.responseMilliseconds?.GH?.grayScales === 150,
  "WS4 manufacturer-family response values drifted");
check(["temperatureC", "responseThresholdDefinition", "directionSeparation", "grayTransitionPair",
  "measurementInstrument"].every((key) => sharpResponseEvidence?.conditions?.[key] === null),
"WS4 source omissions are no longer represented as explicit nulls");
check(ws4Evidence.items?.some((item) => item.itemId === "exact-cgb-response-gap"
    && item.classification === "negative-evidence-record"),
"WS4 exact-CGB response gap is not retained as negative evidence");

check(ws4Policy.policyId === "cgb001-ws4-response-policy-v1", "unexpected WS4 response policy ID");
check(ws4Policy.familyAnchors?.HCR?.onAndOffMilliseconds === 50
    && ws4Policy.familyAnchors?.HCR?.grayScalesMilliseconds === 80
    && ws4Policy.familyAnchors?.GH?.onAndOffMilliseconds === 80
    && ws4Policy.familyAnchors?.GH?.grayScalesMilliseconds === 150,
  "WS4 family compatibility anchors drifted");
check(ws4Policy.runtimeResponseDefinition?.classification === "period-reconstructed-conversion"
    && ws4Policy.runtimeResponseDefinition?.equation === "t10to90 = ln(9) / rate",
  "WS4 reconstructed response definition drifted");
check(ws4Policy.state?.codeMapping === "code5 / 31"
    && ws4Policy.state?.units?.includes("not volts")
    && ws4Policy.state?.snapEpsilon?.value === 1 / 65_536,
  "WS4 dimensionless response-state contract drifted");
const expectedWs4Candidates = new Set([
  "symmetric-first-order-rate-field",
  "asymmetric-first-order-rate-field",
  "two-state-cascade",
]);
check(sameSet(new Set(ws4Policy.modelCandidates?.map((candidate) => candidate.id) ?? []), expectedWs4Candidates),
  "WS4 response-policy candidate set drifted");
check(ws4Policy.selection?.selectedCandidate === "symmetric-first-order-rate-field",
  "WS4 policy no longer selects the smallest evidence-compatible response model");
const expectedWs4Members = new Map([
  ["hcr-like-fast", ["fast", 50, 80]],
  ["mid-envelope-nominal", ["nominal", 65, 115]],
  ["gh-like-slow", ["slow", 80, 150]],
]);
check(ws4Policy.members?.length === expectedWs4Members.size, "WS4 policy must contain fast/nominal/slow members");
for (const member of ws4Policy.members ?? []) {
  const expected = expectedWs4Members.get(member.id);
  check(expected?.[0] === member.role
      && expected?.[1] === member.parameters?.onAndOffT10To90Milliseconds
      && expected?.[2] === member.parameters?.grayT10To90Milliseconds,
    `WS4 member parameters drifted: ${member.id}`);
}
check(ws4Policy.heldNeutralDimensions?.channelMultipliers?.r === 1
    && ws4Policy.heldNeutralDimensions?.channelMultipliers?.g === 1
    && ws4Policy.heldNeutralDimensions?.channelMultipliers?.b === 1
    && ws4Policy.heldNeutralDimensions?.referenceTemperatureC?.runtimeCoefficientAvailable === false
    && ws4Policy.heldNeutralDimensions?.directionAsymmetry?.selected === false
    && ws4Policy.heldNeutralDimensions?.overshoot?.selected === false,
  "WS4 unresolved channel/temperature/direction/overshoot dimensions are not held neutral");
check(ws4Policy.specimenOverride?.shaderInterfaceChangesRequired === false
    && ws4Policy.specimenOverride?.currentMeasuredCellCount === 0,
  "WS4 future measured-cell override contract drifted");

check(responseEnsemble.ensembleId === "cgb001-ws4-response-ensemble-v1",
  "unexpected WS4 response ensemble ID");
check(responseEnsemble.validation?.status === "pass"
    && responseEnsemble.validation?.generatedCellCount === 9_216
    && responseEnsemble.validation?.measuredOverrideCellCount === 0,
  "WS4 response ensemble validation does not pass");
check(responseEnsemble.responseDefinition?.conversionStatus === "period-reconstructed-conversion"
    && responseEnsemble.selectedModel?.candidateId === "symmetric-first-order-rate-field",
  "WS4 response ensemble overstates or changes the selected model");
check(responseEnsemble.stateDefinition?.units?.includes("not volts")
    && responseEnsemble.stateDefinition?.codeMapping === "code5 / 31",
  "WS4 response ensemble no longer preserves the dimensionless state boundary");
check(responseEnsemble.runtimeArtifact?.dimensions?.join("x") === "3x3x32x32",
  "WS4 response ensemble runtime dimensions drifted");
check(responseEnsemble.specimenOverrideContract?.shaderInterfaceChangesRequired === false,
  "WS4 response ensemble no longer supports measured-cell replacement without an interface change");

check(ws4ModelSelection.reportId === "cgb001-ws4-model-selection-v1"
    && ws4ModelSelection.pass === true,
  "WS4 model-selection report does not pass");
check(sameSet(new Set(ws4ModelSelection.candidates?.map((candidate) => candidate.candidateId) ?? []),
  expectedWs4Candidates), "WS4 model-selection report candidate set drifted");
check(ws4ModelSelection.selectedCandidate === "symmetric-first-order-rate-field",
  "WS4 model-selection report selected an unsupported candidate");
const selectedWs4Candidate = ws4ModelSelection.candidates?.find((candidate) => candidate.selection === "selected");
check(selectedWs4Candidate?.candidateId === "symmetric-first-order-rate-field"
    && selectedWs4Candidate?.stateCountPerChannel === 1
    && typeof selectedWs4Candidate?.identifiableFromAcceptedEvidence === "string",
  "WS4 selected-candidate evidence qualification drifted");
check(ws4ModelSelection.candidates?.filter((candidate) => candidate.selection === "rejected-for-default")
    .every((candidate) => candidate.identifiableFromAcceptedEvidence === false),
  "WS4 rejected candidates are not marked unidentifiable from accepted evidence");
check(ws4ModelSelection.anchorFixtures?.length === 12
    && ws4ModelSelection.anchorFixtures?.every((fixture) => fixture.absoluteErrorMilliseconds <= 1e-12),
  "WS4 selected model does not reproduce all twelve scalar compatibility anchors");

const ws4RateFile = path.join(modelDir, "generated/cgb001-ws4-gtg-rates-v1.r32f");
const ws4RateBuffer = fs.readFileSync(ws4RateFile);
check(ws4RateBuffer.length === 9_216 * 4, "WS4 R32F rate artifact byte length is incorrect");
check(ws4RateDescriptor.artifactId === "cgb001-ws4-gtg-rates-v1",
  "unexpected WS4 rate descriptor ID");
check(ws4RateDescriptor.binary?.sha256 === sha256(ws4RateFile)
    && responseEnsemble.runtimeArtifact?.sha256 === sha256(ws4RateFile),
  "WS4 rate binary hash does not match its descriptor and response record");
check(ws4RateDescriptor.dimensions?.join("x") === "3x3x32x32"
    && ws4RateDescriptor.axisOrder === "member, channel, fromCode, toCode; toCode fastest",
  "WS4 rate descriptor dimensions or axis order drifted");
check(ws4RateDescriptor.coverage?.generatedCells === 9_216
    && ws4RateDescriptor.coverage?.measuredOverrideCells === 0
    && ws4RateDescriptor.coverage?.runtimeFallbackCells === 0,
  "WS4 rate artifact coverage drifted");
check(ws4RateDescriptor.cells?.length === 9_216, "WS4 rate descriptor does not enumerate every cell");
for (const [index, cell] of (ws4RateDescriptor.cells ?? []).entries()) {
  const packed = ws4RateBuffer.readFloatLE(index * 4);
  const expectedIndex = (((cell.address?.memberIndex * 3) + cell.address?.channelIndex) * 32
    + cell.address?.fromCode) * 32 + cell.address?.toCode;
  check(cell.linearIndex === index && expectedIndex === index, `WS4 rate cell addressing drifted at index ${index}`);
  check(Number.isFinite(packed) && packed > 0 && packed === cell.packedFloat32RatePerSecond,
    `WS4 rate binary/descriptor mismatch at index ${index}`);
  check(typeof cell.provenanceId === "string" && typeof cell.fallbackId === "string",
    `WS4 rate cell lacks provenance/fallback at index ${index}`);
}

check(ws4Equations.reportId === "cgb001-ws4-equation-vectors-v1",
  "unexpected WS4 equation-vector report ID");
check(ws4Equations.coverage?.cells === 9_216
    && ws4Equations.coverage?.cases === 46_080
    && ws4Equations.coverage?.fromCodeRange?.join(",") === "0,31"
    && ws4Equations.coverage?.toCodeRange?.join(",") === "0,31",
  "WS4 equation coverage is not exhaustive over all declared cells/timesteps");
check(ws4Equations.agreement?.pass === true
    && ws4Equations.agreement?.maximumAbsoluteError <= ws4Equations.agreement?.tolerance
    && ws4Equations.agreement?.tolerance === 2e-7,
  "WS4 CPU/future-Shader float32 equation agreement does not pass");
check(ws4Equations.safety?.pass === true
    && ws4Equations.safety?.nonFiniteCount === 0
    && ws4Equations.safety?.outOfBoundsCount === 0
    && ws4Equations.safety?.nonMonotoneCount === 0
    && ws4Equations.safety?.identityMismatchCount === 0
    && ws4Equations.safety?.convergenceFailureCount === 0
    && ws4Equations.safety?.maximumFramesToExactTarget <= 34
    && ws4Equations.safety?.futurePrefixCases === 4
    && ws4Equations.safety?.futureGhostMaximumDifference === 0,
  "WS4 response safety, exact convergence, or no-future-frame gates do not pass");
check(ws4Equations.actualGpuReadback === false,
  "WS4 equation receipt incorrectly claims actual GPU readback");

check(ws4Motion.reportId === "cgb001-ws4-motion-fixtures-v1",
  "unexpected WS4 motion-fixture report ID");
check(ws4Motion.fixtures?.length === 4 && ws4Motion.traces?.length === 12,
  "WS4 motion-fixture coverage drifted");
check(ws4Motion.validation?.pass === true
    && ws4Motion.validation?.distinctTransientFixtureCount === 4
    && ws4Motion.validation?.settledStateMismatchCount === 0
    && ws4Motion.validation?.settledColorByteMismatchCount === 0,
  "WS4 fast/nominal/slow motion fixtures do not preserve the endpoint contract");
check(ws4Motion.validation?.ws1LutSha256Before === lutDescriptor.sha256
    && ws4Motion.validation?.ws1LutSha256After === lutDescriptor.sha256
    && ws4Motion.validation?.ws1StaticColorDifference === 0,
  "WS4 response ensemble changed the accepted WS1 settled colors");

check(ws4Receipt.receiptId === "cgb001-ws4-receipt-v1", "unexpected WS4 receipt ID");
check(ws4Receipt.result?.status === "pass" && ws4Receipt.result?.ws4Complete === true,
  "WS4 receipt does not pass");
check(ws4Receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS4 receipt incorrectly permits a reference-v1 Shader or preset");
check(ws4Receipt.gates?.smallestEvidenceCompatibleModelSelected === true,
  "WS4 receipt does not select the smallest evidence-compatible model");
check(Object.entries(ws4Receipt.gates ?? {}).every(([name, value]) =>
  ["retentionStateCreated", "shaderOrPresetCreated"].includes(name) ? value === false : value === true),
"one or more WS4 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws4Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS4 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS4 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws4Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS4 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS4 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  ws5Policy,
  readJson(`${modelRelative}/data/exposure-integration.schema.json`),
  "ws5-exposure-policy-v1.json",
);
check(ws5Policy.policyId === "cgb001-ws5-reflected-exposure-policy-v1",
  "unexpected WS5 exposure-policy ID");
check(ws5Policy.classification === "measured-constrained-period-reconstructed-integration",
  "WS5 exposure-policy classification drifted");
check(ws5Policy.referenceCondition?.illuminant === "CIE D65"
    && ws5Policy.referenceCondition?.illuminationAngleDegrees === 45
    && ws5Policy.referenceCondition?.viewAngleDegrees === 0
    && ws5Policy.referenceCondition?.runtimeAngleModel === false
    && ws5Policy.referenceCondition?.azimuth?.valueDegrees === null,
  "WS5 fixed geometry or unknown-azimuth boundary drifted");
check(ws5Policy.referenceCondition?.geometryApplication?.includes("no second MRS"),
  "WS5 policy no longer forbids double-applying the fixed geometry");
check(ws5Policy.observationInterval?.masterClockHz === 4_194_304
    && ws5Policy.observationInterval?.dotsPerFrame === 70_224
    && ws5Policy.observationInterval?.secondsPerFrame === 70_224 / 4_194_304
    && ws5Policy.observationInterval?.nativeFramesPerSupportedExecution === 1
    && ws5Policy.observationInterval?.hostRefreshChangesNativePanelClock === false,
  "WS5 native observation interval drifted");
check(ws5Policy.stateAndRateContract?.rateAddress
    === "ensembleMember/channel/nearestSegmentStartCode/targetCode"
    && ws5Policy.stateAndRateContract?.nearestSegmentStartCode
      === "floor(clamp(state, 0, 1) * 31 + 0.5)"
    && ws5Policy.stateAndRateContract?.unchangedChannel?.includes("retain its first-segment rate"),
  "WS5 segment-rate addressing or unchanged-channel contract drifted");
check(ws5Policy.scanIntegration?.defaultCandidate?.sourceLatchPhase === "line-start"
    && ws5Policy.scanIntegration?.defaultCandidate?.rowActivationDelay === "at-latch"
    && ws5Policy.scanIntegration?.bounds?.sourceLatchPhaseLines?.join(",") === "0,1"
    && ws5Policy.scanIntegration?.bounds?.rowActivationDelayLines?.join(",") === "0,1",
  "WS5 scan-integration candidate boundary drifted");
check(ws5Policy.opticalIntegration?.integrand
    === "trilinearSample(WS1_XYZ_LUT, stateRGB(t))"
    && ws5Policy.opticalIntegration?.targetCompensation === "none"
    && ws5Policy.opticalIntegration?.futureShaderContract?.method
      === "composite two-point Gauss-Legendre"
    && ws5Policy.opticalIntegration?.futureShaderContract?.panelsPerNativeFrame === 32
    && ws5Policy.opticalIntegration?.futureShaderContract?.maximumSamplesPerPixelFrame === 66
    && ws5Policy.opticalIntegration?.futureShaderContract?.actualGpuReadback === false,
  "WS5 optical integration or future-Shader quadrature contract drifted");
const expectedWs5OutputModes = new Set([
  "physical-reflectance",
  "reference-white-y-normalized",
  "frame-endpoint-diagnostic",
  "static-ws1-bypass",
]);
check(sameSet(new Set(ws5Policy.outputModes?.map((mode) => mode.id) ?? []), expectedWs5OutputModes),
  "WS5 output-mode set drifted");
check(ws5Policy.outputModes?.find((mode) => mode.id === "physical-reflectance")?.clipped === false
    && ws5Policy.outputModes?.find((mode) => mode.id === "reference-white-y-normalized")
      ?.targetDeviceSpecific === false,
  "WS5 physical and optional host output coordinates are no longer separated");
check(ws5Policy.intervalHandling?.length === 8
    && ws5Policy.intervalHandling?.some((entry) => entry.id === "pause"
      && entry.status === "freeze-state-and-output")
    && ws5Policy.intervalHandling?.some((entry) => entry.id === "frontend-generated-duplicate-or-skipped-frame"
      && entry.status === "unsupported-static-bypass"),
  "WS5 interval handling no longer follows the WS2 fail-closed contract");
check(ws5Policy.validationContract?.deterministicRandomCases === 1_000
    && ws5Policy.validationContract?.maximumQuadratureAbsoluteXyzError === 5e-5
    && ws5Policy.validationContract?.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError === 2e-7
    && ws5Policy.validationContract?.staticExactTolerance === 0,
  "WS5 validation thresholds drifted");

check(ws5Equations.reportId === "cgb001-ws5-equation-vectors-v1"
    && ws5Equations.equationId === "CGB-WS5-REFLECTED-EXPOSURE-V1",
  "unexpected WS5 equation-vector identity");
check(ws5Equations.runtimeArtifacts?.ws1LutSha256 === lutDescriptor.sha256
    && ws5Equations.runtimeArtifacts?.ws4RateSha256 === ws4RateDescriptor.binary?.sha256,
  "WS5 equation report does not bind the accepted WS1/WS4 artifacts");
check(ws5Equations.coverage?.curatedFixtureCount === 126
    && ws5Equations.coverage?.deterministicRandomFixtureCount === 1_000
    && ws5Equations.coverage?.totalFixtureCount === 1_126
    && ws5Equations.coverage?.xyzComponentCases === 3_378
    && ws5Equations.coverage?.randomSeedHex === "0x5a17c9e3",
  "WS5 equation coverage drifted");
check(ws5Equations.agreement?.pass === true
    && ws5Equations.agreement?.maximumQuadratureAbsoluteXyzError
      <= ws5Equations.agreement?.quadratureTolerance
    && ws5Equations.agreement?.quadratureTolerance === 5e-5
    && ws5Equations.agreement?.maximumFutureShaderFloat32VsDoubleAbsoluteXyzError
      <= ws5Equations.agreement?.futureShaderFloat32Tolerance
    && ws5Equations.agreement?.futureShaderFloat32Tolerance === 2e-7
    && ws5Equations.agreement?.maximumEndpointFloat32AbsoluteError <= 2e-7,
  "WS5 analytic/quadrature/float32 equation agreement does not pass");
check(ws5Equations.safety?.pass === true
    && ws5Equations.safety?.nonFiniteCount === 0
    && ws5Equations.safety?.endpointOutOfRangeCount === 0
    && ws5Equations.safety?.noFutureSourceArgument === true
    && ws5Equations.safety?.actualGpuReadback === false,
  "WS5 equation safety or GPU claim boundary does not pass");
check(ws5Equations.curatedVectors?.length === 126
    && ws5Equations.curatedVectors?.every((vector) => finiteVector(vector.exactAverageXyz)
      && finiteVector(vector.runtimeAverageXyz)
      && finiteVector(vector.futureShaderFloat32AverageXyz)
      && vector.futureShaderSampleCount <= 66
      && vector.quadratureError <= 5e-5
      && vector.float32VsDoubleError <= 2e-7),
  "WS5 curated equation vectors are incomplete or violate their gates");

check(ws5Convergence.reportId === "cgb001-ws5-quadrature-convergence-v1"
    && ws5Convergence.pass === true,
  "WS5 quadrature-convergence report does not pass");
check(ws5Convergence.coverage?.fixturesPerProfile === 126
    && ws5Convergence.coverage?.profiles === 9
    && ws5Convergence.coverage?.includesFastestMemberLastVisibleRow === true
    && ws5Convergence.coverage?.fastestLastRowFixtureIds?.length === 7,
  "WS5 quadrature convergence omits required fixtures");
check(ws5Convergence.selectedContract?.order === 2
    && ws5Convergence.selectedContract?.panelsPerNativeFrame === 32
    && ws5Convergence.selectedContract?.maximumSamplesPerPixelFrame === 66
    && ws5Convergence.selectedContract?.tolerance === 5e-5,
  "WS5 selected quadrature contract drifted");
check(sameSet(new Set(ws5Convergence.profiles?.map((profile) => profile.panelsPerNativeFrame) ?? []),
  new Set([4, 8, 16, 24, 32, 48, 64, 128, 256])),
"WS5 quadrature convergence density set drifted");
check(ws5Convergence.profiles?.find((profile) => profile.panelsPerNativeFrame === 32)
    ?.maximumAbsoluteXyzError <= 5e-5
    && ws5Convergence.highDensityIndependentCrossCheck?.maximumAbsoluteXyzError <= 1e-6
    && ws5Convergence.highDensityIndependentCrossCheck?.pass === true,
  "WS5 selected/high-density quadrature comparison does not pass");

check(ws5Fixtures.reportId === "cgb001-ws5-scan-exposure-fixtures-v1"
    && ws5Fixtures.pass === true,
  "WS5 scan/exposure fixture report does not pass");
check(ws5Fixtures.outputCoordinates?.physicalReflectance?.units
    ?.includes("absolute relative-reflectance XYZ")
    && ws5Fixtures.outputCoordinates?.referenceWhiteYNormalized?.whiteXyz?.[1] === 1
    && ws5Fixtures.outputCoordinates?.referenceWhiteYNormalized?.clipped === false
    && ws5Fixtures.outputCoordinates?.referenceWhiteYNormalized?.targetDeviceSpecific === false,
  "WS5 physical/host-normalized output-coordinate contract drifted");
check(ws5Fixtures.staticCoverage?.fixtureCount === 90
    && ws5Fixtures.staticCoverage?.maximumStaticScanError === 0
    && ws5Fixtures.staticCoverage?.maximumStaticNoScanError === 0
    && ws5Fixtures.staticCoverage?.fixtures?.length === 90,
  "WS5 static scan/no-scan fixtures no longer match WS1 exactly");
check(ws5Fixtures.causalCoverage?.rows?.join(",") === "0,71,143"
    && ws5Fixtures.causalCoverage?.fixtureCount === 6
    && ws5Fixtures.causalCoverage?.maximumRowZeroNoScanError === 0,
  "WS5 causal row or row-zero/no-scan fixture coverage drifted");
for (const fixture of ws5Fixtures.causalCoverage?.fixtures ?? []) {
  const y = fixture.rows.map((entry) => entry.averageXyz[1]);
  check(fixture.transitionId === "full-rise"
    ? y[0] > y[1] && y[1] > y[2]
    : y[0] < y[1] && y[1] < y[2],
  `WS5 causal exposure ordering drifted: ${fixture.memberId}/${fixture.transitionId}`);
}
check(ws5Fixtures.futureFrameIsolation?.maximumPrefixDifference === 0
    && ws5Fixtures.futureFrameIsolation?.pass === true,
  "WS5 future-frame isolation does not pass");
check(ws5Fixtures.invariants?.ws1LutSha256Before === lutDescriptor.sha256
    && ws5Fixtures.invariants?.ws1LutSha256After === lutDescriptor.sha256
    && ws5Fixtures.invariants?.ws4RateSha256Before === ws4RateDescriptor.binary?.sha256
    && ws5Fixtures.invariants?.ws4RateSha256After === ws4RateDescriptor.binary?.sha256
    && ws5Fixtures.invariants?.secondAngleOrReflectorGainApplied === false
    && ws5Fixtures.invariants?.targetCompensationApplied === false
    && ws5Fixtures.invariants?.shaderImplemented === false
    && ws5Fixtures.invariants?.retentionStateCreated === false,
  "WS5 changed a dependency or crossed an excluded mechanism boundary");

check(ws5Receipt.receiptId === "cgb001-ws5-receipt-v1", "unexpected WS5 receipt ID");
check(ws5Receipt.result?.status === "pass" && ws5Receipt.result?.ws5Complete === true,
  "WS5 receipt does not pass");
check(ws5Receipt.result?.nextEligibleWorkstreams?.join(",") === "WS6,WS7",
  "WS5 receipt next-workstream gate drifted");
check(ws5Receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS5 receipt incorrectly permits a reference-v1 Shader or preset");
check(Object.entries(ws5Receipt.gates ?? {}).every(([name, value]) =>
  ["targetCompensationApplied", "runtimeAngleModelCreated", "retentionStateCreated",
    "shaderOrPresetCreated"].includes(name) ? value === false : value === true),
"one or more WS5 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws5Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS5 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS5 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws5Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS5 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS5 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  aperture,
  readJson(`${modelRelative}/data/aperture.schema.json`),
  "aperture-v1.json",
);
check(ws6Evidence.inventoryId === "cgb001-ws6-evidence-inventory-v1"
    && ws6Evidence.auditRules?.length >= 4
    && ws6Evidence.decision?.selected?.includes("equal-third"),
  "WS6 evidence audit or minimum-assumption decision drifted");
check(aperture.apertureModelId === "cgb001-ws6-equal-third-rgb-v1"
    && aperture.subpixelOrder === "RGB"
    && aperture.geometry?.activeFill?.value === 1
    && aperture.geometry?.inactiveGap?.fraction === 0,
  "WS6 RGB order or zero-gap minimum geometry drifted");
check(aperture.decomposition?.modelSpace?.includes("unclipped linear sRGB")
    && aperture.decomposition?.clipping === false
    && aperture.surface?.angleGainAlreadyInColorReference === true
    && aperture.surface?.visibleSurfaceGrain?.enabled === false,
  "WS6 decomposition, fixed-angle, or no-grain boundary drifted");
check(aperture.integration?.scaleInvariant === true
    && aperture.integration?.hostFootprintAware === true
    && aperture.validation?.scales?.join(",") === "4,5,6,3.5,4.25,4.75",
  "WS6 analytic footprint or scale contract drifted");
check(ws6Validation.reportId === "cgb001-ws6-aperture-validation-v1"
    && ws6Validation.equationId === "CGB-WS6-EQUAL-THIRD-RGB-FOOTPRINT-V1"
    && ws6Validation.pass === true,
  "WS6 aperture validation does not pass");
check(ws6Validation.scaleFixtures?.length === 30
    && ws6Validation.cropFixtures?.length === 24
    && ws6Validation.maxima?.channelEnergyAbsolute <= ws6Validation.tolerances?.channelEnergy
    && ws6Validation.maxima?.averageXyzAbsolute <= ws6Validation.tolerances?.averageXyz
    && ws6Validation.maxima?.cropIntegrationAbsolute <= ws6Validation.tolerances?.cropIntegration
    && ws6Validation.maxima?.futureShaderFloat32AverageAbsolute
      <= ws6Validation.tolerances?.futureShaderFloat32Average
    && ws6Validation.maxima?.bypassAbsolute === 0,
  "WS6 energy/color/phase/float32/bypass gates do not pass");
check(ws6Validation.invariants?.ws1LutSha256Before === lutDescriptor.sha256
    && ws6Validation.invariants?.ws1LutSha256After === lutDescriptor.sha256
    && ws6Validation.invariants?.secondMrsOrAngleGainApplied === false
    && ws6Validation.invariants?.coverLensOrGlareApplied === false
    && ws6Validation.invariants?.targetCompensationApplied === false
    && ws6Validation.invariants?.shaderImplemented === false,
  "WS6 changed color dependencies or crossed a surface/target/Shader boundary");
check(ws6Receipt.receiptId === "cgb001-ws6-receipt-v1"
    && ws6Receipt.result?.status === "pass"
    && ws6Receipt.result?.ws6Complete === true
    && ws6Receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS6 receipt does not pass");
check(Object.entries(ws6Receipt.gates ?? {}).every(([name, value]) =>
  name === "shaderOrPresetCreated" ? value === false : value === true),
"one or more WS6 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws6Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS6 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS6 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws6Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS6 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS6 receipt output hash is stale: ${relative}`);
}

checkTopLevelSchema(
  retention,
  readJson(`${modelRelative}/data/retention.schema.json`),
  "retention-v1.json",
);
check(ws7Evidence.inventoryId === "cgb001-ws7-evidence-inventory-v1"
    && ws7Evidence.normalizationRules?.length >= 4
    && ws7Evidence.decision?.referenceAmplitude === 0
    && ws7Evidence.decision?.referenceOpticalCoupling === 0,
  "WS7 evidence normalization or zero-amplitude decision drifted");
check(retention.retentionModelId === "cgb001-ws7-residual-dc-v1"
    && retention.referenceProfile?.resultantDcOffset === 0
    && retention.referenceProfile?.opticalCoupling === 0
    && retention.state?.storage?.includes("one independent float32 scalar"),
  "WS7 independent state or zero-amplitude reference drifted");
check(retention.excitation?.equation?.includes("R5+G5+B5")
    && retention.excitation?.prohibitions?.some((entry) => entry.includes("displayed luma"))
    && retention.bypass?.preservesStaticColor === true
    && retention.bypass?.preservesOrdinaryResponse === true,
  "WS7 electrical excitation or bypass boundary drifted");
check(retention.candidates?.map((candidate) => candidate.id).join(",")
      === "low-rate,nominal-midpoint,high-rate"
    && retention.candidates?.[0]?.parameters?.adsorptionRatePerSecond === 0.001
    && retention.candidates?.[2]?.parameters?.desorptionRatePerSecond === 0.028 / 60,
  "WS7 low/nominal/high kinetic ensemble drifted");
check(ws7Validation.reportId === "cgb001-ws7-retention-validation-v1"
    && ws7Validation.equationId === "CGB-WS7-MIZUSAKI-ONE-STATE-V1"
    && ws7Validation.pass === true,
  "WS7 retention validation does not pass");
check(ws7Validation.kineticTrajectories?.length === 3
    && ws7Validation.topologyFixtures?.length === 10
    && ws7Validation.maxima?.balancedZeroOffsetState === 0
    && ws7Validation.maxima?.allFutureShaderFloat32Difference
      <= ws7Validation.tolerances?.futureShaderFloat32State,
  "WS7 kinetic/topology/balanced/float32 coverage does not pass");
check(ws7Validation.checks?.differentCodeHistoriesDiffer === true
    && ws7Validation.checks?.unequalDutyChangesSlowState === true
    && ws7Validation.checks?.polarityReversalChangesSign === true
    && ws7Validation.checks?.recoveryDecaysMagnitude === true
    && ws7Validation.checks?.formationZeroLeavesOrdinaryResponseExact === true
    && ws7Validation.checks?.pauseFreezesStateExact === true
    && ws7Validation.checks?.resetPolicyClearsToZero === true,
  "WS7 history, stress/recovery, isolation, or lifecycle gates do not pass");
check(ws7Validation.invariants?.ws4OrdinaryResponseEquation
      === "CGB-WS4-FIRST-ORDER-RATE-FIELD-V1"
    && ws7Validation.invariants?.ws4RateOrRgbStateModified === false
    && ws7Validation.invariants?.displayedLumaUsedAsExcitation === false
    && ws7Validation.invariants?.healthyCgbNonzeroAmplitudeInvented === false
    && ws7Validation.invariants?.agedCgbPresetInvented === false
    && ws7Validation.invariants?.shaderImplemented === false,
  "WS7 crossed its WS4/luma/amplitude/aging/Shader boundary");
check(ws7Receipt.receiptId === "cgb001-ws7-receipt-v1"
    && ws7Receipt.result?.status === "pass"
    && ws7Receipt.result?.ws7Complete === true
    && ws7Receipt.result?.referenceV1ShaderOrPresetAllowed === false,
  "WS7 receipt does not pass");
check(Object.entries(ws7Receipt.gates ?? {}).every(([name, value]) =>
  ["agedCgbPresetInvented", "shaderOrPresetCreated"].includes(name)
    ? value === false : value === true),
"one or more WS7 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws7Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS7 receipt tracks a missing input: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS7 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws7Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file), `WS7 receipt tracks a missing output: ${relative}`);
  if (fs.existsSync(file)) check(sha256(file) === expectedHash, `WS7 receipt output hash is stale: ${relative}`);
}

const responseShaderPath = path.join(modelDir, "shaders/cgb001-response-v1.slang");
const colorShaderPath = path.join(modelDir, "shaders/cgb001-color-v1.slang");
const displayShaderPath = path.join(modelDir, "shaders/cgb001-display-v1.slang");
const commonShaderPath = path.join(modelDir, "shaders/cgb001-common.inc");
const runtimeShaderPath = path.join(modelDir, "shaders/cgb001-runtime-v1.inc");
const responseShader = fs.readFileSync(responseShaderPath, "utf8");
const colorShader = fs.readFileSync(colorShaderPath, "utf8");
const displayShader = fs.readFileSync(displayShaderPath, "utf8");
const commonShader = fs.readFileSync(commonShaderPath, "utf8");
const runtimeShader = fs.readFileSync(runtimeShaderPath, "utf8");
check(responseShader.includes("#pragma format R32G32B32A32_SFLOAT")
    && responseShader.includes("PassFeedback0")
    && responseShader.includes("cgb_encode_residual_dc")
    && responseShader.includes("OriginalHistory1"),
  "WS8 response pass lost its RGBA32F feedback/history/state contract");
check(colorShader.includes("#pragma format R32G32B32A32_SFLOAT")
    && colorShader.includes("CGB_EXPOSURE_PANELS + 1")
    && colorShader.includes("CGB_GL2_NODE")
    && colorShader.includes("sample_color_lut(state0)")
    && colorShader.includes("sample_color_lut(state1)"),
  "WS8 color pass lost the WS5 RGBA32F two-point quadrature contract");
check(displayShader.includes("aperture_linear_rgb")
    && displayShader.includes("interval_overlap")
    && displayShader.includes("cgb_xyz_to_linear_srgb")
    && !displayShader.includes("viewingAngle"),
  "WS8 display pass lost analytic RGB aperture or added an angle path");
check(!responseShader.includes("params.DebugView") && !colorShader.includes("params.DebugView"),
  "a diagnostic view changes persistent response or exposure state");
check(!/pragma parameter .*angle/i.test(commonShader)
    && !/ViewingAngle|ViewAngle|HeadPose|FaceTracking/.test(commonShader),
  "WS8 exposes a forbidden runtime viewing-angle control");
check(runtimeShader.includes("CGB_INVERSION_TOPOLOGY = 2")
    && runtimeShader.includes("CGB_EXPOSURE_PANELS = 32")
    && runtimeShader.includes("CGB_RESPONSE_NOMINAL_ON_OFF_MS = 65.0")
    && runtimeShader.includes("CGB_RESPONSE_NOMINAL_GRAY_MS = 115.0"),
  "WS8 generated constants drifted from WS3/WS4/WS5");

check(ws8Textures.artifactId === "cgb001-ws8-runtime-textures-v1"
    && ws8Textures.layout?.pngFormat === "paired RGBA8_UNORM high-byte/low-byte data planes"
    && ws8Textures.layout?.requiredFiltering?.startsWith("nearest")
    && ws8Textures.layout?.uploadPrecisionMustBeVerifiedInWs9 === true,
  "WS8 runtime texture descriptor is incomplete or overclaims upload validation");
for (const [id, entry] of Object.entries(ws8Textures.textures ?? {})) {
  for (const plane of [entry.runtimeHighPlane, entry.runtimeLowPlane]) {
    const file = path.join(generatedDir, plane?.path ?? "missing");
    check(fs.existsSync(file), `WS8 ${id} runtime byte plane is missing`);
    if (!fs.existsSync(file)) continue;
    const png = fs.readFileSync(file);
    check(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      `WS8 ${id} runtime byte plane is not PNG`);
    check(png.readUInt32BE(16) === 1088 && png.readUInt32BE(20) === 32
        && png[24] === 8 && png[25] === 6,
      `WS8 ${id} runtime byte plane is not the declared 1088x32 RGBA8 layout`);
    check(sha256(file) === plane.sha256, `WS8 ${id} runtime byte-plane hash is stale`);
  }
  check(entry.maximumIntegerTexelAbsoluteXyzQuantizationError <= 1e-5,
    `WS8 ${id} integer XYZ transport error exceeds 1e-5`);
}
check(ws8Textures.textures?.referenceD65?.authoritativeSourceSha256
      === sha256(path.join(generatedDir, "cgb001-d65-lut-v1.rgba32f"))
    && ws8Textures.rateBinding?.authoritativeSourceSha256
      === sha256(path.join(generatedDir, "cgb001-ws4-gtg-rates-v1.r32f"))
    && ws8Textures.rateBinding?.maximumFloat32DifferenceAcross9216Cells === 0,
  "WS8 derived textures/rates are not bound to the retained float artifacts");

check(ws8Compile.receiptId === "cgb001-ws8-shader-compile-v1"
    && ws8Compile.summary?.pass === true
    && ws8Compile.stages?.length === 6
    && ws8Compile.stages?.every((stage) => stage.pass && stage.spirvBytes > 0),
  "WS8 six-stage SPIR-V compile receipt does not pass");
check(ws8Compile.intendedFormats?.response?.includes("R32G32B32A32_SFLOAT")
    && ws8Compile.intendedFormats?.color?.includes("R32G32B32A32_SFLOAT"),
  "WS8 compile receipt lost the intended float formats");
check(ws8Compile.sources?.responseShaderSha256 === sha256(responseShaderPath)
    && ws8Compile.sources?.colorShaderSha256 === sha256(colorShaderPath)
    && ws8Compile.sources?.displayShaderSha256 === sha256(displayShaderPath)
    && ws8Compile.sources?.commonIncludeSha256 === sha256(commonShaderPath)
    && ws8Compile.sources?.runtimeIncludeSha256 === sha256(runtimeShaderPath),
  "WS8 compile receipt is stale for current Shader sources");

check(ws8Manifest.manifestId === "cgb001-ws8-shader-preset-manifest-v1"
    && ws8Manifest.modelVersion === "1.0.0"
    && ws8Manifest.referenceCondition?.viewAngleDegrees === 0
    && ws8Manifest.referenceCondition?.runtimeAngleModel === false,
  "WS8 manifest identity, model version, or frozen geometry drifted");
check(ws8Manifest.passes?.length === 3
    && ws8Manifest.passes?.[0]?.format === "R32G32B32A32_SFLOAT"
    && ws8Manifest.passes?.[0]?.persistentFeedback === true
    && ws8Manifest.passes?.[1]?.format === "R32G32B32A32_SFLOAT"
    && ws8Manifest.passes?.[1]?.persistentFeedback === false,
  "WS8 pass graph or float formats drifted");
for (const [relative, expectedHash] of Object.entries(ws8Manifest.shaderHashes ?? {})) {
  const file = path.join(modelDir, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS8 manifest Shader hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws8Manifest.textureHashes ?? {})) {
  const file = path.join(modelDir, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS8 manifest texture hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws8Manifest.sourceRecordHashes ?? {})) {
  const file = path.join(modelDir, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS8 manifest source hash is stale: ${relative}`);
}
check(ws8Manifest.compileReceipt?.sha256
      === sha256(path.join(generatedDir, "ws8-shader-compile-v1.json"))
    && ws8Manifest.validation?.completePresetCount === 15
    && ws8Manifest.validation?.thinReferencePresets === 0
    && ws8Manifest.validation?.pass === true,
  "WS8 manifest compile/preset/validation gate does not pass");
check(ws8Manifest.diagnostics?.stateAffectingParametersEqualReference === true
    && ws8Manifest.diagnostics?.debugViewReadOnlyInResponseAndColorPasses === true
    && ws8Manifest.diagnostics?.settledWs1ColorMutation === false,
  "WS8 diagnostics are not declared state/color neutral");

const requiredPresetParameters = [
  "ModelEnable", "ResponseEnsemble", "TemporalResponse", "ScanEnabled",
  "RetentionAmount", "ApertureAmount", "ModelExposure", "ColorPolicy", "DebugView",
];
for (const [relative, expectedHash] of Object.entries(ws8Manifest.presetHashes ?? {})) {
  const file = path.join(modelDir, relative);
  check(fs.existsSync(file), `WS8 manifest preset is missing: ${relative}`);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  check(sha256(file) === expectedHash, `WS8 manifest preset hash is stale: ${relative}`);
  check(source.includes('shaders = "3"')
      && source.includes('shader0 = "../shaders/cgb001-response-v1.slang"')
      && source.includes('shader1 = "../shaders/cgb001-color-v1.slang"')
      && source.includes('shader2 = "../shaders/cgb001-display-v1.slang"')
      && source.includes('textures = "CgbReferenceLut;CgbReferenceLutLo;CgbUpstreamLut;CgbUpstreamLutLo"')
      && !source.includes("#reference"),
    `WS8 preset is not self-contained: ${relative}`);
  check(requiredPresetParameters.every((name) => source.includes(`${name} = "`)),
    `WS8 preset has inherited/missing parameter state: ${relative}`);
}
const referencePreset = fs.readFileSync(path.join(modelDir, "presets/reference-d65-v1.slangp"), "utf8");
for (const name of [...expectedPresetFiles].filter((entry) => entry.startsWith("diagnostic-"))) {
  const diagnostic = fs.readFileSync(path.join(modelDir, "presets", name), "utf8");
  for (const parameter of ["ModelEnable", "ResponseEnsemble", "TemporalResponse", "ScanEnabled", "RetentionAmount"]) {
    if (name === "diagnostic-retention-readback-v1.slangp" && parameter === "RetentionAmount") continue;
    const expected = referencePreset.match(new RegExp(`^${parameter} = "[^"]+"$`, "m"))?.[0];
    check(expected && diagnostic.includes(expected), `${name} changes persistent-state parameter ${parameter}`);
  }
}

check(ws8Receipt.receiptId === "cgb001-ws8-receipt-v1"
    && ws8Receipt.result?.status === "pass"
    && ws8Receipt.result?.ws8Complete === true
    && ws8Receipt.result?.ws9Eligible === true
    && ws8Receipt.result?.referenceV1ReleaseDefaultAllowed === false,
  "WS8 completion receipt does not pass or overclaims release status");
check(Object.values(ws8Receipt.gates ?? {}).every((value) => value === true),
  "one or more WS8 receipt gates do not pass");
for (const [relative, expectedHash] of Object.entries(ws8Receipt.trackedInputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS8 receipt input hash is stale: ${relative}`);
}
for (const [relative, expectedHash] of Object.entries(ws8Receipt.outputHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS8 receipt output hash is stale: ${relative}`);
}

check(ws9CpuGolden.reportId === "cgb001-ws9-cpu-golden-v1"
    && ws9CpuGolden.allRgb555Static?.testedCodes === 32768
    && ws9CpuGolden.allRgb555Static?.pass === true
    && ws9CpuGolden.pass === true,
  "WS9 consolidated CPU golden report does not pass");
check(ws9Sensitivity.reportId === "cgb001-ws9-sensitivity-v1"
    && ws9Sensitivity.selectedDefaultsRemainEvidenceBounded === true
    && ws9Sensitivity.pass === true,
  "WS9 sensitivity report does not pass");
check(ws9PriorArt.reportId === "cgb001-ws9-prior-art-difference-v1"
    && ws9PriorArt.classification === "difference-report-only-prior-art-is-not-acceptance-truth"
    && ws9PriorArt.referenceTruth?.originalMeasurementArtifacts?.["gbc_reflectance.ods"]
      === "967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba"
    && ws9PriorArt.pass === true,
  "WS9 prior-art report is missing, stale, or treated as acceptance truth");
check(ws9PresetManifest.manifestId === "cgb001-ws9-validation-preset-manifest-v1"
    && ws9PresetManifest.modelVersion === "1.0.0"
    && Object.keys(ws9PresetManifest.modelPresets ?? {}).length === 5
    && Object.keys(ws9PresetManifest.targetPresets ?? {}).length === 6
    && ws9PresetManifest.debugViewsAreReadOnlyInPersistentPasses === true,
  "WS9 numeric readback preset manifest is incomplete");

checkTopLevelSchema(
  ws9Receipt,
  readJson(`${modelRelative}/data/release-receipt.schema.json`),
  "ws9-receipt-v1.json",
);
check(ws9Receipt.receiptId === "cgb001-ws9-release-v1"
    && ws9Receipt.result?.status === "pass"
    && ws9Receipt.result?.referenceV1NameAllowed === true
    && Object.values(ws9Receipt.gates ?? {}).every((value) => value === "pass"),
  "WS9 release receipt does not pass all workstream gates");
for (const [relative, expectedHash] of Object.entries(ws9Receipt.artifactHashes ?? {})) {
  const file = path.join(root, relative);
  check(fs.existsSync(file) && sha256(file) === expectedHash, `WS9 release receipt hash is stale: ${relative}`);
}
check(ws9TargetReceipt.receiptId === "cgb001-ws9-konkr-target-20260824"
    && ws9TargetReceipt.modelVersion === "1.0.0"
    && ws9TargetReceipt.gates?.allRgb555?.codes === 32768
    && ws9TargetReceipt.gates?.allRgb555?.maximumAbsoluteXyzError
      <= ws9TargetReceipt.gates?.allRgb555?.tolerance
    && ws9TargetReceipt.gates?.aperture?.scale === 4
    && ws9TargetReceipt.gates?.lifecycle?.pauseDidNotIntegrateWallTime === true
    && ws9TargetReceipt.gates?.framePacing?.over25ms === 0
    && ws9TargetReceipt.result?.referenceV1NameAllowed === true
    && ws9TargetReceipt.result?.userConfigurationRestored === true
    && ws9TargetReceipt.result?.retroarchTestProcessStopped === true,
  "WS9 KONKR target receipt does not pass numeric, lifecycle, pacing, and restoration gates");
check(Object.keys(ws9TargetReceipt.evidenceArtifactHashes ?? {}).length >= 20
    && Object.values(ws9TargetReceipt.evidenceArtifactHashes ?? {})
      .every((value) => /^[0-9a-f]{64}$/.test(value)),
  "WS9 target receipt does not retain a sufficient hash inventory for original evidence");

for (const markdownRelative of [
  `${modelRelative}/README.md`,
  `${modelRelative}/REFERENCES.md`,
  `${modelRelative}/IMPLEMENTATION-TODO.md`,
  `${modelRelative}/reference/upstream/README.md`,
  "docs/research/cgb-001-reference-survey.md",
]) {
  const markdown = fs.readFileSync(path.join(root, markdownRelative), "utf8");
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    try { target = decodeURIComponent(target); } catch { /* keep literal path */ }
    const resolved = path.resolve(path.dirname(path.join(root, markdownRelative)), target);
    check(fs.existsSync(resolved), `${markdownRelative}: broken local link ${match[1]}`);
  }
}

const temporarySource = fs.mkdtempSync(path.join(os.tmpdir(), "cgb001-ws0-invalid-source-"));
try {
  fs.writeFileSync(path.join(temporarySource, "gbc_reflectance.ods"), "modified source\n");
  fs.writeFileSync(path.join(temporarySource, "gbc_reflectance.txt"), "modified source\n");
  const negative = spawnSync(
    process.execPath,
    [path.join(root, "tools", "build-cgb001-ws0.mjs"), "--check", "--verify-sources", temporarySource],
    { cwd: root, encoding: "utf8" },
  );
  const diagnostic = `${negative.stdout ?? ""}\n${negative.stderr ?? ""}`;
  check(negative.status !== 0, "modified HCS source files did not fail verification");
  check(diagnostic.includes("HCS source hash mismatch") && diagnostic.includes("normalization was not started"),
    "modified HCS source failure does not prove fail-fast before normalization");
} finally {
  fs.rmSync(temporarySource, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`CGB-001 validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("CGB-001 WS0 through WS9 validation passed: retained measurements and authoritative float artifacts, paired RGBA8 runtime transport, CPU equations, all-code and temporal Vulkan readback, aperture, lifecycle, pacing, source hashes, target restoration, and release receipts are intact.");
}
