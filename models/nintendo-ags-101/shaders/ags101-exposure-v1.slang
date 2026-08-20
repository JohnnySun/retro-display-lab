#version 450

#pragma format R32G32B32A32_SFLOAT

// Retro Display Lab AGS-101 WS7 exposure presentation, pass 1.
// Pass 0 keeps physical frame-boundary endpoint state; this pass integrates
// emitted native-linear light and never writes persistent feedback.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-COLOR-01] [AGS-GTG-01] [AGS-GTGDATA-01] [AGS-GTGENSEMBLE-01] [AGS-ION-01] [AGS-RETENTION-01] [AGS-TIMING-01] [AGS-BACKLIGHT-01] [AGS-EXPOSURE-01]

layout(push_constant) uniform Push
{
   float RiseBase;
   float FallBase;
   float NearTransitionDrag;
   float MidGrayDrag;
   float GtgTableBackend;
   float TemporalResponse;
   float HcsMeasuredColor;
   float DriveRetention;
   float SpatialRetention;
   float SpatialCodeWeight;
   float PolarityDriveWeight;
   float DriveDcOffset;
   float IonAdsorptionRate;
   float IonDesorptionRate;
   float DriveCodeCoupling;
   float BakedScanout;
   float LatchOffsetLines;
   float OpticalDelaySeconds;
   float ParityPhase;
   float InversionTopology;
   float ExposureMode;
} params;

#pragma parameter RiseBase "AGS candidate brightening / frame" 0.620 0.100 1.000 0.025
#pragma parameter FallBase "AGS candidate darkening / frame" 0.450 0.100 1.000 0.025
#pragma parameter NearTransitionDrag "AGS near-level GtG drag" 0.250 0.000 0.700 0.025
#pragma parameter MidGrayDrag "AGS middle-gray GtG drag" 0.200 0.000 0.500 0.025
#pragma parameter GtgTableBackend "AGS GtG table backend" 0.0 0.0 1.0 1.0
#pragma parameter TemporalResponse "AGS GtG optical response" 1.0 0.0 1.0 1.0
#pragma parameter HcsMeasuredColor "AGS HCS measured color" 1.0 0.0 1.0 1.0
#pragma parameter DriveRetention "AGS drive-retention state" 1.0 0.0 1.0 1.0
#pragma parameter SpatialRetention "AGS reconstructed spatial retention" 1.0 0.0 1.0 1.0
#pragma parameter SpatialCodeWeight "AGS code-dependent DC proxy weight" 0.500 0.000 1.000 0.025
#pragma parameter PolarityDriveWeight "AGS polarity-dependent DC proxy weight" 0.250 0.000 1.000 0.025
#pragma parameter DriveDcOffset "AGS project-prior normalized drive DC" 0.100 -0.250 0.250 0.005
#pragma parameter IonAdsorptionRate "Mizusaki cell adsorption rate (1/s)" 0.0010583333 0.0000 0.0100 0.0001
#pragma parameter IonDesorptionRate "Mizusaki cell desorption rate (1/s)" 0.0004250000 0.0000 0.0100 0.0001
#pragma parameter DriveCodeCoupling "AGS project-prior DC-to-code coupling" 0.150 0.000 1.000 0.010
#pragma parameter BakedScanout "AGS three-phase GBA scan timing" 1.0 0.0 1.0 1.0
#pragma parameter LatchOffsetLines "AGS latch offset candidate (lines)" 0.5 0.0 1.0 0.05
#pragma parameter OpticalDelaySeconds "AGS pure-delay candidate (s)" 0.000000 0.000000 0.016743 0.000050
#pragma parameter ParityPhase "AGS polarity-phase hypothesis" 0.0 0.0 1.0 1.0
#pragma parameter InversionTopology "AGS inversion hypothesis (frame/row/column/dot)" 0.0 0.0 3.0 1.0
#pragma parameter ExposureMode "AGS presentation (endpoint/integrated)" 1.0 0.0 1.0 1.0

layout(std140, set = 0, binding = 0) uniform UBO
{
   mat4 MVP;
   vec4 OutputSize;
   vec4 OriginalSize;
   vec4 SourceSize;
   uint FrameCount;
   uint TotalSubFrames;
} global;

#include "ags101-drive-retention.inc"

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
layout(set = 0, binding = 3) uniform sampler2D PassFeedback0;
layout(set = 0, binding = 4) uniform sampler2D Original;
layout(set = 0, binding = 5) uniform sampler2D OriginalHistory1;
layout(set = 0, binding = 6) uniform sampler2D OriginalHistory2;
layout(set = 0, binding = 7) uniform sampler2D GtgRateLut;

#include "ags101-ws3-timing.inc"
#include "ags101-exposure-optics.inc"

float decode_residual_dc(float encoded)
{
   return clamp((encoded - 0.5) * 4.0, -1.0, 1.0);
}

void integrate_residual_segment(
   inout float residualDc,
   ivec3 targetIndex,
   float polarity,
   float dtSeconds)
{
   if (params.DriveRetention < 0.5) {
      residualDc = 0.0;
      return;
   }
   float excitation = ws5_drive_excitation(
      targetIndex,
      polarity,
      params.DriveDcOffset,
      params.SpatialRetention,
      params.SpatialCodeWeight,
      params.PolarityDriveWeight
   );
   residualDc = update_residual_dc(
      residualDc,
      excitation,
      params.IonAdsorptionRate,
      params.IonDesorptionRate,
      dtSeconds
   );
}

float integrate_electrical_until(
   float initialResidualDc,
   ivec3 oldTargetIndex,
   ivec3 newTargetIndex,
   float polarity,
   float latchSeconds,
   float endSeconds)
{
   float state = initialResidualDc;
   float boundedEnd = clamp(endSeconds, 0.0, FRAME_SECONDS);
   float boundedLatch = clamp(latchSeconds, 0.0, FRAME_SECONDS);
   integrate_residual_segment(
      state, oldTargetIndex, polarity, min(boundedEnd, boundedLatch)
   );
   integrate_residual_segment(
      state, newTargetIndex, polarity, max(boundedEnd - boundedLatch, 0.0)
   );
   return state;
}

void integrate_exposure_segment(
   inout vec3 panelState,
   inout vec3 lightIntegral,
   ivec3 targetIndex,
   float residualDc,
   float polarity,
   float dtSeconds)
{
   if (dtSeconds <= 0.0)
      return;
   float excitation = ws5_drive_excitation(
      targetIndex,
      polarity,
      params.DriveDcOffset,
      params.SpatialRetention,
      params.SpatialCodeWeight,
      params.PolarityDriveWeight
   );
   vec3 effectiveCode = params.DriveRetention > 0.5
      ? effective_drive_code(
         targetIndex,
         polarity,
         excitation,
         residualDc,
         params.DriveCodeCoupling
      )
      : vec3(targetIndex) / 31.0;
   vec3 effectiveTarget = source_eotf_continuous(effectiveCode);
   if (params.TemporalResponse < 0.5) {
      panelState = effectiveTarget;
      lightIntegral += effectiveTarget * dtSeconds;
      return;
   }
   vec3 rate = max(gtg_rate(optical_to_code(panelState), targetIndex), vec3(1e-8));
   vec3 decay = exp(-rate * dtSeconds);
   lightIntegral += effectiveTarget * dtSeconds
      + (panelState - effectiveTarget) * (vec3(1.0) - decay) / rate;
   panelState = clamp(effectiveTarget + (panelState - effectiveTarget) * decay, 0.0, 1.0);
}

void main()
{
   ivec2 sourceLimit = max(ivec2(global.OriginalSize.xy) - ivec2(1), ivec2(0));
   ivec2 sourceCoord = clamp(
      ivec2(floor(vTexCoord * global.OriginalSize.xy)),
      ivec2(0),
      sourceLimit
   );
   vec4 endpoint = texelFetch(Source, sourceCoord, 0);
   if (params.ExposureMode < 0.5 || global.TotalSubFrames != 1u) {
      FragColor = endpoint;
      return;
   }
   vec4 feedback = texelFetch(PassFeedback0, sourceCoord, 0);
   if (feedback.a < 0.125) {
      FragColor = endpoint;
      return;
   }

   vec3 panelState = clamp(feedback.rgb, 0.0, 1.0);
   float residualDc = decode_residual_dc(feedback.a);
   float polarity = ws3_drive_polarity(
      global.FrameCount,
      sourceCoord,
      params.ParityPhase,
      params.InversionTopology
   );
   ivec3 currentTargetIndex = rgb555_index(texelFetch(Original, sourceCoord, 0).rgb);
   vec3 lightIntegral = vec3(0.0);

   if (params.BakedScanout < 0.5) {
      float residualAtEnd = residualDc;
      integrate_residual_segment(
         residualAtEnd, currentTargetIndex, polarity, FRAME_SECONDS
      );
      integrate_exposure_segment(
         panelState, lightIntegral, currentTargetIndex,
         residualAtEnd, polarity, FRAME_SECONDS
      );
   } else {
      vec4 previousSource = texelFetch(OriginalHistory1, sourceCoord, 0);
      vec4 olderSource = texelFetch(OriginalHistory2, sourceCoord, 0);
      ivec3 previousTargetIndex = rgb555_index(previousSource.rgb);
      Ws3ScanEvent event = ws3_scan_event(
         sourceCoord.y,
         params.LatchOffsetLines,
         params.OpticalDelaySeconds
      );
      ivec3 oldTargetIndex;
      ivec3 newTargetIndex;
      if (event.sourceFrameOffset == 0u) {
         oldTargetIndex = previousTargetIndex;
         newTargetIndex = currentTargetIndex;
      } else {
         newTargetIndex = previousTargetIndex;
         oldTargetIndex = previousSource.a > 0.5 && olderSource.a > 0.5
            ? rgb555_index(olderSource.rgb)
            : newTargetIndex;
      }
      float residualAtOptical = integrate_electrical_until(
         residualDc,
         previousTargetIndex,
         currentTargetIndex,
         polarity,
         event.latchSeconds,
         event.opticalTimeInFrame
      );
      float residualAtFrameEnd = integrate_electrical_until(
         residualDc,
         previousTargetIndex,
         currentTargetIndex,
         polarity,
         event.latchSeconds,
         FRAME_SECONDS
      );
      if (all(equal(oldTargetIndex, newTargetIndex))) {
         integrate_exposure_segment(
            panelState, lightIntegral, newTargetIndex,
            residualAtFrameEnd, polarity, FRAME_SECONDS
         );
      } else {
         vec3 splitState = panelState;
         vec3 splitIntegral = vec3(0.0);
         integrate_exposure_segment(
            splitState, splitIntegral, oldTargetIndex,
            residualAtOptical, polarity, event.opticalTimeInFrame
         );
         integrate_exposure_segment(
            splitState, splitIntegral, newTargetIndex,
            residualAtFrameEnd, polarity,
            FRAME_SECONDS - event.opticalTimeInFrame
         );
         bvec3 changed = notEqual(oldTargetIndex, newTargetIndex);
         if (all(changed)) {
            lightIntegral = splitIntegral;
         } else {
            vec3 singleState = panelState;
            vec3 singleIntegral = vec3(0.0);
            integrate_exposure_segment(
               singleState, singleIntegral, newTargetIndex,
               residualAtFrameEnd, polarity, FRAME_SECONDS
            );
            lightIntegral = vec3(
               changed.r ? splitIntegral.r : singleIntegral.r,
               changed.g ? splitIntegral.g : singleIntegral.g,
               changed.b ? splitIntegral.b : singleIntegral.b
            );
         }
      }
   }

   FragColor = vec4(
      clamp(lightIntegral / FRAME_SECONDS, 0.0, 1.0),
      endpoint.a
   );
}
