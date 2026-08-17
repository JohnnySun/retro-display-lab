#version 450

// Retro Display Lab DMG-01 model, pass 2.
// Five-state measured palette, rectangular apertures, and reflector shadow.

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

#pragma parameter PixelFill "DMG measured aperture fill" 0.875 0.55 0.95 0.005
#pragma parameter PixelEdge "DMG host-pixel box filtering" 1.00 0.00 1.00 0.05
#pragma parameter ShadowStrength "DMG reflector shadow" 0.18 0.00 0.50 0.01
#pragma parameter ShadowOffsetX "DMG shadow offset X" 0.11 -0.30 0.30 0.01
#pragma parameter ShadowOffsetY "DMG shadow offset Y" 0.13 -0.30 0.30 0.01
#pragma parameter Contrast "DMG contrast wheel" 1.00 0.60 1.55 0.01
#pragma parameter ContrastBias "DMG contrast bias" 0.00 -0.20 0.20 0.01
#pragma parameter ScreenBrightness "Target display brightness compensation" 1.00 0.40 1.00 0.01
#pragma parameter ScreenChroma "Target display chroma compensation" 1.00 0.50 1.10 0.01
#pragma parameter PolarizerAge "DMG polarizer aging" 0.00 0.00 1.00 0.02
#pragma parameter DebugView "STN debug: 0 normal, 1 voltage, 2 ionic, 3 residual" 0.0 0.0 3.0 1.0
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
   vec2 overlap = max(min(sampleHigh, apertureHigh) - max(sampleLow, apertureLow), vec2(0.0));
   vec2 coverage = clamp(overlap / footprint, 0.0, 1.0);
   return coverage.x * coverage.y;
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
   vec3 behind = background * (1.0 - params.ShadowStrength * shadowState * shadowMask);
   float pixelMask = aperture(cell);

   if (params.DebugView >= 0.5) {
      vec4 diagnostic = texelFetch(Source, bounded(pixel), 0);
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

   vec3 linearColor = mix(behind, optical_color(state), pixelMask);
   float luminance = dot(linearColor, vec3(0.2126, 0.7152, 0.0722));
   linearColor = mix(vec3(luminance), linearColor, params.ScreenChroma) * params.ScreenBrightness;

   FragColor = vec4(clamp(to_srgb(linearColor), 0.0, 1.0), 1.0);
}
