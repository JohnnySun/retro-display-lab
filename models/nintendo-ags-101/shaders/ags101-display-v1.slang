#version 450

// Retro Display Lab AGS-101 candidate model, pass 1.
// Analytic BGR aperture integration and neutral sRGB host rendering.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-APERTURE-01] [AGS-NEUTRAL-01]
//
// Special thanks: cgwg and Libretro lcd-grid-v2 for the published analytic
// aperture method. This implementation re-derives the polynomial integration,
// removes its color model, and contains no HCS-derived measurement constants.

layout(push_constant) uniform Push
{
   float ApertureGain;
   float BlackLevel;
   float BGR;
   float DebugIonState;
} params;

#pragma parameter ApertureGain "AGS BGR aperture gain" 1.0 0.5 2.0 0.05
#pragma parameter BlackLevel "AGS candidate black floor" 0.012 0.000 0.100 0.002
#pragma parameter BGR "AGS BGR subpixel order" 1.0 0.0 1.0 1.0
#pragma parameter DebugIonState "AGS debug signed residual-DC" 0.0 0.0 1.0 1.0

layout(std140, set = 0, binding = 0) uniform UBO
{
   mat4 MVP;
   vec4 OutputSize;
   vec4 OriginalSize;
   vec4 SourceSize;
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

const float APERTURE_X[7] = float[](
   1.0, -2.0 / 3.0, -1.0 / 5.0, 4.0 / 7.0,
   -1.0 / 9.0, -2.0 / 11.0, 1.0 / 13.0
);
const float APERTURE_Y[7] = float[](
   1.0, 0.0, -4.0 / 5.0, 2.0 / 7.0,
   4.0 / 9.0, -4.0 / 11.0, 1.0 / 13.0
);

float aperture_antiderivative(float position, float coefficients[7])
{
   float squared = position * position;
   float power = position;
   float integral = 0.0;
   for (int term = 0; term < 7; term++) {
      integral += power * coefficients[term];
      power *= squared;
   }
   return integral;
}

float integrate_aperture(float center, float footprint, float radius, float coefficients[7])
{
   float low = clamp((center - footprint * 0.5) / radius, -1.0, 1.0);
   float high = clamp((center + footprint * 0.5) / radius, -1.0, 1.0);
   return radius * (
      aperture_antiderivative(high, coefficients)
      - aperture_antiderivative(low, coefficients)
   ) / footprint;
}

ivec2 bounded_coord(ivec2 coord)
{
   return clamp(coord, ivec2(0), textureSize(Source, 0) - ivec2(1));
}

float srgb_encode_channel(float linearValue)
{
   return linearValue <= 0.0031308
      ? 12.92 * linearValue
      : 1.055 * pow(max(linearValue, 0.0), 1.0 / 2.4) - 0.055;
}

vec3 srgb_encode(vec3 linearColor)
{
   return vec3(
      srgb_encode_channel(linearColor.r),
      srgb_encode_channel(linearColor.g),
      srgb_encode_channel(linearColor.b)
   );
}

void main()
{
   if (params.DebugIonState > 0.5) {
      float state = clamp((texture(Source, vTexCoord).a - 0.5) * 4.0, -1.0, 1.0);
      vec3 negative = vec3(0.05, 0.75, 1.0);
      vec3 neutral = vec3(0.18);
      vec3 positive = vec3(1.0, 0.20, 0.05);
      FragColor = vec4(state < 0.0
         ? mix(neutral, negative, -state)
         : mix(neutral, positive, state), 1.0);
      return;
   }

   vec2 texelSize = global.SourceSize.zw;
   vec2 outputFootprint = global.OutputSize.zw;
   ivec2 topLeft = ivec2(floor(vTexCoord / texelSize - vec2(0.4999)));

   float subpixel = (vTexCoord.x / texelSize.x - 0.4999 - float(topLeft.x)) * 3.0;
   float subpixelFootprint = outputFootprint.x / texelSize.x * 3.0;
   vec3 leftMask = vec3(
      integrate_aperture(subpixel + 1.0, subpixelFootprint, 1.5, APERTURE_X),
      integrate_aperture(subpixel,       subpixelFootprint, 1.5, APERTURE_X),
      integrate_aperture(subpixel - 1.0, subpixelFootprint, 1.5, APERTURE_X)
   );
   vec3 rightMask = vec3(
      integrate_aperture(subpixel - 2.0, subpixelFootprint, 1.5, APERTURE_X),
      integrate_aperture(subpixel - 3.0, subpixelFootprint, 1.5, APERTURE_X),
      integrate_aperture(subpixel - 4.0, subpixelFootprint, 1.5, APERTURE_X)
   );
   if (params.BGR > 0.5) {
      leftMask = leftMask.bgr;
      rightMask = rightMask.bgr;
   }

   float row = vTexCoord.y / texelSize.y - 0.4999 - float(topLeft.y);
   float rowFootprint = outputFootprint.y / texelSize.y;
   float topMask = integrate_aperture(row,       rowFootprint, 0.63, APERTURE_Y);
   float bottomMask = integrate_aperture(row - 1.0, rowFootprint, 0.63, APERTURE_Y);

   vec3 black = vec3(clamp(params.BlackLevel, 0.0, 0.1));
   vec3 topLeftColor = texelFetch(Source, bounded_coord(topLeft), 0).rgb;
   vec3 topRightColor = texelFetch(Source, bounded_coord(topLeft + ivec2(1, 0)), 0).rgb;
   vec3 bottomLeftColor = texelFetch(Source, bounded_coord(topLeft + ivec2(0, 1)), 0).rgb;
   vec3 bottomRightColor = texelFetch(Source, bounded_coord(topLeft + ivec2(1, 1)), 0).rgb;
   topLeftColor = black + (vec3(1.0) - black) * topLeftColor;
   topRightColor = black + (vec3(1.0) - black) * topRightColor;
   bottomLeftColor = black + (vec3(1.0) - black) * bottomLeftColor;
   bottomRightColor = black + (vec3(1.0) - black) * bottomRightColor;

   vec3 panelLinear = params.ApertureGain * (
      topLeftColor * leftMask * topMask
      + topRightColor * rightMask * topMask
      + bottomLeftColor * leftMask * bottomMask
      + bottomRightColor * rightMask * bottomMask
   );
   FragColor = vec4(clamp(srgb_encode(clamp(panelLinear, 0.0, 1.0)), 0.0, 1.0), 1.0);
}
