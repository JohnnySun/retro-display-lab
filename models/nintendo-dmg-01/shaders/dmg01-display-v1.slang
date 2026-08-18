#version 450

// Retro Display Lab DMG-01 model, pass 2.
// Five-state measured palette, rectangular apertures, and reflector shadow.
// Provenance: ../REFERENCES.md
// Evidence: [DMG-COLOR-01] [DMG-APERTURE-01]

layout(push_constant) uniform Push
{
   float PixelFill;
   float PixelEdge;
   float ShadowStrength;
   float ShadowOffsetX;
   float ShadowOffsetY;
   float Contrast;
   float ContrastBias;
   float ScreenBrightness;
   float ScreenChroma;
   float PolarizerAge;
   float DebugView;
   float DebugGain;
} params;

#pragma parameter PixelFill "DMG BGB idealized aperture fill" 0.875 0.55 0.95 0.005
#pragma parameter PixelEdge "DMG host-pixel box filtering" 1.00 0.00 1.00 0.05
#pragma parameter ShadowStrength "DMG reflector shadow" 0.18 0.00 0.50 0.01
#pragma parameter ShadowOffsetX "DMG shadow offset X" 0.11 -0.30 0.30 0.01
#pragma parameter ShadowOffsetY "DMG shadow offset Y" 0.13 -0.30 0.30 0.01
#pragma parameter Contrast "DMG contrast wheel" 1.00 0.60 1.55 0.01
#pragma parameter ContrastBias "DMG contrast bias" 0.00 -0.20 0.20 0.01
#pragma parameter ScreenBrightness "Target display brightness compensation" 1.00 0.40 1.00 0.01
#pragma parameter ScreenChroma "Target display chroma compensation" 1.00 0.50 1.10 0.01
#pragma parameter PolarizerAge "DMG polarizer aging" 0.00 0.00 1.00 0.02
#pragma parameter DebugView "STN debug view (4 optical, 5 ionic RGB, 6 RC drive)" 0.0 0.0 6.0 1.0
#pragma parameter DebugGain "STN residual debug gain" 12.0 1.0 40.0 1.0

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

const vec3 DMG_DISABLED = vec3(148.0, 138.0, 4.0) / 255.0;
const vec3 DMG_SHADE_0  = vec3(117.0, 152.0, 51.0) / 255.0;
const vec3 DMG_SHADE_1  = vec3(88.0, 143.0, 81.0) / 255.0;
const vec3 DMG_SHADE_2  = vec3(59.0, 117.0, 96.0) / 255.0;
const vec3 DMG_SHADE_3  = vec3(46.0, 97.0, 90.0) / 255.0;

float srgb_decode(float v)
{
   return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}

float srgb_encode(float v)
{
   return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(max(v, 0.0), 1.0 / 2.4) - 0.055;
}

vec3 to_linear(vec3 c)
{
   return vec3(srgb_decode(c.r), srgb_decode(c.g), srgb_decode(c.b));
}

vec3 to_srgb(vec3 c)
{
   return vec3(srgb_encode(c.r), srgb_encode(c.g), srgb_encode(c.b));
}

vec3 optical_color(float state)
{
   float x = clamp(state, 0.0, 1.0) * 4.0;
   vec3 c0 = to_linear(DMG_DISABLED);
   vec3 c1 = to_linear(DMG_SHADE_0);
   vec3 c2 = to_linear(DMG_SHADE_1);
   vec3 c3 = to_linear(DMG_SHADE_2);
   vec3 c4 = to_linear(DMG_SHADE_3);
   vec3 linearColor;

   if (x < 1.0)
      linearColor = mix(c0, c1, x);
   else if (x < 2.0)
      linearColor = mix(c1, c2, x - 1.0);
   else if (x < 3.0)
      linearColor = mix(c2, c3, x - 2.0);
   else
      linearColor = mix(c3, c4, x - 3.0);

   vec3 aged = linearColor * vec3(1.10, 0.98, 0.68) + vec3(0.018, 0.008, 0.0);
   return mix(linearColor, aged, params.PolarizerAge);
}

vec3 heatmap(float value)
{
   float v = clamp(value, 0.0, 1.0);
   return clamp(vec3(1.5 * v, 1.5 - abs(3.0 * v - 1.5), 1.5 * (1.0 - v)), 0.0, 1.0);
}

ivec2 bounded(ivec2 p)
{
   return clamp(p, ivec2(0), textureSize(Source, 0) - ivec2(1));
}

float aperture(vec2 cell)
{
   // BGB's idealized close-up measures 70 active units followed by a 10-unit
   // unpowered gap on an 80-unit pitch. At 4x scale the gap is only half a
   // host pixel, so point sampling/smoothstep can erase it. Integrate the
   // rectangular aperture over the host-pixel footprint instead.
   vec2 hostPixel = max(global.SourceSize.xy * global.OutputSize.zw, vec2(0.0001));
   vec2 footprint = max(hostPixel * max(params.PixelEdge, 0.001), vec2(0.0001));
   vec2 apertureLow = vec2(0.5 - params.PixelFill * 0.5);
   vec2 apertureHigh = vec2(0.5 + params.PixelFill * 0.5);
   vec2 sampleLow = cell - footprint * 0.5;
   vec2 sampleHigh = cell + footprint * 0.5;
   // The footprint may straddle a cell boundary at fractional scales. Sum the
   // same aperture in the previous/current/next pitch so coverage remains
   // periodic and conserves its linear-light average instead of losing the
   // wrapped portion at cell edges.
   vec2 overlap = vec2(0.0);
   for (int period = -1; period <= 1; period++)
   {
      vec2 shift = vec2(float(period));
      overlap += max(
         min(sampleHigh, apertureHigh + shift)
            - max(sampleLow, apertureLow + shift),
         vec2(0.0));
   }
   vec2 coverage = clamp(overlap / footprint, 0.0, 1.0);
   return coverage.x * coverage.y;
}

float joint_aperture_axis(float position, float shadowOffset, float footprint)
{
   float apertureLow = 0.5 - params.PixelFill * 0.5;
   float apertureHigh = 0.5 + params.PixelFill * 0.5;
   float sampleLow = position - footprint * 0.5;
   float sampleHigh = position + footprint * 0.5;
   float activeBase = floor(position);
   float shadowBase = floor(position - shadowOffset);
   float overlap = 0.0;
   for (int activePeriod = -1; activePeriod <= 1; activePeriod++)
   {
      float activeLow = activeBase + float(activePeriod) + apertureLow;
      float activeHigh = activeBase + float(activePeriod) + apertureHigh;
      for (int shadowPeriod = -1; shadowPeriod <= 1; shadowPeriod++)
      {
         float shadowLow = shadowBase + float(shadowPeriod) + shadowOffset + apertureLow;
         float shadowHigh = shadowBase + float(shadowPeriod) + shadowOffset + apertureHigh;
         overlap += max(
            min(sampleHigh, min(activeHigh, shadowHigh))
               - max(sampleLow, max(activeLow, shadowLow)),
            0.0);
      }
   }
   return clamp(overlap / footprint, 0.0, 1.0);
}

void main()
{
   vec2 pixelPosition = vTexCoord * global.SourceSize.xy;
   ivec2 pixel = ivec2(floor(pixelPosition));
   vec2 cell = fract(pixelPosition);

   float state = texelFetch(Source, bounded(pixel), 0).r;
   state = clamp((state - 0.25) * params.Contrast + 0.25 + params.ContrastBias, 0.0, 1.0);

   vec2 shadowPosition = pixelPosition - vec2(params.ShadowOffsetX, params.ShadowOffsetY);
   ivec2 shadowPixel = ivec2(floor(shadowPosition));
   float shadowState = texelFetch(Source, bounded(shadowPixel), 0).r;
   float shadowMask = aperture(fract(shadowPosition));

   vec3 background = optical_color(0.0);
   float pixelMask = aperture(cell);
   vec2 hostPixel = max(global.SourceSize.xy * global.OutputSize.zw, vec2(0.0001));
   vec2 footprint = max(hostPixel * max(params.PixelEdge, 0.001), vec2(0.0001));
   float jointMask = joint_aperture_axis(
      pixelPosition.x, params.ShadowOffsetX, footprint.x)
      * joint_aperture_axis(pixelPosition.y, params.ShadowOffsetY, footprint.y);
   float shadowGapMask = max(shadowMask - jointMask, 0.0);

   if (params.DebugView >= 0.5) {
      vec4 diagnostic = texelFetch(Source, bounded(pixel), 0);
      // WS7 numeric GPU comparison: bypass palette, aperture, shadow, and
      // target compensation, and expose the matrix input state as an 8-bit
      // grayscale code in the final RGBA8 pass. Framebuffer captures can then
      // compare the GPU state with CPU vectors to a declared 1/255 limit.
      if (params.DebugView >= 5.5) {
         // WS5 electrical diagnostic: continuous effective drive after the
         // generated distributed-RC surrogate, normalized to shade 3.
         FragColor = vec4(vec3(clamp(diagnostic.b, 0.0, 1.0)), 1.0);
         return;
      }
      if (params.DebugView >= 4.5) {
         // WS4 numeric retention view. R is adsorbed-ion state, G is the
         // instantaneous four-level drive, and B is the positive residual.
         // Keeping all three unmodified makes the scene transition and decay
         // observable in one framebuffer capture stream.
         FragColor = vec4(
            clamp(diagnostic.a, 0.0, 1.0),
            clamp(diagnostic.b, 0.0, 1.0),
            clamp(diagnostic.a - diagnostic.b, 0.0, 1.0),
            1.0);
         return;
      }
      if (params.DebugView >= 3.5) {
         FragColor = vec4(vec3(clamp(diagnostic.r, 0.0, 1.0)), 1.0);
         return;
      }
      float debugValue;
      if (params.DebugView < 1.5)
         debugValue = diagnostic.b;
      else if (params.DebugView < 2.5)
         debugValue = diagnostic.a;
      else
         debugValue = max(diagnostic.a - diagnostic.b, 0.0) * params.DebugGain;
      vec3 debugColor = heatmap(debugValue);
      FragColor = vec4(mix(vec3(0.015), debugColor, pixelMask), 1.0);
      return;
   }

   vec3 linearColor = mix(background, optical_color(state), pixelMask);
   linearColor -= background * params.ShadowStrength * shadowState * shadowGapMask;
   float luminance = dot(linearColor, vec3(0.2126, 0.7152, 0.0722));
   linearColor = mix(vec3(luminance), linearColor, params.ScreenChroma) * params.ScreenBrightness;

   FragColor = vec4(clamp(to_srgb(linearColor), 0.0, 1.0), 1.0);
}
