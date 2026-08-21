#version 450

// KPA GT78-VN reference-unit host correction. This pass consumes encoded
// sRGB from a source-panel model and emits encoded RGB for the neutral KPA
// Android baseline. It must be the final pass and must never be combined with
// the Android-system KPA correction matrix.
// Provenance: kpa-reference-b57-g7-v1.json

layout(push_constant) uniform Push
{
   float KpaHostCorrection;
} params;

#pragma parameter KpaHostCorrection "KPA reference-unit host correction" 1.0 0.0 1.0 1.0

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
// RetroArch reserves binding 3 for the Original semantic even when this pass
// does not sample it. Named preset textures therefore start at binding 4.
layout(set = 0, binding = 4) uniform sampler2D KpaHostLut;

const int KPA_LUT_SIZE = 65;

ivec2 kpa_lut_coord(ivec3 rgb)
{
   // Flattened Argyll cube: R changes fastest, then G, then B.
   return ivec2(rgb.r + rgb.b * KPA_LUT_SIZE, rgb.g);
}

vec3 kpa_lut_fetch(ivec3 rgb)
{
   return texelFetch(KpaHostLut, kpa_lut_coord(rgb), 0).rgb;
}

vec3 kpa_host_correct(vec3 encodedSrgb)
{
   vec3 position = clamp(encodedSrgb, 0.0, 1.0) * float(KPA_LUT_SIZE - 1);
   ivec3 low = ivec3(floor(position));
   ivec3 high = min(low + ivec3(1), ivec3(KPA_LUT_SIZE - 1));
   vec3 fraction = fract(position);

   vec3 c000 = kpa_lut_fetch(ivec3(low.r,  low.g,  low.b));
   vec3 c100 = kpa_lut_fetch(ivec3(high.r, low.g,  low.b));
   vec3 c010 = kpa_lut_fetch(ivec3(low.r,  high.g, low.b));
   vec3 c110 = kpa_lut_fetch(ivec3(high.r, high.g, low.b));
   vec3 c001 = kpa_lut_fetch(ivec3(low.r,  low.g,  high.b));
   vec3 c101 = kpa_lut_fetch(ivec3(high.r, low.g,  high.b));
   vec3 c011 = kpa_lut_fetch(ivec3(low.r,  high.g, high.b));
   vec3 c111 = kpa_lut_fetch(ivec3(high.r, high.g, high.b));

   vec3 c00 = mix(c000, c100, fraction.r);
   vec3 c10 = mix(c010, c110, fraction.r);
   vec3 c01 = mix(c001, c101, fraction.r);
   vec3 c11 = mix(c011, c111, fraction.r);
   return mix(mix(c00, c10, fraction.g), mix(c01, c11, fraction.g), fraction.b);
}

void main()
{
   vec4 source = texture(Source, vTexCoord);
   vec3 corrected = params.KpaHostCorrection > 0.5
      ? kpa_host_correct(source.rgb)
      : source.rgb;
   FragColor = vec4(corrected, source.a);
}
