#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const targetRelative = "targets/konkr-gt78-vn/960x640-srgb-neutral";
const evidenceRelative = ".codex-validation/cgb001-ws9-target-20260824";
const targetReceiptRelative = `${targetRelative}/validation/cgb001-ws9-target-20260824.json`;
const releaseReceiptRelative = `${modelRelative}/generated/ws9-receipt-v1.json`;
const checkOnly = process.argv.includes("--check");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function sha256File(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function output(relative, buffer) {
  const file = path.join(root, relative);
  if (checkOnly) {
    assert(fs.existsSync(file), `missing WS9 receipt: ${relative}`);
    assert(fs.readFileSync(file).equals(buffer), `stale WS9 receipt: ${relative}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}

function walkFiles(relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  if (!fs.existsSync(absolute)) return [];
  const results = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(relative));
    else if (entry.isFile()) results.push(relative);
  }
  return results.sort();
}

function hashMap(paths) {
  return Object.fromEntries([...new Set(paths)].sort().map((relative) => {
    assert(fs.existsSync(path.join(root, relative)), `receipt input is missing: ${relative}`);
    return [relative, sha256File(relative)];
  }));
}

const model = readJson(`${modelRelative}/model.json`);
const reconstruction = readJson(`${modelRelative}/data/reconstruction-v1.json`);
const cpuGolden = readJson(`${modelRelative}/generated/ws9-cpu-golden-v1.json`);
const sensitivity = readJson(`${modelRelative}/generated/ws9-sensitivity-v1.json`);
const priorArt = readJson(`${modelRelative}/generated/ws9-prior-art-comparison-v1.json`);
const presetManifest = readJson(`${modelRelative}/generated/ws9-preset-manifest-v1.json`);
const ws8Receipt = readJson(`${modelRelative}/generated/ws8-receipt-v1.json`);

assert(model.modelVersion === "1.0.0", "WS9 release requires model version 1.0.0");
assert(reconstruction.recordStatus === "ws1-through-ws9-complete-release-v1",
  "canonical record does not identify the WS9 release");
assert(reconstruction.artifactPolicy?.referenceV1NameAllowed === true,
  "canonical record does not allow the reference-v1 release name");
for (let index = 0; index <= 9; index += 1) {
  assert(model.workstreamStatus?.[`ws${index}`] === "complete", `WS${index} is not complete`);
}
assert(ws8Receipt.result?.status === "pass" && ws8Receipt.result?.ws9Eligible === true,
  "WS8 receipt does not admit WS9");
assert(cpuGolden.pass === true && cpuGolden.allRgb555Static?.testedCodes === 32768,
  "WS9 CPU golden report does not pass all RGB555 codes");
assert(sensitivity.pass === true && sensitivity.selectedDefaultsRemainEvidenceBounded === true,
  "WS9 sensitivity report does not pass");
assert(priorArt.pass === true
    && priorArt.classification === "difference-report-only-prior-art-is-not-acceptance-truth",
  "WS9 prior-art difference report is missing or overclaims truth");
assert(presetManifest.debugViewsAreReadOnlyInPersistentPasses === true
    && presetManifest.referencePresetParametersUnchanged === true,
  "WS9 diagnostic presets alter persistent reference state");

const reportNames = [
  "lut-allcodes-comparison.json",
  "response-sequence-comparison.json",
  "exposure-sequence-comparison.json",
  "retention-sequence-comparison.json",
  "aperture-readback-comparison.json",
  "lifecycle-comparison.json",
  "frame-pacing-comparison.json",
  "texture-transport-comparison.json",
  "device-restoration.json",
];
const evidenceAvailable = reportNames.every((name) => fs.existsSync(path.join(root, evidenceRelative, name)));
let targetReceipt;

const repositoryFiles = [
  ...walkFiles(modelRelative).filter((relative) => relative !== releaseReceiptRelative),
  ...walkFiles("docs/research").filter((relative) => relative.includes("cgb-001")),
  ...walkFiles(`${targetRelative}/presets`).filter((relative) => path.basename(relative).startsWith("cgb001-")),
  ...walkFiles(`${targetRelative}/retroarch`).filter((relative) => path.basename(relative).startsWith("cgb001-")),
  `${targetRelative}/profile.json`,
  `${targetRelative}/REFERENCES.md`,
  "package.json",
  ...walkFiles("tools").filter((relative) => /\/(?:build|analyze|decode|validate)-cgb001|\/cgb001-libretro-smoke\.c$/.test(relative)),
].filter((relative) => relative !== targetReceiptRelative && relative !== releaseReceiptRelative);
const repositoryArtifactHashes = hashMap(repositoryFiles);

if (evidenceAvailable) {
  const lut = readJson(`${evidenceRelative}/lut-allcodes-comparison.json`);
  const response = readJson(`${evidenceRelative}/response-sequence-comparison.json`);
  const exposure = readJson(`${evidenceRelative}/exposure-sequence-comparison.json`);
  const retention = readJson(`${evidenceRelative}/retention-sequence-comparison.json`);
  const aperture = readJson(`${evidenceRelative}/aperture-readback-comparison.json`);
  const lifecycle = readJson(`${evidenceRelative}/lifecycle-comparison.json`);
  const pacing = readJson(`${evidenceRelative}/frame-pacing-comparison.json`);
  const transport = readJson(`${evidenceRelative}/texture-transport-comparison.json`);
  const restoration = readJson(`${evidenceRelative}/device-restoration.json`);

  for (const [name, report] of Object.entries({
    lut, response, exposure, retention, aperture, lifecycle, pacing, transport, restoration,
  })) assert(report.pass === true, `WS9 target report does not pass: ${name}`);
  assert(lut.decoded?.uniqueRgb555Codes === 32768
      && lut.decoded?.components === 98304
      && lut.decoded?.invalidTileCount === 0
      && lut.decoded?.nonFiniteCount === 0
      && lut.comparison?.maximumAbsoluteXyzError <= lut.comparison?.tolerance,
    "all-code GPU LUT gate does not pass");
  assert(response.comparison?.maximumResponseAbsoluteError <= response.comparison?.responseTolerance
      && response.comparison?.maximumResidualAbsoluteError === 0,
    "GPU response readback gate does not pass");
  assert(exposure.comparison?.maximumExposureAbsoluteXyzError <= exposure.comparison?.exposureTolerance,
    "GPU exposure readback gate does not pass");
  assert(retention.comparison?.maximumResidualAbsoluteError <= retention.comparison?.residualTolerance,
    "GPU retention readback gate does not pass");
  assert(aperture.comparison?.maximumCoverageError <= aperture.comparison?.tolerance
      && aperture.viewportContract?.pass === true,
    "GPU aperture/viewport gate does not pass");
  assert(lifecycle.comparison?.pauseDidNotIntegrateWallTime === true
      && lifecycle.comparison?.coldReloadEstablishedNewFrameBaseline === true,
    "frontend lifecycle gate does not pass");
  assert(pacing.intervalMs?.over25ms === 0 && pacing.intervalMs?.maximum < 25,
    "frame-pacing gate does not pass");
  assert(transport.rejected?.pass === false
      && transport.accepted?.pass === true
      && transport.accepted?.maximumAbsoluteXyzError <= transport.accepted?.tolerance,
    "texture transport did not reject the lossy path and accept the paired path");
  assert(restoration.retroarchTestProcessStopped === true
      && Object.keys(restoration.restored ?? {}).length === 4,
    "device restoration is incomplete");

  const coldLogRelative = `${evidenceRelative}/cold-reference-paired-retroarch.log`;
  const coldLog = fs.readFileSync(path.join(root, coldLogRelative), "utf8");
  for (const marker of [
    "Geometry: 160x144, Aspect: 1.111, FPS: 59.73",
    'Using GPU: "Mali-G76 MC4"',
    "Native window size: 960x640",
    "cgb001-response-v1.slang",
    "cgb001-color-v1.slang",
    "cgb001-display-v1.slang",
    "Using render target format R32G32B32A32_SFLOAT for pass output #0",
    "Using render target format R32G32B32A32_SFLOAT for pass output #1",
    "Using render target format R8G8B8A8_UNORM for pass output #2",
    "Creating framebuffer 640x576",
    "Using framebuffer feedback for pass #0",
    "format: 109",
    "format: 37",
  ]) assert(coldLog.includes(marker), `cold runtime log is missing marker: ${marker}`);
  assert(!/Failed to apply shader|Failed to compile|Shader.*error/i.test(coldLog),
    "cold runtime log contains a Shader failure");

  const topLevelEvidence = fs.readdirSync(path.join(root, evidenceRelative), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${evidenceRelative}/${entry.name}`)
    .sort();
  const evidenceArtifactHashes = hashMap(topLevelEvidence);

  targetReceipt = {
    schemaVersion: 1,
    receiptId: "cgb001-ws9-konkr-target-20260824",
    classification: "target-acceptance-receipt-with-original-readback-evidence-hashes",
    modelId: model.id,
    modelVersion: model.modelVersion,
    observedOn: "2026-08-24",
    referenceCondition: {
      illuminant: "CIE D65",
      illuminationAngleDegrees: 45,
      viewAngleDegrees: 0,
      runtimeAngleModel: false,
    },
    target: {
      id: "konkr-gt78-vn-960x640-srgb-neutral",
      device: "ARBOR GT78-VN",
      deviceSerial: restoration.deviceSerial,
      operatingSystem: "Android 12",
      panelResolution: [960, 640],
      contentViewport: [640, 576],
      integerScale: 4,
    },
    runtime: {
      frontend: "RetroArch 1.22.2",
      core: "Gambatte",
      videoDriver: "Vulkan",
      gpu: "Mali-G76 MC4",
      sourceGeometry: [160, 144],
      sourceFramesPerSecond: 59.73,
      passFormats: ["R32G32B32A32_SFLOAT", "R32G32B32A32_SFLOAT", "R8G8B8A8_UNORM"],
      feedbackPass: 0,
    },
    textureTransport: {
      authoritativeArtifact: transport.authoritativeLut,
      rejectedProbe: transport.rejected,
      acceptedRuntime: transport.accepted,
      policy: "The unchanged RGBA32F LUT remains authoritative. Runtime presets use nearest-filtered paired RGBA8 high/low planes, reconstruct uint16 values, then perform explicit trilinear interpolation.",
    },
    gates: {
      allRgb555: {
        result: "pass",
        codes: lut.decoded.uniqueRgb555Codes,
        components: lut.decoded.components,
        maximumAbsoluteXyzError: lut.comparison.maximumAbsoluteXyzError,
        tolerance: lut.comparison.tolerance,
      },
      response: { result: "pass", ...response.comparison },
      exposure: { result: "pass", ...exposure.comparison },
      retention: { result: "pass", ...retention.comparison },
      aperture: {
        result: "pass",
        maximumCoverageError: aperture.comparison.maximumCoverageError,
        tolerance: aperture.comparison.tolerance,
        viewport: aperture.viewportContract.requiredContentViewport,
        scale: aperture.viewportContract.requiredScale,
      },
      lifecycle: {
        result: "pass",
        disposition: lifecycle.comparison.resumeDisposition,
        pauseDidNotIntegrateWallTime: lifecycle.comparison.pauseDidNotIntegrateWallTime,
        coldReloadEstablishedNewFrameBaseline: lifecycle.comparison.coldReloadEstablishedNewFrameBaseline,
        restrictions: lifecycle.frontendRestrictions,
      },
      framePacing: { result: "pass", frames: pacing.frames, intervals: pacing.intervals, ...pacing.intervalMs },
      priorArtDifferenceOnly: { result: "pass", reportId: priorArt.reportId },
      sourceAndCpu: { result: "pass", reportId: cpuGolden.reportId },
      deviceRestoration: { result: "pass", recordId: restoration.recordId },
    },
    repositoryArtifactHashes,
    evidenceArtifactHashes,
    originalEvidencePolicy: {
      originalsRetained: topLevelEvidence.filter((relative) => /\.(?:mp4|png|log|txt)$/.test(relative)),
      derivedReports: topLevelEvidence.filter((relative) => relative.endsWith(".json")),
      note: "MP4 captures, PNG readbacks/screenshots, the raw SurfaceFlinger timestamp stream, and the cold runtime log are hashed directly. Derived comparison JSON does not replace those originals.",
    },
    deviceRestoration: restoration,
    result: {
      status: "pass",
      referenceV1NameAllowed: true,
      userConfigurationRestored: true,
      retroarchTestProcessStopped: true,
    },
  };
  output(targetReceiptRelative, jsonBuffer(targetReceipt));
} else {
  assert(checkOnly, `WS9 evidence directory is incomplete: ${evidenceRelative}`);
  targetReceipt = readJson(targetReceiptRelative);
  assert(targetReceipt.result?.status === "pass", "stored target receipt does not pass");
  for (const [relative, expected] of Object.entries(targetReceipt.repositoryArtifactHashes ?? {})) {
    assert(fs.existsSync(path.join(root, relative)) && sha256File(relative) === expected,
      `stored target receipt repository hash is stale: ${relative}`);
  }
  assert(Object.keys(targetReceipt.evidenceArtifactHashes ?? {}).length >= reportNames.length,
    "stored target receipt lacks original evidence hashes");
}

const releaseArtifactHashes = {
  ...repositoryArtifactHashes,
  [targetReceiptRelative]: sha256File(targetReceiptRelative),
};
const releaseReceipt = {
  schemaVersion: 1,
  receiptId: "cgb001-ws9-release-v1",
  modelId: model.id,
  classification: "acceptance-receipt",
  referenceCondition: {
    illuminant: "CIE D65",
    illuminationAngleDegrees: 45,
    viewAngleDegrees: 0,
    runtimeAngleModel: false,
  },
  artifactHashes: releaseArtifactHashes,
  gates: Object.fromEntries(Array.from({ length: 9 }, (_unused, index) => [`ws${index + 1}`, "pass"])),
  environments: [
    {
      id: "node-cpu-reference",
      type: "CPU float32 equation and deterministic artifact validation",
      result: "pass",
      allRgb555Codes: 32768,
    },
    {
      id: "konkr-gt78-vn-BW0306N250002377",
      type: "RetroArch 1.22.2 / Gambatte / Vulkan / Mali-G76 MC4 target validation",
      result: "pass",
      targetReceipt: targetReceiptRelative,
    },
  ],
  uncertainties: [
    "The physical reference is frozen to CIE D65, 45 degree illumination, and normal 0 degree view; no runtime viewer-angle or head-tracking model is claimed.",
    "Temporal response, scan timing, inversion, and retention remain evidence-bounded reconstructions where panel-specific electrical waveforms are unavailable.",
    "Pause/resume is accepted as a safe shader-graph reset on this frontend; save-state feedback restoration is unsupported, and rewind, run-ahead, fast-forward, or dropped/coalesced delivery remain outside the reference contract.",
    "The rejected single RGBA16 PNG proves only the tested RetroArch generic-loader path. The accepted runtime uses explicit paired RGBA8 high/low planes while retaining the original RGBA32F LUT as authority.",
  ],
  result: {
    status: "pass",
    referenceV1NameAllowed: true,
  },
};
output(releaseReceiptRelative, jsonBuffer(releaseReceipt));

process.stdout.write(`CGB-001 WS9 receipts ${checkOnly ? "verified" : "written"}: target and release pass.\n`);
