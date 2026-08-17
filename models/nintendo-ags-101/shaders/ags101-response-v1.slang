#version 450

// Retro Display Lab AGS-101 candidate model, pass 0.
// Causal per-subpixel GtG response plus a signed residual-DC integrator.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-GTG-01] [AGS-STICK-01] [AGS-NEUTRAL-01]
//
// This public pass deliberately contains no HCS-derived EOTF tables. It uses
// the standard sRGB transfer function as a neutral, replaceable source adapter.

layout(push_constant) uniform Push
{
   float RiseBase;
   float FallBase;
   float NearTransitionDrag;
   float MidGrayDrag;
   float IonChargeTau;
   float IonReleaseTau;
   float IonOpticalGain;
   float IonStrength;
} params;

#pragma parameter RiseBase "AGS candidate brightening / frame" 0.620 0.100 1.000 0.025
#pragma parameter FallBase "AGS candidate darkening / frame" 0.450 0.100 1.000 0.025
#pragma parameter NearTransitionDrag "AGS near-level GtG drag" 0.250 0.000 0.700 0.025
#pragma parameter MidGrayDrag "AGS middle-gray GtG drag" 0.200 0.000 0.500 0.025
#pragma parameter IonChargeTau "AGS residual-DC charge tau (s)" 900.0 30.0 3600.0 30.0
#pragma parameter IonReleaseTau "AGS residual-DC release tau (s)" 120.0 10.0 1200.0 10.0
#pragma parameter IonOpticalGain "AGS residual-DC optical gain" 0.020 0.000 0.080 0.002
#pragma parameter IonStrength "AGS residual-DC excitation" 1.000 0.000 1.500 0.050

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
layout(set = 0, binding = 3) uniform sampler2D PassFeedback0;

const float PANEL_FPS = 59.7275;

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

ivec3 nearest_rgb555_code(vec3 optical)
{
   ivec3 nearest = ivec3(0);
   vec3 bestError = vec3(1e9);
   for (int i = 0; i < 32; i++) {
      float candidate = srgb_decode_channel(float(i) / 31.0);
      vec3 error = abs(vec3(candidate) - optical);
      bvec3 better = lessThan(error, bestError);
      nearest = ivec3(
         better.r ? i : nearest.r,
         better.g ? i : nearest.g,
         better.b ? i : nearest.b
      );
      bestError = min(bestError, error);
   }
   return nearest;
}

vec3 gtg_response(ivec3 fromIndex, ivec3 toIndex)
{
   vec3 fromCode = vec3(fromIndex) / 31.0;
   vec3 toCode = vec3(toIndex) / 31.0;
   vec3 distance = abs(toCode - fromCode);
   vec3 movingUp = step(fromCode, toCode);
   vec3 base = mix(
      vec3(clamp(params.FallBase, 0.1, 1.0)),
      vec3(clamp(params.RiseBase, 0.1, 1.0)),
      movingUp
   );

   // Literature constrains the topology, not these AGS-101 coefficients.
   // A measured 32x32 per-channel GtG LUT can replace this surrogate later.
   vec3 nearWeight = pow(vec3(1.0) - distance, vec3(2.0));
   vec3 midpoint = 0.5 * (fromCode + toCode);
   vec3 middleWeight = 4.0 * midpoint * (vec3(1.0) - midpoint) * nearWeight;
   vec3 response = base
      * (vec3(1.0) - clamp(params.NearTransitionDrag, 0.0, 0.7) * nearWeight)
      * (vec3(1.0) - clamp(params.MidGrayDrag, 0.0, 0.5) * middleWeight);
   return clamp(response, 0.025, 1.0);
}

float encode_ion_state(float state)
{
   return 0.5 + 0.25 * clamp(state, -1.0, 1.0);
}

float decode_ion_state(float encoded)
{
   return clamp((encoded - 0.5) * 4.0, -1.0, 1.0);
}

float exponential_rate(float tauSeconds)
{
   return 1.0 - exp(-1.0 / (PANEL_FPS * max(tauSeconds, 0.001)));
}

void main()
{
   ivec3 targetIndex = rgb555_index(texture(Source, vTexCoord).rgb);
   vec3 target = neutral_eotf(targetIndex);
   vec4 feedback = texture(PassFeedback0, vTexCoord);

   if (feedback.a < 0.125) {
      FragColor = vec4(target, encode_ion_state(0.0));
      return;
   }

   vec3 previous = clamp(feedback.rgb, 0.0, 1.0);
   ivec3 previousIndex = nearest_rgb555_code(previous);
   float ionState = decode_ion_state(feedback.a);

   // RGB555 luminance is a documented voltage proxy, not a reconstructed V-T
   // curve or panel inversion waveform.
   vec3 targetCode = vec3(targetIndex) / 31.0;
   float drive = (2.0 * dot(targetCode, vec3(0.2126, 0.7152, 0.0722)) - 1.0)
      * clamp(params.IonStrength, 0.0, 1.5);
   drive = clamp(drive, -1.0, 1.0);

   float ionTarget = drive;
   float ionRate = exponential_rate(params.IonChargeTau);
   bool oppositePolarity = ionState * drive < 0.0 && abs(ionState) > 0.0001;
   bool relaxing = abs(drive) < abs(ionState) || oppositePolarity;
   if (oppositePolarity)
      ionTarget = 0.0;
   if (relaxing)
      ionRate = exponential_rate(params.IonReleaseTau);
   ionState += (ionTarget - ionState) * ionRate;

   vec3 effectiveTarget = clamp(
      target + vec3(clamp(params.IonOpticalGain, 0.0, 0.08) * ionState),
      0.0,
      1.0
   );
   vec3 response = gtg_response(previousIndex, targetIndex);
   vec3 panelState = previous + (effectiveTarget - previous) * response;
   FragColor = vec4(clamp(panelState, 0.0, 1.0), encode_ion_state(ionState));
}
