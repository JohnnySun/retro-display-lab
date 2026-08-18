import { pathToFileURL } from "node:url";

export const PANEL_FPS = 16_777_216 / (1_232 * 228);
export const PANEL_FRAME_SECONDS = 1 / PANEL_FPS;

// Midpoints of the unrelated 25 °C laboratory-cell ranges reported in
// Mizusaki et al. (2011), Table 1. These are a literature prior, not AGS-101
// measurements.
export const LITERATURE_CELL_PRIOR = Object.freeze({
  adsorptionRatePerSecond: 0.0635 / 60,
  desorptionRatePerSecond: 0.0255 / 60,
});

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function framePolarity(frameCount) {
  if (!Number.isInteger(frameCount) || frameCount < 0) {
    throw new RangeError("frameCount must be a non-negative integer");
  }
  return frameCount % 2 === 0 ? 1 : -1;
}

export function stepResidualDc({
  state,
  driveDcOffset,
  adsorptionRatePerSecond,
  desorptionRatePerSecond,
  dtSeconds,
}) {
  const x = clamp(finite("state", state), -1, 1);
  const u = clamp(finite("driveDcOffset", driveDcOffset), -1, 1);
  const adsorption = Math.max(0, finite("adsorptionRatePerSecond", adsorptionRatePerSecond));
  const desorption = Math.max(0, finite("desorptionRatePerSecond", desorptionRatePerSecond));
  const dt = Math.max(0, finite("dtSeconds", dtSeconds));

  if (dt === 0) return x;
  if (Math.abs(u) <= Number.EPSILON) {
    return clamp(x * Math.exp(-desorption * dt), -1, 1);
  }

  const rate = adsorption + desorption;
  if (rate === 0) return x;
  const equilibrium = adsorption * u / rate;
  return clamp(equilibrium + (x - equilibrium) * Math.exp(-rate * dt), -1, 1);
}

export function effectiveDriveCode({
  sourceCode,
  polarity,
  driveDcOffset,
  residualDcState,
  driveCodeCoupling,
}) {
  const source = clamp(finite("sourceCode", sourceCode), 0, 1);
  const phase = polarity >= 0 ? 1 : -1;
  const external = clamp(finite("driveDcOffset", driveDcOffset), -1, 1);
  const internal = clamp(finite("residualDcState", residualDcState), -1, 1);
  const coupling = Math.max(0, finite("driveCodeCoupling", driveCodeCoupling));
  return clamp(source + phase * coupling * (external - internal), 0, 1);
}

export function simulateRetention({
  seconds,
  dtSeconds = PANEL_FRAME_SECONDS,
  initialState = 0,
  driveDcOffset = 0,
  adsorptionRatePerSecond = 0,
  desorptionRatePerSecond = 0,
}) {
  const duration = Math.max(0, finite("seconds", seconds));
  const dt = Math.max(Number.EPSILON, finite("dtSeconds", dtSeconds));
  const steps = Math.ceil(duration / dt);
  let state = initialState;
  let elapsed = 0;
  for (let index = 0; index < steps; index += 1) {
    const step = Math.min(dt, duration - elapsed);
    state = stepResidualDc({
      state,
      driveDcOffset,
      adsorptionRatePerSecond,
      desorptionRatePerSecond,
      dtSeconds: step,
    });
    elapsed += step;
  }
  return { state, elapsedSeconds: elapsed, steps };
}

function parseCli(argv) {
  const options = {
    seconds: 1_800,
    dtSeconds: PANEL_FRAME_SECONDS,
    initialState: 0,
    driveDcOffset: 0.1,
    adsorptionRatePerSecond: LITERATURE_CELL_PRIOR.adsorptionRatePerSecond,
    desorptionRatePerSecond: LITERATURE_CELL_PRIOR.desorptionRatePerSecond,
  };
  const names = new Map([
    ["--seconds", "seconds"],
    ["--dt", "dtSeconds"],
    ["--initial", "initialState"],
    ["--drive-dc", "driveDcOffset"],
    ["--adsorption-rate", "adsorptionRatePerSecond"],
    ["--desorption-rate", "desorptionRatePerSecond"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    if (!key || argv[index + 1] === undefined) {
      throw new Error(`unknown or incomplete argument: ${argv[index] ?? "<missing>"}`);
    }
    options[key] = Number(argv[index + 1]);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCli(process.argv.slice(2));
  const result = simulateRetention(options);
  process.stdout.write(`${JSON.stringify({
    model: "mizusaki-adsorption-desorption-reduced-v1",
    parameterStatus: "literature-cell-prior-not-ags101-measured",
    options,
    result,
  }, null, 2)}\n`);
}
