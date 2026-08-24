#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const reconstructionPath = path.join(modelDir, "data", "reconstruction-v1.json");
const receiptRelative = `${modelRelative}/generated/ws0-scaffold-v1.json`;
const receiptPath = path.join(root, receiptRelative);

const requiredSchemaNames = [
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

const trackedInputs = [
  "REFERENCES.md",
  "package.json",
  "docs/research/cgb-001-reference-survey.md",
  `${modelRelative}/README.md`,
  `${modelRelative}/REFERENCES.md`,
  `${modelRelative}/IMPLEMENTATION-TODO.md`,
  `${modelRelative}/model.json`,
  `${modelRelative}/data/reconstruction-v1.json`,
  ...requiredSchemaNames.map((name) => `${modelRelative}/data/${name}`),
  "tools/build-cgb001-ws0.mjs",
  "tools/validate-cgb001.mjs",
];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeUnix(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function walkFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(target));
    else if (entry.isFile()) output.push(target);
  }
  return output.sort();
}

export function verifyHcsSources(sourceDirectory, reconstruction = readJson(reconstructionPath)) {
  const resolved = path.resolve(sourceDirectory);
  assert(fs.existsSync(resolved), `HCS source directory does not exist: ${sourceDirectory}`);
  assert(fs.statSync(resolved).isDirectory(), `HCS source path is not a directory: ${sourceDirectory}`);

  const artifacts = reconstruction.sourceRecords?.hcsGbcReflectance?.artifacts;
  assert(Array.isArray(artifacts) && artifacts.length === 2,
    "canonical reconstruction record must identify exactly two HCS raw artifacts");

  const files = walkFiles(resolved);
  const verified = [];
  for (const artifact of artifacts) {
    const candidates = files.filter((file) => path.basename(file) === artifact.fileName);
    assert(candidates.length > 0, `missing required HCS source artifact: ${artifact.fileName}`);
    assert(candidates.length === 1,
      `ambiguous HCS source artifact ${artifact.fileName}: found ${candidates.length} files`);
    const actual = sha256(fs.readFileSync(candidates[0]));
    assert(actual === artifact.sha256,
      `HCS source hash mismatch for ${artifact.fileName}: expected ${artifact.sha256}, received ${actual}; normalization was not started`);
    verified.push({
      fileName: artifact.fileName,
      sourcePath: path.relative(resolved, candidates[0]).split(path.sep).join("/"),
      sha256: actual,
      verified: true,
    });
  }
  return verified;
}

function definedEvidenceIds(markdown) {
  return new Set(
    [...markdown.matchAll(/^\|\s*`(CGB-[A-Z0-9-]+)`\s*\|/gm)].map((match) => match[1]),
  );
}

function validateSchemaScaffold(schema, name) {
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${name}: expected JSON Schema draft 2020-12`);
  assert(typeof schema.$id === "string" && schema.$id.length > 0, `${name}: missing $id`);
  assert(schema.type === "object", `${name}: top-level type must be object`);
  assert(schema.additionalProperties === false, `${name}: top-level additionalProperties must be false`);
  assert(schema.properties?.schemaVersion?.const === 1, `${name}: schemaVersion must be frozen to 1`);
  assert(schema.required?.includes("schemaVersion"), `${name}: schemaVersion must be required`);
}

function buildReceipt() {
  for (const relative of trackedInputs) {
    assert(fs.existsSync(path.join(root, relative)), `missing WS0 tracked input: ${relative}`);
  }

  const model = readJson(path.join(modelDir, "model.json"));
  const reconstruction = readJson(reconstructionPath);
  const referenceMarkdown = fs.readFileSync(path.join(modelDir, "REFERENCES.md"), "utf8");
  const evidence = definedEvidenceIds(referenceMarkdown);

  assert(model.id === reconstruction.modelId, "model.json and reconstruction-v1.json model IDs disagree");
  assert(model.reconstructionData === "data/reconstruction-v1.json", "model.json reconstruction path drifted");
  assert(reconstruction.reconstructionId === "nintendo-cgb-001-reference-v1",
    "unexpected canonical reconstruction ID");
  assert(model.defaultReferenceCondition?.illuminant === "CIE D65", "default illuminant must remain CIE D65");
  assert(model.defaultReferenceCondition?.illuminationAngleDegrees === 45,
    "default illumination angle must remain 45 degrees");
  assert(model.defaultReferenceCondition?.viewAngleDegrees === 0,
    "default view angle must remain panel-normal 0 degrees");
  assert(model.defaultReferenceCondition?.runtimeAngleModel === false,
    "WS0 must not enable a runtime angle model");
  assert(model.defaultFrontendContract?.requiredInput === "uncorrected CGB RGB555 raster",
    "default frontend input must remain uncorrected CGB RGB555");
  assert(model.workstreamStatus?.ws0 === "complete", "model metadata must preserve WS0 completion");

  const modelIds = new Set(model.evidenceIds ?? []);
  const reconstructionIds = new Set(reconstruction.evidenceIds ?? []);
  assert(modelIds.size === evidence.size && [...modelIds].every((id) => evidence.has(id)),
    "model.json evidence IDs do not exactly match the model evidence map");
  assert(reconstructionIds.size === evidence.size && [...reconstructionIds].every((id) => evidence.has(id)),
    "reconstruction-v1.json evidence IDs do not exactly match the model evidence map");

  const source = reconstruction.sourceRecords?.hcsGbcReflectance;
  assert(source?.commit === "e688fc51141c0974728aa1bdcb89b94d74123f6b", "pinned HCS commit drifted");
  assert(source?.redistribution?.vendorRawArtifacts === true,
    "the accepted source-of-record policy must retain the attributed HCS raw artifacts");
  assert(source?.knownLimitations?.length >= 8, "HCS source limitations are incomplete");

  const schemaEntries = [];
  for (const name of requiredSchemaNames) {
    const relative = `${modelRelative}/data/${name}`;
    const file = path.join(root, relative);
    const schema = readJson(file);
    validateSchemaScaffold(schema, name);
    assert(Object.values(reconstruction.schemaRecords ?? {}).includes(name),
      `${name}: canonical reconstruction record does not reference this schema`);
    schemaEntries.push({ path: relative, sha256: sha256(fs.readFileSync(file)) });
  }

  // WS0's receipt preserves the historical no-Shader scope at completion.
  // Later completed workstreams are allowed to add their accepted directories.
  const vendoredRaw = walkFiles(modelDir).filter((file) => [".ods", ".txt"].includes(path.extname(file).toLowerCase()));
  assert(vendoredRaw.length === 2,
    `expected exactly the attributed ODS/TXT source pair, found: ${vendoredRaw.map(relativeUnix).join(", ")}`);
  const retainedSourceDirectory = path.join(
    modelDir,
    "reference/upstream/hcs/e688fc51141c0974728aa1bdcb89b94d74123f6b",
  );
  const retainedVerification = verifyHcsSources(retainedSourceDirectory, reconstruction);

  const inputHashes = {};
  for (const relative of trackedInputs) inputHashes[relative] = sha256(fs.readFileSync(path.join(root, relative)));

  return {
    schemaVersion: 1,
    receiptId: "cgb001-ws0-scaffold-v1",
    generatedBy: "tools/build-cgb001-ws0.mjs",
    modelId: model.id,
    workstream: "WS0",
    completedOn: "2026-08-24",
    historicalScopeAtCompletion: {
      status: "scaffold-only",
      referenceCondition: "CIE D65; 45 degree illumination; 0 degree panel-normal view",
      runtimeAngleModel: false,
      shaderCreated: false,
      presetCreated: false,
      normalizedMeasurementCreated: false,
      runtimeLutCreated: false,
    },
    sourceVerification: {
      requiredBeforeNormalization: true,
      rawArtifactsRetainedAsAttributedReference: true,
      command: "node tools/build-cgb001-ws0.mjs --check --verify-sources <HCS-source-directory>",
      pinnedCommit: source.commit,
      expectedArtifacts: source.artifacts.map(({ fileName, sha256: hash }) => ({ fileName, sha256: hash })),
      retainedVerification,
    },
    evidenceIds: [...evidence].sort(),
    schemas: schemaEntries,
    trackedInputHashes: inputHashes,
    checks: {
      canonicalRecordAndModelAgree: true,
      evidenceIdsResolve: true,
      frozenReferenceConditionMatches: true,
      schemaSetComplete: true,
      attributedRawSourceRetainedAndVerified: true,
      forwardCompatibleWithCompletedWs1: model.workstreamStatus?.ws1 === "complete",
      forwardCompatibleWithCompletedWs2: model.workstreamStatus?.ws2 === "complete",
      forwardCompatibleWithCompletedWs3: model.workstreamStatus?.ws3 === "complete",
      forwardCompatibleWithCompletedWs4: model.workstreamStatus?.ws4 === "complete",
      forwardCompatibleWithCompletedWs5: model.workstreamStatus?.ws5 === "complete",
      forwardCompatibleWithCompletedWs6: model.workstreamStatus?.ws6 === "complete",
      forwardCompatibleWithCompletedWs7: model.workstreamStatus?.ws7 === "complete",
      forwardCompatibleWithCompletedWs8: model.workstreamStatus?.ws8 === "complete",
      noShaderOrPresetCreated: true,
    },
    result: {
      status: "pass",
      nextWorkstreams: model.workstreamStatus?.ws8 === "complete"
        ? ["WS9"]
        : model.workstreamStatus?.ws7 === "complete"
          ? ["WS8"]
          : model.workstreamStatus?.ws6 === "complete"
            ? ["WS7", "WS8"]
            : model.workstreamStatus?.ws5 === "complete"
        ? ["WS6", "WS7"]
        : model.workstreamStatus?.ws4 === "complete"
          ? ["WS5", "WS6", "WS7"]
        : model.workstreamStatus?.ws3 === "complete"
          ? ["WS4", "WS6"]
        : model.workstreamStatus?.ws2 === "complete"
          ? ["WS3", "WS6"]
        : model.workstreamStatus?.ws1 === "complete" ? ["WS2", "WS3", "WS6"] : ["WS1", "WS2"],
      referenceV1ShaderOrPresetAllowed: false,
    },
  };
}

function parseArguments(argv) {
  const parsed = { checkOnly: false, sourceDirectory: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") parsed.checkOnly = true;
    else if (argument === "--verify-sources") {
      assert(index + 1 < argv.length, "--verify-sources requires a directory argument");
      parsed.sourceDirectory = argv[index + 1];
      index += 1;
    } else if (argument === "--help") {
      console.log("Usage: node tools/build-cgb001-ws0.mjs [--check] [--verify-sources <directory>]");
      return null;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return parsed;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;

  if (options.sourceDirectory) {
    const verified = verifyHcsSources(options.sourceDirectory);
    for (const artifact of verified) {
      console.log(`verified HCS source: ${artifact.fileName} ${artifact.sha256}`);
    }
  }

  const expected = `${JSON.stringify(buildReceipt(), null, 2)}\n`;
  if (options.checkOnly) {
    assert(fs.existsSync(receiptPath), `missing generated WS0 receipt: ${receiptRelative}`);
    const actual = fs.readFileSync(receiptPath, "utf8");
    assert(actual === expected,
      `${receiptRelative} is stale; run node tools/build-cgb001-ws0.mjs`);
    console.log("CGB-001 WS0 scaffold receipt is current.");
  } else {
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, expected);
    console.log(`Wrote ${receiptRelative}`);
  }
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    console.error(`CGB-001 WS0 build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
