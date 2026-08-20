#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const sourcePath = path.join(modelDir, "data", "hcs-e688fc5-color.json");
const generatedPath = path.join(modelDir, "generated", "hcs-e688fc5-color.json");
const shaderPaths = [
  path.join(modelDir, "shaders", "ags101-response-v1.slang"),
  path.join(modelDir, "shaders", "ags101-display-v1.slang"),
  path.join(modelDir, "shaders", "ags101-exposure-optics.inc"),
];
const checkOnly = process.argv.includes("--check");

const RESPONSE_BEGIN = "// BEGIN GENERATED HCS COLOR: RESPONSE";
const RESPONSE_END = "// END GENERATED HCS COLOR: RESPONSE";
const DISPLAY_BEGIN = "// BEGIN GENERATED HCS COLOR: DISPLAY";
const DISPLAY_END = "// END GENERATED HCS COLOR: DISPLAY";
const EXPOSURE_BEGIN = "// BEGIN GENERATED HCS COLOR: EXPOSURE";
const EXPOSURE_END = "// END GENERATED HCS COLOR: EXPOSURE";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function add(a, b) {
  return a.map((value, index) => value + b[index]);
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function scale(a, factor) {
  return a.map((value) => value * factor);
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce(
    (sum, value, column) => sum + value * vector[column],
    0,
  ));
}

function multiplyMatrices(a, b) {
  return a.map((row) => b[0].map((_, column) => row.reduce(
    (sum, value, index) => sum + value * b[index][column],
    0,
  )));
}

function invertMatrix3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const determinant = a * (e * i - f * h)
    - b * (d * i - f * g)
    + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) {
    throw new Error("singular 3x3 matrix");
  }
  const inverseDeterminant = 1 / determinant;
  return [
    [(e * i - f * h), (c * h - b * i), (b * f - c * e)],
    [(f * g - d * i), (a * i - c * g), (c * d - a * f)],
    [(d * h - e * g), (b * g - a * h), (a * e - b * d)],
  ].map((row) => row.map((value) => value * inverseDeterminant));
}

function diagonal(values) {
  return values.map((value, row) => values.map((_, column) => (
    row === column ? value : 0
  )));
}

function xyzToXy(xyz) {
  const sum = xyz[0] + xyz[1] + xyz[2];
  return [xyz[0] / sum, xyz[1] / sum];
}

function xyToXyz([x, y]) {
  return [x / y, 1, (1 - x - y) / y];
}

function normalizedPrimaryMatrix(primaryXyz, whiteXyz) {
  const unitPrimaries = primaryXyz.map((xyz) => xyToXyz(xyzToXy(xyz)));
  const primaryMatrix = [0, 1, 2].map((row) => unitPrimaries.map((xyz) => xyz[row]));
  const primaryScales = multiplyMatrixVector(invertMatrix3(primaryMatrix), whiteXyz);
  return multiplyMatrices(primaryMatrix, diagonal(primaryScales));
}

function bradfordAdaptation(sourceWhite, targetWhite) {
  const bradford = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
  ];
  const sourceCone = multiplyMatrixVector(bradford, sourceWhite);
  const targetCone = multiplyMatrixVector(bradford, targetWhite);
  const coneScale = targetCone.map((value, index) => value / sourceCone[index]);
  return multiplyMatrices(
    multiplyMatrices(invertMatrix3(bradford), diagonal(coneScale)),
    bradford,
  );
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function cleanNumber(value) {
  // Transcendental results may differ by a few ULPs between V8 releases.
  // Twelve significant digits exceed the runtime shader precision while
  // keeping generated JSON byte-identical across supported Node versions.
  return Number(value.toPrecision(12));
}

function cleanDeep(value) {
  if (typeof value === "number") return cleanNumber(value);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

function maxDifference(a, b) {
  if (Array.isArray(a)) {
    return Math.max(...a.map((value, index) => maxDifference(value, b[index])));
  }
  return Math.abs(a - b);
}

function derive(source) {
  if (source.schemaVersion !== 1) throw new Error("unsupported HCS source schema");
  if (source.grayscale.length !== 32) throw new Error("HCS grayscale must contain 32 codes");
  source.grayscale.forEach((sample, index) => {
    if (sample.code !== index) throw new Error(`HCS grayscale code mismatch at ${index}`);
    if (!Array.isArray(sample.xyz) || sample.xyz.length !== 3) {
      throw new Error(`HCS grayscale XYZ missing at ${index}`);
    }
  });

  const blackXyz = source.grayscale[0].xyz;
  const whiteXyz = source.grayscale[31].xyz;
  const whiteMinusBlack = subtract(whiteXyz, blackXyz);
  const whiteRangeY = whiteMinusBlack[1];
  if (!(whiteRangeY > 0)) throw new Error("HCS white-minus-black Y must be positive");

  const primaryNames = ["red", "green", "blue"];
  const normalizedPrimaries = primaryNames.map((name) => scale(
    subtract(source.fullLevelPatches[name], blackXyz),
    1 / whiteRangeY,
  ));
  const normalizedWhite = scale(whiteMinusBlack, 1 / whiteRangeY);
  const rgbToXyz = normalizedPrimaryMatrix(normalizedPrimaries, normalizedWhite);
  const xyzToRgb = invertMatrix3(rgbToXyz);

  const gamma = source.grayscale.map((sample, code) => {
    if (code === 0 || code === 31) return [Number.NaN, Number.NaN, Number.NaN];
    const normalizedGray = scale(subtract(sample.xyz, blackXyz), 1 / whiteRangeY);
    const channelScale = multiplyMatrixVector(xyzToRgb, normalizedGray);
    const input = code / 31;
    return channelScale.map((value) => {
      if (!(value > 0)) throw new Error(`non-positive HCS channel scale at code ${code}`);
      return Math.log(value) / Math.log(input);
    });
  });
  gamma[0] = [...gamma[1]];
  gamma[31] = [...gamma[30]];

  const runtimeGamma = gamma.map((row) => row.map((value) => (
    round(value, source.derivation.runtimeGammaDecimals)
  )));
  const runtimeEotf = runtimeGamma.map((row, code) => row.map((value) => (
    (code / 31) ** value
  )));

  const targetWhite = xyToXyz(source.derivation.targetWhiteXy);
  const catToD65 = bradfordAdaptation(normalizedWhite, targetWhite);
  const blackXyzNormalizedByRawWhiteY = scale(blackXyz, 1 / whiteXyz[1]);
  const modeledWhiteWithBlack = add(normalizedWhite, scale(blackXyz, 1 / whiteRangeY));
  const catToD65WithBlack = bradfordAdaptation(modeledWhiteWithBlack, targetWhite);

  const expected = {
    rgbToXyz: [
      [0.425287783341, 0.34714068541, 0.212756689885],
      [0.237300233948, 0.638744541979, 0.123955224073],
      [0.0209770211289, 0.060791803406, 1.15243512768],
    ],
    catToD65: [
      [0.99435579934, -0.00591198866531, -0.0188434497843],
      [-0.0112605313102, 1.01753503324, -0.00521901173748],
      [-0.0051283888247, 0.00947697145491, 0.878811958039],
    ],
    catToD65WithBlack: [
      [0.990502545742, -0.00592081191287, -0.0189626817761],
      [-0.0112877375384, 1.01374036194, -0.00525437847233],
      [-0.00515757560115, 0.00952941070824, 0.874236252693],
    ],
    gammaByChannel: [
      [
        2.110, 2.110, 2.283, 2.428, 2.482, 2.457, 2.388, 2.323,
        2.258, 2.271, 2.276, 2.247, 2.259, 2.328, 2.355, 2.408,
        2.467, 2.496, 2.582, 2.669, 2.729, 2.742, 2.811, 2.780,
        2.832, 2.797, 2.942, 2.976, 2.833, 2.458, 1.974, 1.974,
      ],
      [
        2.097, 2.097, 2.272, 2.422, 2.468, 2.443, 2.371, 2.298,
        2.228, 2.238, 2.240, 2.204, 2.216, 2.276, 2.298, 2.346,
        2.396, 2.423, 2.501, 2.575, 2.635, 2.637, 2.685, 2.635,
        2.669, 2.617, 2.747, 2.745, 2.608, 2.232, 1.644, 1.644,
      ],
      [
        1.987, 1.987, 2.134, 2.255, 2.276, 2.229, 2.133, 2.039,
        1.947, 1.933, 1.909, 1.855, 1.837, 1.871, 1.863, 1.876,
        1.892, 1.877, 1.913, 1.949, 1.956, 1.900, 1.899, 1.774,
        1.740, 1.614, 1.673, 1.564, 1.382, 1.114, 0.877, 0.877,
      ],
    ],
  };
  if (maxDifference(rgbToXyz, expected.rgbToXyz) > 5e-10) {
    throw new Error(`RGB->XYZ derivation does not match pinned HCS shader: ${maxDifference(rgbToXyz, expected.rgbToXyz)}`);
  }
  if (maxDifference(catToD65, expected.catToD65) > 5e-10) {
    throw new Error(`Bradford derivation does not match pinned HCS shader: ${maxDifference(catToD65, expected.catToD65)}`);
  }
  if (maxDifference(catToD65WithBlack, expected.catToD65WithBlack) > 5e-10) {
    throw new Error(`Bradford-with-black derivation does not match pinned HCS shader: ${maxDifference(catToD65WithBlack, expected.catToD65WithBlack)}`);
  }
  const expectedRuntimeGamma = runtimeGamma.map((_, code) => (
    expected.gammaByChannel.map((channel) => channel[code])
  ));
  if (maxDifference(runtimeGamma, expectedRuntimeGamma) > 1e-12) {
    throw new Error("runtime gamma table does not match pinned HCS shader");
  }

  const srgbXyzToRgb = [
    [3.2406255, -1.5372080, -0.4986286],
    [-0.9689307, 1.8757561, 0.0415175],
    [0.0557101, -0.2040211, 1.0569959],
  ];
  const srgbEncode = (linear) => linear.map((value) => {
    const encoded = value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
    return Math.min(Math.max(encoded, 0), 1);
  });
  const hcsOutput = (rgbIndex, { improveContrast = true } = {}) => {
    const native = rgbIndex.map((code, channel) => runtimeEotf[code][channel]);
    let xyz = multiplyMatrixVector(rgbToXyz, native);
    if (!improveContrast) xyz = add(xyz, blackXyzNormalizedByRawWhiteY);
    return srgbEncode(multiplyMatrixVector(srgbXyzToRgb, xyz));
  };
  const patchIndices = {
    red: [31, 0, 0],
    green: [0, 31, 0],
    blue: [0, 0, 31],
    yellow: [31, 31, 0],
    cyan: [0, 31, 31],
    magenta: [31, 0, 31],
  };
  const policyVectors = (improveContrast) => ({
    settings: {
      chromaticAdaptation: false,
      improveContrast,
      hostEncoding: "sRGB",
      outputClamp: [0, 1],
    },
    grayscaleRgb555: runtimeEotf.map((_, code) => ({
      code,
      outputRgb: hcsOutput([code, code, code], { improveContrast }),
    })),
    fullLevelPatches: Object.fromEntries(Object.entries(patchIndices).map(([name, rgbIndex]) => (
      [name, { rgbIndex, outputRgb: hcsOutput(rgbIndex, { improveContrast }) }]
    ))),
  });
  const outputPolicies = {
    hcsBlackSubtracted: {
      id: "hcs-black-subtracted",
      label: "HCS black-subtracted",
      hcsImproveContrast: 1,
      blackHandling: "subtract measured black before normalization",
    },
    hcsPhysicalBlack: {
      id: "hcs-physical-black",
      label: "HCS physical measured black",
      hcsImproveContrast: 0,
      blackHandling: "restore measured black XYZ normalized by raw white Y",
    },
  };
  const coverage = {
    measured: {
      blackWhiteAnchors: true,
      neutralRampRgb555Codes: 32,
      fullLevelRgbCmyPatches: 6,
    },
    notMeasuredOrNotRecorded: {
      perChannelRamps: true,
      intermediateMixedPatches: true,
      repeats: true,
      brightnessMode: true,
      absolutePeakLuminanceContext: true,
      interUnitVariation: true,
      ambientLighting: true,
      warmup: true,
      chargerState: true,
      panelIdentity: true,
    },
    interpretation: "The EOTF and matrix are a deterministic model fitted to one pinned record; generated RGB555 combinations are not independent measurements.",
  };
  const goldenVectors = {
    ...policyVectors(true),
    policyId: outputPolicies.hcsBlackSubtracted.id,
    policies: {
      [outputPolicies.hcsBlackSubtracted.id]: policyVectors(true),
      [outputPolicies.hcsPhysicalBlack.id]: policyVectors(false),
    },
  };
  return {
    schemaVersion: 1,
    generator: "tools/build-ags101-hcs-color.mjs",
    source: {
      path: "models/nintendo-ags-101/data/hcs-e688fc5-color.json",
      sha256: crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"),
      hcsCommit: source.source.commit,
      evidenceId: source.evidenceId,
      derivationRevision: source.derivation.revision,
    },
    blackXyz,
    whiteXyz,
    whiteRangeY,
    blackXyzNormalizedByRawWhiteY,
    nativeRgbToXyz: rgbToXyz,
    nativeWhiteXyz: normalizedWhite,
    bradfordNativeToD65: catToD65,
    bradfordNativeWithBlackToD65: catToD65WithBlack,
    srgbXyzToLinearRgb: srgbXyzToRgb,
    gammaFullPrecision: gamma,
    gammaRuntime: runtimeGamma,
    eotfRgb555Runtime: runtimeEotf,
    coverage,
    outputPolicies,
    goldenVectors,
  };
}

function formatFloat(value) {
  const normalized = Math.abs(value) < 5e-16 ? 0 : value;
  return normalized.toFixed(12);
}

function formatMatrix(name, matrix) {
  const columns = [0, 1, 2].map((column) => (
    `   vec3(${formatFloat(matrix[0][column])}, ${formatFloat(matrix[1][column])}, ${formatFloat(matrix[2][column])})`
  ));
  return `const mat3 ${name} = mat3(\n${columns.join(",\n")}\n);`;
}

function responseBlock(derived) {
  const rows = derived.eotfRgb555Runtime.map((row, code) => (
    `   vec3(${row.map(formatFloat).join(", ")})${code === 31 ? "" : ","}`
  ));
  return `${RESPONSE_BEGIN}
// Generated from AGS-COLOR-01 by tools/build-ags101-hcs-color.mjs.
const vec3 HCS_RGB555_EOTF[32] = vec3[](
${rows.join("\n")}
);
${RESPONSE_END}`;
}

function exposureBlock(derived) {
  const rows = derived.eotfRgb555Runtime.map((row, code) => (
    `   vec3(${row.map(formatFloat).join(", ")})${code === 31 ? "" : ","}`
  ));
  return `${EXPOSURE_BEGIN}
// Generated from AGS-COLOR-01 by tools/build-ags101-hcs-color.mjs.
const vec3 HCS_RGB555_EOTF[32] = vec3[](
${rows.join("\n")}
);
${EXPOSURE_END}`;
}

function displayBlock(derived) {
  const rows = derived.eotfRgb555Runtime.map((row, code) => (
    `   vec3(${row.map(formatFloat).join(", ")})${code === 31 ? "" : ","}`
  ));
  return `${DISPLAY_BEGIN}
// Generated from AGS-COLOR-01 by tools/build-ags101-hcs-color.mjs.
const vec3 HCS_RGB555_EOTF[32] = vec3[](
${rows.join("\n")}
);

${formatMatrix("HCS_NATIVE_RGB_TO_XYZ", derived.nativeRgbToXyz)}

${formatMatrix("HCS_BRADFORD_TO_D65", derived.bradfordNativeToD65)}

${formatMatrix("HCS_BRADFORD_WITH_BLACK_TO_D65", derived.bradfordNativeWithBlackToD65)}

${formatMatrix("HCS_SRGB_XYZ_TO_LINEAR_RGB", derived.srgbXyzToLinearRgb)}

const vec3 HCS_BLACK_XYZ_NORMALIZED = vec3(
   ${derived.blackXyzNormalizedByRawWhiteY.map(formatFloat).join(", ")}
);
${DISPLAY_END}`;
}

function replaceBlock(source, begin, end, block, file) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start < 0 || finish < start) {
    throw new Error(`${file}: missing generated markers ${begin}`);
  }
  return source.slice(0, start) + block + source.slice(finish + end.length);
}

function compareOrWrite(file, expected) {
  const actual = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (checkOnly) {
    if (actual !== expected) fail(`${path.relative(root, file)} is stale; run node tools/build-ags101-hcs-color.mjs`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, expected);
  }
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const derived = derive(source);
const generatedJson = `${JSON.stringify(cleanDeep(derived), null, 2)}\n`;
compareOrWrite(generatedPath, generatedJson);

for (const shaderPath of shaderPaths) {
  const sourceText = fs.readFileSync(shaderPath, "utf8");
  const isDisplay = shaderPath.endsWith("ags101-display-v1.slang");
  const isExposure = shaderPath.endsWith("ags101-exposure-optics.inc");
  const expected = isDisplay
    ? replaceBlock(sourceText, DISPLAY_BEGIN, DISPLAY_END, displayBlock(derived), shaderPath)
    : (isExposure
      ? replaceBlock(sourceText, EXPOSURE_BEGIN, EXPOSURE_END, exposureBlock(derived), shaderPath)
      : replaceBlock(sourceText, RESPONSE_BEGIN, RESPONSE_END, responseBlock(derived), shaderPath));
  compareOrWrite(shaderPath, expected);
}

console.log(checkOnly
  ? "AGS-101 HCS generated color artifacts are current."
  : "Generated AGS-101 HCS color artifacts and shader constants.");
