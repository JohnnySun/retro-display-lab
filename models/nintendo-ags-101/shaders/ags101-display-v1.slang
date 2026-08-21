#version 450

// Retro Display Lab AGS-101 candidate model, pass 2.
// Analytic BGR aperture integration and selectable HCS-measured host rendering.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-COLOR-01] [AGS-BACKLIGHT-01] [AGS-APERTURE-01] [AGS-RETENTION-01] [AGS-FRONTEND-01] [AGS-NEUTRAL-01] [AGS-TIMING-01] [AGS-RECON-01]
//
// Special thanks: cgwg and Libretro lcd-grid-v2 for the published analytic
// aperture method. This implementation re-derives the polynomial integration.
// The measured color constants are generated independently from AGS-COLOR-01.

layout(push_constant) uniform Push
{
   float ApertureGain;
   float ApertureEnabled;
   float ApertureHorizontalRadius;
   float ApertureVerticalRadius;
   float BlackLevel;
   float BGR;
   float BacklightScaleEnabled;
   float BacklightRelativeGain;
   float DebugView;
   float HcsMeasuredColor;
   float HcsChromaticAdaptation;
   float HcsImproveContrast;
   float GtgTableBackend;
   float SpatialRetention;
   float SpatialCodeWeight;
   float PolarityDriveWeight;
   float DriveDcOffset;
   float LatchOffsetLines;
   float OpticalDelaySeconds;
   float ParityPhase;
   float InversionTopology;
} params;

#pragma parameter ApertureGain "AGS BGR aperture gain" 1.0 0.5 2.0 0.05
#pragma parameter ApertureEnabled "AGS BGR aperture integration" 1.0 0.0 1.0 1.0
#pragma parameter ApertureHorizontalRadius "AGS generic aperture horizontal radius" 1.50 1.00 1.80 0.05
#pragma parameter ApertureVerticalRadius "AGS generic aperture vertical radius" 0.63 0.40 0.85 0.01
#pragma parameter BlackLevel "AGS candidate black floor" 0.012 0.000 0.100 0.002
#pragma parameter BGR "AGS BGR subpixel order" 1.0 0.0 1.0 1.0
#pragma parameter BacklightScaleEnabled "AGS relative backlight sensitivity" 0.0 0.0 1.0 1.0
#pragma parameter BacklightRelativeGain "AGS relative backlight gain (unmeasured)" 1.0 0.5 1.0 0.05
#pragma parameter DebugView "AGS diagnostic view" 0.0 0.0 14.0 1.0
#pragma parameter HcsMeasuredColor "AGS HCS measured color" 1.0 0.0 1.0 1.0
#pragma parameter HcsChromaticAdaptation "AGS HCS adapt white to D65" 0.0 0.0 1.0 1.0
#pragma parameter HcsImproveContrast "AGS HCS remove measured black" 1.0 0.0 1.0 1.0
#pragma parameter GtgTableBackend "AGS GtG table backend" 0.0 0.0 1.0 1.0
#pragma parameter SpatialRetention "AGS reconstructed spatial retention" 1.0 0.0 1.0 1.0
#pragma parameter SpatialCodeWeight "AGS code-dependent DC proxy weight" 0.500 0.000 1.000 0.025
#pragma parameter PolarityDriveWeight "AGS polarity-dependent DC proxy weight" 0.250 0.000 1.000 0.025
#pragma parameter DriveDcOffset "AGS project-prior normalized drive DC" 0.100 -0.250 0.250 0.005
#pragma parameter LatchOffsetLines "AGS latch offset candidate (lines)" 0.0 0.0 1.0 0.05
#pragma parameter OpticalDelaySeconds "AGS pure-delay candidate (s)" 0.000000 0.000000 0.016743 0.000050
#pragma parameter ParityPhase "AGS polarity-phase hypothesis" 0.0 0.0 1.0 1.0
#pragma parameter InversionTopology "AGS inversion hypothesis (frame/row/column/dot)" 1.0 0.0 3.0 1.0

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
layout(set = 0, binding = 4) uniform sampler2D GtgRateLut;

#include "ags101-ws3-timing.inc"
#include "ags101-drive-retention.inc"

const float APERTURE_X[7] = float[](
   1.0, -2.0 / 3.0, -1.0 / 5.0, 4.0 / 7.0,
   -1.0 / 9.0, -2.0 / 11.0, 1.0 / 13.0
);
const float APERTURE_Y[7] = float[](
   1.0, 0.0, -4.0 / 5.0, 2.0 / 7.0,
   4.0 / 9.0, -4.0 / 11.0, 1.0 / 13.0
);

// Exact full-support integrals of the two generic lcd-grid-v2-derived
// polynomials.  Each channel occupies one of three horizontal stripe periods,
// so the factor of three normalizes every source channel to unit mean
// linear-light energy. ApertureGain remains a separate presentation control.
const float APERTURE_X_INTEGRAL = 0.9775113775113773;
const float APERTURE_Y_INTEGRAL = 1.2868908868908866;

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

float aperture_energy_normalization(float horizontalRadius, float verticalRadius)
{
   float energy = horizontalRadius * APERTURE_X_INTEGRAL
      * verticalRadius * APERTURE_Y_INTEGRAL;
   return 3.0 / max(energy, 1e-8);
}

float backlight_relative_gain()
{
   return params.BacklightScaleEnabled > 0.5
      ? clamp(params.BacklightRelativeGain, 0.5, 1.0)
      : 1.0;
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

float srgb_decode_channel(float encoded)
{
   return encoded <= 0.04045
      ? encoded / 12.92
      : pow((encoded + 0.055) / 1.055, 2.4);
}

vec3 srgb_encode(vec3 linearColor)
{
   return vec3(
      srgb_encode_channel(linearColor.r),
      srgb_encode_channel(linearColor.g),
      srgb_encode_channel(linearColor.b)
   );
}

// BEGIN GENERATED HCS COLOR: DISPLAY
// Generated from AGS-COLOR-01 by tools/build-ags101-hcs-color.mjs.
const vec3 HCS_RGB555_EOTF[32] = vec3[](
   vec3(0.000000000000, 0.000000000000, 0.000000000000),
   vec3(0.000713225441, 0.000745786518, 0.001088088736),
   vec3(0.001916340743, 0.001974996734, 0.002882917113),
   vec3(0.003446864521, 0.003495502817, 0.005162829820),
   vec3(0.006205162716, 0.006385624816, 0.009461267578),
   vec3(0.011300394859, 0.011592766877, 0.017130061577),
   vec3(0.019808585349, 0.020369390711, 0.030110788205),
   vec3(0.031530403765, 0.032725487404, 0.048113661659),
   vec3(0.046955069311, 0.048902452190, 0.071554176316),
   vec3(0.060284037627, 0.062795318180, 0.091569030607),
   vec3(0.076148400401, 0.079313991388, 0.115342809712),
   vec3(0.097480924088, 0.101922086295, 0.146321279080),
   vec3(0.117188330834, 0.122069770398, 0.174913978213),
   vec3(0.132242210754, 0.138355317297, 0.196720800513),
   vec3(0.153806516120, 0.160935944655, 0.227420544422),
   vec3(0.174112035612, 0.182127514167, 0.256184390510),
   vec3(0.195602633905, 0.205007080081, 0.286113718972),
   vec3(0.223234708701, 0.233242856930, 0.323792456103),
   vec3(0.245707104853, 0.256768024034, 0.353477180304),
   vec3(0.270737865183, 0.283487661106, 0.385147272777),
   vec3(0.302402095085, 0.315120005457, 0.424337289917),
   vec3(0.343725333227, 0.358072932970, 0.477121999403),
   vec3(0.381357625152, 0.398197702622, 0.521392541475),
   vec3(0.436131921921, 0.455422816343, 0.588883703792),
   vec3(0.484419837432, 0.505055893531, 0.640616637116),
   vec3(0.547897787392, 0.569528484618, 0.706671212868),
   vec3(0.596026386208, 0.616823929811, 0.745078956012),
   vec3(0.662897164396, 0.684393195616, 0.805681215174),
   vec3(0.749498942051, 0.766861347259, 0.868781448074),
   vec3(0.848803644046, 0.861693924050, 0.928398526993),
   vec3(0.937323214375, 0.947520725183, 0.971652863511),
   vec3(1.000000000000, 1.000000000000, 1.000000000000)
);

const mat3 HCS_NATIVE_RGB_TO_XYZ = mat3(
   vec3(0.425287783341, 0.237300233948, 0.020977021129),
   vec3(0.347140685410, 0.638744541979, 0.060791803406),
   vec3(0.212756689885, 0.123955224073, 1.152435127677)
);

const mat3 HCS_BRADFORD_TO_D65 = mat3(
   vec3(0.994355799340, -0.011260531310, -0.005128388825),
   vec3(-0.005911988665, 1.017535033238, 0.009476971455),
   vec3(-0.018843449784, -0.005219011737, 0.878811958039)
);

const mat3 HCS_BRADFORD_WITH_BLACK_TO_D65 = mat3(
   vec3(0.990502545742, -0.011287737538, -0.005157575601),
   vec3(-0.005920811913, 1.013740361935, 0.009529410708),
   vec3(-0.018962681776, -0.005254378472, 0.874236252693)
);

const mat3 HCS_SRGB_XYZ_TO_LINEAR_RGB = mat3(
   vec3(3.240625500000, -0.968930700000, 0.055710100000),
   vec3(-1.537208000000, 1.875756100000, -0.204021100000),
   vec3(-0.498628600000, 0.041517500000, 1.056995900000)
);

const vec3 HCS_BLACK_XYZ_NORMALIZED = vec3(
   0.004120077982, 0.003876949303, 0.006389772357
);
// END GENERATED HCS COLOR: DISPLAY

vec3 hcs_native_to_host_linear(vec3 nativeLinear)
{
   vec3 xyz = HCS_NATIVE_RGB_TO_XYZ * nativeLinear;
   bool improveContrast = params.HcsImproveContrast > 0.5;
   if (!improveContrast)
      xyz += HCS_BLACK_XYZ_NORMALIZED;

   xyz *= backlight_relative_gain();

   if (params.HcsChromaticAdaptation > 0.5) {
      xyz = improveContrast
         ? HCS_BRADFORD_TO_D65 * xyz
         : HCS_BRADFORD_WITH_BLACK_TO_D65 * xyz;
   }
   return HCS_SRGB_XYZ_TO_LINEAR_RGB * xyz;
}

ivec3 rgb555_index(vec3 encoded)
{
   return clamp(
      ivec3(floor(clamp(encoded, 0.0, 1.0) * 31.0 + 0.5)),
      ivec3(0),
      ivec3(31)
   );
}

float source_eotf_value(int index, int channel)
{
   if (params.HcsMeasuredColor > 0.5)
      return HCS_RGB555_EOTF[index][channel];
   return srgb_decode_channel(float(index) / 31.0);
}

float optical_channel_to_code(float optical, int channel)
{
   float value = clamp(optical, 0.0, 1.0);
   float code = 31.0;
   for (int index = 0; index < 31; index++) {
      float lowValue = source_eotf_value(index, channel);
      float highValue = source_eotf_value(index + 1, channel);
      if (value <= highValue) {
         code = float(index) + clamp(
            (value - lowValue) / max(highValue - lowValue, 1e-8),
            0.0,
            1.0
         );
         break;
      }
   }
   return code;
}

vec3 optical_to_code(vec3 optical)
{
   return vec3(
      optical_channel_to_code(optical.r, 0),
      optical_channel_to_code(optical.g, 1),
      optical_channel_to_code(optical.b, 2)
   );
}

ivec2 original_coord(vec2 coord)
{
   return clamp(
      ivec2(floor(coord * global.OriginalSize.xy)),
      ivec2(0),
      max(ivec2(global.OriginalSize.xy) - ivec2(1), ivec2(0))
   );
}

float candidate_black()
{
   return params.HcsMeasuredColor > 0.5
      ? 0.0
      : clamp(params.BlackLevel, 0.0, 0.1);
}

vec3 panel_without_aperture(vec2 coord)
{
   vec3 black = vec3(candidate_black());
   return black + (vec3(1.0) - black) * texture(Source, coord).rgb;
}

void aperture_weights(
   vec2 coord,
   out vec3 leftMask,
   out vec3 rightMask,
   out float topMask,
   out float bottomMask
)
{
   vec2 texelSize = global.SourceSize.zw;
   vec2 outputFootprint = global.OutputSize.zw;
   ivec2 topLeft = ivec2(floor(coord / texelSize - vec2(0.4999)));

   float subpixel = (coord.x / texelSize.x - 0.4999 - float(topLeft.x)) * 3.0;
   float subpixelFootprint = outputFootprint.x / texelSize.x * 3.0;
   leftMask = vec3(
      integrate_aperture(subpixel + 1.0, subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X),
      integrate_aperture(subpixel,       subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X),
      integrate_aperture(subpixel - 1.0, subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X)
   );
   rightMask = vec3(
      integrate_aperture(subpixel - 2.0, subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X),
      integrate_aperture(subpixel - 3.0, subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X),
      integrate_aperture(subpixel - 4.0, subpixelFootprint, params.ApertureHorizontalRadius, APERTURE_X)
   );
   if (params.BGR > 0.5) {
      leftMask = leftMask.bgr;
      rightMask = rightMask.bgr;
   }

   float row = coord.y / texelSize.y - 0.4999 - float(topLeft.y);
   float rowFootprint = outputFootprint.y / texelSize.y;
   topMask = integrate_aperture(row, rowFootprint, params.ApertureVerticalRadius, APERTURE_Y);
   bottomMask = integrate_aperture(row - 1.0, rowFootprint, params.ApertureVerticalRadius, APERTURE_Y);
}

vec3 aperture_uniform_energy(vec2 coord)
{
   vec3 leftMask;
   vec3 rightMask;
   float topMask;
   float bottomMask;
   aperture_weights(coord, leftMask, rightMask, topMask, bottomMask);
   float normalization = aperture_energy_normalization(
      params.ApertureHorizontalRadius,
      params.ApertureVerticalRadius
   );
   return normalization * (leftMask + rightMask) * (topMask + bottomMask);
}

vec3 panel_with_aperture(vec2 coord)
{
   vec2 texelSize = global.SourceSize.zw;
   ivec2 topLeft = ivec2(floor(coord / texelSize - vec2(0.4999)));
   vec3 leftMask;
   vec3 rightMask;
   float topMask;
   float bottomMask;
   aperture_weights(coord, leftMask, rightMask, topMask, bottomMask);

   vec3 black = vec3(candidate_black());
   vec3 topLeftColor = texelFetch(Source, bounded_coord(topLeft), 0).rgb;
   vec3 topRightColor = texelFetch(Source, bounded_coord(topLeft + ivec2(1, 0)), 0).rgb;
   vec3 bottomLeftColor = texelFetch(Source, bounded_coord(topLeft + ivec2(0, 1)), 0).rgb;
   vec3 bottomRightColor = texelFetch(Source, bounded_coord(topLeft + ivec2(1, 1)), 0).rgb;
   topLeftColor = black + (vec3(1.0) - black) * topLeftColor;
   topRightColor = black + (vec3(1.0) - black) * topRightColor;
   bottomLeftColor = black + (vec3(1.0) - black) * bottomLeftColor;
   bottomRightColor = black + (vec3(1.0) - black) * bottomRightColor;

   float normalization = aperture_energy_normalization(
      params.ApertureHorizontalRadius,
      params.ApertureVerticalRadius
   );
   return params.ApertureGain * normalization * (
      topLeftColor * leftMask * topMask
      + topRightColor * rightMask * topMask
      + bottomLeftColor * leftMask * bottomMask
      + bottomRightColor * rightMask * bottomMask
   );
}

vec3 panel_to_host(vec3 panelLinear)
{
   vec3 hostLinear = params.HcsMeasuredColor > 0.5
      ? hcs_native_to_host_linear(panelLinear)
      : panelLinear * backlight_relative_gain();
   return clamp(srgb_encode(hostLinear), 0.0, 1.0);
}

vec3 signed_debug_color(float value)
{
   float state = clamp(value, -1.0, 1.0);
   vec3 negative = vec3(0.05, 0.75, 1.0);
   vec3 neutral = vec3(0.18);
   vec3 positive = vec3(1.0, 0.20, 0.05);
   return state < 0.0
      ? mix(neutral, negative, -state)
      : mix(neutral, positive, state);
}

vec3 drive_diagnostic()
{
   float retained = clamp((texture(Source, vTexCoord).a - 0.5) * 4.0, -1.0, 1.0);
   ivec2 sourceCoord = original_coord(vTexCoord);
   ivec3 targetIndex = rgb555_index(texelFetch(Original, sourceCoord, 0).rgb);
   float polarity = ws3_drive_polarity(
      global.FrameCount,
      sourceCoord,
      params.ParityPhase,
      params.InversionTopology
   );
   float excitation = ws5_drive_excitation(
      targetIndex,
      polarity,
      params.DriveDcOffset,
      params.SpatialRetention,
      params.SpatialCodeWeight,
      params.PolarityDriveWeight
   );
   if (vTexCoord.x < 0.25)
      return polarity > 0.0 ? vec3(1.0) : vec3(0.0);
   if (vTexCoord.x < 0.50)
      return signed_debug_color(excitation);
   if (vTexCoord.x < 0.75)
      return signed_debug_color(retained);
   return signed_debug_color(excitation - retained);
}

vec3 ws5_spatial_diagnostic()
{
   ivec2 sourceCoord = original_coord(vTexCoord);
   ivec3 targetIndex = rgb555_index(texelFetch(Original, sourceCoord, 0).rgb);
   float retained = clamp((texture(Source, vTexCoord).a - 0.5) * 4.0, -1.0, 1.0);
   float polarity = ws3_drive_polarity(
      global.FrameCount,
      sourceCoord,
      params.ParityPhase,
      params.InversionTopology
   );
   float codeProxy = ws5_rgb555_code_proxy(targetIndex);
   float excitation = ws5_drive_excitation(
      targetIndex,
      polarity,
      params.DriveDcOffset,
      params.SpatialRetention,
      params.SpatialCodeWeight,
      params.PolarityDriveWeight
   );
   if (vTexCoord.x < 0.25)
      return vec3(codeProxy);
   if (vTexCoord.x < 0.50)
      return signed_debug_color(excitation);
   if (vTexCoord.x < 0.75)
      return signed_debug_color(retained);
   return signed_debug_color(excitation - retained);
}

vec3 ws5_numeric_readback()
{
   ivec2 sourceCoord = original_coord(vTexCoord);
   ivec2 sourceSize = max(ivec2(global.OriginalSize.xy), ivec2(1));
   ivec2 leftProbe = clamp(
      // The WS2 retention ROM window spans x=48..191.  The one-eighth probe
      // is therefore an explicit outside control at 240x160.
      ivec2(sourceSize.x / 8, sourceSize.y / 2),
      ivec2(0),
      sourceSize - ivec2(1)
   );
   ivec2 rightProbe = clamp(
      // The centre probe is inside the stressed window.
      ivec2(sourceSize.x / 2, sourceSize.y / 2),
      ivec2(0),
      sourceSize - ivec2(1)
   );
   float leftState = clamp(
      (texelFetch(Source, leftProbe, 0).a - 0.5) * 4.0,
      -1.0,
      1.0
   );
   float rightState = clamp(
      (texelFetch(Source, rightProbe, 0).a - 0.5) * 4.0,
      -1.0,
      1.0
   );
   ivec3 leftTarget = rgb555_index(texelFetch(Original, leftProbe, 0).rgb);
   float leftPolarity = ws3_drive_polarity(
      global.FrameCount,
      leftProbe,
      params.ParityPhase,
      params.InversionTopology
   );
   float leftExcitation = ws5_drive_excitation(
      leftTarget,
      leftPolarity,
      params.DriveDcOffset,
      params.SpatialRetention,
      params.SpatialCodeWeight,
      params.PolarityDriveWeight
   );
   int band = clamp((4 * sourceCoord.y) / sourceSize.y, 0, 3);
   uint word = band == 0
      ? floatBitsToUint(leftState)
      : (band == 1
         ? floatBitsToUint(rightState)
         : (band == 2 ? global.FrameCount : floatBitsToUint(leftExcitation)));
   uint mask = 1u << uint(sourceCoord.x & 31);
   return (word & mask) != 0u ? vec3(1.0) : vec3(0.0);
}

vec3 ws8_exposure_numeric_readback()
{
   ivec2 sourceCoord = original_coord(vTexCoord);
   ivec2 sourceSize = max(ivec2(global.OriginalSize.xy), ivec2(1));
   ivec2 probe = clamp(
      ivec2(sourceSize.x / 2, sourceSize.y / 2),
      ivec2(0),
      sourceSize - ivec2(1)
   );
   vec3 exposure = texelFetch(Source, probe, 0).rgb;
   ivec3 targetIndex = rgb555_index(texelFetch(Original, probe, 0).rgb);
   uint packedTarget = uint(targetIndex.r)
      | (uint(targetIndex.g) << 5u)
      | (uint(targetIndex.b) << 10u);
   int band = clamp((5 * sourceCoord.y) / sourceSize.y, 0, 4);
   uint word = band == 0
      ? floatBitsToUint(exposure.r)
      : (band == 1
         ? floatBitsToUint(exposure.g)
         : (band == 2
            ? floatBitsToUint(exposure.b)
            : (band == 3 ? global.FrameCount : packedTarget)));
   uint mask = 1u << uint(sourceCoord.x & 31);
   return (word & mask) != 0u ? vec3(1.0) : vec3(0.0);
}

vec3 scan_diagnostic()
{
   int sourceRow = clamp(original_coord(vTexCoord).y, 0, 159);
   Ws3ScanEvent event = ws3_scan_event(
      sourceRow,
      params.LatchOffsetLines,
      params.OpticalDelaySeconds
   );
   float width = 1.5 / global.OutputSize.x;
   vec3 base = 0.12 * srgb_encode(clamp(texture(Source, vTexCoord).rgb, 0.0, 1.0));
   vec3 marker = vec3(0.0);
   if (abs(vTexCoord.x - event.rowStartSeconds / FRAME_SECONDS) <= width)
      marker.r = 1.0;
   if (abs(vTexCoord.x - event.latchSeconds / FRAME_SECONDS) <= width)
      marker.g = 1.0;
   if (abs(vTexCoord.x - event.opticalTimeInFrame / FRAME_SECONDS) <= width) {
      marker.b = 1.0;
      if (event.sourceFrameOffset == 1u)
         marker.r = 1.0;
   }
   return max(base, marker);
}

vec3 scan_event_diagnostic(int eventKind)
{
   int sourceRow = clamp(original_coord(vTexCoord).y, 0, 159);
   Ws3ScanEvent event = ws3_scan_event(
      sourceRow,
      params.LatchOffsetLines,
      params.OpticalDelaySeconds
   );
   float eventSeconds = eventKind == 0
      ? event.rowStartSeconds
      : (eventKind == 1 ? event.latchSeconds : event.opticalTimeInFrame);
   float width = 1.5 / global.OutputSize.x;
   float marker = abs(vTexCoord.x - eventSeconds / FRAME_SECONDS) <= width ? 1.0 : 0.0;
   vec3 color = eventKind == 0
      ? vec3(1.0, 0.0, 0.0)
      : (eventKind == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.25, 1.0));
   if (eventKind == 2 && event.sourceFrameOffset == 1u)
      color = vec3(1.0, 0.0, 1.0);
   return max(vec3(0.04), marker * color);
}

vec3 parity_phase_diagnostic()
{
   float polarity = ws3_drive_polarity(
      global.FrameCount,
      ivec2(0),
      params.ParityPhase,
      0.0
   );
   return polarity > 0.0 ? vec3(1.0) : vec3(0.0);
}

vec3 inversion_topology_diagnostic()
{
   float phase = ws3_inversion_spatial_phase(
      original_coord(vTexCoord),
      params.InversionTopology
   );
   return phase > 0.5 ? vec3(0.0) : vec3(1.0);
}

bool gtg_table_available(float fromCode, int toCode, int channel)
{
   int from0 = int(floor(clamp(fromCode, 0.0, 31.0)));
   int from1 = min(from0 + 1, 31);
   int to0 = clamp(toCode, 0, 31);
   int to1 = min(to0 + 1, 31);
   int channelRow = channel * 32;
   return texelFetch(GtgRateLut, ivec2(to0, channelRow + from0), 0).b >= 0.5
      && texelFetch(GtgRateLut, ivec2(to1, channelRow + from0), 0).b >= 0.5
      && texelFetch(GtgRateLut, ivec2(to0, channelRow + from1), 0).b >= 0.5
      && texelFetch(GtgRateLut, ivec2(to1, channelRow + from1), 0).b >= 0.5;
}

vec3 gtg_diagnostic()
{
   vec3 fromCode = optical_to_code(clamp(texture(Source, vTexCoord).rgb, 0.0, 1.0));
   ivec3 toCode = rgb555_index(texelFetch(Original, original_coord(vTexCoord), 0).rgb);
   int channel = min(int(floor(vTexCoord.x * 3.0)), 2);
   float status = params.GtgTableBackend < 0.5
      ? 0.25
      : (gtg_table_available(fromCode[channel], toCode[channel], channel) ? 1.0 : 0.0);
   vec3 value = vec3(fromCode[channel] / 31.0, float(toCode[channel]) / 31.0, status);
   if (vTexCoord.y < 3.0 / global.OutputSize.y)
      value = channel == 0 ? vec3(1.0, 0.0, 0.0)
         : (channel == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
   return value;
}

void main()
{
   int debugView = int(floor(params.DebugView + 0.5));
   if (debugView == 1) {
      // Native optical state before aperture and host-color conversion.
      FragColor = vec4(srgb_encode(clamp(texture(Source, vTexCoord).rgb, 0.0, 1.0)), 1.0);
      return;
   }
   if (debugView == 2) {
      // Left to right: polarity, external mismatch, retained DC, net mismatch.
      FragColor = vec4(drive_diagnostic(), 1.0);
      return;
   }
   if (debugView == 3) {
      // Row start red, latch green, optical onset blue, wrapped onset magenta.
      FragColor = vec4(scan_diagnostic(), 1.0);
      return;
   }
   if (debugView == 4) {
      // R=continuous from-code, G=target code, B=analytic/table/fallback status.
      FragColor = vec4(gtg_diagnostic(), 1.0);
      return;
   }
   if (debugView == 6 || debugView == 7 || debugView == 8) {
      // Independent row-start, latch, and optical-onset views.
      FragColor = vec4(scan_event_diagnostic(debugView - 6), 1.0);
      return;
   }
   if (debugView == 9) {
      // Frame parity phase only; spatial inversion is deliberately ignored.
      FragColor = vec4(parity_phase_diagnostic(), 1.0);
      return;
   }
   if (debugView == 10) {
      // Spatial inversion phase only; frame parity is deliberately ignored.
      FragColor = vec4(inversion_topology_diagnostic(), 1.0);
      return;
   }
   if (debugView == 11) {
      // Left to right: raw RGB555 code proxy, excitation, retained state, net.
      FragColor = vec4(ws5_spatial_diagnostic(), 1.0);
      return;
   }
   if (debugView == 12) {
      // Four bit bands: left/right retained float, FrameCount, left excitation.
      FragColor = vec4(ws5_numeric_readback(), 1.0);
      return;
   }
   if (debugView == 13) {
      // Five bit bands: exposure RGB, FrameCount, and current packed RGB555.
      FragColor = vec4(ws8_exposure_numeric_readback(), 1.0);
      return;
   }
   if (debugView == 14) {
      // Quarter-scale linear aperture energy for lossless unclipped averaging.
      FragColor = vec4(srgb_encode(0.25 * aperture_uniform_energy(vTexCoord)), 1.0);
      return;
   }

   vec3 panelLinear;
   if (debugView == 5) {
      // The comparison view is the only path that needs both evaluations.
      vec3 directPanel = panel_without_aperture(vTexCoord);
      vec3 aperturePanel = panel_with_aperture(vTexCoord);
      panelLinear = vTexCoord.x < 0.5 ? directPanel : aperturePanel;
      if (abs(vTexCoord.x - 0.5) < 1.0 / global.OutputSize.x) {
         FragColor = vec4(1.0);
         return;
      }
   } else if (params.ApertureEnabled > 0.5) {
      panelLinear = panel_with_aperture(vTexCoord);
   } else {
      panelLinear = panel_without_aperture(vTexCoord);
   }
   FragColor = vec4(panel_to_host(panelLinear), 1.0);
}
