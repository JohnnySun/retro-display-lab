#version 450

#pragma format R32G32B32A32_SFLOAT

// Retro Display Lab AGS-101 candidate model, scanout-aware pass 0.
// Permanent feedback is the optical/residual-DC state at frame boundaries.
// Row start, electrical latch, and optical response onset are separate events.
// Optical events that cross a frame boundary use causal source history.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-COLOR-01] [AGS-GTG-01] [AGS-GTGDATA-01] [AGS-ION-01] [AGS-DRIVE-01] [AGS-FEED-01] [AGS-RETENTION-01] [AGS-FRONTEND-01] [AGS-NEUTRAL-01] [AGS-TIMING-01] [AGS-RECON-01]

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
#pragma parameter LatchOffsetLines "AGS latch offset candidate (lines)" 0.0 0.0 1.0 0.05
#pragma parameter OpticalDelaySeconds "AGS pure-delay candidate (s)" 0.000000 0.000000 0.016743 0.000050
#pragma parameter ParityPhase "AGS polarity-phase hypothesis" 0.0 0.0 1.0 1.0
#pragma parameter InversionTopology "AGS inversion hypothesis (frame/row/column/dot)" 1.0 0.0 3.0 1.0

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
layout(set = 0, binding = 4) uniform sampler2D OriginalHistory1;
layout(set = 0, binding = 5) uniform sampler2D OriginalHistory2;
layout(set = 0, binding = 6) uniform sampler2D GtgRateLut;

#include "ags101-ws3-timing.inc"

float srgb_decode_channel(float encoded)
{
   return encoded <= 0.04045
      ? encoded / 12.92
      : pow((encoded + 0.055) / 1.055, 2.4);
}

vec3 srgb_decode(vec3 encoded)
{
   return vec3(
      srgb_decode_channel(encoded.r),
      srgb_decode_channel(encoded.g),
      srgb_decode_channel(encoded.b)
   );
}

ivec3 rgb555_index(vec3 encoded)
{
   return clamp(
      ivec3(floor(clamp(encoded, 0.0, 1.0) * 31.0 + 0.5)),
      ivec3(0),
      ivec3(31)
   );
}

vec3 neutral_eotf(ivec3 index)
{
   return srgb_decode(vec3(index) / 31.0);
}

// BEGIN GENERATED HCS COLOR: RESPONSE
// Generated from AGS-COLOR-01 by tools/build-ags101-hcs-color.mjs.
const vec3 HCS_RGB555_EOTF[32] = vec3[](
   vec3(0.000000000000, 0.000000000000, 0.000000000000),
   vec3(0.000713225441, 0.000745786518, 0.001088088736),
   vec3(0.001916340743, 0.001974996734, 0.002882917113),
   vec3(0.003446864521, 0.003495502817, 0.005162829820),
   vec3(0.006205162716, 0.006385624816, 0.009461267578),
   vec3(0.011300394859, 0.011592766877, 0.017130061577),
   vec3(0.019808585349, 0.020369390711, 0.030110788205),
   vec3(0.031530403765, 0.032725487404, 0.048113661659),
   vec3(0.046955069311, 0.048902452190, 0.071554176316),
   vec3(0.060284037627, 0.062795318180, 0.091569030607),
   vec3(0.076148400401, 0.079313991388, 0.115342809712),
   vec3(0.097480924088, 0.101922086295, 0.146321279080),
   vec3(0.117188330834, 0.122069770398, 0.174913978213),
   vec3(0.132242210754, 0.138355317297, 0.196720800513),
   vec3(0.153806516120, 0.160935944655, 0.227420544422),
   vec3(0.174112035612, 0.182127514167, 0.256184390510),
   vec3(0.195602633905, 0.205007080081, 0.286113718972),
   vec3(0.223234708701, 0.233242856930, 0.323792456103),
   vec3(0.245707104853, 0.256768024034, 0.353477180304),
   vec3(0.270737865183, 0.283487661106, 0.385147272777),
   vec3(0.302402095085, 0.315120005457, 0.424337289917),
   vec3(0.343725333227, 0.358072932970, 0.477121999403),
   vec3(0.381357625152, 0.398197702622, 0.521392541475),
   vec3(0.436131921921, 0.455422816343, 0.588883703792),
   vec3(0.484419837432, 0.505055893531, 0.640616637116),
   vec3(0.547897787392, 0.569528484618, 0.706671212868),
   vec3(0.596026386208, 0.616823929811, 0.745078956012),
   vec3(0.662897164396, 0.684393195616, 0.805681215174),
   vec3(0.749498942051, 0.766861347259, 0.868781448074),
   vec3(0.848803644046, 0.861693924050, 0.928398526993),
   vec3(0.937323214375, 0.947520725183, 0.971652863511),
   vec3(1.000000000000, 1.000000000000, 1.000000000000)
);
// END GENERATED HCS COLOR: RESPONSE

vec3 hcs_measured_eotf(ivec3 index)
{
   return vec3(
      HCS_RGB555_EOTF[index.r].r,
      HCS_RGB555_EOTF[index.g].g,
      HCS_RGB555_EOTF[index.b].b
   );
}

vec3 source_eotf(ivec3 index)
{
   return params.HcsMeasuredColor > 0.5
      ? hcs_measured_eotf(index)
      : neutral_eotf(index);
}

float source_eotf_channel(int index, int channel)
{
   return params.HcsMeasuredColor > 0.5
      ? HCS_RGB555_EOTF[index][channel]
      : srgb_decode_channel(float(index) / 31.0);
}

vec3 hcs_measured_eotf_continuous(vec3 code)
{
   vec3 scaled = clamp(code, 0.0, 1.0) * 31.0;
   ivec3 low = ivec3(floor(scaled));
   ivec3 high = min(low + ivec3(1), ivec3(31));
   vec3 fraction = scaled - vec3(low);
   vec3 lowValue = vec3(
      HCS_RGB555_EOTF[low.r].r,
      HCS_RGB555_EOTF[low.g].g,
      HCS_RGB555_EOTF[low.b].b
   );
   vec3 highValue = vec3(
      HCS_RGB555_EOTF[high.r].r,
      HCS_RGB555_EOTF[high.g].g,
      HCS_RGB555_EOTF[high.b].b
   );
   return mix(lowValue, highValue, fraction);
}

vec3 source_eotf_continuous(vec3 code)
{
   return params.HcsMeasuredColor > 0.5
      ? hcs_measured_eotf_continuous(code)
      : srgb_decode(clamp(code, 0.0, 1.0));
}

float optical_channel_to_code(float optical, int channel)
{
   float value = clamp(optical, 0.0, 1.0);
   int highIndex = 31;
   int lowIndex = 0;

   // The 32-entry EOTF is monotone. Find the first entry at or above the
   // optical value in five fixed steps instead of walking as many as 31
   // intervals for every channel and every temporal segment.
   for (int stepIndex = 0; stepIndex < 5; stepIndex++) {
      int midpoint = (lowIndex + highIndex) / 2;
      if (value <= source_eotf_channel(midpoint, channel))
         highIndex = midpoint;
      else
         lowIndex = midpoint + 1;
   }

   int lowerIndex = max(highIndex - 1, 0);
   float lowValue = source_eotf_channel(lowerIndex, channel);
   float highValue = source_eotf_channel(highIndex, channel);
   return float(lowerIndex) + clamp(
      (value - lowValue) / max(highValue - lowValue, 1e-8),
      0.0,
      1.0
   );
}

vec3 optical_to_code(vec3 optical)
{
   return vec3(
      optical_channel_to_code(optical.r, 0),
      optical_channel_to_code(optical.g, 1),
      optical_channel_to_code(optical.b, 2)
   );
}

vec3 analytic_gtg_rate(vec3 fromCode, vec3 toCode)
{
   vec3 fromNormalized = clamp(fromCode, 0.0, 31.0) / 31.0;
   vec3 toNormalized = clamp(toCode, 0.0, 31.0) / 31.0;
   vec3 distance = abs(toNormalized - fromNormalized);
   vec3 movingUp = step(fromNormalized, toNormalized);
   vec3 base = mix(
      vec3(clamp(params.FallBase, 0.1, 1.0)),
      vec3(clamp(params.RiseBase, 0.1, 1.0)),
      movingUp
   );

   vec3 nearWeight = pow(vec3(1.0) - distance, vec3(2.0));
   vec3 midpoint = 0.5 * (fromNormalized + toNormalized);
   vec3 middleWeight = 4.0 * midpoint * (vec3(1.0) - midpoint) * nearWeight;
   vec3 frameAlpha = base
      * (vec3(1.0) - clamp(params.NearTransitionDrag, 0.0, 0.7) * nearWeight)
      * (vec3(1.0) - clamp(params.MidGrayDrag, 0.0, 0.5) * middleWeight);
   frameAlpha = clamp(frameAlpha, 0.025, 1.0 - 1e-7);
   return -log(vec3(1.0) - frameAlpha) / FRAME_SECONDS;
}

float decode_table_rate(vec3 packed, out bool available)
{
   vec3 bytes = floor(packed * 255.0 + 0.5);
   available = bytes.b >= 128.0;
   float encoded = bytes.r * 256.0 + bytes.g;
   return exp2(10.0 * encoded / 65535.0);
}

float table_rate_channel(float fromCode, int toCode, int channel, out bool available)
{
   float fromValue = clamp(fromCode, 0.0, 31.0);
   int from0 = int(floor(fromValue));
   int from1 = min(from0 + 1, 31);
   int to0 = clamp(toCode, 0, 31);
   int to1 = min(to0 + 1, 31);
   int channelRow = channel * 32;
   bool available00;
   bool available10;
   vec3 packed00 = texelFetch(GtgRateLut, ivec2(to0, channelRow + from0), 0).rgb;
   vec3 packed01 = texelFetch(GtgRateLut, ivec2(to1, channelRow + from0), 0).rgb;
   vec3 packed10 = texelFetch(GtgRateLut, ivec2(to0, channelRow + from1), 0).rgb;
   vec3 packed11 = texelFetch(GtgRateLut, ivec2(to1, channelRow + from1), 0).rgb;
   float rate00 = decode_table_rate(
      packed00,
      available00
   );
   float rate10 = decode_table_rate(
      packed10,
      available10
   );
   bool available01 = floor(packed01.b * 255.0 + 0.5) >= 128.0;
   bool available11 = floor(packed11.b * 255.0 + 0.5) >= 128.0;
   available = available00 && available01 && available10 && available11;
   float fromFraction = fromValue - float(from0);
   return mix(rate00, rate10, fromFraction);
}

vec3 gtg_rate(vec3 fromCode, ivec3 toCode)
{
   if (params.GtgTableBackend < 0.5)
      return analytic_gtg_rate(fromCode, vec3(toCode));

   bool redAvailable;
   bool greenAvailable;
   bool blueAvailable;
   vec3 tableRate = vec3(
      table_rate_channel(fromCode.r, toCode.r, 0, redAvailable),
      table_rate_channel(fromCode.g, toCode.g, 1, greenAvailable),
      table_rate_channel(fromCode.b, toCode.b, 2, blueAvailable)
   );
   if (redAvailable && greenAvailable && blueAvailable)
      return tableRate;

   vec3 analyticRate = analytic_gtg_rate(fromCode, vec3(toCode));
   return vec3(
      redAvailable ? tableRate.r : analyticRate.r,
      greenAvailable ? tableRate.g : analyticRate.g,
      blueAvailable ? tableRate.b : analyticRate.b
   );
}

float encode_residual_dc(float state)
{
   return 0.5 + 0.25 * clamp(state, -1.0, 1.0);
}

float decode_residual_dc(float encoded)
{
   return clamp((encoded - 0.5) * 4.0, -1.0, 1.0);
}

vec3 response_for_time(vec3 ratePerSecond, float dtSeconds)
{
   // Continuous first-order rate: exact for any equivalent time partition
   // while one rate-field cell and target remain selected.
   return vec3(1.0) - exp(-max(ratePerSecond, vec3(0.0)) * max(dtSeconds, 0.0));
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

void integrate_optical_segment(
   inout vec3 panelState,
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
   vec3 fromCode = optical_to_code(panelState);
   vec3 response = params.TemporalResponse > 0.5
      ? response_for_time(
         gtg_rate(fromCode, targetIndex),
         dtSeconds
      )
      : vec3(1.0);
   panelState += (effectiveTarget - panelState) * response;
   panelState = clamp(panelState, 0.0, 1.0);
}

void integrate_segment(
   inout vec3 panelState,
   inout float residualDc,
   ivec3 targetIndex,
   float polarity,
   float dtSeconds)
{
   integrate_residual_segment(residualDc, targetIndex, polarity, dtSeconds);
   integrate_optical_segment(
      panelState, targetIndex, residualDc, polarity, dtSeconds
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
   float oldSeconds = min(boundedEnd, boundedLatch);
   float newSeconds = max(boundedEnd - boundedLatch, 0.0);
   integrate_residual_segment(state, oldTargetIndex, polarity, oldSeconds);
   integrate_residual_segment(state, newTargetIndex, polarity, newSeconds);
   return state;
}

void main()
{
   ivec2 sourceLimit = max(ivec2(global.OriginalSize.xy) - ivec2(1), ivec2(0));
   ivec2 sourceCoord = clamp(
      ivec2(floor(vTexCoord * global.OriginalSize.xy)),
      ivec2(0),
      sourceLimit
   );
   ivec3 currentTargetIndex = rgb555_index(texelFetch(Source, sourceCoord, 0).rgb);

   // This candidate intentionally supports one shader execution per content
   // frame. On an unsupported subframe configuration, bypass temporal state
   // rather than silently integrating a complete frame N times.
   if (global.TotalSubFrames != 1u) {
      FragColor = vec4(
         source_eotf(currentTargetIndex), encode_residual_dc(0.0)
      );
      return;
   }

   vec4 feedback = texelFetch(PassFeedback0, sourceCoord, 0);

   if (feedback.a < 0.125) {
      FragColor = vec4(
         source_eotf(currentTargetIndex), encode_residual_dc(0.0)
      );
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

   if (params.BakedScanout < 0.5) {
      integrate_segment(
         panelState, residualDc, currentTargetIndex, polarity, FRAME_SECONDS
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
         // The current frame's optical event has not happened yet. Apply the
         // delayed transition submitted one source frame earlier. Negative
         // history is transparent black by the Slang contract; fall back to
         // history1 during startup rather than inventing an older target.
         newTargetIndex = previousTargetIndex;
         oldTargetIndex = previousSource.a > 0.5 && olderSource.a > 0.5
            ? rgb555_index(olderSource.rgb)
            : newTargetIndex;
      }

      // Electrical retention follows the source command at the WS3 latch,
      // independently from the later (and possibly wrapped) optical event.
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

      // Avoid changing the optical numerical partition when no target changed.
      if (all(equal(oldTargetIndex, newTargetIndex))) {
         integrate_optical_segment(
            panelState, newTargetIndex, residualAtFrameEnd, polarity, FRAME_SECONDS
         );
         residualDc = residualAtFrameEnd;
      } else {
         float firstDt = event.opticalTimeInFrame;
         float secondDt = FRAME_SECONDS - firstDt;

         // Changed subpixels take two piecewise closed-form updates. Unchanged
         // subpixels take one full-frame optical update so the row latch does
         // not introduce an artificial GtG re-quantization boundary.
         vec3 splitPanelState = panelState;
         integrate_optical_segment(
            splitPanelState,
            oldTargetIndex,
            residualAtOptical,
            polarity,
            firstDt
         );
         integrate_optical_segment(
            splitPanelState,
            newTargetIndex,
            residualAtFrameEnd,
            polarity,
            secondDt
         );
         bvec3 changed = notEqual(oldTargetIndex, newTargetIndex);
         if (all(changed)) {
            panelState = splitPanelState;
         } else {
            vec3 singlePanelState = panelState;
            integrate_optical_segment(
               singlePanelState,
               newTargetIndex,
               residualAtFrameEnd,
               polarity,
               FRAME_SECONDS
            );
            panelState = vec3(
               changed.r ? splitPanelState.r : singlePanelState.r,
               changed.g ? splitPanelState.g : singlePanelState.g,
               changed.b ? splitPanelState.b : singlePanelState.b
            );
         }
         residualDc = residualAtFrameEnd;
      }
   }

   FragColor = vec4(panelState, encode_residual_dc(residualDc));
}
