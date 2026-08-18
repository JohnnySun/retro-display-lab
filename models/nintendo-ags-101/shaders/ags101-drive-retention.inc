// Provenance: ../REFERENCES.md
// Evidence: [AGS-ION-01] [AGS-FEED-01]
// Reduced residual-DC model from the cited adsorption/desorption equations.

float update_residual_dc(
   float state,
   float driveDcOffset,
   float adsorptionRatePerSecond,
   float desorptionRatePerSecond,
   float dtSeconds)
{
   float x = clamp(state, -1.0, 1.0);
   float u = clamp(driveDcOffset, -1.0, 1.0);
   float adsorption = max(adsorptionRatePerSecond, 0.0);
   float desorption = max(desorptionRatePerSecond, 0.0);
   float dt = max(dtSeconds, 0.0);
   if (dt <= 0.0)
      return x;

   // At zero external DC, Mizusaki eq. 5 is desorption-only.
   if (abs(u) <= 1e-7)
      return clamp(x * exp(-desorption * dt), -1.0, 1.0);

   // Signed normalized form of eq. 1 with an exact constant-input update.
   float rate = adsorption + desorption;
   if (rate <= 1e-12)
      return x;
   float equilibrium = adsorption * u / rate;
   return clamp(
      equilibrium + (x - equilibrium) * exp(-rate * dt),
      -1.0,
      1.0
   );
}

float drive_polarity(uint frameCount)
{
   return (frameCount & 1u) == 0u ? 1.0 : -1.0;
}

vec3 effective_drive_code(
   ivec3 sourceIndex,
   float polarity,
   float driveDcOffset,
   float residualDcState,
   float driveCodeCoupling)
{
   vec3 sourceCode = vec3(sourceIndex) / 31.0;
   float netDc = clamp(driveDcOffset, -1.0, 1.0)
      - clamp(residualDcState, -1.0, 1.0);
   return clamp(
      sourceCode + vec3(polarity * max(driveCodeCoupling, 0.0) * netDc),
      0.0,
      1.0
   );
}
