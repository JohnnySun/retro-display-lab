# Reference and evidence policy

## Required record

Every source that constrains code, parameters, diagrams, screenshots, or
technical claims receives a stable model-local ID and records:

1. full title, author or organization, publication date, and canonical URL;
2. DOI, repository commit, document revision, or access date where applicable;
3. the exact fact, table, image region, equation, or file used;
4. how the source was transformed into a shader parameter or design decision;
5. limitations and assumptions;
6. redistribution status for copied or derived material.

Access date for the sources in this repository is 2026-08-18 unless a record
states otherwise.

## Evidence classes

- **Measured** — instrument data from an identified panel and protocol.
- **Literature-constrained** — an equation, mechanism, or range from relevant
  technical literature; this does not make an unmeasured device parameter a
  measurement.
- **Reference-image matched** — sampled from a documented, color-managed image.
- **Device-tuned** — a named modern target's compensation, with its measurement
  state disclosed.
- **Experimental** — a bounded, reproducible candidate awaiting stronger data.

Claims inherit the weakest evidence needed to produce them. Terms such as
"measured", "calibrated", and "physically exact" must not be inferred from a
neutral device setting or a visual match.

## Evidence map in code

Each `.slang` and `.slangp` file must point to its model's `REFERENCES.md` and
list the IDs relevant to that file. Model metadata must also expose the
reference file and evidence IDs. Validation checks these links locally so a
parameter cannot silently lose its provenance during refactoring.

## Images and game captures

Reference photographs are linked, not copied, unless redistribution permission
is explicit. Repository screenshots are first-party captures used to document
shader behavior; game imagery and trademarks remain the property of their
owners. A visual comparison must disclose device, viewport, shader state, and
whether frames are synchronized.

## Third-party code and data

A public URL is not a software or dataset license. If a fixed source snapshot
has no confirmed redistribution license, Retro Display Lab may cite and discuss
it but will not publish copied or derived code/data until permission is obtained
or the dependency is replaced by independently measured data.
