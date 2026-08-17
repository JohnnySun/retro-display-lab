#version 450

// Retro Display Lab DMG-01 model, pass 0.
// Four Game Boy shades drive a direction-dependent structural response plus
// a low-amplitude ionic image-retention state.

layout(push_constant) uniform Push
{
   float DarkenResponse;
   float ClearResponse;
   float SlowTail;
   float GrayDrag;
   float IonicMobility;
   float StickingOpticalGain;
   float IonicChargeResponse;
   float IonicReleaseResponse;
   float IonicTimeScale;
} params;

#pragma parameter DarkenResponse "DMG darkening response / frame" 0.34 0.05 1.00 0.01
#pragma parameter ClearResponse "DMG clearing response / frame" 0.18 0.03 1.00 0.01
#pragma parameter SlowTail "DMG slow tail weight" 0.28 0.00 0.70 0.01
#pragma parameter GrayDrag "DMG intermediate-shade drag" 0.22 0.00 0.80 0.01
#pragma parameter IonicMobility "STN (conductivity anisotropy) / viscosity" 0.050 0.025 0.075 0.001
#pragma parameter StickingOpticalGain "STN sticking volts to optical state" 0.082 0.000 0.200 0.002
#pragma parameter IonicChargeResponse "STN ionic charge / frame" 0.000056 0.000010 0.001000 0.000010
#pragma parameter IonicReleaseResponse "STN ionic release / frame" 0.000280 0.000020 0.002000 0.000020
#pragma parameter IonicTimeScale "STN experiment time scale" 1.0 1.0 120.0 1.0

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

float gameboy_target(vec3 encoded)
{
   float luma = dot(encoded, vec3(0.2126, 0.7152, 0.0722));
   float shade = floor(clamp(1.0 - luma, 0.0, 1.0) * 3.0 + 0.5) / 3.0;

   // The four driven shades occupy points 1..4 of BGB's five-state scale.
   // Zero is reserved for the optically distinct LCD-disabled background.
   return 0.25 + 0.75 * shade;
}

float intermediate_shade_weight(float state)
{
   // The two driven endpoints are 0.25 and 1.0. Only transitions touching
   // the intermediate driven shades receive the optional near-threshold drag.
   return clamp(1.0 - abs(state - 0.625) / 0.375, 0.0, 1.0);
}

float normalized_drive(float state)
{
   return clamp((state - 0.25) / 0.75, 0.0, 1.0);
}

float scaled_response(float response)
{
   // Preserve exponential integration when the diagnostic experiment is
   // accelerated instead of multiplying the coefficient past one.
   return 1.0 - pow(1.0 - response, params.IonicTimeScale);
}

void main()
{
   float target = gameboy_target(texture(Source, vTexCoord).rgb);
   vec4 history = texture(PassFeedback0, vTexCoord);

   // Every valid fast state is >= 0.25, so red below 0.125 is an unambiguous
   // freshly-cleared feedback texture. Ionic charge starts neutral: loading a
   // game must not pretend its first frame had already been shown for 30 min.
   if (history.r < 0.125) {
      float driveIndex = floor(normalized_drive(target) * 3.0 + 0.5);
      FragColor = vec4(target, target, 0.0, target + 2.0 * driveIndex);
      return;
   }

   float fast = history.r;
   float slow = history.g;
   float ionicCharge = history.b;
   float displayed = mod(history.a, 2.0);
   float response = target > displayed ? params.DarkenResponse : params.ClearResponse;

   // Near-threshold intermediate shades can settle more slowly. Do not slow
   // the 0 <-> 3 endpoint transition: its reference timing anchors the model.
   float middle = max(intermediate_shade_weight(target), intermediate_shade_weight(displayed));
   float transition = clamp(abs(target - displayed) * 2.0, 0.0, 1.0);
   response *= 1.0 - params.GrayDrag * middle * transition;

   fast += (target - fast) * response;
   slow += (target - slow) * max(response * 0.22, 0.008);

   float drive = normalized_drive(target);
   float ionicResponse = drive > ionicCharge
      ? scaled_response(params.IonicChargeResponse)
      : scaled_response(params.IonicReleaseResponse);
   ionicCharge += (drive - ionicCharge) * ionicResponse;

   // Linear regression of the 11 mixtures in Nakazono et al. (Merck Japan,
   // 1994): sticking voltage ~= 7.3904 * ((delta sigma / sigma) / eta) - 0.187.
   // The paper measures a visibility voltage range, not optical transmission;
   // StickingOpticalGain is therefore an explicit, separately tunable bridge.
   float stickingVolts = max(7.390426 * params.IonicMobility - 0.186987, 0.0);
   float ionicBias = max(ionicCharge - drive, 0.0)
                   * stickingVolts * params.StickingOpticalGain;
   float structural = mix(fast, slow, params.SlowTail);
   displayed = clamp(structural + ionicBias, 0.25, 1.0);

   // Alpha packs the displayed state in [0.25,1] and the exact 2-bit drive in
   // steps of two. Float feedback preserves both without another history pass.
   float driveIndex = floor(drive * 3.0 + 0.5);
   FragColor = vec4(fast, slow, ionicCharge, displayed + 2.0 * driveIndex);
}
