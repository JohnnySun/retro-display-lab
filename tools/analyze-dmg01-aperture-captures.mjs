#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const exactPath = argument("--exact4");
const fractionalPath = argument("--fractional");
const outputPath = argument("--output");
if (!exactPath || !fractionalPath) {
  console.error("usage: node tools/analyze-dmg01-aperture-captures.mjs --exact4 <png> --fractional <png> [--output <json>]");
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
    getRgb(x, y) {
      return [...rows[y].subarray(x * channels, x * channels + 3)];
    },
  };
}

function srgbDecode8(value) {
  const encoded = value / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function analyze(file, viewport, scale) {
  const buffer = fs.readFileSync(file);
  const image = decodePng(buffer);
  if (image.width !== 960 || image.height !== 640) {
    throw new Error(`expected 960x640 capture, got ${image.width}x${image.height}`);
  }
  const total = [0, 0, 0];
  const count = viewport.width * viewport.height;
  for (let y = viewport.y; y < viewport.y + viewport.height; y += 1) {
    for (let x = viewport.x; x < viewport.x + viewport.width; x += 1) {
      const rgb = image.getRgb(x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        total[channel] += srgbDecode8(rgb[channel]);
      }
    }
  }
  const linearRgbAverage = total.map((value) => value / count);
  return {
    file: path.basename(file),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    viewport,
    scale,
    linearRgbAverage: linearRgbAverage.map((value) => Number(value.toFixed(9))),
    linearLuminanceAverage: Number((
      0.2126 * linearRgbAverage[0]
      + 0.7152 * linearRgbAverage[1]
      + 0.0722 * linearRgbAverage[2]
    ).toFixed(9)),
  };
}

const exact = analyze(exactPath, { x: 160, y: 32, width: 640, height: 576 }, 4);
const fractional = analyze(fractionalPath, { x: 200, y: 68, width: 560, height: 504 }, 3.5);
const channelDifferences = exact.linearRgbAverage.map(
  (value, channel) => Math.abs(value - fractional.linearRgbAverage[channel]),
);
const luminanceDifference = Math.abs(
  exact.linearLuminanceAverage - fractional.linearLuminanceAverage,
);
const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws6-konkr-scale-comparison-v1",
  comparison: "Settled deterministic four-shade/aperture pattern at exact 4x and centered fractional 3.5x on the same KONKR Vulkan path.",
  exact,
  fractional,
  maximumLinearChannelDifference: Number(Math.max(...channelDifferences).toFixed(9)),
  linearLuminanceDifference: Number(luminanceDifference.toFixed(9)),
  tolerance: 0.002,
};
report.pass = report.maximumLinearChannelDifference <= report.tolerance
  && report.linearLuminanceDifference <= report.tolerance;
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exit(1);
