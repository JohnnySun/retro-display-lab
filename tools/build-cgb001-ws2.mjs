#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const policyRelative = `${modelRelative}/data/ws2-frontend-policy-v1.json`;
const schemaRelative = `${modelRelative}/data/frontend-contract.schema.json`;
const manifestRelative = `${modelRelative}/generated/ws2-stimulus-v1/manifest.json`;
const decoderRelative = `${modelRelative}/generated/ws2-decoder-v1.json`;
const smokeRelative = `${modelRelative}/generated/ws2-gambatte-smoke-v1.json`;
const contractRelative = `${modelRelative}/data/frontend-contract-v1.json`;
const receiptRelative = `${modelRelative}/generated/ws2-receipt-v1.json`;
const contractPath = path.join(root, contractRelative);
const receiptPath = path.join(root, receiptRelative);
const checkOnly = process.argv.includes("--check");
const commit = "3262c2aa4adae8dba4f6d51cdd931c15cb11569f";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative));
}

function readJson(relative) {
  return JSON.parse(read(relative));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function evaluateConfiguration(required, override = {}) {
  const actual = { ...required, ...override };
  return Object.entries(required).every(([key, value]) => actual[key] === value)
    ? "activate-reference-contract"
    : "reject-activation";
}

function evaluateEvent(event) {
  if (event.kind === "subframe" || event.committed === false) return "static-bypass";
  if (event.kind === "frame" && event.frameId <= event.previousFrameId) return "static-bypass-and-reset-baseline";
  return "update-temporal-state";
}

function validateTopLevel(instance, schema) {
  for (const property of schema.required) assert(Object.hasOwn(instance, property), `frontend contract lacks ${property}`);
  for (const property of Object.keys(instance)) assert(Object.hasOwn(schema.properties, property), `unexpected frontend contract property ${property}`);
  assert(instance.schemaVersion === 1 && instance.contractId === "cgb001-frontend-contract-v1", "frontend contract identity differs");
  assert(instance.core.commit === commit, "frontend core commit differs");
  assert(instance.raster.width === 160 && instance.raster.height === 144, "frontend raster differs");
  assert(instance.colorCodes.exhaustiveProof.testedRgb555Codes === 32768, "frontend exhaustive proof is incomplete");
  assert(instance.stimuli.length === 16, "frontend stimulus inventory is incomplete");
}

function buildArtifacts() {
  const policyBuffer = read(policyRelative);
  const policy = JSON.parse(policyBuffer);
  const schema = readJson(schemaRelative);
  const manifestBuffer = read(manifestRelative);
  const manifest = JSON.parse(manifestBuffer);
  const decoderBuffer = read(decoderRelative);
  const decoder = JSON.parse(decoderBuffer);
  const smokeBuffer = read(smokeRelative);
  const smoke = JSON.parse(smokeBuffer);
  assert(policy.schemaVersion === 1 && policy.modelId === manifest.modelId, "invalid CGB WS2 policy");
  assert(manifest.schemaVersion === 1 && manifest.scenes.length === 16, "invalid CGB WS2 manifest");
  assert(decoder.summary?.pass === true && decoder.summary.scenes === manifest.scenes.length, "independent decoder report does not pass");
  assert(smoke.summary?.pass === true && smoke.summary.scenes === manifest.scenes.length, "Gambatte smoke report does not pass");
  assert(decoder.source.manifestSha256 === sha256(manifestBuffer), "decoder report is stale for manifest");
  assert(smoke.source.manifestSha256 === sha256(manifestBuffer), "Gambatte report is stale for manifest");
  assert(smoke.core.commit === commit, "Gambatte report uses a different commit");
  assert(smoke.transportProof.testedRgb555Codes === 32768 && smoke.transportProof.uniqueRgb565Words === 32768,
    "Gambatte transport proof is not exhaustive or injective");
  assert(smoke.summary.actualCoreExhaustiveRgb555Codes === 32768,
    "Gambatte did not actually emit every RGB555 value from the exhaustive ROM");

  const negativeCases = policy.negativeCases.map((test) => {
    const actual = test.override
      ? evaluateConfiguration(policy.requiredCoreOptions, test.override)
      : evaluateEvent(test.event);
    return { caseId: test.caseId, expected: test.expected, actual, status: actual === test.expected ? "pass" : "fail" };
  });
  assert(negativeCases.every((test) => test.status === "pass"), "frontend fail-closed negative case failed");
  assert(evaluateConfiguration(policy.requiredCoreOptions) === "activate-reference-contract", "valid core configuration was rejected");

  const contract = {
    schemaVersion: 1,
    contractId: "cgb001-frontend-contract-v1",
    modelId: manifest.modelId,
    classification: "derived",
    evidenceIds: policy.evidenceIds,
    core: {
      name: "Gambatte libretro",
      repository: smoke.core.repository,
      commit: smoke.core.commit,
      sourceArchive: smoke.core.sourceArchive,
      sourceArchiveSha256: smoke.core.sourceArchiveSha256,
      build: {
        makefile: "Makefile.libretro",
        videoDefine: "VIDEO_RGB565=1",
        targetPolicy: "Build the pinned source for the host libretro shared-library platform; no source patching.",
      },
      runtimeIdentity: smoke.core.runtimeIdentity,
    },
    supportedContent: policy.supportedContent,
    raster: {
      width: manifest.raster.width,
      height: manifest.raster.height,
      orientation: "top-left origin; rows delivered top to bottom; no rotation",
      masterClockHz: manifest.timing.masterClockHz,
      dotsPerFrame: manifest.timing.dotsPerFrame,
      frameRateHz: manifest.timing.frameRateHz,
    },
    colorCodes: {
      logicalEncoding: "CGB RGB555",
      channelMinimum: 0,
      channelMaximum: 31,
      corePixelFormat: "RETRO_PIXEL_FORMAT_RGB565",
      packedRgb565: "(R5 << 11) | (G5 << 6) | B5; RGB565 bit 5 is zero",
      integerRecovery: smoke.transportProof.integerDecoder,
      normalizedTextureRecovery: smoke.transportProof.normalizedTextureDecoder,
      exhaustiveProof: smoke.transportProof,
    },
    correctionPolicy: {
      preAppliedColorCorrection: false,
      preAppliedGhosting: false,
      requiredCoreOptions: policy.requiredCoreOptions,
      mismatchAction: "reject reference-preset activation",
    },
    timeSemantics: policy.timeSemantics,
    stimuli: manifest.scenes.map((scene) => ({
      id: scene.sceneId,
      purpose: scene.description,
      rom: `${modelRelative}/generated/ws2-stimulus-v1/${scene.filename}`,
      sha256: scene.sha256,
      expectedFramebufferSha256: scene.expectedFramebuffer.map((page) => page.sha256),
    })),
    validation: {
      status: "pass",
      coreSmokeReport: { path: smokeRelative, sha256: sha256(smokeBuffer) },
      romDecoderReport: { path: decoderRelative, sha256: sha256(decoderBuffer) },
      negativeCases,
      shaderImplemented: false,
    },
  };
  validateTopLevel(contract, schema);
  const contractBuffer = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);

  const trackedInputs = [
    policyRelative,
    schemaRelative,
    `${modelRelative}/data/ws2-stimulus-scenes-v1.json`,
    manifestRelative,
    decoderRelative,
    smokeRelative,
    "tools/build-cgb001-test-rom.mjs",
    "tools/decode-cgb001-test-rom.mjs",
    "tools/cgb001-libretro-smoke.c",
    "tools/validate-cgb001-ws2-gambatte.mjs",
    "tools/build-cgb001-ws2.mjs",
    `${modelRelative}/reference/upstream/gambatte/${commit}/gambatte-libretro.tar.gz`,
    `${modelRelative}/reference/upstream/gambatte/${commit}/source/Makefile.libretro`,
    `${modelRelative}/reference/upstream/gambatte/${commit}/source/libretro.cpp`,
    `${modelRelative}/reference/upstream/gambatte/${commit}/source/libretro.h`,
    `${modelRelative}/reference/upstream/gambatte/${commit}/source/libretro_core_options.h`,
    `${modelRelative}/reference/upstream/gambatte/${commit}/source/video_libretro.cpp`,
    ...manifest.scenes.map((scene) => `${modelRelative}/generated/ws2-stimulus-v1/${scene.filename}`),
  ];
  const receipt = {
    schemaVersion: 1,
    receiptId: "cgb001-ws2-receipt-v1",
    modelId: manifest.modelId,
    workstream: "WS2",
    completedOn: "2026-08-24",
    generatedBy: "tools/build-cgb001-ws2.mjs",
    trackedInputHashes: Object.fromEntries(trackedInputs.map((relative) => [relative, sha256(read(relative))])),
    outputHashes: { [contractRelative]: sha256(contractBuffer) },
    gates: {
      pinnedCoreSourceRetained: true,
      uncorrectedRgb555RoundTripExhaustive: true,
      deterministicRomCount: manifest.scenes.length,
      proprietaryNintendoAssetsPresent: false,
      independentRomDecode: decoder.summary.pass,
      pinnedCoreSmoke: smoke.summary.pass,
      correctionAndBlendingDisabled: true,
      lifecycleDefined: Object.keys(policy.timeSemantics).length === 12,
      failClosedNegativeCases: negativeCases.every((test) => test.status === "pass"),
      shaderOrPresetCreated: false,
    },
    result: {
      status: "pass",
      ws2Complete: true,
      nextEligibleWorkstreams: ["WS3", "WS6"],
      referenceV1ShaderOrPresetAllowed: false,
    },
  };
  return { contractBuffer, receiptBuffer: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`) };
}

function writeOrCheck(file, relative, buffer) {
  if (checkOnly) {
    assert(fs.existsSync(file), `${relative} is missing`);
    assert(fs.readFileSync(file).equals(buffer), `${relative} is stale; run node tools/build-cgb001-ws2.mjs`);
  } else {
    fs.writeFileSync(file, buffer);
    console.log(`Wrote ${relative}`);
  }
}

function main() {
  const artifacts = buildArtifacts();
  writeOrCheck(contractPath, contractRelative, artifacts.contractBuffer);
  writeOrCheck(receiptPath, receiptRelative, artifacts.receiptBuffer);
  console.log(`CGB-001 WS2 ${checkOnly ? "receipt is current" : "completed"}.`);
}

try { main(); } catch (error) {
  console.error(`CGB-001 WS2 build failed: ${error.message}`);
  process.exitCode = 1;
}
