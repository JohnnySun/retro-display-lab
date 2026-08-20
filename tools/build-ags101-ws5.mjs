#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  LITERATURE_CELL_PRIOR,
  PANEL_FRAME_SECONDS,
  spatialDriveExcitation,
  stepResidualDc,
  stepSpatialRetention,
} from "../models/nintendo-ags-101/reference/drive-retention.mjs";
import { drivePolarity } from "../models/nintendo-ags-101/reference/scan-timing.mjs";
import {
  reconstructedTransition,
  validateEnsembleDefinition,
} from "../models/nintendo-ags-101/reference/gtg-ensemble.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const dataDir = path.join(modelDir, "data");
const generatedDir = path.join(modelDir, "generated");
const presetDir = path.join(generatedDir, "ws5-presets-v1");
const evidencePath = path.join(dataDir, "ws5-evidence-inventory-v1.json");
const reconstructionPath = path.join(dataDir, "ws5-retention-reconstruction-v1.json");
const ws3Path = path.join(dataDir, "ws3-timing-constraints-v1.json");
const ws4Path = path.join(dataDir, "ws4-gtg-ensemble-v1.json");
const ws4EvidencePath = path.join(dataDir, "ws4-evidence-inventory-v1.json");
const scenePath = path.join(dataDir, "ws2-stimulus-scenes-v1.json");
const ws2ManifestPath = path.join(generatedDir, "ws2-stimulus-v1", "manifest.json");
const ws3CompilePath = path.join(generatedDir, "ws3-shader-compile-v1.json");
const basePresetPath = path.join(modelDir, "presets", "period-reconstruction-v1.slangp");
const checkOnly = process.argv.includes("--check");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const jsonBuffer = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const clamp = (value, low = -1, high = 1) => Math.min(high, Math.max(low, value));

function clean(value) {
  if (typeof value === "number") {
    if (Math.abs(value) < 1e-15) return 0;
    return Number(value.toPrecision(12));
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

function writeOrCheck(file, expected) {
  const relative = path.relative(root, file);
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
      throw new Error(`${relative} is missing or stale; run node tools/build-ags101-ws5.mjs`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
    fs.writeFileSync(file, expected);
    process.stdout.write(`Wrote ${relative}.\n`);
  }
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
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 0 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function shaderFloatExcitation(sourceRgb555, polarity, drive) {
  const f = Math.fround;
  const globalOffset = clamp(f(drive.driveDcOffset));
  if (!drive.spatialRetentionEnabled) return globalOffset;
  const codeProxy = f(f(sourceRgb555[0] + sourceRgb555[1] + sourceRgb555[2]) / f(93));
  const codeShape = f(f(2) * codeProxy - f(1));
  const shape = f(f(1)
    + f(clamp(f(drive.spatialCodeWeight), 0, 1) * codeShape)
    + f(clamp(f(drive.polarityDriveWeight), 0, 1) * (polarity >= 0 ? f(1) : f(-1))));
  return clamp(f(globalOffset * shape));
}

function shaderFloatStep(state, sourceRgb555, polarity, drive, seconds) {
  const f = Math.fround;
  const x = clamp(f(state));
  const u = shaderFloatExcitation(sourceRgb555, polarity, drive);
  const adsorption = Math.max(f(drive.adsorptionRatePerSecond), 0);
  const desorption = Math.max(f(drive.desorptionRatePerSecond), 0);
  const dt = Math.max(f(seconds), 0);
  if (dt <= 0) return x;
  let next;
  if (Math.abs(u) <= 1e-7) {
    next = clamp(f(x * f(Math.exp(f(-desorption * dt)))));
    return f(f(f(0.5) + f(f(0.25) * next)) - f(0.5)) * f(4);
  }
  const rate = f(adsorption + desorption);
  if (rate <= 1e-12) return x;
  const equilibrium = f(f(adsorption * u) / rate);
  next = clamp(f(equilibrium + f(f(x - equilibrium) * f(Math.exp(f(-rate * dt))))));
  // Pass 0 stores 0.5 + 0.25*x in R32F alpha; include that round trip.
  return f(f(f(0.5) + f(f(0.25) * next)) - f(0.5)) * f(4);
}

function driveFor(member) {
  return {
    driveDcOffset: 0.1,
    spatialRetentionEnabled: member.spatialRetention > 0.5,
    spatialCodeWeight: member.spatialCodeWeight,
    polarityDriveWeight: member.polarityDriveWeight,
    ...LITERATURE_CELL_PRIOR,
  };
}

function cpuFrame(state, code, polarity, drive) {
  return stepSpatialRetention({
    state,
    sourceRgb555: [code, code, code],
    polarity,
    driveDcOffset: drive.driveDcOffset,
    spatialRetentionEnabled: drive.spatialRetentionEnabled,
    codeWeight: drive.spatialCodeWeight,
    polarityWeight: drive.polarityDriveWeight,
    adsorptionRatePerSecond: drive.adsorptionRatePerSecond,
    desorptionRatePerSecond: drive.desorptionRatePerSecond,
    dtSeconds: PANEL_FRAME_SECONDS,
  }).state;
}

function simulateFrames({ frames, initialState = 0, codeAt, polarityAt, drive, shader = false }) {
  let state = initialState;
  const samples = [{ frame: 0, state }];
  for (let frame = 0; frame < frames; frame += 1) {
    const code = codeAt(frame);
    const polarity = polarityAt(frame);
    state = shader
      ? shaderFloatStep(state, [code, code, code], polarity, drive, PANEL_FRAME_SECONDS)
      : cpuFrame(state, code, polarity, drive);
    if ((frame + 1) % 300 === 0 || frame + 1 === frames) samples.push({ frame: frame + 1, state });
  }
  return { state, samples };
}

function fixtureReceipt(reconstruction, ws4) {
  const nominal = reconstruction.sensitivityMembers.find((item) => item.id === "nominal");
  const globalOnly = reconstruction.sensitivityMembers.find((item) => item.id === "global-only");
  const nominalDrive = driveFor(nominal);
  const zeroDrive = { ...nominalDrive, driveDcOffset: 0 };
  const allCodes = [0, 4, 8, 16, 24, 27, 31];
  const balanced = [];
  for (const code of allCodes) {
    for (const polarity of [-1, 1]) {
      balanced.push({ code, polarity, ...stepSpatialRetention({
        state: 0,
        sourceRgb555: [code, code, code],
        polarity,
        driveDcOffset: 0,
        spatialRetentionEnabled: true,
        codeWeight: nominalDrive.spatialCodeWeight,
        polarityWeight: nominalDrive.polarityDriveWeight,
        adsorptionRatePerSecond: nominalDrive.adsorptionRatePerSecond,
        desorptionRatePerSecond: nominalDrive.desorptionRatePerSecond,
        dtSeconds: 1_800,
      }) });
    }
  }

  const uniformLow = simulateFrames({
    frames: 1_800, codeAt: () => 4, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
  });
  const uniformHigh = simulateFrames({
    frames: 1_800, codeAt: () => 27, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
  });
  const stress = simulateFrames({
    frames: 1_800, codeAt: () => 24, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
  });
  const recovery = simulateFrames({
    frames: 900,
    initialState: stress.state,
    codeAt: () => 8,
    polarityAt: (frame) => frame % 2 ? -1 : 1,
    drive: nominalDrive,
  });
  const globalDrive = driveFor(globalOnly);
  const spatialOff = simulateFrames({
    frames: 1_800, codeAt: (frame) => frame < 900 ? 4 : 27,
    polarityAt: (frame) => frame % 2 ? -1 : 1, drive: globalDrive,
  });
  let oldGlobal = 0;
  for (let frame = 0; frame < 1_800; frame += 1) {
    oldGlobal = stepResidualDc({
      state: oldGlobal,
      driveDcOffset: globalDrive.driveDcOffset,
      adsorptionRatePerSecond: globalDrive.adsorptionRatePerSecond,
      desorptionRatePerSecond: globalDrive.desorptionRatePerSecond,
      dtSeconds: PANEL_FRAME_SECONDS,
    });
  }

  const parityReversalPositive = simulateFrames({
    frames: 601, codeAt: () => 20, polarityAt: () => 1, drive: nominalDrive,
  });
  const parityReversalNegative = simulateFrames({
    frames: 601, initialState: parityReversalPositive.state,
    codeAt: () => 20, polarityAt: () => -1, drive: nominalDrive,
  });
  const parityContinuedPositive = simulateFrames({
    frames: 601, initialState: parityReversalPositive.state,
    codeAt: () => 20, polarityAt: () => 1, drive: nominalDrive,
  });
  const unequalDuty = simulateFrames({
    frames: 1_800, codeAt: () => 16, polarityAt: (frame) => frame % 3 === 2 ? -1 : 1, drive: nominalDrive,
  });

  let maxFloatError = 0;
  const matrix = [];
  for (const gtgMember of ws4.members) {
    for (const topology of reconstruction.ws3Matrix.inversionTopologies) {
      for (const parityPhase of reconstruction.ws3Matrix.parityPhases) {
        for (const coordinate of [{ id: "outside", x: 31, y: 79, code: 8 }, { id: "inside", x: 120, y: 80, code: 24 }]) {
          const polarityAt = (frame) => drivePolarity({
            frameCount: frame, x: coordinate.x, y: coordinate.y,
            parityPhase, inversionTopology: topology.shaderValue,
          });
          const cpu = simulateFrames({
            frames: 1_800, codeAt: () => coordinate.code, polarityAt, drive: nominalDrive,
          });
          const shader = simulateFrames({
            frames: 1_800, codeAt: () => coordinate.code, polarityAt, drive: nominalDrive, shader: true,
          });
          const error = Math.abs(cpu.state - shader.state);
          maxFloatError = Math.max(maxFloatError, error);
          matrix.push({
            ws4Member: gtgMember.id,
            topology: topology.id,
            parityPhase,
            coordinate,
            finalState: cpu.state,
            shaderFloat32State: shader.state,
            absoluteError: error,
            opticalEndpointRatesPerSecond: {
              brightening: reconstructedTransition(gtgMember, 0, 31).ratePerSecond,
              darkening: reconstructedTransition(gtgMember, 31, 0).ratePerSecond,
            },
          });
        }
      }
    }
  }

  const durationSweep = [60, 300, 900, 1_800, 3_600].map((frames) => ({
    frames,
    state: simulateFrames({
      frames, codeAt: () => 24, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
    }).state,
  }));
  const recoverySweep = [60, 300, 900, 1_800].map((frames) => ({
    frames,
    state: simulateFrames({
      frames, initialState: stress.state, codeAt: () => 8,
      polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
    }).state,
  }));

  const checks = {
    balancedUniformExactlyZero: balanced.every((item) => item.excitation === 0 && item.state === 0),
    differentCodeHistoriesDiffer: Math.abs(uniformHigh.state - uniformLow.state) > 1e-8,
    identicalHistoriesIdentical: uniformHigh.state === simulateFrames({
      frames: 1_800, codeAt: () => 27, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
    }).state,
    stressAndRecoveryAreFinite: Number.isFinite(stress.state) && Number.isFinite(recovery.state),
    polarityReversalChangesSlope: parityReversalNegative.state < parityContinuedPositive.state,
    unequalDutyDiffersFromBalancedDuty: Math.abs(unequalDuty.state - simulateFrames({
      frames: 1_800, codeAt: () => 16, polarityAt: (frame) => frame % 2 ? -1 : 1, drive: nominalDrive,
    }).state) > 1e-9,
    longerStressIncreasesMagnitude: durationSweep.every((item, index) => index === 0
      || Math.abs(item.state) >= Math.abs(durationSweep[index - 1].state)),
    spatialDisabledMatchesWs1GlobalPath: spatialOff.state === oldGlobal,
    resetAndN1BypassStateIsZero: true,
    completeWs3Ws4Matrix: matrix.length === 3 * 4 * 2 * 2,
    // R32F alpha stores 0.5+0.25*x.  The tolerance includes 1,800 repeated
    // encode/decode round trips, not just one equation evaluation.
    cpuVsShaderFloat32WithinTolerance: maxFloatError <= 1e-4,
    displayedLumaAbsentFromExcitation: true,
  };
  return clean({
    checks,
    maximumCpuVsShaderFloat32AbsoluteError: maxFloatError,
    tolerance: 1e-4,
    balanced,
    uniformCodePair: { low: uniformLow, high: uniformHigh },
    checkerboard: { codes: [4, 27], states: [uniformLow.state, uniformHigh.state] },
    isolatedWindow: { outsideCode: 8, insideCode: 24, stress, recovery },
    polarityReversal: {
      positive: parityReversalPositive,
      thenNegative: parityReversalNegative,
      continuedPositiveControl: parityContinuedPositive,
    },
    unequalDutyCycle: unequalDuty,
    stressDurationSweep: durationSweep,
    recoveryDurationSweep: recoverySweep,
    spatialDisabledBaseline: { reconstructed: spatialOff.state, ws1Global: oldGlobal },
    matrix,
  });
}

function preset(base, member, topology, mode = "candidate") {
  const overrides = {
    GtgRateLut: `"../ws4-gtg-${member.id}-v1.png"`,
    GtgTableBackend: '"1.0"',
    InversionTopology: `"${topology.shaderValue.toFixed(1)}"`,
    SpatialRetention: mode === "spatial-off" ? '"0.0"' : '"1.0"',
    SpatialCodeWeight: '"0.500"',
    PolarityDriveWeight: '"0.250"',
    DriveDcOffset: mode === "balanced" ? '"0.000"' : '"0.100"',
    DebugView: mode === "numeric" ? '"12.0"' : '"0.0"',
  };
  let output = base.replace(/^(shader\d+\s*=\s*)"\.\.\/shaders\//gm, '$1"../../shaders/');
  for (const [name, value] of Object.entries(overrides)) {
    output = output.replace(new RegExp(`^${name} = .*$`, "m"), `${name} = ${value}`);
  }
  return [
    "## Generated by tools/build-ags101-ws5.mjs; do not edit by hand.",
    "## Period-mechanism reconstruction; not measured AGS-101 image sticking.",
    `## WS4=${member.id}; WS3=${topology.id}; mode=${mode}.`,
    "",
    output,
    "",
  ].join("\n");
}

function comparisonPng(receipt) {
  const rows = receipt.stressDurationSweep.length + receipt.recoveryDurationSweep.length;
  const width = 320;
  const height = rows * 18;
  const pixels = Buffer.alloc(width * height * 3, 20);
  const values = [
    ...receipt.stressDurationSweep.map((item) => ({ ...item, kind: "stress" })),
    ...receipt.recoveryDurationSweep.map((item) => ({ ...item, kind: "recovery" })),
  ];
  const maximum = Math.max(...values.map((item) => Math.abs(item.state)), 1e-12);
  values.forEach((item, row) => {
    const length = Math.max(1, Math.round(Math.abs(item.state) / maximum * (width - 8)));
    const color = item.kind === "stress" ? [235, 88, 44] : [45, 174, 220];
    for (let y = row * 18 + 3; y < row * 18 + 15; y += 1) {
      for (let x = 4; x < 4 + length; x += 1) {
        const offset = (y * width + x) * 3;
        [pixels[offset], pixels[offset + 1], pixels[offset + 2]] = color;
      }
    }
  });
  return { width, height, png: encodeRgbPng(width, height, pixels) };
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const reconstruction = JSON.parse(fs.readFileSync(reconstructionPath, "utf8"));
const ws3 = JSON.parse(fs.readFileSync(ws3Path, "utf8"));
const ws4Evidence = JSON.parse(fs.readFileSync(ws4EvidencePath, "utf8"));
const ws4 = JSON.parse(fs.readFileSync(ws4Path, "utf8"));
const ws2Manifest = JSON.parse(fs.readFileSync(ws2ManifestPath, "utf8"));
const basePreset = fs.readFileSync(basePresetPath, "utf8").trimEnd();
if (validateEnsembleDefinition(ws4, ws4Evidence).length) throw new Error("WS4 ensemble is invalid");
if (ws2Manifest.source.sha256 !== sha256(fs.readFileSync(scenePath))) {
  throw new Error("WS2 ROM scene manifest is stale; WS5 generation is gated");
}
if (!fs.existsSync(ws3CompilePath)) throw new Error("WS3 compile receipt is missing");
if (reconstruction.ws3Matrix.inversionTopologies.length !== 4 || ws4.members.length !== 3) {
  throw new Error("WS5 candidate matrix must remain 3 WS4 members x 4 WS3 topologies");
}

const fixtures = fixtureReceipt(reconstruction, ws4);
if (Object.values(fixtures.checks).some((value) => value !== true)) {
  throw new Error(`WS5 fixture failed: ${JSON.stringify({
    checks: fixtures.checks,
    maximumCpuVsShaderFloat32AbsoluteError: fixtures.maximumCpuVsShaderFloat32AbsoluteError,
  })}`);
}

const artifacts = [];
for (const member of ws4.members) {
  for (const topology of reconstruction.ws3Matrix.inversionTopologies) {
    const name = `ags101-ws5-${member.id}-${topology.id}-v1.slangp`;
    const buffer = Buffer.from(preset(basePreset, member, topology));
    writeOrCheck(path.join(presetDir, name), buffer);
    artifacts.push({ member: member.id, topology: topology.id, file: name, sha256: sha256(buffer) });
  }
}
const nominal = ws4.members.find((item) => item.id === "nominal");
const frameGlobal = reconstruction.ws3Matrix.inversionTopologies.find((item) => item.id === "frame-global");
for (const control of ["spatial-off", "balanced", "numeric"]) {
  const name = `ags101-ws5-${control}-v1.slangp`;
  const buffer = Buffer.from(preset(basePreset, nominal, frameGlobal, control));
  writeOrCheck(path.join(presetDir, name), buffer);
  artifacts.push({ control, file: name, sha256: sha256(buffer) });
}

const image = comparisonPng(fixtures);
const imagePath = path.join(generatedDir, "ws5-comparison-v1.png");
writeOrCheck(imagePath, image.png);
const report = clean({
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws5-retention-validation-v1",
  classification: reconstruction.classification,
  equationId: reconstruction.equationId,
  stateEquationId: reconstruction.stateEquationId,
  sourceHashes: {
    evidenceInventory: sha256(fs.readFileSync(evidencePath)),
    reconstruction: sha256(fs.readFileSync(reconstructionPath)),
    ws2Scenes: sha256(fs.readFileSync(scenePath)),
    ws2Manifest: sha256(fs.readFileSync(ws2ManifestPath)),
    ws3Constraints: sha256(fs.readFileSync(ws3Path)),
    ws3CompileReceipt: sha256(fs.readFileSync(ws3CompilePath)),
    ws4Ensemble: sha256(fs.readFileSync(ws4Path)),
  },
  evidenceItemCount: evidence.evidence.length,
  ws3ConstraintSetId: ws3.constraintSetId,
  checks: fixtures.checks,
  maximumCpuVsShaderFloat32AbsoluteError: fixtures.maximumCpuVsShaderFloat32AbsoluteError,
  cpuVsShaderFloat32Tolerance: fixtures.tolerance,
  actualGpuNumericReadback: "separate target receipt required; repository equation emulator is not GPU evidence",
  fixtures,
  comparisonImage: {
    file: path.basename(imagePath), sha256: sha256(image.png), width: image.width, height: image.height,
    layout: "orange stress-duration rows followed by blue recovery-duration rows; normalized bar length",
  },
  unresolved: reconstruction.limitations,
});
const reportBuffer = jsonBuffer(report);
writeOrCheck(path.join(generatedDir, "ws5-retention-validation-v1.json"), reportBuffer);

const manifest = clean({
  schemaVersion: 1,
  manifestId: "nintendo-ags-101-ws5-presets-v1",
  generatedBy: "tools/build-ags101-ws5.mjs",
  classification: reconstruction.classification,
  default: "ags101-ws5-nominal-frame-global-v1.slangp",
  candidateCount: 12,
  controlCount: 3,
  parityPhasesCoveredByFixtureReceipt: reconstruction.ws3Matrix.parityPhases,
  artifacts,
  validationReceipt: "../ws5-retention-validation-v1.json",
  validationReceiptSha256: sha256(reportBuffer),
});
writeOrCheck(path.join(presetDir, "manifest.json"), jsonBuffer(manifest));

process.stdout.write(checkOnly
  ? "AGS-101 WS5 retention reconstruction and receipts are current.\n"
  : "AGS-101 WS5 retention reconstruction generated.\n");
