#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
const sceneFlag = process.argv.indexOf("--scene");
const scene = sceneFlag >= 0 ? process.argv[sceneFlag + 1] : "cycle";
const crosstalkScenes = [
  "crosstalk-single-dot", "crosstalk-full-row", "crosstalk-full-column",
  "crosstalk-checkerboard", "crosstalk-alternating-lines",
  "crosstalk-window", "crosstalk-inverse-window", "crosstalk-mixed-mino",
];
if (!outputPath) {
  console.error("usage: node tools/build-dmg01-device-test-rom.mjs --output <path> [--scene cycle|static-four|moving-bars|full-toggle|alternating-rows|retention-window|crosstalk-*]");
  process.exit(1);
}
if (!["cycle", "static-four", "moving-bars", "full-toggle", "alternating-rows", "retention-window", ...crosstalkScenes].includes(scene)) {
  console.error(`unsupported DMG test scene: ${scene}`);
  process.exit(1);
}

const rom = Buffer.alloc(32 * 1024, 0);
rom.set([0x00, 0xc3, 0x50, 0x01], 0x100); // Entry: NOP; JP $0150.
rom.set([
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b,
  0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e,
  0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc,
  0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
], 0x104); // DMG boot-ROM compatibility signature.
Buffer.from("RDL DMG TEST", "ascii").copy(rom, 0x134);
rom[0x143] = 0x00; // DMG-only.
rom[0x146] = 0x00; // No SGB functions.
rom[0x147] = 0x00; // ROM-only cartridge.
rom[0x148] = 0x00; // 32 KiB ROM.
rom[0x149] = 0x00; // No external RAM.
rom[0x14a] = 0x01; // Non-Japanese destination.

const code = [];
const labels = new Map();
const relativeFixups = [];
const absoluteFixups = [];
const emit = (...bytes) => code.push(...bytes);
const label = (name) => labels.set(name, code.length);
const relativeJump = (opcode, target) => {
  emit(opcode, 0);
  relativeFixups.push({ offset: code.length - 1, target });
};
const absoluteBranch = (opcode, target) => {
  emit(opcode, 0, 0);
  absoluteFixups.push({ offset: code.length - 2, target });
};
const call = (target) => absoluteBranch(0xcd, target);
const jump = (target) => absoluteBranch(0xc3, target);
const waitFrames = (frames) => {
  let remaining = frames;
  while (remaining > 0) {
    const batch = Math.min(remaining, 255);
    emit(0x06, batch);
    call("wait-frames");
    remaining -= batch;
  }
};

emit(0xf3); // DI
emit(0x31, 0xfe, 0xff); // LD SP,$FFFE
emit(0xaf, 0xe0, 0x40); // XOR A; disable LCD before clearing VRAM.
emit(0x21, 0x00, 0x80); // LD HL,$8000
emit(0x01, 0x00, 0x20); // LD BC,$2000
label("clear-vram");
emit(0xaf, 0x22); // XOR A; LD (HL+),A
emit(0x0b, 0x78, 0xb1); // DEC BC; LD A,B; OR C
relativeJump(0x20, "clear-vram"); // JR NZ

if (["static-four", "moving-bars"].includes(scene)) {
  // Put all four Game Boy color numbers in every tile-0 row. This makes the
  // numeric fixture independent of tile-map indexing and gives eight-host-
  // pixel bars at the required exact 4x viewport.
  emit(0x21, 0x00, 0x80, 0x06, 0x08); // HL=$8000; B=8 rows.
  label("tile-0-four-shades");
  emit(0x3e, 0x55, 0x22, 0x3e, 0x33, 0x22, 0x05);
  relativeJump(0x20, "tile-0-four-shades");
}

// Four deterministic solid-color tiles. Tile 0 is already zeroed.
emit(0x21, 0x10, 0x80, 0x06, 0x08); // HL=$8010; B=8 rows.
label("tile-1");
emit(0x3e, 0xff, 0x22, 0xaf, 0x22, 0x05); // low=FF, high=00.
relativeJump(0x20, "tile-1");
emit(0x21, 0x20, 0x80, 0x06, 0x08); // HL=$8020; B=8 rows.
label("tile-2");
emit(0xaf, 0x22, 0x3e, 0xff, 0x22, 0x05); // low=00, high=FF.
relativeJump(0x20, "tile-2");
emit(0x21, 0x30, 0x80, 0x06, 0x08, 0x3e, 0xff); // Tile 3.
label("tile-3");
emit(0x22, 0x22, 0x05); // low=FF, high=FF.
relativeJump(0x20, "tile-3");

const diagnosticTiles = [
  { index: 4, rows: [0, 0, 0, 0x08, 0, 0, 0, 0] },
  { index: 5, rows: [0, 0, 0, 0xff, 0, 0, 0, 0] },
  { index: 6, rows: [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08] },
  { index: 7, rows: [0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa] },
  { index: 8, rows: [0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff] },
];
for (const tile of diagnosticTiles) {
  emit(0x21, (tile.index * 16) & 0xff, 0x80 + ((tile.index * 16) >> 8));
  for (const row of tile.rows) emit(0x3e, row, 0x22, 0x22);
}

// Tetris mino tile: shade 3 border with a shade 2 interior. In DMG bitplanes,
// shade 3 is 11 and shade 2 is 10, so only the low plane clears inside.
emit(0x21, 0x90, 0x80); // HL=$8090, tile 9.
for (let row = 0; row < 8; row += 1) {
  emit(0x3e, row === 0 || row === 7 ? 0xff : 0x81, 0x22);
  emit(0x3e, 0xff, 0x22);
}

// Scene 0 starts immediately after cold boot so numeric state capture sees
// all four equilibrium shades without inheriting an earlier scene.
if (["static-four", "moving-bars", "full-toggle"].includes(scene)) {
  emit(0x16, 0x00);
  call("fill-uniform");
} else if (scene === "alternating-rows") call("fill-alternating-rows");
else if (scene === "retention-window") call("fill-retention-window");
else if (crosstalkScenes.includes(scene)) call(scene);
else call("fill-repeat-four");
call("lcd-on-neutral");
if (scene === "static-four" || crosstalkScenes.includes(scene)) {
  label("static-four-hold");
  call("wait-frame");
  jump("static-four-hold");
} else if (scene === "moving-bars") {
  label("moving-bars-hold");
  call("wait-frame");
  emit(0xf0, 0x43, 0x3c, 0xe0, 0x43); // SCX++.
  jump("moving-bars-hold");
} else if (scene === "full-toggle") {
  label("full-toggle-hold");
  emit(0x06, 30);
  call("wait-frames");
  emit(0xf0, 0x47, 0xee, 0x03, 0xe0, 0x47);
  jump("full-toggle-hold");
} else if (scene === "alternating-rows") {
  label("alternating-rows-hold");
  emit(0x06, 30);
  call("wait-frames");
  emit(0xf0, 0x47, 0xee, 0xff, 0xe0, 0x47);
  jump("alternating-rows-hold");
} else if (scene === "retention-window") {
  // With IonicTimeScale=60, each real second integrates one normal minute.
  // Charge the left half for 30 s (equivalent 30 min), clear the drive for
  // 15 s (equivalent 15 min), then repeat without resetting shader feedback.
  label("retention-window-cycle");
  waitFrames(1800);
  call("disable-lcd");
  emit(0x16, 0x00);
  call("fill-uniform");
  call("lcd-on-neutral");
  waitFrames(900);
  call("disable-lcd");
  call("fill-retention-window");
  call("lcd-on-neutral");
  jump("retention-window-cycle");
} else {
  waitFrames(1800); // Thirty seconds of four-shade 8-pixel bars.
  jump("scene-full-toggle");
}

label("cycle-start");
call("disable-lcd");
call("fill-repeat-four");
call("lcd-on-neutral");
waitFrames(1800);

// Scene 1: full-screen shade 0/3 transitions, four 30-frame phases.
label("scene-full-toggle");
call("disable-lcd");
emit(0x16, 0x00); // D=tile 0.
call("fill-uniform");
call("lcd-on-neutral");
emit(0x0e, 0x04); // C=4 phases.
label("full-toggle-phase");
emit(0x06, 30);
call("wait-frames");
emit(0xf0, 0x47, 0xee, 0x03, 0xe0, 0x47); // Swap color 0 shade 0/3.
emit(0x0d);
relativeJump(0x20, "full-toggle-phase");

// Scene 2: moving four-shade vertical edges through SCX.
call("disable-lcd");
call("fill-repeat-four");
call("lcd-on-neutral");
emit(0x16, 120); // D=120 presented motion frames.
label("moving-bars");
call("wait-frame");
emit(0xf0, 0x43, 0x3c, 0xe0, 0x43, 0x15); // SCX++ ; DEC D.
relativeJump(0x20, "moving-bars");

// Scene 3: alternating rows, with four palette reversals at 30 frames each.
call("disable-lcd");
call("fill-alternating-rows");
call("lcd-on-neutral");
emit(0x0e, 0x04);
label("alternating-phase");
emit(0x06, 30);
call("wait-frames");
emit(0xf0, 0x47, 0xee, 0xff, 0xe0, 0x47); // Reverse all four shades.
emit(0x0d);
relativeJump(0x20, "alternating-phase");
jump("cycle-start");

// Wait for one complete visible-to-VBlank boundary.
label("wait-frame");
label("wait-visible");
emit(0xf0, 0x44, 0xfe, 144); // Read LY; wait until outside VBlank.
relativeJump(0x30, "wait-visible"); // JR NC
label("wait-vblank");
emit(0xf0, 0x44, 0xfe, 144); // Read LY; wait for next VBlank.
relativeJump(0x38, "wait-vblank"); // JR C
emit(0xc9); // RET

label("wait-frames");
call("wait-frame");
emit(0x05); // DEC B
relativeJump(0x20, "wait-frames");
emit(0xc9);

label("disable-lcd");
call("wait-frame");
emit(0xaf, 0xe0, 0x40, 0xc9); // LCD off; RET.

label("lcd-on-neutral");
emit(0xaf, 0xe0, 0x43); // SCX=0.
emit(0x3e, 0xe4, 0xe0, 0x47); // BGP maps colors 0/1/2/3 to shades 0/1/2/3.
emit(0x3e, 0x91, 0xe0, 0x40, 0xc9); // LCD on; RET.

label("fill-uniform");
emit(0x21, 0x00, 0x98, 0x01, 0x00, 0x04); // HL=$9800; BC=$0400.
label("fill-uniform-loop");
emit(0x7a, 0x22, 0x0b, 0x78, 0xb1); // A=D; (HL+)=A; DEC BC; A=B|C.
relativeJump(0x20, "fill-uniform-loop");
emit(0xc9);

label("fill-repeat-four");
emit(0x21, 0x00, 0x98, 0x01, 0x00, 0x04, 0x16, 0x00);
label("fill-repeat-loop");
emit(0x7a, 0x22, 0x14, 0x7a, 0xe6, 0x03, 0x57); // Store D; D=(D+1)&3.
emit(0x0b, 0x78, 0xb1);
relativeJump(0x20, "fill-repeat-loop");
emit(0xc9);

label("fill-alternating-rows");
emit(0x21, 0x00, 0x98, 0x06, 32, 0x16, 0x00); // 32 rows; start tile 0.
label("fill-row");
emit(0x0e, 32);
label("fill-row-pixel");
emit(0x7a, 0x22, 0x0d); // Store D; DEC C.
relativeJump(0x20, "fill-row-pixel");
emit(0x7a, 0xee, 0x03, 0x57, 0x05); // D^=3; DEC B.
relativeJump(0x20, "fill-row");
emit(0xc9);

label("fill-retention-window");
emit(0x21, 0x00, 0x98, 0x06, 32); // HL=$9800; 32 rows.
label("fill-retention-row");
emit(0x0e, 10, 0x16, 0x03); // Visible left 10 tiles are shade 3.
label("fill-retention-left");
emit(0x7a, 0x22, 0x0d);
relativeJump(0x20, "fill-retention-left");
emit(0x0e, 22, 0x16, 0x00); // Visible right 10 plus offscreen 12 are shade 0.
label("fill-retention-right");
emit(0x7a, 0x22, 0x0d);
relativeJump(0x20, "fill-retention-right");
emit(0x05);
relativeJump(0x20, "fill-retention-row");
emit(0xc9);

label("crosstalk-single-dot");
emit(0x16, 0x00);
call("fill-uniform");
emit(0x21, 0x2a, 0x99, 0x3e, 0x04, 0x77, 0xc9);

label("crosstalk-full-row");
emit(0x16, 0x00);
call("fill-uniform");
emit(0x21, 0x20, 0x99, 0x06, 20, 0x3e, 0x05);
label("crosstalk-full-row-loop");
emit(0x22, 0x05);
relativeJump(0x20, "crosstalk-full-row-loop");
emit(0xc9);

label("crosstalk-full-column");
emit(0x16, 0x00);
call("fill-uniform");
emit(0x21, 0x0a, 0x98, 0x11, 0x20, 0x00, 0x06, 18, 0x3e, 0x06);
label("crosstalk-full-column-loop");
emit(0x77, 0x19, 0x05);
relativeJump(0x20, "crosstalk-full-column-loop");
emit(0xc9);

label("crosstalk-checkerboard");
emit(0x16, 0x07);
call("fill-uniform");
emit(0xc9);

label("crosstalk-alternating-lines");
emit(0x16, 0x08);
call("fill-uniform");
emit(0xc9);

label("crosstalk-window");
emit(0x16, 0x00);
call("fill-uniform");
emit(0x21, 0xa5, 0x98, 0x06, 9);
label("crosstalk-window-row");
emit(0x0e, 10, 0x3e, 0x03);
label("crosstalk-window-pixel");
emit(0x22, 0x0d);
relativeJump(0x20, "crosstalk-window-pixel");
emit(0x11, 0x16, 0x00, 0x19, 0x05);
relativeJump(0x20, "crosstalk-window-row");
emit(0xc9);

label("crosstalk-mixed-mino");
emit(0x16, 0x00);
call("fill-uniform");
// Three separated pieces exercise settled L/S/O shapes using the exact mixed
// shade tile that regressed in Tetris. Tile-map rows are 32 entries wide.
for (const address of [
  0x9862, 0x9863, 0x9864, 0x9882,
  0x9928, 0x9929, 0x9949, 0x994a,
  0x99ce, 0x99cf, 0x99ee, 0x99ef,
]) emit(0x21, address & 0xff, address >> 8, 0x3e, 0x09, 0x77);
emit(0xc9);

label("crosstalk-inverse-window");
emit(0x16, 0x03);
call("fill-uniform");
emit(0x21, 0xa5, 0x98, 0x06, 9);
label("crosstalk-inverse-window-row");
emit(0x0e, 10, 0xaf);
label("crosstalk-inverse-window-pixel");
emit(0x22, 0x0d);
relativeJump(0x20, "crosstalk-inverse-window-pixel");
emit(0x11, 0x16, 0x00, 0x19, 0x05);
relativeJump(0x20, "crosstalk-inverse-window-row");
emit(0xc9);

for (const fixup of relativeFixups) {
  if (!labels.has(fixup.target)) throw new Error(`unknown label ${fixup.target}`);
  const relative = labels.get(fixup.target) - (fixup.offset + 1);
  if (relative < -128 || relative > 127) throw new Error(`jump out of range: ${fixup.target}`);
  code[fixup.offset] = relative & 0xff;
}
for (const fixup of absoluteFixups) {
  if (!labels.has(fixup.target)) throw new Error(`unknown label ${fixup.target}`);
  const address = 0x150 + labels.get(fixup.target);
  code[fixup.offset] = address & 0xff;
  code[fixup.offset + 1] = address >> 8;
}
rom.set(code, 0x150);

let headerChecksum = 0;
for (let offset = 0x134; offset <= 0x14c; offset += 1) {
  headerChecksum = (headerChecksum - rom[offset] - 1) & 0xff;
}
rom[0x14d] = headerChecksum;
let globalChecksum = 0;
for (let offset = 0; offset < rom.length; offset += 1) {
  if (offset !== 0x14e && offset !== 0x14f) globalChecksum = (globalChecksum + rom[offset]) & 0xffff;
}
rom.writeUInt16BE(globalChecksum, 0x14e);

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, rom);
console.log(`Wrote deterministic DMG device-validation ${scene} test ROM to ${outputPath}.`);
if (process.argv.includes("--debug-map")) {
  for (const [name, offset] of labels) {
    console.log(`${name} = 0x${(0x150 + offset).toString(16)}`);
  }
}
