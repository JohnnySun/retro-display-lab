#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  LITERATURE_CELL_PRIOR,
  PANEL_FPS,
  PANEL_FRAME_SECONDS,
  effectiveDriveCode,
  framePolarity,
  stepResidualDc,
} from "../models/nintendo-ags-101/reference/drive-retention.mjs";
import {
  GBA_CYCLES_PER_LINE,
  GBA_FRAME_HZ,
  GBA_FRAME_SECONDS,
  GBA_LINE_SECONDS,
  GBA_MASTER_CLOCK_HZ,
  GBA_TOTAL_LINES,
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
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
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
  "AGS-FRONTEND-01",
  "AGS-PANEL-01",
  "AGS-APERTURE-01",
  "AGS-NEUTRAL-01",
  "AGS-TIMING-01",
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
check(shaderFiles.length === 2, `expected 2 AGS shaders, found ${shaderFiles.length}`);
check(includeFiles.length === 1, `expected 1 AGS shader include, found ${includeFiles.length}`);
check(presetFiles.length === 12, `expected 12 AGS presets, found ${presetFiles.length}`);

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
check(responseSource.includes("encode_residual_dc"), "AGS response lost residual-DC state");
check(responseSource.includes("drive_polarity(global.FrameCount)"),
  "AGS response lost explicit frame polarity");
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
check(!responseSource.includes("nearest_rgb555_code"),
  "AGS response restored repeated nearest-code GtG quantization");
check(responseSource.includes("OriginalHistory1"), "AGS scanout lost previous source frame");
check(responseSource.includes("OriginalHistory2"), "AGS scanout lost causal cross-frame source history");
check(responseSource.includes("GBA_TOTAL_LINES = 228.0"), "AGS scanout lost 228-line timebase");
check(responseSource.includes("GBA_MASTER_CLOCK_HZ = 16777216.0"),
  "AGS scanout lost exact GBA master clock");
check(responseSource.includes("GBA_CYCLES_PER_LINE = 1232.0"),
  "AGS scanout lost exact GBA line cycle count");
check(responseSource.includes("sourceCoord.y"), "AGS scanout phase is not source-row based");
check(responseSource.includes("LatchOffsetLines"), "AGS scanout lost explicit latch event");
check(responseSource.includes("OpticalDelaySeconds"), "AGS scanout lost explicit optical event");
check(responseSource.includes("scan_event"), "AGS scanout lost three-component event calculation");
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

const displaySource = fs.readFileSync(path.join(shaderDir, "ags101-display-v1.slang"), "utf8");
check(displaySource.includes("integrate_aperture"), "AGS display lost analytic aperture integration");
check(displaySource.includes("leftMask.bgr"), "AGS display lost BGR ordering");
check(displaySource.includes("srgb_encode_channel"), "AGS display lost neutral host encoding");
check(displaySource.includes("HCS_NATIVE_RGB_TO_XYZ"), "AGS display lost generated HCS matrix");
check(displaySource.includes("hcs_native_to_host_linear"), "AGS display lost HCS output transform");
check(displaySource.includes("HcsImproveContrast"), "AGS display lost measured-black control");
check(displaySource.includes("HcsChromaticAdaptation"), "AGS display lost HCS white adaptation control");
check(displaySource.includes("DebugView"), "AGS display lost unified diagnostic selector");
check(displaySource.includes("uniform sampler2D Original"),
  "AGS display diagnostics lost original source access");
check(displaySource.includes("gtg_table_available"),
  "AGS display diagnostics lost GtG table/fallback status");
check(displaySource.includes("scan_diagnostic"),
  "AGS display diagnostics lost row/latch/optical overlay");
check(displaySource.includes("drive_diagnostic"),
  "AGS display diagnostics lost separated electrical views");
check(displaySource.includes("panel_without_aperture")
  && displaySource.includes("panel_with_aperture")
  && displaySource.includes("ApertureEnabled"),
"AGS display lost aperture isolation/comparison path");
check(displaySource.includes("global.FrameCount & 1u"),
  "AGS drive diagnostic lost frame-polarity view");
check(!displaySource.includes("DebugIonState"),
  "AGS display retained the superseded one-purpose debug selector");
check(!responseSource.includes("DebugView"),
  "AGS read-only diagnostic selector leaked into the feedback-writing pass");

const physicsPresetSource = fs.readFileSync(path.join(presetDir, "physics-seed-v1.slangp"), "utf8");
const neutralPresetSource = fs.readFileSync(path.join(presetDir, "neutral-baseline-v1.slangp"), "utf8");
const gtgSyntheticPresetSource = fs.readFileSync(
  path.join(presetDir, "gtg-synthetic-table-v1.slangp"), "utf8",
);
check(physicsPresetSource.includes('HcsMeasuredColor = "1.0"'),
  "AGS default physics preset does not enable HCS measured color");
check(physicsPresetSource.includes('HcsImproveContrast = "1.0"'),
  "AGS default physics preset does not select HCS black-subtracted mode");
check(physicsPresetSource.includes('GtgTableBackend = "0.0"'),
  "AGS default preset must not label the synthetic table as measured runtime data");
check(physicsPresetSource.includes('GtgRateLut = "../generated/gtg-synthetic-v1.png"'),
  "AGS default preset lost deterministic GtG runtime texture binding");
check(!physicsPresetSource.includes("float_framebuffer0"),
  "AGS default preset overrides the response shader's required RGBA32F format");
check(gtgSyntheticPresetSource.includes('GtgTableBackend = "1.0"'),
  "AGS synthetic GtG pipeline preset does not enable the table backend");
check(physicsPresetSource.includes('TemporalResponse = "1.0"')
  && physicsPresetSource.includes('DriveRetention = "1.0"')
  && physicsPresetSource.includes('ApertureEnabled = "1.0"')
  && physicsPresetSource.includes('DebugView = "0.0"'),
"AGS default preset lost normal mechanism/diagnostic switches");
for (const [parameter, expected] of [
  ["DriveDcOffset", "0.100"],
  ["IonAdsorptionRate", "0.0010583333"],
  ["IonDesorptionRate", "0.0004250000"],
  ["DriveCodeCoupling", "0.150"],
]) {
  check(physicsPresetSource.includes(`${parameter} = "${expected}"`),
    `AGS default preset lost theoretical reconstruction ${parameter}=${expected}`);
}
for (const legacyParameter of ["IonChargeTau", "IonReleaseTau", "IonOpticalGain", "IonStrength"]) {
  check(!physicsPresetSource.includes(legacyParameter),
    `AGS default preset retains legacy luma-ION parameter ${legacyParameter}`);
}
check(neutralPresetSource.includes('HcsMeasuredColor = "0.0"'),
  "AGS neutral regression preset does not disable HCS measured color");
check(physicsPresetSource.includes('BakedScanout = "1.0"'),
  "AGS default physics preset does not enable three-phase scan timing");
check(physicsPresetSource.includes('LatchOffsetLines = "0.5"'),
  "AGS scanout default lost theoretical line-center latch");
check(physicsPresetSource.includes('OpticalDelaySeconds = "0.000000"'),
  "AGS scanout default lost zero pure optical-delay prior");
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

check(frontendValidationSchema.$schema === "https://json-schema.org/draft/2020-12/schema",
  "AGS frontend validation schema lost its JSON Schema dialect");
check(frontendValidationSchema.properties?.schemaVersion?.const === 1,
  "AGS frontend validation schema version changed without migration");
for (const required of [
  "classification", "runId", "date", "modelId", "targetProfile",
  "frontend", "artifacts", "checks", "captures",
]) {
  check(frontendValidationSchema.required?.includes(required),
    `AGS frontend validation schema no longer requires ${required}`);
}
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
function checkFrontendRecord(record, label, allowTemplate = false) {
  check(record.schemaVersion === 1, `${label}: wrong schema version`);
  check(record.modelId === metadata.id, `${label}: wrong model ID`);
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

check(hcsSource.source.commit === "e688fc51141c0974728aa1bdcb89b94d74123f6b",
  "AGS HCS normalized record lost pinned source commit");
check(hcsSource.grayscale.length === 32, "AGS HCS normalized record lost 32-code gray ramp");
check(hcsColor.source.evidenceId === "AGS-COLOR-01", "AGS HCS artifact lost evidence ID");
check(hcsColor.eotfRgb555Runtime.length === 32, "AGS HCS artifact lost 32-code EOTF");
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
check(firstVisibleLatchMs > 0.03 && firstVisibleLatchMs < 0.04,
  `AGS first-row latch phase drifted: ${firstVisibleLatchMs} ms`);
check(lastVisibleLatchMs > 11.70 && lastVisibleLatchMs < 11.72,
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
const agsTarget = targetProfile.additionalContent?.["Nintendo GBA SP AGS-101 physics seed"];
check(Boolean(agsTarget), "KPA profile lost AGS-101 target geometry");
check(agsTarget?.contentViewport?.join("x") === "960x640", "KPA AGS viewport is not 960x640");
check(agsTarget?.integerScale === 4, "KPA AGS target lost exact 4x scale");

const targetDir = path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral");
const validationRecords = targetProfile.validationRecords ?? [];
check(validationRecords.length > 0, "KPA profile has no AGS frontend validation record");
for (const relativeRecord of validationRecords) {
  const recordPath = path.resolve(targetDir, relativeRecord);
  check(recordPath.startsWith(`${targetDir}${path.sep}`),
    `KPA validation record escapes target directory: ${relativeRecord}`);
  check(fs.existsSync(recordPath), `KPA validation record is missing: ${relativeRecord}`);
  if (!fs.existsSync(recordPath)) continue;
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  checkFrontendRecord(record, relativeRecord);
  check(record.targetProfile === targetProfile.id,
    `${relativeRecord}: target profile ID does not match profile.json`);
  for (const [relativeArtifact, expectedHash] of Object.entries(record.artifacts ?? {})) {
    const artifactPath = path.resolve(root, relativeArtifact);
    check(artifactPath.startsWith(`${root}${path.sep}`),
      `${relativeRecord}: artifact escapes repository: ${relativeArtifact}`);
    check(fs.existsSync(artifactPath),
      `${relativeRecord}: artifact is missing: ${relativeArtifact}`);
    if (!fs.existsSync(artifactPath)) continue;
    const actualHash = createHash("sha256")
      .update(fs.readFileSync(artifactPath))
      .digest("hex");
    check(actualHash === expectedHash,
      `${relativeRecord}: artifact hash drifted for ${relativeArtifact}`);
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
  root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "presets", "ags101-physics-seed-v1.slangp",
);
check(fs.existsSync(targetPreset), "missing KPA AGS target preset");
if (fs.existsSync(targetPreset)) {
  const source = fs.readFileSync(targetPreset, "utf8");
  const modelReference = source.match(/#reference\s+"([^"]+)"/);
  check(Boolean(modelReference), "KPA AGS target preset has no model reference");
  if (modelReference) {
    check(fs.existsSync(path.resolve(path.dirname(targetPreset), modelReference[1])), "KPA AGS target model reference is missing");
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `AGS-101 physics-seed checks passed (${shaderFiles.length} shaders, ${presetFiles.length} presets; `
  + `${endpointBrightening.toFixed(1)}/${endpointDarkening.toFixed(1)} ms endpoints).`,
);
