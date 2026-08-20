#!/usr/bin/env node

import process from "node:process";
import { decodeBands, decodePng } from "./decode-ags101-ws5-readback.mjs";

const FRAME_SECONDS = 1_232 * 228 / 16_777_216;
const ADSORPTION = 0.0010583333;
const DESORPTION = 0.000425;
const OFFSET = 0.1;
const CODE_WEIGHT = 0.5;
const POLARITY_WEIGHT = 0.25;

function excitation(code, polarity) {
  const f = Math.fround;
  const codeProxy = f(f(3 * code) / f(93));
  const codeShape = f(f(2) * codeProxy - f(1));
  const shape = f(f(1)
    + f(f(CODE_WEIGHT) * codeShape)
    + f(f(POLARITY_WEIGHT) * (polarity >= 0 ? f(1) : f(-1))));
  return f(f(OFFSET) * shape);
}

function step(state, code, frameCount) {
  const f = Math.fround;
  const x = f(state);
  const u = excitation(code, frameCount % 2 === 0 ? 1 : -1);
  const adsorption = f(ADSORPTION);
  const desorption = f(DESORPTION);
  const dt = f(FRAME_SECONDS);
  const rate = f(adsorption + desorption);
  const equilibrium = f(f(adsorption * u) / rate);
  const next = f(equilibrium + f(f(x - equilibrium) * f(Math.exp(f(-rate * dt)))));
  const encoded = f(f(0.5) + f(f(0.25) * next));
  return f(f(encoded - f(0.5)) * f(4));
}

function rightCode(frameCount) {
  return frameCount % 2_700 < 1_800 ? 24 : 8;
}

function advance(state, startFrame, endFrame, codeAt) {
  let value = state;
  for (let frame = startFrame + 1; frame <= endFrame; frame += 1) {
    value = step(value, codeAt(frame), frame);
  }
  return value;
}

const outputIndex = process.argv.indexOf("--output");
const outputFile = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
const files = process.argv.slice(2).filter((value, index, values) => (
  value !== "--output" && values[index - 1] !== "--output"
));
if (files.length < 2) {
  throw new Error("usage: node tools/compare-ags101-ws5-target.mjs capture-a.png capture-b.png [...]");
}
const captures = files.map((file) => {
  const decoded = decodeBands(decodePng(file));
  return {
    file,
    frameCount: decoded.bands.frameCount.value,
    leftState: decoded.bands.leftRetainedState.value,
    rightState: decoded.bands.rightRetainedState.value,
    leftExcitation: decoded.bands.leftExcitation.value,
    unanimousBits: decoded.confidence.map((band) => band.unanimousBits),
  };
});
const intervals = [];
for (let index = 1; index < captures.length; index += 1) {
  const from = captures[index - 1];
  const to = captures[index];
  const leftExpected = advance(from.leftState, from.frameCount, to.frameCount, () => 8);
  const rightExpected = advance(from.rightState, from.frameCount, to.frameCount, rightCode);
  const expectedExcitation = excitation(8, to.frameCount % 2 === 0 ? 1 : -1);
  intervals.push({
    fromFrame: from.frameCount,
    toFrame: to.frameCount,
    frameDelta: to.frameCount - from.frameCount,
    fixturePhase: rightCode(to.frameCount) === 24 ? "isolated-window-stress" : "uniform-recovery",
    left: {
      expected: leftExpected,
      actual: to.leftState,
      absoluteError: Math.abs(leftExpected - to.leftState),
    },
    right: {
      expected: rightExpected,
      actual: to.rightState,
      absoluteError: Math.abs(rightExpected - to.rightState),
    },
    excitation: {
      expected: expectedExcitation,
      actual: to.leftExcitation,
      absoluteError: Math.abs(expectedExcitation - to.leftExcitation),
    },
  });
}
const maximumAbsoluteError = Math.max(...intervals.flatMap((item) => [
  item.left.absoluteError,
  item.right.absoluteError,
  item.excitation.absoluteError,
]));
// Android screencap samples the composited image asynchronously to the next
// emulated frame; allow slightly over one state increment at this drive level.
const tolerance = 3e-6;
const report = {
  schemaVersion: 1,
  reportId: "nintendo-ags-101-current-retention-gpu-v1",
  model: "WS5 shader float32 recurrence plus WS2 1800/900-frame schedule",
  captures,
  intervals,
  maximumAbsoluteError,
  tolerance,
  pass: maximumAbsoluteError <= tolerance
    && captures.every((capture) => capture.unanimousBits.every((count) => count === 32)),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outputFile, serialized);
}
process.stdout.write(serialized);
if (!report.pass) process.exitCode = 1;
