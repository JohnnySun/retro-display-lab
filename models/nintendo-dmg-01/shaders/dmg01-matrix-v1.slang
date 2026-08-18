#version 450

// Retro Display Lab DMG-01 model, pass 1.
// Passive-matrix selection loss and reconstructed distributed-RC loading are
// applied to voltage/director dynamics in pass 0. This pass adds only fixed
// panel nonuniformity and preserves diagnostic channels.
// Provenance: ../REFERENCES.md
// Evidence: [DMG-MATRIX-01]

layout(push_constant) uniform Push
{
   float LineVariation;
   float PanelMottle;
} params;

#pragma parameter LineVariation "DMG fixed line variation" 0.000 0.000 0.080 0.002
#pragma parameter PanelMottle "DMG panel mottle" 0.000 0.000 0.080 0.002

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

ivec2 bounded(ivec2 p)
{
   return clamp(p, ivec2(0), textureSize(Source, 0) - ivec2(1));
}

float state_at(ivec2 p)
{
   return texelFetch(Source, bounded(p), 0).g;
}

float effective_drive_at(ivec2 p)
{
   return clamp(fract(texelFetch(Source, bounded(p), 0).a) * (4.0 / 3.0), 0.0, 1.0);
}

float hash12(vec2 p)
{
   vec3 p3 = fract(vec3(p.xyx) * 0.1031);
   p3 += dot(p3, p3.yzx + 33.33);
   return fract((p3.x + p3.y) * p3.z);
}

float smooth_noise(vec2 p)
{
   vec2 cell = floor(p);
   vec2 f = fract(p);
   f = f * f * (3.0 - 2.0 * f);
   return mix(mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), f.x),
              mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + vec2(1.0)), f.x), f.y);
}

void main()
{
   ivec2 p = ivec2(floor(vTexCoord * global.SourceSize.xy));
   float center = state_at(p);

   float state = center;

   float line = (hash12(vec2(0.0, float(p.y))) - 0.5)
              + 0.55 * (hash12(vec2(float(p.x), 19.0)) - 0.5);
   float mottle = smooth_noise(vec2(p) / vec2(18.0, 14.0)) - 0.5;
   state += line * params.LineVariation + mottle * params.PanelMottle;

   float drive = effective_drive_at(p);
   float ionicCharge = texelFetch(Source, bounded(p), 0).b;
   FragColor = vec4(clamp(state, 0.0, 1.0), center, drive, ionicCharge);
}
