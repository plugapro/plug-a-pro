# Provider PWA Registration — Engineering Contracts

**For:** A developer (or Claude Code) implementing in `field-service/`.
**Status:** Engineering contracts — types, signatures, schemas, file paths. Drop-into-the-repo level of detail. Pairs with `04-implementation-plan.md` (sequencing) and `02-proposed-design.md` (UI/UX).
**Produced:** 6 June 2026 (repo-grounded).

> This document is **prescriptive about shape, not about names.** Adjust route names, exported symbols, and folder layout to match in-repo conventions. Where a decision is still open, you'll see **`DECIDE`** with the options + a default. Where a repo fact needs verification, you'll see **`CONFIRM`**.

---

## 0. Repo grounding (one screen)

- Provider PWA lives in **`field-service/`** (Next.js App Router, TS, Prisma, Supabase).
- **Reuse** (do not rebuild): the **identity-verification subsystem** (`ProviderIdentityVerification`, `ProviderIdentityDocument`, `/provider/verify/[token]`, `/api/provider/identity/upload`, `lib/storage.ts`), `Category`, `LocationNode`, `Provider` status machine, admin `requestMoreInfo` (freeform `notes`), the `crudAction()` wrapper for admin mutations.
- **Net-new** (this work): the registration capture surface (Steps 0–8 + returning states), a draft persistence mechanism, a registration session/OTP contract, a registration-context state resolver, work-evidence uploads (separate from identity), itemized more-info fix screen, `proxy.ts` allowlist update.
- **Untouched / don't repurpose:** `/provider/apply` (still redirects to `/provider/application`), provider sign-in OTP (`shouldCreateUser: false`), customer/provider same-number linking (separate-number MVP policy).

---

## 1. Open decisions (lock before Phase 2)

| # | Decision | Default | Touches |
|---|---|---|---|
| D1 | Registration OTP/session contract | New endpoint, registration-scoped session | Phase 1, server actions, `proxy.ts` |
| D2 | Identity timing | **Deferrable** during application, required before credit purchase | Phase 4, submit validator, F8/F10d copy |
| D3 | Customer/provider same-number policy | **Separate numbers** (MVP) | Phase 2, F1d screen, phone validator |
| D4 | Draft persistence mechanism | Add `ProviderApplicationDraft`; keep `ProviderApplication` for submitted/admin-reviewed records only | Phase 1, all server actions |
| D5 | Structured location persistence | Store `categorySlugs[]` + `locationNodeIds[]` on the draft, then copy canonical values to the submitted application where Phase 2 schema supports it | Phase 1, Step 3/4 |
| D6 | More-info model | **Freeform `notes` only (MVP)**, itemized as optional Phase 5 add-on | Phase 5, F10c |
| D7 | New route base | `/provider/register/*` (don't reuse `/provider/apply`) | Phase 1, `proxy.ts` |
| D8 | Reapplication policy after rejection | Allowed; cooldown TBD | Phase 4, F10e |

Until each decision is locked, treat the corresponding contract below as the **default** wired to that decision.

---

## 2. Route structure (App Router)

```
field-service/app/(provider)/provider/register/
   layout.tsx                       # RegisterShell (no bottom nav); draft autosave provider
   page.tsx                         # → resolver redirect
   welcome/page.tsx                 # F0 (server component; static)
   phone/page.tsx                   # F1 + F1c (client island for OTP)
   phone/conflict/page.tsx          # F1d (separate-number policy)
   profile/page.tsx                 # F2
   services/page.tsx                # F3 (loads Category list server-side)
   area/page.tsx                    # F4 (LocationNode search via server action)
   availability/page.tsx            # F5
   verify/page.tsx                  # F6 choice (hands off to existing /provider/verify/[token])
   evidence/page.tsx                # F7
   review/page.tsx                  # F8
   submitted/page.tsx               # F9
   status/page.tsx                  # F10 resolver host (renders pending/more-info/approved/rejected/draft)
```

**Existing (don't change):**
- `/provider/application` (status, read-only)
- `/provider/apply` (redirect → `/provider/application`)
- `/provider/handoff/[token]` (existing handoff)
- `/provider/verify/[token]` (identity capture; F6 hands off here)
- `/api/provider/identity/upload` (identity media upload)

**`proxy.ts` change (Phase 1):**
```ts
// Add to PUBLIC_PATHS (steps 0–1 must be reachable unauthenticated)
'/provider/register',
'/provider/register/welcome',
'/provider/register/phone',
'/provider/register/phone/conflict',
// CONFIRM: which steps require a registration session vs full provider session
```

---

## 3. Phase-keyed delivery map

Cross-reference each contract section with the phase that delivers it.

| Phase | Section in this doc |
|---|---|
| **P1 Repo-aligned setup** | §2 (proxy), §6 (`ProviderApplicationDraft`, hashed resume tokens, existing `callOutFee` mapping), §10 (feature flag), §11 (ID masking helper) |
| **P2 Capture screens (no identity)** | §4.1–4.4, §5 (F0–F5, F7, F8, F9), §7 (per-step Zod), §8 (steps 1–8 reads/writes), §9 (resolver: draft + pending + approved-by-policy) |
| **P3 Draft & resume** | §4.5–4.6, §8 (autosave + resume), §9 (full resolver + tokenised resume link), §12 (analytics: `draft_resumed`) |
| **P4 Identity step (reuse existing IDV)** | §4.7 (F6 + handoff), §5 (F6, F6b, F8 identity-status block, F10d) |
| **P5 Admin more-info round-trip** | §4.8, §5 (F10c) |
| **P6 Notifications, QA, analytics & launch** | §12 (analytics), §10 (flag rollout), §13 (test surface) |

---

## 4. Server-action contracts

All actions: **server actions** in `field-service/lib/provider-registration/*.ts` (or `app/.../actions.ts`), TypeScript, Zod-validated input, structured error responses (no thrown strings). Provider-facing actions are **session-scoped, rate-limited, audited via a registration audit log** (not `crudAction()` — that's reserved for admin mutations).

### 4.1 `startRegistrationOtp` (P1, D1)

```ts
// app/(provider)/provider/register/phone/actions.ts
export type StartOtpInput = { phone: string };
export type StartOtpResult =
  | { ok: true; resendInSec: number; expiresAt: string }
  | { ok: false; reason: 'invalid_phone' | 'rate_limited' | 'temporary' };

export async function startRegistrationOtp(input: StartOtpInput): Promise<StartOtpResult>;
```
**Side effects:** sends OTP to `phone` via registration-scoped channel (D1). Rate-limit: 3 sends per phone per 10 min.
**Anti-enumeration:** **must not** reveal whether `phone` is already a customer, provider, or unknown. Always uniform success (rate-limit excepted).

### 4.2 `verifyRegistrationOtp` (P1, D1, D3)

```ts
export type VerifyOtpInput = { phone: string; code: string };
export type VerifyOtpResult =
  | { ok: true; nextStep: 'profile' /* always first capture step after phone */; registrationSessionId: string }
  | { ok: true; nextStep: 'conflict'; reason: 'phone_is_customer' /* D3: separate-number policy */ }
  | { ok: true; nextStep: 'resolver'; existing: 'draft' | 'pending' | 'more_info' | 'approved' | 'rejected' }
  | { ok: false; reason: 'bad_code' | 'expired' | 'too_many_attempts' };

export async function verifyRegistrationOtp(input: VerifyOtpInput): Promise<VerifyOtpResult>;
```
**Side effects:** on `ok: true` with `nextStep: 'profile'`, creates a registration session (HttpOnly cookie, separate from provider sign-in session) and **does not** auto-create a `Provider` row (defer until first draft save). On `nextStep: 'conflict'`, no session is set.

### 4.3 `saveRegistrationDraft` (P2, P3, D4, D5)

```ts
export type StepKey =
  | 'profile' | 'services' | 'area' | 'availability'
  | 'identity_choice' | 'evidence';

export type DraftPatch = {
  profile?: ProfilePatch;
  services?: ServicesPatch;
  area?: AreaPatch;
  availability?: AvailabilityPatch;
  evidence?: EvidencePatch;
};

export type SaveDraftInput = { step: StepKey; patch: DraftPatch; markComplete?: boolean };
export type SaveDraftResult =
  | { ok: true; lastCompletedStep: number; updatedAt: string }
  | { ok: false; reason: 'validation' | 'session_expired' | 'temporary'; fieldErrors?: Record<string, string> };

export async function saveRegistrationDraft(input: SaveDraftInput): Promise<SaveDraftResult>;
```
**Behaviour:**
- Upserts a `ProviderApplicationDraft` row (D4) and advances `lastCompletedStep` when `markComplete = true`.
- Persists **canonical IDs** (D5): `categorySlugs[]`, `locationNodeIds[]` on the draft alongside display labels for eventual back-compat with the admin's existing display layer.
- Runs the **per-step Zod schema** server-side; client-side schema is the same module re-imported (§7).
- Idempotent: same patch twice ⇒ second is a no-op.
- Returns `lastCompletedStep` so the client can decide stepper position on resume.

### 4.4 `submitProviderApplication` (P2, D2)

```ts
export type SubmitResult =
  | { ok: true; applicationId: string; status: 'PENDING' }
  | { ok: false; reason: 'validation'; fieldErrors: Record<string, string>; missingSteps: StepKey[] }
  | { ok: false; reason: 'session_expired' | 'already_submitted' | 'temporary' };

export async function submitProviderApplication(): Promise<SubmitResult>;
```
**Submit validator (D2):** requires profile, services (with ≥1 canonical category id), area (≥1 LocationNode id), availability (≥1 day + working-hours window + call-out fee), T&Cs consent. **Identity is NOT required.** Evidence is optional.
**On success:** creates a submitted `ProviderApplication` with `status: PENDING`, copies the validated draft fields into the existing submitted-record columns, links the draft to the submitted application, and emits analytics + outbound notification trigger.
**Idempotent:** second submit of the same application returns `already_submitted`.

### 4.5 `resumeRegistration` (P3)

```ts
export type ResumeInput = { token: string }; // distinct from /provider/handoff/[token]
export type ResumeResult =
  | { ok: true; redirectPath: string; setSession: true }
  | { ok: false; reason: 'expired' | 'invalid' | 'consumed' };

export async function resumeRegistration(input: ResumeInput): Promise<ResumeResult>;
```
Token table fields: `id`, `draftId`, optional `applicationId`, `tokenHash`, `expiresAt`, `consumedAt?`, `purpose: 'resume' | 'more_info'`. Tokens are single-use; the raw token is shown only once and never stored.

### 4.6 `getDraftSnapshot` (P3)

```ts
export type DraftSnapshot = {
  draftId: string;
  submittedApplicationId?: string;
  lastCompletedStep: number;             // 0..8
  profile?: ProfileState;
  services?: ServicesState;
  area?: AreaState;
  availability?: AvailabilityState;
  evidence?: EvidenceState;
  identityVerification: IdentityStatus;   // read from ProviderIdentityVerification
  status: 'DRAFT' | 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
};

export async function getDraftSnapshot(): Promise<DraftSnapshot | null>;
```
Used by `layout.tsx` (Server Component) to hydrate the registration shell.

### 4.7 `beginIdentityVerification` (P4)

```ts
export type BeginIdvResult =
  | { ok: true; verifyUrl: string /* /provider/verify/[token] */; returnTo: string }
  | { ok: false; reason: 'already_verified' | 'pending' | 'temporary' };

export async function beginIdentityVerification(): Promise<BeginIdvResult>;
```
**Implementation:** thin wrapper over the **existing** identity-verification subsystem. **Do not reimplement** capture, consent, vendor handoff, or upload. The `returnTo` is `/provider/register/review` (F8); the existing IDV flow on success/return uses it to land the provider back in registration with status reflected.

### 4.8 `getMoreInfoFix` (P5, D6)

```ts
export type MoreInfoFix = {
  applicationId: string;
  freeformNote: string;                    // verbatim ProviderApplication.notes (current model)
  itemizedItems?: Array<{                  // present only after D6 Phase 5 schema add
    key: 'id_photo' | 'selfie' | 'address' | 'category' | 'availability' | string;
    label: string;
    hint?: string;
  }>;
};

export async function getMoreInfoFix(): Promise<MoreInfoFix>;
```
F10c renders `itemizedItems` if present, falling back to `freeformNote` verbatim — never both as the primary block.

### 4.9 `resubmitAfterMoreInfo` (P5)

```ts
export type ResubmitResult =
  | { ok: true; status: 'PENDING' }
  | { ok: false; reason: 'validation'; fieldErrors: Record<string, string> }
  | { ok: false; reason: 'temporary' };

export async function resubmitAfterMoreInfo(): Promise<ResubmitResult>;
```
Transitions `MORE_INFO_REQUIRED` → `PENDING`. Reuses the existing admin resume path semantics.

### 4.10 Evidence upload (P2)

```ts
// POST /api/provider/registration/evidence/upload   (multipart)
//   form: kind in ('work_photo' | 'certificate' | 'reference_doc'), file: File
// resp: { ok: true; objectKey: string } | { ok: false; reason: 'too_large'|'mime'|'temporary' }
```
Storage: private Supabase bucket; path `providers/registration/{applicationId}/{kind}/{uuid}`. Signed-URL admin access only. **Distinct from identity uploads** — do not route through `/api/provider/identity/upload`.

---

## 5. Component contracts

Files in `field-service/app/(provider)/provider/register/_components/` (or `field-service/components/provider/register/` — match repo convention). All client components flagged `'use client'`; everything else is RSC by default.

### `<RegisterShell>` (layout)
```ts
type RegisterShellProps = {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  title: string;
  subtitle?: string;
  onBack?: string;                  // href; default = previous step
  showSaveExit?: boolean;           // default true after step 1
  totalSteps?: 8;
  children: React.ReactNode;
};
```
Owns: header (back + "Step n of 8" + Save & exit), `<Stepper>`, scroll container with bottom padding for sticky footer.

### `<StepFooter>` (client)
```ts
type StepFooterProps = {
  primary: { label: string; onClick?: () => void; href?: string; disabled?: boolean; loading?: boolean };
  secondary?: { label: string; onClick?: () => void; href?: string };
  footnote?: string;
  layout?: 'inline' | 'stacked';    // F6 uses stacked
};
```

### Per-step (client islands)

```ts
type PhoneStepProps = { defaultPhone?: string; onSent: (phone: string) => void };
type OtpStepProps   = { phone: string; onVerified: (next: VerifyOtpResult['nextStep']) => void; onResend: () => Promise<{ ok: boolean }> };
type NumberConflictProps = { phone: string };           // F1d; pure presentational + retry CTA

type ProfileStepProps = { initial: Partial<ProfileState>; onSaved: () => void };
type ServicesStepProps = { categories: CategoryOption[]; initial: Partial<ServicesState>; onSaved: () => void };
type AreaStepProps = { initial: Partial<AreaState>; onSaved: () => void; searchAction: (q: string) => Promise<LocationOption[]> };
type AvailabilityStepProps = { initial: Partial<AvailabilityState>; onSaved: () => void };

type VerifyChoiceProps = { identityStatus: IdentityStatus; onVerifyNow: () => Promise<BeginIdvResult>; onLater: () => void };
type IdentityStatusBlockProps = { status: IdentityStatus; onVerify: () => void };  // used in F8 + F10d

type EvidenceStepProps = {
  initial: Partial<EvidenceState>;
  onSaved: () => void;
  uploadAction: (kind: EvidenceKind, file: File) => Promise<{ ok: true; objectKey: string } | { ok: false; reason: string }>;
};

type ReviewStepProps = {
  snapshot: DraftSnapshot;
  onEdit: (step: StepKey) => void;
  onSubmit: () => Promise<SubmitResult>;
};

type SubmittedScreenProps = { applicationId: string };
type DraftReturningProps    = { snapshot: DraftSnapshot };
type PendingReturningProps  = { applicationId: string; submittedAt: string };
type MoreInfoReturningProps = { fix: MoreInfoFix; onResubmit: () => Promise<ResubmitResult> };
type ApprovedReturningProps = { providerName: string; identityStatus: IdentityStatus };  // gates credits CTA
type RejectedReturningProps = { reason?: string; reapplyAllowed: boolean };
```

### Shared
```ts
type CategoryOption = { id: string; slug: string; label: string; iconKey?: string; requiresCert?: boolean };
type LocationOption = { id: string; slug: string; label: string; parent?: string };

type IdentityStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
type EvidenceKind = 'work_photo' | 'certificate' | 'reference_doc';
```

---

## 6. Data-model mapping

### 6.1 Prisma additions (Phase 1, additive only)

```prisma
// schema.prisma — Phase 1 patch

model ProviderApplicationDraft {                      // NEW (D4)
  id                     String   @id @default(cuid())
  phone                  String
  email                  String?
  name                   String?
  businessName           String?
  preferredContact       String?
  identityBasis          String?
  profilePhotoUrl        String?
  skills                 String[] @default([])         // display labels for back-compat
  categorySlugs          String[] @default([])         // canonical Category slugs
  serviceAreas           String[] @default([])         // display labels for back-compat
  locationNodeIds        String[] @default([])         // canonical LocationNode ids
  experience             String?
  bio                    String?
  availability           String?
  availabilityDays       String[] @default([])         // ['MON','TUE',...]
  availabilityHours      String?
  emergencyAvailable     Boolean  @default(false)
  callOutFee             Decimal? @db.Decimal(10, 2)   // maps to existing ProviderApplication.callOutFee
  travelRadiusKm         Int?
  evidenceFileUrls       String[] @default([])
  evidenceNote           String?
  reference1Name         String?
  reference1Mobile       String?
  reference2Name         String?
  reference2Mobile       String?
  consentAt              DateTime?
  lastCompletedStep      Int      @default(0)
  submittedApplicationId String?  @unique
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  submittedApplication   ProviderApplication? @relation(fields: [submittedApplicationId], references: [id], onDelete: SetNull)
  resumeTokens           RegistrationResumeToken[]

  @@index([phone])
  @@index([submittedApplicationId])
  @@map("provider_application_drafts")
}

model RegistrationResumeToken {                       // NEW — Phase 3
  id            String   @id @default(cuid())
  draftId       String
  applicationId String?
  tokenHash     String   @unique
  purpose       String                                 // 'resume' | 'more_info'
  expiresAt     DateTime
  consumedAt    DateTime?
  createdAt     DateTime @default(now())

  draft         ProviderApplicationDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  application   ProviderApplication?     @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  @@index([tokenHash])
  @@index([draftId])
  @@index([applicationId])
}
```

**Not added** (deliberately — reuse existing):
- No new `ProviderDocument` (identity docs live in `ProviderIdentityDocument`).
- No new identity storage bucket (reuse `lib/storage.ts` private bucket).
- No structured more-info items in MVP unless D6 flips (Phase 5 add-on).

### 6.2 Step → field write map

| Step | Writes to `ProviderApplication` | Writes elsewhere |
|---|---|---|
| 1 Phone | Draft `phone` (verified) | Registration session cookie |
| 2 Profile | Draft `name`, `preferredContact?`, `identityBasis?`, `profilePhotoUrl?`, `businessName?`, `email?` | — |
| 3 Services | Draft `skills[]` (labels), `categorySlugs[]` (canonical), `experience`, `bio?` | — |
| 4 Area | Draft `serviceAreas[]` (labels), `locationNodeIds[]` (canonical), `travelRadiusKm?` | — |
| 5 Availability | Draft `availabilityDays[]`, `availabilityHours`, `emergencyAvailable`, `callOutFee`, `availability` summary | — |
| 6 Identity (Verify now) | No parallel draft ID-document fields | `ProviderIdentityVerification`, `ProviderIdentityDocument` (existing flow) |
| 7 Evidence | — | Supabase Storage (private) + objectKey refs persisted on the application or join table — **CONFIRM** existing relation |
| 8 Review/Submit | Draft `consentAt`; submit creates `ProviderApplication: PENDING` and copies validated draft data | Notification trigger |

### 6.3 Field reads (state resolver)
Draft `lastCompletedStep`, submitted application `status`, `notes` (for F10c freeform), optional itemized review keys when D6 = on, `submittedAt`, `Provider.status`, and existing identity/credit-gate status from `provider-identity-status.ts` + `identity-verification/credit-gate.ts`.

---

## 7. Validation schemas (Zod — client + server)

One module: `field-service/lib/provider-registration/schemas.ts`. Shared between server actions and client islands.

```ts
import { z } from 'zod';

export const PhoneZA = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => /^(27\d{9}|0\d{9})$/.test(s), { message: 'Enter a valid SA mobile number' })
  .transform((s) => (s.startsWith('0') ? '27' + s.slice(1) : s));

export const OtpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const ProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(80),
  idType: z.enum(['SA_ID', 'PASSPORT']),
  preferredContact: z.enum(['WHATSAPP', 'CALL', 'SMS']).default('WHATSAPP'),
  businessName: z.string().trim().max(80).optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  photoUrl: z.string().url().optional(),
});

export const ServicesSchema = z.object({
  mainCategorySlug: z.string().min(1, 'Choose your main trade'),
  secondaryCategorySlugs: z.array(z.string()).max(6).default([]),
  experience: z.enum(['LT1', 'Y1_3', 'Y3_5', 'Y5_10', 'Y10_PLUS']),
  bio: z.string().trim().max(300).optional(),
});

export const AreaSchema = z.object({
  baseLocationId: z.string().min(1, 'Choose your base suburb'),
  servedLocationIds: z.array(z.string()).min(1, 'Add at least one area you can work in').max(20),
  travelRadiusKm: z.number().int().min(5).max(50).optional(),
});

export const AvailabilitySchema = z.object({
  availabilityDays: z
    .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .min(1, 'Pick at least one day'),
  availabilityHours: z.enum(['STANDARD', 'EXTENDED', 'TWENTYFOUR_SEVEN']),
  emergencyAvailable: z.boolean().default(false),
  callOutFee: z.number().min(0).max(20_000),
});

// SA ID validator with Luhn + date plausibility — used inside the EXISTING IDV flow,
// not at registration submit.
export const SaIdNumber = z
  .string()
  .regex(/^\d{13}$/, '13-digit SA ID required')
  .refine(luhnCheck, 'That ID number isn’t valid')
  .refine(plausibleDob, 'The date of birth in that ID isn’t valid');

export const ConsentSchema = z.object({
  tnc: z.literal(true, { errorMap: () => ({ message: 'Agree to the Provider Terms to continue' }) }),
});

// Submit validator (D2: identity NOT required)
export const SubmitSchema = z.object({
  profile: ProfileSchema,
  services: ServicesSchema,
  area: AreaSchema,
  availability: AvailabilitySchema,
  consent: ConsentSchema,
});
```

Per-step server actions validate the corresponding schema; `submitProviderApplication` validates `SubmitSchema` against the merged draft.

---

## 8. State resolver contract

`field-service/lib/provider-registration/resolver.ts`:

```ts
export type ResolverInput = {
  applicationStatus: 'NONE' | ApplicationStatus;
  lastCompletedStep: number;
  providerStatus?: ProviderStatus;
  identityStatus: IdentityStatus;
  hasActiveDraft: boolean;
};

export type ResolverOutput =
  | { route: '/provider/register/welcome' }
  | { route: `/provider/register/${'phone'|'profile'|'services'|'area'|'availability'|'verify'|'evidence'|'review'}` }
  | { route: '/provider/register/status'; state: 'draft' | 'pending' | 'more_info' | 'approved' | 'rejected' };

export function resolveProviderRegistrationDestination(input: ResolverInput): ResolverOutput;
```

**Rules (priority order):**
1. `applicationStatus = MORE_INFO_REQUIRED` → status/more_info (F10c).
2. `applicationStatus = REJECTED` → status/rejected (F10e).
3. `providerStatus = ACTIVE` → status/approved (F10d) — identity gate handled in the screen.
4. `applicationStatus = PENDING` → status/pending (F10b).
5. `hasActiveDraft = true` → next capture step after `lastCompletedStep`.
6. Otherwise → `/welcome`.

Called from: `app/(provider)/provider/register/page.tsx` (server) and from `resumeRegistration` (server action).

---

## 9. Storage & upload contract

| Surface | Endpoint | Bucket / Path | Notes |
|---|---|---|---|
| Identity (ID doc, selfie) | **`/api/provider/identity/upload` (existing)** | existing private bucket (`lib/storage.ts`) | **Do not duplicate.** F6b reuses this. |
| Work evidence / certificates / reference docs | **`/api/provider/registration/evidence/upload` (NEW)** | private bucket; path `providers/registration/{applicationId}/{kind}/{uuid}` | Signed-URL admin access only. MIME allowlist + max size enforced server-side. Client-side compression before upload. |
| Profile photo (optional) | TBD — small public-readable bucket or rendered via signed URL | **CONFIRM** existing convention | Low sensitivity; reuse customer-side pattern if present. |

Admin-side read: signed URLs from `lib/storage.ts`; no public URLs are issued for identity or evidence.

---

## 10. Feature flag + proxy

```ts
// field-service/lib/feature-flags.ts
export const FLAG = {
  PROVIDER_PWA_REGISTRATION: 'provider.pwa.registration',
} as const;
```
- **Flag-off (default):** `/provider/register/*` returns 404 (or redirects to provider sign-in); the existing "Apply via WhatsApp" footnote on `/provider-sign-in` stays the entry.
- **Flag-on:** registration routes live; `/provider-sign-in` shows the "Become a provider" CTA (already wired in the prototype).
- **Rollout:** internal → small cohort (region/category) → GA. One-flip rollback to WhatsApp fallback.
- **`proxy.ts` allowlist:** add unauthenticated registration paths (§2). Steps that require the registration session enforce it in the page handler, not the proxy.

---

## 11. POPIA / security helpers

```ts
// field-service/lib/provider-registration/id-masking.ts
export function maskIdNumber(value: string): string;        // '••••0184'
export function lastFour(value: string): string;            // '0184'
export function shouldRevealId(role: AdminRole): boolean;   // explicit reveal only
```
- ID number is **stored as-is today**; masking is **UI-only** at MVP. Encryption-at-rest tracks the existing POPIA backlog and is **out of scope** of this UI work.
- Provider terms consent timestamp captured in draft `consentAt`; the IDV flow captures its own identity-verification consent independently.
- Rate-limit: OTP (3/10min/phone), draft saves (60/min/session), evidence uploads (20/hour/session). Tune in `lib/rate-limit.ts` (CONFIRM helper name).
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`; never read from client JS.

---

## 12. Analytics events

Event names; no PII in payloads (no ID numbers, no document contents, no full phone — hash phone if a stable identifier is needed).

| Event | Where |
|---|---|
| `registration_started` | F0 → F1 transition |
| `otp_sent` / `otp_verified` / `otp_failed` | F1c |
| `number_conflict_shown` | F1d (D3 telemetry) |
| `step_completed` `{step}` | every `saveRegistrationDraft({ markComplete: true })` |
| `step_abandoned` `{step}` | client-side blur > N seconds on a step with no progress |
| `evidence_uploaded` `{kind}` / `evidence_upload_failed` `{reason}` | §4.10 |
| `identity_choice` `{value: 'now'|'later'}` | F6 |
| `identity_returned` `{status}` | landing back at `/register/review` from IDV |
| `application_submitted` | F8 → F9 success |
| `draft_resumed` `{via: 'deep_link'|'sign_in'}` | §4.5 |
| `status_viewed` `{state}` | F10a–e |

Funnel drop-off per step is the headline metric.

---

## 13. Test surface

| Layer | Targets |
|---|---|
| **Unit** | Zod schemas (`schemas.ts`), `maskIdNumber`, Luhn checker, resolver (`resolver.ts`), phone normalisation. |
| **Server-action integration** (Vitest + Prisma test DB) | `saveRegistrationDraft` upserts + idempotency; `submitProviderApplication` flips status, refuses incomplete; `resumeRegistration` token lifecycle. |
| **E2E** (Playwright, mobile viewport + WhatsApp-IAB UA) | Happy path; resume mid-flow; OTP errors; D3 conflict; identity defer → submit → approved + verify gate; identity verify-now → return → submit; more-info round-trip. |
| **Device lab** | Real low-end Android, in WhatsApp in-app browser, on metered data. Camera-denied → file fallback. Geolocation-denied → suburb search fallback. |
| **Security** | Anti-enumeration on `startRegistrationOtp`; rate limits enforced; private storage URLs are signed and expire; ID masking everywhere; consent timestamps recorded. |
| **Mocks** | `beginIdentityVerification` is mocked in non-prod (returns a fake `verifyUrl`); the **real** vendor handoff is only exercised in staging. |

---

## 14. What this contract deliberately leaves out

- **Vendor IDV UI** — owned by the existing identity-verification subsystem; no redesign here.
- **Admin Applications screen changes** — F10c reads existing freeform `notes`; the optional itemized field (D6) is the only admin-side schema impact, and it's deferred to Phase 5.
- **Credit purchase / Pay@ screens** — gated by the existing HIGH-assurance credit gate; registration only links to them from F10d.
- **WhatsApp template designs** — defined in the notification workstream; this contract names the *events* that trigger them, not the templates.
- **Encryption-at-rest for `idNumber`** — POPIA backlog; tracked separately.
- **Same-number multi-role identity** — explicitly out (D3 default); revisit as a future architecture decision.

---

## 15. Definition of done (per phase)

| Phase | Done means |
|---|---|
| **P1** | Schema migration merged with `ProviderApplicationDraft` + hashed resume token; flag wired with default OFF; `proxy.ts` updated; `maskIdNumber` shipped wherever ID renders; no behavioural change visible to users yet. |
| **P2** | `/provider/register/*` reachable with flag ON; F0–F5 + F7 + F8 + F9 work end-to-end against the test DB; submit creates `PENDING` with `categorySlugs[]` + `locationNodeIds[]` populated. |
| **P3** | Autosave + resume work end-to-end; `RegistrationResumeToken` lifecycle covered by tests; deep links land on the correct screen. |
| **P4** | F6 hands off to `/provider/verify/[token]`; returning lands on F8 (or wherever) with `identityStatus` reflected; F10d shows the credit gate; **no rebuild** of any identity capture or storage. |
| **P5** | Admin can `requestMoreInfo` (existing) and the provider sees F10c with the verbatim freeform `notes`; resubmit flips back to `PENDING`. |
| **P6** | Notifications wired (with SMS/email fallback); QA checklist green on a real low-end Android in WhatsApp in-app browser; analytics validated; POPIA/security sign-off; rollout plan executed; one-flip rollback to WhatsApp fallback verified. |
