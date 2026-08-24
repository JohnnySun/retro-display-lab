#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// This decoder intentionally does not import the ROM generator. Its constants
// come from the byte-level RDLCGB2 metadata and the published manifest, so a
// generator regression cannot silently redefine the decoder's expectations.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteRelative = "models/nintendo-cgb-001/generated/ws2-stimulus-v1";
const suiteDir = path.join(root, suiteRelative);
const manifestPath = path.join(suiteDir, "manifest.json");
const reportRelative = "models/nintendo-cgb-001/generated/ws2-decoder-v1.json";
const reportPath = path.join(root, reportRelative);
const checkOnly = process.argv.includes("--check");
const WIDTH = 160;
const HEIGHT = 144;
const TILE_COLUMNS = 20;
const TILE_ROWS = 18;
const MAP_BYTES = 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function headerChecksum(rom) {
  let checksum = 0;
  for (let offset = 0x134; offset <= 0x14c; offset += 1) checksum = (checksum - rom[offset] - 1) & 255;
  return checksum;
}

function globalChecksum(rom) {
  let checksum = 0;
  for (let offset = 0; offset < rom.length; offset += 1) {
    if (offset !== 0x14e && offset !== 0x14f) checksum = (checksum + rom[offset]) & 0xffff;
  }
  return checksum;
}

function parseMetadata(rom, offset) {
  assert(rom.subarray(offset, offset + 8).toString("ascii") === "RDLCGB2\0", "RDLCGB2 metadata magic is absent");
  const nameEnd = rom.indexOf(0, offset + 40);
  return {
    version: rom.readUInt16LE(offset + 8),
    width: rom.readUInt16LE(offset + 10),
    height: rom.readUInt16LE(offset + 12),
    tileCount: rom.readUInt16LE(offset + 14),
    page0DwellFrames: rom.readUInt16LE(offset + 16),
    page1DwellFrames: rom.readUInt16LE(offset + 18),
    maxPageFlips: rom.readUInt16LE(offset + 20),
    terminalPage: rom[offset + 22],
    tileBankOffsets: [rom.readUInt16LE(offset + 24), rom.readUInt16LE(offset + 26)],
    paletteOffset: rom.readUInt16LE(offset + 28),
    mapOffsets: [rom.readUInt16LE(offset + 30), rom.readUInt16LE(offset + 32)],
    attributeOffsets: [rom.readUInt16LE(offset + 34), rom.readUInt16LE(offset + 36)],
    programLength: rom.readUInt16LE(offset + 38),
    sceneId: rom.subarray(offset + 40, Math.min(nameEnd < 0 ? offset + 72 : nameEnd, offset + 72)).toString("ascii"),
    frameSha256: [
      rom.subarray(offset + 72, offset + 104).toString("hex"),
      rom.subarray(offset + 104, offset + 136).toString("hex"),
    ],
  };
}

function decodePalette(rom, offset) {
  return Array.from({ length: 32 }, (_, index) => {
    const packed = rom.readUInt16LE(offset + index * 2);
    assert((packed & 0x8000) === 0, `palette word ${index} has non-RGB555 bit 15 set`);
    return packed;
  });
}

function decodePage(rom, metadata, palette, page) {
  const framebuffer = Buffer.alloc(WIDTH * HEIGHT * 2);
  const map = rom.subarray(metadata.mapOffsets[page], metadata.mapOffsets[page] + MAP_BYTES);
  const attributes = rom.subarray(metadata.attributeOffsets[page], metadata.attributeOffsets[page] + MAP_BYTES);
  const referencedTiles = new Set();
  for (let tileY = 0; tileY < TILE_ROWS; tileY += 1) {
    for (let tileX = 0; tileX < TILE_COLUMNS; tileX += 1) {
      const mapIndex = tileY * 32 + tileX;
      const attribute = attributes[mapIndex];
      assert((attribute & 0x80) === 0, `page ${page} tile ${tileX},${tileY} has priority bit set unexpectedly`);
      const bank = (attribute >> 3) & 1;
      const tileNumber = map[mapIndex];
      const tileOffset = metadata.tileBankOffsets[bank] + tileNumber * 16;
      const flipX = Boolean(attribute & 0x20);
      const flipY = Boolean(attribute & 0x40);
      const paletteIndex = attribute & 7;
      referencedTiles.add(`${bank}:${tileNumber}`);
      for (let localY = 0; localY < 8; localY += 1) {
        const sourceY = flipY ? 7 - localY : localY;
        const low = rom[tileOffset + sourceY * 2];
        const high = rom[tileOffset + sourceY * 2 + 1];
        for (let localX = 0; localX < 8; localX += 1) {
          const sourceX = flipX ? 7 - localX : localX;
          const bit = 7 - sourceX;
          const colorIndex = ((high >> bit) & 1) * 2 + ((low >> bit) & 1);
          const rgb555 = palette[paletteIndex * 4 + colorIndex];
          const x = tileX * 8 + localX;
          const y = tileY * 8 + localY;
          framebuffer.writeUInt16LE(rgb555, (y * WIDTH + x) * 2);
        }
      }
    }
  }
  return { framebuffer, referencedTiles };
}

function verifyScene(scene, manifest) {
  const romPath = path.join(suiteDir, scene.filename);
  const rom = fs.readFileSync(romPath);
  const layout = manifest.fixedLayout;
  assert(rom.length === 32768 && rom.length === scene.sizeBytes, `${scene.sceneId}: ROM size is not 32 KiB`);
  assert(sha256(rom) === scene.sha256, `${scene.sceneId}: ROM hash differs from manifest`);
  assert(rom[0x100] === 0 && rom[0x101] === 0xc3 && rom.readUInt16LE(0x102) === layout.programOffset,
    `${scene.sceneId}: cartridge entry point differs from contract`);
  assert(rom.subarray(0x104, 0x134).every((value) => value === 0), `${scene.sceneId}: proprietary boot-logo area is not zero`);
  assert(rom[0x143] === 0x80 && scene.cgbFlag === 0x80, `${scene.sceneId}: CGB cartridge flag is not 0x80`);
  assert(rom[0x147] === 0 && rom[0x148] === 0 && rom[0x149] === 0,
    `${scene.sceneId}: cartridge is not 32 KiB ROM-only/no-RAM`);
  assert(headerChecksum(rom) === rom[0x14d] && rom[0x14d] === scene.headerChecksum,
    `${scene.sceneId}: header checksum is invalid`);
  assert(globalChecksum(rom) === rom.readUInt16BE(0x14e), `${scene.sceneId}: global checksum is invalid`);

  const metadata = parseMetadata(rom, layout.metadataOffset);
  assert(metadata.version === 1, `${scene.sceneId}: unsupported metadata version`);
  assert(metadata.sceneId === scene.sceneId, `${scene.sceneId}: metadata scene ID differs`);
  assert(metadata.width === WIDTH && metadata.height === HEIGHT, `${scene.sceneId}: metadata raster differs`);
  assert(metadata.tileCount === scene.videoData.tileCount && metadata.tileCount <= 512,
    `${scene.sceneId}: metadata tile count differs or exceeds CGB banks`);
  assert(metadata.page0DwellFrames === scene.page0DwellFrames && metadata.page1DwellFrames === scene.page1DwellFrames,
    `${scene.sceneId}: metadata dwell differs`);
  assert(metadata.maxPageFlips === (scene.maxPageFlips ?? 0xffff), `${scene.sceneId}: metadata flip limit differs`);
  assert(metadata.terminalPage === (scene.terminalPage ?? 0xff), `${scene.sceneId}: metadata terminal page differs`);
  assert(JSON.stringify(metadata.tileBankOffsets) === JSON.stringify(layout.tileBankOffsets), `${scene.sceneId}: tile-bank offsets differ`);
  assert(metadata.paletteOffset === layout.paletteOffset, `${scene.sceneId}: palette offset differs`);
  assert(JSON.stringify(metadata.mapOffsets) === JSON.stringify(layout.mapOffsets), `${scene.sceneId}: map offsets differ`);
  assert(JSON.stringify(metadata.attributeOffsets) === JSON.stringify(layout.attributeOffsets), `${scene.sceneId}: attribute offsets differ`);
  assert(metadata.programLength === scene.program.byteLength, `${scene.sceneId}: program length differs`);
  assert(sha256(rom.subarray(layout.programOffset, layout.programOffset + metadata.programLength)) === scene.program.sha256,
    `${scene.sceneId}: program hash differs`);

  const tileBankHashes = metadata.tileBankOffsets.map((offset) => sha256(rom.subarray(offset, offset + 4096)));
  const paletteHash = sha256(rom.subarray(metadata.paletteOffset, metadata.paletteOffset + 64));
  const mapHashes = metadata.mapOffsets.map((offset) => sha256(rom.subarray(offset, offset + MAP_BYTES)));
  const attributeHashes = metadata.attributeOffsets.map((offset) => sha256(rom.subarray(offset, offset + MAP_BYTES)));
  assert(JSON.stringify(tileBankHashes) === JSON.stringify(scene.videoData.tileBankSha256), `${scene.sceneId}: tile-bank hash differs`);
  assert(paletteHash === scene.videoData.paletteSha256, `${scene.sceneId}: palette hash differs`);
  assert(JSON.stringify(mapHashes) === JSON.stringify(scene.videoData.mapSha256), `${scene.sceneId}: tile-map hash differs`);
  assert(JSON.stringify(attributeHashes) === JSON.stringify(scene.videoData.attributeSha256), `${scene.sceneId}: attribute-map hash differs`);

  const palette = decodePalette(rom, metadata.paletteOffset);
  const decoded = [0, 1].map((page) => decodePage(rom, metadata, palette, page));
  const frameHashes = decoded.map(({ framebuffer }) => sha256(framebuffer));
  for (const page of [0, 1]) {
    assert(frameHashes[page] === metadata.frameSha256[page], `${scene.sceneId}: page ${page} differs from embedded framebuffer hash`);
    assert(frameHashes[page] === scene.expectedFramebuffer[page].sha256,
      `${scene.sceneId}: page ${page} differs from manifest framebuffer hash`);
    assert(scene.expectedFramebuffer[page].byteLength === WIDTH * HEIGHT * 2,
      `${scene.sceneId}: page ${page} manifest byte length differs`);
  }
  const referencedTiles = new Set(decoded.flatMap((page) => [...page.referencedTiles]));
  assert(referencedTiles.size === metadata.tileCount, `${scene.sceneId}: referenced tile count differs from metadata`);

  return {
    sceneId: scene.sceneId,
    rom: `${suiteRelative}/${scene.filename}`,
    romSha256: sha256(rom),
    headerChecksum: rom[0x14d],
    globalChecksum: rom.readUInt16BE(0x14e),
    metadataVersion: metadata.version,
    tileCount: metadata.tileCount,
    referencedTileCount: referencedTiles.size,
    framebufferSha256: frameHashes,
    status: "pass",
  };
}

function writeOrCheck(buffer) {
  if (checkOnly) {
    assert(fs.existsSync(reportPath), `${reportRelative} is missing`);
    assert(fs.readFileSync(reportPath).equals(buffer), `${reportRelative} is stale; run node tools/decode-cgb001-test-rom.mjs`);
  } else {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, buffer);
    console.log(`Wrote ${reportRelative}`);
  }
}

function main() {
  const manifestBuffer = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBuffer);
  assert(manifest.schemaVersion === 1 && manifest.raster.width === WIDTH && manifest.raster.height === HEIGHT,
    "invalid CGB WS2 manifest");
  const scenes = manifest.scenes.map((scene) => verifyScene(scene, manifest));
  const report = {
    schemaVersion: 1,
    reportId: "cgb001-ws2-independent-rom-decoder-v1",
    modelId: manifest.modelId,
    classification: "derived-validation",
    decoder: "tools/decode-cgb001-test-rom.mjs",
    independence: "Does not import or call the ROM generator; reconstructs visible RGB555 framebuffers from cartridge bytes.",
    source: { manifest: relative(manifestPath), manifestSha256: sha256(manifestBuffer) },
    raster: { width: WIDTH, height: HEIGHT, encoding: "little-endian CGB RGB555" },
    summary: { scenes: scenes.length, decodedPages: scenes.length * 2, pass: scenes.every((scene) => scene.status === "pass") },
    scenes,
  };
  writeOrCheck(Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  console.log(`CGB-001 WS2 independent decoder ${checkOnly ? "receipt is current" : "passed"} (${scenes.length} ROMs).`);
}

try { main(); } catch (error) {
  console.error(`CGB-001 WS2 decoder failed: ${error.message}`);
  process.exitCode = 1;
}
