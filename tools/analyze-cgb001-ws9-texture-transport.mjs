#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeReadbackPng } from "./decode-cgb001-ws9-readback.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const ignored = new Set([outputIndex, outputIndex + 1]);
const files = args.filter((_arg, index) => !ignored.has(index));
if (files.length !== 2) {
  throw new Error("usage: node tools/analyze-cgb001-ws9-texture-transport.mjs REJECTED_RGBA16.png PAIRED_RGBA8.png [--output report.json]");
}

const lutPath = path.join(root, "models/nintendo-cgb-001/generated/cgb001-d65-lut-v1.rgba32f");
const lut = fs.readFileSync(lutPath);
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function inspect(file, classification, tolerance) {
  const decoded = decodeReadbackPng(file, "lut");
  const valid = decoded.tiles.filter((tile) => tile.valid);
  let maximumAbsoluteXyzError = 0;
  let totalAbsoluteXyzError = 0;
  let components = 0;
  let worst = null;
  for (const tile of valid) {
    const [r, g, b] = tile.sourceRgb555;
    const index = (b * 32 + g) * 32 + r;
    for (let component = 0; component < 3; component += 1) {
      const expected = lut.readFloatLE(index * 16 + component * 4);
      const actual = tile.xyz[component];
      const error = Math.abs(expected - actual);
      if (error > maximumAbsoluteXyzError) {
        maximumAbsoluteXyzError = error;
        worst = { rgb555: tile.sourceRgb555, component, expected, actual, error };
      }
      totalAbsoluteXyzError += error;
      components += 1;
    }
  }
  return {
    path: path.relative(root, file),
    sha256: sha256(fs.readFileSync(file)),
    classification,
    validCodes: valid.length,
    invalidTiles: decoded.tiles.length - valid.length,
    minimumUnanimousBitsPerWord: Math.min(...decoded.tiles.flatMap((tile) => tile.unanimousBits)),
    components,
    maximumAbsoluteXyzError,
    meanAbsoluteXyzError: totalAbsoluteXyzError / components,
    tolerance,
    worst,
    pass: valid.length === 32
      && decoded.tiles.length - valid.length === 8
      && Math.min(...decoded.tiles.flatMap((tile) => tile.unanimousBits)) === 32
      && maximumAbsoluteXyzError <= tolerance,
  };
}

const rejected = inspect(files[0], "rejected-single-RGBA16-PNG-generic-loader-probe", 8.5e-6);
const accepted = inspect(files[1], "accepted-paired-RGBA8-high-low-byte-uint16-reconstruction", 8.5e-6);
const report = {
  schemaVersion: 1,
  reportId: "cgb001-ws9-konkr-texture-transport-v1",
  authoritativeLut: {
    path: path.relative(root, lutPath),
    sha256: sha256(lut),
  },
  rejected,
  accepted,
  finding: "RetroArch's generic PNG loader presented the nominal RGBA16 probe to the shader at 8-bit precision. Paired nearest-filtered RGBA8 high/low planes preserve one explicit uint16 code per component and remain traceable to the unchanged RGBA32F LUT.",
  pass: rejected.pass === false && accepted.pass === true,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized);
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
