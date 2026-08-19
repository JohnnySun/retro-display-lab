#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  applySpatialKernelSurrogate,
  spatialKernelSurrogateFeatures,
} from "../models/nintendo-dmg-01/reference/passive-matrix-crosstalk.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directoryFlag = process.argv.indexOf("--directory");
const outputFlag = process.argv.indexOf("--output");
const directory = directoryFlag >= 0 ? path.resolve(process.argv[directoryFlag + 1]) : null;
const outputPath = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1]) : null;
if (!directory) {
  console.error("usage: node tools/analyze-dmg01-crosstalk-captures.mjs --directory <frames> [--output <json>]");
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
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.bitDepth !== 8 || ![2, 6].includes(header.colorType)
      || header.interlace !== 0) throw new Error("unsupported PNG format");
  const channels = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = [];
  let inputOffset = 0;
  let prior = Buffer.alloc(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[inputOffset++];
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
  return {
    ...header,
    getRgb(x, y) { return [...rows[y].subarray(x * channels, x * channels + 3)]; },
  };
}

function percentile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = probability * (sorted.length - 1);
  const low = Math.floor(position);
  const fraction = position - low;
  return sorted[low] * (1 - fraction) + sorted[Math.min(low + 1, sorted.length - 1)] * fraction;
}

function rgb565Gray(value) {
  const red = Math.round(value * 31) * 255 / 31;
  const green = Math.round(value * 63) * 255 / 63;
  return (red + green + red) / 3;
}

const report = JSON.parse(fs.readFileSync(path.join(
  root, "models/nintendo-dmg-01/generated/ws5-crosstalk-v1.json",
), "utf8"));
const coefficients = report.selectedShaderSurrogate;
const fit = {
  coefficients: coefficients.coefficients,
  alternatingCoefficients: coefficients.alternatingCoefficients,
};
const viewport = { x: 160, y: 32, width: 640, height: 576, scale: 4 };
const specs = [
  { id: "single-dot", file: "RDL-DMG-WS5-Single-Dot-stable-frame.png" },
  { id: "full-row", file: "RDL-DMG-WS5-Full-Row-stable-frame.png" },
  { id: "full-column", file: "RDL-DMG-WS5-Full-Column-stable-frame.png" },
  { id: "checkerboard", file: "RDL-DMG-WS5-Checkerboard-stable-frame.png" },
  { id: "alternating-lines", file: "RDL-DMG-WS5-Alternating-Lines-stable-frame.png" },
  { id: "window", file: "RDL-DMG-WS5-Window-stable-frame.png" },
  { id: "inverse-window", file: "RDL-DMG-WS5-Inverse-Window-stable-frame.png" },
];

function romPattern(id) {
  const columns = 160;
  const rows = 144;
  const shades = new Uint8Array(columns * rows);
  const set = (x, y, value) => { shades[y * columns + x] = value; };
  if (id === "single-dot") set(84, 75, 3);
  else if (id === "full-row") for (let x = 0; x < columns; x += 1) set(x, 75, 3);
  else if (id === "full-column") for (let y = 0; y < rows; y += 1) set(84, y, 3);
  else if (id === "checkerboard") {
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      set(x, y, (x + y) & 1 ? 3 : 0);
    }
  } else if (id === "alternating-lines") {
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      set(x, y, y & 1 ? 3 : 0);
    }
  } else if (id === "window" || id === "inverse-window") {
    shades.fill(id === "inverse-window" ? 3 : 0);
    for (let y = 40; y < 112; y += 1) for (let x = 40; x < 120; x += 1) {
      set(x, y, id === "inverse-window" ? 0 : 3);
    }
  } else throw new Error(`unknown capture pattern ${id}`);
  return { columns, rows, shades };
}

const patterns = [];
for (const spec of specs) {
  const file = path.join(directory, spec.file);
  const buffer = fs.readFileSync(file);
  const image = decodePng(buffer);
  if (image.width !== 960 || image.height !== 640) {
    throw new Error(`${spec.file}: expected 960x640, got ${image.width}x${image.height}`);
  }
  const pattern = romPattern(spec.id);
  const errors = [];
  const signedErrors = [];
  let expectedDarkSum = 0;
  let observedDarkSum = 0;
  let darkCount = 0;
  for (let y = 0; y < pattern.rows; y += 1) {
    for (let x = 0; x < pattern.columns; x += 1) {
      const local = pattern.shades[y * pattern.columns + x];
      const features = spatialKernelSurrogateFeatures(
        pattern.shades, pattern.columns, pattern.rows, x, y,
      );
      const effective = applySpatialKernelSurrogate(local, features, fit) / 3;
      const expected = rgb565Gray(effective);
      const rgb = image.getRgb(
        viewport.x + x * viewport.scale + 2,
        viewport.y + y * viewport.scale + 2,
      );
      const observed = (rgb[0] + rgb[1] + rgb[2]) / 3;
      const error = observed - expected;
      errors.push(Math.abs(error));
      signedErrors.push(error);
      if (local === 3) {
        expectedDarkSum += expected;
        observedDarkSum += observed;
        darkCount += 1;
      }
    }
  }
  const rms = Math.sqrt(signedErrors.reduce((sum, value) => sum + value * value, 0)
    / signedErrors.length);
  patterns.push({
    id: spec.id,
    capture: spec.file,
    captureSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    expectedDarkMean8Bit: Number((expectedDarkSum / Math.max(darkCount, 1)).toFixed(3)),
    observedDarkMean8Bit: Number((observedDarkSum / Math.max(darkCount, 1)).toFixed(3)),
    rmsError8Bit: Number(rms.toFixed(3)),
    p99AbsoluteError8Bit: Number(percentile(errors, 0.99).toFixed(3)),
    maximumAbsoluteError8Bit: Number(Math.max(...errors).toFixed(3)),
  });
}

const output = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws5-konkr-gpu-crosstalk-v2",
  comparison: "CPU implementation of the generated WS5 directional kernel versus DebugView=6 effective-drive output after RGBA8, RGB565, and Android PNG framebuffer capture.",
  viewport,
  tolerance: {
    maximumPatternRms8Bit: 8,
    maximumPatternP99Absolute8Bit: 20,
  },
  patterns,
  maximumPatternRms8Bit: Math.max(...patterns.map((item) => item.rmsError8Bit)),
  maximumPatternP99Absolute8Bit: Math.max(...patterns.map((item) => item.p99AbsoluteError8Bit)),
};
output.pass = output.maximumPatternRms8Bit <= output.tolerance.maximumPatternRms8Bit
  && output.maximumPatternP99Absolute8Bit <= output.tolerance.maximumPatternP99Absolute8Bit;
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!output.pass) process.exit(1);
