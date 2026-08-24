#version 450

// Nintendo CGB-001 WS8/WS9 pass 2: XYZ-to-host presentation and analytic
// full-coverage equal-third RGB aperture. No MRS, gap, lens, glare, viewing
// angle, or target-device compensation is invented here.
// Evidence: [CGB-HCS-REFLECTANCE-2026] [CGB-GBCC-SUBPIXEL]
// [CGB-BGB-REALITY] [CGB-SHARP-HRTFT-1997]

#include "cgb001-common.inc"
#include "cgb001-runtime-v1.inc"

layout(std140, set = 0, binding = 0) uniform UBO
{
   mat4 MVP;
   vec4 OutputSize;
   vec4 OriginalSize;
   vec4 SourceSize;
   uint FrameCount;
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
layout(set = 0, binding = 4) uniform sampler2D PassOutput0;
layout(set = 0, binding = 5) uniform sampler2D CgbReferenceLut;
layout(set = 0, binding = 6) uniform sampler2D CgbReferenceLutLo;
layout(set = 0, binding = 7) uniform sampler2D CgbUpstreamLut;
layout(set = 0, binding = 8) uniform sampler2D CgbUpstreamLutLo;

ivec2 bounded_source_coord(ivec2 coord)
{
   return clamp(coord, ivec2(0), textureSize(Source, 0) - ivec2(1));
}

ivec2 original_coord(vec2 coord)
{
   return clamp(
      ivec2(floor(coord * global.OriginalSize.xy)),
      ivec2(0), max(ivec2(global.OriginalSize.xy) - ivec2(1), ivec2(0))
   );
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

vec3 selected_lut(vec3 state)
{
   return params.ColorPolicy > 0.5
      ? sample_tiled_lut(CgbUpstreamLut, CgbUpstreamLutLo, state, CGB_UPSTREAM_LUT_SCALE)
      : sample_tiled_lut(CgbReferenceLut, CgbReferenceLutLo, state, CGB_REFERENCE_LUT_SCALE);
}

float interval_overlap(float low, float high, float intervalLow, float intervalHigh)
{
   return max(0.0, min(high, intervalHigh) - max(low, intervalLow));
}

vec3 aperture_linear_rgb(vec2 coord, out vec3 uniformCoverage)
{
   float sourceCenter = coord.x * global.SourceSize.x - 0.5;
   float footprint = global.SourceSize.x / global.OutputSize.x;
   float low = sourceCenter - 0.5 * footprint;
   float high = sourceCenter + 0.5 * footprint;
   int firstPixel = int(floor(low));
   vec3 outputColor = vec3(0.0);
   uniformCoverage = vec3(0.0);

   // WS6 release scales keep one host footprint below one source pixel. Three
   // fixed candidates cover the boundary case without derivative sampling.
   for (int candidate = 0; candidate < 3; candidate++) {
      int pixel = firstPixel + candidate;
      float localLow = max(low - float(pixel), 0.0);
      float localHigh = min(high - float(pixel), 1.0);
      if (localHigh <= localLow)
         continue;
      vec3 coverage = vec3(
         interval_overlap(localLow, localHigh, 0.0, 1.0 / 3.0),
         interval_overlap(localLow, localHigh, 1.0 / 3.0, 2.0 / 3.0),
         interval_overlap(localLow, localHigh, 2.0 / 3.0, 1.0)
      ) / footprint;
      ivec2 sourceCoord = bounded_source_coord(ivec2(pixel, original_coord(coord).y));
      vec3 linearRgb = cgb_xyz_to_linear_srgb(texelFetch(Source, sourceCoord, 0).rgb);
      outputColor += 3.0 * coverage * linearRgb;
      uniformCoverage += 3.0 * coverage;
   }
   return outputColor;
}

vec3 signed_state_color(float value)
{
   float state = clamp(value, -1.0, 1.0);
   vec3 neutral = vec3(0.18);
   return state < 0.0
      ? mix(neutral, vec3(0.05, 0.75, 1.0), -state)
      : mix(neutral, vec3(1.0, 0.20, 0.05), state);
}

// WS9 numeric diagnostics use 32 horizontal source pixels as IEEE-754 bit
// positions and nine 2-row bands per 32x18 source-pixel tile.  The final pass
// emits only exact black/white, so an ordinary compositor screenshot can
// reconstruct the float32 words without treating RGB8 as a numeric readback.
const int CGB_READBACK_TILE_WIDTH = 32;
const int CGB_READBACK_BAND_HEIGHT = 2;
const int CGB_READBACK_BANDS = 9;
const int CGB_READBACK_TILE_HEIGHT = CGB_READBACK_BAND_HEIGHT * CGB_READBACK_BANDS;

float word_bit(uint word, int bit)
{
   return float((word >> uint(bit)) & 1u);
}

uint packed_rgb555(ivec3 code)
{
   return uint(code.r | (code.g << 5) | (code.b << 10));
}

vec4 readback_word(uint word, ivec2 coord)
{
   float value = word_bit(word, coord.x & 31);
   return vec4(vec3(value), 1.0);
}

int readback_band(ivec2 coord)
{
   return (coord.y % CGB_READBACK_TILE_HEIGHT) / CGB_READBACK_BAND_HEIGHT;
}

int readback_slot(ivec2 coord)
{
   return (coord.y / CGB_READBACK_TILE_HEIGHT) * 5
      + coord.x / CGB_READBACK_TILE_WIDTH;
}

ivec2 readback_probe(ivec2 coord)
{
   return clamp(
      ivec2(
         (coord.x / CGB_READBACK_TILE_WIDTH) * CGB_READBACK_TILE_WIDTH,
         (coord.y / CGB_READBACK_TILE_HEIGHT) * CGB_READBACK_TILE_HEIGHT
      ),
      ivec2(0), textureSize(Source, 0) - ivec2(1)
   );
}

vec3 aperture_coverage_for_source_center(float sourceCenter)
{
   float footprint = global.SourceSize.x / global.OutputSize.x;
   float low = sourceCenter - 0.5 * footprint;
   float high = sourceCenter + 0.5 * footprint;
   int firstPixel = int(floor(low));
   vec3 coverageSum = vec3(0.0);
   for (int candidate = 0; candidate < 3; candidate++) {
      int pixel = firstPixel + candidate;
      float localLow = max(low - float(pixel), 0.0);
      float localHigh = min(high - float(pixel), 1.0);
      if (localHigh <= localLow)
         continue;
      coverageSum += vec3(
         interval_overlap(localLow, localHigh, 0.0, 1.0 / 3.0),
         interval_overlap(localLow, localHigh, 1.0 / 3.0, 2.0 / 3.0),
         interval_overlap(localLow, localHigh, 2.0 / 3.0, 1.0)
      ) / footprint;
   }
   return 3.0 * coverageSum;
}

void main()
{
   ivec2 coord = original_coord(vTexCoord);
   ivec3 sourceCode = cgb_rgb555_index(texelFetch(Original, coord, 0).rgb);
   vec4 response = texelFetch(PassOutput0, coord, 0);
   int debugView = int(floor(clamp(params.DebugView, 0.0, 11.0) + 0.5));

   if (debugView >= 8) {
      int band = readback_band(coord);
      int slot = readback_slot(coord);
      ivec2 probe = readback_probe(coord);
      ivec3 probeCode = cgb_rgb555_index(texelFetch(Original, probe, 0).rgb);
      uint word = 0u;

      if (debugView == 8) {
         vec4 probeResponse = texelFetch(PassOutput0, probe, 0);
         if (band == 0) word = floatBitsToUint(probeResponse.r);
         else if (band == 1) word = floatBitsToUint(probeResponse.g);
         else if (band == 2) word = floatBitsToUint(probeResponse.b);
         else if (band == 3) word = floatBitsToUint(cgb_decode_residual_dc(probeResponse.a));
         else if (band == 4) word = packed_rgb555(probeCode);
         else if (band == 5) word = global.FrameCount;
         else if (band == 6) word = 0x43474238u; // "CGB8"
      } else if (debugView == 9) {
         vec3 probeXyz = texelFetch(Source, probe, 0).rgb;
         vec3 probeResponse = texelFetch(PassOutput0, probe, 0).rgb;
         if (band == 0) word = floatBitsToUint(probeXyz.r);
         else if (band == 1) word = floatBitsToUint(probeXyz.g);
         else if (band == 2) word = floatBitsToUint(probeXyz.b);
         else if (band == 3) word = floatBitsToUint(probeResponse.r);
         else if (band == 4) word = floatBitsToUint(probeResponse.g);
         else if (band == 5) word = floatBitsToUint(probeResponse.b);
         else if (band == 6) word = packed_rgb555(probeCode);
         else if (band == 7) word = global.FrameCount;
         else word = 0x43474239u; // "CGB9"
      } else if (debugView == 10) {
         // The exhaustive transport ROM exposes the current R/G pair at the
         // upper-left source pixel.  Thirty-two slots synthesize B=0..31 and
         // therefore expose all RGB555 LUT texels in one core frame.
         ivec3 frameCode = cgb_rgb555_index(texelFetch(Original, ivec2(0), 0).rgb);
         ivec3 lutCode = ivec3(frameCode.rg, clamp(slot, 0, 31));
         vec3 probeXyz = selected_lut(cgb_command_coordinate(lutCode));
         if (band == 0) word = floatBitsToUint(probeXyz.r);
         else if (band == 1) word = floatBitsToUint(probeXyz.g);
         else if (band == 2) word = floatBitsToUint(probeXyz.b);
         else if (band == 3) word = packed_rgb555(lutCode);
         else if (band == 4) word = global.FrameCount;
         else word = slot < 32 ? 0x43474241u : 0u; // "CGBA"
      } else {
         float scaleX = global.OutputSize.x / global.SourceSize.x;
         int phase = slot & 7;
         float hostIndex = floor(scaleX * 80.0) + float(phase);
         float sourceCenter = (hostIndex + 0.5) / scaleX - 0.5;
         vec3 coverage = aperture_coverage_for_source_center(sourceCenter);
         if (band == 0) word = floatBitsToUint(coverage.r);
         else if (band == 1) word = floatBitsToUint(coverage.g);
         else if (band == 2) word = floatBitsToUint(coverage.b);
         else if (band == 3) word = floatBitsToUint(scaleX);
         else if (band == 4) word = uint(global.OutputSize.x + 0.5);
         else word = uint(global.SourceSize.x + 0.5);
      }
      FragColor = readback_word(word, coord);
      return;
   }

   if (debugView == 1) {
      FragColor = vec4(vec3(sourceCode) / 31.0, 1.0);
      return;
   }
   if (debugView == 2) {
      float activation = clamp(
         float(coord.y) * CGB_LINE_SECONDS
            + (CGB_LATCH_OFFSET_LINES + CGB_ROW_ACTIVATION_DELAY_LINES) * CGB_LINE_SECONDS,
         0.0, CGB_FRAME_SECONDS
      );
      float marker = abs(vTexCoord.x - activation / CGB_FRAME_SECONDS)
         <= 1.5 / global.OutputSize.x ? 1.0 : 0.0;
      FragColor = vec4(max(vec3(0.04), marker * vec3(0.1, 0.8, 1.0)), 1.0);
      return;
   }
   if (debugView == 3) {
      FragColor = vec4(clamp(response.rgb, 0.0, 1.0), 1.0);
      return;
   }
   if (debugView == 4) {
      vec3 linear = cgb_xyz_to_linear_srgb(texelFetch(Source, coord, 0).rgb);
      FragColor = vec4(clamp(cgb_srgb_encode(max(linear, vec3(0.0))), 0.0, 1.0), 1.0);
      return;
   }
   if (debugView == 5) {
      vec3 xyz = selected_lut(cgb_command_coordinate(sourceCode));
      vec3 linear = cgb_xyz_to_linear_srgb(xyz);
      FragColor = vec4(clamp(cgb_srgb_encode(max(linear, vec3(0.0))), 0.0, 1.0), 1.0);
      return;
   }
   if (debugView == 6) {
      FragColor = vec4(signed_state_color(cgb_decode_residual_dc(response.a)), 1.0);
      return;
   }
   if (debugView == 7) {
      vec3 coverage;
      aperture_linear_rgb(vTexCoord, coverage);
      FragColor = vec4(clamp(cgb_srgb_encode(0.25 * coverage), 0.0, 1.0), 1.0);
      return;
   }

   if (params.ModelEnable < 0.5) {
      FragColor = texelFetch(Original, coord, 0);
      return;
   }

   vec3 directLinear = cgb_xyz_to_linear_srgb(texture(Source, vTexCoord).rgb);
   vec3 coverage;
   vec3 apertureLinear = aperture_linear_rgb(vTexCoord, coverage);
   vec3 panelLinear = mix(
      directLinear,
      apertureLinear,
      clamp(params.ApertureAmount, 0.0, 1.0)
   ) * max(params.ModelExposure, 0.0);
   FragColor = vec4(
      clamp(cgb_srgb_encode(max(panelLinear, vec3(0.0))), 0.0, 1.0),
      1.0
   );
}
