#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputFlag = process.argv.indexOf("--input");
const outputFlag = process.argv.indexOf("--output");
const inputPath = inputFlag >= 0 ? path.resolve(process.argv[inputFlag + 1]) : null;
const outputPath = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : null;
if (!inputPath) {
  console.error("usage: node tools/analyze-dmg01-gpu-capture.mjs --input <png> [--output <json>]");
  process.exit(1);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("invalid PNG signature");
  let offset = 8;
  let header;
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
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.bitDepth !== 8 || ![2, 6].includes(header.colorType)
      || header.interlace !== 0) {
    throw new Error("capture analyzer supports non-interlaced 8-bit RGB/RGBA PNG only");
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * channels;
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
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] ?? 0;
      const upperLeft = x >= channels ? prior[x - channels] : 0;
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
  const getRgb = (x, y) => [...rows[y].subarray(x * channels, x * channels + 3)];
  return { ...header, getRgb };
}

function includeArray(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    `const float ${escaped}\\[[^\\]]+\\] = float\\[]\\(([^;]+)\\);`,
  ));
  if (!match) throw new Error(`missing generated include array ${name}`);
  return match[1].split(",").map(Number);
}

function lookup(values, coordinate) {
  const position = Math.max(0, Math.min(1, coordinate)) * (values.length - 1);
  const low = Math.min(Math.floor(position), values.length - 2);
  return values[low] + (values[low + 1] - values[low]) * (position - low);
}

function rgb565(value) {
  const r = Math.round(value * 31) * 255 / 31;
  const g = Math.round(value * 63) * 255 / 63;
  return [r, g, r].map((channel) => Math.round(channel));
}

const captureBuffer = fs.readFileSync(inputPath);
const image = decodePng(captureBuffer);
if (image.width !== 960 || image.height !== 640) {
  throw new Error(`expected 960x640 KONKR capture, got ${image.width}x${image.height}`);
}
const include = fs.readFileSync(path.join(
  root,
  "models",
  "nintendo-dmg-01",
  "shaders",
  "dmg01-stn-surrogate.inc",
), "utf8");
const targets = includeArray(include, "DMG_PHYSICAL_TARGET_Q").slice(4, 8);
const optical = includeArray(include, "DMG_PHYSICAL_OPTICAL");
const expectedStates = targets.map((coordinate) => lookup(optical, coordinate));
const viewport = { x: 160, y: 32, width: 640, height: 576, scale: 4 };

const samples = [];
for (let shade = 0; shade < 4; shade += 1) {
  const pixels = [];
  for (let sourceX = shade; sourceX < 160; sourceX += 4) {
    const x = viewport.x + sourceX * viewport.scale + 1;
    for (let sourceY = 16; sourceY < 128; sourceY += 16) {
      const y = viewport.y + sourceY * viewport.scale + 1;
      pixels.push(image.getRgb(x, y));
    }
  }
  const observed = [0, 1, 2].map((channel) => (
    pixels.reduce((sum, pixel) => sum + pixel[channel], 0) / pixels.length
  ));
  const expected = rgb565(expectedStates[shade]);
  const maximumChannelError = Math.max(...observed.map(
    (value, channel) => Math.abs(value - expected[channel]),
  ));
  samples.push({
    shade,
    expectedOpticalState: Number(expectedStates[shade].toFixed(9)),
    expectedRgb565: expected,
    observedRgb: observed.map((value) => Number(value.toFixed(3))),
    maximumChannelError: Number(maximumChannelError.toFixed(3)),
  });
}

const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws7-gpu-static-v1",
  capture: path.basename(inputPath),
  captureSha256: crypto.createHash("sha256").update(captureBuffer).digest("hex"),
  captureDimensions: [image.width, image.height],
  viewport,
  comparison: "Generated CPU director-to-optical LUT sampled at the four nominal equilibrium coordinates versus DebugView=4 GPU output after the final RGBA8 pass and RGB565 swapchain.",
  tolerance8Bit: 6,
  samples,
  maximumChannelError: Math.max(...samples.map((sample) => sample.maximumChannelError)),
};
report.pass = report.maximumChannelError <= report.tolerance8Bit;

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exit(1);
