#version 450

#pragma format R32G32B32A32_SFLOAT

// Nintendo CGB-001 WS8 pass 0: persistent HR-TFT command state and the
// independent residual-DC scalar. RGB is a continuous command coordinate,
// never final color. Alpha encodes the WS7 state around 0.5.
// Evidence: [CGB-NIN-PROG-1999] [CGB-SHARP-HRTFT-1997]
// [CGB-VCOM-LEE-2008] [CGB-MIZUSAKI-2011] [CGB-DRIVE-RECON-2026]

#include "cgb001-common.inc"
#include "cgb001-runtime-v1.inc"

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
layout(set = 0, binding = 3) uniform sampler2D PassFeedback0;
layout(set = 0, binding = 4) uniform sampler2D OriginalHistory1;

float response_rate(float state, int targetCode)
{
   int fromCode = int(floor(clamp(state, 0.0, 1.0) * 31.0 + 0.5));
   float distance = abs(float(targetCode - fromCode)) / 31.0;
   float grayWeight = clamp(
      pow((1.0 - distance) / (30.0 / 31.0), 2.0),
      0.0,
      1.0
   );
   int member = int(floor(clamp(params.ResponseEnsemble, 0.0, 2.0) + 0.5));
   float onOffMs = member == 0
      ? CGB_RESPONSE_FAST_ON_OFF_MS
      : (member == 2 ? CGB_RESPONSE_SLOW_ON_OFF_MS : CGB_RESPONSE_NOMINAL_ON_OFF_MS);
   float grayMs = member == 0
      ? CGB_RESPONSE_FAST_GRAY_MS
      : (member == 2 ? CGB_RESPONSE_SLOW_GRAY_MS : CGB_RESPONSE_NOMINAL_GRAY_MS);
   return CGB_LN9 / (0.001 * mix(onOffMs, grayMs, grayWeight));
}

vec3 segment_rates(vec3 state, ivec3 target)
{
   return vec3(
      response_rate(state.r, target.r),
      response_rate(state.g, target.g),
      response_rate(state.b, target.b)
   );
}

vec3 step_response(vec3 state, ivec3 targetCode, vec3 rates, float seconds)
{
   vec3 target = cgb_command_coordinate(targetCode);
   if (params.TemporalResponse < 0.5)
      return target;
   vec3 nextState = target + (state - target) * exp(-rates * max(seconds, 0.0));
   bvec3 snap = lessThanEqual(abs(nextState - target), vec3(CGB_RESPONSE_SNAP_EPSILON));
   return clamp(vec3(
      snap.r ? target.r : nextState.r,
      snap.g ? target.g : nextState.g,
      snap.b ? target.b : nextState.b
   ), 0.0, 1.0);
}

float inversion_spatial_phase(ivec2 sourceCoord, int topology)
{
   if (topology == 2)
      return float(sourceCoord.y & 1);
   if (topology == 3)
      return float(sourceCoord.x & 1);
   if (topology == 4)
      return float((sourceCoord.x + sourceCoord.y) & 1);
   return 0.0;
}

float drive_polarity(ivec2 sourceCoord)
{
   int topology = CGB_INVERSION_TOPOLOGY;
   if (topology == 0)
      return 1.0;
   uint spatial = uint(inversion_spatial_phase(sourceCoord, topology));
   return ((global.FrameCount + CGB_PARITY_PHASE + spatial) & 1u) == 0u ? 1.0 : -1.0;
}

float retention_excitation(ivec3 sourceCode, float polarity)
{
   float codeProxy = float(sourceCode.r + sourceCode.g + sourceCode.b) / (3.0 * 31.0);
   float diagnosticOffset = CGB_RETENTION_DIAGNOSTIC_DC_OFFSET
      * clamp(params.RetentionAmount, 0.0, 1.0);
   return clamp(diagnosticOffset * (
      1.0 + CGB_RETENTION_CODE_WEIGHT * (2.0 * codeProxy - 1.0)
      + CGB_RETENTION_POLARITY_WEIGHT * polarity
   ), -1.0, 1.0);
}

float step_retention(float state, ivec3 sourceCode, float polarity, float seconds)
{
   if (params.RetentionAmount <= 0.0)
      return 0.0;
   float excitation = retention_excitation(sourceCode, polarity);
   if (abs(excitation) <= 1e-8)
      return clamp(state * exp(-CGB_RETENTION_DESORPTION_RATE * seconds), -1.0, 1.0);
   float rate = CGB_RETENTION_ADSORPTION_RATE + CGB_RETENTION_DESORPTION_RATE;
   float equilibrium = CGB_RETENTION_ADSORPTION_RATE * excitation / rate;
   return clamp(equilibrium + (state - equilibrium) * exp(-rate * seconds), -1.0, 1.0);
}

void main()
{
   ivec2 sourceSize = max(ivec2(global.OriginalSize.xy), ivec2(1));
   ivec2 sourceCoord = clamp(
      ivec2(floor(vTexCoord * global.OriginalSize.xy)),
      ivec2(0), sourceSize - ivec2(1)
   );
   ivec3 currentCode = cgb_rgb555_index(texelFetch(Source, sourceCoord, 0).rgb);
   vec3 currentTarget = cgb_command_coordinate(currentCode);

   if (params.ModelEnable < 0.5 || global.TotalSubFrames != 1u) {
      FragColor = vec4(currentTarget, cgb_encode_residual_dc(0.0));
      return;
   }

   vec4 feedback = texelFetch(PassFeedback0, sourceCoord, 0);
   if (feedback.a < 0.125) {
      FragColor = vec4(currentTarget, cgb_encode_residual_dc(0.0));
      return;
   }

   vec3 state = clamp(feedback.rgb, 0.0, 1.0);
   float residual = cgb_decode_residual_dc(feedback.a);
   float polarity = drive_polarity(sourceCoord);
   ivec3 previousCode = cgb_rgb555_index(
      texelFetch(OriginalHistory1, sourceCoord, 0).rgb
   );

   if (params.ScanEnabled < 0.5) {
      state = step_response(state, currentCode, segment_rates(state, currentCode), CGB_FRAME_SECONDS);
      residual = step_retention(residual, currentCode, polarity, CGB_FRAME_SECONDS);
   } else {
      float rowStart = float(sourceCoord.y) * CGB_LINE_SECONDS;
      float latch = clamp(
         rowStart + CGB_LATCH_OFFSET_LINES * CGB_LINE_SECONDS,
         0.0, CGB_FRAME_SECONDS
      );
      float activation = clamp(
         latch + CGB_ROW_ACTIVATION_DELAY_LINES * CGB_LINE_SECONDS,
         0.0, CGB_FRAME_SECONDS
      );

      residual = step_retention(residual, previousCode, polarity, latch);
      residual = step_retention(residual, currentCode, polarity, CGB_FRAME_SECONDS - latch);

      if (all(equal(previousCode, currentCode))) {
         state = step_response(state, currentCode, segment_rates(state, currentCode), CGB_FRAME_SECONDS);
      } else {
         vec3 splitState = step_response(
            state, previousCode, segment_rates(state, previousCode), activation
         );
         splitState = step_response(
            splitState, currentCode, segment_rates(splitState, currentCode),
            CGB_FRAME_SECONDS - activation
         );

         // An unchanged channel keeps one full-frame segment; an unrelated
         // channel transition must not create an artificial rate boundary.
         vec3 singleState = step_response(
            state, currentCode, segment_rates(state, currentCode), CGB_FRAME_SECONDS
         );
         bvec3 changed = notEqual(previousCode, currentCode);
         state = vec3(
            changed.r ? splitState.r : singleState.r,
            changed.g ? splitState.g : singleState.g,
            changed.b ? splitState.b : singleState.b
         );
      }
   }

   FragColor = vec4(state, cgb_encode_residual_dc(residual));
}

