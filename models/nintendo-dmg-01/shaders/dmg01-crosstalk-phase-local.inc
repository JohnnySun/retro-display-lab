// Structure-preserving phase-local form of the summed-KCL common-electrode
// model. The only omitted state is the phase-boundary residual, bounded by
// memory^8; generated constants and baselines live in the included file.
#include "dmg01-crosstalk-lumped.inc"

float crosstalk_geometric_power_sum(float ratio)
{
   return ratio * (1.0 - pow(ratio, float(DMG_CROSSTALK_SUBSTEPS)))
      / (1.0 - ratio);
}

vec2 crosstalk_packed_phase_counts(float packed)
{
   float exact = floor(packed + 0.5);
   return vec2(mod(exact, 256.0), floor(exact / 256.0));
}

vec2 crosstalk_row_equilibrium(vec2 columnMean, vec2 rowSource)
{
   return (DMG_CROSSTALK_ROW_LEAKAGE * columnMean
      + DMG_CROSSTALK_ROW_DRIVER * rowSource)
      / (1.0 - DMG_CROSSTALK_ROW_MEMORY);
}

vec2 crosstalk_column_equilibrium(vec2 rowMean, vec2 columnExternal)
{
   return (DMG_CROSSTALK_COLUMN_LEAKAGE * rowMean
      + DMG_CROSSTALK_COLUMN_DRIVER * columnExternal)
      / (1.0 - DMG_CROSSTALK_COLUMN_MEMORY);
}

vec2 crosstalk_phase_sum_squares(
   vec2 previousRowMean,
   vec2 previousColumnMean,
   vec2 previousRowSource,
   vec2 previousColumnExternal,
   vec2 rowMean,
   vec2 columnMean,
   vec2 rowSource,
   vec2 columnExternal,
   float rowScale,
   float columnScale
)
{
   vec2 rowState = crosstalk_row_equilibrium(
      previousColumnMean, previousRowSource);
   vec2 columnState = crosstalk_column_equilibrium(
      previousRowMean, previousColumnExternal);
   vec2 rowVirtual = rowState - previousColumnMean + columnMean;
   vec2 columnVirtual = columnState - previousRowMean + rowMean;
   vec2 rowEquilibrium = crosstalk_row_equilibrium(columnMean, rowSource);
   vec2 columnEquilibrium = crosstalk_column_equilibrium(rowMean, columnExternal);
   vec2 idealPixel = rowSource - columnExternal;
   vec2 constant = idealPixel
      + rowScale * (rowEquilibrium - rowSource)
      - columnScale * (columnEquilibrium - columnExternal);
   vec2 rowTransient = rowScale * (rowVirtual - rowEquilibrium);
   vec2 columnTransient = -columnScale * (columnVirtual - columnEquilibrium);
   float rowSum = crosstalk_geometric_power_sum(DMG_CROSSTALK_ROW_MEMORY);
   float columnSum = crosstalk_geometric_power_sum(DMG_CROSSTALK_COLUMN_MEMORY);
   float rowSquareSum = crosstalk_geometric_power_sum(
      DMG_CROSSTALK_ROW_MEMORY * DMG_CROSSTALK_ROW_MEMORY);
   float columnSquareSum = crosstalk_geometric_power_sum(
      DMG_CROSSTALK_COLUMN_MEMORY * DMG_CROSSTALK_COLUMN_MEMORY);
   float crossSum = crosstalk_geometric_power_sum(
      DMG_CROSSTALK_ROW_MEMORY * DMG_CROSSTALK_COLUMN_MEMORY);
   return float(DMG_CROSSTALK_SUBSTEPS) * constant * constant
      + rowTransient * rowTransient * rowSquareSum
      + columnTransient * columnTransient * columnSquareSum
      + 2.0 * constant * rowTransient * rowSum
      + 2.0 * constant * columnTransient * columnSum
      + 2.0 * rowTransient * columnTransient * crossSum;
}

float crosstalk_voltage_to_drive(float volts)
{
   if (volts <= DMG_CROSSTALK_SHADE_VOLTS[0]) return 0.0;
   if (volts >= DMG_CROSSTALK_SHADE_VOLTS[3]) return 3.0;
   for (int shade = 0; shade < 3; ++shade) {
      if (volts <= DMG_CROSSTALK_SHADE_VOLTS[shade + 1]) {
         return float(shade) + (volts - DMG_CROSSTALK_SHADE_VOLTS[shade])
            / (DMG_CROSSTALK_SHADE_VOLTS[shade + 1]
               - DMG_CROSSTALK_SHADE_VOLTS[shade]);
      }
   }
   return 3.0;
}

float crosstalk_uniform_baseline(
   int y, int shade, float rowScale, float columnScale)
{
   int index = clamp(y, 0, DMG_CROSSTALK_ROWS - 1) * 4 + clamp(shade, 0, 3);
   float row0 = mix(DMG_CROSSTALK_UNIFORM_00[index],
                    DMG_CROSSTALK_UNIFORM_10[index], rowScale);
   float row1 = mix(DMG_CROSSTALK_UNIFORM_01[index],
                    DMG_CROSSTALK_UNIFORM_11[index], rowScale);
   return mix(row0, row1, columnScale);
}
