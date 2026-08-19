#version 450

#pragma format R32G32B32A32_SFLOAT

// Per-row three-dwell load counts for the structure-preserving WS5 common-mode
// RC reduction. Current and previous counts are packed exactly into float32 as
// current + 256 * previous; every count is an integer in [0, 160].
// Provenance: ../REFERENCES.md
// Evidence: [DMG-MATRIX-02] [DMG-ITO-01] [DMG-ITO-02] [DMG-DRIVER-03]
//           [DMG-DRIVER-04] [DMG-LCELECTRICAL-01] [DMG-DIMENSIONS-01]

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
layout(set = 0, binding = 3) uniform sampler2D OriginalHistory1;

int drive_index(vec3 encoded)
{
   float luma = dot(encoded, vec3(0.2126, 0.7152, 0.0722));
   return int(floor(clamp(1.0 - luma, 0.0, 1.0) * 3.0 + 0.5));
}

void main()
{
   ivec2 size = textureSize(Source, 0);
   int y = clamp(int(floor(vTexCoord.y * float(size.y))), 0, size.y - 1);
   ivec3 currentCounts = ivec3(0);
   ivec3 previousCounts = ivec3(0);
   for (int x = 0; x < 160; ++x) {
      int current = drive_index(texelFetch(Source, ivec2(x, y), 0).rgb);
      int previous = drive_index(texelFetch(OriginalHistory1, ivec2(x, y), 0).rgb);
      currentCounts += ivec3(current > 0, current > 1, current > 2);
      previousCounts += ivec3(previous > 0, previous > 1, previous > 2);
   }
   FragColor = vec4(vec3(currentCounts) + 256.0 * vec3(previousCounts), 0.0);
}
