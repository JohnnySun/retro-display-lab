#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = "3262c2aa4adae8dba4f6d51cdd931c15cb11569f";
const upstreamRelative = `models/nintendo-cgb-001/reference/upstream/gambatte/${commit}`;
const archiveRelative = `${upstreamRelative}/gambatte-libretro.tar.gz`;
const archivePath = path.join(root, archiveRelative);
const headerRelative = `${upstreamRelative}/source/libretro.h`;
const headerPath = path.join(root, headerRelative);
const manifestRelative = "models/nintendo-cgb-001/generated/ws2-stimulus-v1/manifest.json";
const manifestPath = path.join(root, manifestRelative);
const harnessRelative = "tools/cgb001-libretro-smoke.c";
const harnessPath = path.join(root, harnessRelative);
const reportRelative = "models/nintendo-cgb-001/generated/ws2-gambatte-smoke-v1.json";
const reportPath = path.join(root, reportRelative);
const checkOnly = process.argv.includes("--check");
const FRAME_BYTES = 160 * 144 * 2;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function parseKeyValues(text) {
  return Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function decodeRomPages(rom, layout) {
  const palette = Array.from({ length: 32 }, (_, index) => rom.readUInt16LE(layout.paletteOffset + index * 2));
  return [0, 1].map((page) => {
    const rgb565 = Buffer.alloc(FRAME_BYTES);
    for (let tileY = 0; tileY < 18; tileY += 1) for (let tileX = 0; tileX < 20; tileX += 1) {
      const mapIndex = tileY * 32 + tileX;
      const attribute = rom[layout.attributeOffsets[page] + mapIndex];
      const tileNumber = rom[layout.mapOffsets[page] + mapIndex];
      const bank = (attribute >> 3) & 1;
      const tileOffset = layout.tileBankOffsets[bank] + tileNumber * 16;
      const paletteIndex = attribute & 7;
      for (let localY = 0; localY < 8; localY += 1) {
        const sourceY = attribute & 0x40 ? 7 - localY : localY;
        const low = rom[tileOffset + sourceY * 2];
        const high = rom[tileOffset + sourceY * 2 + 1];
        for (let localX = 0; localX < 8; localX += 1) {
          const sourceX = attribute & 0x20 ? 7 - localX : localX;
          const bit = 7 - sourceX;
          const colorIndex = (((high >> bit) & 1) << 1) | ((low >> bit) & 1);
          const rgb555 = palette[paletteIndex * 4 + colorIndex];
          const r = rgb555 & 31;
          const g = (rgb555 >> 5) & 31;
          const b = (rgb555 >> 10) & 31;
          rgb565.writeUInt16LE((r << 11) | (g << 6) | b,
            ((tileY * 8 + localY) * 160 + tileX * 8 + localX) * 2);
        }
      }
    }
    return rgb565;
  });
}

function exhaustiveTransportProof() {
  const packedWords = new Set();
  let tested = 0;
  for (let r = 0; r < 32; r += 1) for (let g = 0; g < 32; g += 1) for (let b = 0; b < 32; b += 1) {
    const packed = (r << 11) | (g << 6) | b;
    packedWords.add(packed);
    assert((packed & 0x20) === 0, "Gambatte RGB565 green least-significant bit is not zero");
    assert(((packed >> 11) & 31) === r, "RGB565 integer red recovery failed");
    assert((((packed >> 5) & 63) >> 1) === g, "RGB565 integer green recovery failed");
    assert((packed & 31) === b, "RGB565 integer blue recovery failed");
    const normalizedR = ((packed >> 11) & 31) / 31;
    const normalizedG = ((packed >> 5) & 63) / 63;
    const normalizedB = (packed & 31) / 31;
    assert(Math.round(normalizedR * 31) === r, "normalized red recovery failed");
    assert(Math.round(normalizedG * 63 / 2) === g, "normalized green recovery failed");
    assert(Math.round(normalizedB * 31) === b, "normalized blue recovery failed");
    tested += 1;
  }
  assert(packedWords.size === 32768, "RGB555 to RGB565 mapping is not injective");
  return {
    testedRgb555Codes: tested,
    uniqueRgb565Words: packedWords.size,
    greenPaddingBit: "RGB565 bit 5 is always zero",
    integerDecoder: { r: "(word >> 11) & 31", g: "((word >> 5) & 63) >> 1", b: "word & 31" },
    normalizedTextureDecoder: { r: "round(sample.r * 31)", g: "round(sample.g * 63 / 2)", b: "round(sample.b * 31)" },
    status: "pass",
  };
}

function buildAndRun() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cgb001-ws2-gambatte-"));
  try {
    run("tar", ["-xzf", archivePath, "-C", scratch]);
    const sourceDir = path.join(scratch, `gambatte-libretro-${commit}`);
    const platform = process.platform === "darwin" ? "osx" : "unix";
    const coreName = process.platform === "darwin" ? "gambatte_libretro.dylib" : "gambatte_libretro.so";
    run("make", ["-f", "Makefile.libretro", `platform=${platform}`, "-j4"], { cwd: sourceDir });
    const corePath = path.join(sourceDir, coreName);
    assert(fs.existsSync(corePath), `Gambatte build did not produce ${coreName}`);
    const harnessBinary = path.join(scratch, "cgb001-libretro-smoke");
    const compiler = process.platform === "darwin" ? "clang" : "cc";
    const compileArguments = [
      "-std=gnu11", "-Wall", "-Wextra", "-Werror",
      "-I", path.dirname(headerPath), harnessPath, "-o", harnessBinary,
    ];
    if (process.platform !== "darwin") compileArguments.push("-ldl");
    run(compiler, compileArguments, { cwd: root });

    const manifestBuffer = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBuffer);
    const runtimeScenes = [];
    let libraryIdentity = null;
    for (const scene of manifest.scenes) {
      const romPath = path.join(path.dirname(manifestPath), scene.filename);
      const rom = fs.readFileSync(romPath);
      const expectedBuffers = decodeRomPages(rom, manifest.fixedLayout);
      const expectedHashes = expectedBuffers.map(sha256);
      const uniqueExpectedHashes = [...new Set(expectedHashes)];
      const runs = scene.type === "rgb555-exhaustive-transport"
        ? 1080
        : scene.maxPageFlips === null
        ? Math.max(48, scene.page0DwellFrames + scene.page1DwellFrames + 48)
        : scene.page0DwellFrames + 48;
      const capturePath = path.join(scratch, `${scene.sceneId}.rgb565`);
      const runResult = run(harnessBinary, [corePath, romPath, String(runs), capturePath, scratch], { cwd: root });
      const identity = parseKeyValues(runResult.stdout);
      if (!libraryIdentity) libraryIdentity = identity;
      assert(identity.library === "Gambatte", `${scene.sceneId}: unexpected core library name`);
      assert(identity.format === "2", `${scene.sceneId}: core did not request RETRO_PIXEL_FORMAT_RGB565`);
      assert(identity.base === "160x144" && identity.max === "160x144", `${scene.sceneId}: core geometry differs`);
      assert(Math.abs(Number(identity.fps) - 4194304 / 70224) < 1e-9, `${scene.sceneId}: core frame rate differs`);
      const captures = fs.readFileSync(capturePath);
      assert(captures.length % FRAME_BYTES === 0, `${scene.sceneId}: partial framebuffer capture`);
      const frameCount = captures.length / FRAME_BYTES;
      const observedHashes = [];
      const firstObservedFrame = Object.fromEntries(uniqueExpectedHashes.map((hash) => [hash, null]));
      const observedRgb565Words = new Set();
      let greenPaddingViolations = 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const buffer = captures.subarray(frame * FRAME_BYTES, (frame + 1) * FRAME_BYTES);
        const hash = sha256(buffer);
        observedHashes.push(hash);
        if (hash in firstObservedFrame && firstObservedFrame[hash] === null) firstObservedFrame[hash] = frame;
        for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
          const word = buffer.readUInt16LE(offset);
          observedRgb565Words.add(word);
          if (word & 0x20) greenPaddingViolations += 1;
        }
      }
      assert(Object.values(firstObservedFrame).every((frame) => frame !== null),
        `${scene.sceneId}: expected RGB565 page was not emitted by Gambatte`);
      assert(greenPaddingViolations === 0, `${scene.sceneId}: core emitted a nonzero RGB565 green padding bit`);
      if (scene.type === "rgb555-exhaustive-transport") {
        assert(observedRgb565Words.size === 32768,
          `${scene.sceneId}: core emitted ${observedRgb565Words.size} distinct transport words instead of 32768`);
        for (let r = 0; r < 32; r += 1) for (let g = 0; g < 32; g += 1) for (let b = 0; b < 32; b += 1) {
          assert(observedRgb565Words.has((r << 11) | (g << 6) | b),
            `${scene.sceneId}: core output omitted RGB555 ${r},${g},${b}`);
        }
      }
      runtimeScenes.push({
        sceneId: scene.sceneId,
        romSha256: sha256(rom),
        retroRunCalls: runs,
        capturedFrames: frameCount,
        expectedPageRgb565Sha256: expectedHashes,
        firstObservedFrame,
        distinctCapturedFrameSha256: [...new Set(observedHashes)].sort(),
        distinctObservedRgb565Words: observedRgb565Words.size,
        exhaustiveRgb555CoreTransport: scene.type === "rgb555-exhaustive-transport"
          ? { testedCodes: 32768, missingCodes: 0, status: "pass" }
          : null,
        greenPaddingBitViolations: greenPaddingViolations,
        status: "pass",
      });
    }
    return {
      manifestBuffer,
      manifest,
      libraryIdentity: {
        name: libraryIdentity.library,
        version: libraryIdentity.version,
        validExtensions: libraryIdentity.extensions,
        requestedPixelFormatEnum: Number(libraryIdentity.format),
        geometry: libraryIdentity.base,
        maximumGeometry: libraryIdentity.max,
        framesPerSecond: Number(libraryIdentity.fps),
        sampleRateHz: Number(libraryIdentity.sample_rate),
        videoPitchBytes: Number(libraryIdentity.pitch),
      },
      runtimeScenes,
      platform,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  assert(fs.existsSync(archivePath), `${archiveRelative} is missing`);
  const archive = fs.readFileSync(archivePath);
  const harness = fs.readFileSync(harnessPath);
  const header = fs.readFileSync(headerPath);
  const runtime = buildAndRun();
  const transport = exhaustiveTransportProof();
  const report = {
    schemaVersion: 1,
    reportId: "cgb001-ws2-gambatte-libretro-smoke-v1",
    modelId: runtime.manifest.modelId,
    classification: "derived-validation",
    core: {
      repository: "https://github.com/libretro/gambatte-libretro",
      commit,
      sourceArchive: archiveRelative,
      sourceArchiveSha256: sha256(archive),
      build: { makefile: "Makefile.libretro", platform: runtime.platform, videoDefine: "VIDEO_RGB565=1" },
      runtimeIdentity: runtime.libraryIdentity,
    },
    requiredCoreOptions: {
      gambatte_gbc_color_correction: "disabled",
      gambatte_dark_filter_level: "0",
      gambatte_mix_frames: "disabled",
      gambatte_gb_hwmode: "Auto",
      gambatte_gb_bootloader: "disabled",
      gambatte_gb_colorization: "GBC",
    },
    source: {
      manifest: manifestRelative,
      manifestSha256: sha256(runtime.manifestBuffer),
      harness: harnessRelative,
      harnessSha256: sha256(harness),
      libretroHeader: headerRelative,
      libretroHeaderSha256: sha256(header),
    },
    transportProof: transport,
    summary: {
      scenes: runtime.runtimeScenes.length,
      emittedExpectedPages: runtime.runtimeScenes.reduce((sum, scene) => sum + Object.keys(scene.firstObservedFrame).length, 0),
      actualCoreExhaustiveRgb555Codes: runtime.runtimeScenes.find((scene) => scene.sceneId === "rgb555-exhaustive-transport")
        ?.exhaustiveRgb555CoreTransport.testedCodes ?? 0,
      pass: transport.status === "pass" && runtime.runtimeScenes.every((scene) => scene.status === "pass"),
    },
    scenes: runtime.runtimeScenes,
  };
  const buffer = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  if (checkOnly) {
    assert(fs.existsSync(reportPath), `${reportRelative} is missing`);
    assert(fs.readFileSync(reportPath).equals(buffer), `${reportRelative} is stale; run node tools/validate-cgb001-ws2-gambatte.mjs`);
  } else {
    fs.writeFileSync(reportPath, buffer);
    console.log(`Wrote ${reportRelative}`);
  }
  console.log(`CGB-001 WS2 Gambatte smoke ${checkOnly ? "receipt is current" : "passed"} (${report.summary.scenes} ROMs; ${transport.testedRgb555Codes} RGB555 codes).`);
}

try { main(); } catch (error) {
  console.error(`CGB-001 WS2 Gambatte validation failed: ${error.message}`);
  process.exitCode = 1;
}
