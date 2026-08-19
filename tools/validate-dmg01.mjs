#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const shaderDir = path.join(modelDir, "shaders");
const presetDir = path.join(modelDir, "presets");
const shaderFiles = fs.readdirSync(shaderDir).sort();
const presetFiles = fs.readdirSync(presetDir).sort();
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const requiredProjectFiles = [
  "README.md",
  "README.zh-tw.md",
  "README.zh-cn.md",
  "REFERENCES.md",
  "CITATION.cff",
  "docs/reference-policy.md",
  "models/nintendo-dmg-01/REFERENCES.md",
  "models/nintendo-dmg-01/IMPLEMENTATION-TODO.md",
  "models/nintendo-dmg-01/data/reconstruction-v1.json",
  "models/nintendo-dmg-01/data/stn-response-evidence-v1.json",
  "models/nintendo-dmg-01/data/dmg-drive-v1.json",
  "models/nintendo-dmg-01/data/dmg-scan-timing-v1.json",
  "models/nintendo-dmg-01/data/frontend-contract-v1.json",
  "models/nintendo-dmg-01/data/stn-material-ensemble-v1.json",
  "models/nintendo-dmg-01/data/stn-retention-evidence-v1.json",
  "models/nintendo-dmg-01/data/passive-matrix-crosstalk-evidence-v1.json",
  "models/nintendo-dmg-01/generated/ws1-static-v1.png",
  "models/nintendo-dmg-01/generated/ws1-perceptual-v1.json",
  "models/nintendo-dmg-01/generated/ws2-temporal-fit-v1.json",
  "models/nintendo-dmg-01/generated/ws2-stn-physics-v1.json",
  "models/nintendo-dmg-01/generated/ws3-scanout-v1.json",
  "models/nintendo-dmg-01/generated/ws4-retention-v1.json",
  "models/nintendo-dmg-01/generated/ws5-crosstalk-v1.json",
  "models/nintendo-dmg-01/generated/ws5-crosstalk-lumped-v2.json",
  "models/nintendo-dmg-01/generated/ws6-aperture-v1.json",
  "models/nintendo-dmg-01/generated/ws6-aperture-exact-4x.png",
  "models/nintendo-dmg-01/generated/ws6-aperture-exact-5x.png",
  "models/nintendo-dmg-01/generated/ws6-aperture-exact-6x.png",
  "models/nintendo-dmg-01/generated/ws6-aperture-fractional-3_5x.png",
  "models/nintendo-dmg-01/generated/ws6-aperture-fractional-4_25x.png",
  "models/nintendo-dmg-01/reference/optical-pipeline.mjs",
  "models/nintendo-dmg-01/reference/temporal-response.mjs",
  "models/nintendo-dmg-01/reference/stn-physics.mjs",
  "models/nintendo-dmg-01/reference/scanout-timing.mjs",
  "models/nintendo-dmg-01/reference/aperture-geometry.mjs",
  "models/nintendo-dmg-01/reference/ionic-retention.mjs",
  "models/nintendo-dmg-01/reference/passive-matrix-crosstalk.mjs",
  "models/nintendo-dmg-01/reference/passive-matrix-crosstalk-lumped.mjs",
  "models/nintendo-dmg-01/shaders/dmg01-stn-surrogate.inc",
  "models/nintendo-dmg-01/shaders/dmg01-crosstalk-surrogate.inc",
  "models/nintendo-dmg-01/shaders/dmg01-crosstalk-lumped.inc",
  "models/nintendo-dmg-01/shaders/dmg01-crosstalk-phase-local.inc",
  "models/nintendo-dmg-01/shaders/dmg01-crosstalk-summary-v3.slang",
  "models/nintendo-dmg-01/shaders/dmg01-row-load-v2.slang",
  "models/nintendo-ags-101/REFERENCES.md",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/REFERENCES.md",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws2-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws3-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws7-gpu-static-v1.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws7-gpu-static-v2.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws7-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws7-fixedpoint-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws6-scale-v1.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws6-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws4-gpu-retention-v1.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws4-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws5-gpu-crosstalk-v1.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws5-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/validation/dmg01-ws5-common-mode-20260819.json",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/retroarch/dmg01-temporal.cfg",
];
for (const file of requiredProjectFiles) {
  check(fs.existsSync(path.join(root, file)), `missing research/provenance file: ${file}`);
}

const modelReferences = fs.readFileSync(path.join(modelDir, "REFERENCES.md"), "utf8");
const definedEvidenceIds = new Set(
  [...modelReferences.matchAll(/^### (DMG-[A-Z]+-\d+)\b/gm)].map((match) => match[1]),
);
check(definedEvidenceIds.size >= 10, `DMG evidence map is incomplete: ${definedEvidenceIds.size} IDs`);

function referencedEvidenceIds(source) {
  return [...source.matchAll(/\[(DMG-[A-Z]+-\d+)\]/g)].map((match) => match[1]);
}

function checkEvidenceLinks(source, label) {
  check(source.includes("REFERENCES.md"), `${label}: missing REFERENCES.md pointer`);
  const ids = referencedEvidenceIds(source);
  check(ids.length > 0, `${label}: missing evidence ID`);
  for (const id of ids) {
    check(definedEvidenceIds.has(id), `${label}: undefined evidence ID ${id}`);
  }
}

for (const file of shaderFiles.filter((name) => name.endsWith(".slang"))) {
  const source = fs.readFileSync(path.join(shaderDir, file), "utf8");
  checkEvidenceLinks(source, file);
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

for (const file of presetFiles.filter((name) => name.endsWith(".slangp"))) {
  const source = fs.readFileSync(path.join(presetDir, file), "utf8");
  checkEvidenceLinks(source, file);
  const references = [
    ...[...source.matchAll(/shader\d+\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/#reference\s+"([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const target of references) {
    const localTarget = path.resolve(presetDir, target);
    check(fs.existsSync(localTarget), `${file}: missing reference ${target}`);
  }
}

const readmeFiles = [
  ["README.md", "English"],
  ["README.zh-tw.md", "繁體中文"],
  ["README.zh-cn.md", "简体中文"],
];
for (const [file, currentLanguage] of readmeFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  check(source.includes("English"), `${file}: missing English language label`);
  check(source.includes("繁體中文"), `${file}: missing zh-TW language label`);
  check(source.includes("简体中文"), `${file}: missing zh-CN language label`);
  check(source.includes(`**${currentLanguage}**`), `${file}: current language is not marked`);
  check(source.includes("archive/refs/tags/v0.4.0.zip"), `${file}: missing fixed-version download link`);
  check(source.includes("960x640-srgb-neutral/presets/dmg01-reference-v1.slangp"), `${file}: missing tested install path`);
  check(source.includes("models/nintendo-dmg-01/REFERENCES.md"), `${file}: missing DMG evidence-map link`);
  check(source.includes("models/nintendo-dmg-01/data/reconstruction-v1.json"), `${file}: missing DMG reconstruction-record link`);
  check(source.includes("models/nintendo-dmg-01/IMPLEMENTATION-TODO.md"), `${file}: missing DMG implementation to-do link`);
  check(source.includes("models/nintendo-ags-101/REFERENCES.md"), `${file}: missing AGS evidence-map link`);
}

const modelMetadata = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
check(modelMetadata.references === "REFERENCES.md", "model metadata lost reference map");
check(modelMetadata.implementationTodo === "IMPLEMENTATION-TODO.md", "model metadata lost implementation to-do");
check(modelMetadata.reconstructionData === "data/reconstruction-v1.json", "model metadata lost reconstruction record");
check(modelMetadata.physicalReconstructionStatus === "complete",
  "DMG metadata does not mark the validated physical reconstruction complete");
check(modelMetadata.causalScanoutStatus === "complete",
  "DMG metadata does not mark causal row scanout complete");
check(Array.isArray(modelMetadata.evidenceIds), "model metadata has no evidence IDs");
for (const id of modelMetadata.evidenceIds ?? []) {
  check(definedEvidenceIds.has(id), `model metadata contains undefined evidence ID ${id}`);
}

const reconstruction = JSON.parse(fs.readFileSync(
  path.join(modelDir, modelMetadata.reconstructionData),
  "utf8",
));
check(reconstruction.schemaVersion === 1, "unsupported DMG reconstruction schema");
check(
  reconstruction.reconstructionId === "nintendo-dmg-01-reference-v1",
  "unexpected DMG reconstruction record",
);
check(
  reconstruction.evidencePriority?.join("|") === [
    "DMG-specific documented observation",
    "contemporary measured STN data under comparable conditions",
    "general nematic mechanism",
    "bounded project bridge",
  ].join("|"),
  "DMG reconstruction evidence priority drifted",
);
check(
  reconstruction.optical?.classification === "reference-image-matched",
  "BGB optical calibration lost its evidence class",
);
check(
  reconstruction.optical?.aperture?.physicalMeasurement === false,
  "BGB idealized aperture must not be classified as a measurement",
);
check(
  reconstruction.optical?.ws1Acceptance?.status === "complete",
  "DMG WS1 must remain explicitly complete",
);
const ws1Report = JSON.parse(fs.readFileSync(
  path.join(modelDir, reconstruction.optical.ws1Acceptance.generatedReport),
  "utf8",
));
check(ws1Report.summary?.pass === true, "DMG WS1 perceptual report is not passing");
check(
  ws1Report.summary?.maximumGradientMidpointDeltaE00
    <= reconstruction.optical.ws1Acceptance.maximumGradientMidpointDeltaE00,
  "DMG WS1 gradient perceptual error exceeds its acceptance threshold",
);

const palette = reconstruction.optical.states.map((state) => state.srgb8);
check(palette.length === 5, "DMG reconstruction must contain five optical states");

const referencePreset = fs.readFileSync(
  path.join(presetDir, "reference-v1.slangp"),
  "utf8",
);
check(
  referencePreset.includes(`PixelFill = "${reconstruction.optical.aperture.pixelFill}"`),
  "reference preset lost the BGB idealized 70/80 aperture seed",
);
const displayShader = fs.readFileSync(
  path.join(shaderDir, "dmg01-display-v1.slang"),
  "utf8",
);
check(displayShader.includes("overlap / footprint"), "display pass lost host-pixel box coverage");
check(displayShader.includes("previous/current/next pitch"),
  "display pass lost periodic fractional-scale aperture coverage");
check(displayShader.includes("joint_aperture_axis"),
  "display pass lost exact active/shadow joint integration");
check(
  displayShader.includes('DMG BGB idealized aperture fill'),
  "display pass overstates the BGB aperture evidence",
);
const responseShader = fs.readFileSync(
  path.join(shaderDir, "dmg01-response-v1.slang"),
  "utf8",
);
check(
  responseShader.includes("#pragma format R32G32B32A32_SFLOAT"),
  "DMG persistent response pass must request RGBA32F",
);
check(
  !referencePreset.includes("float_framebuffer2"),
  "preset-level float_framebuffer2 can override the required RGBA32F response format",
);
check(responseShader.includes('#include "dmg01-stn-surrogate.inc"'),
  "DMG response pass lost the generated STN surrogate");
check(responseShader.includes('#include "dmg01-crosstalk-phase-local.inc"'),
  "DMG response pass lost the structure-preserving phase-local reduction");
check(!responseShader.includes('#include "dmg01-crosstalk-surrogate.inc"'),
  "DMG response pass still uses the image-fitted crosstalk kernel");
check(responseShader.includes("phase_local_drive_coordinates"),
  "DMG response pass lost the phase-local row/column RC reduction");
check(referencePreset.includes('shader0 = "../shaders/dmg01-row-load-v2.slang"'),
  "DMG preset lost the whole-row dwell-load prepass");
check(referencePreset.includes('shader1 = "../shaders/dmg01-crosstalk-summary-v3.slang"'),
  "DMG preset lost the per-column frame-statistics pass");
check(responseShader.includes("physical_drift"),
  "DMG response pass no longer integrates the physical director drift field");
check(responseShader.includes("OriginalHistory1"),
  "DMG causal scanout lost the previous source frame");
check(responseShader.includes("global.TotalSubFrames != 1u"),
  "DMG causal scanout lost its unsupported-subframe fail-safe");
check(responseShader.includes("float(sourceCoord.y)"),
  "DMG causal scanout phase is not based on the source row");
check(responseShader.includes("/ 154.0"),
  "DMG causal scanout lost the documented 154-line timebase");
check(responseShader.includes("LatchOffsetLines"),
  "DMG causal scanout lost its explicit CPL latch event");
check(responseShader.includes("BakedScanout"),
  "DMG causal scanout lost its temporal-only diagnostic path");
check(responseShader.includes("CurrentDriveCoherence")
  && responseShader.includes("max(displayed, coherentTarget)"),
"DMG target presentation path lost coherent current-drive preservation");
for (const legacyParameter of [
  "DarkenResponse", "ClearResponse", "SlowTail", "SlowRateScale", "GrayDrag", "DistanceDrag",
]) {
  check(!responseShader.includes(legacyParameter),
    `DMG response pass restored empirical parameter ${legacyParameter}`);
  check(!referencePreset.includes(`${legacyParameter} =`),
    `DMG normal preset restored empirical parameter ${legacyParameter}`);
}

const srgbDecode8 = (value) => {
  const encoded = value / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
};
const srgbEncode8 = (value) => Math.round(255 * (
  value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055
));
const bgbMidpoints = reconstruction.optical.gradient.sampledMidpointsSrgb8;
const midpointTolerance = reconstruction.optical.gradient.maximumAcceptedChannelError8bit;
for (let index = 0; index < palette.length - 1; index += 1) {
  const predicted = palette[index].map((value, channel) => srgbEncode8(
    0.5 * (srgbDecode8(value) + srgbDecode8(palette[index + 1][channel])),
  ));
  predicted.forEach((value, channel) => check(
    Math.abs(value - bgbMidpoints[index][channel]) <= midpointTolerance,
    `BGB gradient midpoint ${index} channel ${channel} no longer matches linear-light interpolation`,
  ));
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// The unpowered reflector is a separate yellow optical state; only the four
// electrically driven shades are expected to darken monotonically.
for (let i = 2; i < palette.length; i += 1) {
  check(luminance(palette[i]) < luminance(palette[i - 1]), `palette state ${i} is not darker`);
}

function presetNumber(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? Number(match[1]) : NaN;
}
const physicalModel = reconstruction.temporal.physicalModel;
const physicalReport = JSON.parse(fs.readFileSync(
  path.join(modelDir, physicalModel.generatedReport),
  "utf8",
));
check(reconstruction.temporal.ws2Acceptance?.status === "complete",
  "DMG WS2 physical reconstruction is not marked complete");
check(reconstruction.temporal.ws2Acceptance?.completedOn === "2026-08-19",
  "DMG WS2 completion date is missing");
check(physicalReport.validation?.pass === true,
  "DMG physical report is not passing");
check(physicalReport.validation?.staticFourShadeLuminanceMonotonic === true,
  "DMG physical four-shade reflected luminance is not monotonic");
check(physicalReport.validation?.zeroFieldEnergyDecreased === true,
  "DMG director solver failed zero-field relaxation");
check(physicalReport.validation?.maximumSampledEquilibriumEnergyIncreaseJPerSquareMeter === 0,
  "DMG director solver increased free energy at fixed drive");
check(physicalReport.validation?.timestepOpticalStateError < 0.002,
  "DMG director timestep convergence is out of tolerance");
check(physicalReport.validation?.gridOpticalStateError < 0.03,
  "DMG director grid convergence is out of tolerance");
check(physicalReport.validation?.maximumRuntimeSurrogateRmsError < 0.08,
  "DMG generated runtime surrogate exceeds its RMS error tolerance");
check(physicalReport.validation?.maximumRuntimeSurrogateError < 0.25,
  "DMG generated runtime surrogate exceeds its declared point-error tolerance");
check(physicalReport.validation?.maximumNominalFixedPointDrift < 1e-9,
  "DMG nominal director states are not fixed points of the runtime drift LUT");
check(physicalReport.validation?.maximumNominalAnchoredOpticalError < 1e-9,
  "DMG nominal director states do not reproduce the four intended optical shades");
check(physicalReport.validation?.maximumNominalSettledOpticalError < 1e-9,
  "DMG nominal four-shade states drift during a 600-frame constant-input hold");
check(physicalReport.validation?.maximumNominalAttractionError < 1e-9,
  "DMG nominal director fixed points do not attract nearby runtime states");
check(physicalReport.directorCoordinate?.nominalOpticalAnchorCoordinates?.length === 4
  && physicalReport.directorCoordinate?.nominalOpticalAnchorCorrections?.length === 4,
"DMG physical report lost the four optical fixed-point anchors");
check(physicalReport.drive?.selectionRatioAt144Rows > 1.08
  && physicalReport.drive?.selectionRatioAt144Rows < 1.09,
"DMG 1/144 Alt-Pleshko selection ratio is invalid");
check(physicalReport.solver?.directorDynamics.includes("Frank-Oseen/Ericksen-Leslie"),
  "DMG physical report lost its director model declaration");
check(physicalReport.solver?.opticalReduction.includes("Jones"),
  "DMG physical report lost its reflected spectral model declaration");
check(physicalReport.runtimeContrastConditions?.length === 3,
  "DMG physical report lost contrast-envelope conditions");
check(physicalReport.materialEnvelope?.length === 3,
  "DMG physical report lost material-envelope members");
for (const condition of physicalReport.runtimeContrastConditions ?? []) {
  check(condition.driftDeltaPerReferenceFrame?.length === 4 * 65,
    `DMG contrast ${condition.contrastScale} has an incomplete director drift LUT`);
  check(condition.transitions?.length === 16,
    `DMG contrast ${condition.contrastScale} has an incomplete transition matrix`);
}
const nominalPhysical = physicalReport.runtimeContrastConditions.find(
  (condition) => condition.contrastScale === 1,
);
const nominalDarkStep = nominalPhysical?.transitions.find(
  (transition) => transition.fromIndex === 0 && transition.toIndex === 3,
);
check(nominalDarkStep?.t90Seconds > 0.08 && nominalDarkStep?.t90Seconds < 0.8,
  "DMG physical endpoint response escaped the period-STN validation envelope");

check(Math.abs(presetNumber(referencePreset, "DriveContrast") - 1) < 1e-12,
  "DMG normal preset drive contrast is not nominal");
check(Math.abs(presetNumber(referencePreset, "PanelTemperatureCelsius") - 20) < 1e-12,
  "DMG normal preset temperature is not the 20 C literature condition");
check(presetNumber(referencePreset, "BakedScanout") === 1,
  "DMG normal preset does not enable causal CPL scanout");
check(presetNumber(referencePreset, "CurrentDriveCoherence") === 0,
  "DMG physical reference preset unexpectedly enables the presentation hybrid");
check(presetNumber(referencePreset, "LatchOffsetLines") === 1,
  "DMG normal preset lost the captured CPL line-end phase");
check(presetNumber(referencePreset, "RowCrosstalk") === 1
  && presetNumber(referencePreset, "ColumnCrosstalk") === 1,
"DMG normal preset lost the calculated nominal spatial-loading surrogate");
check(reconstruction.spatial?.ws5Acceptance?.status === "complete",
  "DMG WS5 passive-matrix crosstalk acceptance is not complete");
const crosstalkReport = JSON.parse(fs.readFileSync(
  path.join(modelDir, reconstruction.spatial.crosstalkModel.generatedReport),
  "utf8",
));
check(crosstalkReport.pass === true, "DMG WS5 structure-preserving report is not passing");
check(crosstalkReport.ensembles?.length === 3,
  "DMG WS5 lost its low/nominal/high electrical ensemble");
check(crosstalkReport.ensembles?.every((item) => item.patterns?.length === 9),
  "DMG WS5 canonical pattern suite is incomplete");
check(crosstalkReport.classification?.includes("no image-pattern fit")
  && crosstalkReport.checks?.noImagePatternCoefficients === true,
"DMG WS5 runtime is no longer a no-fit structure-preserving reduction");
check(crosstalkReport.selectedRuntimeModel?.rmsNormalizedDriveError < 0.05
  && crosstalkReport.selectedRuntimeModel?.p99AbsoluteNormalizedDriveError < 0.10
  && crosstalkReport.selectedRuntimeModel?.maximumAbsoluteNormalizedDriveError < 0.03,
"DMG WS5 common-electrode reduction escaped its nominal error bounds");
check(crosstalkReport.checks?.closedFormMatchesLumpedSolver === true
  && crosstalkReport.checks?.float32RuntimePrecisionBelow0_001Shade === true
  && crosstalkReport.checks?.nominalPhaseBoundaryResidualBelow0_001Shade === true,
"DMG WS5 runtime recurrence, float32, or phase-boundary gate failed");

const ionicParameters = reconstruction.temporal.ionicModel.referenceParameters;
for (const [name, expected] of Object.entries(ionicParameters)) {
  check(
    Math.abs(presetNumber(referencePreset, name) - expected) < 1e-12,
    `reference preset ${name} drifted from the reconstruction record`,
  );
}
const ws2Report = JSON.parse(fs.readFileSync(
  path.join(modelDir, reconstruction.temporal.generatedFitReport),
  "utf8",
));
const nominalReport = ws2Report.candidates.find((candidate) => candidate.id === "nominal");
check(ws2Report.selection?.referencePresetCandidate === "nominal", "WS2 report lost nominal selection");
check(ws2Report.selection?.fastAndSlowCandidatesAreDmgRevisionClaims === false,
  "WS2 report overclaims fast/slow candidates as DMG revisions");
check(ws2Report.selection?.ws2CompletionArtifact === false,
  "interim timing envelope is incorrectly classified as WS2 completion evidence");
check(nominalReport?.validation?.pass === true, "WS2 nominal temporal fit is not passing");
check(reconstruction.temporal.ws2Acceptance?.completionStandard?.includes(
  "waveform -> pixel voltage -> STN director dynamics -> reflected spectral response"),
"DMG WS2 lost its physical-reconstruction completion standard");
check(reconstruction.temporal.ws2Acceptance?.requiredArtifacts?.length >= 6,
  "DMG WS2 physical-reconstruction artifact gate is incomplete");
check(reconstruction.frontend?.targetRuntimeVerification?.status === "complete",
  "DMG physical response lost target-runtime verification");

const scanoutTiming = JSON.parse(fs.readFileSync(
  path.join(modelDir, reconstruction.scanout.timingRecord),
  "utf8",
));
const scanoutReport = JSON.parse(fs.readFileSync(
  path.join(modelDir, reconstruction.scanout.generatedReport),
  "utf8",
));
check(reconstruction.scanout.ws3Acceptance?.status === "complete",
  "DMG WS3 acceptance is not complete");
check(scanoutTiming.frame?.visibleRows === 144
  && scanoutTiming.frame?.blankRows === 10
  && scanoutTiming.frame?.totalRows === 154,
"DMG scan timing lost the documented 144+10 line structure");
check(scanoutTiming.runtimeModel?.normalLatchOffsetLines === 1,
  "DMG scan timing lost the captured CPL line-end latch");
check(scanoutReport.validation?.pass === true,
  "DMG WS3 CPU scanout report is not passing");
check(scanoutReport.validation?.unchangedEqualsTemporalOnly === true,
  "DMG WS3 row split changed an unchanged pixel");
check(scanoutReport.validation?.topReceivesMoreCurrentDriveThanMiddle === true
  && scanoutReport.validation?.middleReceivesMoreCurrentDriveThanBottom === true,
"DMG WS3 causal top-to-bottom ordering failed");
check(scanoutReport.validation?.sameRowDeeperDriveAdvancesFurther === true,
  "DMG WS3 same-row transition ordering failed");
check(scanoutReport.validation?.crossFrameContinuesTowardCurrentTarget === true,
  "DMG WS3 cross-frame continuation failed");
check(scanoutReport.validation?.constantFrameIndependentOfRowLatch === true,
  "DMG WS3 row timing changed a constant frame");
const temporalOnlyPreset = fs.readFileSync(
  path.join(presetDir, "scanout-temporal-only-v1.slangp"),
  "utf8",
);
check(temporalOnlyPreset.includes('BakedScanout = "0.0"'),
  "DMG WS3 temporal-only diagnostic does not disable row splitting");
for (const candidate of ws2Report.candidates ?? []) {
  check(candidate.validation?.maximumFramePartitionError <= 1e-12,
    `${candidate.id}: frame-partition equivalence failed`);
}

function stickingVolts(mobility) {
  return Math.max(7.390426 * mobility - 0.186987, 0);
}

const paperRows = [
  [0.0406, 0.140], [0.0661, 0.280], [0.0653, 0.320], [0.0682, 0.414],
  [0.0565, 0.204], [0.0569, 0.184], [0.0524, 0.118], [0.0452, 0.104],
  [0.0446, 0.192], [0.0352, 0.032], [0.0293, 0.096],
];
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanX = mean(paperRows.map(([x]) => x));
const meanY = mean(paperRows.map(([, y]) => y));
const covariance = paperRows.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
const varianceX = paperRows.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
const varianceY = paperRows.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
const fittedSlope = covariance / varianceX;
const fittedIntercept = meanY - fittedSlope * meanX;
const fittedR2 = covariance ** 2 / (varianceX * varianceY);
check(Math.abs(fittedSlope - 7.390426) < 0.001, `1994 STN regression slope drifted: ${fittedSlope}`);
check(Math.abs(fittedIntercept + 0.186987) < 0.001, `1994 STN regression intercept drifted: ${fittedIntercept}`);
check(fittedR2 >= 0.74 && fittedR2 <= 0.76, `1994 STN regression R^2 drifted: ${fittedR2}`);

const referenceResponse = {
  ionicMobility: ionicParameters.IonicMobility,
  stickingOpticalGain: ionicParameters.StickingOpticalGain,
  ionicChargeResponse: ionicParameters.IonicChargeResponse,
  ionicReleaseResponse: ionicParameters.IonicReleaseResponse,
};
const fps = 59.7275;
const exposureFrames = Math.round(30 * 60 * fps);
const chargedAfter30Minutes = 1 - (1 - referenceResponse.ionicChargeResponse) ** exposureFrames;
check(chargedAfter30Minutes >= 0.995, `30-minute STN exposure did not saturate: ${chargedAfter30Minutes}`);

const fullIonicBias = stickingVolts(referenceResponse.ionicMobility)
  * referenceResponse.stickingOpticalGain;
check(fullIonicBias > 0 && fullIonicBias < 0.03,
  `reference ionic optical bridge is unbounded: ${fullIonicBias}`);
const remainingAfterTenSeconds = chargedAfter30Minutes
  * (1 - referenceResponse.ionicReleaseResponse) ** 600;
check(remainingAfterTenSeconds > 0.8,
  "DMG ionic retention no longer remains distinct from director relaxation");

const targetProfile = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "profile.json"),
  "utf8",
));
check(targetProfile.panelResolution.join("x") === "960x640", "KPA target resolution drifted");
check(targetProfile.contentViewport.join("x") === "640x576", "KPA DMG viewport drifted");
check(targetProfile.integerScale === 4, "KPA target lost exact 4x DMG scale");
check(targetProfile.colorState.measured === false, "unmeasured target must not claim calibration");
check(targetProfile.references === "REFERENCES.md", "target profile lost reference map");
check(targetProfile.validationRecords.includes("validation/dmg01-ws2-20260819.json"),
  "KPA target profile lost the DMG WS2 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws3-20260819.json"),
  "KPA target profile lost the DMG WS3 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws7-20260819.json"),
  "KPA target profile lost the DMG WS7 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws7-fixedpoint-20260819.json"),
  "KPA target profile lost the post-correction DMG WS7 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws6-20260819.json"),
  "KPA target profile lost the DMG WS6 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws4-20260819.json"),
  "KPA target profile lost the DMG WS4 validation receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws5-common-mode-20260819.json"),
  "KPA target profile lost the current DMG WS5 common-mode receipt");
check(targetProfile.validationRecords.includes("validation/dmg01-ws5-20260819.json"),
  "KPA target profile lost the DMG WS5 validation receipt");
const dmgWs2Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws2-20260819.json"),
  "utf8",
));
check(dmgWs2Receipt.modelId === "nintendo-dmg-01",
  "KPA DMG WS2 receipt has the wrong model ID");
check(dmgWs2Receipt.targetProfile === targetProfile.id,
  "KPA DMG WS2 receipt has the wrong target profile ID");
check(dmgWs2Receipt.ws2CompletionEvidence === true,
  "physical KPA runtime receipt is not classified as WS2 completion evidence");
check(dmgWs2Receipt.result === "pass", "KPA DMG WS2 runtime receipt is not passing");
check(dmgWs2Receipt.vulkan?.passFormats?.[0] === "R32G32B32A32_SFLOAT",
  "KPA DMG WS2 receipt lost response RGBA32F allocation");
check(dmgWs2Receipt.vulkan?.responseFeedbackConfirmed === true,
  "KPA DMG WS2 receipt lost feedback confirmation");
check(dmgWs2Receipt.physicalRun?.compiled === true
  && dmgWs2Receipt.physicalRun?.runtimeProcessStayedAlive === true
  && dmgWs2Receipt.physicalRun?.generatedIncludeCompiled === true,
"KPA DMG WS2 physical run is incomplete");
// Later workstreams intentionally evolve runtime shaders, presets, and reports.
// Keep the WS2 receipt's historical hashes without requiring those mutable
// paths to remain byte-identical forever; immutable physical inputs still gate
// the completed reconstruction.
const immutableWs2Inputs = new Set([
  "driveModel", "materialEnsemble", "normalizedEvidence",
]);
for (const [name, input] of Object.entries(dmgWs2Receipt.inputs ?? {})) {
  if (!immutableWs2Inputs.has(name)) continue;
  if (!input.path || !input.sha256 || !fs.existsSync(path.join(root, input.path))) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS2 receipt hash drifted for ${input.path}`);
}
check(dmgWs2Receipt.restoration?.userGambatteShaderBeforeSha256
  === dmgWs2Receipt.restoration?.userGambatteShaderAfterSha256,
  "KPA DMG WS2 receipt does not prove Gambatte override restoration");
const dmgWs3Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws3-20260819.json"),
  "utf8",
));
check(dmgWs3Receipt.modelId === "nintendo-dmg-01",
  "KPA DMG WS3 receipt has the wrong model ID");
check(dmgWs3Receipt.targetProfile === targetProfile.id,
  "KPA DMG WS3 receipt has the wrong target profile ID");
check(dmgWs3Receipt.ws3CompletionEvidence === true && dmgWs3Receipt.result === "pass",
  "KPA DMG WS3 runtime receipt is not passing completion evidence");
check(dmgWs3Receipt.cpuAcceptance?.result === "pass",
  "KPA DMG WS3 receipt lost CPU acceptance");
check(dmgWs3Receipt.causalRun?.loadedParameters?.BakedScanout === 1
  && dmgWs3Receipt.temporalOnlyRun?.loadedParameters?.BakedScanout === 0,
  "KPA DMG WS3 receipt lost causal/temporal-only branch coverage");
check(dmgWs3Receipt.visualCausalEvidence?.yAverage?.top
  < dmgWs3Receipt.visualCausalEvidence?.yAverage?.middle
  && dmgWs3Receipt.visualCausalEvidence?.yAverage?.middle
  < dmgWs3Receipt.visualCausalEvidence?.yAverage?.bottom,
"KPA DMG WS3 receipt lost presented top-to-bottom row phase");
// The capture remains evidence for CPL phase and the Shader branch exercised on
// the device. A later WS2 LUT regeneration legitimately changes the CPU probe's
// exact coordinates, so only the immutable captured timing record is required
// to retain the historical receipt hash. The current generated report is gated
// independently above.
for (const name of ["timingRecord"]) {
  const input = dmgWs3Receipt.inputs?.[name];
  if (!input?.path || !input?.sha256 || !fs.existsSync(path.join(root, input.path))) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS3 receipt hash drifted for ${input.path}`);
}
const frontendContract = JSON.parse(fs.readFileSync(
  path.join(modelDir, "data", "frontend-contract-v1.json"),
  "utf8",
));
check(frontendContract.frontend?.shaderSubframes === 1,
  "DMG frontend contract lost the N=1 physical-time path");
check(frontendContract.source?.requiredCoreOptions?.gambatte_mix_frames === "disabled",
  "DMG frontend contract permits duplicate Gambatte frame mixing");
check(frontendContract.frontend?.rewindEnabled === false
  && frontendContract.frontend?.runAheadEnabled === false,
"DMG frontend contract no longer excludes non-monotonic history");
check(frontendContract.safety?.shaderSubframes?.includes("bypasses temporal integration"),
  "DMG frontend contract lost the unsupported-subframe bypass");
const dmgWs7GpuReport = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws7-gpu-static-v1.json"),
  "utf8",
));
check(dmgWs7GpuReport.pass === true && dmgWs7GpuReport.maximumChannelError <= 6,
  "KPA DMG WS7 numeric GPU comparison is not passing");
const dmgWs7Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws7-20260819.json"),
  "utf8",
));
check(dmgWs7Receipt.modelId === "nintendo-dmg-01"
  && dmgWs7Receipt.targetProfile === targetProfile.id,
"KPA DMG WS7 receipt identity is invalid");
check(dmgWs7Receipt.ws7CompletionEvidence === true && dmgWs7Receipt.result === "pass",
  "KPA DMG WS7 receipt is not passing completion evidence");
check(dmgWs7Receipt.precision?.result === "pass"
  && dmgWs7Receipt.precision?.maxRgb565ChannelError <= dmgWs7Receipt.precision?.tolerance,
"KPA DMG WS7 precision comparison failed");
check(dmgWs7Receipt.framePacing?.samples?.length === 3
  && dmgWs7Receipt.framePacing.samples.every((sample) => sample.fps >= 59
    && sample.fps <= 61 && sample.doubleIntervals === 0),
"KPA DMG WS7 frame pacing escaped its 59-61 fps gate");
check(dmgWs7Receipt.lifecycle?.pauseResume?.passed === true
  && dmgWs7Receipt.lifecycle.pauseResume.stateSha256BeforeWait
    === dmgWs7Receipt.lifecycle.pauseResume.stateSha256AfterThreeSeconds,
"KPA DMG WS7 pause did not freeze core state");
check(dmgWs7Receipt.lifecycle?.focusLossResume?.passed === true
  && dmgWs7Receipt.lifecycle?.cleanContentClose?.passed === true
  && dmgWs7Receipt.lifecycle?.result === "pass",
"KPA DMG WS7 lifecycle acceptance is incomplete");
// The response pass moved from feedback 0 to feedback 2 when WS5 gained two
// structure-preserving prepasses. The current contract is checked directly
// above and by the current WS5 receipt; retain immutable WS7 run artifacts.
for (const name of ["temporalConfig", "numericGpuReport"]) {
  const input = dmgWs7Receipt.inputs?.[name];
  if (!input?.path || !input?.sha256) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS7 receipt hash drifted for ${input.path}`);
}
const dmgWs7FixedPointGpuReport = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws7-gpu-static-v2.json"),
  "utf8",
));
check(dmgWs7FixedPointGpuReport.reportId === "nintendo-dmg-01-ws7-gpu-static-v2"
  && dmgWs7FixedPointGpuReport.pass === true
  && dmgWs7FixedPointGpuReport.maximumChannelError <= 6,
"KPA DMG post-correction numeric GPU comparison is not passing");
check(dmgWs7FixedPointGpuReport.samples?.map((sample) => sample.expectedOpticalState).join(",")
  === "0.25,0.5,0.75,1",
"KPA DMG post-correction numeric GPU report lost the calibrated optical anchors");
const dmgWs7FixedPointReceipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws7-fixedpoint-20260819.json"),
  "utf8",
));
check(dmgWs7FixedPointReceipt.modelId === "nintendo-dmg-01"
  && dmgWs7FixedPointReceipt.targetProfile === targetProfile.id
  && dmgWs7FixedPointReceipt.ws7FollowupEvidence === true
  && dmgWs7FixedPointReceipt.result === "pass",
"KPA DMG post-correction receipt identity or result is invalid");
check(dmgWs7FixedPointReceipt.frontend?.shaderSubframes === 1
  && dmgWs7FixedPointReceipt.frontend?.gambatteMixFrames === "disabled"
  && dmgWs7FixedPointReceipt.frontend?.responseFormat === "R32G32B32A32_SFLOAT"
  && dmgWs7FixedPointReceipt.frontend?.responseFeedbackConfirmed === true,
"KPA DMG post-correction receipt lost the normal temporal runtime contract");
check(dmgWs7FixedPointReceipt.numericSteadyState?.result === "pass"
  && dmgWs7FixedPointReceipt.numericSteadyState?.earlyCaptureSha256
    === dmgWs7FixedPointReceipt.numericSteadyState?.lateCaptureSha256
  && dmgWs7FixedPointReceipt.numericSteadyState?.maximumChannelError
    <= dmgWs7FixedPointReceipt.numericSteadyState?.tolerance8Bit,
"KPA DMG post-correction fixed-point hold is not passing");
check(dmgWs7FixedPointReceipt.tetrisMotion?.result === "pass"
  && dmgWs7FixedPointReceipt.tetrisMotion?.frames >= 590
  && dmgWs7FixedPointReceipt.tetrisMotion?.averageFps >= 59
  && dmgWs7FixedPointReceipt.tetrisMotion?.averageFps <= 61,
"KPA DMG post-correction Tetris motion run escaped its runtime gate");
const currentFixedPointArtifacts = [
  ...Object.values(dmgWs7FixedPointReceipt.deployment?.runtimeFiles ?? {}).filter(
    (input) => input?.path !== "models/nintendo-dmg-01/shaders/dmg01-response-v1.slang",
  ),
  dmgWs7FixedPointReceipt.numericSteadyState?.report,
  dmgWs7FixedPointReceipt.numericSteadyState?.analyzer,
];
for (const input of currentFixedPointArtifacts) {
  if (!input?.path || !input?.sha256) continue;
  const actual = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256,
    `KPA DMG post-correction artifact hash drifted for ${input.path}`);
}
const dmgTemporalConfig = fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "retroarch", "dmg01-temporal.cfg"),
  "utf8",
);
for (const required of [
  'video_shader_subframes = "1"',
  'run_ahead_enabled = "false"',
  'rewind_enable = "false"',
  'fastforward_ratio = "1.000000"',
]) {
  check(dmgTemporalConfig.includes(required), `KPA DMG temporal config lost ${required}`);
}
check(displayShader.includes("DebugView >= 3.5"),
  "DMG display Shader lost the WS7 raw optical-state diagnostic");
check(displayShader.includes("DebugView >= 4.5")
  && displayShader.includes("diagnostic.a - diagnostic.b"),
"DMG display Shader lost the WS4 numeric ionic-retention diagnostic");
check(displayShader.includes("DebugView >= 5.5"),
  "DMG display Shader lost the WS5 numeric effective-drive diagnostic");

const ws4Report = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws4-retention-v1.json"),
  "utf8",
));
check(ws4Report.validation?.pass === true
  && ws4Report.validation?.periodProtocolFractionRecovered === true
  && ws4Report.validation?.normalAcceleratedExposureEquivalent === true
  && ws4Report.validation?.normalAcceleratedReleaseEquivalent === true,
"DMG WS4 reconstructed kinetics or 60x equivalence is not passing");
check(ws4Report.kinetics?.releasePerSecond
  <= ws4Report.kinetics?.periodReleaseUpperBoundPerSecond,
"DMG WS4 release rate violates the independent period bound");
const dmgWs4GpuReport = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws4-gpu-retention-v1.json"),
  "utf8",
));
check(dmgWs4GpuReport.validation?.pass === true
  && dmgWs4GpuReport.measurements?.absoluteReleaseRatioError <= 0.05
  && dmgWs4GpuReport.measurements?.maximumControl <= 0.05,
"KPA DMG WS4 GPU retention comparison is not passing");
const dmgWs4Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws4-20260819.json"),
  "utf8",
));
check(dmgWs4Receipt.ws4CompletionEvidence === true
  && dmgWs4Receipt.targetProfile === targetProfile.id
  && dmgWs4Receipt.result === "pass",
"KPA DMG WS4 receipt is not passing completion evidence");
check(dmgWs4Receipt.acceleratedGpuRun?.responseFeedbackConfirmed === true
  && dmgWs4Receipt.acceleratedGpuRun?.shaderCompileErrors === 0
  && dmgWs4Receipt.acceleratedGpuRun?.passFormats?.[0] === "R32G32B32A32_SFLOAT",
"KPA DMG WS4 Vulkan feedback or precision acceptance failed");
for (const input of Object.values(dmgWs4Receipt.inputs ?? {})) {
  if (!input?.path || !input?.sha256) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS4 receipt hash drifted for ${input.path}`);
}
const dmgWs5Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws5-common-mode-20260819.json"),
  "utf8",
));
check(dmgWs5Receipt.ws5CompletionEvidence === true
  && dmgWs5Receipt.targetProfile === targetProfile.id
  && dmgWs5Receipt.result === "pass",
"KPA DMG WS5 receipt is not passing completion evidence");
check(dmgWs5Receipt.reconstruction?.imagePatternCoefficients === 0
  && dmgWs5Receipt.reconstruction?.trainingPatterns?.length === 0
  && dmgWs5Receipt.reconstruction?.normalScale?.RowCrosstalk === 1
  && dmgWs5Receipt.reconstruction?.normalScale?.ColumnCrosstalk === 1
  && dmgWs5Receipt.reconstruction?.nominalDistributedToCommonModeMaximumErrorShade < 0.03
  && dmgWs5Receipt.reconstruction?.phaseBoundaryResidualMaximumErrorShade < 0.001,
"KPA DMG WS5 receipt lost its no-fit derivation or nominal error bounds");
check(dmgWs5Receipt.gpuRun?.responseFeedbackPass === 2
  && dmgWs5Receipt.gpuRun?.shaderCompileErrors === 0
  && dmgWs5Receipt.tetrisMotion?.solidPieceEdgesReviewed === true
  && dmgWs5Receipt.tetrisMotion?.isolatedWrongShadeArtifactPresent === false
  && dmgWs5Receipt.tetrisMotion?.frames >= 720
  && dmgWs5Receipt.tetrisMotion?.averageFps >= 59
  && dmgWs5Receipt.tetrisMotion?.averageFps <= 61,
"KPA DMG WS5 Vulkan or normal-path acceptance failed");
for (const input of Object.values(dmgWs5Receipt.inputs ?? {})) {
  if (!input?.path || !input?.sha256) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS5 receipt hash drifted for ${input.path}`);
}
const ws6Report = JSON.parse(fs.readFileSync(
  path.join(modelDir, "generated", "ws6-aperture-v1.json"),
  "utf8",
));
check(reconstruction.spatial?.ws6Acceptance?.status === "complete",
  "DMG WS6 aperture acceptance is not complete");
check(ws6Report.validation?.pass === true
  && ws6Report.validation?.exact4x5x6Present === true
  && ws6Report.validation?.fractionalScalesPresent === true,
"DMG WS6 exact/fractional scale report is not passing");
check(ws6Report.validation?.maximumApertureError <= ws6Report.validation?.apertureTolerance
  && ws6Report.validation?.maximumShadowGapError <= ws6Report.validation?.shadowGapTolerance,
"DMG WS6 aperture or shadow energy is scale-dependent");
const dmgWs6Scale = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws6-scale-v1.json"),
  "utf8",
));
check(dmgWs6Scale.pass === true
  && dmgWs6Scale.maximumLinearChannelDifference <= dmgWs6Scale.tolerance,
"KPA DMG WS6 4x/fractional presented comparison failed");
const dmgWs6Receipt = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "validation", "dmg01-ws6-20260819.json"),
  "utf8",
));
check(dmgWs6Receipt.ws6CompletionEvidence === true && dmgWs6Receipt.result === "pass",
  "KPA DMG WS6 receipt is not passing completion evidence");
check(dmgWs6Receipt.vulkanRuns?.shaderCompileErrors === 0
  && dmgWs6Receipt.vulkanRuns?.processStayedAlive === true,
"KPA DMG WS6 Vulkan runtime failed");
for (const name of ["cpuReference", "generatedReport", "deviceComparison"]) {
  const input = dmgWs6Receipt.inputs?.[name];
  if (!input?.path || !input?.sha256) continue;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, input.path))).digest("hex");
  check(actual === input.sha256, `KPA DMG WS6 receipt hash drifted for ${input.path}`);
}
const targetReferences = fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "REFERENCES.md"),
  "utf8",
);
const targetEvidenceIds = new Set(
  [...targetReferences.matchAll(/^## (TARGET-KPA-[A-Z]+-\d+)\b/gm)].map((match) => match[1]),
);
const requiredTargetEvidenceIds = [
  "TARGET-KPA-HW-01",
  "TARGET-KPA-SCALE-01",
  "TARGET-KPA-COLOR-01",
  "TARGET-KPA-TUNE-01",
  "TARGET-KPA-DMG-01",
  "TARGET-KPA-DMGSCAN-01",
  "TARGET-KPA-DMGFRONTEND-01",
  "TARGET-KPA-DMGAPERTURE-01",
  "TARGET-KPA-DMGRETENTION-01",
  "TARGET-KPA-DMGCROSSTALK-01",
  "TARGET-KPA-AGS-01",
  "TARGET-KPA-SCAN-01",
  "TARGET-KPA-HCS-01",
  "TARGET-KPA-DRIVE-01",
];
for (const id of requiredTargetEvidenceIds) {
  check(targetEvidenceIds.has(id), `KPA target evidence map is missing required ID ${id}`);
}
check(Array.isArray(targetProfile.evidenceIds), "target profile has no evidence IDs");
const targetProfileEvidenceIds = new Set(targetProfile.evidenceIds ?? []);
for (const id of targetProfile.evidenceIds ?? []) {
  check(targetEvidenceIds.has(id), `target profile contains undefined evidence ID ${id}`);
}
for (const id of targetEvidenceIds) {
  check(targetProfileEvidenceIds.has(id), `target profile omits documented evidence ID ${id}`);
}
const targetPresetPath = path.join(
  root,
  "targets",
  "konkr-gt78-vn",
  "960x640-srgb-neutral",
  "presets",
  "dmg01-reference-v1.slangp",
);
const targetPreset = fs.readFileSync(targetPresetPath, "utf8");
check(targetPreset.includes("../REFERENCES.md"), "KPA target preset lost target provenance pointer");
for (const id of [...targetPreset.matchAll(/\[(TARGET-KPA-[A-Z]+-\d+)\]/g)].map((match) => match[1])) {
  check(targetEvidenceIds.has(id), `KPA target preset contains undefined evidence ID ${id}`);
}
check(targetPreset.includes("Generated by tools/build-dmg01-presets.mjs"),
  "KPA target preset is not the generated full-preset compatibility form");
check(targetPreset.includes('shaders = "5"'),
  "KPA target full preset lost its five-pass chain");
check(presetNumber(targetPreset, "ScreenBrightness") === targetProfile.compensation.ScreenBrightness
  && presetNumber(targetPreset, "ScreenChroma") === targetProfile.compensation.ScreenChroma,
"KPA target preset compensation drifted from the target profile");
for (const shaderPath of [...targetPreset.matchAll(/shader\d+\s*=\s*"([^"]+)"/g)]
  .map((match) => match[1])) {
  check(fs.existsSync(path.resolve(path.dirname(targetPresetPath), shaderPath)),
    `KPA target full preset missing shader ${shaderPath}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`DMG-01 static/model checks passed (${shaderFiles.length + presetFiles.length} model files).`);
