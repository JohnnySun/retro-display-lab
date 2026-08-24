#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  integrateScannedFrame,
  sampleTrilinearXyz,
} from "../models/nintendo-cgb-001/reference/reflected-exposure.mjs";
import {
  CGB_FRAME_SECONDS,
  drivePolarity,
  scanEvent,
} from "../models/nintendo-cgb-001/reference/scan-drive.mjs";
import {
  residualDcExcitation,
  stepResidualDcFloat32,
} from "../models/nintendo-cgb-001/reference/residual-dc-retention.mjs";
import { rgbStripeCoverage } from "../models/nintendo-cgb-001/reference/rgb-aperture.mjs";
import { deltaE00Xyz } from "../models/nintendo-cgb-001/reference/color-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const modelDir = path.join(root, modelRelative);
const targetRelative = "targets/konkr-gt78-vn/960x640-srgb-neutral";
const checkOnly = process.argv.includes("--check");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(relative) {
  return sha256(fs.readFileSync(path.join(root, relative)));
}

function clean(value) {
  return Number(Number(value).toPrecision(12));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function output(relative, buffer) {
  const file = path.join(root, relative);
  if (checkOnly) {
    assert(fs.existsSync(file), `missing WS9 artifact: ${relative}`);
    assert(fs.readFileSync(file).equals(buffer), `stale WS9 artifact: ${relative}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}

const model = readJson(`${modelRelative}/model.json`);
const reconstruction = readJson(`${modelRelative}/data/reconstruction-v1.json`);
const response = readJson(`${modelRelative}/data/response-ensemble-v1.json`);
const retention = readJson(`${modelRelative}/data/retention-v1.json`);
const ws8 = readJson(`${modelRelative}/generated/ws8-receipt-v1.json`);
const lutBuffer = fs.readFileSync(path.join(modelDir, "generated/cgb001-d65-lut-v1.rgba32f"));
const rateBuffer = fs.readFileSync(path.join(modelDir, "generated/cgb001-ws4-gtg-rates-v1.r32f"));

for (let index = 0; index <= 8; index += 1) {
  assert(model.workstreamStatus?.[`ws${index}`] === "complete", `WS${index} must be complete before WS9`);
}
assert(ws8.result?.ws9Eligible === true, "WS8 does not admit WS9 validation");

const priorGold = [
  ["ws0", "generated/ws0-scaffold-v1.json"],
  ["ws1", "generated/ws1-static-fixtures-v1.json"],
  ["ws2", "generated/ws2-decoder-v1.json"],
  ["ws3", "generated/ws3-equation-vectors-v1.json"],
  ["ws4", "generated/ws4-equation-vectors-v1.json"],
  ["ws5", "generated/ws5-equation-vectors-v1.json"],
  ["ws6", "generated/ws6-aperture-validation-v1.json"],
  ["ws7", "generated/ws7-retention-validation-v1.json"],
  ["ws8", "generated/ws8-manifest-v1.json"],
].map(([workstream, relative]) => {
  const artifact = `${modelRelative}/${relative}`;
  assert(fs.existsSync(path.join(root, artifact)), `${workstream} CPU gold is missing`);
  return { workstream, path: relative, sha256: sha256File(artifact) };
});

let maximumIntegerTransportError = 0;
let maximumStaticCpuError = 0;
let integerCodeCount = 0;
for (let b = 0; b < 32; b += 1) {
  for (let g = 0; g < 32; g += 1) {
    for (let r = 0; r < 32; r += 1) {
      const index = (b * 32 + g) * 32 + r;
      const expected = [0, 1, 2].map((component) => lutBuffer.readFloatLE(index * 16 + component * 4));
      const sampled = sampleTrilinearXyz(lutBuffer, [r / 31, g / 31, b / 31], true);
      for (let component = 0; component < 3; component += 1) {
        maximumStaticCpuError = Math.max(maximumStaticCpuError, Math.abs(sampled[component] - expected[component]));
        const transported = Math.fround(Math.round(expected[component] * 65535) / 65535);
        maximumIntegerTransportError = Math.max(
          maximumIntegerTransportError,
          Math.abs(transported - expected[component]),
        );
      }
      integerCodeCount += 1;
    }
  }
}
assert(integerCodeCount === 32768 && maximumStaticCpuError <= 6e-8,
  "all-code CPU static LUT path drifted");
assert(maximumIntegerTransportError <= 7.7e-6, "paired RGBA8 uint16 transport quantization drifted");

const nominalRetention = retention.candidates.find((entry) => entry.id === "nominal-midpoint").parameters;
const sequenceCodes = [
  { id: "static-black-seed", code: [0, 0, 0], row: 0, reset: true },
  { id: "ramp-low", code: [3, 3, 3], row: 0 },
  { id: "mixed-color", code: [3, 11, 25], row: 71 },
  { id: "scan-last-row", code: [30, 2, 26], row: 143 },
  { id: "motion-rise-0", code: [27, 27, 27], row: 71 },
  { id: "motion-rise-1", code: [27, 27, 27], row: 71 },
  { id: "motion-fall", code: [4, 4, 4], row: 71 },
  { id: "retention-stress-0", code: [24, 24, 24], row: 71, retention: true },
  { id: "retention-stress-1", code: [24, 24, 24], row: 71, retention: true },
  { id: "retention-recovery", code: [8, 8, 8], row: 71, retention: true },
  { id: "lifecycle-reset", code: [12, 20, 28], row: 71, reset: true },
  { id: "post-reset-motion", code: [30, 29, 2], row: 143 },
];

let state = [0, 0, 0];
let residual = 0;
let previousCode = [0, 0, 0];
const endToEnd = [];
for (let frame = 0; frame < sequenceCodes.length; frame += 1) {
  const item = sequenceCodes[frame];
  if (item.reset) {
    state = item.code.map((value) => Math.fround(value / 31));
    residual = 0;
    previousCode = [...item.code];
    endToEnd.push({
      frame,
      id: item.id,
      lifecycle: "clean-static-seed",
      currentRgb555: item.code,
      responseEndpoint: state,
      exposureXyz: sampleTrilinearXyz(lutBuffer, state, true),
      residualDc: residual,
    });
    continue;
  }
  const initialState = [...state];
  const exposureFrame = integrateScannedFrame({
    lutBuffer,
    rateBuffer,
    memberIndex: 1,
    initialState,
    previousRgb555: previousCode,
    currentRgb555: item.code,
    row: item.row,
    method: "gauss-float32",
    panels: 32,
    order: 2,
  });
  state = exposureFrame.endpoint.map(Math.fround);
  if (item.retention) {
    const event = scanEvent({ row: item.row });
    const polarity = drivePolarity({ frameCount: frame, x: 80, y: item.row });
    const step = (sourceRgb555, seconds) => {
      const excitation = residualDcExcitation({
        sourceRgb555,
        polarity,
        resultantDcOffset: 0.1,
        codeWeight: 0.5,
        polarityWeight: 0.25,
      });
      residual = stepResidualDcFloat32({
        state: residual,
        excitation,
        ...nominalRetention,
        dtSeconds: seconds,
      });
    };
    step(previousCode, event.latchSeconds);
    step(item.code, CGB_FRAME_SECONDS - event.latchSeconds);
  } else {
    residual = 0;
  }
  endToEnd.push({
    frame,
    id: item.id,
    lifecycle: "ordinary-committed-frame",
    row: item.row,
    previousRgb555: previousCode,
    currentRgb555: item.code,
    initialResponseState: initialState,
    responseEndpoint: state,
    exposureXyz: exposureFrame.averageXyz,
    residualDc: residual,
  });
  previousCode = [...item.code];
}

const apertureGold = [3.5, 4, 5, 6].map((scale) => ({
  scale,
  phases: Array.from({ length: Math.ceil(scale) }, (_unused, phase) => {
    const hostIndex = Math.floor(scale * 80) + phase;
    const sourceCenter = (hostIndex + 0.5) / scale - 0.5;
    const coverage = rgbStripeCoverage({ sourceX: sourceCenter, hostPixelsPerSourcePixel: scale });
    return { phase, sourceCenter: clean(sourceCenter), coverage: coverage.channels.map((value) => clean(3 * value)) };
  }),
}));

const cpuGold = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-cpu-golden-v1",
  modelId: model.id,
  modelVersion: model.modelVersion,
  classification: "consolidated-prior-workstream-gold-and-end-to-end-float32-shader-equation-transcription",
  priorWorkstreamGold: priorGold,
  allRgb555Static: {
    testedCodes: integerCodeCount,
    maximumCpuFloat32VsAuthoritativeLutAbsoluteXyzError: clean(maximumStaticCpuError),
    maximumPairedRgba8Uint16TransportVsAuthoritativeLutAbsoluteXyzError: clean(maximumIntegerTransportError),
    authoritativeLutSha256: sha256(lutBuffer),
    pass: true,
  },
  endToEnd: {
    coverage: ["static ramps", "mixed colors", "scan", "motion", "diagnostic retention", "reset"],
    referenceRetentionAmount: 0,
    diagnosticRetentionAmount: 1,
    vectors: endToEnd,
  },
  aperture: {
    equation: "WS6 equal-third RGB analytic host-footprint integration",
    coverage: ["fractional 3.5x", "integer 4x", "integer 5x", "integer 6x"],
    vectors: apertureGold,
  },
  shaderReadbackContract: {
    debugView8: "response RGB, decoded residual DC, packed source RGB555, FrameCount",
    debugView9: "exposure XYZ, current response RGB, packed source RGB555, FrameCount, sentinel",
    debugView10: "32 LUT XYZ values for current R/G, packed RGB555, FrameCount, sentinel",
    debugView11: "aperture coverage RGB, scaleX, OutputSize.x, SourceSize.x",
    transport: "IEEE-754 uint words rendered as exact black/white source-pixel bands",
    runtimeTextureTransport: "paired nearest-filtered RGBA8 high/low byte planes reconstruct each uint16 LUT component before manual trilinear interpolation",
  },
  pass: true,
};
output(`${modelRelative}/generated/ws9-cpu-golden-v1.json`, jsonBuffer(cpuGold));

const members = response.members.map((entry, memberIndex) => {
  const probe = integrateScannedFrame({
    lutBuffer,
    rateBuffer,
    memberIndex,
    initialState: [0, 0, 0],
    previousRgb555: [0, 0, 0],
    currentRgb555: [31, 31, 31],
    row: 71,
    method: "gauss-float32",
    panels: 32,
    order: 2,
  });
  return { id: entry.id, endpoint: probe.endpoint, exposureXyz: probe.averageXyz };
});

const retentionSensitivity = retention.candidates.map((candidate) => {
  let value = 0;
  for (let frame = 0; frame < 180; frame += 1) {
    const polarity = drivePolarity({ frameCount: frame, x: 80, y: 71 });
    const excitation = residualDcExcitation({
      sourceRgb555: [24, 24, 24],
      polarity,
      resultantDcOffset: 0.1,
      codeWeight: 0.5,
      polarityWeight: 0.25,
    });
    value = stepResidualDcFloat32({
      state: value,
      excitation,
      ...candidate.parameters,
      dtSeconds: CGB_FRAME_SECONDS,
    });
  }
  return { id: candidate.id, residualAfter180Frames: value };
});

const sensitivity = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-sensitivity-v1",
  classification: "bounded-policy-sensitivity-not-parameter-fitting",
  colorRepairPolicy: {
    referenceArtifact: "generated/cgb001-d65-lut-v1.rgba32f",
    comparisonArtifact: "generated/cgb001-hcs-upstream-d65-v1.png",
    sourceAudit: "generated/ws1-color-audit-v1.json",
  },
  responseEnsemble: members,
  latchCandidates: [0, 0.5, 1].map((latchOffsetLines) => ({
    latchOffsetLines,
    row71: scanEvent({ row: 71, latchOffsetLines }),
  })),
  inversionCandidates: ["frame-global", "row-alternating", "column-alternating", "dot-checkerboard"].map((topology) => ({
    topology,
    signs: [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => drivePolarity({
      frameCount: 0, x, y, topology,
    })),
  })),
  retentionKineticRange: retentionSensitivity,
  apertureVariants: apertureGold,
  selectedDefaultsRemainEvidenceBounded: true,
  pass: true,
};
output(`${modelRelative}/generated/ws9-sensitivity-v1.json`, jsonBuffer(sensitivity));

const perceptual = readJson(`${modelRelative}/generated/ws1-perceptual-v1.json`);
const colorAudit = readJson(`${modelRelative}/generated/ws1-color-audit-v1.json`);
const sameBoyCurve = [
  0, 6, 12, 20, 28, 36, 45, 56, 66, 76, 88, 100, 113, 125, 137, 149,
  161, 172, 182, 192, 202, 210, 218, 225, 232, 238, 243, 247, 250, 252, 254, 255,
];

function sameBoyModernBalanced(rgb555) {
  const [r, g, b] = rgb555.map((code) => sameBoyCurve[code]);
  const mixedG = g === b ? g : Math.round(255 * (
    (3 * (g / 255) ** 1.6 + (b / 255) ** 1.6) / 4
  ) ** (1 / 1.6));
  return [r / 255, mixedG / 255, b / 255];
}

function libretroGbcColorSrgb(rgb555, clampAfterMatrix = false) {
  const source = rgb555.map((code) => (code / 31) ** 2.2 * 0.91);
  let linear = [
    0.905 * source[0] + 0.195 * source[1] - 0.10 * source[2],
    0.10 * source[0] + 0.65 * source[1] + 0.25 * source[2],
    0.1575 * source[0] + 0.1425 * source[1] + 0.70 * source[2],
  ];
  if (clampAfterMatrix) linear = linear.map((value) => Math.min(1, Math.max(0, value)));
  if (linear.some((value) => value < 0)) return null;
  return linear.map((value) => value ** (1 / 2.2));
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function srgbToXyz(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

const measuredBlack = perceptual.series.Greyscale.rows[0].measuredBlackAlignedXyz;
const measuredWhiteDelta = perceptual.comparisonPolicy.upstreamAbsoluteComparison.measuredWhiteDeltaXyz;
const deltaEWhite = perceptual.comparisonPolicy.deltaE00White;
function alignedPriorXyz(encodedRgb, priorWhiteXyz) {
  return srgbToXyz(encodedRgb).map((value, component) => (
    measuredBlack[component] + value * measuredWhiteDelta[component] / priorWhiteXyz[component]
  ));
}

const sameBoyWhite = srgbToXyz(sameBoyModernBalanced([31, 31, 31]));
const libretroWhite = srgbToXyz(libretroGbcColorSrgb([31, 31, 31]));
const sameBoyDifferences = [];
const libretroFiniteDifferences = [];
const libretroClampedDifferences = [];
let libretroUndefinedCodes = 0;
let sameBoyWorst = null;
let libretroFiniteWorst = null;
let libretroClampedWorst = null;
function trackWorst(current, deltaE00, rgb555) {
  return !current || deltaE00 > current.deltaE00 ? { rgb555, deltaE00 } : current;
}
for (let b = 0; b < 32; b += 1) {
  for (let g = 0; g < 32; g += 1) {
    for (let r = 0; r < 32; r += 1) {
      const rgb555 = [r, g, b];
      const index = (b * 32 + g) * 32 + r;
      const referenceXyz = [0, 1, 2].map((component) => lutBuffer.readFloatLE(index * 16 + component * 4));
      const sameBoyDelta = deltaE00Xyz(
        referenceXyz,
        alignedPriorXyz(sameBoyModernBalanced(rgb555), sameBoyWhite),
        deltaEWhite,
      );
      sameBoyDifferences.push(sameBoyDelta);
      sameBoyWorst = trackWorst(sameBoyWorst, sameBoyDelta, rgb555);

      const exactLibretro = libretroGbcColorSrgb(rgb555);
      if (exactLibretro) {
        const difference = deltaE00Xyz(
          referenceXyz,
          alignedPriorXyz(exactLibretro, libretroWhite),
          deltaEWhite,
        );
        libretroFiniteDifferences.push(difference);
        libretroFiniteWorst = trackWorst(libretroFiniteWorst, difference, rgb555);
      } else {
        libretroUndefinedCodes += 1;
      }
      const clampedDifference = deltaE00Xyz(
        referenceXyz,
        alignedPriorXyz(libretroGbcColorSrgb(rgb555, true), libretroWhite),
        deltaEWhite,
      );
      libretroClampedDifferences.push(clampedDifference);
      libretroClampedWorst = trackWorst(libretroClampedWorst, clampedDifference, rgb555);
    }
  }
}

function differenceSummary(values) {
  return {
    count: values.length,
    minimum: clean(Math.min(...values)),
    maximum: clean(Math.max(...values)),
    mean: clean(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

const priorArtComparison = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-prior-art-difference-v1",
  classification: "difference-report-only-prior-art-is-not-acceptance-truth",
  referenceTruth: {
    evidenceId: "CGB-HCS-REFLECTANCE-2026",
    geometry: "CIE D65, 45 degree illumination, 0 degree normal view, CIE 1931 2 degree observer",
    originalMeasurementArtifacts: {
      "gbc_reflectance.ods": "967af7247d940e15cd86ce28046fcf9996bb36086389d9967154188770a95bba",
      "gbc_reflectance.txt": "b985e02476d35beecfb6a6955cb8aecae052205008126a8cdad7fd7233cf2b37",
    },
    authoritativeLutSha256: sha256(lutBuffer),
    measuredPatchComparison: {
      patches: perceptual.aggregates["runtime-monotonic-lut"].deltaE00.count,
      referenceRuntimeLutDeltaE00: perceptual.aggregates["runtime-monotonic-lut"].deltaE00,
      hcsUpstreamWhiteAndBlackAlignedDeltaE00: perceptual.aggregates.upstreamWhiteAndBlackAligned.deltaE00,
      upstreamParameterMaximumDifference: colorAudit.upstreamParameterRegression.maximumDifference,
      upstreamParameterRegressionPass: colorAudit.upstreamParameterRegression.pass,
    },
  },
  comparisonPolicy: {
    domain: "all 32768 integer RGB555 codes",
    alignment: "map each prior-art sRGB white component-wise to the measured black-subtracted white, then add the dedicated measured black",
    metric: "CIEDE2000 against the authoritative WS1 XYZ LUT",
    acceptanceRole: "none; differences characterize prior art and never select or reject measured color",
  },
  sameBoy: {
    evidenceId: "CGB-PRIOR-SAMEBOY",
    source: "https://github.com/LIJI32/SameBoy/blob/213a12ce93d66b105a113debd9396306066a7cfc/Core/display.c",
    sourceSha256: "480218b1647f8f9bdcb00ba87198b534f8e90657813b34c73c4d1058bcc77385",
    header: "https://github.com/LIJI32/SameBoy/blob/213a12ce93d66b105a113debd9396306066a7cfc/Core/display.h",
    headerSha256: "54e1d7d0ad4c9b10a99459017921bad1b4e072c04328f1cc3f6f20e76864bea6",
    mode: "GB_COLOR_CORRECTION_MODERN_BALANCED, CGB model, zero light-temperature",
    transcription: {
      channelCurveUint8: sameBoyCurve,
      greenMix: "round(255 * ((3*(g/255)^1.6 + (b/255)^1.6)/4)^(1/1.6)); red and blue retain the curve output",
    },
    deltaE00VersusMeasuredReferenceLut: differenceSummary(sameBoyDifferences),
    worst: sameBoyWorst,
  },
  libretroGbcColor: {
    evidenceId: "CGB-PRIOR-LIBRETRO",
    source: "https://github.com/libretro/slang-shaders/blob/a62d9cda9140294d22b6da5e4ff4187365890d42/handheld/shaders/color/gbc-color.slang",
    sourceSha256: "ef74a7c7a9519fd4301ea55ad09ecbd8e958f6f03657c83a7a45fcfb429b15b3",
    mode: "sRGB profile, lighten_screen=0",
    exactSourceSemantics: {
      finiteCodes: libretroFiniteDifferences.length,
      undefinedNegativeLinearPowCodes: libretroUndefinedCodes,
      deltaE00VersusMeasuredReferenceLutForFiniteCodes: differenceSummary(libretroFiniteDifferences),
      worstFinite: libretroFiniteWorst,
    },
    postMatrixClampDiagnostic: {
      classification: "diagnostic-only-not-the-pinned-source-equation",
      purpose: "show the intended all-code shape without treating undefined pow(negative, 1/2.2) as measured or exact prior-art output",
      deltaE00VersusMeasuredReferenceLut: differenceSummary(libretroClampedDifferences),
      worst: libretroClampedWorst,
    },
  },
  pass: sameBoyDifferences.length === 32768
    && libretroFiniteDifferences.length + libretroUndefinedCodes === 32768
    && libretroClampedDifferences.length === 32768
    && colorAudit.upstreamParameterRegression.pass === true,
};
output(`${modelRelative}/generated/ws9-prior-art-comparison-v1.json`, jsonBuffer(priorArtComparison));

const basePreset = fs.readFileSync(path.join(modelDir, "presets/reference-d65-v1.slangp"), "utf8");
function diagnosticPreset(title, debugView, retentionAmount = "0.0") {
  return Buffer.from(basePreset
    .replace("WS8 normal: reference D65 period reconstruction", `WS9 diagnostic: ${title}`)
    .replace('RetentionAmount = "0.0"', `RetentionAmount = "${retentionAmount}"`)
    .replace('DebugView = "0.0"', `DebugView = "${debugView}.0"`));
}

const modelPresets = new Map([
  ["diagnostic-response-readback-v1.slangp", diagnosticPreset("float-bit response readback", 8)],
  ["diagnostic-retention-readback-v1.slangp", diagnosticPreset("float-bit synthetic retention readback", 8, "1.0")],
  ["diagnostic-exposure-readback-v1.slangp", diagnosticPreset("float-bit exposure readback", 9)],
  ["diagnostic-lut-readback-v1.slangp", diagnosticPreset("all-code float-bit LUT readback", 10)],
  ["diagnostic-aperture-readback-v1.slangp", diagnosticPreset("float-bit aperture coverage readback", 11)],
]);
for (const [name, buffer] of modelPresets) output(`${modelRelative}/presets/${name}`, buffer);

function targetPreset(modelBuffer) {
  return Buffer.from(modelBuffer.toString("utf8")
    .replace("## Provenance: ../REFERENCES.md", "## Model provenance: ../../../../models/nintendo-cgb-001/REFERENCES.md\n## Target provenance: ../REFERENCES.md")
    .replaceAll("../generated/", "../../../../models/nintendo-cgb-001/generated/")
    .replaceAll("../shaders/", "../../../../models/nintendo-cgb-001/shaders/"));
}

const targetPresets = new Map([
  ["cgb001-reference-d65-v1.slangp", targetPreset(Buffer.from(basePreset))],
  ...[...modelPresets].map(([name, buffer]) => [`cgb001-ws9-${name.replace("diagnostic-", "")}`, targetPreset(buffer)]),
]);
for (const [name, buffer] of targetPresets) output(`${targetRelative}/presets/${name}`, buffer);

const frontendCfg = Buffer.from(`# RetroArch target contract for the CGB-001 stateful reference preset.\n# Apply as an isolated test config or content override, never as a global replacement.\nvideo_driver = "vulkan"\nvideo_shader_subframes = "1"\nvideo_scale_integer = "true"\nvideo_scale_integer_overscale = "false"\nvideo_aspect_ratio_auto = "true"\nvideo_smooth = "false"\nrewind_enable = "false"\nrun_ahead_enabled = "false"\nfastforward_ratio = "1.000000"\n`);
output(`${targetRelative}/retroarch/cgb001-temporal.cfg`, frontendCfg);

const coreOptions = Buffer.from(`gambatte_gbc_color_correction = "disabled"\ngambatte_dark_filter_level = "0"\ngambatte_mix_frames = "disabled"\ngambatte_gb_hwmode = "Auto"\ngambatte_gb_bootloader = "disabled"\ngambatte_gb_colorization = "GBC"\n`);
output(`${targetRelative}/retroarch/cgb001-core-options.opt`, coreOptions);

const presetManifest = {
  schemaVersion: 1,
  manifestId: "cgb001-ws9-validation-preset-manifest-v1",
  modelId: model.id,
  modelVersion: model.modelVersion,
  generatedBy: "tools/build-cgb001-ws9.mjs",
  modelPresets: Object.fromEntries([...modelPresets].map(([name, buffer]) => [name, sha256(buffer)])),
  targetPresets: Object.fromEntries([...targetPresets].map(([name, buffer]) => [name, sha256(buffer)])),
  targetFrontendContract: {
    path: `${targetRelative}/retroarch/cgb001-temporal.cfg`,
    sha256: sha256(frontendCfg),
  },
  targetCoreOptions: {
    path: `${targetRelative}/retroarch/cgb001-core-options.opt`,
    sha256: sha256(coreOptions),
  },
  debugViewsAreReadOnlyInPersistentPasses: true,
  referencePresetParametersUnchanged: true,
};
output(`${modelRelative}/generated/ws9-preset-manifest-v1.json`, jsonBuffer(presetManifest));

if (!checkOnly) {
  process.stdout.write("Wrote CGB-001 WS9 CPU gold, sensitivity, numeric diagnostics, and KONKR target presets.\n");
} else {
  process.stdout.write("CGB-001 WS9 source-side artifacts are current.\n");
}
