# Contributing

Contributions are welcome when their evidence and limits are explicit.

For a new model or target profile:

1. Identify the original display and the modern target display separately.
2. State source resolution, viewport, scale, color state, frontend, and driver.
3. Label every important parameter as measured, literature-constrained,
   reference-image matched, device-tuned, or experimental.
4. Add a model-local `REFERENCES.md` with stable evidence IDs, exact versions or
   DOIs, transformation notes, limitations, and redistribution status. Reference
   those IDs in every affected shader and preset.
5. Add a reproducible test or explain why the claim cannot yet be automated.
6. Do not commit ROMs, copyrighted screenshots, or third-party data without a
   redistribution license.

Read the [reference and evidence policy](docs/reference-policy.md) before adding
technical claims or external data.

Run `npm test` before opening a pull request.
