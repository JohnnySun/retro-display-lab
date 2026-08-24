#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { decodePng } from "./decode-ags101-ws5-readback.mjs";

const NATIVE_WIDTH = 160;
const NATIVE_HEIGHT = 144;
const TILE_WIDTH = 32;
const BAND_HEIGHT = 2;
const BANDS = 9;
const TILE_HEIGHT = BAND_HEIGHT * BANDS;

function wordAsFloat(word) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(word >>> 0);
  return buffer.readFloatLE(0);
}

function hex(word) {
  return `0x${(word >>> 0).toString(16).padStart(8, "0")}`;
}

function unpackRgb555(word) {
  return [word & 31, (word >>> 5) & 31, (word >>> 10) & 31];
}

export function centeredIntegerViewport(image) {
  const scale = Math.floor(Math.min(image.width / NATIVE_WIDTH, image.height / NATIVE_HEIGHT));
  if (scale < 1) throw new Error(`image ${image.width}x${image.height} cannot contain 160x144`);
  const width = NATIVE_WIDTH * scale;
  const height = NATIVE_HEIGHT * scale;
  return {
    x: Math.floor((image.width - width) / 2),
    y: Math.floor((image.height - height) / 2),
    width,
    height,
    scale,
  };
}

function pixelIsWhite(image, x, y) {
  const offset = y * image.stride + x * image.channels;
  return image.pixels[offset] + image.pixels[offset + 1] + image.pixels[offset + 2] >= 3 * 128;
}

export function decodeReadbackTiles(image, viewport = centeredIntegerViewport(image)) {
  const { x: left, y: top, scale } = viewport;
  if (viewport.width !== NATIVE_WIDTH * scale || viewport.height !== NATIVE_HEIGHT * scale) {
    throw new Error("viewport must be an integer-scaled 160x144 rectangle");
  }
  const tiles = [];
  const tileRows = Math.floor(NATIVE_HEIGHT / TILE_HEIGHT);
  const tileColumns = Math.floor(NATIVE_WIDTH / TILE_WIDTH);
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const words = [];
      const unanimousBits = [];
      for (let band = 0; band < BANDS; band += 1) {
        let word = 0;
        let unanimous = 0;
        for (let bit = 0; bit < 32; bit += 1) {
          let white = 0;
          let total = 0;
          for (let sourceDy = 0; sourceDy < BAND_HEIGHT; sourceDy += 1) {
            const sourceY = tileY * TILE_HEIGHT + band * BAND_HEIGHT + sourceDy;
            for (let hostDy = 0; hostDy < scale; hostDy += 1) {
              const y = top + sourceY * scale + hostDy;
              for (let hostDx = 0; hostDx < scale; hostDx += 1) {
                const sourceX = tileX * TILE_WIDTH + bit;
                const x = left + sourceX * scale + hostDx;
                if (pixelIsWhite(image, x, y)) white += 1;
                total += 1;
              }
            }
          }
          if (white > total / 2) word = (word | ((1 << bit) >>> 0)) >>> 0;
          if (white === 0 || white === total) unanimous += 1;
        }
        words.push(word >>> 0);
        unanimousBits.push(unanimous);
      }
      tiles.push({
        slot: tileY * tileColumns + tileX,
        tile: [tileX, tileY],
        probeSource: [tileX * TILE_WIDTH, tileY * TILE_HEIGHT],
        words,
        wordHex: words.map(hex),
        unanimousBits,
      });
    }
  }
  return { viewport, tiles };
}

export function interpretReadback(decoded, mode) {
  const tiles = decoded.tiles.map((tile) => {
    const common = {
      slot: tile.slot,
      tile: tile.tile,
      probeSource: tile.probeSource,
      wordHex: tile.wordHex,
      unanimousBits: tile.unanimousBits,
    };
    if (mode === "response" || mode === "retention") {
      return {
        ...common,
        response: tile.words.slice(0, 3).map(wordAsFloat),
        residualDc: wordAsFloat(tile.words[3]),
        sourceRgb555: unpackRgb555(tile.words[4]),
        frameCount: tile.words[5],
        sentinel: hex(tile.words[6]),
        valid: tile.words[6] === 0x43474238,
      };
    }
    if (mode === "exposure") {
      return {
        ...common,
        exposureXyz: tile.words.slice(0, 3).map(wordAsFloat),
        response: tile.words.slice(3, 6).map(wordAsFloat),
        sourceRgb555: unpackRgb555(tile.words[6]),
        frameCount: tile.words[7],
        sentinel: hex(tile.words[8]),
        valid: tile.words[8] === 0x43474239,
      };
    }
    if (mode === "lut") {
      return {
        ...common,
        xyz: tile.words.slice(0, 3).map(wordAsFloat),
        sourceRgb555: unpackRgb555(tile.words[3]),
        frameCount: tile.words[4],
        sentinel: hex(tile.words[5]),
        valid: tile.slot < 32 && tile.words[5] === 0x43474241,
      };
    }
    if (mode === "aperture") {
      return {
        ...common,
        phase: tile.slot & 7,
        coverage: tile.words.slice(0, 3).map(wordAsFloat),
        scaleX: wordAsFloat(tile.words[3]),
        outputWidth: tile.words[4],
        sourceWidth: tile.words[5],
        valid: tile.words[4] > 0 && tile.words[5] === 160,
      };
    }
    throw new Error(`unknown readback mode: ${mode}`);
  });
  return { viewport: decoded.viewport, mode, tiles };
}

export function decodeReadbackPng(file, mode) {
  const image = decodePng(file);
  return interpretReadback(decodeReadbackTiles(image), mode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  if (modeIndex < 0 || !args[modeIndex + 1]) {
    throw new Error("usage: node tools/decode-cgb001-ws9-readback.mjs --mode response|retention|exposure|lut|aperture screenshot.png [...]");
  }
  const mode = args[modeIndex + 1];
  const files = args.filter((_arg, index) => index !== modeIndex && index !== modeIndex + 1);
  if (!files.length) throw new Error("at least one screenshot is required");
  const output = files.map((file) => ({ file, ...decodeReadbackPng(file, mode) }));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
