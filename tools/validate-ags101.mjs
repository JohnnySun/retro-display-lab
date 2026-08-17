#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const shaderDir = path.join(modelDir, "shaders");
const presetDir = path.join(modelDir, "presets");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const references = fs.readFileSync(path.join(modelDir, "REFERENCES.md"), "utf8");
const evidenceIds = new Set(
  [...references.matchAll(/^### (AGS-[A-Z]+-\d+)\b/gm)].map((match) => match[1]),
);
check(evidenceIds.size === 8, `AGS evidence map is incomplete: ${evidenceIds.size} IDs`);

function checkEvidence(source, file) {
  check(source.includes("REFERENCES.md"), `${file}: missing REFERENCES.md pointer`);
  const used = [...source.matchAll(/\[(AGS-[A-Z]+-\d+)\]/g)].map((match) => match[1]);
  check(used.length > 0, `${file}: missing AGS evidence ID`);
  for (const id of used) check(evidenceIds.has(id), `${file}: undefined evidence ID ${id}`);
}

const shaderFiles = fs.readdirSync(shaderDir).filter((file) => file.endsWith(".slang")).sort();
const presetFiles = fs.readdirSync(presetDir).filter((file) => file.endsWith(".slangp")).sort();
check(shaderFiles.length === 2, `expected 2 AGS shaders, found ${shaderFiles.length}`);
check(presetFiles.length === 3, `expected 3 AGS presets, found ${presetFiles.length}`);

const forbiddenHcsTokens = [
  "HANDHELD_RGB_LIN_TO_XYZ",
  "CAT_BRADFORD_HANDHELD_TO_SRGB",
  "BLACK_NATIVE_LINEAR",
  "GAMMA_R[32]",
  "GAMMA_G[32]",
  "GAMMA_B[32]",
  "0.425287783341",
  "0.00420072",
  "e688fc51141c0974728aa1bdcb89b94d74123f6b",
];

for (const file of shaderFiles) {
  const source = fs.readFileSync(path.join(shaderDir, file), "utf8");
  checkEvidence(source, file);
  check(source.includes("#version 450"), `${file}: missing GLSL 450 declaration`);
  check(source.includes("#pragma stage vertex"), `${file}: missing vertex stage`);
  check(source.includes("#pragma stage fragment"), `${file}: missing fragment stage`);
  for (const token of forbiddenHcsTokens) {
    check(!source.includes(token), `${file}: contains forbidden HCS-derived token ${token}`);
  }
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
  ];
  for (const target of localReferences) {
    check(fs.existsSync(path.resolve(presetDir, target)), `${file}: missing reference ${target}`);
  }
}

const responseSource = fs.readFileSync(path.join(shaderDir, "ags101-response-v1.slang"), "utf8");
check(responseSource.includes("PassFeedback0"), "AGS response lost causal feedback");
check(responseSource.includes("nearest_rgb555_code"), "AGS response lost from/to code recovery");
check(responseSource.includes("MidGrayDrag"), "AGS response lost GtG middle-gray term");
check(responseSource.includes("encode_ion_state"), "AGS response lost residual-DC state");
check(responseSource.includes("srgb_decode_channel"), "AGS public response lost neutral adapter");

const displaySource = fs.readFileSync(path.join(shaderDir, "ags101-display-v1.slang"), "utf8");
check(displaySource.includes("integrate_aperture"), "AGS display lost analytic aperture integration");
check(displaySource.includes("leftMask.bgr"), "AGS display lost BGR ordering");
check(displaySource.includes("srgb_encode_channel"), "AGS display lost neutral host encoding");

const srgbDecode = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const opticalLevel = (index) => srgbDecode(index / 31);
const fps = 59.7275;
const candidate = { rise: 0.620, fall: 0.450, near: 0.250, middle: 0.200 };

function nearestCode(optical) {
  let nearest = 0;
  let error = Infinity;
  for (let index = 0; index < 32; index += 1) {
    const candidateError = Math.abs(opticalLevel(index) - optical);
    if (candidateError < error) {
      nearest = index;
      error = candidateError;
    }
  }
  return nearest;
}

function response(from, to) {
  const fromCode = from / 31;
  const toCode = to / 31;
  const distance = Math.abs(toCode - fromCode);
  const nearWeight = (1 - distance) ** 2;
  const midpoint = 0.5 * (fromCode + toCode);
  const middleWeight = 4 * midpoint * (1 - midpoint) * nearWeight;
  const base = to >= from ? candidate.rise : candidate.fall;
  return base * (1 - candidate.near * nearWeight) * (1 - candidate.middle * middleWeight);
}

function crossingFrame(from, to, threshold) {
  const initial = opticalLevel(from);
  const target = opticalLevel(to);
  let current = initial;
  let previousProgress = 0;
  for (let frame = 1; frame <= 180; frame += 1) {
    current += (target - current) * response(nearestCode(current), to);
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

const charge30Minutes = 1 - Math.exp(-(30 * 60) / 900);
const release2Minutes = Math.exp(-120 / 120);
check(charge30Minutes >= 0.86 && charge30Minutes <= 0.87, `AGS 30-minute charge drifted: ${charge30Minutes}`);
check(release2Minutes >= 0.36 && release2Minutes <= 0.38, `AGS 2-minute release drifted: ${release2Minutes}`);

const metadata = JSON.parse(fs.readFileSync(path.join(modelDir, "model.json"), "utf8"));
check(metadata.references === "REFERENCES.md", "AGS metadata lost reference map");
for (const id of metadata.evidenceIds ?? []) {
  check(evidenceIds.has(id), `AGS metadata contains undefined evidence ID ${id}`);
}

const targetProfile = JSON.parse(fs.readFileSync(
  path.join(root, "targets", "konkr-gt78-vn", "960x640-srgb-neutral", "profile.json"),
  "utf8",
));
const agsTarget = targetProfile.additionalContent?.["Nintendo GBA SP AGS-101 physics seed"];
check(Boolean(agsTarget), "KPA profile lost AGS-101 target geometry");
check(agsTarget?.contentViewport?.join("x") === "960x640", "KPA AGS viewport is not 960x640");
check(agsTarget?.integerScale === 4, "KPA AGS target lost exact 4x scale");

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
