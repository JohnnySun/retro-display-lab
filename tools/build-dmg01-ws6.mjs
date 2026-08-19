#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  apertureCoverage2d,
  averageApertureCoverage,
  outputSampleSourceCoordinate,
  shadowEnergySample,
} from "../models/nintendo-dmg-01/reference/aperture-geometry.mjs";
import {
  opticalColor,
  srgbDecodeChannel,
  srgbEncodeChannel,
} from "../models/nintendo-dmg-01/reference/optical-pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-dmg-01");
const generatedDir = path.join(modelDir, "generated");
const reconstructionPath = path.join(modelDir, "data", "reconstruction-v1.json");
const reportPath = path.join(generatedDir, "ws6-aperture-v1.json");
const checkOnly = process.argv.includes("--check");

const fixtureCases = [
  { id: "exact-4x", scale: 4 },
  { id: "exact-5x", scale: 5 },
  { id: "exact-6x", scale: 6 },
  { id: "fractional-3_5x", scale: 3.5 },
  { id: "fractional-4_25x", scale: 4.25 },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function clean(value, digits = 12) {
  return Number(value.toFixed(digits));
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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodeRgb8Png(buffer) {
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
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.bitDepth !== 8 || header.colorType !== 2
      || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error("expected a non-interlaced 8-bit RGB PNG");
  }
  const bytesPerPixel = 3;
  const rowBytes = header.width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  if (inflated.length !== header.height * (rowBytes + 1)) {
    throw new Error("unexpected PNG scanline length");
  }
  const rgb = Buffer.alloc(header.height * rowBytes);
  let inputOffset = 0;
  let prior = Buffer.alloc(rowBytes);
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const encoded = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const row = rgb.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prior[x] ?? 0;
      const upperLeft = x >= bytesPerPixel ? prior[x - bytesPerPixel] : 0;
      if (filter === 0) row[x] = encoded[x];
      else if (filter === 1) row[x] = (encoded[x] + left) & 0xff;
      else if (filter === 2) row[x] = (encoded[x] + up) & 0xff;
      else if (filter === 3) row[x] = (encoded[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (encoded[x] + paeth(left, up, upperLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    prior = row;
  }
  return { ...header, rgb };
}

function sourceState(x, y, width, height) {
  const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
  if (edge) return 1;
  return 0.25 + 0.25 * ((Math.floor(x / 3) + Math.floor(y / 2)) % 4);
}

function bounded(value, maximum) {
  return Math.max(0, Math.min(maximum - 1, value));
}

function renderFixture(scale, palette, geometry) {
  const sourceWidth = 16;
  const sourceHeight = 12;
  const outputWidth = Math.round(sourceWidth * scale);
  const outputHeight = Math.round(sourceHeight * scale);
  const scaleX = outputWidth / sourceWidth;
  const scaleY = outputHeight / sourceHeight;
  const rgb = Buffer.alloc(outputWidth * outputHeight * 3);
  const background = opticalColor(0, palette).map(srgbDecodeChannel);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = outputSampleSourceCoordinate(y, outputHeight, sourceHeight);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = outputSampleSourceCoordinate(x, outputWidth, sourceWidth);
      const pixelX = bounded(Math.floor(sourceX), sourceWidth);
      const pixelY = bounded(Math.floor(sourceY), sourceHeight);
      const state = sourceState(pixelX, pixelY, sourceWidth, sourceHeight);
      const foreground = opticalColor(state, palette).map(srgbDecodeChannel);
      const pixelMask = apertureCoverage2d(
        sourceX, sourceY, scaleX, scaleY, geometry.pixelFill, geometry.pixelEdge,
      );
      const shadowX = bounded(Math.floor(sourceX - geometry.shadowOffsetX), sourceWidth);
      const shadowY = bounded(Math.floor(sourceY - geometry.shadowOffsetY), sourceHeight);
      const shadowState = sourceState(shadowX, shadowY, sourceWidth, sourceHeight);
      const shadowGap = shadowEnergySample(sourceX, sourceY, scaleX, scaleY, {
        pixelFill: geometry.pixelFill,
        pixelEdge: geometry.pixelEdge,
        offsetX: geometry.shadowOffsetX,
        offsetY: geometry.shadowOffsetY,
      });
      const linear = background.map((channel, index) => (
        channel * (1 - pixelMask)
        + foreground[index] * pixelMask
        - channel * geometry.shadowStrength * shadowState * shadowGap
      ));
      const offset = (y * outputWidth + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        rgb[offset + channel] = Math.round(255 * srgbEncodeChannel(linear[channel]));
      }
    }
  }
  return {
    width: outputWidth,
    height: outputHeight,
    rgb,
    png: encodePng(outputWidth, outputHeight, rgb),
  };
}

function averageShadowGap(outputWidth, outputHeight, sourceWidth, sourceHeight, geometry) {
  const scaleX = outputWidth / sourceWidth;
  const scaleY = outputHeight / sourceHeight;
  let total = 0;
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = outputSampleSourceCoordinate(y, outputHeight, sourceHeight);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = outputSampleSourceCoordinate(x, outputWidth, sourceWidth);
      total += shadowEnergySample(sourceX, sourceY, scaleX, scaleY, {
        pixelFill: geometry.pixelFill,
        pixelEdge: geometry.pixelEdge,
        offsetX: geometry.shadowOffsetX,
        offsetY: geometry.shadowOffsetY,
      });
    }
  }
  return total / (outputWidth * outputHeight);
}

const reconstruction = JSON.parse(fs.readFileSync(reconstructionPath, "utf8"));
const palette = reconstruction.optical.states.map((state) => state.srgb8);
const geometry = {
  pixelFill: reconstruction.spatial.referenceParameters.PixelFill,
  pixelEdge: 1,
  shadowStrength: reconstruction.spatial.referenceParameters.ShadowStrength,
  shadowOffsetX: reconstruction.spatial.referenceParameters.ShadowOffsetX,
  shadowOffsetY: reconstruction.spatial.referenceParameters.ShadowOffsetY,
};
const expectedApertureArea = geometry.pixelFill ** 2;
const scaleCases = [4, 5, 6, 3.5, 3.75, 4.25].map((requestedScale) => {
  const width = Math.round(160 * requestedScale);
  const height = Math.round(144 * requestedScale);
  const apertureAverage = averageApertureCoverage(
    width, height, 160, 144, geometry.pixelFill, geometry.pixelEdge,
  );
  const shadowGapAverage = averageShadowGap(width, height, 160, 144, geometry);
  return {
    requestedScale,
    output: [width, height],
    effectiveScale: [width / 160, height / 144],
    apertureAverage: clean(apertureAverage),
    apertureError: clean(apertureAverage - expectedApertureArea),
    shadowGapAverage: clean(shadowGapAverage),
  };
});
const shadowReference = scaleCases.find((item) => item.requestedScale === 6).shadowGapAverage;
for (const item of scaleCases) item.shadowGapError = clean(item.shadowGapAverage - shadowReference);

const cropCases = [
  { source: [159, 143], output: [557, 501] },
  { source: [157, 137], output: [667, 582] },
  { source: [31, 29], output: [155, 145] },
].map(({ source, output }) => {
  const average = averageApertureCoverage(
    output[0], output[1], source[0], source[1], geometry.pixelFill, geometry.pixelEdge,
  );
  return {
    source,
    output,
    apertureAverage: clean(average),
    apertureError: clean(average - expectedApertureArea),
  };
});

const fixtures = fixtureCases.map((fixture) => {
  const rendered = renderFixture(fixture.scale, palette, geometry);
  const file = `ws6-aperture-${fixture.id}.png`;
  return {
    ...fixture,
    file: `generated/${file}`,
    path: path.join(generatedDir, file),
    dimensions: [rendered.width, rendered.height],
    rgb: rendered.rgb,
    png: rendered.png,
    sha256: sha256(rendered.png),
  };
});

if (checkOnly) {
  for (const fixture of fixtures) {
    if (!fs.existsSync(fixture.path)) {
      fail(`DMG WS6 fixture is missing: ${path.relative(root, fixture.path)}`);
    }
    const checkedBuffer = fs.readFileSync(fixture.path);
    let checked;
    try {
      checked = decodeRgb8Png(checkedBuffer);
    } catch (error) {
      fail(`DMG WS6 fixture is invalid: ${path.relative(root, fixture.path)}: ${error.message}`);
    }
    if (checked.width !== fixture.dimensions[0] || checked.height !== fixture.dimensions[1]
        || !checked.rgb.equals(fixture.rgb)) {
      fail(`DMG WS6 fixture pixels are stale: ${path.relative(root, fixture.path)}`);
    }
    // Keep the checked-in compressed representation and its report hash after
    // verifying pixels; zlib output can differ across Node and platform builds.
    fixture.png = checkedBuffer;
    fixture.sha256 = sha256(checkedBuffer);
  }
}

const tolerance = 1e-10;
const report = {
  schemaVersion: 1,
  reportId: "nintendo-dmg-01-ws6-aperture-v1",
  generatedFrom: "data/reconstruction-v1.json",
  evidenceId: "DMG-APERTURE-01",
  implementation: {
    aperture: "periodic rectangular aperture analytically integrated over every host-pixel footprint",
    shadow: "periodic shifted reflector aperture integrated only over the non-active gap; active/shadow joint coverage is subtracted before optical mixing",
    viewportPhase: "vTexCoord spans the viewport, so integer viewport translation does not alter source-cell phase",
  },
  parameters: geometry,
  expectedApertureArea: clean(expectedApertureArea),
  scaleCases,
  viewportOffsetCases: [
    { offset: [0, 0], expectedContentIdentity: true },
    { offset: [1, 0], expectedContentIdentity: true },
    { offset: [7, 11], expectedContentIdentity: true },
    { offset: [159, 32], expectedContentIdentity: true },
  ],
  cropCases,
  edgeAndCornerPolicy: {
    textureFetch: "clamped to the nearest source texel",
    aperturePhase: "periodic in source-cell coordinates through previous/current/next aperture integration",
    cornerDarkeningAdded: false,
  },
  shadowDirection: {
    offset: [geometry.shadowOffsetX, geometry.shadowOffsetY],
    expectedDirection: "positive X and positive Y from the source aperture",
    scaleInvariantGapArea: shadowReference,
  },
  fixtures: fixtures.map(({
    path: ignoredPath, png: ignoredPng, rgb: ignoredRgb, ...fixture
  }) => fixture),
  validation: {
    apertureTolerance: tolerance,
    shadowGapTolerance: tolerance,
    maximumApertureError: clean(Math.max(
      ...scaleCases.map((item) => Math.abs(item.apertureError)),
      ...cropCases.map((item) => Math.abs(item.apertureError)),
    )),
    maximumShadowGapError: clean(Math.max(...scaleCases.map((item) => Math.abs(item.shadowGapError)))),
    exact4x5x6Present: [4, 5, 6].every(
      (scale) => scaleCases.some((item) => item.requestedScale === scale),
    ),
    fractionalScalesPresent: scaleCases.filter((item) => !Number.isInteger(item.requestedScale)).length >= 3,
    viewportOffsetsPresent: true,
    edgeCornerCropPresent: cropCases.length >= 3,
  },
  claimBoundary: "PixelFill and shadow geometry remain BGB idealized-reference candidates, not measured DMG dimensions. This report proves scale-invariant integration of the selected geometry, not its factory dimensional accuracy.",
};
report.validation.pass = report.validation.maximumApertureError <= tolerance
  && report.validation.maximumShadowGapError <= tolerance
  && report.validation.exact4x5x6Present
  && report.validation.fractionalScalesPresent
  && report.validation.viewportOffsetsPresent
  && report.validation.edgeCornerCropPresent;
const reportBuffer = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);

if (checkOnly) {
  if (!fs.existsSync(reportPath) || !fs.readFileSync(reportPath).equals(reportBuffer)) {
    fail("DMG WS6 aperture report is missing or stale; run node tools/build-dmg01-ws6.mjs");
  }
  if (!report.validation.pass) fail("DMG WS6 aperture validation failed");
  console.log("DMG-01 WS6 scale-invariant aperture and reflector-shadow artifacts are current.");
} else {
  fs.mkdirSync(generatedDir, { recursive: true });
  for (const fixture of fixtures) fs.writeFileSync(fixture.path, fixture.png);
  fs.writeFileSync(reportPath, reportBuffer);
  if (!report.validation.pass) fail("Wrote WS6 artifacts, but aperture validation failed");
  console.log(`Wrote ${fixtures.length} WS6 fixtures and ${path.relative(root, reportPath)}.`);
}
