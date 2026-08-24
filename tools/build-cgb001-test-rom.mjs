#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelRelative = "models/nintendo-cgb-001";
const sourceRelative = `${modelRelative}/data/ws2-stimulus-scenes-v1.json`;
const sourcePath = path.join(root, sourceRelative);
const outputRelative = `${modelRelative}/generated/ws2-stimulus-v1`;
const outputDir = path.join(root, outputRelative);
const manifestPath = path.join(outputDir, "manifest.json");
const WIDTH = 160;
const HEIGHT = 144;
const TILE_COLUMNS = 20;
const TILE_ROWS = 18;
const MAP_BYTES = 1024;
const ROM_BYTES = 32 * 1024;
const PROGRAM_OFFSET = 0x0150;
const METADATA_OFFSET = 0x0400;
const TILE_BANK_0_OFFSET = 0x1000;
const TILE_BANK_1_OFFSET = 0x2000;
const PALETTE_OFFSET = 0x3000;
const MAP_0_OFFSET = 0x3040;
const MAP_1_OFFSET = 0x3440;
const ATTR_0_OFFSET = 0x3840;
const ATTR_1_OFFSET = 0x3c40;
const FRAME_SECONDS = 70224 / 4194304;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rgb555(r, g, b) {
  for (const value of [r, g, b]) assert(Number.isInteger(value) && value >= 0 && value <= 31, "RGB555 channel outside 0..31");
  return r | (g << 5) | (b << 10);
}

function unpackRgb555(value) {
  return [value & 31, (value >> 5) & 31, (value >> 10) & 31];
}

export function gambatteRgb565(value) {
  const [r, g, b] = unpackRgb555(value);
  return (r << 11) | (g << 6) | b;
}

function frameBuffer() {
  return new Uint16Array(WIDTH * HEIGHT);
}

function cloneFrame(frame) {
  return new Uint16Array(frame);
}

function fillRect(frame, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) frame[py * WIDTH + px] = color;
  }
}

function patchGrid(frame, colors, columns, rows) {
  assert(colors.length === columns * rows, "patch grid color count mismatch");
  for (let index = 0; index < colors.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x0 = Math.floor(column * WIDTH / columns);
    const x1 = Math.floor((column + 1) * WIDTH / columns);
    const y0 = Math.floor(row * HEIGHT / rows / 8) * 8;
    const y1 = row === rows - 1 ? HEIGHT : Math.floor((row + 1) * HEIGHT / rows / 8) * 8;
    fillRect(frame, x0, y0, x1 - x0, y1 - y0, colors[index]);
  }
}

function sceneFrames(scene) {
  const page0 = frameBuffer();
  const black = rgb555(0, 0, 0);
  page0.fill(black);
  if (scene.type === "channel-ramp") {
    const colors = Array.from({ length: 32 }, (_, code) => {
      if (scene.channel === "R") return rgb555(code, 0, 0);
      if (scene.channel === "G") return rgb555(0, code, 0);
      if (scene.channel === "B") return rgb555(0, 0, code);
      return rgb555(code, code, code);
    });
    patchGrid(page0, colors, 8, 4);
  } else if (scene.type === "color-corners") {
    patchGrid(page0, [
      rgb555(0, 0, 0), rgb555(31, 0, 0), rgb555(0, 31, 0), rgb555(0, 0, 31),
      rgb555(31, 31, 0), rgb555(0, 31, 31), rgb555(31, 0, 31), rgb555(31, 31, 31),
    ], 8, 1);
  } else if (scene.type === "mixed-patches") {
    const rLevels = [3, 12, 21, 30];
    const gLevels = [2, 11, 20, 29];
    const colors = Array.from({ length: 32 }, (_, index) => rgb555(
      rLevels[index % 4],
      gLevels[Math.floor(index / 8)],
      (index * 7 + 5) % 32,
    ));
    patchGrid(page0, colors, 8, 4);
  } else if (scene.type === "row-markers") {
    for (let tileRow = 0; tileRow < TILE_ROWS; tileRow += 1) {
      const bits = tileRow;
      for (let tileColumn = 0; tileColumn < 16; tileColumn += 1) {
        const bit = (bits >> (tileColumn % 5)) & 1;
        fillRect(page0, tileColumn * 8, tileRow * 8, 8, 8, bit ? rgb555(31, 31, 31) : black);
      }
      fillRect(page0, 128, tileRow * 8, 24, 8, rgb555(tileRow, tileRow, tileRow));
      const sentinel = tileRow === 0 ? rgb555(31, 0, 0)
        : tileRow === 8 ? rgb555(0, 31, 0)
          : tileRow === 17 ? rgb555(0, 0, 31)
            : rgb555(tileRow, tileRow, tileRow);
      fillRect(page0, 152, tileRow * 8, 8, 8, sentinel);
    }
  } else if (scene.type === "first-last-row-change") {
    page0.fill(rgb555(8, 8, 8));
    const page1 = cloneFrame(page0);
    fillRect(page1, 0, 0, WIDTH, 1, rgb555(31, 0, 0));
    fillRect(page1, 0, HEIGHT - 1, WIDTH, 1, rgb555(0, 0, 31));
    return [page0, page1];
  } else if (scene.type === "moving-edge") {
    page0.fill(rgb555(4, 4, 4));
    fillRect(page0, 0, 0, 80, HEIGHT, rgb555(27, 27, 27));
    const page1 = frameBuffer();
    page1.fill(rgb555(4, 4, 4));
    fillRect(page1, 0, 0, 88, HEIGHT, rgb555(27, 27, 27));
    return [page0, page1];
  } else if (scene.type === "checkerboard" || scene.type === "parity-toggle") {
    const low = rgb555(4, 4, 4);
    const high = rgb555(27, 27, 27);
    const page1 = frameBuffer();
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const parity = (x + y) & 1;
      page0[y * WIDTH + x] = parity ? high : low;
      page1[y * WIDTH + x] = parity ? low : high;
    }
    return [page0, scene.type === "parity-toggle" ? page1 : cloneFrame(page0)];
  } else if (scene.type === "isolated-window") {
    page0.fill(rgb555(6, 6, 6));
    fillRect(page0, 56, 40, 48, 48, rgb555(26, 26, 26));
  } else if (scene.type === "alternating-lines") {
    for (let y = 0; y < HEIGHT; y += 1) fillRect(
      page0,
      0,
      y,
      WIDTH,
      1,
      y & 1 ? rgb555(25, 25, 25) : rgb555(6, 6, 6),
    );
  } else if (scene.type === "retention-stress-recovery") {
    page0.fill(rgb555(8, 8, 8));
    fillRect(page0, 56, 48, 48, 48, rgb555(24, 24, 24));
    const page1 = frameBuffer();
    page1.fill(rgb555(8, 8, 8));
    return [page0, page1];
  } else if (scene.type === "pixel-grid-identity") {
    const colors = [rgb555(0, 0, 0), rgb555(31, 0, 0), rgb555(0, 31, 0), rgb555(0, 0, 31)];
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      page0[y * WIDTH + x] = colors[((x & 1) | ((y & 1) << 1))];
    }
  } else if (scene.type === "rgb555-exhaustive-transport") {
    patchGrid(page0, Array.from({ length: 32 }, (_, code) => rgb555(0, 0, code)), 8, 4);
  } else throw new Error(`unknown CGB WS2 scene type: ${scene.type}`);
  return [page0, cloneFrame(page0)];
}

function tileColorSets(frames) {
  const tiles = [];
  for (const frame of frames) for (let tileY = 0; tileY < TILE_ROWS; tileY += 1) {
    for (let tileX = 0; tileX < TILE_COLUMNS; tileX += 1) {
      const colors = new Set();
      for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
        colors.add(frame[(tileY * 8 + y) * WIDTH + tileX * 8 + x]);
      }
      assert(colors.size <= 4, `tile ${tileX},${tileY} uses ${colors.size} colors; CGB background palette limit is four`);
      tiles.push([...colors].sort((a, b) => a - b));
    }
  }
  return tiles;
}

function assignPaletteGroups(colorSets) {
  const groups = [];
  const distinctSets = [...new Map(colorSets.map((set) => [set.join(","), set])).values()]
    .sort((a, b) => b.length - a.length || a[0] - b[0]);
  for (const set of distinctSets.filter((item) => item.length > 1)) {
    if (groups.some((group) => set.every((color) => group.includes(color)))) continue;
    const mergeIndex = groups.findIndex((group) => new Set([...group, ...set]).size <= 4);
    if (mergeIndex >= 0) groups[mergeIndex] = [...new Set([...groups[mergeIndex], ...set])].sort((a, b) => a - b);
    else groups.push([...set]);
  }
  const allColors = [...new Set(colorSets.flat())].sort((a, b) => a - b);
  for (const color of allColors) {
    if (groups.some((group) => group.includes(color))) continue;
    const target = groups.find((group) => group.length < 4);
    if (target) target.push(color);
    else groups.push([color]);
  }
  assert(groups.length <= 8, `scene needs ${groups.length} CGB background palettes; maximum is eight`);
  while (groups.length < 8) groups.push([0]);
  return groups.map((group) => {
    const output = [...group];
    while (output.length < 4) output.push(output[0] ?? 0);
    return output;
  });
}

function frameToRgb555Buffer(frame) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((value, index) => output.writeUInt16LE(value, index * 2));
  return output;
}

function encodeVideo(frames) {
  const colorSets = tileColorSets(frames);
  const paletteGroups = assignPaletteGroups(colorSets);
  const paletteBytes = Buffer.alloc(64);
  paletteGroups.flat().forEach((value, index) => paletteBytes.writeUInt16LE(value, index * 2));
  const tileBanks = [Buffer.alloc(4096), Buffer.alloc(4096)];
  const maps = [Buffer.alloc(MAP_BYTES), Buffer.alloc(MAP_BYTES)];
  const attrs = [Buffer.alloc(MAP_BYTES), Buffer.alloc(MAP_BYTES)];
  const tileLookup = new Map();
  let tileCount = 0;
  for (let page = 0; page < 2; page += 1) for (let tileY = 0; tileY < TILE_ROWS; tileY += 1) {
    for (let tileX = 0; tileX < TILE_COLUMNS; tileX += 1) {
      const frame = frames[page];
      const colors = new Set();
      for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
        colors.add(frame[(tileY * 8 + y) * WIDTH + tileX * 8 + x]);
      }
      const palette = paletteGroups.findIndex((group) => [...colors].every((color) => group.includes(color)));
      assert(palette >= 0, "no CGB palette contains tile colors");
      const tileBytes = Buffer.alloc(16);
      for (let y = 0; y < 8; y += 1) {
        let low = 0;
        let high = 0;
        for (let x = 0; x < 8; x += 1) {
          const color = frame[(tileY * 8 + y) * WIDTH + tileX * 8 + x];
          const index = paletteGroups[palette].indexOf(color);
          low |= (index & 1) << (7 - x);
          high |= ((index >> 1) & 1) << (7 - x);
        }
        tileBytes[y * 2] = low;
        tileBytes[y * 2 + 1] = high;
      }
      const key = tileBytes.toString("hex");
      let tile = tileLookup.get(key);
      if (tile === undefined) {
        tile = tileCount++;
        assert(tile < 512, "scene exceeds two CGB tile-data banks");
        tileLookup.set(key, tile);
        tileBytes.copy(tileBanks[tile >> 8], (tile & 255) * 16);
      }
      const mapIndex = tileY * 32 + tileX;
      maps[page][mapIndex] = tile & 255;
      attrs[page][mapIndex] = palette | ((tile >> 8) << 3);
    }
  }
  return { paletteGroups, paletteBytes, tileBanks, maps, attrs, tileCount };
}

class Assembler {
  constructor(origin) {
    this.origin = origin;
    this.bytes = [];
    this.labels = new Map();
    this.absoluteFixups = [];
    this.relativeFixups = [];
  }
  emit(...values) { this.bytes.push(...values.map((value) => value & 255)); }
  word(value) { this.emit(value, value >> 8); }
  label(name) { assert(!this.labels.has(name), `duplicate label ${name}`); this.labels.set(name, this.bytes.length); }
  jp(name) { this.emit(0xc3); this.absoluteFixups.push({ offset: this.bytes.length, name }); this.word(0); }
  call(name) { this.emit(0xcd); this.absoluteFixups.push({ offset: this.bytes.length, name }); this.word(0); }
  jr(opcode, name) { this.emit(opcode); this.relativeFixups.push({ offset: this.bytes.length, name }); this.emit(0); }
  ld16(opcode, value) { this.emit(opcode); this.word(value); }
  finish() {
    for (const fixup of this.absoluteFixups) {
      const label = this.labels.get(fixup.name);
      assert(label !== undefined, `unknown label ${fixup.name}`);
      const address = this.origin + label;
      this.bytes[fixup.offset] = address & 255;
      this.bytes[fixup.offset + 1] = address >> 8;
    }
    for (const fixup of this.relativeFixups) {
      const label = this.labels.get(fixup.name);
      assert(label !== undefined, `unknown label ${fixup.name}`);
      const delta = label - (fixup.offset + 1);
      assert(delta >= -128 && delta <= 127, `JR to ${fixup.name} is out of range`);
      this.bytes[fixup.offset] = delta & 255;
    }
    return Buffer.from(this.bytes);
  }
}

function buildProgram(scene) {
  const a = new Assembler(PROGRAM_OFFSET);
  const copy = (source, destination, length) => {
    a.ld16(0x21, source); // LD HL,source
    a.ld16(0x11, destination); // LD DE,destination
    a.ld16(0x01, length); // LD BC,length
    a.call("copy");
  };
  a.emit(0xf3); // DI
  a.ld16(0x31, 0xdfff); // LD SP,$DFFF
  a.emit(0xf0, 0x40, 0xe6, 0x80); // LDH A,(LCDC); AND $80
  a.jr(0x28, "lcd-off"); // JR Z
  a.label("wait-lcd-vblank");
  a.emit(0xf0, 0x44, 0xfe, 144); // LDH A,(LY); CP 144
  a.jr(0x38, "wait-lcd-vblank"); // JR C
  a.label("lcd-off");
  a.emit(0xaf, 0xe0, 0x40, 0xe0, 0x4f); // XOR A; LCDC=0; VBK=0
  copy(TILE_BANK_0_OFFSET, 0x8000, 4096);
  copy(MAP_0_OFFSET, 0x9800, MAP_BYTES);
  copy(MAP_1_OFFSET, 0x9c00, MAP_BYTES);
  a.emit(0x3e, 1, 0xe0, 0x4f); // VBK=1
  copy(TILE_BANK_1_OFFSET, 0x8000, 4096);
  copy(ATTR_0_OFFSET, 0x9800, MAP_BYTES);
  copy(ATTR_1_OFFSET, 0x9c00, MAP_BYTES);
  a.emit(0xaf, 0xe0, 0x4f); // VBK=0
  a.emit(0x3e, 0x80, 0xe0, 0x68); // BCPS auto-increment
  a.ld16(0x21, PALETTE_OFFSET);
  a.emit(0x06, 64); // LD B,64
  a.label("palette-copy");
  a.emit(0x2a, 0xe0, 0x69, 0x05); // LD A,(HL+); BCPD=A; DEC B
  a.jr(0x20, "palette-copy");
  a.emit(0xaf, 0xe0, 0x42, 0xe0, 0x43); // SCY=SCX=0
  a.emit(0x3e, 0x91, 0xe0, 0x40); // LCDC on, map0
  if (scene.type === "rgb555-exhaustive-transport") {
    a.emit(0x16, 0, 0x1e, 0); // LD D,0 (R); LD E,0 (G)
    a.label("transport-frame");
    a.label("transport-wait-visible");
    a.emit(0xf0, 0x44, 0xfe, 144);
    a.jr(0x30, "transport-wait-visible"); // JR NC
    a.label("transport-wait-vblank");
    a.emit(0xf0, 0x44, 0xfe, 144);
    a.jr(0x38, "transport-wait-vblank"); // JR C
    a.emit(0x1c, 0x7b, 0xfe, 32); // INC E; LD A,E; CP 32
    a.jr(0x38, "transport-have-rg");
    a.emit(0xaf, 0x5f, 0x14, 0x7a, 0xe6, 31, 0x57); // G=0; R=(R+1)&31
    a.label("transport-have-rg");
    a.emit(0x7b, 0xe6, 7, 0x07, 0x07, 0x07, 0x07, 0x07, 0x4f); // C=(G&7)<<5
    a.emit(0x7a, 0xb1, 0x4f); // C=R|C (palette low byte)
    a.emit(0x7b, 0xcb, 0x3f, 0xcb, 0x3f, 0xcb, 0x3f, 0x67); // H=G>>3
    a.emit(0x3e, 0x80, 0xe0, 0x68, 0x2e, 32); // BCPS auto; L=32 colors
    a.label("transport-palette");
    a.emit(0x79, 0xe0, 0x69, 0x7c, 0xe0, 0x69); // low then high palette byte
    a.emit(0x7c, 0xc6, 4, 0x67, 0x2d); // H+=4 (next B code); DEC L
    a.jr(0x20, "transport-palette");
    a.jp("transport-frame");
  }
  a.emit(0x06, scene.page0DwellFrames); // LD B,dwell0
  if (scene.maxPageFlips !== undefined) a.emit(0x0e, scene.maxPageFlips); // LD C,max flips
  a.label("frame");
  a.label("wait-visible");
  a.emit(0xf0, 0x44, 0xfe, 144);
  a.jr(0x30, "wait-visible"); // JR NC
  a.label("wait-vblank");
  a.emit(0xf0, 0x44, 0xfe, 144);
  a.jr(0x38, "wait-vblank"); // JR C
  a.emit(0x05); // DEC B
  a.jr(0x20, "frame");
  a.emit(0xf0, 0x40, 0xee, 0x08, 0xe0, 0x40); // toggle map at VBlank
  if (scene.maxPageFlips !== undefined) {
    a.emit(0x0d); // DEC C
    a.jr(0x28, "safe-hold");
  }
  a.emit(0xe6, 0x08);
  a.jr(0x28, "load-page0-dwell");
  a.emit(0x06, scene.page1DwellFrames);
  a.jp("frame");
  a.label("load-page0-dwell");
  a.emit(0x06, scene.page0DwellFrames);
  a.jp("frame");
  if (scene.maxPageFlips !== undefined) {
    a.label("safe-hold");
    a.jp("safe-hold");
  }
  a.label("copy");
  a.emit(0x2a, 0x12, 0x13, 0x0b, 0x78, 0xb1); // LD A,(HL+); LD (DE),A; INC DE; DEC BC; LD A,B; OR C
  a.jr(0x20, "copy");
  a.emit(0xc9); // RET
  const buffer = a.finish();
  assert(PROGRAM_OFFSET + buffer.length <= METADATA_OFFSET, "CGB WS2 program overlaps metadata");
  return { buffer, symbols: Object.fromEntries([...a.labels].map(([name, offset]) => [name, PROGRAM_OFFSET + offset])) };
}

function writeHeader(rom, sceneId) {
  rom[0x100] = 0x00;
  rom[0x101] = 0xc3;
  rom.writeUInt16LE(PROGRAM_OFFSET, 0x102);
  // 0x104..0x133 deliberately remain zero: no proprietary Nintendo boot logo.
  Buffer.from("RDLCGBWS2".padEnd(15, " "), "ascii").copy(rom, 0x134);
  rom[0x143] = 0x80; // CGB-compatible cartridge
  Buffer.from("RD", "ascii").copy(rom, 0x144);
  rom[0x146] = 0;
  rom[0x147] = 0; // ROM only
  rom[0x148] = 0; // 32 KiB
  rom[0x149] = 0;
  rom[0x14a] = 1;
  rom[0x14b] = 0x33;
  rom[0x14c] = crypto.createHash("sha256").update(sceneId).digest()[0];
  let header = 0;
  for (let offset = 0x134; offset <= 0x14c; offset += 1) header = (header - rom[offset] - 1) & 255;
  rom[0x14d] = header;
  rom[0x14e] = 0;
  rom[0x14f] = 0;
  let global = 0;
  for (let offset = 0; offset < rom.length; offset += 1) if (offset !== 0x14e && offset !== 0x14f) global = (global + rom[offset]) & 0xffff;
  rom.writeUInt16BE(global, 0x14e);
}

function metadata(scene, encoded, program, frameHashes) {
  const output = Buffer.alloc(160);
  Buffer.from("RDLCGB2\0", "ascii").copy(output, 0);
  output.writeUInt16LE(1, 8);
  output.writeUInt16LE(WIDTH, 10);
  output.writeUInt16LE(HEIGHT, 12);
  output.writeUInt16LE(encoded.tileCount, 14);
  output.writeUInt16LE(scene.page0DwellFrames, 16);
  output.writeUInt16LE(scene.page1DwellFrames, 18);
  output.writeUInt16LE(scene.maxPageFlips ?? 0xffff, 20);
  output[22] = scene.terminalPage ?? 0xff;
  output.writeUInt16LE(TILE_BANK_0_OFFSET, 24);
  output.writeUInt16LE(TILE_BANK_1_OFFSET, 26);
  output.writeUInt16LE(PALETTE_OFFSET, 28);
  output.writeUInt16LE(MAP_0_OFFSET, 30);
  output.writeUInt16LE(MAP_1_OFFSET, 32);
  output.writeUInt16LE(ATTR_0_OFFSET, 34);
  output.writeUInt16LE(ATTR_1_OFFSET, 36);
  output.writeUInt16LE(program.buffer.length, 38);
  Buffer.from(scene.sceneId.slice(0, 31), "ascii").copy(output, 40);
  Buffer.from(frameHashes[0], "hex").copy(output, 72);
  Buffer.from(frameHashes[1], "hex").copy(output, 104);
  return output;
}

function buildRom(scene) {
  for (const key of ["page0DwellFrames", "page1DwellFrames"]) {
    assert(Number.isInteger(scene[key]) && scene[key] >= 1 && scene[key] <= 255, `${scene.sceneId}: ${key} outside 1..255`);
  }
  if (scene.maxPageFlips !== undefined) {
    assert(Number.isInteger(scene.maxPageFlips) && scene.maxPageFlips >= 1 && scene.maxPageFlips <= 255, `${scene.sceneId}: invalid maxPageFlips`);
    assert(scene.terminalPage === scene.maxPageFlips % 2, `${scene.sceneId}: terminalPage disagrees with flip count`);
  }
  const frames = sceneFrames(scene);
  const frameBuffers = frames.map(frameToRgb555Buffer);
  const frameHashes = frameBuffers.map(sha256);
  const encoded = encodeVideo(frames);
  const program = buildProgram(scene);
  const rom = Buffer.alloc(ROM_BYTES);
  program.buffer.copy(rom, PROGRAM_OFFSET);
  metadata(scene, encoded, program, frameHashes).copy(rom, METADATA_OFFSET);
  encoded.tileBanks[0].copy(rom, TILE_BANK_0_OFFSET);
  encoded.tileBanks[1].copy(rom, TILE_BANK_1_OFFSET);
  encoded.paletteBytes.copy(rom, PALETTE_OFFSET);
  encoded.maps[0].copy(rom, MAP_0_OFFSET);
  encoded.maps[1].copy(rom, MAP_1_OFFSET);
  encoded.attrs[0].copy(rom, ATTR_0_OFFSET);
  encoded.attrs[1].copy(rom, ATTR_1_OFFSET);
  writeHeader(rom, scene.sceneId);
  return { rom, frames, frameBuffers, frameHashes, encoded, program };
}

function writeOrCheck(file, buffer, checkOnly) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (checkOnly) {
    assert(fs.existsSync(file), `missing generated CGB WS2 artifact: ${relative}`);
    assert(fs.readFileSync(file).equals(buffer), `${relative} is stale; run node tools/build-cgb001-test-rom.mjs`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    console.log(`Wrote ${relative}`);
  }
}

function buildSuite() {
  const sourceBuffer = fs.readFileSync(sourcePath);
  const source = JSON.parse(sourceBuffer);
  assert(source.schemaVersion === 1 && source.modelId === "nintendo-cgb-001-period-reconstruction", "invalid CGB WS2 scene source");
  const ids = new Set();
  const outputs = {};
  const sceneRecords = [];
  for (const scene of source.scenes) {
    assert(!ids.has(scene.sceneId), `duplicate CGB WS2 scene ID: ${scene.sceneId}`);
    ids.add(scene.sceneId);
    const built = buildRom(scene);
    const romRelative = `${outputRelative}/${scene.sceneId}.gbc`;
    outputs[romRelative] = built.rom;
    sceneRecords.push({
      sceneId: scene.sceneId,
      type: scene.type,
      description: scene.description,
      filename: `${scene.sceneId}.gbc`,
      sha256: sha256(built.rom),
      sizeBytes: built.rom.length,
      cgbFlag: built.rom[0x143],
      headerChecksum: built.rom[0x14d],
      proprietaryNintendoLogoPresent: false,
      page0DwellFrames: scene.page0DwellFrames,
      page1DwellFrames: scene.page1DwellFrames,
      maxPageFlips: scene.maxPageFlips ?? null,
      terminalPage: scene.terminalPage ?? null,
      pageSchedule: scene.type === "rgb555-exhaustive-transport"
        ? "hold both identical tile maps; after every VBlank advance G then R and rewrite 32 B-ramp palette words"
        : scene.maxPageFlips === undefined
        ? "toggle map 0/map 1 at VBlank after each declared dwell forever"
        : `toggle ${scene.maxPageFlips} time(s) at VBlank, then hold page ${scene.terminalPage}`,
      maximumDynamicSeconds: scene.maxPageFlips === undefined ? null : (
        Math.ceil(scene.maxPageFlips / 2) * scene.page0DwellFrames
        + Math.floor(scene.maxPageFlips / 2) * scene.page1DwellFrames
      ) * FRAME_SECONDS,
      expectedFramebuffer: built.frameHashes.map((hash, page) => ({
        page,
        encoding: "little-endian CGB RGB555",
        byteLength: built.frameBuffers[page].length,
        sha256: hash,
      })),
      videoData: {
        tileCount: built.encoded.tileCount,
        tileBankSha256: built.encoded.tileBanks.map(sha256),
        paletteSha256: sha256(built.encoded.paletteBytes),
        mapSha256: built.encoded.maps.map(sha256),
        attributeSha256: built.encoded.attrs.map(sha256),
        paletteRgb555: built.encoded.paletteGroups.map((group, palette) => ({
          palette,
          colors: group.map(unpackRgb555),
        })),
      },
      program: {
        offset: PROGRAM_OFFSET,
        byteLength: built.program.buffer.length,
        sha256: sha256(built.program.buffer),
        symbols: built.program.symbols,
        pageFlipEvent: scene.type === "rgb555-exhaustive-transport"
          ? "all 64 palette bytes rewritten only after LY enters VBlank"
          : "LCDC background tile-map bit toggled only after LY enters VBlank",
      },
    });
  }
  const manifest = {
    schemaVersion: 1,
    suiteId: source.suiteId,
    modelId: source.modelId,
    classification: source.classification,
    generator: "tools/build-cgb001-test-rom.mjs",
    source: { path: sourceRelative, sha256: sha256(sourceBuffer) },
    assetPolicy: source.assetPolicy,
    raster: { width: WIDTH, height: HEIGHT, tileColumns: TILE_COLUMNS, tileRows: TILE_ROWS },
    timing: {
      masterClockHz: 4194304,
      dotsPerFrame: 70224,
      frameSeconds: FRAME_SECONDS,
      frameRateHz: 4194304 / 70224,
      pageFlipEvent: "first VBlank boundary after the selected dwell",
    },
    exhaustiveTransport: {
      sceneId: "rgb555-exhaustive-transport",
      sequence: "frame 0 is R=0,G=0,B=0..31; each VBlank increments G modulo 32, then R modulo 32 after G wraps",
      cycleFrames: 1024,
      rgb555ValuesPerFrame: 32,
      totalRgb555Values: 32768,
    },
    fixedLayout: {
      programOffset: PROGRAM_OFFSET,
      metadataOffset: METADATA_OFFSET,
      tileBankOffsets: [TILE_BANK_0_OFFSET, TILE_BANK_1_OFFSET],
      paletteOffset: PALETTE_OFFSET,
      mapOffsets: [MAP_0_OFFSET, MAP_1_OFFSET],
      attributeOffsets: [ATTR_0_OFFSET, ATTR_1_OFFSET],
    },
    scenes: sceneRecords,
  };
  outputs[`${outputRelative}/manifest.json`] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { outputs, manifest };
}

function parseArguments(argv) {
  const options = { checkOnly: false };
  for (const argument of argv) {
    if (argument === "--check") options.checkOnly = true;
    else if (argument === "--help") {
      console.log("Usage: node tools/build-cgb001-test-rom.mjs [--check]");
      return null;
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  const suite = buildSuite();
  for (const [relative, buffer] of Object.entries(suite.outputs)) writeOrCheck(path.join(root, relative), buffer, options.checkOnly);
  console.log(`CGB-001 WS2 stimulus suite ${options.checkOnly ? "is current" : "generated"} (${suite.manifest.scenes.length} ROMs).`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try { main(); } catch (error) {
    console.error(`CGB-001 WS2 ROM build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
