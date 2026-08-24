// Nintendo CGB-001 WS8/WS9 shared runtime controls and color helpers.
// Provenance: ../REFERENCES.md
// The fixed 45 degree illumination / 0 degree view geometry is deliberately
// absent from the UI: it is already represented by the WS1 lookup field.

layout(push_constant) uniform Push
{
   float ModelEnable;
   float ResponseEnsemble;
   float TemporalResponse;
   float ScanEnabled;
   float RetentionAmount;
   float ApertureAmount;
   float ModelExposure;
   float ColorPolicy;
   float DebugView;
} params;

#pragma parameter ModelEnable "CGB-001 physical model" 1.0 0.0 1.0 1.0
#pragma parameter ResponseEnsemble "CGB response (fast/nominal/slow)" 1.0 0.0 2.0 1.0
#pragma parameter TemporalResponse "CGB HR-TFT response" 1.0 0.0 1.0 1.0
#pragma parameter ScanEnabled "CGB row activation" 1.0 0.0 1.0 1.0
#pragma parameter RetentionAmount "CGB diagnostic retention envelope" 0.0 0.0 1.0 0.05
#pragma parameter ApertureAmount "CGB RGB aperture" 1.0 0.0 1.0 0.05
#pragma parameter ModelExposure "CGB model exposure" 1.0 0.25 2.0 0.05
#pragma parameter ColorPolicy "CGB color (reference/upstream)" 0.0 0.0 1.0 1.0
#pragma parameter DebugView "CGB diagnostic view" 0.0 0.0 11.0 1.0

float cgb_srgb_encode_channel(float linearValue)
{
   return linearValue <= 0.0031308
      ? 12.92 * linearValue
      : 1.055 * pow(max(linearValue, 0.0), 1.0 / 2.4) - 0.055;
}

vec3 cgb_srgb_encode(vec3 linearColor)
{
   return vec3(
      cgb_srgb_encode_channel(linearColor.r),
      cgb_srgb_encode_channel(linearColor.g),
      cgb_srgb_encode_channel(linearColor.b)
   );
}

ivec3 cgb_rgb555_index(vec3 encoded)
{
   return clamp(
      ivec3(floor(clamp(encoded, 0.0, 1.0) * 31.0 + 0.5)),
      ivec3(0),
      ivec3(31)
   );
}

vec3 cgb_command_coordinate(ivec3 rgb555)
{
   return vec3(rgb555) / 31.0;
}

float cgb_decode_residual_dc(float encoded)
{
   return clamp((encoded - 0.5) * 4.0, -1.0, 1.0);
}

float cgb_encode_residual_dc(float state)
{
   return 0.5 + 0.25 * clamp(state, -1.0, 1.0);
}

vec3 cgb_xyz_to_linear_srgb(vec3 xyz)
{
   return vec3(
      dot(vec3(3.2406255, -1.5372080, -0.4986286), xyz),
      dot(vec3(-0.9689307, 1.8757561, 0.0415175), xyz),
      dot(vec3(0.0557101, -0.2040211, 1.0569959), xyz)
   );
}
