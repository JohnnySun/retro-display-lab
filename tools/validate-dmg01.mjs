#!/usr/bin/env node

import fs from "node:fs";
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

for (const file of shaderFiles.filter((name) => name.endsWith(".slang"))) {
  const source = fs.readFileSync(path.join(shaderDir, file), "utf8");
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
  const references = [
    ...[...source.matchAll(/shader\d+\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/#reference\s+"([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const target of references) {
    const localTarget = path.resolve(presetDir, target);
    check(fs.existsSync(localTarget), `${file}: missing reference ${target}`);
  }
}

const palette = [
  [148, 138, 4],
  [117, 152, 51],
  [88, 143, 81],
  [59, 117, 96],
  [46, 97, 90],
];

const referencePreset = fs.readFileSync(
  path.join(presetDir, "reference-v1.slangp"),
  "utf8",
);
check(referencePreset.includes('PixelFill = "0.875"'), "reference preset lost measured 70/80 aperture fill");
const displayShader = fs.readFileSync(
  path.join(shaderDir, "dmg01-display-v1.slang"),
  "utf8",
);
check(displayShader.includes("overlap / footprint"), "display pass lost host-pixel box coverage");
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// The unpowered reflector is a separate yellow optical state; only the four
// electrically driven shades are expected to darken monotonically.
for (let i = 2; i < palette.length; i += 1) {
  check(luminance(palette[i]) < luminance(palette[i - 1]), `palette state ${i} is not darker`);
}

function settleStructural(target, initial, response, slowTail, frames) {
  let fast = initial;
  let slow = initial;
  for (let i = 0; i < frames; i += 1) {
    fast += (target - fast) * response;
    slow += (target - slow) * Math.max(response * 0.22, 0.008);
  }
  return fast * (1 - slowTail) + slow * slowTail;
}

function framesToProgress(target, initial, response, slowTail, threshold) {
  for (let frames = 1; frames <= 1200; frames += 1) {
    const displayed = settleStructural(target, initial, response, slowTail, frames);
    const progress = Math.abs((displayed - initial) / (target - initial));
    if (progress >= threshold) return frames;
  }
  return Infinity;
}

const frameMilliseconds = 1000 / 59.7275;
const referenceResponse = {
  dark: 0.42,
  clear: 0.23,
  slowTail: 0.08,
  ionicMobility: 0.05,
  stickingOpticalGain: 0.082,
  ionicChargeResponse: 0.000056,
  ionicReleaseResponse: 0.00028,
};
const dark90ms = framesToProgress(
  1.0,
  0.25,
  referenceResponse.dark,
  referenceResponse.slowTail,
  0.9,
) * frameMilliseconds;
const clear90ms = framesToProgress(
  0.25,
  1.0,
  referenceResponse.clear,
  referenceResponse.slowTail,
  0.9,
) * frameMilliseconds;
check(dark90ms >= 90 && dark90ms <= 120, `reference darkening 10-90 time out of range: ${dark90ms}`);
check(clear90ms >= 180 && clear90ms <= 220, `reference clearing 10-90 time out of range: ${clear90ms}`);
check(
  dark90ms + clear90ms >= 280 && dark90ms + clear90ms <= 330,
  `reference combined STN response out of range: ${dark90ms + clear90ms}`,
);

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

const fps = 59.7275;
const exposureFrames = Math.round(30 * 60 * fps);
const chargedAfter30Minutes = 1 - (1 - referenceResponse.ionicChargeResponse) ** exposureFrames;
check(chargedAfter30Minutes >= 0.995, `30-minute STN exposure did not saturate: ${chargedAfter30Minutes}`);

const fullIonicBias = stickingVolts(referenceResponse.ionicMobility)
  * referenceResponse.stickingOpticalGain;
function remainingContrastAfterSaturatedDark(frames) {
  const structural = settleStructural(0.25, 1.0, referenceResponse.clear, referenceResponse.slowTail, frames);
  const ionicCharge = chargedAfter30Minutes
    * (1 - referenceResponse.ionicReleaseResponse) ** frames;
  const displayed = structural + ionicCharge * fullIonicBias;
  return (displayed - 0.25) / 0.75;
}

const clear500msResidual = remainingContrastAfterSaturatedDark(30);
const clear1000msResidual = remainingContrastAfterSaturatedDark(60);
const clear10000msResidual = remainingContrastAfterSaturatedDark(600);
check(
  clear500msResidual >= 0.025 && clear500msResidual <= 0.045,
  `reference 500 ms structural tail out of range: ${clear500msResidual}`,
);
check(
  clear1000msResidual >= 0.015 && clear1000msResidual <= 0.030,
  `reference 1 s retention tail out of range: ${clear1000msResidual}`,
);
check(
  clear10000msResidual >= 0.014 && clear10000msResidual <= 0.020,
  `reference 10 s ionic tail out of range: ${clear10000msResidual}`,
);

const targetProfile = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "profile.json"),
  "utf8",
));
check(targetProfile.panelResolution.join("x") === "960x640", "KPA target resolution drifted");
check(targetProfile.contentViewport.join("x") === "640x576", "KPA DMG viewport drifted");
check(targetProfile.integerScale === 4, "KPA target lost exact 4x DMG scale");
check(targetProfile.colorState.measured === false, "unmeasured target must not claim calibration");
const targetPresetPath = path.join(
  root,
  "targets",
  "konkr-gt78-vn",
  "960x640-srgb-neutral",
  "presets",
  "dmg01-reference-v1.slangp",
);
const targetPreset = fs.readFileSync(targetPresetPath, "utf8");
const targetReference = targetPreset.match(/#reference\s+"([^"]+)"/);
check(Boolean(targetReference), "KPA target preset has no model reference");
if (targetReference) {
  check(
    fs.existsSync(path.resolve(path.dirname(targetPresetPath), targetReference[1])),
    `KPA target preset missing reference ${targetReference[1]}`,
  );
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`DMG-01 static/model checks passed (${shaderFiles.length + presetFiles.length} model files).`);
