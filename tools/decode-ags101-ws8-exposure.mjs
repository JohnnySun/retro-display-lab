#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { decodePng } from "./decode-ags101-ws5-readback.mjs";

function wordAsFloat(word) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(word >>> 0);
  return buffer.readFloatLE(0);
}

export function decodeExposureBands(image) {
  if (image.width % 240 !== 0 || image.height % 160 !== 0) {
    throw new Error(`expected integer-scaled 240x160 output, got ${image.width}x${image.height}`);
  }
  const scaleX = image.width / 240;
  const scaleY = image.height / 160;
  if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY)) {
    throw new Error(`noninteger output scale ${scaleX}x${scaleY}`);
  }
  const words = [];
  const confidence = [];
  for (let band = 0; band < 5; band += 1) {
    const sourceY = Math.floor((band + 0.5) * 160 / 5);
    const y = sourceY * scaleY + Math.floor(scaleY / 2);
    let word = 0;
    let unanimousBits = 0;
    const votesPerBit = [];
    for (let bit = 0; bit < 32; bit += 1) {
      let white = 0;
      let total = 0;
      for (let sourceX = bit; sourceX < 240; sourceX += 32) {
        const x = sourceX * scaleX + Math.floor(scaleX / 2);
        const offset = y * image.stride + x * image.channels;
        const luma = image.pixels[offset] + image.pixels[offset + 1] + image.pixels[offset + 2];
        if (luma >= 3 * 128) white += 1;
        total += 1;
      }
      const one = white > total / 2;
      if (one) word = (word | ((1 << bit) >>> 0)) >>> 0;
      if (white === 0 || white === total) unanimousBits += 1;
      votesPerBit.push(`${white}/${total}`);
    }
    words.push(word >>> 0);
    confidence.push({ unanimousBits, votesPerBit });
  }
  const packed = words[4];
  return {
    scale: [scaleX, scaleY],
    exposure: [wordAsFloat(words[0]), wordAsFloat(words[1]), wordAsFloat(words[2])],
    exposureWords: words.slice(0, 3).map((word) => `0x${word.toString(16).padStart(8, "0")}`),
    frameCount: words[3],
    frameCountWord: `0x${words[3].toString(16).padStart(8, "0")}`,
    packedTargetWord: `0x${packed.toString(16).padStart(8, "0")}`,
    targetRgb555: [packed & 31, (packed >>> 5) & 31, (packed >>> 10) & 31],
    confidence,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) {
    throw new Error("usage: node tools/decode-ags101-ws8-exposure.mjs screenshot.png [...]");
  }
  const decoded = files.map((file) => ({
    file,
    ...decodeExposureBands(decodePng(file)),
  }));
  process.stdout.write(`${JSON.stringify(decoded, null, 2)}\n`);
}
