#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  GTG_ANALYTIC_PRIOR,
  GTG_CHANNELS,
  GTG_CODE_COUNT,
  GTG_FIT_VERSION,
  GTG_RATE_MAX,
  GTG_RATE_MIN,
  GTG_SCHEMA_VERSION,
  analyticRate,
  decodeRate16,
  encodeRate16,
  fitFirstOrder,
  rateToAlpha,
} from "../models/nintendo-ags-101/reference/gtg-response.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const defaultRawPath = path.join(modelDir, "data", "gtg-synthetic-v1.json");
const generatedDir = path.join(modelDir, "generated");
const defaultAssetPath = path.join(generatedDir, "gtg-synthetic-v1.png");
const defaultManifestPath = path.join(generatedDir, "gtg-synthetic-v1.json");
const defaultFitPath = path.join(generatedDir, "gtg-synthetic-v1-fit.json");
const checkOnly = process.argv.includes("--check");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const jsonBuffer = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const cellId = (channel, fromCode, toCode) => `${channel}:${fromCode}>${toCode}`;

function syntheticRecord() {
  const timesSeconds = [
    0, 0.004, 0.008, 0.012, 0.016, 0.024, 0.032, 0.048,
    0.064, 0.080, 0.100, 0.120, 0.160, 0.200, 0.240, 0.320,
  ];
  const samples = [];
  for (const channel of GTG_CHANNELS) {
    for (let fromCode = 0; fromCode < GTG_CODE_COUNT; fromCode += 1) {
      for (let toCode = 0; toCode < GTG_CODE_COUNT; toCode += 1) {
        const identity = fromCode === toCode;
        const rate = analyticRate(fromCode, toCode);
        samples.push({
          id: `${channel}-${String(fromCode).padStart(2, "0")}-${String(toCode).padStart(2, "0")}-00`,
          channel,
          fromCode,
          toCode,
          repetition: 0,
          status: identity ? "identity" : "transition",
          eventTimeZeroSeconds: 0,
          fromPlateau: 0,
          toPlateau: identity ? 0 : 1,
          timesSeconds,
          opticalResponse: timesSeconds.map((time) => (
            identity ? 0 : Number(rateToAlpha(rate, time).toFixed(12))
          )),
        });
      }
    }
  }
  const patternDescriptor = JSON.stringify({
    generator: "ags101-gtg-synthetic-analytic-v1",
    fitVersion: GTG_FIT_VERSION,
    prior: GTG_ANALYTIC_PRIOR,
    timesSeconds,
  });
  return {
    schemaVersion: GTG_SCHEMA_VERSION,
    recordId: "ags101-gtg-synthetic-analytic-v1",
    classification: "synthetic",
    specimen: {
      consoleId: "not-applicable-synthetic",
      boardId: "not-applicable-synthetic",
      lcdLabel: "not-applicable-synthetic",
      brightnessMode: "synthetic-analytic-prior",
      warmupSeconds: 0,
      ambient: { temperatureC: 25, illuminanceLux: 0 },
      power: { source: "synthetic", chargerConnected: null, batteryVoltage: null },
      panelHistory: "not applicable: generated waveform",
      overlay: "none",
      measurementGeometry: {
        patchPixels: [240, 160],
        samplePointPixels: [119.5, 79.5],
        detectorDistanceMm: null,
        viewAngleDegrees: [0, 0]
      },
      detector: {
        manufacturer: "Retro Display Lab",
        model: "analytic waveform generator",
        serial: "synthetic",
        bandwidthHz: null,
        linearityCalibration: "exact normalized analytic output"
      },
      acquisition: { sampleRateHz: 250, repetitions: 1, pretriggerSeconds: 0 },
      stimulus: {
        generator: "tools/build-ags101-gtg.mjs",
        testRom: null,
        patternSha256: sha256(patternDescriptor),
        preconditionFrames: 120,
        fromDwellSeconds: 0.5,
        toDwellSeconds: 0.5
      }
    },
    eventTimeZero: {
      reference: "optical-onset",
      description: "Synthetic t=0 is the exact start of the analytic optical step.",
      triggerUncertaintySeconds: 0
    },
    responseUnits: "normalized-transition",
    coverage: {
      channels: [...GTG_CHANNELS],
      codeRange: [0, 31],
      expectedCellCount: 3072,
      recordedCellCount: 3072
    },
    samples,
    missingCells: [],
    sourceFiles: [{ path: "synthetic://ags101-analytic-prior-v1", sha256: sha256(patternDescriptor) }],
    integrity: { samplesSha256: sha256(JSON.stringify(samples)) }
  };
}

function validateRecord(record) {
  const errors = [];
  const requireString = (value, name) => {
    if (typeof value !== "string" || value.length === 0) errors.push(`${name} is required`);
  };
  if (record?.schemaVersion !== GTG_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  requireString(record?.recordId, "recordId");
  if (!["measured-aged-specimen", "measured-reference-specimen", "synthetic"].includes(record?.classification)) {
    errors.push("classification is invalid");
  }
  const specimenFields = [
    "consoleId", "boardId", "lcdLabel", "brightnessMode", "panelHistory", "overlay",
  ];
  for (const field of specimenFields) requireString(record?.specimen?.[field], `specimen.${field}`);
  for (const field of ["ambient", "power", "measurementGeometry", "detector", "acquisition", "stimulus"]) {
    if (!record?.specimen?.[field] || typeof record.specimen[field] !== "object") {
      errors.push(`specimen.${field} is required`);
    }
  }
  if (!Number.isFinite(record?.specimen?.warmupSeconds) || record.specimen.warmupSeconds < 0) {
    errors.push("specimen.warmupSeconds is invalid");
  }
  if (!Number.isFinite(record?.specimen?.acquisition?.sampleRateHz)
      || record.specimen.acquisition.sampleRateHz <= 0) errors.push("sampleRateHz is invalid");
  if (!Number.isInteger(record?.specimen?.acquisition?.repetitions)
      || record.specimen.acquisition.repetitions < 1) errors.push("repetitions is invalid");
  if (!Array.isArray(record?.samples) || !Array.isArray(record?.missingCells)) {
    errors.push("samples and missingCells arrays are required");
    return errors;
  }
  const groups = new Map();
  const sampleIds = new Set();
  for (const sample of record.samples) {
    if (sampleIds.has(sample.id)) errors.push(`duplicate sample id ${sample.id}`);
    sampleIds.add(sample.id);
    if (!GTG_CHANNELS.includes(sample.channel)
        || !Number.isInteger(sample.fromCode) || sample.fromCode < 0 || sample.fromCode > 31
        || !Number.isInteger(sample.toCode) || sample.toCode < 0 || sample.toCode > 31) {
      errors.push(`invalid cell identity in ${sample.id}`);
      continue;
    }
    if (!Number.isInteger(sample.repetition) || sample.repetition < 0) {
      errors.push(`invalid repetition in ${sample.id}`);
    }
    if (!Number.isFinite(sample.eventTimeZeroSeconds)) {
      errors.push(`invalid event time zero in ${sample.id}`);
    }
    const identity = sample.fromCode === sample.toCode;
    if ((identity && sample.status !== "identity") || (!identity && sample.status !== "transition")) {
      errors.push(`status does not match cell identity in ${sample.id}`);
    }
    if (!Array.isArray(sample.timesSeconds) || !Array.isArray(sample.opticalResponse)
        || sample.timesSeconds.length !== sample.opticalResponse.length
        || sample.timesSeconds.length < 2) {
      errors.push(`invalid waveform arrays in ${sample.id}`);
    } else {
      for (let index = 1; index < sample.timesSeconds.length; index += 1) {
        if (!(sample.timesSeconds[index] > sample.timesSeconds[index - 1])) {
          errors.push(`non-increasing sample time in ${sample.id}`);
          break;
        }
      }
      if (!sample.opticalResponse.every(Number.isFinite)) {
        errors.push(`non-finite optical response in ${sample.id}`);
      }
    }
    if (!Number.isFinite(sample.fromPlateau) || !Number.isFinite(sample.toPlateau)) {
      errors.push(`invalid plateaus in ${sample.id}`);
    } else if (sample.status === "transition"
        && Math.abs(sample.toPlateau - sample.fromPlateau) <= Number.EPSILON) {
      errors.push(`transition plateaus are identical in ${sample.id}`);
    }
    const id = cellId(sample.channel, sample.fromCode, sample.toCode);
    const list = groups.get(id) ?? [];
    list.push(sample);
    groups.set(id, list);
  }
  const missing = new Set(record.missingCells);
  if (missing.size !== record.missingCells.length) errors.push("missingCells contains duplicates");
  const missingPattern = /^[rgb]:(?:[0-9]|[12][0-9]|3[01])>(?:[0-9]|[12][0-9]|3[01])$/;
  for (const id of missing) if (!missingPattern.test(id)) errors.push(`invalid missing cell ${id}`);
  const expectedRepetitions = record.specimen?.acquisition?.repetitions;
  for (const [id, samples] of groups) {
    const repetitions = new Set(samples.map((sample) => sample.repetition));
    if (samples.length !== expectedRepetitions || repetitions.size !== expectedRepetitions
        || !Array.from({ length: expectedRepetitions }, (_, index) => index)
          .every((index) => repetitions.has(index))) {
      errors.push(`${id} does not contain repetitions 0..${expectedRepetitions - 1}`);
    }
  }
  for (const channel of GTG_CHANNELS) {
    for (let fromCode = 0; fromCode < 32; fromCode += 1) {
      for (let toCode = 0; toCode < 32; toCode += 1) {
        const id = cellId(channel, fromCode, toCode);
        const present = groups.has(id);
        if (present === missing.has(id)) errors.push(`${id} must be either recorded or explicitly missing`);
      }
    }
  }
  if (record.coverage?.expectedCellCount !== 3072
      || record.coverage?.recordedCellCount !== groups.size) errors.push("coverage counts are inconsistent");
  if (record.integrity?.samplesSha256 !== sha256(JSON.stringify(record.samples))) {
    errors.push("samplesSha256 does not match samples payload");
  }
  if (!Array.isArray(record.sourceFiles) || record.sourceFiles.some((source) => (
    typeof source?.path !== "string" || !/^[0-9a-f]{64}$/.test(source?.sha256 ?? "")
  ))) errors.push("sourceFiles contains an invalid path or SHA-256");
  if (record.classification.startsWith("measured")) {
    if (record.specimen.acquisition.repetitions < 20) {
      errors.push("measured runtime records require at least 20 repetitions");
    }
    for (const field of ["consoleId", "boardId", "lcdLabel"]) {
      if (/unknown|not-applicable|synthetic/i.test(record.specimen[field])) {
        errors.push(`measured record has placeholder specimen.${field}`);
      }
    }
  }
  return errors;
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function fitRecord(record) {
  const grouped = new Map();
  for (const sample of record.samples) {
    const id = cellId(sample.channel, sample.fromCode, sample.toCode);
    const list = grouped.get(id) ?? [];
    list.push(sample);
    grouped.set(id, list);
  }
  const cells = [];
  const cellMap = new Map();
  for (const channel of GTG_CHANNELS) {
    for (let fromCode = 0; fromCode < 32; fromCode += 1) {
      for (let toCode = 0; toCode < 32; toCode += 1) {
        const id = cellId(channel, fromCode, toCode);
        const samples = grouped.get(id) ?? [];
        if (samples.length === 0) {
          const cell = { id, channel, fromCode, toCode, status: "missing", runtimeEligible: false };
          cells.push(cell);
          cellMap.set(id, cell);
          continue;
        }
        if (fromCode === toCode) {
          const cell = {
            id, channel, fromCode, toCode, status: "identity-anchor-pending",
            runtimeEligible: false, repetitions: samples.length,
          };
          cells.push(cell);
          cellMap.set(id, cell);
          continue;
        }
        const repetitions = samples.map((sample) => {
          const plateauSpan = sample.toPlateau - sample.fromPlateau;
          const normalizedResponse = sample.opticalResponse.map((value) => (
            (value - sample.fromPlateau) / plateauSpan
          ));
          return {
            repetition: sample.repetition,
            fromPlateau: sample.fromPlateau,
            toPlateau: sample.toPlateau,
            ...fitFirstOrder(sample.timesSeconds, normalizedResponse),
          };
        });
        const runtimeEligible = repetitions.every((fit) => fit.runtimeEligible);
        const ratePerSecond = geometricMean(repetitions.map((fit) => fit.ratePerSecond));
        const cell = {
          id, channel, fromCode, toCode, status: runtimeEligible ? "fitted" : "rejected",
          runtimeEligible, ratePerSecond, repetitions,
          aggregate: {
            rmseMax: Math.max(...repetitions.map((fit) => fit.rmse)),
            maxAbsError: Math.max(...repetitions.map((fit) => fit.maxAbsError)),
            overshootMax: Math.max(...repetitions.map((fit) => fit.metrics.overshoot)),
            undershootMax: Math.max(...repetitions.map((fit) => fit.metrics.undershoot)),
          },
        };
        cells.push(cell);
        cellMap.set(id, cell);
      }
    }
  }

  for (const cell of cells.filter((candidate) => candidate.status === "identity-anchor-pending")) {
    const candidates = [];
    for (const delta of [-1, 1]) {
      const neighbor = cell.fromCode + delta;
      if (neighbor < 0 || neighbor > 31) continue;
      for (const [fromCode, toCode] of [[cell.fromCode, neighbor], [neighbor, cell.fromCode]]) {
        const adjacent = cellMap.get(cellId(cell.channel, fromCode, toCode));
        if (adjacent?.runtimeEligible) candidates.push(adjacent.ratePerSecond);
      }
    }
    cell.status = candidates.length ? "derived-identity-anchor" : "identity-fallback";
    cell.runtimeEligible = candidates.length > 0;
    if (candidates.length) cell.ratePerSecond = geometricMean(candidates);
  }
  return { cells, cellMap };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodeRgbPng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), rgb.subarray(y * width * 3, (y + 1) * width * 3));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildAsset(record, fit, assetFileName) {
  const width = 32;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 3);
  let packedCount = 0;
  let fallbackCount = 0;
  let derivedIdentityCount = 0;
  let maxRateRoundTripRelativeError = 0;
  for (let channelIndex = 0; channelIndex < GTG_CHANNELS.length; channelIndex += 1) {
    const channel = GTG_CHANNELS[channelIndex];
    for (let fromCode = 0; fromCode < 32; fromCode += 1) {
      for (let toCode = 0; toCode < 32; toCode += 1) {
        const cell = fit.cellMap.get(cellId(channel, fromCode, toCode));
        const offset = ((channelIndex * 32 + fromCode) * width + toCode) * 3;
        if (!cell?.runtimeEligible) {
          pixels[offset + 2] = 0;
          fallbackCount += 1;
          continue;
        }
        const encoded = encodeRate16(cell.ratePerSecond);
        pixels[offset] = encoded >>> 8;
        pixels[offset + 1] = encoded & 0xff;
        pixels[offset + 2] = cell.status === "derived-identity-anchor" ? 192 : 255;
        const decoded = decodeRate16(encoded);
        maxRateRoundTripRelativeError = Math.max(
          maxRateRoundTripRelativeError,
          Math.abs(decoded - cell.ratePerSecond) / cell.ratePerSecond,
        );
        packedCount += 1;
        if (cell.status === "derived-identity-anchor") derivedIdentityCount += 1;
      }
    }
  }
  const png = encodeRgbPng(width, height, pixels);
  const transitionCells = fit.cells.filter((cell) => cell.aggregate);
  const fitReport = {
    schemaVersion: record.schemaVersion,
    fitVersion: GTG_FIT_VERSION,
    sourceRecordId: record.recordId,
    sourceClassification: record.classification,
    sourceRecordSha256: sha256(jsonBuffer(record)),
    thresholds: {
      overshootMaximum: 0.02,
      undershootMaximum: 0.02,
      rmseMaximum: 0.02,
      maxAbsoluteErrorMaximum: 0.05,
    },
    summary: {
      cells: fit.cells.length,
      packedCount,
      fallbackCount,
      derivedIdentityCount,
      rmseMaximum: Math.max(...transitionCells.map((cell) => cell.aggregate.rmseMax)),
      maxAbsoluteError: Math.max(...transitionCells.map((cell) => cell.aggregate.maxAbsError)),
      overshootMaximum: Math.max(...transitionCells.map((cell) => cell.aggregate.overshootMax)),
      undershootMaximum: Math.max(...transitionCells.map((cell) => cell.aggregate.undershootMax)),
      maxRateRoundTripRelativeError,
    },
    cells: fit.cells,
  };
  const fitBuffer = jsonBuffer(fitReport);
  const manifest = {
    assetVersion: "ags101-gtg-rate-texture-v1",
    schemaVersion: record.schemaVersion,
    fitVersion: GTG_FIT_VERSION,
    sourceRecordId: record.recordId,
    sourceClassification: record.classification,
    sourceRecordSha256: sha256(jsonBuffer(record)),
    fitReportSha256: sha256(fitBuffer),
    texture: {
      file: assetFileName,
      sha256: sha256(png),
      width,
      height,
      format: "RGB8 PNG",
      addressing: "x=toCode, y=fromCode+32*channelIndex; channelIndex r=0,g=1,b=2",
      rateEncoding: {
        bytes: "R=uint16 high byte, G=uint16 low byte",
        equation: "rate=1*pow(1024, uint16/65535) per second",
        minimumPerSecond: GTG_RATE_MIN,
        maximumPerSecond: GTG_RATE_MAX,
      },
      statusEncoding: "B=255 fitted, B=192 derived identity anchor, B=0 explicit fallback",
    },
    errorMetrics: fitReport.summary,
  };
  return { png, fitBuffer, manifestBuffer: jsonBuffer(manifest) };
}

function compareOrWrite(file, expected) {
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
      throw new Error(`${path.relative(root, file)} is stale; run node tools/build-ags101-gtg.mjs`);
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, expected);
  }
}

const expectedSynthetic = syntheticRecord();
const expectedRawBuffer = jsonBuffer(expectedSynthetic);
compareOrWrite(defaultRawPath, expectedRawBuffer);

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1]) : defaultRawPath;
if (inputIndex >= 0 && !process.argv[inputIndex + 1]) throw new Error("--input requires a path");
const outputIndex = process.argv.indexOf("--output-prefix");
const prefix = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output-prefix requires a path");
if (inputPath !== defaultRawPath && !prefix) {
  throw new Error("a non-default --input requires --output-prefix to protect checked-in fixtures");
}
const assetPath = prefix ? `${prefix}.png` : defaultAssetPath;
const manifestPath = prefix ? `${prefix}.json` : defaultManifestPath;
const fitPath = prefix ? `${prefix}-fit.json` : defaultFitPath;
const record = inputPath === defaultRawPath
  ? expectedSynthetic
  : JSON.parse(fs.readFileSync(inputPath, "utf8"));
const validationErrors = validateRecord(record);
if (validationErrors.length) throw new Error(validationErrors.join("\n"));
if (checkOnly) {
  const falseMeasured = structuredClone(expectedSynthetic);
  falseMeasured.classification = "measured-reference-specimen";
  const falseMeasuredErrors = validateRecord(falseMeasured);
  if (!falseMeasuredErrors.some((error) => error.includes("at least 20 repetitions"))
      || !falseMeasuredErrors.some((error) => error.includes("placeholder specimen.lcdLabel"))) {
    throw new Error("GtG validation accepted synthetic metadata under a measured classification");
  }
}
const fit = fitRecord(record);
const built = buildAsset(record, fit, path.basename(assetPath));

if (inputPath !== defaultRawPath && checkOnly) {
  throw new Error("--check supports only the checked-in synthetic record");
}
compareOrWrite(assetPath, built.png);
compareOrWrite(manifestPath, built.manifestBuffer);
compareOrWrite(fitPath, built.fitBuffer);

process.stdout.write(checkOnly
  ? "AGS-101 GtG synthetic record, fit report, and runtime texture are current.\n"
  : `Generated ${path.relative(root, assetPath)}, ${path.relative(root, manifestPath)}, and ${path.relative(root, fitPath)}.\n`);
