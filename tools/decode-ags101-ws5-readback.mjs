#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

export function decodePng(file) {
  const input = fs.readFileSync(file);
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`${file} is not a PNG`);
  }
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const compressed = [];
  while (offset < input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString("ascii", offset + 4, offset + 8);
    const data = input.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error("interlaced or nonstandard PNG is unsupported");
      }
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG format: depth=${bitDepth}, colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[sourceOffset + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels
        ? pixels[(y - 1) * stride + x - channels]
        : 0;
      const value = filter === 0 ? encoded
        : filter === 1 ? encoded + left
          : filter === 2 ? encoded + above
            : filter === 3 ? encoded + Math.floor((left + above) / 2)
              : filter === 4 ? encoded + paeth(left, above, upperLeft)
                : Number.NaN;
      if (!Number.isFinite(value)) throw new Error(`unknown PNG filter ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, channels, stride, pixels };
}

function wordAsFloat(word) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(word >>> 0);
  return buffer.readFloatLE(0);
}

export function decodeBands(image) {
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
  for (let band = 0; band < 4; band += 1) {
    const sourceY = Math.floor((band + 0.5) * 160 / 4);
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
  return {
    scale: [scaleX, scaleY],
    bands: {
      leftRetainedState: { word: `0x${words[0].toString(16).padStart(8, "0")}`, value: wordAsFloat(words[0]) },
      rightRetainedState: { word: `0x${words[1].toString(16).padStart(8, "0")}`, value: wordAsFloat(words[1]) },
      frameCount: { word: `0x${words[2].toString(16).padStart(8, "0")}`, value: words[2] },
      leftExcitation: { word: `0x${words[3].toString(16).padStart(8, "0")}`, value: wordAsFloat(words[3]) },
    },
    confidence,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("usage: node tools/decode-ags101-ws5-readback.mjs screenshot.png [...]");
  const receipt = files.map((file) => {
    const image = decodePng(file);
    return { file, size: [image.width, image.height], ...decodeBands(image) };
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
