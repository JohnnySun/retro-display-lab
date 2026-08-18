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

const requiredProjectFiles = [
  "README.md",
  "README.zh-tw.md",
  "README.zh-cn.md",
  "REFERENCES.md",
  "CITATION.cff",
  "docs/reference-policy.md",
  "models/nintendo-dmg-01/REFERENCES.md",
  "models/nintendo-ags-101/REFERENCES.md",
  "targets/konkr-gt78-vn/960x640-srgb-neutral/REFERENCES.md",
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
  check(source.includes("archive/refs/tags/v0.3.0.zip"), `${file}: missing fixed-version download link`);
  check(source.includes("960x640-srgb-neutral/presets/dmg01-reference-v1.slangp"), `${file}: missing tested install path`);
  check(source.includes("models/nintendo-dmg-01/REFERENCES.md"), `${file}: missing DMG evidence-map link`);
  check(source.includes("models/nintendo-ags-101/REFERENCES.md"), `${file}: missing AGS evidence-map link`);
}

const modelMetadata = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
check(modelMetadata.references === "REFERENCES.md", "model metadata lost reference map");
check(Array.isArray(modelMetadata.evidenceIds), "model metadata has no evidence IDs");
for (const id of modelMetadata.evidenceIds ?? []) {
  check(definedEvidenceIds.has(id), `model metadata contains undefined evidence ID ${id}`);
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
check(targetProfile.references === "REFERENCES.md", "target profile lost reference map");
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
