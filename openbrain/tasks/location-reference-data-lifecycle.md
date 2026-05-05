# Location reference data lifecycle

Date: 2026-05-05

Decision:
Plug A Pro location data is reference/master data. Province, city-region, town, suburb, and alias records must be imported idempotently, protected from destructive resets, and complete enough to support customer requests, provider service areas, and matching. JHB West/Roodepoort and other South African service regions must be fully populated.

Root cause:
The canonical location seed was incomplete and only represented three provinces. No truncating migration was found, but admin deletion could hard-delete unused location nodes and the old seed could not restore all South African reference data. This made production vulnerable to partial province/region/suburb loss.

Guardrail:
Use the protected `seed:locations` importer. It upserts by stable slugs, validates all nine provinces, blocks production destructive reset flags, aborts suspiciously shrinking imports, logs counts, and keeps admin deletes soft by default.
