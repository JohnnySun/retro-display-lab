#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const sourcePath = path.join(modelDir, "shaders", "dmg01-stn-surrogate.inc");
const runtimeIncludePath = path.join(modelDir, "shaders", "dmg01-stn-runtime-v1.inc");
const rgbPath = path.join(modelDir, "generated", "dmg01-stn-runtime-lut-rgb-v1.png");
const msbPath = path.join(modelDir, "generated", "dmg01-stn-runtime-lut-msb-v1.png");
const descriptorPath = path.join(modelDir, "generated", "dmg01-stn-runtime-lut-v1.json");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function scalar(source, name) {
  const match = source.match(new RegExp(`^const (?:float|int) ${name} = ([^;]+);$`, "m"));
  if (!match) fail(`DMG physical include has no scalar ${name}`);
  return match[1];
}

function array(source, name) {
  const match = source.match(new RegExp(
    `^const float ${name}\\[(\\d+)\\] = float\\[\\]\\(([^;]+)\\);$`, "m",
  ));
  if (!match) fail(`DMG physical include has no array ${name}`);
  const length = Number(match[1]);
  const values = match[2].split(",").map((value) => Math.fround(Number(value.trim())));
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
    fail(`DMG physical array ${name} is malformed`);
  }
  return values;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function deflateStored(buffer) {
  const blocks = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < buffer.length; offset += 65_535) {
    const length = Math.min(65_535, buffer.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === buffer.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    blocks.push(header, buffer.subarray(offset, offset + length));
  }
  let first = 1;
  let second = 0;
  for (const byte of buffer) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(((second << 16) | first) >>> 0);
  blocks.push(checksum);
  return Buffer.concat(blocks);
}

function rgba8Png(rows, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateStored(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeOrCheck(file, expected) {
  const relative = path.relative(root, file);
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
      fail(`${relative} is missing or stale; run node tools/build-dmg01-runtime-lut.mjs`);
    }
  } else if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, expected);
    console.log(`Wrote ${relative}.`);
  }
}

const source = fs.readFileSync(sourcePath, "utf8");
const specs = [
  ["target", "DMG_PHYSICAL_TARGET_Q"],
  ["optical", "DMG_PHYSICAL_OPTICAL"],
  ["opticalAnchor", "DMG_PHYSICAL_OPTICAL_ANCHOR_Q"],
  ["opticalCorrection", "DMG_PHYSICAL_OPTICAL_CORRECTION"],
  ["drift", "DMG_PHYSICAL_DRIFT"],
];
const arrays = [];
const values = [];
for (const [id, name] of specs) {
  const entries = array(source, name);
  arrays.push({ id, sourceName: name, offset: values.length, length: entries.length });
  values.push(...entries);
}

const width = values.length;
const rgbRows = Buffer.alloc(1 + width * 4);
const msbRows = Buffer.alloc(1 + width * 4);
for (let index = 0; index < values.length; index += 1) {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(values[index]);
  const target = 1 + index * 4;
  rgbRows[target] = bytes[0];
  rgbRows[target + 1] = bytes[1];
  rgbRows[target + 2] = bytes[2];
  rgbRows[target + 3] = 255;
  msbRows[target] = bytes[3];
  msbRows[target + 1] = 0;
  msbRows[target + 2] = 0;
  msbRows[target + 3] = 255;

  const decoded = Buffer.from([
    rgbRows[target], rgbRows[target + 1], rgbRows[target + 2], msbRows[target],
  ]).readFloatLE();
  if (!Object.is(decoded, values[index])) fail(`float32 round trip failed at LUT index ${index}`);
}

const rgbPng = rgba8Png(rgbRows, width, 1);
const msbPng = rgba8Png(msbRows, width, 1);
const byId = Object.fromEntries(arrays.map((entry) => [entry.id, entry]));
const runtimeInclude = `// Generated by tools/build-dmg01-runtime-lut.mjs. Do not hand-edit.\n`
  + `// Float32 values are decoded bit-exactly from paired RGBA8 runtime textures.\n`
  + `const float DMG_PHYSICAL_REFRESH_HZ = ${scalar(source, "DMG_PHYSICAL_REFRESH_HZ")};\n`
  + `const float DMG_VISCOSITY_ACTIVATION_K = ${scalar(source, "DMG_VISCOSITY_ACTIVATION_K")};\n`
  + `const int DMG_PHYSICAL_DRIFT_BINS = ${scalar(source, "DMG_PHYSICAL_DRIFT_BINS")};\n`
  + `const int DMG_PHYSICAL_OPTICAL_BINS = ${scalar(source, "DMG_PHYSICAL_OPTICAL_BINS")};\n`
  + `const int DMG_LUT_TARGET_OFFSET = ${byId.target.offset};\n`
  + `const int DMG_LUT_OPTICAL_OFFSET = ${byId.optical.offset};\n`
  + `const int DMG_LUT_OPTICAL_ANCHOR_OFFSET = ${byId.opticalAnchor.offset};\n`
  + `const int DMG_LUT_OPTICAL_CORRECTION_OFFSET = ${byId.opticalCorrection.offset};\n`
  + `const int DMG_LUT_DRIFT_OFFSET = ${byId.drift.offset};\n`
  + `const int DMG_LUT_VALUE_COUNT = ${values.length};\n`;

const descriptor = {
  schemaVersion: 1,
  artifactId: "dmg01-stn-runtime-lut-v1",
  source: {
    path: "../shaders/dmg01-stn-surrogate.inc",
    sha256: sha256(source),
  },
  transport: {
    width,
    height: 1,
    format: "paired RGBA8_UNORM; RGB carries float32 bytes 0-2, second-plane R carries byte 3, alpha fixed at 255",
    decode: "round sampled UNORM channels to bytes, assemble little-endian uint32, uintBitsToFloat",
    exactFloat32RoundTrip: true,
  },
  arrays,
  outputs: {
    rgb: { path: "dmg01-stn-runtime-lut-rgb-v1.png", sha256: sha256(rgbPng) },
    msb: { path: "dmg01-stn-runtime-lut-msb-v1.png", sha256: sha256(msbPng) },
    shaderInclude: {
      path: "../shaders/dmg01-stn-runtime-v1.inc",
      sha256: sha256(runtimeInclude),
    },
  },
};
const descriptorText = `${JSON.stringify(descriptor, null, 2)}\n`;

writeOrCheck(rgbPath, rgbPng);
writeOrCheck(msbPath, msbPng);
writeOrCheck(runtimeIncludePath, Buffer.from(runtimeInclude));
writeOrCheck(descriptorPath, Buffer.from(descriptorText));
if (checkOnly) console.log(`DMG-01 runtime LUT transport is current (${values.length} bit-exact float32 values).`);
