#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  apertureCoverage,
  contrastState,
  deltaE00,
  deltaE00Lab,
  opticalColor,
  srgbDecodeChannel,
  srgbEncodeChannel,
  srgbFloatTo8,
} from "../models/nintendo-dmg-01/reference/optical-pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const reconstructionPath = path.join(modelDir, "data", "reconstruction-v1.json");
const generatedDir = path.join(modelDir, "generated");
const scenePath = path.join(generatedDir, "ws1-static-v1.png");
const reportPath = path.join(generatedDir, "ws1-perceptual-v1.json");
const checkOnly = process.argv.includes("--check");
const sourceFlag = process.argv.indexOf("--verify-sources");
const sourceDir = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const cieDe2000ReferencePairs = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
];
for (const [labA, labB, expected] of cieDe2000ReferencePairs) {
  const actual = deltaE00Lab(labA, labB);
  if (Math.abs(actual - expected) > 0.0001) fail(`CIEDE2000 self-test failed: ${actual} != ${expected}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cleanNumber(value) {
  return Number(value.toFixed(6));
}

function cleanDeep(value) {
  if (typeof value === "number") return cleanNumber(value);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
  }
  return value;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const target = y * (1 + width * 3);
    scanlines[target] = 0;
    rgb.copy(scanlines, target + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function setPixel(rgb, width, x, y, color) {
  const offset = (y * width + x) * 3;
  rgb[offset] = color[0];
  rgb[offset + 1] = color[1];
  rgb[offset + 2] = color[2];
}

function fillRect(rgb, width, x, y, rectWidth, rectHeight, color) {
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) setPixel(rgb, width, px, py, color);
  }
}

function mixLinearSrgb8(background, foreground, amount) {
  return background.map((value, channel) => Math.round(255 * srgbEncodeChannel(
    srgbDecodeChannel(value / 255) * (1 - amount)
      + srgbDecodeChannel(foreground[channel] / 255) * amount,
  )));
}

function buildScene(palette) {
  const width = 640;
  const height = 392;
  const rgb = Buffer.alloc(width * height * 3, 63);
  const stateColor = (state) => srgbFloatTo8(opticalColor(state, palette));

  for (let index = 0; index < 5; index += 1) {
    fillRect(rgb, width, 24 + index * 116, 24, 108, 56, stateColor(index / 4));
  }
  for (let x = 0; x < 580; x += 1) {
    fillRect(rgb, width, 24 + x, 104, 1, 48, stateColor(x / 579));
  }
  for (let index = 0; index < 4; index += 1) {
    fillRect(rgb, width, 24 + index * 145, 176, 137, 48, stateColor(0.25 + index * 0.25));
  }
  const contrasts = [0.6, 1.0, 1.55];
  contrasts.forEach((contrast, group) => {
    for (let shade = 0; shade < 4; shade += 1) {
      const state = contrastState(0.25 + shade * 0.25, contrast, 0);
      fillRect(rgb, width, 24 + group * 196 + shade * 46, 248, 46, 48, stateColor(state));
    }
  });
  const background = stateColor(0);
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < 580; x += 1) {
      const sourceX = Math.floor(x / 4);
      const sourceY = Math.floor(y / 4);
      const localX = (x % 4 + 0.5) / 4;
      const localY = (y % 4 + 0.5) / 4;
      const coverage = apertureCoverage(localX, 4, 0.875)
        * apertureCoverage(localY, 4, 0.875);
      const shade = (Math.floor(sourceX / 8) + Math.floor(sourceY / 4)) % 4;
      const foreground = stateColor(0.25 + shade * 0.25);
      setPixel(rgb, width, 24 + x, 320 + y, mixLinearSrgb8(background, foreground, coverage));
    }
  }
  return {
    width,
    height,
    png: encodePng(width, height, rgb),
    regions: [
      { id: "five-optical-states", rect: [24, 24, 572, 56] },
      { id: "continuous-five-state-gradient", rect: [24, 104, 580, 48] },
      { id: "four-logical-shades", rect: [24, 176, 572, 48] },
      { id: "contrast-wheel-minimum-nominal-maximum", rect: [24, 248, 576, 48], contrasts },
      { id: "four-times-aperture-and-gap", rect: [24, 320, 580, 48], shadowEnabled: false },
    ],
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodeIndexedPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("invalid PNG signature");
  let offset = 8;
  let header;
  let palette;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.colorType !== 3 || ![4, 8].includes(header.bitDepth)
      || header.interlace !== 0 || !palette) {
    throw new Error("source verifier supports non-interlaced 4-bit or 8-bit indexed PNG only");
  }
  const rowBytes = Math.ceil(header.width * header.bitDepth / 8);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = [];
  let inputOffset = 0;
  let prior = Buffer.alloc(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const encoded = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x > 0 ? row[x - 1] : 0;
      const up = prior[x] ?? 0;
      const upperLeft = x > 0 ? prior[x - 1] : 0;
      if (filter === 0) row[x] = encoded[x];
      else if (filter === 1) row[x] = (encoded[x] + left) & 0xff;
      else if (filter === 2) row[x] = (encoded[x] + up) & 0xff;
      else if (filter === 3) row[x] = (encoded[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (encoded[x] + paeth(left, up, upperLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    prior = row;
  }
  const getRgb = (x, y) => {
    const packed = rows[y];
    const index = header.bitDepth === 8
      ? packed[x]
      : ((packed[Math.floor(x / 2)] >> (x % 2 === 0 ? 4 : 0)) & 0x0f);
    return [...palette.subarray(index * 3, index * 3 + 3)];
  };
  return { ...header, getRgb };
}

function verifySources(reconstruction, directory) {
  if (!directory) return;
  for (const [id, source] of Object.entries(reconstruction.optical.sourceImages)) {
    const filePath = path.join(directory, source.fileName);
    if (!fs.existsSync(filePath)) fail(`missing BGB source image: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    if (sha256(buffer) !== source.sha256) fail(`${id}: BGB source hash mismatch`);
    const image = decodeIndexedPng(buffer);
    if (image.width !== source.dimensions[0] || image.height !== source.dimensions[1]) {
      fail(`${id}: BGB source dimensions mismatch`);
    }
    for (const sample of source.samples ?? []) {
      if (sample.crop.width !== 1 || sample.crop.height !== 1) fail(`${id}: unsupported crop size`);
      const actual = image.getRgb(sample.crop.x, sample.crop.y);
      if (actual.join(",") !== sample.srgb8.join(",")) fail(`${id}: sample mismatch at ${sample.crop.x},${sample.crop.y}`);
    }
    for (const sample of source.scanline?.boundarySamples ?? []) {
      const actual = image.getRgb(sample.x, source.scanline.y);
      if (actual.join(",") !== sample.srgb8.join(",")) fail(`${id}: boundary mismatch at ${sample.x},${source.scanline.y}`);
    }
  }
  console.log(`BGB source hashes, dimensions, and sampled coordinates verified from ${directory}.`);
}

function buildReport(reconstruction, scene) {
  const palette = reconstruction.optical.states.map((state) => state.srgb8);
  const paletteComparisons = reconstruction.optical.sourceImages.palette.samples.map((sample, index) => {
    const modelSrgb8 = srgbFloatTo8(opticalColor(index / 4, palette));
    return {
      id: sample.stateId,
      sourceCrop: sample.crop,
      sourceSrgb8: sample.srgb8,
      modelSrgb8,
      maximumChannelError8bit: Math.max(...modelSrgb8.map(
        (value, channel) => Math.abs(value - sample.srgb8[channel]),
      )),
      deltaE00: deltaE00(sample.srgb8, modelSrgb8),
    };
  });
  const gradientComparisons = reconstruction.optical.sourceImages.gradient.samples.map((sample) => {
    const modelSrgb8 = srgbFloatTo8(opticalColor((sample.segment + 0.5) / 4, palette));
    return {
      id: `segment-${sample.segment}-midpoint`,
      sourceCrop: sample.crop,
      sourceSrgb8: sample.srgb8,
      modelSrgb8,
      maximumChannelError8bit: Math.max(...modelSrgb8.map(
        (value, channel) => Math.abs(value - sample.srgb8[channel]),
      )),
      deltaE00: deltaE00(sample.srgb8, modelSrgb8),
    };
  });
  const acceptance = reconstruction.optical.ws1Acceptance;
  const maximumPaletteDeltaE00 = Math.max(...paletteComparisons.map((item) => item.deltaE00));
  const maximumGradientMidpointDeltaE00 = Math.max(...gradientComparisons.map((item) => item.deltaE00));
  return cleanDeep({
    schemaVersion: 1,
    reportId: "nintendo-dmg-01-ws1-perceptual-v1",
    generatedFrom: "data/reconstruction-v1.json",
    evidenceId: "DMG-COLOR-01",
    metric: acceptance.perceptualMetric,
    sourceVerification: {
      method: "SHA-256, PNG dimensions, and zero-based 1x1 sample coordinates",
      command: "node tools/build-dmg01-ws1.mjs --check --verify-sources <download-directory>",
      redistribution: "BGB source images are not stored in this repository",
    },
    paletteComparisons,
    gradientComparisons,
    summary: {
      maximumPaletteDeltaE00,
      maximumGradientMidpointDeltaE00,
      paletteThreshold: acceptance.maximumPaletteDeltaE00,
      gradientMidpointThreshold: acceptance.maximumGradientMidpointDeltaE00,
      pass: maximumPaletteDeltaE00 <= acceptance.maximumPaletteDeltaE00
        && maximumGradientMidpointDeltaE00 <= acceptance.maximumGradientMidpointDeltaE00,
    },
    scene: {
      file: "generated/ws1-static-v1.png",
      sha256: sha256(scene.png),
      dimensions: [scene.width, scene.height],
      regions: scene.regions,
      claimBoundary: "The scene validates model-space sRGB and aperture construction; it does not measure emitted target-panel color.",
    },
  });
}

if (sourceFlag >= 0 && !sourceDir) fail("--verify-sources requires a directory");
const reconstruction = JSON.parse(fs.readFileSync(reconstructionPath, "utf8"));
verifySources(reconstruction, sourceDir);
const palette = reconstruction.optical.states.map((state) => state.srgb8);
const scene = buildScene(palette);
const report = buildReport(reconstruction, scene);
if (!report.summary.pass) fail("WS1 perceptual acceptance thresholds failed");
const reportBuffer = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);

if (checkOnly) {
  if (!fs.existsSync(scenePath) || !fs.readFileSync(scenePath).equals(scene.png)) {
    fail("DMG WS1 static scene is missing or stale; run node tools/build-dmg01-ws1.mjs");
  }
  if (!fs.existsSync(reportPath) || !fs.readFileSync(reportPath).equals(reportBuffer)) {
    fail("DMG WS1 perceptual report is missing or stale; run node tools/build-dmg01-ws1.mjs");
  }
  console.log("DMG-01 WS1 static scene and perceptual report are current.");
} else {
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(scenePath, scene.png);
  fs.writeFileSync(reportPath, reportBuffer);
  console.log(`Wrote ${path.relative(root, scenePath)}.`);
  console.log(`Wrote ${path.relative(root, reportPath)}.`);
}
