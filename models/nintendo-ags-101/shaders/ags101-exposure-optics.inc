// Shared only by the WS7 presentation pass; endpoint feedback remains in pass 0.
// Provenance: ../REFERENCES.md
// Evidence: [AGS-COLOR-01] [AGS-GTG-01] [AGS-GTGDATA-01] [AGS-GTGENSEMBLE-01] [AGS-EXPOSURE-01]

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

// BEGIN GENERATED HCS COLOR: EXPOSURE
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
// END GENERATED HCS COLOR: EXPOSURE

vec3 hcs_measured_eotf(ivec3 index)
{
   return vec3(
      HCS_RGB555_EOTF[index.r].r,
      HCS_RGB555_EOTF[index.g].g,
      HCS_RGB555_EOTF[index.b].b
   );
}

vec3 source_eotf(ivec3 index)
{
   return params.HcsMeasuredColor > 0.5
      ? hcs_measured_eotf(index)
      : neutral_eotf(index);
}

float source_eotf_channel(int index, int channel)
{
   return params.HcsMeasuredColor > 0.5
      ? HCS_RGB555_EOTF[index][channel]
      : srgb_decode_channel(float(index) / 31.0);
}

vec3 hcs_measured_eotf_continuous(vec3 code)
{
   vec3 scaled = clamp(code, 0.0, 1.0) * 31.0;
   ivec3 low = ivec3(floor(scaled));
   ivec3 high = min(low + ivec3(1), ivec3(31));
   vec3 fraction = scaled - vec3(low);
   vec3 lowValue = vec3(
      HCS_RGB555_EOTF[low.r].r,
      HCS_RGB555_EOTF[low.g].g,
      HCS_RGB555_EOTF[low.b].b
   );
   vec3 highValue = vec3(
      HCS_RGB555_EOTF[high.r].r,
      HCS_RGB555_EOTF[high.g].g,
      HCS_RGB555_EOTF[high.b].b
   );
   return mix(lowValue, highValue, fraction);
}

vec3 source_eotf_continuous(vec3 code)
{
   return params.HcsMeasuredColor > 0.5
      ? hcs_measured_eotf_continuous(code)
      : srgb_decode(clamp(code, 0.0, 1.0));
}

float optical_channel_to_code(float optical, int channel)
{
   float value = clamp(optical, 0.0, 1.0);
   int highIndex = 31;
   int lowIndex = 0;

   // Keep the WS7 inverse EOTF identical to pass 0 while avoiding a
   // content-dependent 31-interval scan in every exposure segment.
   for (int stepIndex = 0; stepIndex < 5; stepIndex++) {
      int midpoint = (lowIndex + highIndex) / 2;
      if (value <= source_eotf_channel(midpoint, channel))
         highIndex = midpoint;
      else
         lowIndex = midpoint + 1;
   }

   int lowerIndex = max(highIndex - 1, 0);
   float lowValue = source_eotf_channel(lowerIndex, channel);
   float highValue = source_eotf_channel(highIndex, channel);
   return float(lowerIndex) + clamp(
      (value - lowValue) / max(highValue - lowValue, 1e-8),
      0.0,
      1.0
   );
}

vec3 optical_to_code(vec3 optical)
{
   return vec3(
      optical_channel_to_code(optical.r, 0),
      optical_channel_to_code(optical.g, 1),
      optical_channel_to_code(optical.b, 2)
   );
}

vec3 analytic_gtg_rate(vec3 fromCode, vec3 toCode)
{
   vec3 fromNormalized = clamp(fromCode, 0.0, 31.0) / 31.0;
   vec3 toNormalized = clamp(toCode, 0.0, 31.0) / 31.0;
   vec3 distance = abs(toNormalized - fromNormalized);
   vec3 movingUp = step(fromNormalized, toNormalized);
   vec3 base = mix(
      vec3(clamp(params.FallBase, 0.1, 1.0)),
      vec3(clamp(params.RiseBase, 0.1, 1.0)),
      movingUp
   );
   vec3 nearWeight = pow(vec3(1.0) - distance, vec3(2.0));
   vec3 midpoint = 0.5 * (fromNormalized + toNormalized);
   vec3 middleWeight = 4.0 * midpoint * (vec3(1.0) - midpoint) * nearWeight;
   vec3 frameAlpha = base
      * (vec3(1.0) - clamp(params.NearTransitionDrag, 0.0, 0.7) * nearWeight)
      * (vec3(1.0) - clamp(params.MidGrayDrag, 0.0, 0.5) * middleWeight);
   frameAlpha = clamp(frameAlpha, 0.025, 1.0 - 1e-7);
   return -log(vec3(1.0) - frameAlpha) / FRAME_SECONDS;
}

float decode_table_rate(vec3 packed, out bool available)
{
   vec3 bytes = floor(packed * 255.0 + 0.5);
   available = bytes.b >= 128.0;
   float encoded = bytes.r * 256.0 + bytes.g;
   return exp2(10.0 * encoded / 65535.0);
}

float table_rate_channel(float fromCode, int toCode, int channel, out bool available)
{
   float fromValue = clamp(fromCode, 0.0, 31.0);
   int from0 = int(floor(fromValue));
   int from1 = min(from0 + 1, 31);
   int to0 = clamp(toCode, 0, 31);
   int to1 = min(to0 + 1, 31);
   int channelRow = channel * 32;
   bool available00;
   bool available10;
   vec3 packed00 = texelFetch(GtgRateLut, ivec2(to0, channelRow + from0), 0).rgb;
   vec3 packed01 = texelFetch(GtgRateLut, ivec2(to1, channelRow + from0), 0).rgb;
   vec3 packed10 = texelFetch(GtgRateLut, ivec2(to0, channelRow + from1), 0).rgb;
   vec3 packed11 = texelFetch(GtgRateLut, ivec2(to1, channelRow + from1), 0).rgb;
   float rate00 = decode_table_rate(
      packed00,
      available00
   );
   float rate10 = decode_table_rate(
      packed10,
      available10
   );
   bool available01 = floor(packed01.b * 255.0 + 0.5) >= 128.0;
   bool available11 = floor(packed11.b * 255.0 + 0.5) >= 128.0;
   available = available00 && available01 && available10 && available11;
   float fromFraction = fromValue - float(from0);
   return mix(rate00, rate10, fromFraction);
}

vec3 gtg_rate(vec3 fromCode, ivec3 toCode)
{
   if (params.GtgTableBackend < 0.5)
      return analytic_gtg_rate(fromCode, vec3(toCode));
   bool redAvailable;
   bool greenAvailable;
   bool blueAvailable;
   vec3 tableRate = vec3(
      table_rate_channel(fromCode.r, toCode.r, 0, redAvailable),
      table_rate_channel(fromCode.g, toCode.g, 1, greenAvailable),
      table_rate_channel(fromCode.b, toCode.b, 2, blueAvailable)
   );
   if (redAvailable && greenAvailable && blueAvailable)
      return tableRate;

   vec3 analyticRate = analytic_gtg_rate(fromCode, vec3(toCode));
   return vec3(
      redAvailable ? tableRate.r : analyticRate.r,
      greenAvailable ? tableRate.g : analyticRate.g,
      blueAvailable ? tableRate.b : analyticRate.b
   );
}
