# OpenBrain implementation note — 2026-05-10

## Decision

Move the homepage provider-story section above the problem-statement section to increase visibility of the local-provider narrative on first scroll.

## Change

- Updated marketing homepage section order in:
  - `marketing/app/(marketing)/page.tsx`

## Resulting top-of-page order

1. Hero
2. Provider Story (`Built for local service providers` / `From street signs to digital leads`)
3. Problem Statement

## Validation

- `npm run lint` (marketing) passed with existing warnings only
- `npx tsc --noEmit` (marketing) passed
- `npm test` (marketing) passed
