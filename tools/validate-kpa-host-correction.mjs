import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "targets/konkr-gt78-vn/960x640-srgb-neutral");
const host = path.join(target, "host-correction/kpa-reference-b57-g7-v1");
const manifestPath = path.join(host, "kpa-reference-b57-g7-v1.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

assert.equal(manifest.applicationLayer, "retroarch-local");
assert.equal(manifest.mutualExclusionGroup, "kpa-host-correction");
assert.equal(manifest.profileScope, "reference-unit-model-default");
assert.equal(manifest.measurement.sourceSha256,
  "39d054fb2b446059b9513fabc0e33af5303746dc5d8a7ddae6e056f2a7588e28");
assert.equal(manifest.validation.status, "framebuffer-validated-optical-validation-pending");
assert.ok(manifest.limitations.some((value) => value.includes("Never combine")));

const framebufferRecordPath = path.resolve(host, manifest.validation.framebuffer.record);
const framebufferRecord = JSON.parse(fs.readFileSync(framebufferRecordPath, "utf8"));
assert.equal(framebufferRecord.result, "pass-framebuffer-optical-validation-pending");
assert.equal(framebufferRecord.comparison.acceptance.passed, true);
assert.ok(framebufferRecord.comparison.baseToLocal.changedPixels > 600000);
assert.ok(framebufferRecord.comparison.cpuPredictionToLocal.meanAbsoluteChannelError <= 0.25);
assert.ok(framebufferRecord.comparison.cpuPredictionToLocal.maxAbsoluteChannelError <= 3);
assert.ok(framebufferRecord.comparison.cpuPredictionToLocal.p95PixelMaxError <= 1);

const texture = path.join(host, manifest.runtime.texture);
const png = fs.readFileSync(texture);
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(png.readUInt32BE(16), 4225);
assert.equal(png.readUInt32BE(20), 65);
assert.equal(png[24], 8);
assert.equal(png[25], 2);
assert.equal(digest(texture), manifest.runtime.textureSha256);

const icc = path.join(host, manifest.runtime.characterizationProfile);
assert.equal(digest(icc), manifest.runtime.characterizationProfileSha256);

const shader = fs.readFileSync(path.join(host, "kpa-host-correction-v1.slang"), "utf8");
assert.match(shader, /const int KPA_LUT_SIZE = 65;/);
assert.match(shader, /binding = 4\) uniform sampler2D KpaHostLut;/);
assert.match(shader, /texelFetch\(KpaHostLut/);
assert.match(shader, /mix\(mix\(c00, c10, fraction\.g\), mix\(c01, c11, fraction\.g\), fraction\.b\)/);

const presets = [
  ["ags101-period-reconstruction-kpa-color-corrected.slangp", "4", "shader3"],
  ["dmg01-reference-kpa-color-corrected.slangp", "6", "shader5"],
  ["dmg01-one-year-used-kpa-color-corrected.slangp", "6", "shader5"],
];
for (const [name, count, finalShader] of presets) {
  const presetPath = path.join(target, "presets", name);
  const preset = fs.readFileSync(presetPath, "utf8");
  assert.match(preset, new RegExp(`shaders = "${count}"`));
  assert.match(preset, new RegExp(`${finalShader} = "\\.\\./host-correction/.+kpa-host-correction-v1\\.slang"`));
  assert.match(preset, /KpaHostLut = "\.\.\/host-correction\/.+lut65\.png"/);
  assert.match(preset, /KpaHostCorrection = "1\.0"/);
  assert.match(preset, /Never combine with the Android-system KPA correction matrix/);
}

const targetProfile = JSON.parse(fs.readFileSync(path.join(target, "profile.json"), "utf8"));
assert.equal(targetProfile.colorState.measured, true);
assert.equal(targetProfile.hostCorrectionProfiles["retroarch-local"].profileId, manifest.profileId);
assert.equal(targetProfile.hostCorrectionProfiles["retroarch-local"].validationStatus,
  "framebuffer-validated-optical-validation-pending");
assert.ok(targetProfile.validationRecords.includes(
  "validation/kpa-host-correction-framebuffer-20260822.json"));

for (const name of ["mgba-gba-kpa-color-corrected.slangp", "gambatte-gb-kpa-color-corrected.slangp"]) {
  const override = fs.readFileSync(path.join(root, "integrations/retroarch/overrides", name), "utf8");
  assert.match(override, /kpa-color-corrected\.slangp/);
}

console.log("KPA host-correction profile, LUT, shader, and presets: OK");
