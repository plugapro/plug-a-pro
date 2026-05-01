# Plug-A-Pro — Payfast Provider Wallet Top-Up
## Claude Code Implementation Task Instructions

**Project:** Plug-A-Pro field service marketplace  
**App:** `field-service`  
**Stack:** Next.js App Router · Prisma · Postgres · Supabase Auth · Vitest · Playwright  
**Payment rail:** Payfast (existing merchant account)  
**Purpose:** Allow service providers to buy Plug-A-Pro Credits via Payfast and spend those credits to unlock verified matched leads.

---

### Hardening posture — apply before every task

Before touching any code, run:

```bash
git branch --show-current
git status --short
git log --oneline -5
```

If uncommitted changes exist, do not overwrite, format, stage, or modify unrelated files. Work only on files directly relevant to the task at hand.

Treat the following as high-risk areas requiring extra care:

- Payment and payout logic
- Auth and session handling
- WhatsApp production messaging
- Prisma schema migrations
- Environment variable configuration

If you are uncertain about any step, stop and report what you found and what you need before proceeding.

---

### Architecture vocabulary in use

| Term | Meaning in this codebase |
|---|---|
| Module | A cohesive folder of related logic (e.g. `provider-wallet/`) |
| Interface | The public contract a module exposes (e.g. a service function signature) |
| Implementation | The internal code satisfying the interface |
| Depth | How much complexity is hidden behind an interface |
| Seam | A boundary where one module hands off to another |
| Adapter | Code that translates between an external API and internal types |
| Leverage | Reusing an existing seam rather than duplicating logic |
| Locality | Keeping related changes close together rather than spread across unrelated files |

---

### Package top-up pricing — reference for all tasks

| Package | Price (ZAR) | Credits issued | Effective rate |
|---|---|---|---|
| Starter | R100 | 5 | R20 / credit |
| Growth | R200 | 10 | R20 / credit |
| Pro | R500 | 25 | R20 / credit |

- 1 Plug-A-Pro Credit = R20
- Minimum top-up is R100
- R50 is not exposed in the default UI during pilot
- Do not use the word "tokens" anywhere in product-facing copy

---

## Task 0 — Read-only Payfast integration discovery

**Mode:** Read-only analysis

### Objective

Inspect the existing `field-service` codebase and produce a technical discovery note that maps everything relevant to the Payfast provider wallet top-up integration before any code is written.

### Why it is needed

Building payment infrastructure on top of an unknown codebase without discovery leads to conflicts with existing conventions, duplicated models, broken auth patterns, and missed seams. This task must complete before any implementation begins.

### Files and areas to inspect

```
field-service/prisma/schema.prisma
field-service/src/
field-service/docs/superpowers/specs/
field-service/docs/superpowers/plans/
CONTEXT.md (repo root if present)
CONTEXT-MAP.md (repo root if present)
docs/adr/ (if present)
```

Look specifically for:

- Existing `Payment`, `Transaction`, or `Invoice` models — understand their scope and confirm they are customer/booking-oriented and must not be reused
- Provider model — where provider identity, KYC status, and profile data live
- Auth pattern — how authenticated provider identity is resolved server-side (Supabase Auth session, middleware, server context)
- Admin role and mutation conventions — look for `crudAction()`, admin action wrappers, or audit log patterns
- WhatsApp module — locate `interactive sends`, `template sends`, and `message event audit` files; understand how messages are enqueued or dispatched
- Existing environment variable conventions — `.env.example`, `env.ts` validation, or similar
- Test setup — confirm Vitest and Playwright are configured; find `vitest.config.ts` and `playwright.config.ts`; locate example unit and integration tests
- OpenBrain docs — read any existing spec or plan files to understand the writing style and format before adding new ones

### Business rules

- Provider wallet top-ups are a separate financial flow from customer booking payments
- Do not recommend any reuse of the existing `Payment` model or its associated tables
- Provider identity must always come from authenticated server session, never from client-provided fields

### Technical requirements

Produce a discovery note covering:

1. Schema summary — list existing models and their ownership (customer-side vs provider-side vs shared)
2. Provider identity — how a logged-in provider's ID is resolved in server actions or API routes
3. KYC status — where it is stored or whether it needs to be added
4. Auth seam — the function or middleware that returns the authenticated provider context
5. Admin convention — how admin mutations are structured
6. WhatsApp seam — the function or pattern used to trigger a WhatsApp message
7. Test framework — commands to run unit and integration tests
8. Environment variable pattern — how secrets and config are loaded and validated
9. Missing gaps — anything that does not yet exist and will need to be built before the wallet integration can proceed
10. Recommended implementation sequence for Tasks 1–10

### Security requirements

- Do not expose or log any real credentials found in `.env` files
- Do not run any migration or data-modifying command in this task

### Tests required

None in this task. Document the test setup found for use in subsequent tasks.

### Acceptance criteria

- Discovery note is produced and saved to `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md`
- Existing `Payment` model scope is confirmed and documented
- Provider auth seam is identified with file path and function name
- WhatsApp send seam is identified with file path
- Admin mutation convention is identified with example
- Test commands are confirmed working
- All gaps are listed clearly with a recommended resolution
- No production code was written or modified

### Risks and edge cases

- The repo may have partial payment code that predates a clean architecture decision
- KYC may not exist yet — flag this clearly if so
- The provider model may be embedded in a generic `User` model — clarify the separation

### Commands to run

```bash
git branch --show-current
git status --short
git log --oneline -5
cat field-service/prisma/schema.prisma
find field-service/src -name "*.ts" | xargs grep -l "Payment\|payment" | head -20
find field-service/src -name "*.ts" | xargs grep -l "provider\|Provider" | head -20
find field-service/src -name "*.ts" | xargs grep -l "whatsapp\|WhatsApp\|sendMessage" | head -20
find field-service/src -name "*.ts" | xargs grep -l "crudAction\|adminAction\|auditLog" | head -20
cat field-service/vitest.config.ts 2>/dev/null || echo "vitest config not found"
cat .env.example 2>/dev/null || cat field-service/.env.example 2>/dev/null || echo "no .env.example found"
ls field-service/docs/superpowers/specs/ 2>/dev/null
ls field-service/docs/superpowers/plans/ 2>/dev/null
```

### What Claude Code must not touch

- Any existing Prisma schema models
- Any existing Payment or booking logic
- Any `.env` files
- Any WhatsApp production send paths
- Any Supabase Auth configuration

### OpenBrain documentation notes

Save discovery output as:
`field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md`

---

## Task 1 — Define provider wallet payment intent model for Payfast

**Mode:** Implementation

### Objective

Add the Prisma schema models needed to support Payfast provider wallet top-up payment intents. These models are the data foundation for all subsequent tasks.

### Why it is needed

Wallet crediting must be auditable and traceable to a specific payment event. The payment intent captures the intent to pay, the Payfast interaction, and the outcome — separately from the wallet ledger, which records the credit result. These must not be conflated into a single table.

### Files and areas to inspect or modify

```
field-service/prisma/schema.prisma
field-service/prisma/migrations/
```

### Business rules

- Do not reuse or extend the existing `Payment` model
- Provider wallet top-ups are entirely separate from customer booking payments
- A payment intent represents a single top-up attempt and its lifecycle
- Credits are never issued at intent creation — only after verified successful Payfast ITN
- Store monetary amounts in cents (integer), not rands (float)
- Store credits as integers, not decimals
- Credit pricing (R20/credit) must not be hardcoded — store it as a configuration value or derive it from a constant that can be updated without a schema change
- `m_payment_id` in Payfast corresponds to the internal payment intent ID and must be stored

### Technical requirements

Add the following models. Adapt field naming to match existing Prisma conventions found in Task 0.

**ProviderWalletTopUpIntent**

```
id                    String    @id @default(cuid())
providerId            String
amountCents           Int                         -- amount the provider is expected to pay, in ZAR cents
creditsToIssue        Int                         -- credits to be issued if payment succeeds
paymentMethod         ProviderTopUpMethod         -- PAYFAST_CARD | PAYFAST_EFT | PAYFAST_SCODE | MANUAL_EFT
status                ProviderTopUpStatus
payfastPaymentId      String?                     -- payment_id returned by Payfast in ITN
payfastMPaymentId     String    @unique           -- our m_payment_id sent to Payfast (same as id or derived)
payfastSignature      String?                     -- signature received in ITN for audit
itnReceivedAt         DateTime?                   -- when the ITN was first received
itnPaymentStatus      String?                     -- raw payment_status from Payfast ITN
itnAmountCents        Int?                        -- raw amount_gross from ITN in cents for validation
creditedAt            DateTime?                   -- when wallet was credited
creditedLedgerEntryId String?                     -- FK to the resulting ledger entry
adminNote             String?
createdAt             DateTime  @default(now())
updatedAt             DateTime  @updatedAt
provider              Provider  @relation(...)
```

**ProviderTopUpMethod** (enum)

```
PAYFAST_CARD
PAYFAST_EFT
PAYFAST_SCODE
MANUAL_EFT
```

**ProviderTopUpStatus** (enum)

```
CREATED
PENDING_PAYMENT
ITN_RECEIVED
CREDITED
FAILED
CANCELLED
EXPIRED
REVERSED
```

**ProviderWallet** (if not already added by wallet foundation task)

```
id                    String    @id @default(cuid())
providerId            String    @unique
paidCreditBalance     Int       @default(0)
promoCreditBalance    Int       @default(0)
reservedCreditBalance Int       @default(0)
status                ProviderWalletStatus  @default(ACTIVE)
createdAt             DateTime  @default(now())
updatedAt             DateTime  @updatedAt
```

**ProviderWalletStatus** (enum)

```
ACTIVE
SUSPENDED
CLOSED
```

**ProviderWalletLedgerEntry** (if not already added)

```
id                    String    @id @default(cuid())
walletId              String
providerId            String
entryType             WalletLedgerEntryType
creditType            WalletCreditType
amountCredits         Int
balanceAfterPaid      Int
balanceAfterPromo     Int
referenceType         String
referenceId           String
description           String
metadata              Json?
createdAt             DateTime  @default(now())
createdBy             String
```

**WalletLedgerEntryType** (enum)

```
TOPUP_CREDIT
PROMO_CREDIT
LEAD_UNLOCK_DEBIT
LEAD_REFUND_CREDIT
ADMIN_ADJUSTMENT
PROMO_EXPIRY
PAYMENT_REVERSAL
```

**WalletCreditType** (enum)

```
PAID
PROMO
```

Add indexes:

```
@@index([providerId])              -- on ProviderWalletTopUpIntent
@@index([status])                  -- on ProviderWalletTopUpIntent
@@index([payfastMPaymentId])       -- on ProviderWalletTopUpIntent (unique)
@@index([providerId, createdAt])   -- on ProviderWalletLedgerEntry
@@index([entryType])               -- on ProviderWalletLedgerEntry
@@index([referenceId])             -- on ProviderWalletLedgerEntry
```

### Security requirements

- Do not store Payfast merchant key or passphrase in the database
- Do not store raw bank account numbers in the intent model
- `payfastSignature` stored in the intent is for audit only — it must never be used to re-verify after the fact without re-computing the hash

### Tests required

- Verify that `ProviderWalletTopUpIntent` and `ProviderWallet` can be created via Prisma client in a test database
- Verify that unique constraint on `payfastMPaymentId` is enforced
- Verify that `paidCreditBalance` and `promoCreditBalance` default to 0

### Acceptance criteria

- Migration is generated cleanly with `prisma migrate dev`
- `prisma generate` passes without errors
- No existing models are altered
- Existing `Payment` model is untouched
- All new enums are defined
- All indexes are present in the migration file
- Tests pass

### Risks and edge cases

- If `Provider` model uses a different primary key type (e.g. UUID vs cuid), align the `providerId` type accordingly
- If the schema already has partial wallet models from a previous task, reconcile rather than duplicate
- Do not run `prisma migrate deploy` — use `prisma migrate dev` only in development

### Commands to run

```bash
git branch --show-current
git status --short
npx prisma validate
npx prisma migrate dev --name add_provider_wallet_and_topup_intent
npx prisma generate
npx vitest run --reporter=verbose src/**/*wallet*.test* 2>/dev/null || echo "no wallet tests yet"
```

### What Claude Code must not touch

- Existing `Payment`, `Booking`, `Invoice`, or customer-side models
- Existing migrations (do not edit, only add new)
- Any application logic files in this task — schema only

### OpenBrain documentation notes

Update `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md` with a note confirming the schema models added, their purpose, and the migration name.

---

## Task 2 — Build Payfast adapter and signature utility

**Mode:** Implementation

### Objective

Build a self-contained Payfast adapter module that handles all Payfast-specific logic: checkout payload construction, MD5 signature generation, ITN signature verification, IP allowlist validation, and amount validation. This module is the only place in the codebase that knows about Payfast internals.

### Why it is needed

Payfast-specific logic must be isolated behind a clean adapter interface (seam) so that the wallet crediting logic, the checkout creation logic, and the ITN handler never need to know how Payfast works internally. This makes the integration testable without hitting Payfast APIs and replaceable if the payment provider changes.

### Files and areas to inspect or modify

```
field-service/src/modules/payments/payfast/   (create this module)
field-service/src/modules/payments/payfast/adapter.ts
field-service/src/modules/payments/payfast/signature.ts
field-service/src/modules/payments/payfast/types.ts
field-service/src/modules/payments/payfast/adapter.test.ts
field-service/src/modules/payments/payfast/signature.test.ts
```

Adapt the module path to match the existing project module structure found in Task 0.

### Business rules

- The Payfast adapter must not know about the provider wallet
- The adapter takes internal top-up data and returns a Payfast-ready checkout payload
- Signature generation and verification must use the same algorithm
- The adapter must distinguish between sandbox and live environments using an environment variable
- The return URL must never be treated as payment proof — this must be documented in the adapter code as a comment

### Technical requirements

**Payfast configuration (from environment — never hardcoded)**

```
PAYFAST_MERCHANT_ID
PAYFAST_MERCHANT_KEY
PAYFAST_PASSPHRASE
PAYFAST_SANDBOX      -- "true" | "false"
PAYFAST_NOTIFY_URL   -- the ITN endpoint URL
PAYFAST_RETURN_URL   -- redirect on success (UI only, not payment proof)
PAYFAST_CANCEL_URL   -- redirect on cancel
```

**Signature generation**

Before implementing, inspect official Payfast documentation or any existing Payfast utilities in the repo. The signature is an MD5 hash. The algorithm is:

1. Collect all non-empty parameters in the correct order
2. URL-encode values
3. Concatenate as a query string
4. Append the passphrase if set (`&passphrase=xxx`)
5. MD5 hash the resulting string
6. Store the result as lowercase hex

Do not invent the parameter order — use the official Payfast documentation. Instruct Claude Code to reference the official Payfast developer docs at `https://developers.payfast.co.za` if no existing utility is found in the repo.

**Checkout payload builder**

The adapter must return all required Payfast fields for a provider top-up checkout. Include:

```
merchant_id
merchant_key
return_url
cancel_url
notify_url
m_payment_id        -- maps to our internal intent ID
amount              -- formatted as "100.00" (two decimal places, ZAR)
item_name           -- e.g. "Plug-A-Pro Credits — 5 credits"
item_description    -- e.g. "R100 top-up · 5 Plug-A-Pro Credits"
email_address       -- provider email if available
name_first          -- provider first name if available
payment_method      -- "cc" for card, "eft" for EFT, "scode" for SCode (confirm exact values from Payfast docs)
signature           -- computed last, over all other fields
```

**ITN verification**

The ITN handler (Task 4) will call the adapter to verify an incoming Payfast notification. The adapter must expose a `verifyItn(payload, remoteIp)` function that:

1. Validates the source IP against Payfast's known IP allowlist (look up current list from Payfast docs — do not hardcode a stale list)
2. Recomputes the MD5 signature over the received parameters (excluding the `signature` field itself)
3. Compares computed signature to received signature (constant-time comparison preferred)
4. Returns a typed result: `{ valid: true }` or `{ valid: false, reason: string }`

**Types**

Define clear TypeScript types for:

```typescript
PayfastCheckoutPayload
PayfastItnPayload
PayfastVerificationResult
PayfastConfig
```

**Payment method mapping**

Map internal `ProviderTopUpMethod` enum values to Payfast payment method strings. Confirm the exact Payfast strings from their documentation before implementing.

### Security requirements

- Never log the Payfast passphrase
- Never log the Payfast merchant key
- Use constant-time string comparison for signature verification (use `crypto.timingSafeEqual` or equivalent)
- IP validation must fail closed — if the remote IP cannot be determined, treat as invalid
- Do not pass sandbox credentials to the live endpoint or vice versa
- All Payfast config must be read from environment variables — never hardcoded

### Tests required

**signature.test.ts**

- Given a known set of parameters and passphrase, verify the MD5 output matches the expected signature
- Verify that an empty passphrase produces the correct result
- Verify that parameter ordering matters (reordering params produces a different hash)

**adapter.test.ts**

- Given valid top-up intent data, `buildCheckoutPayload()` returns all required Payfast fields
- `buildCheckoutPayload()` formats amount correctly as a two-decimal string
- `verifyItn()` returns `{ valid: true }` for a correctly signed payload from a known Payfast IP
- `verifyItn()` returns `{ valid: false }` for an invalid signature
- `verifyItn()` returns `{ valid: false }` for an unrecognised source IP
- `verifyItn()` returns `{ valid: false }` for a payload with `payment_status !== "COMPLETE"`

Do not make real HTTP calls to Payfast in tests. Mock the environment config in tests — do not read real `.env` values.

### Acceptance criteria

- Adapter module is self-contained with no imports from wallet or provider modules
- Signature generation is covered by tests with known expected output
- ITN verification rejects bad signatures
- ITN verification rejects non-Payfast IPs
- No secrets appear in test files or console output
- Type check passes
- Lint passes
- All tests pass

### Risks and edge cases

- Payfast's IP allowlist changes periodically — load it from a config constant, not hardcoded inline, so it can be updated easily
- Sandbox and live Payfast endpoints differ — use the correct one based on `PAYFAST_SANDBOX`
- Amount must be formatted as a string with exactly two decimal places — floating point formatting errors will cause signature mismatches
- Payfast may add or remove fields in their ITN payload — the verification function must handle extra unknown fields gracefully

### Commands to run

```bash
git branch --show-current
git status --short
# Search for any existing Payfast utilities in the repo
grep -r "payfast\|PayFast\|PAYFAST" field-service/src --include="*.ts" -l
# Run adapter tests once written
npx vitest run field-service/src/modules/payments/payfast/ --reporter=verbose
npx tsc --noEmit
```

### What Claude Code must not touch

- Prisma schema
- Existing `Payment` or booking modules
- WhatsApp modules
- Any `.env` files

### OpenBrain documentation notes

Add a note to `field-service/docs/superpowers/specs/payfast-adapter.md` describing:

- The adapter interface (function signatures)
- The signature algorithm summary
- Environment variables required
- Sandbox vs live switching
- IP allowlist maintenance note

---

## Task 3 — Build provider top-up creation and Payfast redirect

**Mode:** Implementation

### Objective

Build the server-side action that creates a `ProviderWalletTopUpIntent` and returns a Payfast-ready checkout URL or form payload for the provider to be redirected to Payfast. No wallet crediting occurs at this stage.

### Why it is needed

The top-up creation is the entry point of the payment flow. It must validate the package selection, create a durable intent record, construct the Payfast checkout payload using the adapter, and return the redirect data to the UI — without touching the wallet balance.

### Files and areas to inspect or modify

```
field-service/src/modules/provider-wallet/top-up.service.ts   (create)
field-service/src/modules/provider-wallet/top-up.actions.ts   (create or follow existing server action convention)
field-service/src/modules/provider-wallet/top-up.service.test.ts
```

Follow the existing server action and service layer patterns discovered in Task 0.

### Business rules

- Valid top-up amounts for the pilot are R100, R200, and R500
- R50 must not be accepted as a valid package in this task — document the restriction in a comment
- Credits to issue are calculated from the amount: `creditsToIssue = amountCents / CREDIT_VALUE_CENTS` where `CREDIT_VALUE_CENTS` is a named constant (2000, i.e. R20)
- The result must divide evenly — reject any amount that does not produce a whole number of credits
- Provider identity must come from the authenticated server session — never accept `providerId` from the client request body
- The intent must be created with status `CREATED` before the Payfast payload is built
- Payfast checkout must be constructed using the adapter from Task 2
- The `m_payment_id` sent to Payfast must match the intent's ID (or a deterministic derivative of it)
- The return URL and cancel URL are UI-only redirects — add a comment confirming they are not payment proof
- The notify URL must point to the ITN handler endpoint (Task 4)

### Technical requirements

**Service function: `createProviderTopUpIntent`**

```typescript
// Pseudocode — adapt to project conventions
createProviderTopUpIntent(
  providerId: string,    // from auth session only
  amountCents: number,   // 10000 | 20000 | 50000
  paymentMethod: ProviderTopUpMethod,
): Promise<{ intentId: string; payfastPayload: PayfastCheckoutPayload }>
```

Steps inside the function:

1. Validate `amountCents` is one of the allowed packages (10000, 20000, 50000)
2. Compute `creditsToIssue`
3. Create `ProviderWalletTopUpIntent` with status `CREATED`
4. Call `payfastAdapter.buildCheckoutPayload(intent, providerProfile)` to get the Payfast fields
5. Update intent status to `PENDING_PAYMENT`
6. Return the intent ID and the Payfast payload
7. Log an implementation comment explaining that no wallet mutation occurs here

**Server action or API route**

Wire the service to a server action or API route following the existing project pattern. The action must:

- Resolve the authenticated provider from the session (use the auth seam identified in Task 0)
- Call `createProviderTopUpIntent`
- Return the Payfast payload to the UI for redirect

### Security requirements

- Do not accept `providerId` from the request body or query params
- Validate `amountCents` on the server — do not trust client-provided values
- Do not expose the Payfast passphrase or merchant key in the response
- Rate-limit intent creation if the project has an existing rate-limiting pattern — note the absence if not

### Tests required

- Valid R100 package creates an intent with status `PENDING_PAYMENT` and `creditsToIssue = 5`
- Valid R200 package creates an intent with `creditsToIssue = 10`
- Valid R500 package creates an intent with `creditsToIssue = 25`
- Invalid amount (e.g. R50, R150, R0) returns a validation error and does not create an intent
- Unauthenticated call is rejected
- Provider identity is sourced from session — a client-provided `providerId` in the body is ignored
- Payfast payload includes the correct `m_payment_id` matching the intent ID

### Acceptance criteria

- Intent is created in the database before the Payfast payload is returned
- Intent status transitions from `CREATED` to `PENDING_PAYMENT` within the same service call
- Wallet balance is not changed
- `ProviderWalletLedgerEntry` is not created
- Payfast payload includes all required fields
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- If Payfast payload construction fails after the intent is created, the intent will be stuck in `CREATED` — add a `FAILED` status update in the error path
- Concurrent requests from the same provider creating multiple intents is acceptable — they can be tracked separately and only one will complete
- Do not attempt to clean up `PENDING_PAYMENT` intents automatically in this task — that is handled by expiry logic later

### Commands to run

```bash
git branch --show-current
git status --short
npx tsc --noEmit
npx vitest run field-service/src/modules/provider-wallet/ --reporter=verbose
```

### What Claude Code must not touch

- Payfast adapter internals (use it as a black box via its interface)
- Wallet balance fields
- Wallet ledger entries
- Existing `Payment` or booking modules
- WhatsApp modules

### OpenBrain documentation notes

Add a note to `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md` confirming:

- The service function created
- The server action or route created
- The package validation logic
- The sequencing rule: intent is created before payload is built, wallet is never touched here

---

## Task 4 — Build Payfast ITN handler

**Mode:** Implementation

### Objective

Build the Payfast Instant Transaction Notification (ITN) webhook handler. This is the endpoint Payfast calls after a payment event. It must verify the notification is genuine, reject invalid or incomplete notifications, and hand off to the wallet crediting service (Task 5) only when the payment is confirmed as `COMPLETE`.

### Why it is needed

The ITN handler is the only legitimate source of payment truth. Every guard against double-crediting, fraud, and incorrect amounts lives here. Getting this wrong means either lost revenue (rejecting valid payments) or fraudulent credits (accepting spoofed notifications). This task must be built defensively.

### Files and areas to inspect or modify

```
field-service/src/app/api/webhooks/payfast/route.ts   (create — or follow existing API route convention)
field-service/src/modules/provider-wallet/itn.service.ts   (create)
field-service/src/modules/provider-wallet/itn.service.test.ts
```

### Business rules

- The ITN handler must verify the Payfast signature before taking any action
- The handler must validate the source IP against the Payfast IP allowlist
- The handler must validate that `payment_status === "COMPLETE"` before any crediting
- The handler must validate that `amount_gross` in the ITN matches the `amountCents` of the intent (within rounding tolerance for cents)
- The handler must validate that `m_payment_id` corresponds to a real, non-expired, non-already-credited intent
- On any validation failure, the handler must return HTTP 200 to Payfast (Payfast will retry on non-200 responses — returning errors causes retry storms)
- However, validation failures must be logged internally with the reason
- On a verified `COMPLETE` payment, the handler delegates to the wallet crediting service — it does not credit the wallet directly
- The handler must be idempotent — duplicate ITN calls for the same intent must not double-credit

### Technical requirements

**Route: `POST /api/webhooks/payfast`**

Steps:

1. Read the raw body as `application/x-www-form-urlencoded` (Payfast sends form data)
2. Extract the remote IP from the request headers (check for proxy headers per hosting environment)
3. Call `payfastAdapter.verifyItn(payload, remoteIp)` — if `valid === false`, log the reason and return HTTP 200
4. Look up the `ProviderWalletTopUpIntent` by `m_payment_id`
5. If intent not found — log and return HTTP 200
6. If intent is already `CREDITED` — log "duplicate ITN received, ignoring" and return HTTP 200 (idempotency)
7. If intent is `CANCELLED`, `FAILED`, or `EXPIRED` — log and return HTTP 200
8. If `payment_status !== "COMPLETE"` — update intent status to reflect the Payfast status, log, return HTTP 200
9. Validate `amount_gross` against `intent.amountCents` (convert gross to cents: `Math.round(parseFloat(amount_gross) * 100)`)
10. If amount mismatch — log, set intent to `FAILED`, return HTTP 200
11. Store `payfastPaymentId`, `payfastSignature`, `itnPaymentStatus`, `itnAmountCents`, and `itnReceivedAt` on the intent
12. Call `creditProviderWalletFromTopUp(intentId)` (Task 5)
13. Return HTTP 200

**ITN service: `processPayfastItn`**

Extract steps 4–12 into a testable service function that takes the parsed ITN payload and returns a typed result. The route handler calls this service.

### Security requirements

- Never trust the return URL as payment proof — the return URL handler must never trigger any crediting
- Validate source IP before any database read — fail fast on invalid IPs
- Use constant-time signature comparison (delegated to the adapter)
- Never return 4xx or 5xx to Payfast — always return 200 to prevent retry storms, but log failures internally
- If the `m_payment_id` is missing from the ITN payload — log and return 200, do not throw
- Do not log the full ITN payload if it contains sensitive customer data — log only non-sensitive fields like `m_payment_id`, `payment_status`, and `amount_gross`

### Tests required

- Valid complete ITN for a pending intent calls `creditProviderWalletFromTopUp` and returns 200
- Duplicate ITN for an already-credited intent does not call crediting and returns 200
- ITN with invalid signature is rejected (logged) and returns 200 without crediting
- ITN from unrecognised IP is rejected and returns 200 without crediting
- ITN with `payment_status = "FAILED"` updates intent status to `FAILED` and does not credit
- ITN with `payment_status = "CANCELLED"` updates intent status to `CANCELLED` and does not credit
- ITN with mismatched amount does not credit and sets intent to `FAILED`
- ITN with unknown `m_payment_id` returns 200 without throwing
- All tests mock the Payfast adapter — do not make real HTTP calls

### Acceptance criteria

- Handler always returns HTTP 200 to Payfast
- Valid complete payments result in `creditProviderWalletFromTopUp` being called
- Invalid, duplicate, mismatched, or cancelled payments do not call crediting
- Intent record is updated with ITN fields on every valid ITN regardless of outcome
- Idempotency is enforced without introducing a race condition
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- Payfast may call the ITN endpoint multiple times for the same payment — idempotency is critical
- Payfast sandbox ITNs come from different IPs than live — confirm the sandbox IP range from the docs and handle correctly based on `PAYFAST_SANDBOX` env var
- The amount comparison must handle floating point string conversion correctly — parse to cents as integers before comparing
- If `creditProviderWalletFromTopUp` throws, the intent will remain in `ITN_RECEIVED` — the ITN handler must handle this gracefully and return 200 so Payfast does not retry

### Commands to run

```bash
git branch --show-current
git status --short
npx tsc --noEmit
npx vitest run field-service/src/modules/provider-wallet/itn --reporter=verbose
```

### What Claude Code must not touch

- Payfast adapter internals — call via its interface only
- Wallet ledger directly — crediting is delegated to Task 5's service
- Existing `Payment` or booking routes
- WhatsApp modules

### OpenBrain documentation notes

Add a note to `field-service/docs/superpowers/specs/payfast-adapter.md` describing:

- The ITN endpoint URL
- The validation sequence (IP → signature → intent lookup → idempotency → amount → status)
- The return-200-always rule and why it exists
- The idempotency strategy

---

## Task 5 — Add idempotent wallet crediting on verified successful Payfast payment

**Mode:** Implementation

### Objective

Build the wallet crediting service that is called by the ITN handler after a verified successful Payfast payment. This service issues paid credits to the provider's wallet, creates the ledger entry, and marks the payment intent as credited — atomically and idempotently.

### Why it is needed

This is where real money becomes real credits. Every rule about correctness, idempotency, and auditability reaches its most critical point here. A bug here double-credits or silently fails to credit. Neither is acceptable.

### Files and areas to inspect or modify

```
field-service/src/modules/provider-wallet/wallet.service.ts    (create or extend)
field-service/src/modules/provider-wallet/wallet.service.test.ts
```

### Business rules

- Credits are issued only from this service — no other module should write to `paidCreditBalance` directly
- Crediting must be wrapped in a database transaction
- The transaction must:
  - Lock the `ProviderWallet` row for update (use `SELECT FOR UPDATE` equivalent in Prisma or raw SQL)
  - Create a `ProviderWalletLedgerEntry` with `entryType = TOPUP_CREDIT` and `creditType = PAID`
  - Increment `paidCreditBalance` on `ProviderWallet`
  - Update `ProviderWalletTopUpIntent` status to `CREDITED` and set `creditedAt` and `creditedLedgerEntryId`
- If the intent is already in status `CREDITED`, return early without any mutation (idempotency guard)
- The `balanceAfterPaid` field on the ledger entry must reflect the new balance after the credit
- After successful crediting, trigger the first-top-up promo credit check (see promo credit task) as a separate non-blocking step — do not include it in the same transaction
- After successful crediting, emit a WhatsApp notification event (see Task 8) — again, outside the transaction, and failure must not roll back the credit
- Do not allow wallet balance to go negative — enforce this as an invariant even though a credit cannot cause a negative balance; state it as a comment for future reference

### Technical requirements

**Service function: `creditProviderWalletFromTopUp`**

```typescript
// Pseudocode
creditProviderWalletFromTopUp(
  intentId: string
): Promise<{ credited: boolean; ledgerEntryId: string | null; reason?: string }>
```

Steps:

1. Fetch the intent by `intentId` — if not found, return `{ credited: false, reason: "intent not found" }`
2. If `intent.status === "CREDITED"` — return `{ credited: false, reason: "already credited" }` (idempotency)
3. Fetch or create the `ProviderWallet` for the provider
4. Open a database transaction:
   a. Re-fetch the intent inside the transaction and check status again (double-check idempotency under lock)
   b. Lock the wallet row
   c. Create the `ProviderWalletLedgerEntry`
   d. Increment `paidCreditBalance`
   e. Update intent to `CREDITED` with `creditedAt` and `creditedLedgerEntryId`
5. Outside the transaction: emit post-credit events (WhatsApp notification, promo check)
6. Return `{ credited: true, ledgerEntryId: entry.id }`

**Helper: `getOrCreateProviderWallet`**

If the provider wallet does not yet exist, create it with zero balances before the crediting transaction.

**Ledger entry description**

Use a human-readable description:

```
"Top-up via Payfast — 5 Plug-A-Pro Credits (R100)"
```

### Security requirements

- `creditProviderWalletFromTopUp` must only be callable from the ITN handler — it must not be exposed as a public API route or server action
- The `intentId` passed in must be validated as belonging to a real intent — do not accept arbitrary IDs
- Wallet row locking must prevent concurrent double-credits in the race window between ITN duplicate calls

### Tests required

- Crediting a valid intent in `ITN_RECEIVED` status:
  - Creates a ledger entry with correct `amountCredits`, `creditType = PAID`, and `entryType = TOPUP_CREDIT`
  - Increments `paidCreditBalance` by the correct amount
  - Updates intent to `CREDITED`
  - Returns `{ credited: true }`
- Calling `creditProviderWalletFromTopUp` twice for the same intent:
  - Second call returns `{ credited: false, reason: "already credited" }`
  - `paidCreditBalance` is not incremented a second time
  - Only one ledger entry exists
- Crediting creates wallet if it did not previously exist
- `balanceAfterPaid` on the ledger entry is correct
- WhatsApp notification event is emitted after successful credit (mock the WhatsApp module)
- Transaction failure rolls back all mutations

### Acceptance criteria

- Wallet is credited exactly once per intent, regardless of how many times the function is called
- Every successful credit has a corresponding ledger entry
- Intent status is `CREDITED` after success
- `creditedAt` and `creditedLedgerEntryId` are populated on the intent
- WhatsApp and promo events are emitted outside the transaction
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- Race condition between two duplicate ITN calls: the double-check inside the transaction under the row lock is the primary guard
- If the promo credit step fails after the transaction commits, the credit is still valid — do not roll back
- If the WhatsApp send fails, the credit is still valid — log the failure, do not roll back
- If the transaction fails mid-way, the intent remains in `ITN_RECEIVED` and the ITN handler returns 200 — Payfast will retry, which will call this function again, which will re-attempt the transaction safely

### Commands to run

```bash
git branch --show-current
git status --short
npx tsc --noEmit
npx vitest run field-service/src/modules/provider-wallet/wallet --reporter=verbose
```

### What Claude Code must not touch

- ITN handler logic — crediting is this service's concern, routing is the handler's concern
- Promo credit awarding — emit an event or call the promo service, but do not implement promo logic here
- WhatsApp send implementation — emit an event or call the notification service interface only

### OpenBrain documentation notes

Add a note to `field-service/docs/superpowers/specs/provider-wallet-ledger.md`:

- The crediting transaction sequence
- The idempotency strategy (intent status check inside and outside transaction)
- The row-locking approach used
- The post-credit event pattern (outside transaction, failure-tolerant)

---

## Task 6 — Add provider top-up UI flow

**Mode:** Implementation

### Objective

Build the mobile-first provider-facing UI for selecting a top-up package, initiating the Payfast checkout, and handling the return from Payfast. Also build the wallet balance display used across the provider dashboard.

### Why it is needed

Providers need a clear, trust-building journey to buy credits. The UI must make the pricing transparent, the checkout familiar, and the post-payment confirmation reassuring — without ever relying on the return URL as payment proof.

### Files and areas to inspect or modify

```
field-service/src/app/(provider)/wallet/          (create)
field-service/src/app/(provider)/wallet/page.tsx
field-service/src/app/(provider)/wallet/top-up/page.tsx
field-service/src/app/(provider)/wallet/top-up/success/page.tsx
field-service/src/app/(provider)/wallet/top-up/cancel/page.tsx
field-service/src/components/provider/WalletSummary.tsx   (create or extend)
field-service/src/components/provider/TopUpPackageSelector.tsx   (create)
```

Adapt paths to the existing Next.js App Router route structure.

### Business rules

- Use "Plug-A-Pro Credits" everywhere — never "tokens"
- Display paid credits and promo credits separately on the wallet summary
- Show the total available credits (paid + promo) prominently
- Top-up packages to display: R100 / R200 / R500
- Do not show R50 as a default option during pilot
- After selecting a package, the provider is redirected to Payfast
- The success page must display a pending message — not a confirmed credit message — because the ITN may not have arrived yet
- The cancel page must explain the payment was not completed and allow the provider to try again
- The success page must not trigger any crediting or wallet mutation
- Show a link to the wallet transaction history

### Technical requirements

**Wallet summary component**

Display:

- Total available credits (paid + promo combined)
- Paid credits
- Promo credits
- Estimated leads unlockable (total available credits as a count)
- A "Top Up" CTA button

**Top-up package selector**

Display the three packages as selectable cards:

```
R100 → 5 Plug-A-Pro Credits
R200 → 10 Plug-A-Pro Credits
R500 → 25 Plug-A-Pro Credits
```

On selection, call the server action from Task 3 to create an intent and receive the Payfast payload. Redirect the provider to Payfast using the payload (form POST or redirect URL depending on Payfast checkout method — confirm from the adapter).

**Success page**

```
Payment submitted
Your R[amount] payment has been submitted to Payfast.
Credits will appear in your wallet once payment is confirmed — usually within a few minutes.
[View Wallet]
```

Do not show the credit amount as confirmed. Do not call any crediting logic.

**Cancel page**

```
Payment cancelled
Your payment was not completed. No credits were charged.
[Try Again]  [Back to Wallet]
```

**Wallet transaction history**

Display `ProviderWalletLedgerEntry` records for the authenticated provider:

- Type (top-up, promo, unlock, refund, adjustment)
- Credits
- Description
- Date

### Security requirements

- Wallet data must be fetched server-side using authenticated provider session — never expose wallet data via a client-accessible API without auth
- The success page must not accept any payment confirmation from query params
- The cancel page must not modify any intent status (Payfast ITN handles status transitions)

### Tests required

- Wallet summary shows correct total, paid, and promo credit counts
- Selecting a package calls the server action with the correct amount
- Success page renders without crediting logic
- Cancel page renders without modifying intent status
- Unauthenticated access to wallet pages redirects to login
- Playwright end-to-end: provider can navigate to wallet, select a package, and reach the Payfast redirect (mock the Payfast payload in E2E — do not connect to Payfast sandbox in automated tests without explicit approval)

### Acceptance criteria

- Mobile-first layout
- Three packages displayed correctly
- Package selection creates an intent and redirects to Payfast
- Success page shows pending message only
- Cancel page shows not-completed message
- Wallet summary is accurate
- Transaction history is readable
- No wallet mutation in the UI layer
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- Payfast redirect method (form POST vs GET redirect) — confirm from the adapter and implement accordingly
- Slow ITN arrival means the success page will show "pending" for a short time — this is correct behaviour, not a bug
- Provider may refresh the success page multiple times — this must not trigger any server-side action

### Commands to run

```bash
git branch --show-current
git status --short
npx tsc --noEmit
npx vitest run field-service/src --reporter=verbose
npx playwright test --grep "wallet" 2>/dev/null || echo "no wallet E2E tests yet"
```

### What Claude Code must not touch

- ITN handler
- Wallet crediting service
- Payfast adapter internals
- WhatsApp modules

### OpenBrain documentation notes

Note the route structure in `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md`.

---

## Task 7 — Add admin reconciliation and Payfast payment review

**Mode:** Implementation

### Objective

Build the admin-facing tools for reviewing provider top-up payment intents, inspecting Payfast ITN records, manually resolving stuck intents, and making admin wallet adjustments.

### Why it is needed

During pilot, some payments may get stuck — ITN not received, amount mismatch, or Payfast sandbox issues. Admin needs safe tools to inspect, annotate, and in exceptional cases manually credit a provider wallet. All admin actions must be auditable.

### Files and areas to inspect or modify

```
field-service/src/app/(admin)/wallet/              (create)
field-service/src/app/(admin)/wallet/top-ups/page.tsx
field-service/src/app/(admin)/wallet/top-ups/[intentId]/page.tsx
field-service/src/app/(admin)/providers/[providerId]/wallet/page.tsx
field-service/src/modules/admin/wallet-admin.service.ts   (create)
field-service/src/modules/admin/wallet-admin.actions.ts   (create — follow existing admin action convention)
```

### Business rules

- Only admin or ops users may access these pages — use existing role guard pattern
- Admin adjustments require a mandatory reason field
- Manual crediting via admin must create a ledger entry with `entryType = ADMIN_ADJUSTMENT` or `TOPUP_CREDIT` (clarify convention in the note)
- Admin crediting of a payment intent must be idempotent — cannot credit the same intent twice regardless of method
- Admin negative adjustments cannot reduce a balance below zero
- All admin mutations must follow the existing `crudAction()` or admin audit convention found in Task 0
- Admin notes must be stored on the intent record

### Technical requirements

**Admin top-up intent list**

Filterable by:

- Status (CREATED, PENDING_PAYMENT, ITN_RECEIVED, CREDITED, FAILED, CANCELLED, EXPIRED)
- Provider name or phone
- Date range
- Amount

**Admin intent detail page**

Display:

- Intent fields including status, amount, credits, payment method, `m_payment_id`
- Payfast fields received in ITN (if any)
- Provider wallet current balance
- Ledger entries related to this intent
- Status timeline

Admin actions available:

- Add note (always available)
- Manually credit — only when intent is in `PENDING_PAYMENT` or `ITN_RECEIVED` and not yet `CREDITED`
- Mark as failed — with required reason
- Mark as expired — with required reason

**Admin service: `adminCreditProviderTopUpIntent`**

Calls `creditProviderWalletFromTopUp` (Task 5) after admin confirmation. Does not bypass the idempotency guard.

**Admin service: `adminAdjustProviderWalletCredits`**

Allows positive or negative manual credit adjustments with a required reason. Creates ledger entry with `entryType = ADMIN_ADJUSTMENT`. Enforces no-negative-balance rule.

### Security requirements

- Admin pages must enforce role-based access using the existing admin auth pattern
- Admin must not be able to credit an already-credited intent
- Negative adjustments must enforce the no-negative-balance invariant
- All admin mutations must create an audit trail via the existing admin action convention

### Tests required

- Admin can list top-up intents filtered by status
- Admin can manually credit a pending intent (calls `creditProviderWalletFromTopUp`)
- Admin cannot credit an already-credited intent
- Admin adjustment with valid reason creates correct ledger entry
- Admin negative adjustment cannot reduce balance below zero
- Non-admin user cannot access admin wallet routes

### Acceptance criteria

- Admin intent list is paginated and filterable
- Admin intent detail shows full status history
- Manual credit is idempotent
- All admin actions create audit log entries
- Role guard prevents non-admin access
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- Admin may try to credit a payment that Payfast later also sends an ITN for — idempotency guard handles this in Task 5
- Ensure admin "mark as failed" does not prevent a late Payfast ITN from being processed
- Admin note field must be sanitised before storage

### Commands to run

```bash
git branch --show-current
git status --short
npx tsc --noEmit
npx vitest run field-service/src/modules/admin/ --reporter=verbose
```

### What Claude Code must not touch

- ITN handler
- Payfast adapter
- Provider-facing UI
- Existing admin areas unrelated to wallet

### OpenBrain documentation notes

Add to `field-service/docs/superpowers/specs/provider-wallet-ledger.md`:

- Admin adjustment entry type and convention
- The rule that admin crediting uses the same `creditProviderWalletFromTopUp` function
- The no-negative-balance invariant

---

## Task 8 — Add WhatsApp notifications for top-up created and credited

**Mode:** Implementation

### Objective

Add WhatsApp notification events for the provider wallet top-up flow. Specifically: payment instructions when a top-up intent is created, and a credit receipt when the wallet is successfully credited.

### Why it is needed

Plug-A-Pro is WhatsApp-first. Providers should receive payment instructions and credit confirmations through WhatsApp without needing to navigate back to the app. This is particularly important for the manual EFT fallback and for providers who use WhatsApp as their primary interface.

### Files and areas to inspect or modify

```
field-service/src/modules/notifications/wallet-notifications.ts   (create or extend existing notification module)
field-service/src/modules/notifications/wallet-notifications.test.ts
```

Locate the existing WhatsApp send seam from Task 0 before creating new files. Use the existing patterns for template sends and message event audit.

### Business rules

- WhatsApp sends must be async — never inline inside a database transaction
- A failed WhatsApp send must not roll back a confirmed wallet credit
- Do not send duplicate notifications — check for existing notification records or use the message event audit found in Task 0
- Do not send live WhatsApp messages in tests — mock the WhatsApp send function
- Use the existing WhatsApp template send or interactive send pattern — do not introduce a new third-party WhatsApp client
- Notification content must use "Plug-A-Pro Credits" not "tokens"

### Technical requirements

**Event: top-up intent created (payment instructions)**

Trigger: after `createProviderTopUpIntent` succeeds in Task 3.

Content for manual EFT top-up (if method is `MANUAL_EFT`):

```
Plug-A-Pro top-up request received
Amount: R[amount]
Credits: [n] Plug-A-Pro Credits
Bank: [bank name from config]
Account name: [account name from config]
Reference: [m_payment_id]

Please use the exact reference above so we can credit your account.
```

Content for Payfast top-up (if method is Payfast):

```
Your Plug-A-Pro top-up of R[amount] has been initiated.
Complete your payment on the checkout page.
Credits will appear in your wallet once confirmed.
```

**Event: wallet credited**

Trigger: after `creditProviderWalletFromTopUp` succeeds in Task 5.

Content:

```
Payment confirmed
Your wallet has been credited with [n] Plug-A-Pro Credits.
New balance: [total available credits] credits
You can now unlock matched leads.
[View Leads] — link to provider dashboard
```

**Event: low balance warning** (optional for this task — implement if WhatsApp notification infrastructure makes it straightforward)

Trigger: after a lead unlock reduces the provider's available credit balance to 1 or 0.

Content:

```
You have [n] Plug-A-Pro Credit remaining.
Top up now to keep unlocking leads.
R100 = 5 credits
```

### Security requirements

- Never include full customer contact details in any notification not related to a completed lead unlock
- Do not log WhatsApp message content containing provider personal data
- Use the existing message event audit to record sent messages

### Tests required

- `sendTopUpCreatedNotification` calls the WhatsApp send interface with the correct content
- `sendWalletCreditedNotification` calls the WhatsApp send interface with correct credit count and balance
- No real WhatsApp API calls are made in tests — mock the send function
- Notification failure does not throw an unhandled exception

### Acceptance criteria

- Notifications are sent asynchronously after the relevant service events
- Failure does not affect wallet or intent state
- Test mocks confirm correct message payload construction
- Message event audit records sent messages
- Tests pass
- Type check passes
- Lint passes

### Risks and edge cases

- WhatsApp template approval may be required for production use — add a comment noting this
- Provider may not have a WhatsApp-connected phone number — handle gracefully with a log
- Retry logic for failed sends should use the existing project pattern if one exists — do not build a custom retry queue in this task
- Sandbox/test environment must never send real WhatsApp messages — confirm the environment guard exists in the WhatsApp module

### Commands to run

```bash
git branch --show-current
git status --short
# Locate existing WhatsApp modules
find field-service/src -name "*.ts" | xargs grep -l "whatsapp\|sendMessage\|template" | head -10
npx tsc --noEmit
npx vitest run field-service/src/modules/notifications/ --reporter=verbose
```

### What Claude Code must not touch

- Wallet crediting service internals
- ITN handler
- Payfast adapter
- Existing WhatsApp modules beyond adding new notification functions

### OpenBrain documentation notes

Add to `field-service/docs/superpowers/specs/payfast-adapter.md`:

- The WhatsApp notification events emitted by the wallet top-up flow
- The async pattern used (fire-and-forget, event queue, etc.)
- Template content for each notification type
- The no-real-sends-in-tests rule

---

## Task 9 — Add OpenBrain docs and implementation notes

**Mode:** Implementation

### Objective

Write and finalise the OpenBrain-compatible specification and implementation notes for the Payfast provider wallet top-up integration. These documents are the authoritative reference for future development on this system.

### Why it is needed

Without clear documentation in the agreed format, future engineers or AI agents working in this codebase will lack context for why decisions were made, which will cause them to repeat mistakes or break invariants unintentionally.

### Files to create or update

```
field-service/docs/superpowers/specs/payfast-adapter.md
field-service/docs/superpowers/specs/provider-wallet-ledger.md
field-service/docs/superpowers/specs/provider-wallet-topup-flow.md
field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md   (finalise)
```

### Business rules

- Follow the writing style and format of existing OpenBrain spec files found in Task 0
- Do not reference `tracker.md`
- Do not introduce new documentation formats — use the existing conventions

### Content required for each document

**`payfast-adapter.md`**

- Payfast integration scope (what it handles and what it does not)
- Merchant account configuration
- Supported payment methods: SCode, Instant EFT, Card
- Signature algorithm summary
- ITN verification sequence
- IP allowlist note and maintenance process
- Return-200-always rule and rationale
- Environment variables required
- Sandbox vs live switching
- WhatsApp notification events emitted

**`provider-wallet-ledger.md`**

- Wallet model overview (paid credits, promo credits, reserved credits)
- Ledger-first principle — the ledger is the source of truth
- All `WalletLedgerEntryType` values with descriptions
- Credit consumption order: promo before paid
- No-negative-balance invariant
- Idempotency strategy for crediting
- Transaction and row-locking pattern
- Admin adjustment convention
- Promo credit rules (non-transferable, non-refundable, expiry)

**`provider-wallet-topup-flow.md`**

- Business flow narrative: provider selects package → intent created → Payfast checkout → ITN received → wallet credited
- Package pricing table
- Credit pricing constant (R20/credit, `CREDIT_VALUE_CENTS = 2000`)
- Rule: return URL is not payment proof
- Rule: wallet crediting happens only after verified ITN with `payment_status = COMPLETE`
- Rule: duplicate ITN calls are idempotent
- Refund and dispute policy (to be expanded in a future task)
- Known limitations and future enhancements:
  - Automated promo credit expiry
  - Lead pool cap enforcement
  - Dynamic lead pricing
  - PayShap / instant EFT direct integration
  - Subscription bundles

**`payfast-wallet-topup-discovery.md`** (finalise)

Update with a summary of every task completed, files created or modified, and outstanding items.

### Acceptance criteria

- All four documents exist and contain substantive content
- Existing spec format is followed
- No `tracker.md` references
- No placeholder "to be completed" sections
- Future engineers can understand the system from these docs alone

### Risks and edge cases

None specific — this is a documentation task. Do not make code changes in this task.

### Commands to run

```bash
git branch --show-current
git status --short
ls field-service/docs/superpowers/specs/
ls field-service/docs/superpowers/plans/
```

### What Claude Code must not touch

- Any application code
- Prisma schema or migrations

---

## Task 10 — Final integration hardening and test checklist

**Mode:** Hardening / validation

### Objective

Perform final end-to-end integration verification of the Payfast provider wallet top-up system. Confirm all security invariants hold, run the full test suite, validate the complete payment flow with simulated ITN payloads, and document any outstanding issues.

### Why it is needed

Each task was built and tested in isolation. This task verifies that the seams between tasks work correctly together — that the adapter feeds the handler, the handler feeds the crediting service, and the crediting service feeds the ledger — under realistic conditions including edge cases, concurrent calls, and failure scenarios.

### Files and areas to inspect

All files created or modified in Tasks 1–9.

### Business rules

All rules established in Tasks 0–9 apply. This task verifies adherence, not implementation.

### Technical requirements

**End-to-end flow to validate**

Simulate the following journey using test data (not real Payfast calls):

1. Provider authenticates
2. Provider selects R200 package
3. `createProviderTopUpIntent` creates an intent with status `PENDING_PAYMENT` and `creditsToIssue = 10`
4. Payfast checkout payload is constructed with correct signature
5. Simulated Payfast ITN arrives at `/api/webhooks/payfast` with:
   - Correct signature
   - Correct source IP
   - `payment_status = "COMPLETE"`
   - `amount_gross = "200.00"`
   - Correct `m_payment_id`
6. ITN handler verifies and calls `creditProviderWalletFromTopUp`
7. Wallet is credited with 10 paid credits
8. Ledger entry is created
9. Intent status becomes `CREDITED`
10. WhatsApp notification event is emitted
11. Provider wallet summary shows 10 available credits

**Security invariants to verify**

Run each of these as a test scenario and confirm the expected outcome:

| Scenario | Expected outcome |
|---|---|
| ITN with invalid signature | Rejected, no credit, HTTP 200 |
| ITN with non-Payfast IP | Rejected, no credit, HTTP 200 |
| ITN with `payment_status = FAILED` | Intent set to FAILED, no credit |
| ITN with wrong `amount_gross` | Intent set to FAILED, no credit |
| ITN for unknown `m_payment_id` | Logged, no error thrown, HTTP 200 |
| Duplicate ITN for credited intent | No double credit, HTTP 200 |
| Concurrent duplicate ITN calls | No double credit, row lock enforced |
| Client-provided `providerId` in top-up action | Ignored, session identity used |
| Non-admin accessing admin wallet route | 403 or redirect |
| Admin crediting an already-credited intent | Rejected with reason |
| Admin negative adjustment exceeding balance | Rejected |
| Success page accessed without completing payment | No crediting, pending message shown |

**Test suite commands**

```bash
npx vitest run --reporter=verbose
npx tsc --noEmit
npx eslint field-service/src --ext .ts,.tsx
npx playwright test 2>/dev/null || echo "run Playwright separately if needed"
```

**Code review checklist**

Before marking this task complete, verify:

- [ ] No hardcoded Payfast credentials anywhere in source files
- [ ] No `console.log` statements logging merchant key, passphrase, or provider personal data
- [ ] Every wallet mutation has a corresponding ledger entry
- [ ] No wallet balance field is updated outside of `wallet.service.ts`
- [ ] ITN handler always returns HTTP 200
- [ ] `creditProviderWalletFromTopUp` is only callable from ITN handler and admin service
- [ ] Return URL never triggers crediting
- [ ] All new Prisma models have migrations
- [ ] `PAYFAST_SANDBOX` env var controls sandbox vs live correctly
- [ ] WhatsApp sends are outside database transactions
- [ ] Tests do not send real WhatsApp messages
- [ ] Tests do not call real Payfast endpoints

### Acceptance criteria

- Full test suite passes with no failures
- Type check passes with no errors
- Lint passes with no errors
- All security invariant scenarios are covered by tests
- End-to-end flow completes correctly in the test environment
- No hardcoded secrets exist in source files
- OpenBrain docs are finalised
- Any outstanding issues are documented in `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md` under an "Outstanding Items" section

### Risks and edge cases

- Race condition tests require either a test database that supports concurrent connections or explicit locking verification via unit test patterns
- Playwright E2E tests should not connect to the real Payfast sandbox without explicit environment setup — confirm the test environment guard before running
- Some edge cases (Payfast IP allowlist, production template approval) are operational rather than code issues — document them clearly but do not block the hardening task on them

### Commands to run

```bash
git branch --show-current
git status --short
npx vitest run --reporter=verbose
npx tsc --noEmit
npx eslint field-service/src --ext .ts,.tsx --max-warnings 0
grep -r "PAYFAST_MERCHANT_KEY\|PAYFAST_PASSPHRASE\|passphrase" field-service/src --include="*.ts" | grep -v ".env" | grep -v ".test."
grep -r "console.log" field-service/src/modules/provider-wallet --include="*.ts"
grep -r "console.log" field-service/src/modules/payments/payfast --include="*.ts"
```

### What Claude Code must not touch

- Any existing customer-side Payment or booking logic
- Existing WhatsApp production send configuration
- Any `.env` files

### OpenBrain documentation notes

Finalise all docs. Add an "Integration verified" note with the date and test outcomes to `field-service/docs/superpowers/plans/payfast-wallet-topup-discovery.md`.

---

## Summary — task execution order and dependencies

```
Task 0  →  Task 1  →  Task 2  →  Task 3
                               ↓
                           Task 4  →  Task 5  →  Task 8
                                              ↓
                                          Task 6
                                          Task 7
                                          Task 9
                                              ↓
                                          Task 10
```

**Never start a task before its upstream task's acceptance criteria are met.**

The ITN handler (Task 4) depends on the adapter (Task 2) and the intent model (Task 1).  
The wallet crediting (Task 5) depends on the ITN handler (Task 4).  
The UI (Task 6) depends on the top-up creation service (Task 3).  
The admin tools (Task 7) depend on the crediting service (Task 5).  
WhatsApp notifications (Task 8) depend on the crediting service (Task 5) for the credit receipt event.  
Final hardening (Task 10) depends on all previous tasks.

---

*Generated for Plug-A-Pro · field-service app · Payfast provider wallet top-up integration*
