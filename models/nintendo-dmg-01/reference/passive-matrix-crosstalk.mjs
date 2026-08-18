// Distributed first-order row/column RC reference for the DMG passive matrix.
// Each electrode is a resistor ladder with one LC capacitor/leakage branch per
// pixel. Row and column networks are solved independently against the ideal
// opposite electrode, then combined by linear superposition. This is exact to
// first order in electrode error; callers report the omitted product term.

export const EPSILON_0 = 8.8541878128e-12;

export function pixelCapacitance(areaSquareMeters, gapMicrometers, epsilonRelative) {
  return EPSILON_0 * epsilonRelative * areaSquareMeters / (gapMicrometers * 1e-6);
}

export function pixelLeakageResistance(areaSquareMeters, gapMicrometers, rhoOhmCentimeters) {
  return rhoOhmCentimeters * 0.01 * gapMicrometers * 1e-6 / areaSquareMeters;
}

export function electrodeSegmentResistance(sheetOhmsPerSquare, widthFractionOfPitch) {
  return sheetOhmsPerSquare / widthFractionOfPitch;
}

export function makePattern(id, columns = 160, rows = 144) {
  const shades = new Uint8Array(columns * rows);
  const set = (x, y, shade) => { shades[y * columns + x] = shade; };
  if (id.startsWith("uniform-")) {
    shades.fill(Number(id.slice("uniform-".length)));
  } else if (id === "single-dot") {
    set(Math.floor(columns / 2), Math.floor(rows / 2), 3);
  } else if (id === "full-row") {
    for (let x = 0; x < columns; x += 1) set(x, Math.floor(rows / 2), 3);
  } else if (id === "full-column") {
    for (let y = 0; y < rows; y += 1) set(Math.floor(columns / 2), y, 3);
  } else if (id === "checkerboard") {
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      set(x, y, ((x + y) & 1) ? 3 : 0);
    }
  } else if (id === "alternating-lines") {
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      set(x, y, (y & 1) ? 3 : 0);
    }
  } else if (id === "window" || id === "inverse-window") {
    const inverse = id === "inverse-window";
    shades.fill(inverse ? 3 : 0);
    for (let y = Math.floor(rows / 4); y < Math.ceil(rows * 3 / 4); y += 1) {
      for (let x = Math.floor(columns / 4); x < Math.ceil(columns * 3 / 4); x += 1) {
        set(x, y, inverse ? 0 : 3);
      }
    }
  } else {
    throw new Error(`unknown crosstalk pattern: ${id}`);
  }
  return { id, columns, rows, shades };
}

function lineSolver(length, seriesResistance, driverResistance, capacitance, leakageResistance, dt) {
  const gc = capacitance / dt;
  const gl = 1 / seriesResistance;
  const gd = 1 / driverResistance;
  const gleak = 1 / leakageResistance;
  const lower = new Float64Array(length);
  const diagonal = new Float64Array(length);
  const upper = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    lower[i] = i > 0 ? -gl : 0;
    upper[i] = i + 1 < length ? -gl : 0;
    diagonal[i] = gc + gleak + (i > 0 ? gl : gd) + (i + 1 < length ? gl : 0);
  }
  const cPrime = new Float64Array(length);
  const inverseDenominator = new Float64Array(length);
  inverseDenominator[0] = 1 / diagonal[0];
  cPrime[0] = upper[0] * inverseDenominator[0];
  for (let i = 1; i < length; i += 1) {
    inverseDenominator[i] = 1 / (diagonal[i] - lower[i] * cPrime[i - 1]);
    cPrime[i] = upper[i] * inverseDenominator[i];
  }
  const forward = new Float64Array(length);
  return function solve(state, offset, previousExternal, external, source) {
    let rhs = gc * (state[offset] - previousExternal[0] + external[0])
      + gleak * external[0] + gd * source;
    forward[0] = rhs * inverseDenominator[0];
    for (let i = 1; i < length; i += 1) {
      rhs = gc * (state[offset + i] - previousExternal[i] + external[i])
        + gleak * external[i];
      forward[i] = (rhs - lower[i] * forward[i - 1]) * inverseDenominator[i];
    }
    state[offset + length - 1] = forward[length - 1];
    for (let i = length - 2; i >= 0; i -= 1) {
      state[offset + i] = forward[i] - cPrime[i] * state[offset + i + 1];
    }
  };
}

export function shadeRmsVoltages(rows, rowAmplitude, columnAmplitude) {
  return [0, 1, 2, 3].map((shade) => {
    const fraction = shade / 3;
    return Math.sqrt((fraction * (rowAmplitude + columnAmplitude) ** 2
      + (1 - fraction) * (rowAmplitude - columnAmplitude) ** 2
      + (rows - 1) * columnAmplitude ** 2) / rows);
  });
}

export function voltageToDriveCoordinate(volts, shadeVolts) {
  if (volts <= shadeVolts[0]) return 0;
  if (volts >= shadeVolts[3]) return 3;
  for (let i = 0; i < 3; i += 1) {
    if (volts <= shadeVolts[i + 1]) {
      return i + (volts - shadeVolts[i]) / (shadeVolts[i + 1] - shadeVolts[i]);
    }
  }
  return 3;
}

export function simulateDistributedPattern(pattern, options) {
  const { columns, rows, shades } = pattern;
  const {
    rowAmplitude,
    columnAmplitude,
    dwellSeconds,
    sheetResistanceOhmsPerSquare,
    electrodeWidthFractionOfPitch,
    rowDriverResistanceOhms,
    columnDriverResistanceOhms,
    pixelCapacitanceFarads,
    pixelLeakageResistanceOhms,
    warmupFrames = 1,
    measuredFrames = 1,
    substepsPerDwell = 8,
  } = options;
  const segmentResistance = electrodeSegmentResistance(
    sheetResistanceOhmsPerSquare, electrodeWidthFractionOfPitch,
  );
  const solveRow = lineSolver(columns, segmentResistance, rowDriverResistanceOhms,
    pixelCapacitanceFarads, pixelLeakageResistanceOhms, dwellSeconds / substepsPerDwell);
  const solveColumn = lineSolver(rows, segmentResistance, columnDriverResistanceOhms,
    pixelCapacitanceFarads, pixelLeakageResistanceOhms, dwellSeconds / substepsPerDwell);
  const rowState = new Float64Array(rows * columns);
  const columnState = new Float64Array(columns * rows);
  const previousColumnExternal = Array.from({ length: rows }, () => new Float64Array(columns));
  const previousRowExternal = Array.from({ length: columns }, () => new Float64Array(rows));
  const columnExternal = new Float64Array(columns);
  const rowExternal = new Float64Array(rows);
  const sumSquares = new Float64Array(rows * columns);
  const idealSumSquares = new Float64Array(rows * columns);
  let maximumRowFractionalError = 0;
  let maximumColumnFractionalError = 0;
  let samples = 0;
  const totalFrames = warmupFrames + measuredFrames;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const polarity = (frame & 1) ? -1 : 1;
    for (let selectedRow = 0; selectedRow < rows; selectedRow += 1) {
      for (let phase = 0; phase < 3; phase += 1) {
        for (let x = 0; x < columns; x += 1) {
          const shade = shades[selectedRow * columns + x];
          columnExternal[x] = polarity * (phase < shade ? -columnAmplitude : columnAmplitude);
        }
        rowExternal.fill(0);
        rowExternal[selectedRow] = polarity * rowAmplitude;
        for (let substep = 0; substep < substepsPerDwell; substep += 1) {
          for (let y = 0; y < rows; y += 1) {
            solveRow(rowState, y * columns, previousColumnExternal[y], columnExternal,
              y === selectedRow ? polarity * rowAmplitude : 0);
            previousColumnExternal[y].set(columnExternal);
          }
          for (let x = 0; x < columns; x += 1) {
            solveColumn(columnState, x * rows, previousRowExternal[x], rowExternal,
              columnExternal[x]);
            previousRowExternal[x].set(rowExternal);
          }
          if (frame >= warmupFrames) {
            samples += 1;
            for (let y = 0; y < rows; y += 1) {
              const idealRow = y === selectedRow ? polarity * rowAmplitude : 0;
              const rowOffset = y * columns;
              for (let x = 0; x < columns; x += 1) {
                const idealColumn = columnExternal[x];
                const idealPixel = idealRow - idealColumn;
                const rowError = rowState[rowOffset + x] - idealRow;
                const columnError = columnState[x * rows + y] - idealColumn;
                const actualPixel = idealPixel + rowError - columnError;
                const index = rowOffset + x;
                sumSquares[index] += actualPixel * actualPixel;
                idealSumSquares[index] += idealPixel * idealPixel;
                maximumRowFractionalError = Math.max(maximumRowFractionalError,
                  Math.abs(rowError) / Math.max(Math.abs(idealPixel), columnAmplitude));
                maximumColumnFractionalError = Math.max(maximumColumnFractionalError,
                  Math.abs(columnError) / Math.max(Math.abs(idealPixel), columnAmplitude));
              }
            }
          }
        }
      }
    }
  }
  const shadeVolts = shadeRmsVoltages(rows, rowAmplitude, columnAmplitude);
  const rmsVolts = new Float64Array(rows * columns);
  const idealRmsVolts = new Float64Array(rows * columns);
  const driveCoordinates = new Float64Array(rows * columns);
  for (let i = 0; i < rmsVolts.length; i += 1) {
    rmsVolts[i] = Math.sqrt(sumSquares[i] / samples);
    idealRmsVolts[i] = Math.sqrt(idealSumSquares[i] / samples);
    driveCoordinates[i] = voltageToDriveCoordinate(rmsVolts[i], shadeVolts);
  }
  return {
    patternId: pattern.id,
    columns,
    rows,
    samples,
    substepsPerDwell,
    segmentResistanceOhms: segmentResistance,
    shadeRmsVolts: shadeVolts,
    rmsVolts,
    idealRmsVolts,
    driveCoordinates,
    maximumRowFractionalError,
    maximumColumnFractionalError,
    omittedSecondOrderFractionBound: maximumRowFractionalError * maximumColumnFractionalError,
  };
}

export function sparseSurrogateFeatures(shades, columns, rows, x, y) {
  const bounded = (value, maximum) => Math.max(0, Math.min(maximum - 1, value));
  const at = (px, py) => shades[bounded(py, rows) * columns + bounded(px, columns)];
  const atColumn = (px, py) => shades[((py % rows + rows) % rows) * columns + bounded(px, columns)];
  const center = at(x, y);
  const difference = (a, b) => Math.abs(a - b) / 3;
  const similarity = (a, b) => 1 - difference(a, b);
  const leftTransition = difference(center, at(x - 1, y));
  const rightTransition = difference(center, at(x + 1, y));
  const previousTransition = difference(center, atColumn(x, y - 1));
  const nextTransition = difference(center, atColumn(x, y + 1));
  const darkWeight = center / 3;
  const rowBase = -darkWeight * 0.5 * (leftTransition + rightTransition);
  const rowRepeated = -darkWeight * leftTransition * rightTransition
    * 0.5 * (similarity(center, at(x - 2, y)) + similarity(center, at(x + 2, y)));
  // Column drivers see rows in scan order. Separate the one-off predecessor
  // transition from a sustained two-row alternation, which repeatedly reloads
  // the same output and cannot be represented by a symmetric neighborhood blur.
  const columnBase = -darkWeight * previousTransition;
  const columnRepeated = -darkWeight * previousTransition * nextTransition
    * 0.5 * (similarity(center, atColumn(x, y - 2)) + similarity(center, atColumn(x, y + 2)));
  return {
    rowBase,
    rowRepeated,
    columnBase,
    columnRepeated,
  };
}

export function fitSparseSurrogate(samples) {
  const keys = ["rowBase", "rowRepeated", "columnBase", "columnRepeated"];
  const normal = Array.from({ length: keys.length }, () => new Float64Array(keys.length + 1));
  for (const sample of samples) {
    for (let row = 0; row < keys.length; row += 1) {
      for (let column = 0; column < keys.length; column += 1) {
        normal[row][column] += sample[keys[row]] * sample[keys[column]];
      }
      normal[row][keys.length] += sample[keys[row]] * sample.delta;
    }
  }
  for (let pivot = 0; pivot < keys.length; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < keys.length; row += 1) {
      if (Math.abs(normal[row][pivot]) > Math.abs(normal[best][pivot])) best = row;
    }
    if (Math.abs(normal[best][pivot]) < 1e-15) throw new Error("singular crosstalk fit");
    [normal[pivot], normal[best]] = [normal[best], normal[pivot]];
    const scale = normal[pivot][pivot];
    for (let column = pivot; column <= keys.length; column += 1) normal[pivot][column] /= scale;
    for (let row = 0; row < keys.length; row += 1) {
      if (row === pivot) continue;
      const factor = normal[row][pivot];
      for (let column = pivot; column <= keys.length; column += 1) {
        normal[row][column] -= factor * normal[pivot][column];
      }
    }
  }
  return Object.fromEntries(keys.map((key, index) => [`${key}Coefficient`, normal[index][keys.length]]));
}

export function applySparseSurrogate(localDrive, features, coefficients, rowScale = 1, columnScale = 1) {
  return Math.max(0, Math.min(3, localDrive
    + rowScale * (coefficients.rowBaseCoefficient * features.rowBase
      + coefficients.rowRepeatedCoefficient * features.rowRepeated)
    + columnScale * (coefficients.columnBaseCoefficient * features.columnBase
      + coefficients.columnRepeatedCoefficient * features.columnRepeated)));
}
