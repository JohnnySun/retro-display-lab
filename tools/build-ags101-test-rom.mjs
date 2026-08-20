#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(root, "models", "nintendo-ags-101");
const sourcePath = path.join(modelDir, "data", "ws2-stimulus-scenes-v1.json");
const outputDir = path.join(modelDir, "generated", "ws2-stimulus-v1");
const manifestPath = path.join(outputDir, "manifest.json");
const checkOnly = process.argv.includes("--check");
const WIDTH = 240;
const HEIGHT = 160;
const PAGE_BYTES = WIDTH * HEIGHT;
const ROM_BYTES = 128 * 1024;
const PROGRAM_OFFSET = 0xc0;
const DATA_OFFSET = 0x400;
const ROM_BASE = 0x08000000;

const NINTENDO_LOGO = Buffer.from([
  0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a,
  0x84, 0xe4, 0x09, 0xad, 0x11, 0x24, 0x8b, 0x98, 0xc0, 0x81, 0x7f, 0x21,
  0xa3, 0x52, 0xbe, 0x19, 0x93, 0x09, 0xce, 0x20, 0x10, 0x46, 0x4a, 0x4a,
  0xf8, 0x27, 0x31, 0xec, 0x58, 0xc7, 0xe8, 0x33, 0x82, 0xe3, 0xce, 0xbf,
  0x85, 0xf4, 0xdf, 0x94, 0xce, 0x4b, 0x09, 0xc1, 0x94, 0x56, 0x8a, 0xc0,
  0x13, 0x72, 0xa7, 0xfc, 0x9f, 0x84, 0x4d, 0x73, 0xa3, 0xca, 0x9a, 0x61,
  0x58, 0x97, 0xa3, 0x27, 0xfc, 0x03, 0x98, 0x76, 0x23, 0x1d, 0xc7, 0x61,
  0x03, 0x04, 0xae, 0x56, 0xbf, 0x38, 0x84, 0x00, 0x40, 0xa7, 0x0e, 0xfd,
  0xff, 0x52, 0xfe, 0x03, 0x6f, 0x95, 0x30, 0xf1, 0x97, 0xfb, 0xc0, 0x85,
  0x60, 0xd6, 0x80, 0x25, 0xa9, 0x63, 0xbe, 0x03, 0x01, 0x4e, 0x38, 0xe2,
  0xf9, 0xa2, 0x34, 0xff, 0xbb, 0x3e, 0x03, 0x44, 0x78, 0x00, 0x90, 0xcb,
  0x88, 0x11, 0x3a, 0x94, 0x65, 0xc0, 0x7c, 0x63, 0x87, 0xf0, 0x3c, 0xaf,
  0xd6, 0x25, 0xe4, 0x8b, 0x38, 0x0a, 0xac, 0x72, 0x21, 0xd4, 0xf8, 0x07,
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function rgb555(r, g, b) {
  for (const value of [r, g, b]) {
    if (!Number.isInteger(value) || value < 0 || value > 31) {
      throw new RangeError("RGB555 channel must be an integer from 0 through 31");
    }
  }
  return r | (g << 5) | (b << 10);
}

function solid(color) {
  return new Uint16Array(WIDTH * HEIGHT).fill(color);
}

function sceneFrames(type) {
  const page0 = solid(rgb555(0, 0, 0));
  const page1 = solid(rgb555(0, 0, 0));
  const set = (page, x, y, color) => {
    page[y * WIDTH + x] = color;
  };
  if (type === "color-ramps") {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const code = Math.min(31, Math.floor(x * 32 / WIDTH));
        const band = Math.floor(y / 32);
        const color = [
          rgb555(code, code, code),
          rgb555(code, 0, 0),
          rgb555(0, code, 0),
          rgb555(0, 0, code),
          rgb555(code, 31 - code, Math.floor(code / 2)),
        ][band];
        set(page0, x, y, color);
      }
    }
    page1.set(page0);
  } else if (type === "mixed-patches") {
    const levels = [0, 10, 21, 31];
    const colors = [];
    for (const r of levels) {
      for (const g of levels) {
        for (const b of levels) colors.push(rgb555(r, g, b));
      }
    }
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const column = Math.min(7, Math.floor(x / 30));
        const row = Math.min(7, Math.floor(y / 20));
        set(page0, x, y, colors[row * 8 + column]);
      }
    }
    page1.set(page0);
  } else if (type === "row-markers") {
    for (let y = 0; y < HEIGHT; y += 1) {
      const code = y % 32;
      const sentinel = y === 0 ? rgb555(31, 0, 0)
        : y === 79 ? rgb555(0, 31, 0)
          : y === 159 ? rgb555(0, 0, 31)
            : null;
      for (let x = 0; x < WIDTH; x += 1) {
        const bit = (y >> Math.min(7, Math.floor(x / 16))) & 1;
        const color = x < 128
          ? rgb555(bit ? 31 : 0, bit ? 31 : 0, bit ? 31 : 0)
          : rgb555(code, code, code);
        set(page0, x, y, sentinel !== null && x >= 224 ? sentinel : color);
      }
    }
    page1.set(page0);
  } else if (type === "checkerboard") {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const code = (x + y) % 2 === 0 ? 4 : 27;
        set(page0, x, y, rgb555(code, code, code));
      }
    }
    page1.set(page0);
  } else if (type === "isolated-window") {
    page0.fill(rgb555(6, 6, 6));
    for (let y = 40; y < 120; y += 1) {
      for (let x = 60; x < 180; x += 1) set(page0, x, y, rgb555(26, 26, 26));
    }
    page1.set(page0);
  } else if (type === "full-toggle") {
    page0.fill(rgb555(0, 0, 0));
    page1.fill(rgb555(31, 31, 31));
  } else if (type === "gtg-neutral-gate") {
    page0.fill(rgb555(0, 0, 0));
    page1.fill(rgb555(31, 31, 31));
  } else if (type === "gtg-red-gate") {
    page0.fill(rgb555(0, 0, 0));
    page1.fill(rgb555(31, 0, 0));
  } else if (type === "gtg-green-gate") {
    page0.fill(rgb555(0, 0, 0));
    page1.fill(rgb555(0, 31, 0));
  } else if (type === "gtg-blue-gate") {
    page0.fill(rgb555(0, 0, 0));
    page1.fill(rgb555(0, 0, 31));
  } else if (type === "retention-stress-recovery") {
    page0.fill(rgb555(8, 8, 8));
    for (let y = 32; y < 128; y += 1) {
      for (let x = 48; x < 192; x += 1) set(page0, x, y, rgb555(24, 24, 24));
    }
    page1.fill(rgb555(8, 8, 8));
  } else {
    throw new Error(`unsupported scene type ${type}`);
  }
  return [page0, page1];
}

function indexedPages(frames) {
  const palette = [];
  const indices = new Map();
  const encode = (frame) => {
    const page = Buffer.alloc(PAGE_BYTES);
    for (let index = 0; index < frame.length; index += 1) {
      const color = frame[index];
      let paletteIndex = indices.get(color);
      if (paletteIndex === undefined) {
        paletteIndex = palette.length;
        if (paletteIndex >= 256) throw new Error("scene exceeds the Mode 4 palette limit");
        palette.push(color);
        indices.set(color, paletteIndex);
      }
      page[index] = paletteIndex;
    }
    return page;
  };
  const pages = frames.map(encode);
  const paletteBytes = Buffer.alloc(512);
  palette.forEach((color, index) => paletteBytes.writeUInt16LE(color, index * 2));
  return { palette, paletteBytes, pages };
}

function armProgram(scene) {
  const words = [];
  const labels = new Map();
  const branchFixups = [];
  const literalFixups = [];
  const emit = (word) => words.push(word >>> 0);
  const label = (name) => labels.set(name, words.length);
  const branch = (condition, target) => {
    branchFixups.push({ index: words.length, condition, target });
    emit(0);
  };
  const literal = (condition, register, value) => {
    literalFixups.push({ index: words.length, condition, register, value: value >>> 0 });
    emit(0);
  };
  const copy = (name, destination, source, wordsToCopy) => {
    literal(0xe, 0, destination);
    literal(0xe, 1, source);
    literal(0xe, 2, wordsToCopy);
    label(name);
    emit(0xe4913004); // LDR r3,[r1],#4
    emit(0xe4803004); // STR r3,[r0],#4
    emit(0xe2522001); // SUBS r2,r2,#1
    branch(0x1, name); // BNE
  };

  const paletteAddress = ROM_BASE + DATA_OFFSET;
  const page0Address = paletteAddress + 512;
  const page1Address = page0Address + PAGE_BYTES;
  copy("copy-palette", 0x05000000, paletteAddress, 128);
  copy("copy-page0", 0x06000000, page0Address, PAGE_BYTES / 4);
  copy("copy-page1", 0x0600a000, page1Address, PAGE_BYTES / 4);
  literal(0xe, 6, 0x04000000); // DISPCNT
  literal(0xe, 5, 0x00000404); // Mode 4 + BG2, page 0
  emit(0xe5865000); // STR r5,[r6]
  literal(0xe, 0, 0x04000006); // VCOUNT
  literal(0xe, 4, scene.page0DwellFrames);

  label("frame");
  label("wait-visible");
  emit(0xe1d030b0); // LDRH r3,[r0]
  emit(0xe35300a0); // CMP r3,#160
  branch(0x2, "wait-visible"); // BHS while still in VBlank
  label("wait-vblank");
  emit(0xe1d030b0); // LDRH r3,[r0]
  emit(0xe35300a0); // CMP r3,#160
  branch(0x3, "wait-vblank"); // BLO until VBlank
  emit(0xe2544001); // SUBS r4,r4,#1
  branch(0x1, "frame"); // BNE
  emit(0xe2255010); // EOR r5,r5,#0x10
  label("page-flip-write");
  emit(0xe5865000); // STR r5,[r6]
  emit(0xe3150010); // TST r5,#0x10
  literal(0x0, 4, scene.page0DwellFrames); // LDREQ
  literal(0x1, 4, scene.page1DwellFrames); // LDRNE
  branch(0xe, "frame");

  const literalStart = words.length;
  for (const fixup of literalFixups) {
    fixup.literalIndex = words.length;
    emit(fixup.value);
  }
  for (const fixup of branchFixups) {
    const targetIndex = labels.get(fixup.target);
    if (targetIndex === undefined) throw new Error(`missing ARM label ${fixup.target}`);
    const relative = targetIndex - fixup.index - 2;
    words[fixup.index] = ((fixup.condition << 28) | 0x0a000000 | (relative & 0x00ffffff)) >>> 0;
  }
  for (const fixup of literalFixups) {
    const delta = (fixup.literalIndex - fixup.index - 2) * 4;
    if (delta < 0 || delta > 0xfff) throw new Error("ARM literal pool is out of range");
    words[fixup.index] = (
      (fixup.condition << 28) | 0x059f0000 | (fixup.register << 12) | delta
    ) >>> 0;
  }
  if (literalStart * 4 >= DATA_OFFSET - PROGRAM_OFFSET) {
    throw new Error("ARM program overlaps stimulus data");
  }
  const output = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => output.writeUInt32LE(word, index * 4));
  return {
    buffer: output,
    symbols: Object.fromEntries(
      [...labels.entries()].map(([name, wordIndex]) => [
        name,
        ROM_BASE + PROGRAM_OFFSET + wordIndex * 4,
      ]),
    ),
  };
}

function gbaHeader(rom, sceneId) {
  rom.writeUInt32LE(0xea00002e, 0); // B from 0x08000000 to 0x080000c0.
  NINTENDO_LOGO.copy(rom, 0x04);
  Buffer.from("RDLAGS101WS2", "ascii").copy(rom, 0xa0, 0, 12);
  const code = crypto.createHash("sha256").update(sceneId).digest("hex").slice(0, 4).toUpperCase();
  Buffer.from(code, "ascii").copy(rom, 0xac);
  Buffer.from("RD", "ascii").copy(rom, 0xb0);
  rom[0xb2] = 0x96;
  rom[0xbc] = 0;
  let sum = 0;
  for (let offset = 0xa0; offset <= 0xbc; offset += 1) sum += rom[offset];
  rom[0xbd] = (-(sum + 0x19)) & 0xff;
}

function buildRom(scene) {
  const frames = sceneFrames(scene.type);
  const indexed = indexedPages(frames);
  const program = armProgram(scene);
  const rom = Buffer.alloc(ROM_BYTES, 0xff);
  gbaHeader(rom, scene.sceneId);
  program.buffer.copy(rom, PROGRAM_OFFSET);
  indexed.paletteBytes.copy(rom, DATA_OFFSET);
  indexed.pages[0].copy(rom, DATA_OFFSET + 512);
  indexed.pages[1].copy(rom, DATA_OFFSET + 512 + PAGE_BYTES);
  return {
    rom,
    palette: indexed.palette.map((color, index) => ({
      index,
      rgb555: [color & 31, (color >> 5) & 31, (color >> 10) & 31],
      packed: color,
    })),
    pageSha256: indexed.pages.map(sha256),
    programSha256: sha256(program.buffer),
    programSizeBytes: program.buffer.length,
    runtimeProbe: {
      entryAddress: ROM_BASE + PROGRAM_OFFSET,
      frameLoopAddress: program.symbols.frame,
      waitVBlankAddress: program.symbols["wait-vblank"],
      pageFlipWriteAddress: program.symbols["page-flip-write"],
      displayControlAddress: 0x04000000,
      paletteAddress: 0x05000000,
      page0Address: 0x06000000,
      page1Address: 0x0600a000,
    },
  };
}

function writeOrCheck(file, buffer) {
  const relative = path.relative(root, file);
  if (checkOnly) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buffer)) {
      fail(`${relative} is missing or stale; run node tools/build-ags101-test-rom.mjs`);
    }
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
  fs.writeFileSync(file, buffer);
  console.log(`Wrote ${relative}.`);
  return true;
}

const sourceBuffer = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBuffer);
if (source.schemaVersion !== 1 || !Array.isArray(source.scenes) || source.scenes.length === 0) {
  fail("invalid WS2 stimulus scene source");
}
const seen = new Set();
const records = [];
let changed = false;
for (const scene of source.scenes) {
  if (seen.has(scene.sceneId)) fail(`duplicate sceneId ${scene.sceneId}`);
  seen.add(scene.sceneId);
  for (const field of ["page0DwellFrames", "page1DwellFrames"]) {
    if (!Number.isInteger(scene[field]) || scene[field] < 1 || scene[field] > 0x7fffffff) {
      fail(`${scene.sceneId}: invalid ${field}`);
    }
  }
  const built = buildRom(scene);
  const filename = `${scene.sceneId}.gba`;
  changed = writeOrCheck(path.join(outputDir, filename), built.rom) || changed;
  records.push({
    sceneId: scene.sceneId,
    type: scene.type,
    description: scene.description,
    filename,
    sha256: sha256(built.rom),
    sizeBytes: built.rom.length,
    gbaHeaderChecksum: built.rom[0xbd],
    mode: "GBA bitmap Mode 4 double buffer",
    page0DwellFrames: scene.page0DwellFrames,
    page1DwellFrames: scene.page1DwellFrames,
    pageSha256: built.pageSha256,
    programSha256: built.programSha256,
    programSizeBytes: built.programSizeBytes,
    runtimeProbe: built.runtimeProbe,
    palette: built.palette,
  });
}
const manifest = {
  schemaVersion: 1,
  suiteId: source.suiteId,
  generator: "tools/build-ags101-test-rom.mjs",
  source: {
    path: path.relative(root, sourcePath),
    sha256: sha256(sourceBuffer),
  },
  timing: {
    masterClockHz: 16777216,
    cyclesPerLine: 1232,
    totalLines: 228,
    frameSeconds: 1232 * 228 / 16777216,
    pageFlipEvent: "first VBlank edge after the selected page dwell",
  },
  colorEncoding: source.colorEncoding,
  sourceResolution: source.sourceResolution,
  scenes: records,
};
const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
changed = writeOrCheck(manifestPath, manifestBuffer) || changed;

if (checkOnly) console.log(`AGS-101 WS2 stimulus suite is current (${records.length} ROMs).`);
else if (!changed) console.log("AGS-101 WS2 stimulus suite was already current.");
