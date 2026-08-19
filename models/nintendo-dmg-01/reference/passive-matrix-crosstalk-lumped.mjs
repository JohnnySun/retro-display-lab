// Structure-preserving equipotential-line reduction of the distributed DMG
// passive-matrix RC reference. It is obtained by summing the KCL equations of
// every node on an electrode. No image-pattern coefficients are fitted.

import {
  shadeRmsVoltages,
  voltageToDriveCoordinate,
} from "./passive-matrix-crosstalk.mjs";

export function lumpedLineFactors(pixelCount, driverResistanceOhms,
  pixelCapacitanceFarads, pixelLeakageResistanceOhms, dtSeconds) {
  const capacitanceConductance = pixelCount * pixelCapacitanceFarads / dtSeconds;
  const leakageConductance = pixelCount / pixelLeakageResistanceOhms;
  const driverConductance = 1 / driverResistanceOhms;
  const denominator = capacitanceConductance + leakageConductance + driverConductance;
  return {
    memory: capacitanceConductance / denominator,
    leakage: leakageConductance / denominator,
    driver: driverConductance / denominator,
    totalCapacitanceFarads: pixelCount * pixelCapacitanceFarads,
    timeConstantSeconds: driverResistanceOhms * pixelCount * pixelCapacitanceFarads,
  };
}

function updateLine(state, previousExternal, external, source, factors) {
  return factors.memory * (state - previousExternal + external)
    + factors.leakage * external + factors.driver * source;
}

export function simulateLumpedPattern(pattern, options) {
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    warmupFrames = 1,
    measuredFrames = 1,
    substepsPerDwell = 8,
  } = options;
  const dt = dwellSeconds / substepsPerDwell;
  const rowFactors = lumpedLineFactors(
    columns, rowDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const columnFactors = lumpedLineFactors(
    rows, columnDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const rowState = new Float64Array(rows);
  const columnState = new Float64Array(columns);
  let previousRowExternal = 0;
  let previousColumnExternal = 0;
  const columnExternal = new Float64Array(columns);
  const sumSquares = new Float64Array(rows * columns);
  const idealSumSquares = new Float64Array(rows * columns);
  let samples = 0;
  for (let frame = 0; frame < warmupFrames + measuredFrames; frame += 1) {
    const polarity = (frame & 1) ? -1 : 1;
    for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
      for (let phase = 0; phase < 3; phase += 1) {
        let columnExternalMean = 0;
        for (let x = 0; x < columns; x += 1) {
          const shade = shades[selectedRow * columns + x];
          columnExternal[x] = polarity
            * (phase < shade ? -columnAmplitude : columnAmplitude);
          columnExternalMean += columnExternal[x];
        }
        columnExternalMean /= columns;
        const rowExternalMean = polarity * rowAmplitude / rows;
        for (let substep = 0; substep < substepsPerDwell; substep += 1) {
          for (let y = 0; y < rows; y += 1) {
            rowState[y] = updateLine(
              rowState[y], previousColumnExternal, columnExternalMean,
              y === selectedRow ? polarity * rowAmplitude : 0, rowFactors,
            );
          }
          previousColumnExternal = columnExternalMean;
          for (let x = 0; x < columns; x += 1) {
            columnState[x] = updateLine(
              columnState[x], previousRowExternal, rowExternalMean,
              columnExternal[x], columnFactors,
            );
          }
          previousRowExternal = rowExternalMean;
          if (frame >= warmupFrames) {
            samples += 1;
            for (let y = 0; y < rows; y += 1) {
              const idealRow = y === selectedRow ? polarity * rowAmplitude : 0;
              const offset = y * columns;
              for (let x = 0; x < columns; x += 1) {
                const index = offset + x;
                const actualPixel = rowState[y] - columnState[x];
                const idealPixel = idealRow - columnExternal[x];
                sumSquares[index] += actualPixel * actualPixel;
                idealSumSquares[index] += idealPixel * idealPixel;
              }
            }
          }
        }
      }
    }
  }
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  const rmsVolts = new Float64Array(shades.length);
  const idealRmsVolts = new Float64Array(shades.length);
  const driveCoordinates = new Float64Array(shades.length);
  for (let index = 0; index < shades.length; index += 1) {
    rmsVolts[index] = Math.sqrt(sumSquares[index] / samples);
    idealRmsVolts[index] = Math.sqrt(idealSumSquares[index] / samples);
    driveCoordinates[index] = voltageToDriveCoordinate(rmsVolts[index], shadeVolts);
  }
  return {
    patternId: pattern.id,
    columns,
    rows,
    samples,
    substepsPerDwell,
    rowFactors,
    columnFactors,
    shadeRmsVolts: shadeVolts,
    rmsVolts,
    idealRmsVolts,
    driveCoordinates,
  };
}

function geometricPowerSum(ratio, count) {
  if (Math.abs(1 - ratio) < 1e-12) return count;
  return ratio * (1 - ratio ** count) / (1 - ratio);
}

function advancePhaseAndAccumulate(rowState, columnState,
  previousRowExternal, previousColumnExternal,
  rowExternal, columnExternal, rowSource, columnSource,
  idealRow, idealColumn, rowScale, columnScale,
  rowFactors, columnFactors, substeps) {
  const rowVirtual = rowState - previousColumnExternal + columnExternal;
  const columnVirtual = columnState - previousRowExternal + rowExternal;
  const rowEquilibrium = (rowFactors.leakage * columnExternal
    + rowFactors.driver * rowSource) / (1 - rowFactors.memory);
  const columnEquilibrium = (columnFactors.leakage * rowExternal
    + columnFactors.driver * columnSource) / (1 - columnFactors.memory);
  const idealPixel = idealRow - idealColumn;
  const constant = idealPixel
    + rowScale * (rowEquilibrium - idealRow)
    - columnScale * (columnEquilibrium - idealColumn);
  const rowPhysicalTransient = rowVirtual - rowEquilibrium;
  const columnPhysicalTransient = columnVirtual - columnEquilibrium;
  const rowTransient = rowScale * rowPhysicalTransient;
  const columnTransient = -columnScale * columnPhysicalTransient;
  const rowSum = geometricPowerSum(rowFactors.memory, substeps);
  const columnSum = geometricPowerSum(columnFactors.memory, substeps);
  const rowSquareSum = geometricPowerSum(rowFactors.memory ** 2, substeps);
  const columnSquareSum = geometricPowerSum(columnFactors.memory ** 2, substeps);
  const crossSum = geometricPowerSum(
    rowFactors.memory * columnFactors.memory, substeps,
  );
  const sumSquares = substeps * constant * constant
    + rowTransient * rowTransient * rowSquareSum
    + columnTransient * columnTransient * columnSquareSum
    + 2 * constant * rowTransient * rowSum
    + 2 * constant * columnTransient * columnSum
    + 2 * rowTransient * columnTransient * crossSum;
  return {
    rowState: rowEquilibrium + rowPhysicalTransient * rowFactors.memory ** substeps,
    columnState: columnEquilibrium + columnPhysicalTransient
      * columnFactors.memory ** substeps,
    sumSquares,
  };
}

export function simulateLumpedPixel(pattern, x, y, options) {
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    warmupFrames = 1,
    measuredFrames = 1,
    substepsPerDwell = 8,
    rowScale = 1,
    columnScale = 1,
  } = options;
  const dt = dwellSeconds / substepsPerDwell;
  const rowFactors = lumpedLineFactors(
    columns, rowDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const columnFactors = lumpedLineFactors(
    rows, columnDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const phaseCounts = new Uint16Array(rows * 3);
  for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
    for (let px = 0; px < columns; px += 1) {
      const shade = shades[selectedRow * columns + px];
      for (let phase = 0; phase < 3; phase += 1) {
        if (phase < shade) phaseCounts[selectedRow * 3 + phase] += 1;
      }
    }
  }
  let rowState = 0;
  let columnState = 0;
  let previousRowExternal = 0;
  let previousColumnExternal = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let frame = 0; frame < warmupFrames + measuredFrames; frame += 1) {
    const polarity = (frame & 1) ? -1 : 1;
    for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
      const shade = shades[selectedRow * columns + x];
      for (let phase = 0; phase < 3; phase += 1) {
        const activeCount = phaseCounts[selectedRow * 3 + phase];
        const columnExternalMean = polarity * columnAmplitude
          * (columns - 2 * activeCount) / columns;
        const columnExternal = polarity
          * (phase < shade ? -columnAmplitude : columnAmplitude);
        const rowExternalMean = polarity * rowAmplitude / rows;
        const advanced = advancePhaseAndAccumulate(
          rowState, columnState, previousRowExternal, previousColumnExternal,
          rowExternalMean, columnExternalMean,
          selectedRow === y ? polarity * rowAmplitude : 0,
          columnExternal,
          selectedRow === y ? polarity * rowAmplitude : 0,
          columnExternal,
          rowScale, columnScale,
          rowFactors, columnFactors, substepsPerDwell,
        );
        rowState = advanced.rowState;
        columnState = advanced.columnState;
        previousRowExternal = rowExternalMean;
        previousColumnExternal = columnExternalMean;
        if (frame >= warmupFrames) {
          sumSquares += advanced.sumSquares;
          samples += substepsPerDwell;
        }
      }
    }
  }
  const rmsVolts = Math.sqrt(sumSquares / samples);
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  return {
    rmsVolts,
    driveCoordinate: voltageToDriveCoordinate(rmsVolts, shadeVolts),
    samples,
  };
}

// Conservative scalar float32 mirror of the runtime Shader. Each arithmetic
// result is rounded explicitly; real GPU fused multiply-adds can only remove
// some of these intermediate roundings. This is a numeric gate, not a second
// model and not a pattern fit.
export function simulateLumpedPixelFloat32(pattern, x, y, options) {
  const f = Math.fround;
  const add = (a, b) => f(f(a) + f(b));
  const sub = (a, b) => f(f(a) - f(b));
  const mul = (a, b) => f(f(a) * f(b));
  const div = (a, b) => f(f(a) / f(b));
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    warmupFrames = 1,
    measuredFrames = 1,
    substepsPerDwell = 8,
    rowScale = 1,
    columnScale = 1,
  } = options;
  const dt = dwellSeconds / substepsPerDwell;
  const rowFactors = lumpedLineFactors(
    columns, rowDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const columnFactors = lumpedLineFactors(
    rows, columnDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const phaseCounts = new Uint16Array(rows * 3);
  for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
    for (let px = 0; px < columns; px += 1) {
      const shade = shades[selectedRow * columns + px];
      for (let phase = 0; phase < 3; phase += 1) {
        if (phase < shade) phaseCounts[selectedRow * 3 + phase] += 1;
      }
    }
  }
  const geometric = (ratio) => div(
    mul(ratio, sub(1, f(ratio ** substepsPerDwell))), sub(1, ratio),
  );
  const rowPower = f(rowFactors.memory ** substepsPerDwell);
  const columnPower = f(columnFactors.memory ** substepsPerDwell);
  const rowSum = geometric(rowFactors.memory);
  const columnSum = geometric(columnFactors.memory);
  const rowSquareSum = geometric(mul(rowFactors.memory, rowFactors.memory));
  const columnSquareSum = geometric(mul(columnFactors.memory, columnFactors.memory));
  const crossSum = geometric(mul(rowFactors.memory, columnFactors.memory));
  let rowState = f(0);
  let columnState = f(0);
  let previousRowExternal = f(0);
  let previousColumnExternal = f(0);
  let sumSquares = f(0);
  let samples = 0;
  for (let frame = 0; frame < warmupFrames + measuredFrames; frame += 1) {
    const polarity = f((frame & 1) ? -1 : 1);
    const rowExternal = div(mul(polarity, rowAmplitude), rows);
    for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
      const shade = shades[selectedRow * columns + x];
      for (let phase = 0; phase < 3; phase += 1) {
        const activeCount = phaseCounts[selectedRow * 3 + phase];
        const columnExternalMean = div(mul(
          mul(polarity, columnAmplitude), sub(columns, mul(2, activeCount)),
        ), columns);
        const columnExternal = mul(
          mul(polarity, columnAmplitude), phase < shade ? -1 : 1,
        );
        const rowSource = selectedRow === y
          ? mul(polarity, rowAmplitude) : f(0);
        const rowVirtual = add(sub(rowState, previousColumnExternal), columnExternalMean);
        const columnVirtual = add(sub(columnState, previousRowExternal), rowExternal);
        const rowEquilibrium = div(add(
          mul(rowFactors.leakage, columnExternalMean),
          mul(rowFactors.driver, rowSource),
        ), sub(1, rowFactors.memory));
        const columnEquilibrium = div(add(
          mul(columnFactors.leakage, rowExternal),
          mul(columnFactors.driver, columnExternal),
        ), sub(1, columnFactors.memory));
        const idealPixel = sub(rowSource, columnExternal);
        const constant = sub(add(
          idealPixel, mul(rowScale, sub(rowEquilibrium, rowSource)),
        ), mul(columnScale, sub(columnEquilibrium, columnExternal)));
        const rowPhysicalTransient = sub(rowVirtual, rowEquilibrium);
        const columnPhysicalTransient = sub(columnVirtual, columnEquilibrium);
        const rowTransient = mul(rowScale, rowPhysicalTransient);
        const columnTransient = mul(-columnScale, columnPhysicalTransient);
        if (frame >= warmupFrames) {
          let phaseSquares = mul(substepsPerDwell, mul(constant, constant));
          phaseSquares = add(phaseSquares,
            mul(mul(rowTransient, rowTransient), rowSquareSum));
          phaseSquares = add(phaseSquares,
            mul(mul(columnTransient, columnTransient), columnSquareSum));
          phaseSquares = add(phaseSquares,
            mul(2, mul(mul(constant, rowTransient), rowSum)));
          phaseSquares = add(phaseSquares,
            mul(2, mul(mul(constant, columnTransient), columnSum)));
          phaseSquares = add(phaseSquares,
            mul(2, mul(mul(rowTransient, columnTransient), crossSum)));
          sumSquares = add(sumSquares, phaseSquares);
          samples += substepsPerDwell;
        }
        rowState = add(rowEquilibrium, mul(rowPhysicalTransient, rowPower));
        columnState = add(columnEquilibrium,
          mul(columnPhysicalTransient, columnPower));
        previousRowExternal = rowExternal;
        previousColumnExternal = columnExternalMean;
      }
    }
  }
  const rmsVolts = f(Math.sqrt(Math.max(div(sumSquares, samples), 0)));
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  return {
    rmsVolts,
    driveCoordinate: voltageToDriveCoordinate(rmsVolts, shadeVolts),
    samples,
  };
}

// Dwell-equilibrium limit of the same summed-KCL network. This is useful for
// testing whether the per-dwell line time constant is short enough to replace
// the scan-history recurrence with frame sufficient statistics.
export function simulateLumpedEquilibriumPixel(pattern, x, y, options) {
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    substepsPerDwell = 8,
    rowScale = 1,
    columnScale = 1,
  } = options;
  const dt = dwellSeconds / substepsPerDwell;
  const rowFactors = lumpedLineFactors(
    columns, rowDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const columnFactors = lumpedLineFactors(
    rows, columnDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const phaseCounts = new Uint16Array(rows * 3);
  for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
    for (let px = 0; px < columns; px += 1) {
      const shade = shades[selectedRow * columns + px];
      for (let phase = 0; phase < 3; phase += 1) {
        if (phase < shade) phaseCounts[selectedRow * 3 + phase] += 1;
      }
    }
  }
  let sumSquares = 0;
  for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
    const shade = shades[selectedRow * columns + x];
    for (let phase = 0; phase < 3; phase += 1) {
      const activeCount = phaseCounts[selectedRow * 3 + phase];
      const columnExternalMean = columnAmplitude
        * (columns - 2 * activeCount) / columns;
      const columnExternal = phase < shade ? -columnAmplitude : columnAmplitude;
      const rowExternalMean = rowAmplitude / rows;
      const rowSource = selectedRow === y ? rowAmplitude : 0;
      const rowEquilibrium = (rowFactors.leakage * columnExternalMean
        + rowFactors.driver * rowSource) / (1 - rowFactors.memory);
      const columnEquilibrium = (columnFactors.leakage * rowExternalMean
        + columnFactors.driver * columnExternal) / (1 - columnFactors.memory);
      const idealPixel = rowSource - columnExternal;
      const actualPixel = idealPixel
        + rowScale * (rowEquilibrium - rowSource)
        - columnScale * (columnEquilibrium - columnExternal);
      sumSquares += actualPixel * actualPixel;
    }
  }
  const rmsVolts = Math.sqrt(sumSquares / (rows * 3));
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  return {
    rmsVolts,
    driveCoordinate: voltageToDriveCoordinate(rmsVolts, shadeVolts),
    samples: rows * 3,
  };
}

// Phase-local closed form: retain the exact eight-substep transient inside
// each dwell, then drop only the residual at the dwell boundary. The omitted
// residual is bounded by memory^8 (about 2e-4 nominal) and makes the result a
// quadratic function of current/previous phase drives, which can be reduced to
// per-frame sufficient statistics on the GPU.
export function simulateLumpedPhaseLocalPixel(pattern, x, y, options) {
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    warmupFrames = 1,
    measuredFrames = 1,
    substepsPerDwell = 8,
    rowScale = 1,
    columnScale = 1,
  } = options;
  const dt = dwellSeconds / substepsPerDwell;
  const rowFactors = lumpedLineFactors(
    columns, rowDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const columnFactors = lumpedLineFactors(
    rows, columnDriverResistanceOhms, pixelCapacitanceFarads,
    pixelLeakageResistanceOhms, dt,
  );
  const phaseCounts = new Uint16Array(rows * 3);
  for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
    for (let px = 0; px < columns; px += 1) {
      const shade = shades[selectedRow * columns + px];
      for (let phase = 0; phase < 3; phase += 1) {
        if (phase < shade) phaseCounts[selectedRow * 3 + phase] += 1;
      }
    }
  }
  let rowState = 0;
  let columnState = 0;
  let previousRowExternal = 0;
  let previousColumnExternal = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let frame = 0; frame < warmupFrames + measuredFrames; frame += 1) {
    const polarity = (frame & 1) ? -1 : 1;
    for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
      const shade = shades[selectedRow * columns + x];
      for (let phase = 0; phase < 3; phase += 1) {
        const activeCount = phaseCounts[selectedRow * 3 + phase];
        const columnExternalMean = polarity * columnAmplitude
          * (columns - 2 * activeCount) / columns;
        const columnExternal = polarity
          * (phase < shade ? -columnAmplitude : columnAmplitude);
        const rowExternalMean = polarity * rowAmplitude / rows;
        const rowSource = selectedRow === y ? polarity * rowAmplitude : 0;
        const advanced = advancePhaseAndAccumulate(
          rowState, columnState, previousRowExternal, previousColumnExternal,
          rowExternalMean, columnExternalMean, rowSource, columnExternal,
          rowSource, columnExternal, rowScale, columnScale,
          rowFactors, columnFactors, substepsPerDwell,
        );
        const rowEquilibrium = (rowFactors.leakage * columnExternalMean
          + rowFactors.driver * rowSource) / (1 - rowFactors.memory);
        const columnEquilibrium = (columnFactors.leakage * rowExternalMean
          + columnFactors.driver * columnExternal) / (1 - columnFactors.memory);
        rowState = rowEquilibrium;
        columnState = columnEquilibrium;
        previousRowExternal = rowExternalMean;
        previousColumnExternal = columnExternalMean;
        if (frame >= warmupFrames) {
          sumSquares += advanced.sumSquares;
          samples += substepsPerDwell;
        }
      }
    }
  }
  const rmsVolts = Math.sqrt(sumSquares / samples);
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  return {
    rmsVolts,
    driveCoordinate: voltageToDriveCoordinate(rmsVolts, shadeVolts),
    samples,
  };
}
