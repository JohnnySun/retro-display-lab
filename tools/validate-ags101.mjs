#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  LITERATURE_CELL_PRIOR,
  PANEL_FPS,
  PANEL_FRAME_SECONDS,
  effectiveDriveCode,
  framePolarity,
  rgb555DriveCodeProxy,
  spatialDriveExcitation,
  stepResidualDc,
  stepSpatialRetention,
} from "../models/nintendo-ags-101/reference/drive-retention.mjs";
import {
  GBA_CYCLES_PER_LINE,
  GBA_FRAME_HZ,
  GBA_FRAME_SECONDS,
  GBA_LINE_SECONDS,
  GBA_MASTER_CLOCK_HZ,
  GBA_TOTAL_LINES,
  drivePolarity,
  inversionSpatialPhase,
  scanEvent,
  sourcePairForEvent,
} from "../models/nintendo-ags-101/reference/scan-timing.mjs";
import {
  GTG_FIT_VERSION,
  GTG_SCHEMA_VERSION,
  analyticFrameAlpha,
  analyticRate,
  decodeRate16,
  deriveWaveformMetrics,
  encodeRate16,
  fitFirstOrder,
  frameAlphaToRate,
  rateToAlpha,
  sampleRateField,
  stepFirstOrder,
} from "../models/nintendo-ags-101/reference/gtg-response.mjs";
import {
  WS4_EQUATION_ID,
  buildReconstructedCells,
  reconstructedTransition,
  validateEnsembleDefinition,
} from "../models/nintendo-ags-101/reference/gtg-ensemble.mjs";
import {
  clamp,
  hcsHostLinear,
  renderStaticRgb555,
  srgbDecodeChannel,
  srgbEncodeChannel,
} from "../models/nintendo-ags-101/reference/color-pipeline.mjs";
import {
  BALANCED_DRIVE,
  integrateOptical,
  integrateResidualDc,
  integrateScanoutFrame,
  integrateSegment,
  opticalToCode,
} from "../models/nintendo-ags-101/reference/temporal-pipeline.mjs";
import {
  apertureEnergyNormalization,
  averageUniformAperture,
  relativeBacklightGain,
} from "../models/nintendo-ags-101/reference/panel-optics.mjs";
import {
  applyStaticBacklight,
  compositeSimpsonFirstOrder,
  firstOrderIntegral,
} from "../models/nintendo-ags-101/reference/exposure-integration.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const shaderDir = path.join(modelDir, "shaders");
const presetDir = path.join(modelDir, "presets");
const hcsSource = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "hcs-e688fc5-color.json"),
  "utf8",
));
const hcsColor = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "hcs-e688fc5-color.json"),
  "utf8",
));
const scanCaptureSchema = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "scan-capture.schema.json"),
  "utf8",
));
const gtgSchema = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "gtg-measurement.schema.json"),
  "utf8",
));
const gtgSynthetic = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "gtg-synthetic-v1.json"),
  "utf8",
));
const gtgManifest = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "gtg-synthetic-v1.json"),
  "utf8",
));
const gtgFit = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "gtg-synthetic-v1-fit.json"),
  "utf8",
));
const frontendValidationSchema = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "frontend-validation.schema.json"),
  "utf8",
));
const frontendValidationTemplate = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "frontend-validation-template.json"),
  "utf8",
));
const ws1Inventory = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws1-evidence-inventory-v1.json"),
  "utf8",
));
const ws1Baseline = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws1-baseline-v1.json"),
  "utf8",
));
const electricalCaptureSchema = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "electrical-capture.schema.json"),
  "utf8",
));
const photodiodeCaptureSchema = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "photodiode-capture.schema.json"),
  "utf8",
));
const ws2StimulusManifestPath = path.join(
  modelDir,
  "generated",
  "ws2-stimulus-v1",
  "manifest.json",
);
const ws2StimulusManifest = JSON.parse(fs.readFileSync(ws2StimulusManifestPath, "utf8"));
const ws2CaptureDir = path.join(modelDir, "generated", "ws2-capture-loopback-v1");
const ws2CaptureSession = JSON.parse(fs.readFileSync(
  path.join(ws2CaptureDir, "session.json"),
  "utf8",
));
const ws2CaptureReport = JSON.parse(fs.readFileSync(
  path.join(ws2CaptureDir, "report.json"),
  "utf8",
));
const ws2GtgSubset = JSON.parse(fs.readFileSync(
  path.join(ws2CaptureDir, "gtg-measurement-subset.json"),
  "utf8",
));
const ws2GtgRuntime = JSON.parse(fs.readFileSync(
  path.join(ws2CaptureDir, "gtg-runtime.json"),
  "utf8",
));
const ws2MgbaReceiptPath = path.join(modelDir, "generated", "ws2-mgba-smoke-v1", "report.json");
const ws2MgbaReceipt = JSON.parse(fs.readFileSync(ws2MgbaReceiptPath, "utf8"));
const ws3ConstraintSourcePath = path.join(modelDir, "data", "ws3-timing-constraints-v1.json");
const ws3ConstraintSource = JSON.parse(fs.readFileSync(ws3ConstraintSourcePath, "utf8"));
const ws3GeneratedPath = path.join(modelDir, "generated", "ws3-timing-constraints-v1.json");
const ws3Generated = JSON.parse(fs.readFileSync(ws3GeneratedPath, "utf8"));
const ws3SensitivityPath = path.join(modelDir, "generated", "ws3-sensitivity-v1.json");
const ws3Sensitivity = JSON.parse(fs.readFileSync(ws3SensitivityPath, "utf8"));
const ws3CompilePath = path.join(modelDir, "generated", "ws3-shader-compile-v1.json");
const ws3Compile = JSON.parse(fs.readFileSync(ws3CompilePath, "utf8"));
const ws3PresetDir = path.join(modelDir, "generated", "ws3-presets-v1");
const ws3PresetManifestPath = path.join(ws3PresetDir, "manifest.json");
const ws3PresetManifest = JSON.parse(fs.readFileSync(ws3PresetManifestPath, "utf8"));
const ws4Evidence = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws4-evidence-inventory-v1.json"), "utf8",
));
const ws4Ensemble = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws4-gtg-ensemble-v1.json"), "utf8",
));
const ws4Manifests = Object.fromEntries(["fast", "nominal", "slow"].map((member) => [
  member,
  JSON.parse(fs.readFileSync(path.join(modelDir, "generated", `ws4-gtg-${member}-v1.json`), "utf8")),
]));
const ws4Coverage = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws4-coverage-v1.json"), "utf8",
));
const ws4Validation = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws4-validation-v1.json"), "utf8",
));
const ws4PresetManifest = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws4-presets-v1", "manifest.json"), "utf8",
));
const ws5Evidence = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws5-evidence-inventory-v1.json"), "utf8",
));
const ws5Reconstruction = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws5-retention-reconstruction-v1.json"), "utf8",
));
const ws5Validation = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws5-retention-validation-v1.json"), "utf8",
));
const ws5PresetManifest = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws5-presets-v1", "manifest.json"), "utf8",
));
const ws6Definition = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "ws6-panel-optics-v1.json"), "utf8",
));
const ws6Validation = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws6-validation-v1.json"), "utf8",
));
const ws6PresetManifest = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws6-presets-v1", "manifest.json"), "utf8",
));
const ws7DefinitionPath = path.join(modelDir, "data", "ws7-exposure-integration-v1.json");
const ws7Definition = JSON.parse(fs.readFileSync(ws7DefinitionPath, "utf8"));
const ws7ValidationPath = path.join(
  modelDir, "generated", "ws7-exposure-validation-v1.json",
);
const ws7Validation = JSON.parse(fs.readFileSync(ws7ValidationPath, "utf8"));
const ws7PresetManifestPath = path.join(
  modelDir, "generated", "ws7-presets-v1", "manifest.json",
);
const ws7PresetManifest = JSON.parse(fs.readFileSync(ws7PresetManifestPath, "utf8"));
const ws8ReferencePath = path.join(
  modelDir, "generated", "ws8-exposure-gpu-reference-v1.json",
);
const ws8Reference = JSON.parse(fs.readFileSync(ws8ReferencePath, "utf8"));
const ws8PresetManifestPath = path.join(
  modelDir, "generated", "ws8-presets-v1", "manifest.json",
);
const ws8PresetManifest = JSON.parse(fs.readFileSync(ws8PresetManifestPath, "utf8"));
const ws8TargetReceiptPath = path.join(
  root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation",
  "ags101-ws8-target-20260820.json",
);
const ws8TargetReceipt = JSON.parse(fs.readFileSync(ws8TargetReceiptPath, "utf8"));
const performanceTargetReceiptPath = path.join(
  root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation",
  "ags101-performance-20260821.json",
);
const performanceTargetReceipt = JSON.parse(
  fs.readFileSync(performanceTargetReceiptPath, "utf8"),
);
const currentTargetReceiptPath = path.join(
  root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation",
  "ags101-timing-default-20260821.json",
);
const currentTargetReceipt = JSON.parse(
  fs.readFileSync(currentTargetReceiptPath, "utf8"),
);
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function presetNumber(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^${escaped}\\s*=\\s*"([^"]+)"$`, "m"));
  return match ? Number(match[1]) : Number.NaN;
}

const references = fs.readFileSync(path.join(modelDir, "REFERENCES.md"), "utf8");
const evidenceIds = new Set(
  [...references.matchAll(/^### (AGS-[A-Z]+-\d+)\b/gm)].map((match) => match[1]),
);
const metadata = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
const metadataEvidenceIds = new Set(metadata.evidenceIds ?? []);
const requiredEvidenceIds = [
  "AGS-HW-01",
  "AGS-COLOR-01",
  "AGS-METER-01",
  "AGS-COLOR-02",
  "AGS-GTG-01",
  "AGS-GTGDATA-01",
  "AGS-STICK-01",
  "AGS-ION-01",
  "AGS-DRIVE-01",
  "AGS-FEED-01",
  "AGS-RETENTION-01",
  "AGS-FRONTEND-01",
  "AGS-PANEL-01",
  "AGS-APERTURE-01",
  "AGS-BACKLIGHT-01",
  "AGS-NEUTRAL-01",
  "AGS-TIMING-01",
  "AGS-BASELINE-01",
  "AGS-STIMULUS-01",
  "AGS-CAPTURE-01",
  "AGS-MGBA-01",
  "AGS-RECON-01",
  "AGS-EXPOSURE-01",
];
for (const id of requiredEvidenceIds) {
  check(evidenceIds.has(id), `AGS evidence map is missing required ID ${id}`);
}

function checkEvidence(source, file) {
  check(source.includes("REFERENCES.md"), `${file}: missing REFERENCES.md pointer`);
  const used = [...source.matchAll(/\[(AGS-[A-Z]+-\d+)\]/g)].map((match) => match[1]);
  check(used.length > 0, `${file}: missing AGS evidence ID`);
  for (const id of used) {
    check(evidenceIds.has(id), `${file}: undefined evidence ID ${id}`);
    check(metadataEvidenceIds.has(id), `${file}: evidence ID ${id} missing from model.json`);
  }
}

const shaderFiles = fs.readdirSync(shaderDir).filter((file) => file.endsWith(".slang")).sort();
const includeFiles = fs.readdirSync(shaderDir).filter((file) => file.endsWith(".inc")).sort();
const presetFiles = fs.readdirSync(presetDir).filter((file) => file.endsWith(".slangp")).sort();
check(shaderFiles.length === 3, `expected 3 AGS shaders, found ${shaderFiles.length}`);
check(includeFiles.length === 3, `expected 3 AGS shader includes, found ${includeFiles.length}`);
check(presetFiles.length === 13, `expected 13 AGS presets, found ${presetFiles.length}`);

for (const file of includeFiles) {
  checkEvidence(fs.readFileSync(path.join(shaderDir, file), "utf8"), file);
}

for (const file of shaderFiles) {
  const source = fs.readFileSync(path.join(shaderDir, file), "utf8");
  checkEvidence(source, file);
  check(source.includes("#version 450"), `${file}: missing GLSL 450 declaration`);
  check(source.includes("#pragma stage vertex"), `${file}: missing vertex stage`);
  check(source.includes("#pragma stage fragment"), `${file}: missing fragment stage`);
  let depth = 0;
  for (const character of source.replace(/\/\/.*$/gm, "")) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) break;
  }
  check(depth === 0, `${file}: unbalanced braces`);
}

for (const file of presetFiles) {
  const source = fs.readFileSync(path.join(presetDir, file), "utf8");
  checkEvidence(source, file);
  if (file === "physics-seed-v1.slangp") {
    check(source.includes("Deprecated compatibility alias")
      && source.includes('#reference "period-reconstruction-v1.slangp"'),
    `${file}: legacy alias no longer routes to the promoted preset`);
  } else if (file !== "period-reconstruction-v1.slangp") {
    check(source.includes("Generated by tools/build-ags101-ws1.mjs"),
      `${file}: diagnostic preset is not generated in full compatibility form`);
    check(!source.includes("#reference"),
      `${file}: diagnostic preset still depends on inherited #reference overrides`);
  }
  const localReferences = [
    ...[...source.matchAll(/shader\d+\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/#reference\s+"([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/^\w+\s*=\s*"([^"]+\.(?:png|jpg|jpeg|bmp|tga))"/gmi)]
      .map((match) => match[1]),
  ];
  for (const target of localReferences) {
    check(fs.existsSync(path.resolve(presetDir, target)), `${file}: missing reference ${target}`);
  }
}

const responseSource = fs.readFileSync(path.join(shaderDir, "ags101-response-v1.slang"), "utf8");
check(responseSource.includes("PassFeedback0"), "AGS response lost causal feedback");
check(responseSource.includes("optical_to_code"), "AGS response lost continuous optical-to-code state");
check(responseSource.includes("MidGrayDrag"), "AGS response lost GtG middle-gray term");
check(responseSource.includes('include "ags101-drive-retention.inc"'),
  "AGS response lost shared drive-retention equations");
check(responseSource.includes('include "ags101-ws3-timing.inc"'),
  "AGS response lost generated WS3 timing equations");
check(responseSource.includes("encode_residual_dc"), "AGS response lost residual-DC state");
check(responseSource.includes("ws3_drive_polarity(")
  && responseSource.includes("params.ParityPhase")
  && responseSource.includes("params.InversionTopology"),
"AGS response lost selectable WS3 polarity/inversion hypotheses");
check(responseSource.includes("effective_drive_code"),
  "AGS response lost electrical-to-optical drive coupling");
check(responseSource.includes("R32G32B32A32_SFLOAT"),
  "AGS response lost float32 state framebuffer");
check(!responseSource.includes("dot(targetCode"),
  "AGS response restored picture-luma electrical excitation");
check(!responseSource.includes("IonOpticalGain"),
  "AGS response restored arbitrary post-EOTF ion gain");
check(responseSource.includes("srgb_decode_channel"), "AGS public response lost neutral adapter");
check(responseSource.includes("HCS_RGB555_EOTF[32]"), "AGS response lost generated HCS EOTF");
check(responseSource.includes("source_eotf"), "AGS response lost selectable source EOTF");
check(responseSource.includes("HcsMeasuredColor"), "AGS response lost HCS color selector");
check(responseSource.includes("GtgRateLut"), "AGS response lost packed GtG rate texture");
check(responseSource.includes("table_rate_channel"), "AGS response lost per-channel GtG table lookup");
check(responseSource.includes("analytic_gtg_rate"), "AGS response lost analytic GtG fallback");
check(responseSource.includes("GtgTableBackend"), "AGS response lost GtG backend selector");
check(responseSource.includes("TemporalResponse"), "AGS response lost GtG isolation switch");
check(responseSource.includes("DriveRetention"), "AGS response lost drive-retention isolation switch");
check(responseSource.includes("SpatialRetention")
  && responseSource.includes("SpatialCodeWeight")
  && responseSource.includes("PolarityDriveWeight")
  && responseSource.includes("ws5_drive_excitation"),
"AGS response lost WS5 code/polarity excitation");
check(!responseSource.includes("nearest_rgb555_code"),
  "AGS response restored repeated nearest-code GtG quantization");
check(responseSource.includes("OriginalHistory1"), "AGS scanout lost previous source frame");
check(responseSource.includes("OriginalHistory2"), "AGS scanout lost causal cross-frame source history");
const ws3TimingIncludeSource = fs.readFileSync(
  path.join(shaderDir, "ags101-ws3-timing.inc"), "utf8",
);
check(ws3TimingIncludeSource.includes("GBA_TOTAL_LINES = 228.0"),
  "AGS generated WS3 timing include lost 228-line timebase");
check(ws3TimingIncludeSource.includes("GBA_MASTER_CLOCK_HZ = 16777216.0"),
  "AGS generated WS3 timing include lost exact GBA master clock");
check(ws3TimingIncludeSource.includes("GBA_CYCLES_PER_LINE = 1232.0"),
  "AGS generated WS3 timing include lost exact GBA line cycle count");
check(responseSource.includes("sourceCoord.y"), "AGS scanout phase is not source-row based");
check(responseSource.includes("LatchOffsetLines"), "AGS scanout lost explicit latch event");
check(responseSource.includes("OpticalDelaySeconds"), "AGS scanout lost explicit optical event");
check(responseSource.includes("ws3_scan_event"), "AGS scanout lost generated event calculation");
check(responseSource.includes("response_for_time"), "AGS scanout lost time-scaled response");
check(responseSource.includes("BakedScanout"), "AGS scanout lost temporal-only switch");
check(responseSource.includes("global.TotalSubFrames != 1u"), "AGS scanout lost N=1 fail-safe");
check(responseSource.includes("bvec3 changed"), "AGS scanout lost per-subpixel split mask");
check(responseSource.includes("integrate_residual_segment"),
  "AGS scanout lost partitionable electrical update");
check(!responseSource.includes("linePhase = clamp"),
  "AGS scanout restored frame-edge clamping instead of causal wrapping");
const scanoutFragmentMain = responseSource.slice(responseSource.lastIndexOf("void main()"));
check(
  scanoutFragmentMain.indexOf("feedback.a < 0.125")
    < scanoutFragmentMain.indexOf("texelFetch(OriginalHistory1"),
  "AGS scanout uses source history before first-frame feedback initialization",
);

const exposureSource = fs.readFileSync(path.join(shaderDir, "ags101-exposure-v1.slang"), "utf8");
check(exposureSource.includes("PassFeedback0")
  && exposureSource.includes("uniform sampler2D Source"),
"AGS exposure pass lost previous endpoint feedback or current pass-0 endpoint input");
check(exposureSource.includes("OriginalHistory1")
  && exposureSource.includes("OriginalHistory2")
  && exposureSource.includes("ws3_scan_event"),
"AGS exposure pass lost causal WS3 source history or scan-event reconstruction");
check(exposureSource.includes("integrate_exposure_segment")
  && exposureSource.includes("effectiveTarget * dtSeconds")
  && exposureSource.includes("(vec3(1.0) - decay) / rate"),
"AGS exposure pass lost the exact first-order emitted-light segment integral");
check(exposureSource.includes("lightIntegral / FRAME_SECONDS")
  && exposureSource.includes("endpoint.a"),
"AGS exposure pass no longer outputs a native-frame average with endpoint residual alpha");
check(exposureSource.includes("ExposureMode")
  && exposureSource.includes("global.TotalSubFrames != 1u"),
"AGS exposure pass lost its endpoint diagnostic or unsupported-subframe bypass");
check(exposureSource.includes('include "ags101-exposure-optics.inc"')
  && exposureSource.includes('include "ags101-ws3-timing.inc"'),
"AGS exposure pass lost generated HCS/GtG constants or shared WS3 timing");
check(exposureSource.includes("R32G32B32A32_SFLOAT"),
  "AGS exposure pass lost float32 emitted-light precision");

const displaySource = fs.readFileSync(path.join(shaderDir, "ags101-display-v1.slang"), "utf8");
check(displaySource.includes("integrate_aperture"), "AGS display lost analytic aperture integration");
check(displaySource.includes("leftMask.bgr"), "AGS display lost BGR ordering");
check(displaySource.includes("aperture_energy_normalization")
  && displaySource.includes("ApertureHorizontalRadius")
  && displaySource.includes("ApertureVerticalRadius"),
"AGS display lost WS6 generic-aperture geometry or energy normalization");
check(displaySource.includes("backlight_relative_gain")
  && displaySource.includes("BacklightScaleEnabled")
  && displaySource.includes("BacklightRelativeGain"),
"AGS display lost independently bypassable WS6 backlight sensitivity");
check(displaySource.includes("srgb_encode_channel"), "AGS display lost neutral host encoding");
check(displaySource.includes("HCS_NATIVE_RGB_TO_XYZ"), "AGS display lost generated HCS matrix");
check(displaySource.includes("hcs_native_to_host_linear"), "AGS display lost HCS output transform");
check(displaySource.includes("HcsImproveContrast"), "AGS display lost measured-black control");
check(displaySource.includes("HcsChromaticAdaptation"), "AGS display lost HCS white adaptation control");
check(displaySource.includes("DebugView"), "AGS display lost unified diagnostic selector");
check(displaySource.includes('#pragma parameter DebugView "AGS diagnostic view" 0.0 0.0 14.0 1.0'),
  "AGS display diagnostic range no longer exposes WS8 readback views 13 and 14");
check(displaySource.includes("uniform sampler2D Original"),
  "AGS display diagnostics lost original source access");
check(displaySource.includes("gtg_table_available"),
  "AGS display diagnostics lost GtG table/fallback status");
check(displaySource.includes("scan_diagnostic"),
  "AGS display diagnostics lost row/latch/optical overlay");
check(displaySource.includes('include "ags101-ws3-timing.inc"')
  && displaySource.includes("scan_event_diagnostic")
  && displaySource.includes("parity_phase_diagnostic")
  && displaySource.includes("inversion_topology_diagnostic"),
"AGS display lost independent WS3 event/parity/inversion diagnostics");
check(displaySource.includes("drive_diagnostic"),
  "AGS display diagnostics lost separated electrical views");
check(displaySource.includes("ws5_spatial_diagnostic")
  && displaySource.includes("ws5_numeric_readback")
  && displaySource.includes("debugView == 11")
  && displaySource.includes("debugView == 12"),
"AGS display lost WS5 spatial or numeric diagnostics");
check(displaySource.includes("ws8_exposure_numeric_readback")
  && displaySource.includes("floatBitsToUint(exposure.r)")
  && displaySource.includes("packedTarget")
  && displaySource.includes("debugView == 13"),
"AGS display lost the WS8 lossless exposure numeric readback");
check(displaySource.includes("aperture_uniform_energy")
  && displaySource.includes("0.25 * aperture_uniform_energy(vTexCoord)")
  && displaySource.includes("debugView == 14"),
"AGS display lost the WS8 quarter-linear aperture energy view");
check(displaySource.includes("panel_without_aperture")
  && displaySource.includes("panel_with_aperture")
  && displaySource.includes("ApertureEnabled"),
"AGS display lost aperture isolation/comparison path");
check(displaySource.includes("ws3_drive_polarity("),
  "AGS drive diagnostic lost selected polarity/inversion view");
check(!displaySource.includes("DebugIonState"),
  "AGS display retained the superseded one-purpose debug selector");
check(!responseSource.includes("DebugView"),
  "AGS read-only diagnostic selector leaked into the feedback-writing pass");

const reconstructionPresetSource = fs.readFileSync(
  path.join(presetDir, "period-reconstruction-v1.slangp"), "utf8",
);
const neutralPresetSource = fs.readFileSync(path.join(presetDir, "neutral-baseline-v1.slangp"), "utf8");
const gtgSyntheticPresetSource = fs.readFileSync(
  path.join(presetDir, "gtg-synthetic-table-v1.slangp"), "utf8",
);
check(reconstructionPresetSource.includes('HcsMeasuredColor = "1.0"'),
  "AGS default physics preset does not enable HCS measured color");
check(reconstructionPresetSource.includes('HcsImproveContrast = "1.0"'),
  "AGS default physics preset does not select HCS black-subtracted mode");
check(reconstructionPresetSource.includes('GtgTableBackend = "1.0"'),
  "AGS default preset does not enable the WS4 reconstructed table");
check(reconstructionPresetSource.includes('GtgRateLut = "../generated/ws4-gtg-nominal-v1.png"'),
  "AGS default preset lost the WS4 nominal GtG texture binding");
check(reconstructionPresetSource.includes('shaders = "3"')
  && reconstructionPresetSource.includes('shader0 = "../shaders/ags101-response-v1.slang"')
  && reconstructionPresetSource.includes('shader1 = "../shaders/ags101-exposure-v1.slang"')
  && reconstructionPresetSource.includes('shader2 = "../shaders/ags101-display-v1.slang"'),
"AGS default preset lost the WS7 three-pass endpoint/exposure/display order");
check(!reconstructionPresetSource.includes("float_framebuffer0"),
  "AGS default preset overrides the response shader's required RGBA32F format");
check(gtgSyntheticPresetSource.includes('GtgTableBackend = "1.0"'),
  "AGS synthetic GtG pipeline preset does not enable the table backend");
check(gtgSyntheticPresetSource.includes('GtgRateLut = "../generated/gtg-synthetic-v1.png"'),
  "AGS synthetic GtG pipeline preset no longer binds the test-only fixture");
check(reconstructionPresetSource.includes('TemporalResponse = "1.0"')
  && reconstructionPresetSource.includes('DriveRetention = "1.0"')
  && reconstructionPresetSource.includes('SpatialRetention = "1.0"')
  && reconstructionPresetSource.includes('SpatialCodeWeight = "0.500"')
  && reconstructionPresetSource.includes('PolarityDriveWeight = "0.250"')
  && reconstructionPresetSource.includes('ApertureEnabled = "1.0"')
  && reconstructionPresetSource.includes('ApertureHorizontalRadius = "1.50"')
  && reconstructionPresetSource.includes('ApertureVerticalRadius = "0.63"')
  && reconstructionPresetSource.includes('BacklightScaleEnabled = "0.0"')
  && reconstructionPresetSource.includes('BacklightRelativeGain = "1.0"')
  && reconstructionPresetSource.includes('ExposureMode = "1.0"')
  && reconstructionPresetSource.includes('DebugView = "0.0"'),
"AGS default preset lost normal mechanism/diagnostic switches");
for (const [parameter, expected] of [
  ["DriveDcOffset", "0.100"],
  ["IonAdsorptionRate", "0.0010583333"],
  ["IonDesorptionRate", "0.0004250000"],
  ["DriveCodeCoupling", "0.150"],
]) {
  check(reconstructionPresetSource.includes(`${parameter} = "${expected}"`),
    `AGS default preset lost theoretical reconstruction ${parameter}=${expected}`);
}
for (const legacyParameter of ["IonChargeTau", "IonReleaseTau", "IonOpticalGain", "IonStrength"]) {
  check(!reconstructionPresetSource.includes(legacyParameter),
    `AGS default preset retains legacy luma-ION parameter ${legacyParameter}`);
}
check(neutralPresetSource.includes('HcsMeasuredColor = "0.0"'),
  "AGS neutral regression preset does not disable HCS measured color");
for (const [parameter, expected] of Object.entries(ws1Baseline.controls ?? {})) {
  check(presetNumber(neutralPresetSource, parameter) === expected,
    `AGS neutral/static baseline control ${parameter} drifted from WS1 record`);
}
check(ws1Baseline.classification === "repository-regression-baseline-not-device-run",
  "AGS WS1 repository baseline is misclassified as device evidence");
check(ws1Baseline.deviceReceipt?.status
  === "current-deployment-presentation-and-frame-pacing-pass-full-numeric-rerun-not-performed",
  "AGS WS1 baseline does not disclose the current device/numeric boundary");
check(ws1Baseline.deviceReceipt?.lastFullNumericRecord
    === "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws8-target-20260820.json"
  && ws1Baseline.deviceReceipt?.lastPerformanceRecord
    === "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-performance-20260821.json"
  && ws1Baseline.deviceReceipt?.currentRecord
    === "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-timing-default-20260821.json",
"AGS WS1 baseline lost its historical receipts or current-artifact boundary");

const shaderParameterNames = new Set(
  [responseSource, exposureSource, displaySource].flatMap((source) => (
    [...source.matchAll(/^#pragma parameter\s+(\w+)\b/gm)].map((match) => match[1])
  )),
);
const inventoryParameterNames = Object.keys(ws1Inventory.parameters ?? {});
check(ws1Inventory.sourcePreset === "presets/period-reconstruction-v1.slangp",
  "AGS WS1 evidence inventory lost its canonical source preset");
check(inventoryParameterNames.length === shaderParameterNames.size,
  "AGS WS1 evidence inventory does not cover every runtime parameter");
for (const parameter of shaderParameterNames) {
  const entry = ws1Inventory.parameters?.[parameter];
  check(Boolean(entry), `AGS WS1 evidence inventory is missing ${parameter}`);
  if (!entry) continue;
  check(Number.isFinite(entry.value), `AGS WS1 inventory ${parameter} has no numeric value`);
  check([
    "measured",
    "literature-derived",
    "project-derived",
    "target-compensation",
    "synthetic-fixture",
  ].includes(entry.claimClass), `AGS WS1 inventory ${parameter} has invalid claim class`);
  check(presetNumber(reconstructionPresetSource, parameter) === entry.value,
    `AGS default ${parameter} drifted from the canonical WS1 inventory`);
  for (const id of entry.evidenceIds ?? []) {
    check(evidenceIds.has(id), `AGS WS1 inventory ${parameter} uses undefined ${id}`);
  }
}
for (const parameter of inventoryParameterNames) {
  check(shaderParameterNames.has(parameter),
    `AGS WS1 evidence inventory retains unknown parameter ${parameter}`);
}
check(ws1Inventory.parameters?.DriveCodeCoupling?.value === 0.15,
  "AGS canonical DriveCodeCoupling default is not the validated 0.15 project prior");
check(ws1Inventory.parameters?.LatchOffsetLines?.value === 0
  && ws1Inventory.parameters?.InversionTopology?.value === 1,
"AGS canonical inventory lost the line-start/row-alternating reconstruction defaults");
check(metadata.evidence?.parameterEvidenceInventory === "data/ws1-evidence-inventory-v1.json",
  "AGS model metadata lost the canonical WS1 evidence inventory");
check(metadata.evidence?.repositoryBaseline === "generated/ws1-baseline-v1.json",
  "AGS model metadata lost the WS1 repository baseline");
check(metadata.evidence?.retentionExcitation?.includes("RGB555-command")
  && metadata.evidence?.retentionValidationReceipt === "generated/ws5-retention-validation-v1.json",
"AGS model metadata lost the WS5 reconstructed excitation or receipt");
check(metadata.limitations?.some((value) => value.includes("unfitted sensitivity priors")),
  "AGS limitations no longer disclose the WS5 parameter gap");

for (const vector of ws1Baseline.vectors ?? []) {
  const expected = renderStaticRgb555(vector.rgb555, hcsColor, { measured: false });
  check(expected.length === vector.encodedSrgb?.length
    && expected.every((value, channel) => (
      Math.abs(value - vector.encodedSrgb[channel]) <= ws1Baseline.tolerance.cpuAbsolute
    )), `AGS WS1 neutral/static vector drifted at ${vector.rgb555?.join("/")}`);
}
for (const [relative, expectedHash] of Object.entries(ws1Baseline.artifacts ?? {})) {
  const artifactPath = path.join(root, relative);
  check(fs.existsSync(artifactPath), `AGS WS1 baseline artifact is missing: ${relative}`);
  if (!fs.existsSync(artifactPath)) continue;
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  check(actualHash === expectedHash, `AGS WS1 baseline artifact hash drifted: ${relative}`);
}

const driveResearch = fs.readFileSync(
  path.join(root, "docs", "research", "ags-101-drive-retention.md"),
  "utf8",
);
check(driveResearch.includes("`DriveCodeCoupling=0.15`")
  && !driveResearch.includes("`DriveCodeCoupling` remains zero"),
"AGS drive-retention research still contradicts the 0.15 default");
check(reconstructionPresetSource.includes('BakedScanout = "1.0"'),
  "AGS default physics preset does not enable three-phase scan timing");
check(reconstructionPresetSource.includes('LatchOffsetLines = "0.0"'),
  "AGS scanout default lost family-constrained line-start latch");
check(reconstructionPresetSource.includes('OpticalDelaySeconds = "0.000000"'),
  "AGS scanout default lost zero pure optical-delay prior");
check(reconstructionPresetSource.includes('ParityPhase = "0.0"')
  && reconstructionPresetSource.includes('InversionTopology = "1.0"'),
"AGS default profile lost its family-constrained row/frame inversion reconstruction");
const temporalOnlyPresetSource = fs.readFileSync(
  path.join(presetDir, "scanout-temporal-only-v1.slangp"), "utf8",
);
check(temporalOnlyPresetSource.includes('BakedScanout = "0.0"'),
  "AGS temporal-only diagnostic preset drifted");
const lineStartPresetSource = fs.readFileSync(
  path.join(presetDir, "scanout-line-start-v1.slangp"), "utf8",
);
const lineEndPresetSource = fs.readFileSync(
  path.join(presetDir, "scanout-line-end-v1.slangp"), "utf8",
);
check(lineStartPresetSource.includes('LatchOffsetLines = "0.0"'),
  "AGS line-start diagnostic preset drifted");
check(lineEndPresetSource.includes('LatchOffsetLines = "1.0"'),
  "AGS line-end diagnostic preset drifted");

const diagnosticsPresetSource = fs.readFileSync(
  path.join(presetDir, "diagnostics-v1.slangp"), "utf8",
);
check(diagnosticsPresetSource.includes('DebugView = "1.0"'),
  "AGS unified diagnostic preset lost its native-state entry view");
for (const debugView of [6, 7, 8, 9, 10, 11, 12, 13, 14]) {
  check(displaySource.includes(`debugView == ${debugView}`),
    `AGS display lost independent WS3 DebugView ${debugView}`);
}
check(!responseSource.includes("DebugView"),
  "AGS WS3 read-only diagnostic selector leaked into persistent feedback");
const staticIsolationSource = fs.readFileSync(
  path.join(presetDir, "isolation-static-color-v1.slangp"), "utf8",
);
for (const setting of [
  'TemporalResponse = "0.0"',
  'DriveRetention = "0.0"',
  'BakedScanout = "0.0"',
  'ApertureEnabled = "0.0"',
]) {
  check(staticIsolationSource.includes(setting),
    `AGS static-color isolation lost ${setting}`);
}
const gtgIsolationSource = fs.readFileSync(
  path.join(presetDir, "isolation-gtg-v1.slangp"), "utf8",
);
check(gtgIsolationSource.includes('TemporalResponse = "1.0"')
  && gtgIsolationSource.includes('DriveRetention = "0.0"')
  && gtgIsolationSource.includes('BakedScanout = "0.0"')
  && gtgIsolationSource.includes('ApertureEnabled = "0.0"'),
"AGS GtG isolation preset no longer isolates GtG state");
const scanIsolationSource = fs.readFileSync(
  path.join(presetDir, "isolation-scan-v1.slangp"), "utf8",
);
check(scanIsolationSource.includes('TemporalResponse = "1.0"')
  && scanIsolationSource.includes('DriveRetention = "0.0"')
  && scanIsolationSource.includes('BakedScanout = "1.0"')
  && scanIsolationSource.includes('ApertureEnabled = "0.0"'),
"AGS scan isolation preset no longer isolates scan plus GtG");
const retentionDebugSource = fs.readFileSync(
  path.join(presetDir, "drive-retention-debug-v2.slangp"), "utf8",
);
const acceleratedRetentionSource = fs.readFileSync(
  path.join(presetDir, "retention-stress-60x-v1.slangp"), "utf8",
);
check(retentionDebugSource.includes('DebugView = "2.0"')
  && retentionDebugSource.includes("does not accelerate kinetics"),
"AGS real-clock drive diagnostic is not explicit");
check(acceleratedRetentionSource.includes('IonAdsorptionRate = "0.0635000000"')
  && acceleratedRetentionSource.includes('IonDesorptionRate = "0.0255000000"')
  && acceleratedRetentionSource.includes("60x clock"),
"AGS accelerated retention preset lost explicit 60x kinetics");

check(!fs.existsSync(path.join(presetDir, "drive-retention-literature-cell-v2.slangp")),
  "AGS retains a redundant A/B literature preset after making it the default");
check(responseSource.includes(
  '#pragma parameter IonAdsorptionRate "Mizusaki cell adsorption rate (1/s)" 0.0010583333',
), "AGS shader default lost the published adsorption-rate midpoint");
check(responseSource.includes(
  '#pragma parameter IonDesorptionRate "Mizusaki cell desorption rate (1/s)" 0.0004250000',
), "AGS shader default lost the published desorption-rate midpoint");

const opticalLevel = (index) => srgbDecodeChannel(index / 31);

check(scanCaptureSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
  "AGS scan capture schema lost its JSON Schema dialect");
check(scanCaptureSchema.properties?.schemaVersion?.const === 1,
  "AGS scan capture schema version changed without migration");
for (const required of ["specimen", "instrument", "testPattern", "trigger", "signals"]) {
  check(scanCaptureSchema.required?.includes(required),
    `AGS scan capture schema no longer requires ${required}`);
}
const signalNames = scanCaptureSchema.properties?.signals?.items?.properties?.name?.enum ?? [];
for (const signal of ["DCK", "LP", "SPS", "MOD", "REVC", "COM"]) {
  check(signalNames.includes(signal), `AGS scan capture schema lost signal ${signal}`);
}

for (const [schema, label] of [
  [electricalCaptureSchema, "electrical"],
  [photodiodeCaptureSchema, "photodiode"],
]) {
  check(schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `AGS WS2 ${label} capture schema lost its JSON Schema dialect`);
  check(schema.properties?.schemaVersion?.const === 1,
    `AGS WS2 ${label} capture schema version changed without migration`);
  for (const required of label === "electrical"
    ? ["specimen", "instrument", "stimulus", "trigger", "runs", "rawFiles"]
    : ["specimen", "detector", "acquisition", "stimulus", "transitions"]) {
    check(schema.required?.includes(required),
      `AGS WS2 ${label} capture schema no longer requires ${required}`);
  }
}
const electricalSpecimenRequired =
  electricalCaptureSchema.properties?.specimen?.required ?? [];
for (const field of [
  "brightnessMode", "warmupSeconds", "temperatureC", "ambientIlluminanceLux",
  "chargerConnected", "batteryVoltage", "vcomState",
]) {
  check(electricalSpecimenRequired.includes(field),
    `AGS electrical capture schema lost specimen field ${field}`);
}
const photodiodeSpecimenRequired =
  photodiodeCaptureSchema.properties?.specimen?.required ?? [];
for (const field of [
  "lcdLabel", "brightnessMode", "warmupSeconds", "temperatureC",
  "ambientIlluminanceLux", "chargerConnected", "batteryVoltage",
]) {
  check(photodiodeSpecimenRequired.includes(field),
    `AGS photodiode capture schema lost specimen field ${field}`);
}

check(ws2StimulusManifest.schemaVersion === 1
  && ws2StimulusManifest.suiteId === "nintendo-ags-101-ws2-stimulus-v1",
"AGS WS2 stimulus manifest identity drifted");
check(ws2StimulusManifest.sourceResolution?.join("x") === "240x160"
  && ws2StimulusManifest.colorEncoding === "GBA RGB555",
"AGS WS2 stimulus manifest lost exact GBA source geometry/color encoding");
check(ws2StimulusManifest.timing?.masterClockHz === GBA_MASTER_CLOCK_HZ
  && ws2StimulusManifest.timing?.cyclesPerLine === GBA_CYCLES_PER_LINE
  && ws2StimulusManifest.timing?.totalLines === GBA_TOTAL_LINES,
"AGS WS2 stimulus manifest timing drifted from the GBA clock");
const requiredScenes = [
  "color-ramps",
  "mixed-patches",
  "row-markers",
  "checkerboard",
  "isolated-window",
  "parity-toggle",
  "gtg-neutral-gate",
  "gtg-red-gate",
  "gtg-green-gate",
  "gtg-blue-gate",
  "retention-stress-recovery",
];
const stimulusScenes = new Map(
  (ws2StimulusManifest.scenes ?? []).map((scene) => [scene.sceneId, scene]),
);
check(stimulusScenes.size === requiredScenes.length,
  "AGS WS2 stimulus manifest has duplicate or unexpected scene count");
for (const sceneId of requiredScenes) {
  const scene = stimulusScenes.get(sceneId);
  check(Boolean(scene), `AGS WS2 stimulus suite is missing ${sceneId}`);
  if (!scene) continue;
  const romPath = path.join(path.dirname(ws2StimulusManifestPath), scene.filename);
  check(fs.existsSync(romPath), `AGS WS2 stimulus ROM is missing: ${scene.filename}`);
  if (!fs.existsSync(romPath)) continue;
  const rom = fs.readFileSync(romPath);
  check(rom.length === 128 * 1024, `${sceneId}: unexpected ROM size`);
  check(crypto.createHash("sha256").update(rom).digest("hex") === scene.sha256,
    `${sceneId}: ROM SHA-256 drifted`);
  check(rom.readUInt32LE(0) === 0xea00002e && rom[0xb2] === 0x96,
    `${sceneId}: invalid GBA entry/header fixed value`);
  let headerSum = 0;
  for (let offset = 0xa0; offset <= 0xbc; offset += 1) headerSum += rom[offset];
  check((-(headerSum + 0x19) & 0xff) === rom[0xbd]
    && scene.gbaHeaderChecksum === rom[0xbd],
  `${sceneId}: invalid GBA header checksum`);
  const program = rom.subarray(0xc0, 0xc0 + scene.programSizeBytes);
  check(crypto.createHash("sha256").update(program).digest("hex") === scene.programSha256,
    `${sceneId}: ARM stimulus program drifted`);
  for (const [pageIndex, offset] of [[0, 0x600], [1, 0x9c00]]) {
    const page = rom.subarray(offset, offset + 240 * 160);
    check(crypto.createHash("sha256").update(page).digest("hex") === scene.pageSha256?.[pageIndex],
      `${sceneId}: framebuffer page ${pageIndex} drifted`);
  }
  check(scene.palette?.length > 0 && scene.palette.length <= 256,
    `${sceneId}: invalid Mode 4 palette size`);
}
check(stimulusScenes.get("parity-toggle")?.page0DwellFrames === 1
  && stimulusScenes.get("parity-toggle")?.page1DwellFrames === 1
  && stimulusScenes.get("parity-toggle")?.type === "window-toggle"
  && stimulusScenes.get("parity-toggle")?.window?.width === 96
  && stimulusScenes.get("parity-toggle")?.window?.height === 64
  && stimulusScenes.get("parity-toggle")?.page0WindowCode === 8
  && stimulusScenes.get("parity-toggle")?.page1WindowCode === 24
  && stimulusScenes.get("parity-toggle")?.maxPageFlips === 600
  && stimulusScenes.get("parity-toggle")?.maximumDynamicSeconds <= 10.1
  && stimulusScenes.get("parity-toggle")?.terminalPage === 0,
"AGS WS2 parity stimulus lost its bounded local-window safety contract");
check(stimulusScenes.get("retention-stress-recovery")?.page0DwellFrames === 1800
  && stimulusScenes.get("retention-stress-recovery")?.page1DwellFrames === 900,
"AGS WS2 retention stimulus lost its 30 s/15 s nominal schedule");

check(ws2CaptureSession.classification === "synthetic-loopback",
  "AGS WS2 synthetic session is misclassified as measurement");
check(ws2CaptureSession.stimulus?.suiteId === ws2StimulusManifest.suiteId,
  "AGS WS2 capture session lost its stimulus suite identity");
const stimulusManifestHash = crypto.createHash("sha256")
  .update(fs.readFileSync(ws2StimulusManifestPath)).digest("hex");
check(ws2CaptureSession.stimulus?.manifestSha256 === stimulusManifestHash,
  "AGS WS2 capture session manifest hash drifted");
check(ws2CaptureSession.transitions?.length === 15,
  "AGS WS2 loopback no longer contains five three-repeat cases");
for (const transition of ws2CaptureSession.transitions ?? []) {
  const rawPath = path.join(ws2CaptureDir, transition.rawFile);
  check(fs.existsSync(rawPath), `AGS WS2 raw capture is missing: ${transition.rawFile}`);
  if (!fs.existsSync(rawPath)) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(rawPath)).digest("hex");
  check(actual === transition.sha256,
    `AGS WS2 raw capture hash drifted: ${transition.rawFile}`);
  check(stimulusScenes.has(transition.sceneId),
    `AGS WS2 transition uses unknown scene ${transition.sceneId}`);
}
check(ws2CaptureReport.classification === "synthetic-pipeline-validation-only"
  && ws2CaptureReport.summary?.pass === true,
"AGS WS2 synthetic capture loopback is not passing or is misclassified");
for (const requiredCase of [
  "accepted-clean",
  "rejected-noisy",
  "rejected-overshoot",
  "rejected-missing",
  "rejected-censored",
]) {
  check(ws2CaptureReport.cases?.some((entry) => entry.caseId === requiredCase && entry.pass),
    `AGS WS2 loopback lost passing case ${requiredCase}`);
}
check(ws2GtgSubset.schemaVersion === GTG_SCHEMA_VERSION
  && ws2GtgSubset.classification === "synthetic"
  && ws2GtgSubset.coverage?.recordedCellCount === 1
  && ws2GtgSubset.samples?.length === 3
  && ws2GtgSubset.missingCells?.length === 3071,
"AGS WS2 accepted-waveform GtG handoff has inconsistent coverage");
check(ws2GtgSubset.integrity?.samplesSha256 === crypto.createHash("sha256")
  .update(JSON.stringify(ws2GtgSubset.samples)).digest("hex"),
"AGS WS2 GtG handoff samples hash drifted");
check(ws2GtgRuntime.sourceRecordId === ws2GtgSubset.recordId
  && ws2GtgRuntime.sourceClassification === "synthetic"
  && ws2GtgRuntime.errorMetrics?.packedCount === 1
  && ws2GtgRuntime.errorMetrics?.fallbackCount === 3071,
"AGS WS2 standard GtG builder did not preserve accepted/rejected coverage");
const ws2GtgTexturePath = path.join(ws2CaptureDir, ws2GtgRuntime.texture.file);
check(fs.existsSync(ws2GtgTexturePath)
  && crypto.createHash("sha256").update(fs.readFileSync(ws2GtgTexturePath)).digest("hex")
    === ws2GtgRuntime.texture.sha256,
"AGS WS2 loopback runtime texture is missing or stale");
check(metadata.evidence?.stimulusSuite === "generated/ws2-stimulus-v1/manifest.json"
  && metadata.evidence?.capturePipeline === "reference/capture-pipeline.mjs",
"AGS model metadata lost the WS2 stimulus/capture pipeline");
check(metadata.limitations?.some((value) => value.includes("synthetic pipeline validation")),
  "AGS model limitations no longer distinguish WS2 loopback from measurement");

const ws3ConstraintHash = sha256File(ws3ConstraintSourcePath);
check(ws2MgbaReceipt.summary?.pass === true
  && ws2MgbaReceipt.summary?.scenes === 11
  && ws2MgbaReceipt.summary?.runtimeBootPasses === 11
  && ws2MgbaReceipt.summary?.consistencyPasses === 11,
"AGS WS2 mGBA scene/manifest gate is not passing");
check(ws3Generated.source?.constraintsSha256 === ws3ConstraintHash,
  "AGS WS3 generated artifact is stale for its normalized constraints");
check(ws3Generated.ws2Gate?.status === "pass"
  && ws3Generated.ws2Gate?.runtimeReceiptSha256 === sha256File(ws2MgbaReceiptPath),
"AGS WS3 artifact lost its current WS2 runtime gate");
check(Object.values(ws3Generated.acceptance ?? {}).every((value) => (
  value === "pass" || value === true
)), "AGS WS3 generated acceptance contains a failed or unresolved implementation check");
const formalWs3 = ws3ConstraintSource.formalAgs101SpecificConstants ?? {};
for (const field of [
  "latchPhase",
  "pureOpticalDelaySeconds",
  "frameParityPhase",
  "inversionTopology",
  "brightnessElectricalCoupling",
]) {
  check(formalWs3[field] === null,
    `AGS WS3 improperly promoted hypothesis ${field} to a formal constant`);
}
check(ws3Generated.formalAgs101SpecificConstants?.reason?.includes("No direct AGT-CPU-01"),
  "AGS WS3 artifact lost the unresolved-hardware reason");

check(responseSource.includes('include "ags101-ws3-timing.inc"')
  && exposureSource.includes('include "ags101-ws3-timing.inc"')
  && displaySource.includes('include "ags101-ws3-timing.inc"'),
"AGS response/exposure/display no longer share the generated WS3 equations");
check(ws3TimingIncludeSource.includes(`Constraint SHA-256: ${ws3ConstraintHash}`),
  "AGS shared WS3 Shader include is stale for the normalized constraints");
check(ws3Generated.runtimeArtifacts?.sharedShaderIncludeSha256
  === sha256File(path.join(shaderDir, "ags101-ws3-timing.inc")),
"AGS WS3 shared Shader include hash drifted");

check(ws3Compile.summary?.pass === true && ws3Compile.stages?.length === 6
  && ws3Compile.stages.every((entry) => entry.pass && entry.spirvBytes > 0),
"AGS WS3 Shader compilation/SPIR-V receipt is not passing six stages");
check(ws3Compile.sources?.responseShaderSha256
  === sha256File(path.join(shaderDir, "ags101-response-v1.slang"))
  && ws3Compile.sources?.exposureShaderSha256
    === sha256File(path.join(shaderDir, "ags101-exposure-v1.slang"))
  && ws3Compile.sources?.displayShaderSha256
    === sha256File(path.join(shaderDir, "ags101-display-v1.slang"))
  && ws3Compile.sources?.sharedTimingIncludeSha256
    === sha256File(path.join(shaderDir, "ags101-ws3-timing.inc")),
"AGS WS3 Shader compile receipt is stale for current sources");
check(ws3Generated.runtimeArtifacts?.shaderCompileReceiptSha256 === sha256File(ws3CompilePath),
  "AGS WS3 generated artifact lost the compile-receipt hash");

check(ws3PresetManifest.classification
  === "generated-sensitivity-candidates-not-formal-ags101-profiles",
"AGS WS3 candidate presets are misclassified as formal profiles");
check(ws3PresetManifest.sourceConstraintSha256 === ws3ConstraintHash
  && ws3PresetManifest.basePresetSha256 === sha256File(
    path.join(presetDir, "period-reconstruction-v1.slangp"),
  ), "AGS WS3 preset manifest is stale for its constraints or base preset");
const ws3PresetKinds = Object.groupBy
  ? Object.groupBy(ws3PresetManifest.presets ?? [], (entry) => entry.kind)
  : (ws3PresetManifest.presets ?? []).reduce((groups, entry) => {
      (groups[entry.kind] ??= []).push(entry);
      return groups;
    }, {});
check(ws3PresetKinds["timing-candidate"]?.length === 9
  && ws3PresetKinds["parity-candidate"]?.length === 2
  && ws3PresetKinds["inversion-candidate"]?.length === 4
  && ws3PresetKinds["read-only-diagnostic"]?.length === 5,
"AGS WS3 candidate preset matrix is incomplete");
for (const entry of ws3PresetManifest.presets ?? []) {
  const candidatePath = path.resolve(root, entry.path);
  check(candidatePath.startsWith(`${ws3PresetDir}${path.sep}`),
    `AGS WS3 candidate preset escapes its generated directory: ${entry.path}`);
  check(fs.existsSync(candidatePath), `AGS WS3 candidate preset is missing: ${entry.path}`);
  if (!fs.existsSync(candidatePath)) continue;
  const candidateSource = fs.readFileSync(candidatePath, "utf8");
  check(sha256File(candidatePath) === entry.sha256,
    `AGS WS3 candidate preset hash drifted: ${entry.path}`);
  check(candidateSource.includes("Generated by tools/build-ags101-ws3.mjs")
    && candidateSource.includes("no formal AGS-101 selection is made"),
  `AGS WS3 candidate preset lost hypothesis classification: ${entry.path}`);
  check(!candidateSource.includes("#reference"),
    `AGS WS3 candidate preset uses inherited parameter state: ${entry.path}`);
  for (const target of [
    ...[...candidateSource.matchAll(/shader\d+\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    ...[...candidateSource.matchAll(/^\w+\s*=\s*"([^"]+\.(?:png|jpg|jpeg|bmp|tga))"/gmi)]
      .map((match) => match[1]),
  ]) {
    check(fs.existsSync(path.resolve(path.dirname(candidatePath), target)),
      `AGS WS3 candidate preset has a missing reference: ${entry.path} -> ${target}`);
  }
}
check(ws3Generated.runtimeArtifacts?.candidatePresetManifestSha256
  === sha256File(ws3PresetManifestPath),
"AGS WS3 generated artifact lost the candidate-preset manifest hash");
check(ws3Generated.periodReconstructionDefaults?.latchPhase === "line-start"
  && ws3Generated.periodReconstructionDefaults?.inversionTopology === "row-alternating"
  && ws3PresetManifest.reconstructionDefault?.latchPhase === "line-start"
  && ws3PresetManifest.reconstructionDefault?.inversionTopology === "row-alternating",
"AGS WS3 generated artifacts lost the family-constrained reconstruction defaults");

check(ws3Sensitivity.classification === "cpu-model-sensitivity-not-hardware-measurement"
  && ws3Sensitivity.sourceConstraintSha256 === ws3ConstraintHash,
"AGS WS3 sensitivity report is stale or misclassified");
check(ws3Sensitivity.shaderContract?.sharedIncludeSha256
  === sha256File(path.join(shaderDir, "ags101-ws3-timing.inc")),
"AGS WS3 sensitivity report lost its shared Shader-equation contract");
check(ws3Sensitivity.summary?.timingProfiles === 9
  && ws3Sensitivity.summary?.timingProfilesChangingOutput === 8
  && ws3Sensitivity.summary?.polarityRuns === 16
  && ws3Sensitivity.summary?.polarityRunsChangingExcitation === 14
  && ws3Sensitivity.summary?.equationVectors === 80
  && ws3Sensitivity.summary?.reconstructionDefaultApplied === true
  && ws3Sensitivity.summary?.formalAgs101SelectionMade === false,
"AGS WS3 sensitivity coverage or unresolved-selection status drifted");
for (const vector of ws3Sensitivity.equationVectors ?? []) {
  check(vector.spatialPhase === inversionSpatialPhase(vector)
    && vector.expectedPolarity === drivePolarity(vector),
  `AGS WS3 CPU/Shader polarity vector drifted at ${vector.x}/${vector.y}`);
}
for (const profile of ws3Generated.timingProfiles ?? []) {
  for (const fixture of profile.rowFixtures ?? []) {
    const expected = scanEvent({
      row: fixture.row,
      latchOffsetLines: profile.latchOffsetLines,
      opticalDelaySeconds: profile.pureOpticalDelaySeconds,
    });
    check(Object.entries(expected).every(([key, value]) => fixture[key] === value),
      `AGS WS3 CPU/Shader scan vector drifted for ${profile.profileId} row ${fixture.row}`);
  }
}
check(ws3Generated.runtimeArtifacts?.sensitivityReportSha256 === sha256File(ws3SensitivityPath),
  "AGS WS3 generated artifact lost the sensitivity-report hash");
check(metadata.evidence?.timingConstraintArtifact
  === "generated/ws3-timing-constraints-v1.json",
"AGS model metadata lost the WS3 runtime constraint artifact");

check(frontendValidationSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
  "AGS frontend validation schema lost its JSON Schema dialect");
check(frontendValidationSchema.properties?.schemaVersion?.const === 1,
  "AGS frontend validation schema version changed without migration");
for (const required of [
  "classification", "runId", "date", "modelId", "targetProfile",
  "repositoryCommit", "frontend", "artifacts", "checks", "captures",
]) {
  check(frontendValidationSchema.required?.includes(required),
    `AGS frontend validation schema no longer requires ${required}`);
}
check(frontendValidationSchema.properties?.runEvidence?.type === "object",
  "AGS frontend validation schema cannot retain structured run evidence");
const requiredFrontendEvents = [
  "reset",
  "content-reload",
  "save-state-load",
  "pause-resume",
  "rewind",
  "run-ahead",
  "fast-forward",
  "frame-duplication",
  "variable-refresh",
];
function checkFrontendRecord(record, label, allowTemplate = false, allowedModelIds = [metadata.id]) {
  check(record.schemaVersion === 1, `${label}: wrong schema version`);
  check(allowedModelIds.includes(record.modelId), `${label}: wrong model ID`);
  check(/^[0-9a-f]{40}$/.test(record.repositoryCommit ?? ""),
    `${label}: invalid repository commit`);
  check(allowTemplate ? record.classification === "template" : record.classification === "device-run",
    `${label}: wrong classification`);
  const events = new Set((record.checks ?? []).map((item) => item.event));
  check(events.size === requiredFrontendEvents.length,
    `${label}: frontend event list contains duplicates or omissions`);
  for (const event of requiredFrontendEvents) {
    check(events.has(event), `${label}: missing frontend event ${event}`);
  }
  for (const [name, hash] of Object.entries(record.artifacts ?? {})) {
    check(/^[0-9a-f]{64}$/.test(hash), `${label}: invalid SHA-256 for ${name}`);
  }
  check(record.captures?.presentationOnly === true,
    `${label}: screenshots/captures must remain presentation-only evidence`);
  if (!allowTemplate) {
    check(record.repositoryCommit !== "0".repeat(40),
      `${label}: repository commit is still the template sentinel`);
    check(!(record.checks ?? []).some((item) => item.outcome === "failed"),
      `${label}: contains a failed frontend check`);
    check(!JSON.stringify(record).includes("replace-with-"),
      `${label}: contains template placeholders`);
  }
}
checkFrontendRecord(frontendValidationTemplate, "frontend-validation-template", true);

check(gtgSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
  "AGS GtG schema lost its JSON Schema dialect");
check(gtgSchema.properties?.schemaVersion?.const === GTG_SCHEMA_VERSION,
  "AGS GtG schema version disagrees with CPU reference");
for (const required of [
  "specimen", "eventTimeZero", "responseUnits", "coverage", "samples",
  "missingCells", "sourceFiles", "integrity",
]) {
  check(gtgSchema.required?.includes(required), `AGS GtG schema no longer requires ${required}`);
}
for (const required of [
  "consoleId", "boardId", "lcdLabel", "brightnessMode", "warmupSeconds",
  "ambient", "power", "panelHistory", "overlay", "measurementGeometry",
  "detector", "acquisition", "stimulus",
]) {
  check(gtgSchema.$defs?.specimen?.required?.includes(required),
    `AGS GtG schema no longer requires specimen.${required}`);
}
for (const required of [
  "channel", "fromCode", "toCode", "repetition", "eventTimeZeroSeconds",
  "fromPlateau", "toPlateau", "timesSeconds", "opticalResponse",
]) {
  check(gtgSchema.$defs?.sample?.required?.includes(required),
    `AGS GtG schema no longer requires sample.${required}`);
}
check(gtgSynthetic.classification === "synthetic",
  "AGS GtG pipeline fixture is no longer explicitly synthetic");
check(gtgSynthetic.coverage?.recordedCellCount === 3072
  && gtgSynthetic.samples?.length === 3072
  && gtgSynthetic.missingCells?.length === 0,
"AGS full synthetic GtG fixture lost 3x32x32 coverage");
check(gtgManifest.fitVersion === GTG_FIT_VERSION && gtgFit.fitVersion === GTG_FIT_VERSION,
  "AGS GtG generated artifacts disagree with CPU fit version");
check(gtgManifest.sourceClassification === "synthetic",
  "AGS GtG runtime fixture lost synthetic classification");
check(gtgManifest.texture?.width === 32 && gtgManifest.texture?.height === 96,
  "AGS GtG runtime texture layout drifted");
check(gtgManifest.errorMetrics?.fallbackCount === 0
  && gtgManifest.errorMetrics?.packedCount === 3072,
"AGS full synthetic GtG texture is unexpectedly incomplete");
check(gtgManifest.errorMetrics?.maxRateRoundTripRelativeError < 6e-5,
  "AGS GtG packed rate precision exceeded its documented bound");

check(validateEnsembleDefinition(ws4Ensemble, ws4Evidence).length === 0,
  "AGS WS4 ensemble definition is invalid");
check(ws4Evidence.exactPanelSearchRecord
  === "data/ws3-evidence-inventory-v1.json#WS3-PANEL-DATASHEET-SEARCH-2026-08-20",
"AGS WS4 lost the preserved exact-panel search record");
check(ws4Ensemble.runtimeModel?.equationId === WS4_EQUATION_ID
  && ws4Ensemble.defaultMember === "nominal",
"AGS WS4 equation or nominal selection drifted");
for (const member of ws4Ensemble.members) {
  const manifest = ws4Manifests[member.id];
  const regeneratedCells = buildReconstructedCells(member);
  check(manifest?.sourceClassification
    === "literature-constrained-reconstruction-not-panel-measurement",
  `AGS WS4 ${member.id} lost reconstructed classification`);
  check(manifest?.coverage?.packedCount === 3072
    && manifest.coverage.fallbackCount === 0
    && manifest.provenanceDictionary?.measuredCellCount === 0
    && manifest.cells?.length === 3072,
  `AGS WS4 ${member.id} coverage is incomplete or mislabeled`);
  check(manifest.cells.every((cell) => {
    const provenance = manifest.provenanceDictionary?.[cell.provenanceId];
    return provenance?.ensembleMember === member.id
      && provenance?.equationId === WS4_EQUATION_ID
      && provenance?.parameterRangeId === "data/ws4-gtg-ensemble-v1.json#parameterRanges"
      && Array.isArray(provenance?.sourceEvidenceIds)
      && typeof provenance?.fallbackBehavior === "string";
  }), `AGS WS4 ${member.id} lost per-cell provenance`);
  check(regeneratedCells.every((cell, index) => (
    cell.id === manifest.cells[index].id
      && Math.abs(cell.ratePerSecond - manifest.cells[index].ratePerSecond) < 1e-7
  )), `AGS WS4 ${member.id} manifest disagrees with the reference equation`);
  const darkening = reconstructedTransition(member, 31, 0);
  const brightening = reconstructedTransition(member, 0, 31);
  check(Math.abs(darkening.t10To90Ms - member.opticalDarkeningEndpointT10To90Ms) < 1e-12
    && Math.abs(brightening.t10To90Ms - member.opticalBrighteningEndpointT10To90Ms) < 1e-12,
  `AGS WS4 ${member.id} endpoint no longer reproduces its source selection`);
}
check(ws4Coverage.measuredCells === 0
  && ws4Coverage.generatedCells === 9216
  && ws4Coverage.unsupportedDimensions?.exactPanelWaveform === "unsupported",
"AGS WS4 coverage disguises reconstructed or unsupported dimensions");
check(ws4Validation.checks?.ws2SceneManifestGate === "passed"
  && ws4Validation.checks?.syntheticFixtureUsedAsDefault === false
  && ws4Validation.checks?.cpuVsShaderFloat32EquationMaximumAbsoluteError
    <= ws4Validation.checks?.cpuVsShaderFloat32EquationTolerance,
"AGS WS4 validation receipt failed its scene, default, or equation gate");
check(ws4Validation.checks?.actualGpuNumericReadback
  === "not-run; reserved for WS8 target instrumentation",
"AGS WS4 must not claim an unperformed GPU numeric readback");
check(ws4PresetManifest.defaultMember === "nominal"
  && ws4PresetManifest.artifacts?.length === 3,
"AGS WS4 comparison preset manifest is incomplete");

check(ws5Evidence.inventoryId === "nintendo-ags-101-ws5-evidence-v1"
  && ws5Evidence.evidence?.length === 7,
"AGS WS5 evidence inventory is incomplete");
check(ws5Reconstruction.equationId === "WS5-CODE-POLARITY-EXCITATION-V1"
  && ws5Reconstruction.stateEquationId === "WS5-MIZUSAKI-ONE-STATE-V1"
  && ws5Reconstruction.defaultMember === "nominal",
"AGS WS5 reconstruction identity or default drifted");
check(ws5Reconstruction.ws3Matrix?.inversionTopologies?.length === 4
  && ws5Reconstruction.ws3Matrix?.parityPhases?.length === 2
  && ws5Reconstruction.ws4Matrix?.length === 3,
"AGS WS5 WS3/WS4 candidate matrix is incomplete");
check(ws5Validation.reportId === "nintendo-ags-101-ws5-retention-validation-v1"
  && Object.values(ws5Validation.checks ?? {}).every((value) => value === true)
  && ws5Validation.fixtures?.matrix?.length === 48
  && ws5Validation.maximumCpuVsShaderFloat32AbsoluteError
    <= ws5Validation.cpuVsShaderFloat32Tolerance,
"AGS WS5 fixture or CPU/Shader-equation receipt failed");
check(ws5Validation.actualGpuNumericReadback
  === "separate target receipt required; repository equation emulator is not GPU evidence",
"AGS WS5 repository receipt falsely claims GPU evidence");
check(ws5PresetManifest.candidateCount === 12
  && ws5PresetManifest.controlCount === 3
  && ws5PresetManifest.artifacts?.length === 15,
"AGS WS5 preset manifest is incomplete");
for (const artifact of ws5PresetManifest.artifacts ?? []) {
  const artifactPath = path.join(modelDir, "generated", "ws5-presets-v1", artifact.file);
  check(fs.existsSync(artifactPath), `AGS WS5 preset is missing: ${artifact.file}`);
  if (fs.existsSync(artifactPath)) {
    check(sha256File(artifactPath) === artifact.sha256,
      `AGS WS5 preset hash drifted: ${artifact.file}`);
  }
}
check(ws6Definition.recordId === "nintendo-ags-101-ws6-panel-optics-v1"
  && ws6Definition.backlight?.established?.userBrightnessModes === 2
  && ws6Definition.backlight?.unknown?.pwmFrequencyHz === null
  && ws6Definition.aperture?.archivalImageAssessment?.sufficientForAgsSpecificKernel === false,
"AGS WS6 source definition lost its brightness or aperture evidence boundary");
check(ws6Validation.reportId === "nintendo-ags-101-ws6-validation-v1"
  && ws6Validation.acceptance?.blackPoliciesNamedSeparately === true
  && ws6Validation.acceptance?.brightnessSensitivityIndependentBypass === true
  && ws6Validation.acceptance?.integerAndFractionalCpuEnergy === "pass"
  && ws6Validation.acceptance?.gpuNumericApertureReadback === "deferred-to-ws8",
"AGS WS6 validation receipt is incomplete or overclaims GPU evidence");
check(ws6PresetManifest.presets?.length === 7,
  "AGS WS6 preset manifest is incomplete");
for (const artifact of ws6PresetManifest.presets ?? []) {
  const artifactPath = path.join(modelDir, artifact.path);
  check(fs.existsSync(artifactPath), `AGS WS6 preset is missing: ${artifact.path}`);
  if (fs.existsSync(artifactPath)) {
    check(sha256File(artifactPath) === artifact.sha256,
      `AGS WS6 preset hash drifted: ${artifact.path}`);
  }
}
check(relativeBacklightGain({ enabled: false, ratio: 0.5 }) === 1
  && relativeBacklightGain({ enabled: true, ratio: 0.75 }) === 0.75,
"AGS WS6 relative-backlight bypass or sensitivity gain drifted");
check(Math.abs(apertureEnergyNormalization(1.5, 0.63)
  - ws6Validation.aperture.nominalNormalization) < 1e-11,
"AGS WS6 aperture normalization disagrees with its generated receipt");
for (const scale of [4, 3.5, 4.25]) {
  const mean = averageUniformAperture(12, 8, scale, scale);
  check(mean.every((value) => Math.abs(value - 1) < 2e-3),
    `AGS WS6 aperture lost unit mean energy at ${scale}x`);
}
check(ws7Definition.recordId === "nintendo-ags-101-ws7-exposure-integration-v1"
  && ws7Definition.nativeClock?.masterClockHz === 16_777_216
  && ws7Definition.nativeClock?.cyclesPerLine === 1_232
  && ws7Definition.nativeClock?.linesPerFrame === 228
  && Math.abs(ws7Definition.nativeClock?.observationSeconds - GBA_FRAME_SECONDS) < 1e-18,
"AGS WS7 definition lost the exact native observation interval");
check(ws7Definition.stateContract?.endpointPass?.includes("Pass 0 RGBA32F")
  && ws7Definition.stateContract?.exposurePass?.includes("Pass 1")
  && ws7Definition.stateContract?.displayPass?.includes("Pass 2")
  && ws7Definition.stateContract?.endpointDiagnostic?.includes("ExposureMode=0"),
"AGS WS7 three-pass state or endpoint-diagnostic contract is incomplete");
const ws7Intervals = Object.fromEntries(
  (ws7Definition.intervalProfiles ?? []).map((entry) => [entry.id, entry]),
);
check(Object.keys(ws7Intervals).length === 7
  && ws7Intervals["ordinary-refresh"]?.nativeFramesAdvanced === 1
  && ws7Intervals["content-duplicate"]?.nativeFramesAdvanced === 1
  && ws7Intervals["frontend-generated-duplicate"]?.nativeFramesAdvanced === 0
  && ws7Intervals["fast-forward-skipped-frames"]?.runtimeStatus
    === "unsupported-safe-bypass-required"
  && ws7Intervals["variable-refresh-unknown-duplication-or-drop"]?.runtimeStatus
    === "unsupported-safe-bypass-required",
"AGS WS7 frontend interval classifications are incomplete or unsafe");
check((ws7Definition.intervalProfiles ?? [])
  .filter((entry) => entry.nativeFramesAdvanced === 1)
  .every((entry) => entry.observationSeconds === GBA_FRAME_SECONDS),
"AGS WS7 supported interval changed the native GBA panel clock");
check(ws7Definition.backlightCandidates?.acceptedForRuntime?.length === 3
  && ws7Definition.backlightCandidates?.excluded?.some(
    (entry) => entry.id === "pwm-dimming-unselected",
  ), "AGS WS7 backlight bounds silently selected an unknown PWM waveform");

check(ws7Validation.reportId === "nintendo-ags-101-ws7-exposure-validation-v1"
  && ws7Validation.classification
    === "repository-cpu-shader-equation-receipt-not-device-readback",
"AGS WS7 validation receipt identity or evidence class drifted");
check(ws7Validation.sources?.definitionSha256 === sha256File(ws7DefinitionPath)
  && ws7Validation.sources?.presetManifestSha256 === sha256File(ws7PresetManifestPath)
  && ws7Validation.sources?.ws6ValidationSha256
    === sha256File(path.join(modelDir, "generated", "ws6-validation-v1.json")),
"AGS WS7 validation receipt is stale for its source definition, preset manifest, or WS6 input");
check(ws7Validation.numericalReference?.maximumSimpsonAbsoluteError < 1e-13
  && ws7Validation.numericalReference?.maximumMovingAlternatingHighResolutionAbsoluteError < 1e-13
  && ws7Validation.numericalReference?.maximumShaderFloatIntegralAbsoluteError
    <= ws7Validation.numericalReference?.shaderFloatTolerance,
"AGS WS7 closed-form, high-resolution, or Shader-float exposure bound failed");
const ws7ExactFixture = firstOrderIntegral(0.17, 0.83, 40, GBA_FRAME_SECONDS);
const ws7SimpsonFixture = compositeSimpsonFirstOrder(
  0.17, 0.83, 40, GBA_FRAME_SECONDS, 4096,
);
check(Math.abs(ws7ExactFixture - ws7SimpsonFixture) < 1e-13,
  "AGS independent WS7 first-order exposure fixture disagrees with Simpson 4096");
check(ws7Validation.staticFixtures?.length === 12
  && ws7Validation.staticFixtures.every((entry) => entry.error < 1e-14)
  && ws7Validation.transitionFixtures?.length === 27
  && ws7Validation.transitionFixtures.every((entry) => entry.highResolutionError < 1e-13)
  && ws7Validation.alternating?.length === 3
  && ws7Validation.alternating.every((entry) => entry.frames?.length === 12
    && entry.frames.every((frame) => frame.highResolutionError < 1e-13)),
"AGS WS7 static, scan-row, partial-channel, or alternating fixture coverage is incomplete");
const ws7RiseBounds = ws7Validation.uncertaintyBounds?.riseGreenAtRow80 ?? {};
const ws7FallBounds = ws7Validation.uncertaintyBounds?.fallGreenAtRow80 ?? {};
check(ws7RiseBounds.fast > ws7RiseBounds.nominal
  && ws7RiseBounds.nominal > ws7RiseBounds.slow
  && ws7FallBounds.fast < ws7FallBounds.nominal
  && ws7FallBounds.nominal < ws7FallBounds.slow,
"AGS WS7 fast/nominal/slow emitted-light bounds lost their expected ordering");
const ws7BacklightFixture = applyStaticBacklight([0.2, 0.4, 0.8], 0.75);
check(ws7BacklightFixture.every((value, channel) => (
  Math.abs(value - [0.15, 0.3, 0.6][channel]) < 1e-15
)) && ws7Validation.uncertaintyBounds?.pwmIncluded === false,
"AGS WS7 static backlight integration or PWM exclusion drifted");
check(ws7Validation.invariants?.colorArtifactSha256UnchangedByExposure
    === sha256File(path.join(modelDir, "generated", "hcs-e688fc5-color.json"))
  && ws7Validation.invariants?.apertureValidationSha256UnchangedByExposure
    === sha256File(path.join(modelDir, "generated", "ws6-validation-v1.json")),
"AGS WS7 changed or lost the pinned color/aperture inputs");
check(ws7Validation.acceptance?.intervalContractComplete === true
  && ws7Validation.acceptance?.nativeClockInvariant === true
  && ws7Validation.acceptance?.staticMatchesEndpoint === true
  && ws7Validation.acceptance?.movingAndAlternatingReference === "pass"
  && ws7Validation.acceptance?.closedFormVsHighResolutionReference === "pass"
  && ws7Validation.acceptance?.endpointDiagnosticPreset === true
  && ws7Validation.acceptance?.colorAndApertureInvariant === true
  && ws7Validation.acceptance?.reproducibleGtgAndBacklightBounds === true
  && ws7Validation.acceptance?.pwmFrequencyInvented === false
  && ws7Validation.acceptance?.gpuNumericExposureReadback === "deferred-to-ws8",
"AGS WS7 acceptance is incomplete or overclaims actual GPU exposure readback");
check(ws7PresetManifest.manifestId === "nintendo-ags-101-ws7-presets-v1"
  && ws7PresetManifest.definitionSha256 === sha256File(ws7DefinitionPath)
  && ws7PresetManifest.presets?.length === 7,
"AGS WS7 exposure preset manifest is incomplete or stale");
for (const artifact of ws7PresetManifest.presets ?? []) {
  const artifactPath = path.join(modelDir, artifact.path);
  check(fs.existsSync(artifactPath), `AGS WS7 preset is missing: ${artifact.path}`);
  if (fs.existsSync(artifactPath)) {
    check(sha256File(artifactPath) === artifact.sha256,
      `AGS WS7 preset hash drifted: ${artifact.path}`);
    const source = fs.readFileSync(artifactPath, "utf8");
    check(source.includes('shaders = "3"')
      && source.includes("ags101-exposure-v1.slang"),
    `AGS WS7 preset lost the exposure pass: ${artifact.path}`);
  }
}
check(ws8Reference.referenceId === "nintendo-ags-101-ws8-exposure-gpu-reference-v1"
  && ws8Reference.classification
    === "cpu-reference-for-target-gpu-readback-not-panel-measurement"
  && ws8Reference.pipeline?.debugView === 13
  && ws8Reference.pipeline?.driveRetention === false
  && ws8Reference.stimulus?.sceneId === "parity-toggle"
  && ws8Reference.stimulus?.dwellFrames?.join(",") === "1,1",
"AGS WS8 exposure GPU reference identity or isolation contract drifted");
check(ws8Reference.probe?.join(",") === "120,80"
  && Object.keys(ws8Reference.expectedByPackedTarget ?? {}).sort().join("|")
    === "24,24,24|8,8,8"
  && ws8Reference.stimulus?.alternatingCodes?.join(",") === "8,24"
  && ws8Reference.stimulus?.maximumDynamicSeconds <= 10.1
  && ws8Reference.stimulus?.terminalPage === 0
  && ws8Reference.convergence?.maximumSuccessiveSameTargetAverageDrift < 1e-12
  && ws8Reference.gpuComparisonTolerance === 3e-6,
"AGS WS8 alternating exposure reference is incomplete or unconverged");
check(ws8Reference.apertureEnergy?.debugView === 14
  && ws8Reference.apertureEnergy?.encodedLinearScale === 0.25
  && Object.keys(ws8Reference.apertureEnergy?.expectedByScale ?? {}).sort().join(",") === "3.5,4"
  && ws8Reference.apertureEnergy?.screenshotComparisonTolerance === 0.006,
"AGS WS8 aperture GPU reference is incomplete");
check(ws8Reference.sources?.responseShaderSha256
    === sha256File(path.join(shaderDir, "ags101-response-v1.slang"))
  && ws8Reference.sources?.exposureShaderSha256
    === sha256File(path.join(shaderDir, "ags101-exposure-v1.slang"))
  && ws8Reference.sources?.displayShaderSha256
    === sha256File(path.join(shaderDir, "ags101-display-v1.slang")),
"AGS WS8 GPU reference is stale for the current three Shader passes");
check(ws8PresetManifest.manifestId === "nintendo-ags-101-ws8-presets-v1"
  && ws8PresetManifest.presets?.length === 3
  && ws8PresetManifest.presets.some((preset) => preset.debugView === 13)
  && ws8PresetManifest.presets.some((preset) => preset.debugView === 14)
  && ws8PresetManifest.exposureReference?.sha256 === sha256File(ws8ReferencePath),
"AGS WS8 exposure preset manifest or CPU reference hash drifted");
for (const artifact of ws8PresetManifest.presets ?? []) {
  const artifactPath = path.join(modelDir, artifact.path);
  check(fs.existsSync(artifactPath), `AGS WS8 preset is missing: ${artifact.path}`);
  if (fs.existsSync(artifactPath)) {
    const source = fs.readFileSync(artifactPath, "utf8");
    check(sha256File(artifactPath) === artifact.sha256
      && source.includes(`DebugView = "${artifact.debugView}.0"`)
      && source.includes('DriveRetention = "0.0"')
      && (artifact.id !== "exposure-numeric" || source.includes('ExposureMode = "1.0"')),
    `AGS WS8 preset lost hash or isolation settings: ${artifact.path}`);
  }
}
const ws8SafeBypass = ws8PresetManifest.presets?.find(
  (preset) => preset.id === "frontend-safe-bypass",
);
if (ws8SafeBypass) {
  const source = fs.readFileSync(path.join(modelDir, ws8SafeBypass.path), "utf8");
  check(source.includes('TemporalResponse = "0.0"')
    && source.includes('DriveRetention = "0.0"')
    && source.includes('BakedScanout = "0.0"')
    && source.includes('ExposureMode = "0.0"'),
  "AGS WS8 frontend safe-bypass preset regained temporal state");
}
check(metadata.evidence?.gpuExposureReference
  === "generated/ws8-exposure-gpu-reference-v1.json"
  && metadata.evidence?.ws8ValidationPresets === "generated/ws8-presets-v1/manifest.json"
  && metadata.evidence?.lastFullNumericTargetValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws8-target-20260820.json"
  && metadata.evidence?.lastPerformanceTargetValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-performance-20260821.json"
  && metadata.evidence?.currentTargetValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-timing-default-20260821.json"
  && metadata.evidence?.currentTargetValidationStatus
    === "pass-github-layout-deployment-presentation-and-frame-pacing-no-full-numeric-rerun"
  && metadata.diagnostics?.lastFullNumericWs7DeviceValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-ws8-target-20260820.json"
  && metadata.diagnostics?.lastPerformanceDeviceValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-performance-20260821.json"
  && metadata.diagnostics?.currentPerformanceDeviceValidation
    === "../../targets/konkr-gt78-vn/960x640-srgb-neutral/validation/ags101-timing-default-20260821.json",
"AGS model metadata lost historical validation or the current-artifact boundary");
check(ws8TargetReceipt.runId === "konkr-gt78-vn-ags101-ws8-current-20260820"
  && ws8TargetReceipt.modelId === metadata.id
  && ws8TargetReceipt.currentPipeline?.passes === 3
  && ws8TargetReceipt.numericReadback?.exposure?.pass === true
  && ws8TargetReceipt.numericReadback?.aperture?.pass === true
  && ws8TargetReceipt.numericReadback?.retention?.pass === true
  && ws8TargetReceipt.numericReadback?.frontendSafeBypass?.pass === true
  && ws8TargetReceipt.acceptance?.currentArtifactReceipt
    === "pass-with-explicit-unsupported-boundaries"
  && ws8TargetReceipt.acceptance?.promotionEligible === true
  && ws8TargetReceipt.acceptance?.promotionApplied === true
  && ws8TargetReceipt.acceptance?.promotedModelId
    === "nintendo-ags-101-period-reconstruction",
"AGS current WS8 KONKR receipt lost a numeric, safe-boundary, or promotion gate");
const historicalWs8ShaderHashes = {
  "ags101-response-v1.slang": "168f23a4bf52f371cd815f71f3e57ccab845ac9a1b63ae7bbc5f4444da333e54",
  "ags101-exposure-v1.slang": "e7889fe8e58a77a1697a855da769451e9ea5cc7bf2c87c9fe989d0b6e1e06a4b",
  "ags101-display-v1.slang": "dd862305eb8d02b17cc797132b748c4f9e0b00e2434a9dc283c01df4bd64e524",
};
for (const [shader, expectedHash] of Object.entries(historicalWs8ShaderHashes)) {
  const receiptArtifact = ws8TargetReceipt.artifacts?.repository?.find(
    (item) => item.path === `models/nintendo-ags-101/shaders/${shader}`,
  );
  check(receiptArtifact?.sha256 === expectedHash,
    `AGS historical WS8 KONKR receipt drifted for ${shader}`);
}
check(performanceTargetReceipt.runId
    === "konkr-gt78-vn-ags101-performance-current-20260821"
  && performanceTargetReceipt.modelId === metadata.id
  && performanceTargetReceipt.releaseCandidate === "0.6.0"
  && performanceTargetReceipt.currentPipeline?.passes === 3
  && performanceTargetReceipt.currentPipeline?.modelPathPreserved === true
  && performanceTargetReceipt.performance?.aggregate?.intervals === 370
  && performanceTargetReceipt.performance?.aggregate?.averageFps > 60.06
  && performanceTargetReceipt.performance?.aggregate?.intervalsOver25Milliseconds === 0
  && performanceTargetReceipt.performance?.aggregate?.pass === true
  && performanceTargetReceipt.numericReadbackBoundary
    ?.currentOptimizedShaderDebugView12To14Rerun === false,
"AGS historical performance receipt lost its target identity, frame pacing, or numeric boundary");
const performanceReceiptShaderMismatches = [];
for (const shader of [
  "ags101-response-v1.slang",
  "ags101-exposure-optics.inc",
  "ags101-exposure-v1.slang",
  "ags101-display-v1.slang",
]) {
  const receiptArtifact = performanceTargetReceipt.artifacts?.repository?.find(
    (item) => item.path === `models/nintendo-ags-101/shaders/${shader}`,
  );
  if (receiptArtifact?.sha256 !== sha256File(path.join(shaderDir, shader))) {
    performanceReceiptShaderMismatches.push(shader);
  }
}
check(performanceReceiptShaderMismatches.includes("ags101-response-v1.slang")
  && performanceReceiptShaderMismatches.includes("ags101-exposure-v1.slang")
  && performanceReceiptShaderMismatches.includes("ags101-display-v1.slang"),
"AGS historical performance receipt was relabeled current or no longer exposes the timing-default shader change");
check(currentTargetReceipt.runId
    === "konkr-gt78-vn-ags101-timing-default-current-20260821"
  && currentTargetReceipt.modelId === metadata.id
  && currentTargetReceipt.targetProfile === "konkr-gt78-vn-960x640-srgb-neutral"
  && currentTargetReceipt.classification
    === "current-github-layout-deployment-presentation-and-frame-pacing-receipt-not-full-numeric-readback"
  && currentTargetReceipt.deployment?.shaderRoot
    === "/sdcard/RetroArch/shaders/retro-display-lab"
  && currentTargetReceipt.deployment?.mGbaContentDirectoryOverride
    === "/sdcard/RetroArch/config/mGBA/gba.slangp"
  && currentTargetReceipt.selectedReconstruction?.LatchOffsetLines === 0
  && currentTargetReceipt.selectedReconstruction?.InversionTopology === 1
  && currentTargetReceipt.artifacts?.repositoryAndDeviceHashesMatched === true
  && currentTargetReceipt.presentation?.processStarted === true
  && currentTargetReceipt.presentation?.screenshot?.width === 960
  && currentTargetReceipt.presentation?.screenshot?.height === 640
  && currentTargetReceipt.framePacing?.intervals === 126
  && currentTargetReceipt.framePacing?.averageFps > 60.06
  && currentTargetReceipt.framePacing?.intervalsOver25Milliseconds === 0
  && currentTargetReceipt.framePacing?.pass === true
  && currentTargetReceipt.acceptance?.fullDebugView12To14NumericReadbackRerun === false
  && currentTargetReceipt.acceptance?.lastFullNumericReceipt
    === "validation/ags101-ws8-target-20260820.json"
  && currentTargetReceipt.acceptance?.currentArtifactReceipt
    === "pass-with-explicit-numeric-readback-boundary",
"AGS current timing-default receipt lost deployment, presentation, pacing, or numeric-boundary evidence");
for (const artifact of currentTargetReceipt.artifacts?.files ?? []) {
  const artifactPath = path.resolve(root, artifact.path);
  check(artifactPath.startsWith(`${root}${path.sep}`)
    && fs.existsSync(artifactPath)
    && sha256File(artifactPath) === artifact.sha256,
  `AGS current timing-default receipt hash drifted: ${artifact.path}`);
}
for (const code of [0, 4, 16, 27, 31]) {
  check(Math.abs(rgb555DriveCodeProxy([code, code, code]) - code / 31) < 1e-15,
    `AGS WS5 RGB555 command proxy drifted at code ${code}`);
  for (const polarity of [-1, 1]) {
    check(spatialDriveExcitation({
      sourceRgb555: [code, code, code],
      polarity,
      driveDcOffset: 0,
      spatialRetentionEnabled: true,
      codeWeight: 0.5,
      polarityWeight: 0.25,
    }) === 0, `AGS WS5 balanced drive is nonzero at code ${code}, polarity ${polarity}`);
  }
}
const ws5SpatialOff = stepSpatialRetention({
  state: 0.17,
  sourceRgb555: [0, 17, 31],
  polarity: -1,
  driveDcOffset: 0.1,
  spatialRetentionEnabled: false,
  adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
  desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
  dtSeconds: 0.37,
});
const ws5GlobalControl = stepResidualDc({
  state: 0.17,
  driveDcOffset: 0.1,
  adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
  desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
  dtSeconds: 0.37,
});
check(ws5SpatialOff.excitation === 0.1 && ws5SpatialOff.state === ws5GlobalControl,
  "AGS WS5 spatial-off mode no longer exactly restores the WS1 global path");

check(hcsSource.source.commit === "e688fc51141c0974728aa1bdcb89b94d74123f6b",
  "AGS HCS normalized record lost pinned source commit");
check(hcsSource.grayscale.length === 32, "AGS HCS normalized record lost 32-code gray ramp");
check(hcsColor.source.evidenceId === "AGS-COLOR-01", "AGS HCS artifact lost evidence ID");
check(hcsColor.eotfRgb555Runtime.length === 32, "AGS HCS artifact lost 32-code EOTF");
check(hcsColor.outputPolicies?.hcsBlackSubtracted?.id === "hcs-black-subtracted"
  && hcsColor.outputPolicies?.hcsPhysicalBlack?.id === "hcs-physical-black",
"AGS HCS artifact lost separately named black policies");
check(hcsColor.coverage?.measured?.neutralRampRgb555Codes === 32
  && hcsColor.coverage?.notMeasuredOrNotRecorded?.perChannelRamps === true
  && hcsColor.coverage?.notMeasuredOrNotRecorded?.interUnitVariation === true,
"AGS HCS artifact lost measured/unmeasured coverage separation");
check(hcsColor.blackXyz.every((value, channel) => (
  Math.abs(value - hcsSource.grayscale[0].xyz[channel]) < 1e-12
)), "AGS HCS black anchor drifted from normalized record");
check(hcsColor.whiteXyz.every((value, channel) => (
  Math.abs(value - hcsSource.grayscale[31].xyz[channel]) < 1e-12
)), "AGS HCS white anchor drifted from normalized record");
for (let channel = 0; channel < 3; channel += 1) {
  check(Math.abs(hcsColor.eotfRgb555Runtime[0][channel]) < 1e-15,
    `AGS HCS channel ${channel} black endpoint is not zero`);
  check(Math.abs(hcsColor.eotfRgb555Runtime[31][channel] - 1) < 1e-15,
    `AGS HCS channel ${channel} white endpoint is not one`);
  for (let code = 1; code < 32; code += 1) {
    check(hcsColor.eotfRgb555Runtime[code][channel]
      > hcsColor.eotfRgb555Runtime[code - 1][channel],
    `AGS HCS EOTF is not strictly increasing at channel ${channel}, code ${code}`);
  }
}

const hcsD65White = hcsHostLinear(
  [1, 1, 1], hcsColor, { adaptToD65: true, improveContrast: true },
);
check(hcsD65White.every((value) => Math.abs(value - 1) < 2.5e-4),
  `AGS HCS D65-adapted white is not neutral: ${hcsD65White}`);
const hcsD65WhiteWithBlack = hcsHostLinear(
  [1, 1, 1], hcsColor, { adaptToD65: true, improveContrast: false },
);
check(hcsD65WhiteWithBlack.every((value) => Math.abs(value - 1) < 2.5e-4),
  `AGS HCS D65-adapted measured black/white is not neutral: ${hcsD65WhiteWithBlack}`);

const hcsGolden = hcsColor.goldenVectors;
check(hcsGolden.grayscaleRgb555.length === 32, "AGS HCS golden vectors lost gray ramp");
check(hcsGolden.grayscaleRgb555.every((sample, code) => sample.code === code),
  "AGS HCS golden gray-vector code ordering changed");
const expectedGray16 = [0.481860154745865, 0.490167719413069, 0.613556224303678];
check(hcsGolden.grayscaleRgb555[16].outputRgb.every((value, channel) => (
  Math.abs(value - expectedGray16[channel]) < 1e-12
)), "AGS HCS code-16 golden output drifted");
const expectedFullLevelPatches = {
  red: [1, 0.202578595302579, 0],
  green: [0.369925296726513, 0.937800933002692, 0],
  blue: [0, 0.301952639907652, 1],
  yellow: [1, 0.953850662361029, 0],
  cyan: [0.21221743983879, 0.972467555165949, 1],
  magenta: [0.967310517111093, 0.36256008927453, 1],
};
for (const [name, expected] of Object.entries(expectedFullLevelPatches)) {
  const actual = hcsGolden.fullLevelPatches[name]?.outputRgb;
  check(Array.isArray(actual) && actual.every((value, channel) => (
    Math.abs(value - expected[channel]) < 1e-12
  )), `AGS HCS ${name} full-level golden output drifted`);
}
for (const sample of hcsGolden.grayscaleRgb555) {
  const actual = renderStaticRgb555(
    [sample.code, sample.code, sample.code], hcsColor,
  );
  check(actual.every((value, channel) => (
    Math.abs(value - sample.outputRgb[channel]) < 1e-11
  )), `AGS shared color reference disagrees with gray code ${sample.code}`);
}
for (const [name, sample] of Object.entries(hcsGolden.fullLevelPatches)) {
  const actual = renderStaticRgb555(sample.rgbIndex, hcsColor);
  check(actual.every((value, channel) => (
    Math.abs(value - sample.outputRgb[channel]) < 1e-11
  )), `AGS shared color reference disagrees with ${name} golden vector`);
}
for (let code = 0; code < 256; code += 1) {
  const encoded = code / 255;
  check(Math.abs(srgbEncodeChannel(srgbDecodeChannel(encoded)) - encoded) < 2e-15,
    `AGS shared sRGB reference lost round-trip at code ${code}`);
}
for (const indices of [[0, 0, 0], [7, 15, 23], [31, 31, 31]]) {
  const neutral = renderStaticRgb555(indices, hcsColor, { measured: false });
  check(neutral.every((value, channel) => Math.abs(value - indices[channel] / 31) < 2e-15),
    `AGS neutral color reference drifted at ${indices.join(",")}`);
}
const fps = PANEL_FPS;
const frameSeconds = PANEL_FRAME_SECONDS;
const candidate = { rise: 0.620, fall: 0.450, near: 0.250, middle: 0.200 };

function response(from, to) {
  return analyticFrameAlpha(from, to);
}

function responseForTime(perFrameResponse, seconds) {
  return rateToAlpha(frameAlphaToRate(perFrameResponse, frameSeconds), seconds);
}

const balancedDrive = BALANCED_DRIVE;

const knownRate = 40;
const knownTimes = [0, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16];
const knownWaveform = knownTimes.map((seconds) => rateToAlpha(knownRate, seconds));
const knownFit = fitFirstOrder(knownTimes, knownWaveform);
check(knownFit.runtimeEligible && Math.abs(knownFit.ratePerSecond - knownRate) < 1e-9,
  "AGS GtG first-order fitter did not recover a known synthetic rate");
check(knownFit.rmse < 1e-12 && knownFit.maxAbsError < 1e-12,
  "AGS GtG known synthetic fit gained residual error");
const absoluteFrom = 2.5;
const absoluteTo = 11.75;
const absoluteWaveform = knownWaveform.map((progress) => (
  absoluteFrom + (absoluteTo - absoluteFrom) * progress
));
const renormalizedAbsolute = absoluteWaveform.map((value) => (
  (value - absoluteFrom) / (absoluteTo - absoluteFrom)
));
const absoluteFit = fitFirstOrder(knownTimes, renormalizedAbsolute);
check(Math.abs(absoluteFit.ratePerSecond - knownRate) < 1e-9,
  "AGS GtG absolute optical units did not normalize through measured plateaus");

const overshootTimes = [0, 0.01, 0.02, 0.04, 0.08];
const overshootWaveform = [0, 0.55, 1.08, 1.03, 1.0];
const overshootMetrics = deriveWaveformMetrics(overshootTimes, overshootWaveform);
const overshootFit = fitFirstOrder(overshootTimes, overshootWaveform);
check(overshootMetrics.overshoot > 0.079 && overshootMetrics.monotonicViolations > 0,
  "AGS GtG waveform metrics lost overshoot/non-monotone detection");
check(!overshootFit.runtimeEligible
  && overshootFit.rejectionReasons.includes("overshoot")
  && overshootFit.rejectionReasons.includes("non-monotone"),
"AGS GtG v1 silently accepted an overshooting waveform");

const partitionStart = 0.17;
const partitionTarget = 0.83;
const partitionWhole = stepFirstOrder(partitionStart, partitionTarget, knownRate, 0.037);
const partitionSplit = stepFirstOrder(
  stepFirstOrder(partitionStart, partitionTarget, knownRate, 0.011),
  partitionTarget,
  knownRate,
  0.026,
);
check(Math.abs(partitionWhole - partitionSplit) < 1e-15,
  "AGS GtG continuous-time fit lost exact partition composition");
check(stepFirstOrder(0.42, 0.42, knownRate, 10) === 0.42,
  "AGS GtG identity transition is not stationary");

for (const start of [0, 0.1, 0.5, 0.9, 1]) {
  for (const target of [0, 0.15, 0.5, 0.85, 1]) {
    for (const rate of [0, 0.01, 1, 40, 10_000]) {
      for (const seconds of [0, 1e-6, frameSeconds, 1, 1_000]) {
        const stepped = stepFirstOrder(start, target, rate, seconds);
        check(stepped >= Math.min(start, target) - 1e-15
          && stepped <= Math.max(start, target) + 1e-15,
        `AGS GtG step escaped endpoint bounds: ${start}->${target}`);
        check((target >= start && stepped >= start - 1e-15)
          || (target < start && stepped <= start + 1e-15),
        `AGS GtG step moved away from target: ${start}->${target}`);
      }
    }
  }
}

for (const rate of [1, 19.5, 40, 57.8, 1_024]) {
  const decoded = decodeRate16(encodeRate16(rate));
  check(Math.abs(decoded - rate) / rate < 6e-5,
    `AGS GtG packed rate exceeded precision bound at ${rate}/s`);
}
const completeCells = new Map();
for (const fromCode of [10, 11]) {
  for (const toCode of [20, 21]) {
    completeCells.set(`r:${fromCode}>${toCode}`, {
      runtimeEligible: true,
      ratePerSecond: 30 + fromCode + toCode,
    });
  }
}
const completeField = sampleRateField({
  fromCode: 10.25,
  toCode: 20.75,
  channel: "r",
  getCell: (channel, fromCode, toCode) => completeCells.get(`${channel}:${fromCode}>${toCode}`),
  fallbackRate: 17,
});
check(completeField.backend === "table" && Math.abs(completeField.ratePerSecond - 61) < 1e-12,
  "AGS GtG table field lost bilinear interpolation");
completeCells.get("r:11>21").runtimeEligible = false;
const missingField = sampleRateField({
  fromCode: 10.25,
  toCode: 20.75,
  channel: "r",
  getCell: (channel, fromCode, toCode) => completeCells.get(`${channel}:${fromCode}>${toCode}`),
  fallbackRate: 17,
});
check(missingField.backend === "analytic-fallback" && missingField.ratePerSecond === 17,
  "AGS GtG incomplete table did not invoke explicit analytic fallback");

for (const alpha of [0.025, candidate.fall, candidate.rise, 0.999]) {
  const roundTrip = responseForTime(alpha, frameSeconds);
  check(Math.abs(roundTrip - alpha) < 1e-12, `AGS time response changed one-frame alpha ${alpha}`);
}

check(GBA_MASTER_CLOCK_HZ === 16_777_216, "AGS scan CPU reference lost master clock");
check(GBA_CYCLES_PER_LINE === 1_232, "AGS scan CPU reference lost cycles per line");
check(GBA_TOTAL_LINES === 228, "AGS scan CPU reference lost total lines");
check(Math.abs(GBA_FRAME_SECONDS - frameSeconds) < 1e-18,
  "AGS WS2 and WS3 frame periods disagree");
check(Math.abs(GBA_FRAME_HZ - fps) < 1e-12, "AGS WS2 and WS3 frame rates disagree");
check(Math.abs(GBA_LINE_SECONDS - 0.00007343292236328125) < 1e-20,
  "AGS exact line period drifted");

const firstVisibleEvent = scanEvent({ row: 0 });
const lastVisibleEvent = scanEvent({ row: 159 });
const firstVisibleLatchMs = firstVisibleEvent.latchSeconds * 1000;
const lastVisibleLatchMs = lastVisibleEvent.latchSeconds * 1000;
check(firstVisibleLatchMs === 0,
  `AGS first-row latch phase drifted: ${firstVisibleLatchMs} ms`);
check(lastVisibleLatchMs > 11.67 && lastVisibleLatchMs < 11.68,
  `AGS last-row latch phase drifted: ${lastVisibleLatchMs} ms`);
for (const row of [0, 1, 80, 159]) {
  const event = scanEvent({ row, latchOffsetLines: 0.5, opticalDelaySeconds: 0 });
  const legacyTime = ((row + 0.5) / 228) * frameSeconds;
  check(Math.abs(event.opticalTimeInFrame - legacyTime) < 1e-18,
    `AGS zero-delay line-center event lost v2 equivalence at row ${row}`);
}

const fullRise = response(0, 31);
const topCurrentSeconds = firstVisibleEvent.afterOpticalSeconds;
const bottomCurrentSeconds = lastVisibleEvent.afterOpticalSeconds;
const topChangedRow = responseForTime(fullRise, topCurrentSeconds);
const bottomChangedRow = responseForTime(fullRise, bottomCurrentSeconds);
check(topChangedRow > bottomChangedRow,
  "AGS changed top row must receive more current-target time than bottom row");
check(responseForTime(fullRise, frameSeconds) === fullRise,
  "AGS static/temporal one-segment path must preserve the v1 frame response");

const black = [0, 0, 0];
const white = [31, 31, 31];
const blackState = { panel: black.map(opticalLevel), residualDc: 0 };
const whiteState = { panel: white.map(opticalLevel), residualDc: 0 };
const topRiseState = integrateScanoutFrame(blackState, black, white, 0);
const bottomRiseState = integrateScanoutFrame(blackState, black, white, 159);
check(topRiseState.panel.every((value, channel) => value > bottomRiseState.panel[channel]),
  "AGS two-segment CPU reference lost top-to-bottom rise phase");
const topFallState = integrateScanoutFrame(whiteState, white, black, 0);
const bottomFallState = integrateScanoutFrame(whiteState, white, black, 159);
check(topFallState.panel.every((value, channel) => value < bottomFallState.panel[channel]),
  "AGS two-segment CPU reference lost top-to-bottom fall phase");

const middleTarget = [15, 16, 17];
const middleState = { panel: [0.18, 0.23, 0.29], residualDc: 0.15 };
const temporalMiddle = integrateSegment(middleState, middleTarget, frameSeconds);
const staticScanoutMiddle = integrateScanoutFrame(
  middleState,
  middleTarget,
  middleTarget,
  93,
);
check(temporalMiddle.panel.every((value, channel) => (
  Math.abs(value - staticScanoutMiddle.panel[channel]) < 1e-15
)), "AGS static row is not exactly temporal-only in CPU reference");
check(Math.abs(temporalMiddle.residualDc - staticScanoutMiddle.residualDc) < 1e-15,
  "AGS static row residual-DC state is not exactly temporal-only in CPU reference");

const temporalChanged = integrateSegment(middleState, white, frameSeconds);
const disabledScanoutChanged = integrateScanoutFrame(
  middleState,
  black,
  white,
  93,
  false,
);
check(temporalChanged.panel.every((value, channel) => (
  Math.abs(value - disabledScanoutChanged.panel[channel]) < 1e-15
)), "AGS BakedScanout=0 changed transition is not temporal-only");
check(Math.abs(temporalChanged.residualDc - disabledScanoutChanged.residualDc) < 1e-15,
  "AGS BakedScanout=0 changed transition altered residual-DC state");

const partialPrevious = [0, 15, 15];
const partialCurrent = [31, 15, 15];
const partialState = { panel: partialPrevious.map(opticalLevel), residualDc: 0.1 };
const partialResult = integrateScanoutFrame(
  partialState,
  partialPrevious,
  partialCurrent,
  80,
);
const partialPhase = scanEvent({ row: 80 }).opticalTimeInFrame;
const partialResidualAtOptical = integrateResidualDc(partialState.residualDc, partialPhase);
const partialResidualAtEnd = integrateResidualDc(
  partialResidualAtOptical,
  frameSeconds - partialPhase,
);
const partialSingle = integrateOptical(
  partialState.panel,
  partialCurrent,
  partialResidualAtEnd,
  frameSeconds,
);
check(Math.abs(partialResult.panel[1] - partialSingle[1]) < 1e-15
  && Math.abs(partialResult.panel[2] - partialSingle[2]) < 1e-15,
"AGS unchanged subpixels gained an artificial scan-latch optical split");

const lineStartEvent = scanEvent({ row: 80, latchOffsetLines: 0 });
const lineEndEvent = scanEvent({ row: 80, latchOffsetLines: 1 });
check(Math.abs(lineEndEvent.latchSeconds - lineStartEvent.latchSeconds - GBA_LINE_SECONDS) < 1e-18,
  "AGS line-start/line-end diagnostics no longer bound exactly one line");
const delayedEvent = scanEvent({
  row: 159,
  latchOffsetLines: 0.5,
  opticalDelaySeconds: 0.01,
});
check(delayedEvent.sourceFrameOffset === 1,
  "AGS bottom-row optical delay no longer crosses the frame boundary");
check(Math.abs(
  delayedEvent.opticalAbsoluteSeconds
    - (delayedEvent.latchSeconds + delayedEvent.opticalDelaySeconds),
) < 1e-18, "AGS optical event no longer equals latch plus pure delay");
check(Math.abs(
  delayedEvent.beforeOpticalSeconds + delayedEvent.afterOpticalSeconds - frameSeconds,
) < 1e-18, "AGS wrapped optical event does not partition exactly one frame");
const delayedPair = sourcePairForEvent({
  older: black,
  previous: white,
  current: [7, 8, 9],
  sourceFrameOffset: delayedEvent.sourceFrameOffset,
});
check(delayedPair.oldTarget === black && delayedPair.newTarget === white,
  "AGS wrapped event sampled the future current source frame");
const delayedStateA = integrateScanoutFrame(
  blackState,
  white,
  [7, 8, 9],
  159,
  true,
  balancedDrive,
  1,
  { olderTarget: black, opticalDelaySeconds: 0.01 },
);
const delayedStateB = integrateScanoutFrame(
  blackState,
  white,
  [28, 3, 21],
  159,
  true,
  balancedDrive,
  1,
  { olderTarget: black, opticalDelaySeconds: 0.01 },
);
check(delayedStateA.panel.every((value, channel) => (
  Math.abs(value - delayedStateB.panel[channel]) < 1e-15
)), "AGS cross-frame optical event depends on a future source target");
const startupPair = sourcePairForEvent({
  older: black,
  previous: white,
  current: black,
  olderAvailable: false,
  sourceFrameOffset: 1,
});
check(startupPair.oldTarget === white && startupPair.newTarget === white,
  "AGS startup fallback invents a negative-history transition");

const sourceTexel = (coordinate, size) => clamp(Math.floor(coordinate * size), 0, size - 1);
check(sourceTexel(0, 240) === 0 && sourceTexel(1, 240) === 239,
  "AGS source X clamp lost 0/1 endpoint behavior");
check(sourceTexel(0, 160) === 0 && sourceTexel(1, 160) === 159,
  "AGS source Y clamp lost 0/1 endpoint behavior");

function crossingFrame(from, to, threshold) {
  const initial = opticalLevel(from);
  const target = opticalLevel(to);
  let current = initial;
  let previousProgress = 0;
  for (let frame = 1; frame <= 180; frame += 1) {
    const rate = analyticRate(opticalToCode(current), to);
    current = stepFirstOrder(current, target, rate, frameSeconds);
    const progress = (current - initial) / (target - initial);
    if (progress >= threshold) {
      const fraction = (threshold - previousProgress) / (progress - previousProgress);
      return frame - 1 + fraction;
    }
    previousProgress = progress;
  }
  return Infinity;
}

function tenToNinetyMs(from, to) {
  return (crossingFrame(from, to, 0.9) - crossingFrame(from, to, 0.1)) * 1000 / fps;
}

const endpointBrightening = tenToNinetyMs(0, 31);
const endpointDarkening = tenToNinetyMs(31, 0);
const middleBrightening = tenToNinetyMs(15, 16);
const middleDarkening = tenToNinetyMs(16, 15);
check(endpointBrightening >= 45 && endpointBrightening <= 55, `AGS endpoint brightening drifted: ${endpointBrightening}`);
check(endpointDarkening >= 60 && endpointDarkening <= 75, `AGS endpoint darkening drifted: ${endpointDarkening}`);
check(middleBrightening > endpointBrightening, "AGS near-middle brightening must remain slower than endpoint");
check(middleDarkening > endpointDarkening, "AGS near-middle darkening must remain slower than endpoint");

const literatureDrive = {
  driveDcOffset: 0.1,
  adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
  desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
  driveCodeCoupling: 0.15,
};

// With no resultant DC imbalance, image code is not an excitation variable.
for (const sourceCode of [0, 0.5, 1]) {
  const balancedState = stepResidualDc({
    state: 0,
    driveDcOffset: 0,
    adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
    desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
    dtSeconds: 24 * 60 * 60,
  });
  check(balancedState === 0,
    `AGS balanced drive drifted for source code ${sourceCode}: ${balancedState}`);
}

const positiveState = integrateResidualDc(0, 30 * 60, literatureDrive);
const negativeState = integrateResidualDc(0, 30 * 60, {
  ...literatureDrive,
  driveDcOffset: -literatureDrive.driveDcOffset,
});
check(Math.abs(positiveState + negativeState) < 1e-15,
  "AGS residual-DC state lost sign-reversal symmetry");

const relaxedState = stepResidualDc({
  state: positiveState,
  driveDcOffset: 0,
  adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
  desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
  dtSeconds: 120,
});
const expectedRelaxedState = positiveState
  * Math.exp(-LITERATURE_CELL_PRIOR.desorptionRatePerSecond * 120);
check(Math.abs(relaxedState - expectedRelaxedState) < 1e-15,
  "AGS zero-bias relaxation no longer matches Mizusaki eq. 5");

const fullFrameState = integrateResidualDc(0.031, frameSeconds, literatureDrive);
let partitionedState = 0.031;
for (const partition of [0.1, 0.2, 0.3, 0.4]) {
  partitionedState = integrateResidualDc(
    partitionedState,
    frameSeconds * partition,
    literatureDrive,
  );
}
check(Math.abs(fullFrameState - partitionedState) < 1e-14,
  "AGS exact residual-DC update depends on constant-drive time partitioning");

const combinedRate = LITERATURE_CELL_PRIOR.adsorptionRatePerSecond
  + LITERATURE_CELL_PRIOR.desorptionRatePerSecond;
const equilibriumState = LITERATURE_CELL_PRIOR.adsorptionRatePerSecond
  * literatureDrive.driveDcOffset / combinedRate;
const longDurationState = integrateResidualDc(0, 20 / combinedRate, literatureDrive);
check(Math.abs(longDurationState - equilibriumState) < 1e-9,
  `AGS long-duration state did not converge: ${longDurationState} vs ${equilibriumState}`);
check(Math.abs(longDurationState) <= 1,
  "AGS long-duration residual-DC state escaped its normalized bounds");

for (const initialState of [-1, -0.4, 0, 0.4, 1]) {
  for (const driveDcOffset of [-1, -0.1, 0, 0.1, 1]) {
    for (const dtSeconds of [0, frameSeconds, 1, 60, 86_400]) {
      const state = stepResidualDc({
        state: initialState,
        driveDcOffset,
        adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
        desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
        dtSeconds,
      });
      check(state >= -1 && state <= 1,
        `AGS residual-DC property test escaped bounds: ${state}`);
    }
  }
}

check(framePolarity(0) === 1 && framePolarity(1) === -1
  && framePolarity(2) === 1,
"AGS explicit frame-polarity sequence changed");
const positivePhaseCode = effectiveDriveCode({
  sourceCode: 0.5,
  polarity: framePolarity(0),
  driveDcOffset: literatureDrive.driveDcOffset,
  residualDcState: 0,
  driveCodeCoupling: literatureDrive.driveCodeCoupling,
});
const negativePhaseCode = effectiveDriveCode({
  sourceCode: 0.5,
  polarity: framePolarity(1),
  driveDcOffset: literatureDrive.driveDcOffset,
  residualDcState: 0,
  driveCodeCoupling: literatureDrive.driveCodeCoupling,
});
check(positivePhaseCode > 0.5 && negativePhaseCode < 0.5
  && Math.abs(positivePhaseCode + negativePhaseCode - 1) < 1e-15,
"AGS drive-code coupling lost alternating polarity symmetry");

const unitErrorPerFrame = integrateResidualDc(0, frameSeconds, {
  ...literatureDrive,
  driveDcOffset: 1,
});
const halfDecodedSpacingAtZero = 2 ** -9;
const floatDecodedSpacingAtZero = 2 ** -22;
check(unitErrorPerFrame < halfDecodedSpacingAtZero,
  "AGS precision guard no longer demonstrates half-float state stalling");
check(unitErrorPerFrame > floatDecodedSpacingAtZero,
  "AGS float32 state precision is insufficient for the literature-rate update");

check(metadata.references === "REFERENCES.md", "AGS metadata lost reference map");
for (const id of metadataEvidenceIds) {
  check(evidenceIds.has(id), `AGS metadata contains undefined evidence ID ${id}`);
}
for (const id of evidenceIds) {
  check(metadataEvidenceIds.has(id), `AGS metadata omits documented evidence ID ${id}`);
}

const targetProfile = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "profile.json"),
  "utf8",
));
const agsTarget = targetProfile.additionalContent?.["Nintendo GBA SP AGS-101 period reconstruction"];
check(Boolean(agsTarget), "KPA profile lost AGS-101 target geometry");
check(agsTarget?.contentViewport?.join("x") === "960x640", "KPA AGS viewport is not 960x640");
check(agsTarget?.integerScale === 4, "KPA AGS target lost exact 4x scale");

const targetDir = path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral");
const validationRecords = (targetProfile.validationRecords ?? [])
  .filter((relativeRecord) => path.basename(relativeRecord).startsWith("ags101-"));
check(validationRecords.length > 0, "KPA profile has no AGS frontend validation record");
const lastCompletedTargetRecord = "validation/ags101-ws5-target-20260820.json";
check(validationRecords.includes(lastCompletedTargetRecord),
  "KPA profile omits the last completed AGS WS5 target record");
check(targetProfile.currentAgs101ValidationRecord
    === "validation/ags101-timing-default-20260821.json"
  && targetProfile.currentAgs101ValidationStatus
    === "pass-github-layout-deployment-presentation-and-frame-pacing-no-full-numeric-rerun"
  && targetProfile.lastPerformanceAgs101ValidationRecord
    === "validation/ags101-performance-20260821.json"
  && targetProfile.lastFullNumericAgs101ValidationRecord
    === "validation/ags101-ws8-target-20260820.json",
"KPA profile lost the current-artifact boundary or historical AGS target records");
for (const relativeRecord of validationRecords) {
  const recordPath = path.resolve(targetDir, relativeRecord);
  check(recordPath.startsWith(`${targetDir}${path.sep}`),
    `KPA validation record escapes target directory: ${relativeRecord}`);
  check(fs.existsSync(recordPath), `KPA validation record is missing: ${relativeRecord}`);
  if (!fs.existsSync(recordPath)) continue;
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  checkFrontendRecord(record, relativeRecord, false, [
    metadata.id,
    metadata.promotion?.from,
  ]);
  check(record.targetProfile === targetProfile.id,
    `${relativeRecord}: target profile ID does not match profile.json`);
  for (const [relativeArtifact, expectedHash] of Object.entries(record.artifacts ?? {})) {
    const artifactPath = path.resolve(root, relativeArtifact);
    check(artifactPath.startsWith(`${root}${path.sep}`),
      `${relativeRecord}: artifact escapes repository: ${relativeArtifact}`);
    const isPrivateRunEvidence = relativeArtifact.startsWith(".codex-validation/");
    check(fs.existsSync(artifactPath) || isPrivateRunEvidence,
      `${relativeRecord}: repository artifact is missing: ${relativeArtifact}`);
    if (isPrivateRunEvidence) {
      check(/^[0-9a-f]{64}$/.test(expectedHash),
        `${relativeRecord}: private evidence hash is invalid: ${relativeArtifact}`);
      if (fs.existsSync(artifactPath)) {
        check(sha256File(artifactPath) === expectedHash,
          `${relativeRecord}: private evidence hash drifted: ${relativeArtifact}`);
      }
    }
    // Historical device records pin the exact bytes they exercised. They are
    // intentionally not rewritten or compared with a later Shader checkout.
    // Ignored private captures can be absent in a clean clone; their committed
    // SHA-256 values remain required, and are checked whenever files are present.
  }

  if (relativeRecord === lastCompletedTargetRecord) {
    const runEvidence = record.runEvidence ?? {};
    check(runEvidence.compile?.allColdStartsPassed === true,
      `${relativeRecord}: pinned WS5 cold-start compile did not pass`);
    check(runEvidence.compile?.responsePassFormat === "R32G32B32A32_SFLOAT",
      `${relativeRecord}: response feedback was not RGBA32F`);
    check(runEvidence.compile?.displayPassFormat === "R8G8B8A8_UNORM",
      `${relativeRecord}: display pass was not RGBA8`);
    check(runEvidence.compile?.loadedParameters?.SpatialRetention === 1
      && runEvidence.compile?.loadedParameters?.SpatialCodeWeight === 0.5
      && runEvidence.compile?.loadedParameters?.PolarityDriveWeight === 0.25
      && runEvidence.compile?.loadedParameters?.DebugView === 12,
    `${relativeRecord}: WS5 numeric parameters were not loaded`);
    check(runEvidence.compile?.shaderTextureCompileErrors === 0,
      `${relativeRecord}: pinned WS5 run reported Shader/texture errors`);

    const numeric = runEvidence.gpuNumericReadback ?? {};
    check(numeric.pass === true
      && numeric.allDecodedBandsUnanimous === true
      && numeric.spatialSeparationObserved === true
      && numeric.parityExcitationWordsMatchedExactly === true,
    `${relativeRecord}: WS5 GPU numeric readback did not pass`);
    check(numeric.stress?.pass === true
      && numeric.stress?.maximumCpuVsGpuAbsoluteError <= numeric.stress?.tolerance
      && numeric.recovery?.pass === true
      && numeric.recovery?.maximumCpuVsGpuAbsoluteError <= numeric.recovery?.tolerance,
    `${relativeRecord}: WS5 CPU/GPU stress or recovery recurrence failed`);
    check(runEvidence.restoration?.retroarchTestProcessStopped === true
      && runEvidence.restoration?.globalRetroArchConfigurationModified === false,
    `${relativeRecord}: target restoration contract did not pass`);
    check(/^[0-9a-f]{64}$/.test(runEvidence.restoration?.gbaOverrideBeforeAfterSha256 ?? "")
      && /^[0-9a-f]{64}$/.test(runEvidence.restoration?.mgbaOverrideBeforeAfterSha256 ?? ""),
    `${relativeRecord}: override restoration hashes are missing`);
  }
}

const temporalConfigPath = path.join(targetDir, "retroarch", "ags101-temporal.cfg");
check(fs.existsSync(temporalConfigPath), "KPA AGS temporal frontend config is missing");
if (fs.existsSync(temporalConfigPath)) {
  const temporalConfig = fs.readFileSync(temporalConfigPath, "utf8");
  for (const required of [
    'video_driver = "vulkan"',
    'video_shader_subframes = "1"',
    'video_scale_integer = "true"',
    'rewind_enable = "false"',
    'run_ahead_enabled = "false"',
    'fastforward_ratio = "1.000000"',
  ]) {
    check(temporalConfig.includes(required),
      `KPA AGS temporal frontend config lost ${required}`);
  }
}

const targetPreset = path.join(
  root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "presets",
  "ags101-period-reconstruction-v1.slangp",
);
check(fs.existsSync(targetPreset), "missing KPA AGS target preset");
if (fs.existsSync(targetPreset)) {
  const source = fs.readFileSync(targetPreset, "utf8");
  check(source.includes("Generated by tools/build-ags101-ws1.mjs"),
    "KPA AGS target preset is not the generated full-preset compatibility form");
  check(!source.includes("#reference"),
    "KPA AGS target preset still depends on a referenced model preset");
  check(source.includes('../../../../models/nintendo-ags-101/shaders/ags101-response-v1.slang')
    && source.includes('../../../../models/nintendo-ags-101/shaders/ags101-exposure-v1.slang')
    && source.includes('../../../../models/nintendo-ags-101/shaders/ags101-display-v1.slang'),
  "KPA AGS target full preset lost its three model shader paths");
  check(source.includes('../../../../models/nintendo-ags-101/generated/ws4-gtg-nominal-v1.png'),
    "KPA AGS target full preset lost its WS4 nominal GtG path");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `AGS-101 period-reconstruction checks passed (${shaderFiles.length} shaders, ${presetFiles.length} presets; `
  + `WS4 nominal brightening/darkening `
  + `${ws4Ensemble.members.find((member) => member.id === "nominal").opticalBrighteningEndpointT10To90Ms.toFixed(1)}/`
  + `${ws4Ensemble.members.find((member) => member.id === "nominal").opticalDarkeningEndpointT10To90Ms.toFixed(1)} ms; `
  + `analytic fallback ${endpointBrightening.toFixed(1)}/${endpointDarkening.toFixed(1)} ms).`,
);
