#version 450

#pragma format R32G32B32A32_SFLOAT

// Per-column frame sufficient statistics for the structure-preserving WS5
// phase-local common-electrode reduction. Each output pixel scans all rows
// once; the response pass then needs only the selected row's three phases.
// Provenance: ../REFERENCES.md
// Evidence: [DMG-MATRIX-02] [DMG-ITO-01] [DMG-ITO-02] [DMG-DRIVER-03]
//           [DMG-DRIVER-04] [DMG-LCELECTRICAL-01] [DMG-DIMENSIONS-01]

layout(push_constant) uniform Push
{
   float DriveContrast;
   float PanelTemperatureCelsius;
   float IonicMobility;
   float StickingOpticalGain;
   float IonicChargeResponse;
   float IonicReleaseResponse;
   float IonicTimeScale;
   float BakedScanout;
   float LatchOffsetLines;
   float RowCrosstalk;
   float ColumnCrosstalk;
} params;

#pragma parameter RowCrosstalk "DMG reconstructed row RC loading scale" 1.0 0.0 1.5 0.05
#pragma parameter ColumnCrosstalk "DMG reconstructed column RC loading scale" 1.0 0.0 1.5 0.05

layout(std140, set = 0, binding = 0) uniform UBO
{
   mat4 MVP;
   vec4 OutputSize;
   vec4 OriginalSize;
   vec4 SourceSize;
   uint FrameCount;
   uint TotalSubFrames;
} global;

#pragma stage vertex
layout(location = 0) in vec4 Position;
layout(location = 1) in vec2 TexCoord;
layout(location = 0) out vec2 vTexCoord;

void main()
{
   gl_Position = global.MVP * Position;
   vTexCoord = TexCoord;
}

#pragma stage fragment
layout(location = 0) in vec2 vTexCoord;
layout(location = 0) out vec4 FragColor;
layout(set = 0, binding = 2) uniform sampler2D Source;
layout(set = 0, binding = 3) uniform sampler2D Original;
layout(set = 0, binding = 4) uniform sampler2D OriginalHistory1;

#include "dmg01-crosstalk-phase-local.inc"

float drive_index(vec3 encoded)
{
   float luma = dot(encoded, vec3(0.2126, 0.7152, 0.0722));
   return floor(clamp(1.0 - luma, 0.0, 1.0) * 3.0 + 0.5);
}

vec2 row_phase_mean(int row, int phase, float polarity)
{
   vec3 packed = texelFetch(Source, ivec2(0, row), 0).rgb;
   vec2 counts = crosstalk_packed_phase_counts(packed[phase]);
   return polarity * DMG_CROSSTALK_COLUMN_AMPLITUDE
      * (float(DMG_CROSSTALK_COLUMNS) - 2.0 * counts)
      / float(DMG_CROSSTALK_COLUMNS);
}

vec2 column_phase_external(int x, int row, int phase, float polarity)
{
   vec2 shade = vec2(
      drive_index(texelFetch(Original, ivec2(x, row), 0).rgb),
      drive_index(texelFetch(OriginalHistory1, ivec2(x, row), 0).rgb)
   );
   return polarity * DMG_CROSSTALK_COLUMN_AMPLITUDE
      * mix(vec2(1.0), vec2(-1.0),
            lessThan(vec2(float(phase)), shade));
}

void main()
{
   int x = clamp(int(floor(vTexCoord.x * float(DMG_CROSSTALK_COLUMNS))),
                 0, DMG_CROSSTALK_COLUMNS - 1);
   float rowScale = clamp(params.RowCrosstalk, 0.0, 1.5);
   float columnScale = clamp(params.ColumnCrosstalk, 0.0, 1.5);
   if (rowScale <= 0.000001 && columnScale <= 0.000001) {
      FragColor = vec4(0.0);
      return;
   }

   // The measured frame has negative polarity. Its first phase follows the
   // final positive-polarity phase of the one-frame warmup.
   vec2 previousRowMean = vec2(
      DMG_CROSSTALK_ROW_AMPLITUDE / float(DMG_CROSSTALK_ROWS));
   vec2 previousColumnMean = row_phase_mean(
      DMG_CROSSTALK_ROWS - 1, 2, 1.0);
   vec2 previousColumnExternal = column_phase_external(
      x, DMG_CROSSTALK_ROWS - 1, 2, 1.0);
   vec2 zeroSource = vec2(0.0);
   vec2 sumSquares = vec2(0.0);
   vec2 rowMean = vec2(
      -DMG_CROSSTALK_ROW_AMPLITUDE / float(DMG_CROSSTALK_ROWS));

   for (int row = 0; row < DMG_CROSSTALK_ROWS; ++row) {
      for (int phase = 0; phase < 3; ++phase) {
         vec2 columnMean = row_phase_mean(row, phase, -1.0);
         vec2 columnExternal = column_phase_external(x, row, phase, -1.0);
         sumSquares += crosstalk_phase_sum_squares(
            previousRowMean, previousColumnMean, zeroSource,
            previousColumnExternal, rowMean, columnMean, zeroSource,
            columnExternal, rowScale, columnScale);
         previousRowMean = rowMean;
         previousColumnMean = columnMean;
         previousColumnExternal = columnExternal;
      }
   }
   FragColor = vec4(sumSquares, 0.0, 1.0);
}
