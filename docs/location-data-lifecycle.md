# Location data lifecycle

Plug A Pro location data is reference/master data. It supports customer address capture, provider service-area selection, matching, admin location management, and WhatsApp/PWA fallback flows.

## Current hierarchy

The implemented schema uses `LocationNode` as a four-level tree:

- `PROVINCE`
- `CITY`
- `REGION`
- `SUBURB`

Example:

- Province: `Gauteng`
- City: `Johannesburg`
- Region: `JHB West / Roodepoort`
- Suburbs: `Roodepoort`, `Florida`, `Discovery`, `Little Falls`, `Radiokop`, `Ruimsig`, `Strubens Valley`, `Weltevreden Park`, `Wilgeheuwel`, `Randpark Ridge`, `Bromhof`, `Honeydew`, `Constantia Kloof`, `Horison`, `Helderkruin`, `Wilro Park`, `Witpoortjie`, `Allen's Nek`, `Kloofendal`, `Featherbrooke`, `Laser Park`, `Northcliff`.

Official municipal boundaries and Plug A Pro business regions are not always identical. The dataset keeps business-friendly service regions for matching and user selection, with aliases for common user language.

## Root cause note

No migration was found that intentionally truncates `location_nodes`. The loss/gap was caused by location data being treated like ordinary seed/demo data: the checked-in canonical dataset only covered Gauteng, Western Cape, and KwaZulu-Natal, and admin deletion allowed hard deletion for unused location leaves. A deploy or manual admin cleanup could therefore leave production with partial location reference data, and rerunning the old seed could not restore all 9 provinces or the missing Roodepoort suburbs.

Permanent guard added:

- Location import now upserts reference data by stable slugs.
- The canonical dataset validates that all 9 provinces exist.
- Production destructive reset is blocked.
- Imports abort if the incoming dataset would be suspiciously smaller than existing data.
- Admin delete soft-deactivates location nodes by default; hard delete requires `ALLOW_LOCATION_HARD_DELETE=true`.

## Commands

Run the protected importer:

```bash
npm run seed:locations
```

Audit production/staging location counts:

```bash
npm run audit:locations
```

The full demo seed also calls the protected location importer before creating demo records:

```bash
npm run db:seed
```

## Source strategy

The canonical checked-in source is `field-service/lib/service-areas/south-africa.ts` with postal-code exposure controlled by `field-service/lib/service-areas/postal-codes.ts`.

The current dataset is curated for product matching and onboarding rather than a blind national address dump. It includes all provinces, major metros/towns, and MVP-priority service regions. Expand it by adding regions/suburbs to the checked-in source, then run `npm run seed:locations`.

## Aliases

Aliases are resolved in `field-service/lib/location-aliases.ts`.

Examples:

- `GP` -> `Gauteng`
- `WC` -> `Western Cape`
- `KZN` -> `KwaZulu-Natal`
- `Joburg` / `Jozi` -> `Johannesburg`
- `Tshwane` -> `Pretoria`
- `eThekwini` -> `Durban`
- `JHB West` / `Johannesburg West` / `Joburg West` -> `JHB West / Roodepoort`

Do not expose internal aliases as selectable suburbs unless they are useful customer-facing names.

## Safety rules

- Do not truncate `location_nodes` in production.
- Do not hard-delete location nodes through admin tools unless there is a recovery export and `ALLOW_LOCATION_HARD_DELETE=true` is intentionally set outside production.
- Prefer soft deactivation for retired locations.
- Before destructive maintenance, export current `location_nodes` and dependent IDs from `addresses`, `customer_addresses`, `technician_service_areas`, and `candidate_pool`.
- If a WhatsApp/PWA selector has no structured data, allow a free-text/manual-review fallback and log the missing location. Do not hang the flow.

## Automated hardening

The repo includes these additional safeguards:

- `npm run export:locations` writes a timestamped JSON export of `location_nodes` before manual maintenance.
- `npm run audit:locations` fails if active province/city/region/suburb counts drop below protected thresholds or if required JHB West / Roodepoort suburbs are missing.
- `/api/cron/location-audit` runs the same audit behind `CRON_SECRET` and returns HTTP 500 on failure so monitoring can alert.
- `field-service/vercel.json` schedules the audit daily.

Recommended deployment gate:

```bash
npm run seed:locations
npm run audit:locations
```

Run `export:locations` before any planned master-data change:

```bash
npm run export:locations
```
