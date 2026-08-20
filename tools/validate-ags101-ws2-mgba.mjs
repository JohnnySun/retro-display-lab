#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const sourcePath = path.join(modelDir, "data", "ws2-stimulus-scenes-v1.json");
const stimulusDir = path.join(modelDir, "generated", "ws2-stimulus-v1");
const manifestPath = path.join(stimulusDir, "manifest.json");
const outputDir = path.join(modelDir, "generated", "ws2-mgba-smoke-v1");
const reportPath = path.join(outputDir, "report.json");
const checkOnly = process.argv.includes("--check");
const mgbaArgumentIndex = process.argv.indexOf("--mgba");
const holdArgumentIndex = process.argv.indexOf("--hold-ms");
const defaultMgba = "/Applications/mGBA.app/Contents/MacOS/mGBA";
const mgbaPath = mgbaArgumentIndex >= 0 ? process.argv[mgbaArgumentIndex + 1] : defaultMgba;
const holdMilliseconds = holdArgumentIndex >= 0
  ? Number(process.argv[holdArgumentIndex + 1])
  : 750;
const ROM_BASE = 0x08000000;
const PROGRAM_OFFSET = 0xc0;
const DATA_OFFSET = 0x400;
const PAGE_BYTES = 240 * 160;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function relative(file) {
  return path.relative(root, file);
}

function stableLog(value) {
  return value.trim().replace(/0x[0-9a-f]+/gi, "0x<pointer>");
}

function headerChecksum(rom) {
  let sum = 0;
  for (let offset = 0xa0; offset <= 0xbc; offset += 1) sum += rom[offset];
  return (-(sum + 0x19)) & 0xff;
}

function readAscii(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString("ascii");
}

function romOffset(address) {
  return address - ROM_BASE;
}

function decodeArmLiteral(rom, instructionOffset) {
  const instruction = rom.readUInt32LE(instructionOffset);
  const isPcRelativeLoad = (instruction & 0x0fff0000) === 0x059f0000;
  if (!isPcRelativeLoad) throw new Error(`0x${instructionOffset.toString(16)} is not an ARM PC-relative LDR`);
  const targetOffset = instructionOffset + 8 + (instruction & 0xfff);
  return {
    condition: instruction >>> 28,
    register: (instruction >>> 12) & 0xf,
    targetOffset,
    value: rom.readUInt32LE(targetOffset),
  };
}

function decodeArmBranchTarget(rom, instructionOffset) {
  const instruction = rom.readUInt32LE(instructionOffset);
  if ((instruction & 0x0f000000) !== 0x0a000000) {
    throw new Error(`0x${instructionOffset.toString(16)} is not an ARM branch`);
  }
  let relative = instruction & 0x00ffffff;
  if (relative & 0x00800000) relative |= 0xff000000;
  return ROM_BASE + instructionOffset + 8 + (relative << 2);
}

function verifyRom(scene, sourceScene) {
  const romPath = path.join(stimulusDir, scene.filename);
  if (!fs.existsSync(romPath)) throw new Error(`${relative(romPath)} is missing`);
  const rom = fs.readFileSync(romPath);
  const issues = [];
  const expect = (condition, message) => {
    if (!condition) issues.push(message);
  };

  expect(scene.sceneId === sourceScene.sceneId, "sceneId differs from source");
  expect(scene.type === sourceScene.type, "scene type differs from source");
  expect(scene.description === sourceScene.description, "description differs from source");
  expect(scene.page0DwellFrames === sourceScene.page0DwellFrames, "page 0 dwell differs from source");
  expect(scene.page1DwellFrames === sourceScene.page1DwellFrames, "page 1 dwell differs from source");
  for (const field of [
    "surroundCode", "window", "page0WindowCode", "page1WindowCode",
    "maxPageFlips", "terminalPage",
  ]) {
    expect(JSON.stringify(scene[field]) === JSON.stringify(sourceScene[field]), `${field} differs from source`);
  }
  expect(rom.length === scene.sizeBytes, "ROM size differs from manifest");
  expect(sha256(rom) === scene.sha256, "ROM SHA-256 differs from manifest");
  expect(rom.readUInt32LE(0) === 0xea00002e, "entry branch does not target 0x080000c0");
  expect(readAscii(rom, 0xa0, 12) === "RDLAGS101WS2", "GBA title is not RDLAGS101WS2");
  const expectedCode = crypto.createHash("sha256").update(scene.sceneId).digest("hex").slice(0, 4).toUpperCase();
  expect(readAscii(rom, 0xac, 4) === expectedCode, "GBA game code does not identify the scene");
  expect(rom[0xbd] === headerChecksum(rom), "GBA header checksum is invalid");
  expect(rom[0xbd] === scene.gbaHeaderChecksum, "GBA header checksum differs from manifest");

  const program = rom.subarray(PROGRAM_OFFSET, PROGRAM_OFFSET + scene.programSizeBytes);
  expect(sha256(program) === scene.programSha256, "program SHA-256 differs from manifest");
  for (const color of scene.palette) {
    expect(
      rom.readUInt16LE(DATA_OFFSET + color.index * 2) === color.packed,
      `palette index ${color.index} differs from manifest`,
    );
  }
  const page0 = rom.subarray(DATA_OFFSET + 512, DATA_OFFSET + 512 + PAGE_BYTES);
  const page1 = rom.subarray(DATA_OFFSET + 512 + PAGE_BYTES, DATA_OFFSET + 512 + PAGE_BYTES * 2);
  expect(sha256(page0) === scene.pageSha256[0], "page 0 SHA-256 differs from manifest");
  expect(sha256(page1) === scene.pageSha256[1], "page 1 SHA-256 differs from manifest");
  for (const [pageIndex, page] of [page0, page1].entries()) {
    const highestIndex = page.reduce((maximum, value) => Math.max(maximum, value), 0);
    expect(highestIndex < scene.palette.length, `page ${pageIndex} references an absent palette entry`);
  }

  const probe = scene.runtimeProbe;
  expect(probe.entryAddress === ROM_BASE + PROGRAM_OFFSET, "runtime entry address is inconsistent");
  const frameOffset = romOffset(probe.frameLoopAddress);
  const flipOffset = romOffset(probe.pageFlipWriteAddress);
  expect(rom.readUInt32LE(frameOffset) === 0xe1d030b0, "frame loop does not begin with VCOUNT load");
  expect(rom.readUInt32LE(flipOffset - 4) === 0xe2255010, "page flip is not preceded by page-bit toggle");
  expect(rom.readUInt32LE(flipOffset) === 0xe5865000, "page flip does not write DISPCNT");
  expect(rom.readUInt32LE(flipOffset + 4) === 0xe3150010, "page flip does not test the selected page");
  const page0Literal = decodeArmLiteral(rom, flipOffset + 8);
  const page1Literal = decodeArmLiteral(rom, flipOffset + 12);
  expect(page0Literal.condition === 0 && page0Literal.register === 4, "page 0 dwell load is not LDREQ r4");
  expect(page1Literal.condition === 1 && page1Literal.register === 4, "page 1 dwell load is not LDRNE r4");
  expect(page0Literal.value === scene.page0DwellFrames, "page 0 dwell literal differs from manifest");
  expect(page1Literal.value === scene.page1DwellFrames, "page 1 dwell literal differs from manifest");
  if (sourceScene.maxPageFlips !== undefined) {
    const maxFlipLoadOffset = romOffset(probe.maxPageFlipsLoadAddress);
    const maxFlipLiteral = decodeArmLiteral(rom, maxFlipLoadOffset);
    const safeHoldOffset = romOffset(probe.safeHoldAddress);
    expect(maxFlipLiteral.condition === 0xe && maxFlipLiteral.register === 7,
      "maximum page-flip load is not LDR r7");
    expect(maxFlipLiteral.value === sourceScene.maxPageFlips,
      "maximum page-flip literal differs from source");
    expect(rom.readUInt32LE(flipOffset + 16) === 0xe2577001,
      "bounded scene does not decrement the page-flip counter");
    expect((rom.readUInt32LE(flipOffset + 20) >>> 28) === 0,
      "bounded scene does not use an equality branch after the page-flip counter");
    expect(decodeArmBranchTarget(rom, flipOffset + 20) === probe.safeHoldAddress,
      "bounded scene does not branch to the safe hold at its limit");
    expect(rom.readUInt32LE(safeHoldOffset) === 0xeafffffe,
      "safe hold is not a stationary self-loop");
    expect(scene.maximumDynamicSeconds <= 10.1,
      "bounded scene exceeds the 10.1-second dynamic safety limit");
    expect(scene.terminalBehavior === "hold terminal page indefinitely without further page flips",
      "bounded scene terminal behavior is absent or unexpected");
  }

  return {
    sceneId: scene.sceneId,
    rom: relative(romPath),
    romSha256: sha256(rom),
    gbaHeaderChecksum: rom[0xbd],
    pageSha256: [sha256(page0), sha256(page1)],
    paletteEntries: scene.palette.length,
    dwellFrames: [page0Literal.value, page1Literal.value],
    runtimeProbe: probe,
    consistencyStatus: issues.length === 0 ? "pass" : "fail",
    issues,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function launchRom(romPath, scratchDir) {
  const child = spawn(mgbaPath, [
    "-C", "audioSync=0",
    "-C", "videoSync=0",
    "-C", "mute=1",
    "-C", "skipBios=1",
    "-C", `savegamePath=${scratchDir}`,
    "-C", `savestatePath=${scratchDir}`,
    "-C", `screenshotPath=${scratchDir}`,
    romPath,
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let exit = null;
  child.once("exit", (code, signal) => { exit = { code, signal }; });
  await wait(holdMilliseconds);
  const aliveAfterHold = exit === null;
  if (aliveAfterHold) child.kill("SIGTERM");
  const deadline = Date.now() + 2000;
  while (exit === null && Date.now() < deadline) await wait(25);
  if (exit === null) child.kill("SIGKILL");
  while (exit === null) await wait(25);
  return {
    holdMilliseconds,
    aliveAfterHold,
    exitCode: exit.code,
    exitSignal: exit.signal,
    stdout: stableLog(stdout),
    stderr: stableLog(stderr),
    pass: aliveAfterHold && exit.signal === "SIGTERM",
  };
}

const sourceBuffer = fs.readFileSync(sourcePath);
const manifestBuffer = fs.readFileSync(manifestPath);
const source = JSON.parse(sourceBuffer);
const manifest = JSON.parse(manifestBuffer);
if (source.schemaVersion !== 1 || manifest.schemaVersion !== 1) fail("invalid WS2 source or manifest schema");
if (source.suiteId !== manifest.suiteId) fail("WS2 source and manifest suite IDs differ");
if (sha256(sourceBuffer) !== manifest.source.sha256) fail("WS2 manifest source hash is stale");
if (source.scenes.length !== manifest.scenes.length) fail("WS2 source and manifest scene counts differ");

const sourceScenes = new Map(source.scenes.map((scene) => [scene.sceneId, scene]));
const consistency = manifest.scenes.map((scene) => {
  const sourceScene = sourceScenes.get(scene.sceneId);
  if (!sourceScene) fail(`manifest scene ${scene.sceneId} is absent from the source`);
  return verifyRom(scene, sourceScene);
});
const consistencyPass = consistency.every((entry) => entry.consistencyStatus === "pass");
if (!consistencyPass) {
  fail(consistency.flatMap((entry) => entry.issues.map((issue) => `${entry.sceneId}: ${issue}`)).join("\n"));
}

if (checkOnly) {
  if (!fs.existsSync(reportPath)) fail(`${relative(reportPath)} is missing; run the mGBA smoke test`);
  const report = JSON.parse(fs.readFileSync(reportPath));
  if (report.source.manifestSha256 !== sha256(manifestBuffer)) fail("mGBA smoke report is stale for the manifest");
  if (report.source.sceneSourceSha256 !== sha256(sourceBuffer)) fail("mGBA smoke report is stale for the scene source");
  if (!report.summary.pass || report.summary.scenes !== manifest.scenes.length) fail("mGBA smoke report did not pass");
  const recorded = new Map(report.scenes.map((scene) => [scene.sceneId, scene]));
  for (const scene of consistency) {
    const receipt = recorded.get(scene.sceneId);
    if (!receipt || receipt.romSha256 !== scene.romSha256 || !receipt.runtime.pass) {
      fail(`mGBA smoke receipt is missing or stale for ${scene.sceneId}`);
    }
  }
  console.log(`AGS-101 WS2 mGBA smoke receipt is current (${consistency.length} ROMs).`);
  process.exit(0);
}

if (!Number.isInteger(holdMilliseconds) || holdMilliseconds < 250 || holdMilliseconds > 10000) {
  fail("--hold-ms must be an integer from 250 through 10000");
}
if (!mgbaPath || !fs.existsSync(mgbaPath)) fail(`mGBA executable not found: ${mgbaPath}`);
const versionResult = spawnSync(mgbaPath, ["--version"], { encoding: "utf8" });
if (versionResult.status !== 0) fail(`mGBA --version failed: ${versionResult.stderr}`);
const version = versionResult.stdout.trim();
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "rdl-ags101-ws2-mgba-"));
const runtime = [];
try {
  for (const scene of consistency) {
    const result = await launchRom(path.join(root, scene.rom), scratchDir);
    runtime.push({ sceneId: scene.sceneId, ...result });
    console.log(`${scene.sceneId}: ${result.pass ? "booted" : "failed"}`);
  }
} finally {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}

const runtimeById = new Map(runtime.map((entry) => [entry.sceneId, entry]));
const scenes = consistency.map((entry) => ({
  ...entry,
  runtime: runtimeById.get(entry.sceneId),
}));
const report = {
  schemaVersion: 1,
  reportId: "nintendo-ags-101-ws2-mgba-smoke-v1",
  classification: "emulator-runtime-smoke-plus-static-rom-consistency",
  capturedAt: new Date().toISOString(),
  generator: "tools/validate-ags101-ws2-mgba.mjs",
  emulator: {
    name: "mGBA",
    executablePath: mgbaPath,
    executableSha256: sha256(fs.readFileSync(mgbaPath)),
    version,
    platform: `${process.platform}-${process.arch}`,
    options: ["audioSync=0", "videoSync=0", "mute=1", "skipBios=1"],
  },
  source: {
    sceneSource: relative(sourcePath),
    sceneSourceSha256: sha256(sourceBuffer),
    manifest: relative(manifestPath),
    manifestSha256: sha256(manifestBuffer),
  },
  scope: {
    runtime: "Each ROM remained alive in pinned mGBA for the hold interval and was then terminated by this validator.",
    consistency: "ROM header, program, palette, both pages, page-selection instructions, and dwell literals independently match the source and manifest.",
    limitation: "This receipt does not claim original-GBA electrical timing or observe an AGS-101 panel.",
  },
  summary: {
    scenes: scenes.length,
    runtimeBootPasses: scenes.filter((scene) => scene.runtime.pass).length,
    consistencyPasses: scenes.filter((scene) => scene.consistencyStatus === "pass").length,
    pass: scenes.every((scene) => scene.runtime.pass && scene.consistencyStatus === "pass"),
  },
  scenes,
};
if (!report.summary.pass) fail("one or more WS2 ROMs failed the mGBA smoke test");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(reportPath, jsonBuffer(report));
console.log(`Wrote ${relative(reportPath)}.`);
