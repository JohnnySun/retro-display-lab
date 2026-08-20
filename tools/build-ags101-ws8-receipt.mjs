#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng } from "./decode-ags101-ws5-readback.mjs";
import { decodeExposureBands } from "./decode-ags101-ws8-exposure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, ".codex-validation", "ags101-ws8-target-20260820");
const targetDir = path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral");
const outputPath = path.join(targetDir, "validation", "ags101-ws8-target-20260820.json");
const checkOnly = process.argv.includes("--check");

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = (file) => path.relative(root, file);
const artifact = (file) => ({ path: relative(file), sha256: sha256(fs.readFileSync(file)) });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exposurePath = path.join(evidenceDir, "exposure-comparison.json");
const aperturePath = path.join(evidenceDir, "aperture-comparison.json");
const retentionPath = path.join(evidenceDir, "current-retention-comparison.json");
const lifecyclePath = path.join(evidenceDir, "lifecycle-observations.json");
const coldLogPath = path.join(evidenceDir, "cold-compile-retroarch.log");
const safeLogPath = path.join(evidenceDir, "safe-boundary-retroarch.log");
const coldConfigPath = path.join(evidenceDir, "cold-compile-config.cfg");
const safeConfigPath = path.join(evidenceDir, "safe-boundary-config.cfg");
const retentionConfigPath = path.join(evidenceDir, "current-retention-config.cfg");
const exposure = readJson(exposurePath);
const aperture = readJson(aperturePath);
const retention = readJson(retentionPath);
const lifecycle = readJson(lifecyclePath);
const coldLog = fs.readFileSync(coldLogPath, "utf8");
const safeLog = fs.readFileSync(safeLogPath, "utf8");

assert(exposure.pass && exposure.coveredTargets?.join("|") === "0,0,0|31,31,31",
  "current exposure GPU comparison did not pass both alternating targets");
assert(aperture.pass && aperture.exact?.scale === 4 && aperture.fractional?.scale === 3.5,
  "current aperture scale comparison did not pass");
assert(retention.pass && retention.maximumAbsoluteError <= retention.tolerance,
  "current retention recurrence did not pass");

const compileShaders = [
  "ags101-response-v1.slang",
  "ags101-exposure-v1.slang",
  "ags101-display-v1.slang",
];
for (const shader of compileShaders) {
  assert(coldLog.includes(`[Slang] Compiling shader: `) && coldLog.includes(shader),
    `cold log did not compile ${shader}`);
}
assert(coldLog.includes("R32G32B32A32_SFLOAT for pass output #0")
  && coldLog.includes("R32G32B32A32_SFLOAT for pass output #1")
  && coldLog.includes("R8G8B8A8_UNORM for pass output #2")
  && coldLog.includes("Using framebuffer feedback for pass #0"),
"cold log lost expected pass formats or feedback binding");
assert(!/failed to|shader.*error|texture.*error/i.test(coldLog),
  "cold log contains a Shader/texture failure");

for (const setting of [
  '"TemporalResponse" = 0.000000',
  '"DriveRetention" = 0.000000',
  '"SpatialRetention" = 0.000000',
  '"BakedScanout" = 0.000000',
  '"ExposureMode" = 0.000000',
]) assert(safeLog.includes(setting), `safe-boundary log lost ${setting}`);

const safeCaptureDir = path.join(evidenceDir, "safe-captures");
const safeCapturePaths = fs.readdirSync(safeCaptureDir)
  .filter((file) => file.endsWith(".png"))
  .sort()
  .map((file) => path.join(safeCaptureDir, file));
assert(safeCapturePaths.length === 8, "safe-boundary capture set is incomplete");
const safeCaptures = safeCapturePaths.map((file) => {
  const decoded = decodeExposureBands(decodePng(file));
  const expected = decoded.targetRgb555[0] === 31 ? 1 : 0;
  const exactEndpoint = decoded.exposure.every((value) => value === expected);
  const unanimous = decoded.confidence.every((entry) => entry.unanimousBits === 32);
  assert(exactEndpoint && unanimous, `safe-boundary capture is stateful or lossy: ${relative(file)}`);
  return {
    ...artifact(file),
    frameCount: decoded.frameCount,
    targetRgb555: decoded.targetRgb555,
    exposure: decoded.exposure,
    unanimousBitsPerBand: decoded.confidence.map((entry) => entry.unanimousBits),
  };
});

assert(lifecycle.restoration?.retroarchTestProcessStopped === true,
  "lifecycle record does not confirm process stop");
assert(lifecycle.restoration?.mGbaShaderOverrideSha256
    === "f50f14658651ca8aa7e69b8ee7c81a8c602eaf7ca304e8640a3f86442bf46d7b"
  && lifecycle.restoration?.gbaShaderOverrideSha256
    === "85d470b4aa41417c76c6f96e92d79e97a5411a5e7e9ef318379079135d9300bc"
  && lifecycle.restoration?.mGbaCoreOverrideSha256
    === "c0c54e9f79517f16b4b7fe3ed15d564eb083eff9c0b36287989eb7c29969dc2e",
"device override restoration hashes are incomplete");

const repositoryFiles = [
  "models/nintendo-ags-101/data/ws7-exposure-integration-v1.json",
  "models/nintendo-ags-101/generated/ws7-exposure-validation-v1.json",
  "models/nintendo-ags-101/generated/ws8-exposure-gpu-reference-v1.json",
  "models/nintendo-ags-101/generated/ws8-presets-v1/manifest.json",
  "models/nintendo-ags-101/generated/ws4-gtg-nominal-v1.png",
  "models/nintendo-ags-101/generated/ws5-presets-v1/ags101-ws5-numeric-v1.slangp",
  "models/nintendo-ags-101/generated/ws2-stimulus-v1/parity-toggle.gba",
  "models/nintendo-ags-101/generated/ws2-stimulus-v1/retention-stress-recovery.gba",
  "models/nintendo-ags-101/shaders/ags101-response-v1.slang",
  "models/nintendo-ags-101/shaders/ags101-exposure-v1.slang",
  "models/nintendo-ags-101/shaders/ags101-display-v1.slang",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/presets/ags101-period-reconstruction-v1.slangp",
  "tools/analyze-ags101-ws8-aperture.mjs",
  "tools/build-ags101-ws8.mjs",
  "tools/build-ags101-ws8-receipt.mjs",
  "tools/compare-ags101-ws8-exposure.mjs",
  "tools/compare-ags101-ws5-target.mjs",
  "tools/decode-ags101-ws8-exposure.mjs",
].map((file) => path.join(root, file));

const evidenceFiles = [
  exposurePath,
  aperturePath,
  retentionPath,
  lifecyclePath,
  coldLogPath,
  safeLogPath,
  coldConfigPath,
  safeConfigPath,
  retentionConfigPath,
  path.join(evidenceDir, "current-three-pass.png"),
  path.join(evidenceDir, "aperture-exact4.png"),
  path.join(evidenceDir, "aperture-fractional3_5.png"),
  path.join(evidenceDir, "background-before.png"),
  path.join(evidenceDir, "background-after.png"),
  path.join(evidenceDir, "current-retention-a.png"),
  path.join(evidenceDir, "current-retention-b.png"),
  path.join(evidenceDir, "current-retention-c.png"),
];

const receipt = {
  schemaVersion: 1,
  runId: "konkr-gt78-vn-ags101-ws8-current-20260820",
  classification: "current-three-pass-device-run-and-explicit-frontend-boundary-receipt",
  date: "2026-08-20",
  modelId: "nintendo-ags-101-period-reconstruction",
  targetProfile: "konkr-gt78-vn-960x640-srgb-neutral",
  repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  repositoryState: "HEAD identifies the base commit; SHA-256 values pin the current uncommitted WS7/WS8 working-tree bytes deployed by adb.",
  device: {
    serial: "BW0306N250002377",
    manufacturer: "ARBOR",
    model: "GT78-VN",
    androidRelease: "12",
    buildFingerprint: "ARBOR/GT78-VN/GT78-VN:11/RP1A.200720.011/mp1V95182:user/release-keys",
    display: "960x640 fixed 60 Hz, density 240, color mode 0",
    gpu: "Mali-G76 MC4",
  },
  frontend: {
    name: "RetroArch",
    version: "1.22.2 (Git a609b709eb; Android versionCode 1597175267)",
    core: "mGBA at /data/data/com.retroarch/cores/mgba_libretro_android.so",
    videoDriver: "Vulkan",
    source: "240x160 at 59.727500569606 Hz",
    target: "960x640 at fixed 60 Hz",
  },
  currentPipeline: {
    passes: 3,
    response: { format: "R32G32B32A32_SFLOAT", feedback: true },
    exposure: { format: "R32G32B32A32_SFLOAT", feedback: false },
    display: { format: "R8G8B8A8_UNORM", output: "960x640" },
    coldCompilePass: true,
    shaderTextureCompileErrors: 0,
  },
  numericReadback: {
    exposure: {
      method: "DebugView 13 float-bit bands at exact 4x",
      coveredTargets: exposure.coveredTargets,
      maximumCpuVsGpuAbsoluteError: exposure.maximumAbsoluteError,
      tolerance: exposure.tolerance,
      pass: exposure.pass,
    },
    aperture: {
      method: "DebugView 14 quarter-linear energy averaged over exact 4x and centered 3.5x",
      maximumCpuVsGpuAbsoluteError: aperture.maximumCpuError,
      maximumScaleDifference: aperture.maximumScaleDifference,
      tolerance: aperture.tolerance,
      pass: aperture.pass,
    },
    retention: {
      method: "DebugView 12 float-bit bands through the current three-pass route",
      intervals: retention.intervals.map((item) => [item.fromFrame, item.toFrame]),
      maximumCpuVsGpuAbsoluteError: retention.maximumAbsoluteError,
      tolerance: retention.tolerance,
      pass: retention.pass,
    },
    frontendSafeBypass: {
      method: "DebugView 13 with TemporalResponse/DriveRetention/BakedScanout/ExposureMode all disabled",
      captures: safeCaptures,
      everyEndpointMatchedCurrentRgb555Exactly: true,
      pass: true,
    },
  },
  lifecycle: lifecycle,
  acceptance: {
    currentWs7ThreePassArtifactsCompiledOnTarget: true,
    gpuExposureMatchesCpu: true,
    gpuApertureEnergyMatchesCpuAtIntegerAndFractionalScale: true,
    gpuRetentionRecurrenceMatchesCpuThroughCurrentRoute: true,
    normalForwardFixedPeriodPath: "pass",
    backgroundResume: "safe-reset-boundary-not-continuous-history",
    contentReload: "pass-as-clean-reset",
    saveStateLoad: "unsupported-for-shader-history",
    rewindAndRunAhead: "disabled",
    activeFastForwardHistory: "unsupported; normal target configuration is fixed at 1x",
    variableRefresh: "not-applicable-on-this-fixed-60-Hz-target",
    statelessSafeBoundary: "pass",
    currentArtifactReceipt: "pass-with-explicit-unsupported-boundaries",
    promotionEligible: true,
    promotionApplied: true,
    promotedModelId: "nintendo-ags-101-period-reconstruction",
  },
  explicitPostPromotionLimitations: [
    "Save-state load does not serialize PassFeedback0 and therefore cannot restore GtG or retained-DC history.",
    "No active accelerated-frame history is accepted; the current target route remains fixed at 1x.",
    "KONKR has no VRR mode, so stateful behavior under unknown VRR duplicate/drop histories is not validated.",
    "The current aperture remains a generic prior and the GtG/retention weights remain literature/project reconstructions rather than AGS-101 specimen measurements.",
  ],
  artifacts: {
    repository: repositoryFiles.map(artifact),
    runEvidence: evidenceFiles.map(artifact),
  },
  restoration: lifecycle.restoration,
  notes: "This replaces the WS5-only historical-current status for the checked-out WS7 three-pass pipeline. It validates implementation on KONKR, not an AGS-101 specimen or calibrated emitted-light output.",
};

const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
if (checkOnly) {
  assert(fs.existsSync(outputPath), `${relative(outputPath)} is missing`);
  assert(fs.readFileSync(outputPath, "utf8") === serialized, `${relative(outputPath)} is stale`);
  process.stdout.write("AGS-101 WS8 current KONKR receipt is current.\n");
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  process.stdout.write(`Wrote ${relative(outputPath)}.\n`);
}
