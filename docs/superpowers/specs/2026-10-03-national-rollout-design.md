# National Rollout — Design Spec

**Date:** 2026-10-03
**Status:** Approved (design), pending implementation plan
**Base:** `origin/main` @ `4fc7e8a0`, branch `feat/national-rollout`, worktree `worktrees/feat-national-rollout`
**Supersedes:** the matching half of `2026-07-04-jhb-wide-provider-onboarding-design.md` (onboarding was opened Joburg-wide there; matching and customer intake stayed on `jhb_west`)

## Goal

Open Plug A Pro nationally. Providers register in any province, matching runs in
every region, and customers anywhere in the location tree can request a quote.
The hardcoded province / city / region sets that defined the Johannesburg
footprint are deleted; from now on **a location is live if its `LocationNode`
is active**. Nothing else in vetting, KYC, approval or dispatch changes.

Why now: the fence was never enforced at registration, only at matching. Today
88 approved providers (71 of them with no active service-area row at all) sit
outside `jhb_west` and receive zero leads, and every new out-of-area applicant
joins them. "National registration only" would be a no-op for them.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Scope | **Full national** — registration, matching and customer requests open everywhere a node exists |
| Mechanism | **Data-driven liveness.** Delete the region/province/city sets; live = `LocationNode.active`. No new feature flag (switching back would need a data recompute anyway; the West Rand pilot flag remains the customer-side emergency brake) |
| Thin suburb data outside Gauteng | **Region-wide fallback included.** A provider whose suburb is not listed covers the whole region via a `REGION`-type service-area row |
| 42 taxonomy suburbs without a postcode | **Backfill** via the existing Nominatim reverse-geocode helper; keep the postcode-backed filter |
| National suburb dataset import | Out of scope (follow-up) |
| Existing inactive service-area rows | **Resync script**, dry-run first. Inactive rows in the pre-rollout matching region (`jhb_west`) are skipped — the fence never wrote those inactive, so they can only be deliberate removals; every other inactive row with an active node is re-activated. Commit run needs owner approval (production write) |
| Customers in empty regions | Existing location-aware "no providers yet → notify me" capture; flip `customer.home.notify_interest` ON at rollout |
| West Rand pilot allowlist (`launch.west_rand_pilot.*`, `lib/launch/west-rand-pilot.ts`) | Untouched, stays OFF |
| Branching | Fresh worktree off `origin/main` (the previous working branch was 91 commits behind and lacked PR #168) |

## The behavioural contract

**A provider anywhere in South Africa:**

1. Picks province → city → region → suburb(s) in the PWA or WhatsApp signup.
   Every active province, city and region in the database is offered; there is
   no "coming soon" wording or status suffix anywhere.
2. If their suburb is not listed, chooses **"My suburb isn't listed — cover the
   whole region"**. That stores one `REGION`-type `TechnicianServiceArea` row
   instead of suburb rows for that region.
3. Gets every service-area row written with **`active = true`**.
4. Is matchable the moment they are approved (and pass the unchanged KYC gate).
5. Already-registered providers with fence-inactive rows are re-activated by
   the resync script in one reviewed run.

**A customer anywhere in South Africa:**

1. Is never waitlisted for being outside Johannesburg. Web and WhatsApp accept
   any suburb node in the tree.
2. Where the chosen area has **zero active providers for the category**, sees
   the existing "no providers yet — notify me" capture (web: the coming-soon
   tile; WhatsApp: the `notify_me` step) and **never** gets a request that is
   created and expired in the same second.
3. Whose town is genuinely not in the tree still reaches the "My area isn't
   listed" → waitlist path.

**An admin:**

1. Pauses an area by deactivating its node in `/admin/locations`
   (`admin.crud.locations`). Inactive nodes vanish from every picker and are
   never written to new service-area rows.
2. Knows that pausing does **not** retroactively deactivate existing rows;
   matching reads `TechnicianServiceArea.active`, not `LocationNode.active`.
   To pause existing rows, run the resync script in its pause mode:
   `--deactivate-inactive-nodes` (dry run by default), then the same with
   `--commit --admin-email <admin>`. The default reactivation mode skips rows
   whose node is inactive, so a later resync cannot undo a pause.

## Architecture

### A. `field-service/lib/service-area-guard.ts` — becomes a waitlist helper

Delete: `ACTIVE_PROVINCE_SLUGS`, `ACTIVE_CITY_NODE_KEYS`, `ServiceGate`,
`ONBOARDING_ACTIVE_REGION_KEYS`, `MATCHING_ACTIVE_REGION_KEYS`,
`ACTIVE_REGION_KEYS_SET`, `ONBOARDING_PILOT_REGION_LABEL`,
`ACTIVE_PILOT_REGION_LABEL`, `ACTIVE_PILOT_CITY_LABEL`, `ServiceAreaStatus`,
`RegionServiceLiveStatus`, `serviceStatusForRegionKey`, `getRegionServiceStatus`,
`getCityServiceStatus`, `describeCityServiceStatus`,
`describeRegionServiceStatus`, `ACTIVE_CITY_KEYS`, `isActiveProvince`,
`isActiveCity`, `isOnboardingActiveRegion`, `isMatchingActiveRegion`,
`isActiveRegion`, `isInActiveServiceArea`.

Keep: `normalizeLocationKey`, `getRegionKeyFromSlug`, `addToServiceAreaWaitlist`,
and `OutsideServiceAreaError` only if a caller survives (otherwise delete it).
Rewrite the module header to say what it now does.

Every importer of a deleted symbol is updated in the same PR; the build must
fail if one is missed (no shims, no re-exports of the old names).

### B. Location options lose their status field

`field-service/lib/location-nodes.ts` stops stamping `serviceStatus` on
`ProvinceOption`, `CityOption`, `RegionOption`, `SuburbOption` and search
results. `field-service/lib/area-service-status.ts` (live-first sort + "Not yet
active" badge data) is deleted; pickers sort alphabetically.

UI consumers that drop status rendering:
- `components/provider/registration/ProviderRegistrationClient.tsx` — region
  option suffixes (`— live for leads` / `— open to register` / `— not live yet`)
  and the "Leads go live in the West Rand first…" caveat.
- `components/provider/ServiceAreaPicker.tsx` — status hints and the same caveat.
- `components/customer/SuburbPicker.tsx`, `components/customer/AreaSelector.tsx`
  — "Not yet active" badges and live-first ordering.
- `components/customer/BookingFlow.tsx` — the "Not in your area yet… Currently
  serving: Johannesburg" state (its trigger, the `waitlisted` response, no
  longer exists). The initial `provinceKey = 'gauteng'` picker default stays:
  it is a UI default, not a fence.

### C. Service-area rows are always active

`field-service/lib/provider-record.ts#upsertStructuredServiceAreas` writes
`active: true` for every node it processes (it already only reads
`active: true` nodes). The gate import goes. The same function is the only
writer used by approval (`lib/provider-application-service-areas.ts`,
`lib/provider-auto-approve.ts`, the admin applications page) and by both
backfill scripts (`scripts/backfill-tsa-from-legacy-service-areas.ts`,
`scripts/backfill-provider-service-areas.ts`); their gate arguments and
imports are removed.

`REGION` nodes are first-class: `areaType = 'REGION'`, `regionKey` from the
node (or derived from its slug), label = region label, `locationNodeId` = the
region node. This path already exists in the upsert; what changes is that
callers may now send region ids (see E and F).

### D. Matching — one alignment, no new logic

Matching has no region fence of its own; it only reads active rows. One
inconsistency is fixed so the region-wide fallback cannot over-grant coverage:

- `field-service/lib/matching/filter.ts#providerCoversAddress` currently
  returns `REGION_FALLBACK` for **any** active row whose `regionKey` matches the
  address. It must require `area.areaType === 'REGION'`, exactly as
  `field-service/lib/matching/service.ts` (Tier 2b) already does. A provider who
  picked one suburb never covers the whole region by accident.
- `lib/matching/readiness.ts` `ACTIVE_SERVICE_AREA` check stays as is (a
  provider still needs at least one active row).
- The candidate pool (`lib/matching/candidate-pool.ts`) is rebuilt after the
  resync run (see Data).

### E. Provider registration — PWA

`field-service/lib/provider-registration/pwa-flow.ts#resolveCanonicalServiceAreas`:
- Accepts nodes where `nodeType = 'SUBURB' AND postalCode IS NOT NULL` **or**
  `nodeType = 'REGION'`, all `active: true`.
- Validates the parent chain per type: SUBURB → REGION → CITY → PROVINCE;
  REGION → CITY → PROVINCE. The region must equal `input.regionId` (for a
  REGION node, the node itself must be `input.regionId`).
- `serviceAreas[]` label for a REGION node is the region label (normalised).
- Error copy `'Select a valid suburb from the list.'` becomes
  `'Select a valid suburb or region from the list.'`; the hierarchy error copy
  drops "and suburb".

`components/provider/registration/ProviderRegistrationClient.tsx` suburb step:
- Adds a checkbox-style option **"My suburb isn't listed — cover the whole
  &lt;region label&gt;"**. Selecting it puts the region node id into
  `locationNodeIds` and clears any suburb ids for that region; selecting a
  suburb clears the whole-region option. Per region it is one or the other.
- The "Select at least one suburb from the list." validation accepts a region
  id as satisfying the step.
- Chips in the review step render the region label like any other area.

`app/(provider)/provider/profile/actions.ts` removes the "REGION nodes must not
be written" rejection; `ServiceAreaPicker` already returns REGION results from
`/api/locations/search`.

### F. Provider registration — WhatsApp (`lib/whatsapp-flows/registration.ts`)

- `promptArea` builds its rows from `getProvinces()` (9 active provinces; the
  WhatsApp list limit is 10 rows per section). Row id `area__<slug>`;
  `PROVINCE_KEY_MAP` is deleted and the slug read from the id. "Other
  province" and its silent mapping to Gauteng are gone.
- The "Heads up — Pilot Phase … Gauteng only" interstitial, the city/region
  status descriptions and the "Coming soon area" message are removed. Cities
  and regions keep coming from `getCities` / `getRegions` (already DB-driven).
- Suburb step offers a **"Whole &lt;region&gt;"** row alongside the suburbs;
  choosing it stores the REGION node id. The free-text suburb fallback for
  regions with no suburbs is kept and additionally attaches the REGION node id,
  so such providers are matchable rather than label-only.
- `selectedRegionStatus` is removed from flow data,
  `lib/provider-onboarding/quality-gate-submission.ts` (passthrough) and
  `lib/provider-credit-copy.ts` (caveat). `lib/whatsapp-flows/provider-journey.ts`
  lists areas without "Active pilot" / "Coming soon" tags.

### G. Customer intake — web (`app/api/customer/bookings/route.ts`)

- Remove the `isInActiveServiceArea(city)` branch and the
  `isActiveRegion(regionKey)` branch (both waitlist + `{ waitlisted: true }`).
  The response shape loses `waitlisted`.
- Keep `checkPilotGate` (flag-gated, OFF) exactly as is.
- Keep the existing serviceability rejection for area/category combinations
  with zero active providers (`customer.home.serviceability_v2`, ON in prod).

### H. Customer intake — WhatsApp (`lib/whatsapp-flows/job-request.ts`)

- `renderProvinceList`, `renderCityList`, `renderRegionList` list every active
  node from the database (drop the `isActive*` filters). Section titles become
  neutral (`Provinces` / `Cities` / `Areas`); the `AREA_NOT_LISTED_ROW` stays as
  the last row.
- All "currently only available in Gauteng / Johannesburg / JHB West" copy
  (five sites) becomes one neutral template: "📍 We don't have *&lt;place&gt;*
  listed yet. We've saved your details and will WhatsApp you the moment we
  cover it - no action needed." — the waitlist row is written before the
  message, so the copy confirms the capture rather than asking for a reply
  nothing would handle.
- The pre-create re-check keeps its anti-spoofing purpose only: the resolved
  node must exist and be active; otherwise waitlist. The city-label and
  region-key conditions are removed. The legacy typed-city path accepts any
  city.
- **Empty-area guard:** before `createJobRequest`, if
  `countActiveProvidersFor({ area, category })` is 0 the flow routes to the
  existing `notify_me` step instead of creating the request. If the flow
  already does this, the test in §Testing proves it; if not, it is added here.

### I. Copy

| Where | Now | Becomes |
|---|---|---|
| `marketing/app/(marketing)/service-policy/page.tsx` | "currently serves Johannesburg West / Roodepoort … outside this area … waitlist" | "Plug A Pro operates across South Africa. Availability depends on independent providers near you; where we have none yet, you can ask to be notified the moment one joins." ("independent", not "verified": `verified provider` and `vetted` are banned public-claim terms in `marketing/content/marketing/banned-copy.ts`) (link to `/areas/johannesburg` stays) |
| Registration client, signup confirmation, signup service-areas section | "We're live in the West Rand first…" / "Leads go live in the West Rand first…" | Removed (no replacement sentence needed) |
| WhatsApp registration | "Onboarding across Johannesburg", "Coming soon - register now", "operating in Gauteng only", "Leads go live in JHB West first" | Removed; province rows carry no description |
| WhatsApp request flow | five Gauteng/JHB/JHB-West-only messages | one neutral "not listed yet" template (H) |
| `BookingFlow.tsx` | "Not in your area yet… Currently serving: Johannesburg" | Removed with its state |
| `lib/nudges/template.ts` | "first West Rand pilot jobs" | Unchanged (pilot nudge console, flag OFF) |

Marketing JSON-LD already says `areaServed: ZA`; the three SEO landing areas
(`marketing/content/areas/area-content.ts`) are unchanged.

## Data

### Postcode backfill (blocks registration in six provinces today)

44 SUBURB nodes in production have `postalCode = NULL` (Eastern Cape 10,
Mpumalanga 8, North West 7, Free State 5, Gauteng 5, Limpopo 5, Northern Cape
4). 42 of them are in the taxonomy; the other two
(`gauteng__johannesburg__jhb_west__strubensvalley` and
`gauteng__pretoria__pretoria_north__ga-rankuwa`) are stale nodes the seed no
longer produces and are left as they are. `getSuburbs`,
PWA validation and customer capture all filter `postalCode IS NOT NULL`, so these
suburbs are invisible and several regions offer nothing to pick.

- New script `field-service/scripts/backfill-suburb-postcodes.ts`: for every
  suburb in `lib/service-areas/south-africa.ts` with no entry in
  `SUBURB_POSTAL_CODES`, call `reverseGeocodeCoordinates(lat, lng)`
  (`lib/geocoding.ts`, Nominatim, sleep ≥1100 ms between calls), and append the
  resolved `slug → postcode` pairs to `lib/service-areas/postal-codes.ts`
  (generated file; keep its header). Print unresolved slugs.
- Unresolved slugs are looked up by hand (SA Post Office postcode lookup) and
  added with a `// manual` comment. The PR is not complete while any of the 42
  is missing.
- Production: run `pnpm tsx scripts/seed-locations.ts` (upsert-only, 25 %-drop
  guard, production reset forbidden) after deploy. Owner approves the run.

### Re-activation of existing rows

New script `field-service/scripts/reactivate-service-areas-national.ts`:

- Candidates are `technician_service_areas` rows with `active = false` and a
  non-null `locationNodeId` whose node is `active = true`.
- Rows whose `regionKey` is in `PRE_ROLLOUT_MATCHING_REGION_KEYS = ['jhb_west']`
  are **skipped**: the fence never wrote `jhb_west` rows inactive, so an
  inactive one can only be a deliberate removal (provider profile editor or
  admin). Every other candidate was written inactive by the fence and is
  re-activated.
- Why not a label test: `Provider.serviceAreas[]` is not maintained by the
  profile editor (it only flips `TechnicianServiceArea.active`), so "label still
  in the provider's list" would both re-activate removed areas and skip added
  ones. Residual risk of the region rule: an out-of-fence area a provider
  removed via the profile editor is re-activated; they can remove it again in
  the profile editor. Such rows were lead-less under the fence, so pruning them
  was rare.
- Default is **dry-run**: per provider, the rows to activate (label,
  `regionKey`, `areaType`), the rows skipped as pre-rollout-region removals, a
  **review** marker on any candidate whose `updatedAt` is more than 60 s after
  its `createdAt` (touched after creation — informational, autosync also bumps
  it), totals by `regionKey`, and the list of providers that would gain their
  first active row. `--commit` applies `active = true` in one transaction per
  provider and writes one `AuditLog`/`AdminAuditEvent` pair per provider via
  the existing audit helpers. `--providers a,b,c` restricts scope (also the
  documented way to resync after an admin pauses a region);
  `--exclude-providers a,b,c` drops providers the owner flagged in the dry-run.
- After commit: rebuild the matching candidate pool using the existing rebuild
  entry point in `lib/matching/candidate-pool.ts`.

Expected effect at commit time (production, 2026-10-01 snapshot):

| Group | Providers |
|---|---|
| ACTIVE providers with ≥1 inactive row | 88 |
| …of which currently have zero active rows (fully invisible) | 71 |
| …KYC verified / not started (legacy grace) / rejected (still gated) | 26 / 60 / 2 |
| APPLICATION_PENDING providers with inactive rows (activate on approval anyway) | 16 |
| Largest regions unlocked | jhb_north 20, east_rand 18, centurion_midrand 17, jhb_south 15, pretoria (3 regions) 12, jhb_east 7 |

### Flags

- `customer.home.notify_interest` → **ON** after deploy (owner flips). Turns
  dead tiles in empty areas into waitlist capture; requires
  `customer.home.serviceability_v2`, already ON.
- `provider.matchability.autosync` is ON, so any provider save after deploy
  also re-activates their rows through the same upsert.
- `customer.no_supply.immediate_notice` (OFF) is optional and independent; not
  part of this rollout.

No schema change. Additive only.

## Testing

- **Guard:** `__tests__/lib/service-area-guard.test.ts` shrinks to the
  surviving helpers; a type-level test (or build) proves the deleted names are
  gone.
- **Provider record:** `provider-record-area-matchability.test.ts` and
  `provider-record.test.ts` assert `active = true` for `jhb_north`,
  `cape_town_cbd` and `kimberley` nodes, and `areaType = 'REGION'` with the
  region's `regionKey` for a REGION node.
- **Matching:** `matching-filter` tests: a SUBURB row sharing the address's
  `regionKey` does **not** confer coverage; a REGION row does; the address's
  own suburb still wins `SUBURB_EXACT`.
- **PWA registration:** `pwa-flow` tests accept a REGION node with a valid
  CITY → PROVINCE chain, reject a REGION node whose id ≠ `regionId`, and still
  reject a SUBURB without postcode. Client test: whole-region toggle and suburb
  selection are mutually exclusive per region and either satisfies the step.
- **WhatsApp registration:** `registration.test.ts` — province list has 9 rows
  from the DB, no pilot interstitial, "Whole region" row stores the REGION id,
  free-text fallback attaches the REGION id.
- **Customer web:** `customer-bookings*.test.ts` — a Cape Town address is
  created, not waitlisted; the serviceability rejection for a zero-provider
  category still fires.
- **Customer WhatsApp:** `job-request.test.ts` — province list contains all
  provinces; a Durban suburb reaches `createJobRequest`; a suburb with zero
  active providers for the category routes to `notify_me`; "My area isn't
  listed" still writes the waitlist.
- **Scripts:** `reactivate-service-areas-national.test.ts` — dry-run writes
  nothing; a `jhb_west` inactive row is skipped; a row whose node is inactive
  is skipped; a `jhb_north` inactive row is activated; `--providers` restricts
  and `--exclude-providers` excludes; the review marker appears only when
  `updatedAt > createdAt + 60 s`; `--commit` flips the rest and writes one
  audit pair per provider.
  `backfill-suburb-postcodes.test.ts` — skips slugs that already have a
  postcode, appends resolved ones, lists unresolved ones.
- **Copy:** `marketing/__tests__` service-policy snapshot updated; a grep test
  asserts no remaining "West Rand first" / "Gauteng only" strings in
  `field-service/lib` and `field-service/components`.
- Playwright smoke suite unchanged (routes unchanged). `pnpm lint && pnpm test`
  green in CI.

## Out of scope

- National suburb / postcode dataset import (GeoNames or SA Post Office list)
  — follow-up spec; the region-wide fallback is the bridge.
- Retiring the West Rand pilot flag family, `lib/launch/west-rand-pilot.ts`,
  the launch-readiness and nudge consoles, and the ops-agent "outside pilot
  area" flags (all flag-gated or advisory).
- Marketing SEO landing areas and Meta ads geo-targeting (owner action after
  ship).
- `lib/location-audit.ts` / `lib/location-seed.ts` required-slug checks (still
  valid; the JHB West nodes still exist).
- Making matching consult `LocationNode.active` directly (today: pause = node
  off + resync).

## Rollout / safety

1. PR from `feat/national-rollout` → `main`; CI green; deploy. From this
   moment new registrations and approvals write active rows nationally;
   existing inactive rows are unchanged.
2. Production: run the postcode seed (owner approves).
3. Production: `reactivate-service-areas-national.ts` dry-run → review the
   per-region totals against the table above → owner approves → `--commit` →
   candidate-pool rebuild.
4. Flip `customer.home.notify_interest` ON.
5. Deploy marketing (service-policy copy).
6. Owner: widen Meta ads geo-targeting; the WhatsApp templates carry no
   region wording and need no resubmission.

Risks and mitigations:
- **Demand lands where supply is zero.** Mitigated by the location-aware
  serviceability gate (ON) and the notify-me capture; the WhatsApp empty-area
  guard (H) closes the last gap.
- **60 legacy providers with KYC not started become visible.** Unchanged KYC
  gate and grace cohort rules apply; matching behaviour for them is identical
  to today's `jhb_west` legacy cohort.
- **Rollback.** Reverting the PR restores the old gate for *new* writes only;
  already re-activated rows stay active (they are vetted providers). To pause a
  specific region, deactivate its node and run the resync with
  `--deactivate-inactive-nodes` (dry run, then `--commit --admin-email <admin>`).
- **Branch hygiene.** All work in `worktrees/feat-national-rollout`; stage by
  explicit path; no touching the main checkout.
