#version 450

#pragma format R32G32B32A32_SFLOAT

// Retro Display Lab DMG-01 model, pass 2. Pass 0 supplies whole-row dwell
// loads and pass 1 reduces them to per-column frame statistics.
// Four Game Boy shades select passive-matrix RMS voltages. The generated LUT
// integrates a reduced director coordinate produced by the offline
// Frank-Oseen/Ericksen-Leslie and reflective Jones reconstruction. Ionic image
// retention remains a separate slow material mechanism.
// Provenance: ../REFERENCES.md
// Evidence: [DMG-MOTION-01] [DMG-STN-01] [DMG-STN-02] [DMG-STN-03]
//           [DMG-STN-04] [DMG-DRIVE-01] [DMG-DRIVE-02] [DMG-OPTICS-01]
//           [DMG-MATERIAL-01] [DMG-MATERIAL-02] [DMG-STN-05] [DMG-ION-01]
//           [DMG-MATRIX-02] [DMG-ITO-01] [DMG-ITO-02] [DMG-DRIVER-03]
//           [DMG-DRIVER-04] [DMG-LCELECTRICAL-01] [DMG-DIMENSIONS-01]
//           [DMG-ENGINE-01]

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
   float CurrentDriveCoherence;
   float LatchOffsetLines;
   float RowCrosstalk;
   float ColumnCrosstalk;
} params;

#pragma parameter DriveContrast "DMG reconstructed LCD drive scale" 1.00 0.88 1.12 0.01
#pragma parameter PanelTemperatureCelsius "DMG liquid-crystal temperature (C)" 20.0 10.0 30.0 1.0
#pragma parameter IonicMobility "STN (conductivity anisotropy) / viscosity" 0.050 0.025 0.075 0.001
#pragma parameter StickingOpticalGain "STN sticking volts to optical state" 0.082 0.000 0.200 0.002
#pragma parameter IonicChargeResponse "STN ionic charge / frame" 0.000126777389 0.000001 0.001000 0.000001
#pragma parameter IonicReleaseResponse "STN ionic release / frame" 0.000007115625 0.000001 0.002000 0.000001
#pragma parameter IonicTimeScale "STN experiment time scale" 1.0 1.0 120.0 1.0
#pragma parameter BakedScanout "DMG CPL row-latch timing" 1.0 0.0 1.0 1.0
#pragma parameter CurrentDriveCoherence "Hybrid: preserve current driven shade" 0.0 0.0 1.0 1.0
#pragma parameter LatchOffsetLines "DMG latch offset (captured line end)" 1.0 0.0 1.0 0.05
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
layout(set = 0, binding = 5) uniform sampler2D PassOutput0;
layout(set = 0, binding = 6) uniform sampler2D PassFeedback2;

#include "dmg01-stn-surrogate.inc"
#include "dmg01-crosstalk-phase-local.inc"

float gameboy_drive_index(vec3 encoded)
{
   float luma = dot(encoded, vec3(0.2126, 0.7152, 0.0722));
   return floor(clamp(1.0 - luma, 0.0, 1.0) * 3.0 + 0.5);
}

ivec2 bounded_source(ivec2 p)
{
   return clamp(p, ivec2(0), textureSize(Original, 0) - ivec2(1));
}

float source_drive_at(ivec2 p)
{
   return gameboy_drive_index(texelFetch(Original, bounded_source(p), 0).rgb);
}

float previous_drive_at(ivec2 p)
{
   return gameboy_drive_index(texelFetch(OriginalHistory1, bounded_source(p), 0).rgb);
}

vec2 row_phase_mean(int row, int phase, float polarity)
{
   vec3 packed = texelFetch(PassOutput0, ivec2(0, row), 0).rgb;
   vec2 counts = crosstalk_packed_phase_counts(packed[phase]);
   return polarity * DMG_CROSSTALK_COLUMN_AMPLITUDE
      * (float(DMG_CROSSTALK_COLUMNS) - 2.0 * counts)
      / float(DMG_CROSSTALK_COLUMNS);
}

vec2 column_phase_external(ivec2 p, int phase, float polarity)
{
   vec2 shade = vec2(source_drive_at(p), previous_drive_at(p));
   return polarity * DMG_CROSSTALK_COLUMN_AMPLITUDE
      * mix(vec2(1.0), vec2(-1.0),
            lessThan(vec2(float(phase)), shade));
}

// Pass 1 already accumulated the full frame with rowSource=0. Only the three
// phases that select this pixel's row differ, so replace those local terms.
vec2 phase_local_drive_coordinates(ivec2 p)
{
   vec2 center = vec2(source_drive_at(p), previous_drive_at(p));
   float rowScale = clamp(params.RowCrosstalk, 0.0, 1.5);
   float columnScale = clamp(params.ColumnCrosstalk, 0.0, 1.5);
   if (rowScale <= 0.000001 && columnScale <= 0.000001) return center;

   vec2 sumSquares = texelFetch(Source, ivec2(p.x, 0), 0).rg;
   vec2 zeroSource = vec2(0.0);
   vec2 selectedSource = vec2(-DMG_CROSSTALK_ROW_AMPLITUDE);
   vec2 previousSource = zeroSource;
   vec2 previousRowMean;
   vec2 previousColumnMean;
   vec2 previousColumnExternal;
   if (p.y == 0) {
      previousRowMean = vec2(
         DMG_CROSSTALK_ROW_AMPLITUDE / float(DMG_CROSSTALK_ROWS));
      previousColumnMean = row_phase_mean(DMG_CROSSTALK_ROWS - 1, 2, 1.0);
      previousColumnExternal = column_phase_external(
         ivec2(p.x, DMG_CROSSTALK_ROWS - 1), 2, 1.0);
   } else {
      previousRowMean = vec2(
         -DMG_CROSSTALK_ROW_AMPLITUDE / float(DMG_CROSSTALK_ROWS));
      previousColumnMean = row_phase_mean(p.y - 1, 2, -1.0);
      previousColumnExternal = column_phase_external(
         ivec2(p.x, p.y - 1), 2, -1.0);
   }
   vec2 rowMean = vec2(
      -DMG_CROSSTALK_ROW_AMPLITUDE / float(DMG_CROSSTALK_ROWS));
   for (int phase = 0; phase < 3; ++phase) {
      vec2 columnMean = row_phase_mean(p.y, phase, -1.0);
      vec2 columnExternal = column_phase_external(p, phase, -1.0);
      vec2 actual = crosstalk_phase_sum_squares(
         previousRowMean, previousColumnMean, previousSource,
         previousColumnExternal, rowMean, columnMean, selectedSource,
         columnExternal, rowScale, columnScale);
      vec2 base = crosstalk_phase_sum_squares(
         previousRowMean, previousColumnMean, zeroSource,
         previousColumnExternal, rowMean, columnMean, zeroSource,
         columnExternal, rowScale, columnScale);
      sumSquares += actual - base;
      previousRowMean = rowMean;
      previousColumnMean = columnMean;
      previousColumnExternal = columnExternal;
      previousSource = selectedSource;
   }

   float samples = float(DMG_CROSSTALK_ROWS * 3 * DMG_CROSSTALK_SUBSTEPS);
   vec2 rawDrive = vec2(
      crosstalk_voltage_to_drive(sqrt(max(sumSquares.x / samples, 0.0))),
      crosstalk_voltage_to_drive(sqrt(max(sumSquares.y / samples, 0.0)))
   );
   vec2 baseline = vec2(
      crosstalk_uniform_baseline(p.y, int(center.x), rowScale, columnScale),
      crosstalk_uniform_baseline(p.y, int(center.y), rowScale, columnScale)
   );
   // The period-bounded common-mode reconstruction is not a direct surviving
   // DMG measurement. Its shade-specific uniform baseline can otherwise turn
   // a shade-2 tile interior into shade 3 in a mixed field. Preserve the
   // reconstructed small loading variation, but never allow it to erase the
   // ordering of adjacent discrete DMG tones.
   vec2 correction = clamp(
      rawDrive - baseline,
      vec2(-DMG_CROSSTALK_MAX_TONE_EXCURSION),
      vec2(DMG_CROSSTALK_MAX_TONE_EXCURSION)
   );
   return clamp(center + correction, vec2(0.0), vec2(3.0));
}

float condition_target(int condition, int driveIndex)
{
   return DMG_PHYSICAL_TARGET_Q[condition * 4 + driveIndex];
}

float condition_drift(int condition, int driveIndex, float directorCoordinate)
{
   float position = clamp(directorCoordinate, 0.0, 1.0)
                  * float(DMG_PHYSICAL_DRIFT_BINS - 1);
   int low = min(int(floor(position)), DMG_PHYSICAL_DRIFT_BINS - 2);
   float fraction = position - float(low);
   int base = condition * 4 * DMG_PHYSICAL_DRIFT_BINS
            + driveIndex * DMG_PHYSICAL_DRIFT_BINS + low;
   return mix(DMG_PHYSICAL_DRIFT[base], DMG_PHYSICAL_DRIFT[base + 1], fraction);
}

void contrast_conditions(out int low, out int high, out float fraction)
{
   float position = clamp((params.DriveContrast - 0.88) / 0.12, 0.0, 2.0);
   low = min(int(floor(position)), 1);
   high = low + 1;
   fraction = position - float(low);
}

float physical_target(float driveCoordinate)
{
   float position = clamp(driveCoordinate, 0.0, 3.0);
   int driveLow = min(int(floor(position)), 2);
   int driveHigh = driveLow + 1;
   float driveFraction = position - float(driveLow);
   int low;
   int high;
   float fraction;
   contrast_conditions(low, high, fraction);
   float lowTarget = mix(condition_target(low, driveLow),
                         condition_target(low, driveHigh), driveFraction);
   float highTarget = mix(condition_target(high, driveLow),
                          condition_target(high, driveHigh), driveFraction);
   return mix(lowTarget, highTarget, fraction);
}

float physical_drift(float driveCoordinate, float directorCoordinate)
{
   float position = clamp(driveCoordinate, 0.0, 3.0);
   int driveLow = min(int(floor(position)), 2);
   int driveHigh = driveLow + 1;
   float driveFraction = position - float(driveLow);
   int low;
   int high;
   float fraction;
   contrast_conditions(low, high, fraction);
   float lowDrift = mix(condition_drift(low, driveLow, directorCoordinate),
                        condition_drift(low, driveHigh, directorCoordinate), driveFraction);
   float highDrift = mix(condition_drift(high, driveLow, directorCoordinate),
                         condition_drift(high, driveHigh, directorCoordinate), driveFraction);
   return mix(lowDrift, highDrift, fraction);
}

float physical_optical_correction(float directorCoordinate)
{
   float coordinate = clamp(directorCoordinate, 0.0, 1.0);
   if (coordinate <= DMG_PHYSICAL_OPTICAL_ANCHOR_Q[0])
   {
      return DMG_PHYSICAL_OPTICAL_CORRECTION[0]
           * coordinate / max(DMG_PHYSICAL_OPTICAL_ANCHOR_Q[0], 1e-6);
   }
   for (int anchor = 0; anchor < 3; anchor++)
   {
      if (coordinate <= DMG_PHYSICAL_OPTICAL_ANCHOR_Q[anchor + 1])
      {
         float fraction = (coordinate - DMG_PHYSICAL_OPTICAL_ANCHOR_Q[anchor])
                        / max(DMG_PHYSICAL_OPTICAL_ANCHOR_Q[anchor + 1]
                            - DMG_PHYSICAL_OPTICAL_ANCHOR_Q[anchor], 1e-6);
         return mix(DMG_PHYSICAL_OPTICAL_CORRECTION[anchor],
                    DMG_PHYSICAL_OPTICAL_CORRECTION[anchor + 1], fraction);
      }
   }
   return DMG_PHYSICAL_OPTICAL_CORRECTION[3]
        * (1.0 - coordinate)
        / max(1.0 - DMG_PHYSICAL_OPTICAL_ANCHOR_Q[3], 1e-6);
}

float physical_optical_state(float directorCoordinate)
{
   float position = clamp(directorCoordinate, 0.0, 1.0)
                  * float(DMG_PHYSICAL_OPTICAL_BINS - 1);
   int low = min(int(floor(position)), DMG_PHYSICAL_OPTICAL_BINS - 2);
   float fraction = position - float(low);
   float rawOpticalState = mix(DMG_PHYSICAL_OPTICAL[low],
                               DMG_PHYSICAL_OPTICAL[low + 1], fraction);
   return clamp(rawOpticalState + physical_optical_correction(directorCoordinate),
                0.25, 1.0);
}

// The scalar runtime coordinate cannot retain the full depth-dependent
// director profile. Around the STN threshold, a broad interval of distinct
// scalar coordinates is optically indistinguishable at state 0.25; carrying
// that unobservable ambiguity across a later drive change makes otherwise
// identical pixels cross the threshold on different frames. Project only at
// a discrete drive transition onto the unique nominal optical branch. This
// preserves the visible state and ionic memory while preventing a reduced-
// order hidden coordinate from masquerading as physical pixel defects.
float canonical_director_for_optical(float opticalState)
{
   float state = clamp(opticalState, 0.25, 1.0);
   int interval = min(int(floor((state - 0.25) * 4.0)), 2);
   float low = DMG_PHYSICAL_OPTICAL_ANCHOR_Q[interval];
   float high = DMG_PHYSICAL_OPTICAL_ANCHOR_Q[interval + 1];
   for (int iteration = 0; iteration < 10; ++iteration)
   {
      float middle = 0.5 * (low + high);
      if (physical_optical_state(middle) < state)
         low = middle;
      else
         high = middle;
   }
   return 0.5 * (low + high);
}

float structural_temperature_scale()
{
   float kelvin = params.PanelTemperatureCelsius + 273.15;
   return exp(DMG_VISCOSITY_ACTIVATION_K * (1.0 / 293.15 - 1.0 / kelvin));
}

float scaled_ionic_response(float response, float frameFraction)
{
   return 1.0 - pow(1.0 - response,
      params.IonicTimeScale * clamp(frameFraction, 0.0, 1.0));
}

float integrate_director_segment(
   float directorCoordinate,
   float driveCoordinate,
   float frameFraction,
   float temperatureScale
)
{
   return clamp(directorCoordinate
      + physical_drift(driveCoordinate, directorCoordinate)
      * clamp(frameFraction, 0.0, 1.0) * temperatureScale,
      0.0, 1.0);
}

float integrate_ionic_segment(
   float ionicCharge,
   float driveCoordinate,
   float frameFraction
)
{
   float drive = driveCoordinate / 3.0;
   float response = drive > ionicCharge
      ? scaled_ionic_response(params.IonicChargeResponse, frameFraction)
      : scaled_ionic_response(params.IonicReleaseResponse, frameFraction);
   return ionicCharge + (drive - ionicCharge) * response;
}

float displayed_optical_state(
   float directorCoordinate,
   float ionicCharge,
   float driveCoordinate
)
{
   float drive = driveCoordinate / 3.0;
   // Linear regression of the 11 mixtures in Nakazono et al. (Merck Japan,
   // 1994): sticking voltage ~= 7.3904 * ((delta sigma / sigma) / eta) - 0.187.
   // The paper measures a visibility voltage range, not optical transmission;
   // StickingOpticalGain is therefore an explicit, separately tunable bridge.
   float stickingVolts = max(7.390426 * params.IonicMobility - 0.186987, 0.0);
   float ionicBias = max(ionicCharge - drive, 0.0)
                   * stickingVolts * params.StickingOpticalGain;
   return clamp(physical_optical_state(directorCoordinate) + ionicBias,
                0.25, 1.0);
}

// A host frame represents the light reflected throughout one complete DMG
// frame, not an instantaneous sample of the director at the frame boundary.
// The STN optical curve is especially steep around threshold; displaying only
// the endpoint aliases a continuous crossing into an isolated one-frame pixel
// discontinuity. Integrate each constant-drive segment with Simpson's rule
// while preserving the physical endpoint in feedback for the next frame.
float integrate_exposure_segment(
   inout float directorCoordinate,
   inout float ionicCharge,
   float driveCoordinate,
   float frameFraction,
   float temperatureScale
)
{
   float fraction = clamp(frameFraction, 0.0, 1.0);
   if (fraction <= 0.0) return 0.0;

   float startDirector = directorCoordinate;
   float startIonic = ionicCharge;
   float middleDirector = integrate_director_segment(
      startDirector, driveCoordinate, 0.5 * fraction, temperatureScale
   );
   float middleIonic = integrate_ionic_segment(
      startIonic, driveCoordinate, 0.5 * fraction
   );
   float endDirector = integrate_director_segment(
      startDirector, driveCoordinate, fraction, temperatureScale
   );
   float endIonic = integrate_ionic_segment(
      startIonic, driveCoordinate, fraction
   );

   float startLight = displayed_optical_state(
      startDirector, startIonic, driveCoordinate
   );
   float middleLight = displayed_optical_state(
      middleDirector, middleIonic, driveCoordinate
   );
   float endLight = displayed_optical_state(
      endDirector, endIonic, driveCoordinate
   );

   directorCoordinate = endDirector;
   ionicCharge = endIonic;
   return fraction * (startLight + 4.0 * middleLight + endLight) / 6.0;
}

void main()
{
   ivec2 sourceLimit = max(ivec2(global.OriginalSize.xy) - ivec2(1), ivec2(0));
   ivec2 sourceCoord = clamp(
      ivec2(floor(vTexCoord * global.OriginalSize.xy)),
      ivec2(0),
      sourceLimit
   );
   int driveIndex = int(gameboy_drive_index(
      texelFetch(Original, sourceCoord, 0).rgb
   ));
   vec2 effectiveDriveCoordinates = phase_local_drive_coordinates(sourceCoord);
   float driveCoordinate = effectiveDriveCoordinates.x;
   vec4 history = texelFetch(PassFeedback2, sourceCoord, 0);

   // Physical feedback advances once per emulated DMG frame. Shader subframes
   // would otherwise multiply both director and ionic integration, so fail
   // closed to a static current-target state.
   if (global.TotalSubFrames != 1u) {
      float staticDirector = clamp(physical_target(driveCoordinate), 0.0, 1.0);
      FragColor = vec4(staticDirector, physical_optical_state(staticDirector),
                       0.0, 2.0 * float(driveIndex) + 8.0 * float(driveIndex)
                          + driveCoordinate * 0.25);
      return;
   }

   // Every valid fast state is >= 0.25, so red below 0.125 is an unambiguous
   // freshly-cleared feedback texture. Ionic charge starts neutral: loading a
   // game must not pretend its first frame had already been shown for 30 min.
   if (history.g < 0.125) {
      float directorCoordinate = clamp(physical_target(driveCoordinate), 0.0, 1.0);
      float displayed = physical_optical_state(directorCoordinate);
      FragColor = vec4(directorCoordinate, displayed, 0.0,
                       2.0 * float(driveIndex) + 8.0 * float(driveIndex)
                          + driveCoordinate * 0.25);
      return;
   }

   float directorCoordinate = history.r;
   float ionicCharge = history.b;
   int feedbackDriveIndex = int(floor(mod(history.a, 8.0) * 0.5));
   int previousDriveIndex = int(gameboy_drive_index(
      texelFetch(OriginalHistory1, sourceCoord, 0).rgb
   ));
   float previousDriveCoordinate = effectiveDriveCoordinates.y;
   int originDriveIndex = int(floor(history.a * 0.125));
   if (driveIndex != feedbackDriveIndex) {
      directorCoordinate = canonical_director_for_optical(
         physical_optical_state(directorCoordinate)
      );
      originDriveIndex = feedbackDriveIndex;
   }
   if (driveIndex != previousDriveIndex)
      originDriveIndex = previousDriveIndex;

   float temperatureScale = structural_temperature_scale();
   float exposureIntegral = 0.0;
   if (params.BakedScanout >= 0.5
       && abs(driveCoordinate - previousDriveCoordinate) > 0.00001) {
      // Nintendo documents 154 total lines. Captured CPL rising edges latch a
      // complete row at line end, so row 0 changes after one line and row 143
      // still receives the ten-line VBlank interval under the new drive.
      float latchFraction = (float(sourceCoord.y)
         + clamp(params.LatchOffsetLines, 0.0, 1.0)) / 154.0;
      exposureIntegral += integrate_exposure_segment(
         directorCoordinate, ionicCharge, previousDriveCoordinate,
         latchFraction, temperatureScale
      );
      exposureIntegral += integrate_exposure_segment(
         directorCoordinate, ionicCharge, driveCoordinate,
         1.0 - latchFraction, temperatureScale
      );
   } else {
      // Unchanged pixels deliberately retain the original one-step WS2 flow;
      // row timing must not introduce an artificial numerical partition.
      exposureIntegral = integrate_exposure_segment(
         directorCoordinate, ionicCharge, driveCoordinate, 1.0, temperatureScale
      );
   }

   float displayed = clamp(exposureIntegral, 0.25, 1.0);
   // Optional presentation hybrid. A purely causal LC response can leave a
   // newly driven solid object optically incomplete until its director crosses
   // threshold. Preserve the reconstructed equilibrium shade of the current
   // electrical drive as a lower bound while retaining physically integrated
   // brighter/darker residuals, ionic memory, scan timing, and crosstalk. The
   // reference preset leaves this disabled; target presets may opt in when
   // coherent current sprites are preferred over bidirectional LC latency.
   float coherentTarget = physical_optical_state(
      physical_target(driveCoordinate)
   );
   displayed = mix(
      displayed,
      max(displayed, coherentTarget),
      clamp(params.CurrentDriveCoherence, 0.0, 1.0)
   );

   // Alpha packs current target index and transition origin.
   // RGBA32F preserves the exact integer fields without another history pass.
   FragColor = vec4(directorCoordinate, displayed, ionicCharge,
                    2.0 * float(driveIndex) + 8.0 * float(originDriveIndex)
                       + driveCoordinate * 0.25);
}
