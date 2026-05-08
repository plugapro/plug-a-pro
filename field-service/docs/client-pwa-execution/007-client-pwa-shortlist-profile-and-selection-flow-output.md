# CLIENT-07 — Client PWA Shortlist, Profile, and Selection Flow

## Status
PASS

---

## Shortlist screen

**Header copy present:** yes

Both pages render:
```
We found {{count}} suitable provider(s)
Compare their experience, call-out fee, availability, and profile before choosing.
```

- `app/(customer)/requests/[id]/page.tsx` lines 167–171
- `app/requests/access/[token]/page.tsx` lines 379–382

**Provider card fields present:**

| Field | Authenticated page | Token page (compact card) |
|---|---|---|
| Provider name | yes | yes |
| Profile photo (avatarUrl) | yes | yes |
| Service category | yes | yes (added in this step) |
| Years of experience | yes | yes (added in this step) |
| Verification badge / label | yes | yes |
| Call-out fee | yes | yes |
| Rate / negotiable flag | yes | yes |
| Estimated arrival time | yes | yes |
| Rating (if available) | yes | yes (added in this step) |
| Completed jobs | yes | yes |
| Short bio | yes | yes |
| Skills | yes | yes (profile expansion) |
| Areas served | yes | yes (profile expansion) |
| Previous work / portfolio | yes | yes |

**Actions present:**

| Action | Authenticated page | Token page |
|---|---|---|
| View profile | yes (added this step — links to `/providers/{id}`) | yes (inline profile expansion via `?provider=`) |
| Select provider | yes | yes |
| Ask for more options | yes | yes |
| Cancel request | yes | yes |

---

## Provider profile screen

**File:** `app/(customer)/providers/[id]/page.tsx`

**Fields shown:**
- Provider name
- Bio
- Experience (via trust signals)
- Skills (via trust signals)
- Service areas (via trust signals)
- Evidence note (via trust signals)
- Verification badge (`verified` field)
- Portfolio URLs (provider-shared, labelled as such)
- Completed jobs count (derived from completed `Job` records, not a stored field)
- Rating (computed from `Review` records)
- Customer reviews with score, comment, date, and service category

**Protected fields hidden:** yes

The Prisma `select` block at line 54–67 includes only:
`id, name, bio, experience, skills, serviceAreas, evidenceNote, portfolioUrls, verified`

None of the following are selected or rendered:
- `phone` — excluded
- Private address / `lastKnownLat` / `lastKnownLng` — excluded
- `idNumber` — not on `Provider` model
- Admin notes / `ProviderNote` — not queried
- `kycStatus`, `suspendedReason`, `strikes`, `archivedAt` — excluded
- `status`, `payoutVerifiedAt` — excluded

**Flag gate:** `feature.customer.provider_browse` (not `client.provider.profiles` as some prior docs assumed — the actual flag key in code is `feature.customer.provider_browse`). This flag must be seeded before the provider profile page is accessible.

---

## Post-selection screen

**PROVIDER_CONFIRMATION_PENDING copy: present**

Authenticated page (`requests/[id]`) shows a warning-toned banner at lines 147–157:
```
Waiting for provider confirmation
You selected {name}. We notified them on WhatsApp and are asking them to confirm the job now. You will be notified once they accept.
```

Token page shows the same at lines 288–301 (`destination.screen === 'provider_confirmation'`) plus a flash banner at lines 276–286 on the `?selection=provider-confirming` query param.

Both satisfy the blueprint copy requirement:
> You selected {{provider_name}}. We're asking them to confirm the job now. You'll be notified once accepted.

---

## Credit deduction

**No credits deducted at selection: confirmed yes**

`selectShortlistedProviderForRequest` in `lib/customer-shortlists.ts` performs only:
- A DB status transition (`SHORTLIST_READY` → `PROVIDER_CONFIRMATION_PENDING`)
- A `providerShortlistItem.customerSelectedAt` timestamp write
- A WhatsApp notification to the provider

Credit deduction (`getProviderWalletBalanceReadOnly` / wallet write) happens in the provider acceptance flow (`selected-provider-acceptance.ts`), not at customer selection. The provider notification message explicitly states "Accepting this job uses 1 credit."

---

## Gaps closed

1. **"View profile" link added to authenticated shortlist cards** — `app/(customer)/requests/[id]/page.tsx`. Each card now renders `<Button asChild variant="outline"><Link href="/providers/{item.providerId}">View profile</Link></Button>` immediately above the Select/Selected state block.

2. **Compact token-page card enriched with Category, Experience, Rating** — `app/requests/access/[token]/page.tsx`. The `MiniStat` grid inside the per-item shortlist card previously showed only Call-out fee, Arrival, Rate, and Jobs. Category, Experience, and Rating are now included, matching the authenticated page and the blueprint field list.

---

## Pre-existing TS errors (not introduced in this step)

`tsc --noEmit` reports errors in:
- `__tests__/lib/provider-whatsapp-interest-flow.test.ts` — destructured tuple type narrowing in mock call matchers
- `__tests__/lib/whatsapp-bot-completion-flow.test.ts` — same pattern
- `app/(customer)/requests/[id]/page.tsx` lines 272/287/294 — `form action` prop typed as `(formData: FormData) => void | Promise<void>` but the bound server actions return `Promise<{ error?: string }>`. These were present before this step and are tracked separately.

---

## Tests

170 test files passed, 1 skipped, 0 failing (1939 tests, 4 todo).

No new test files added in this step. The shortlist/selection logic is covered by existing tests in:
- `__tests__/lib/selected-provider-acceptance.test.ts`
- `__tests__/lib/matching-expiry.test.ts`

---

## Files changed

- `field-service/app/(customer)/requests/[id]/page.tsx` — added "View profile" link to each shortlist card
- `field-service/app/requests/access/[token]/page.tsx` — added Category, Experience, Rating MiniStats to compact shortlist card
- `field-service/docs/client-pwa-execution/007-client-pwa-shortlist-selection-output.md` — this document
