#version 450

#pragma format R32G32B32A32_SFLOAT

// Nintendo CGB-001 WS8 pass 1: fixed-angle D65 reflected-exposure integral.
// It evaluates the WS1 32^3 XYZ field at every two-point Gauss-Legendre node;
// averaging RGB state before color lookup is deliberately forbidden.
// Evidence: [CGB-HCS-REFLECTANCE-2026] [CGB-NIN-PROG-1999]
// [CGB-SHARP-HRTFT-1997] [CGB-TN-SEKIYA-2001]

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
layout(set = 0, binding = 4) uniform sampler2D Original;
layout(set = 0, binding = 5) uniform sampler2D OriginalHistory1;
layout(set = 0, binding = 6) uniform sampler2D CgbReferenceLut;
layout(set = 0, binding = 7) uniform sampler2D CgbReferenceLutLo;
layout(set = 0, binding = 8) uniform sampler2D CgbUpstreamLut;
layout(set = 0, binding = 9) uniform sampler2D CgbUpstreamLutLo;

float response_rate(float state, int targetCode)
{
   int fromCode = int(floor(clamp(state, 0.0, 1.0) * 31.0 + 0.5));
   float distance = abs(float(targetCode - fromCode)) / 31.0;
   float grayWeight = clamp(pow((1.0 - distance) / (30.0 / 31.0), 2.0), 0.0, 1.0);
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

vec3 state_at(vec3 start, ivec3 targetCode, vec3 rates, float seconds)
{
   vec3 target = cgb_command_coordinate(targetCode);
   if (params.TemporalResponse < 0.5)
      return target;
   return clamp(target + (start - target) * exp(-rates * max(seconds, 0.0)), 0.0, 1.0);
}

vec3 decode_packed_lut_texel(
   sampler2D highPlane,
   sampler2D lowPlane,
   ivec3 code,
   float scale
)
{
   ivec2 texelCoord = ivec2(
      code.b * CGB_LUT_TILE_STRIDE + CGB_LUT_TILE_PADDING + code.r,
      code.g
   );
   vec3 highBytes = floor(texelFetch(highPlane, texelCoord, 0).rgb * 255.0 + 0.5);
   vec3 lowBytes = floor(texelFetch(lowPlane, texelCoord, 0).rgb * 255.0 + 0.5);
   return (highBytes * 256.0 + lowBytes) * (scale / 65535.0);
}

vec3 sample_tiled_lut(
   sampler2D highPlane,
   sampler2D lowPlane,
   vec3 state,
   float scale
)
{
   vec3 coordinate = clamp(state, 0.0, 1.0) * 31.0;
   ivec3 lowCode = min(ivec3(floor(coordinate)), ivec3(30));
   vec3 amount = coordinate - vec3(lowCode);
   vec3 result = vec3(0.0);
   for (int corner = 0; corner < 8; corner++) {
      ivec3 bits = ivec3(corner & 1, (corner >> 1) & 1, (corner >> 2) & 1);
      vec3 factor = mix(vec3(1.0) - amount, amount, vec3(bits));
      result += decode_packed_lut_texel(highPlane, lowPlane, lowCode + bits, scale)
         * factor.r * factor.g * factor.b;
   }
   return result;
}

vec3 sample_color_lut(vec3 state)
{
   return params.ColorPolicy > 0.5
      ? sample_tiled_lut(CgbUpstreamLut, CgbUpstreamLutLo, state, CGB_UPSTREAM_LUT_SCALE)
      : sample_tiled_lut(CgbReferenceLut, CgbReferenceLutLo, state, CGB_REFERENCE_LUT_SCALE);
}

vec3 retention_bridge(vec3 state, float residual)
{
   float coupling = CGB_RETENTION_DIAGNOSTIC_OPTICAL_COUPLING
      * clamp(params.RetentionAmount, 0.0, 1.0);
   return clamp(state + vec3(coupling * residual), 0.0, 1.0);
}

void integrate_segment(
   inout vec3 integralXyz,
   vec3 start,
   ivec3 targetCode,
   vec3 rates,
   float seconds,
   float residual
)
{
   if (seconds <= 0.0)
      return;
   int panels = clamp(
      int(ceil(float(CGB_EXPOSURE_PANELS) * seconds / CGB_FRAME_SECONDS)),
      1,
      CGB_EXPOSURE_PANELS + 1
   );
   for (int panel = 0; panel < CGB_EXPOSURE_PANELS + 1; panel++) {
      if (panel >= panels)
         break;
      float center = (float(panel) + 0.5) / float(panels);
      float radius = CGB_GL2_NODE / float(panels);
      float t0 = seconds * (center - radius);
      float t1 = seconds * (center + radius);
      vec3 state0 = retention_bridge(state_at(start, targetCode, rates, t0), residual);
      vec3 state1 = retention_bridge(state_at(start, targetCode, rates, t1), residual);
      integralXyz += (sample_color_lut(state0) + sample_color_lut(state1))
         * (0.5 * seconds / float(panels));
   }
}

void main()
{
   ivec2 sourceSize = max(ivec2(global.OriginalSize.xy), ivec2(1));
   ivec2 sourceCoord = clamp(
      ivec2(floor(vTexCoord * global.OriginalSize.xy)),
      ivec2(0), sourceSize - ivec2(1)
   );
   ivec3 currentCode = cgb_rgb555_index(texelFetch(Original, sourceCoord, 0).rgb);

   if (params.ModelEnable < 0.5 || params.TemporalResponse < 0.5
       || global.TotalSubFrames != 1u) {
      FragColor = vec4(sample_color_lut(cgb_command_coordinate(currentCode)), 1.0);
      return;
   }

   vec4 feedback = texelFetch(PassFeedback0, sourceCoord, 0);
   if (feedback.a < 0.125) {
      FragColor = vec4(sample_color_lut(cgb_command_coordinate(currentCode)), 1.0);
      return;
   }

   vec3 start = clamp(feedback.rgb, 0.0, 1.0);
   float residual = cgb_decode_residual_dc(feedback.a);
   vec3 integralXyz = vec3(0.0);

   if (params.ScanEnabled < 0.5) {
      integrate_segment(
         integralXyz, start, currentCode, segment_rates(start, currentCode),
         CGB_FRAME_SECONDS, residual
      );
   } else {
      ivec3 previousCode = cgb_rgb555_index(
         texelFetch(OriginalHistory1, sourceCoord, 0).rgb
      );
      float activation = clamp(
         float(sourceCoord.y) * CGB_LINE_SECONDS
            + (CGB_LATCH_OFFSET_LINES + CGB_ROW_ACTIVATION_DELAY_LINES) * CGB_LINE_SECONDS,
         0.0,
         CGB_FRAME_SECONDS
      );
      if (all(equal(previousCode, currentCode))) {
         integrate_segment(
            integralXyz, start, currentCode, segment_rates(start, currentCode),
            CGB_FRAME_SECONDS, residual
         );
      } else {
         vec3 rates0 = segment_rates(start, previousCode);
         vec3 split = state_at(start, previousCode, rates0, activation);
         vec3 candidateRates1 = segment_rates(split, currentCode);
         bvec3 changed = notEqual(previousCode, currentCode);
         vec3 rates1 = vec3(
            changed.r ? candidateRates1.r : rates0.r,
            changed.g ? candidateRates1.g : rates0.g,
            changed.b ? candidateRates1.b : rates0.b
         );
         integrate_segment(integralXyz, start, previousCode, rates0, activation, residual);
         integrate_segment(
            integralXyz, split, currentCode, rates1,
            CGB_FRAME_SECONDS - activation, residual
         );
      }
   }

   FragColor = vec4(integralXyz / CGB_FRAME_SECONDS, 1.0);
}
