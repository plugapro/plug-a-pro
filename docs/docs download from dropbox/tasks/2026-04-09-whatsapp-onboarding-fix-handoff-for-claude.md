# Plug A Pro WhatsApp Onboarding: Remaining Work Handoff for Claude Code

## Objective

Complete the remaining steps required for the revised marketing-site self-registration flow to work end to end on `https://plugapro.co.za/waitlist`.

This pass already replaced the old email-led waitlist with a phone-first, WhatsApp-led self-registration flow. The UI is implemented and the API contract is extended, but the live submission journey is still blocked at database persistence.

## What Was Already Done

The following files were updated in this pass:

- `marketing/app/(marketing)/waitlist/page.tsx`
- `marketing/components/marketing/WaitlistForm.tsx`
- `marketing/app/api/leads/route.ts`
- `marketing/__tests__/api/leads.test.ts`
- `marketing/supabase/migrations/002_onboarding_leads.sql`
- `marketing/public/onboarding-flow-verification.svg`

### Functional changes already in place

- The `/waitlist` page now presents itself as self-registration instead of a launch waitlist.
- The page is mobile-first and explicitly WhatsApp-led.
- The form captures:
  - full name
  - cell phone number
  - journey type: `customer` | `provider` | `both`
  - area / suburb
  - service category
  - optional business name
  - optional notes
  - WhatsApp opt-in checkbox
- The API now accepts a new `onboarding` lead type.
- The DB migration adds onboarding fields to the marketing `leads` table.
- On successful save, the API returns a `whatsappUrl` built from the captured data.
- The client success state is already wired to redirect the user into WhatsApp after a successful save.

## What Was Verified

### Verified working

- `/waitlist` renders correctly in the browser.
- The new self-registration copy and fields are visible.
- The onboarding POST route is reachable.
- API validation passes for valid onboarding payloads.
- Unit tests pass.
- Type-check passes.

### Verified broken boundary

The real submission path currently fails at the persistence step:

- browser submit -> `POST /api/leads`
- API validation -> passes
- Supabase insert -> fails
- user sees: `Failed to save. Please try again.`

### Observed runtime evidence

Local dev-server logs showed:

```text
[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Lead capture and chat routes will fail at runtime until env vars are configured.
[leads] insert error: TypeError: fetch failed
POST /api/leads 500
```

## Remaining Work for Claude Code

### 1. Fix the environment-backed persistence path

Confirm that the marketing app has the required env vars in the runtime used by the deployed marketing site:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Check:

- local `marketing/.env.local`
- Vercel environment configuration for the marketing project
- whether production, preview, and development all have the correct values

Do not leave this as a code-only fix if the issue is actually deployment configuration.

### 2. Apply the onboarding migration in the target Supabase environment

The code expects the `leads` table to support:

- `type = 'onboarding'`
- nullable `email`
- `phone`
- `journey`
- `business_name`
- `city`
- `service_category`
- `whatsapp_opt_in`

Verify the migration has been applied in the real Supabase database used by the marketing site.

If not applied, apply:

- `marketing/supabase/migrations/002_onboarding_leads.sql`

### 3. Re-verify the full user journey

Once env vars and DB schema are correct, verify the full flow again:

1. open `/waitlist`
2. submit as a customer
3. confirm `POST /api/leads` returns success
4. confirm the record is stored in Supabase
5. confirm the success state renders
6. confirm the browser is redirected to the generated WhatsApp link

Then repeat with a provider or `both` journey so both dynamic branches are covered.

### 4. Sanity-check the data saved

Ensure DB values are mapped correctly:

- `journey` stores the expected enum-like string
- `service_category` maps from `serviceCategory`
- `business_name` maps correctly when present
- `phone` is normalized
- `whatsapp_opt_in` stores the user checkbox value

### 5. Optional improvement if time allows

If the team wants a stronger production flow, consider replacing the current deep-link-only follow-up with an actual server-side outbound WhatsApp confirmation message using the existing WhatsApp stack in `field-service/`.

This is optional for this handoff. The core unblocker is: save must succeed first.

## Important Decisions Already Taken

These choices were intentional and should not be undone unless product direction changes:

### Decision 1: Move away from email-led waitlist language

The page should not lead with:

- launch waitlist
- email signup
- “we’ll contact you later”

It should instead lead with:

- self-registration
- cell phone first
- WhatsApp as the primary engagement channel

### Decision 2: Prefer WhatsApp handoff over OTP for now

Current recommendation:

- save registration
- open WhatsApp immediately with a prefilled summary
- continue onboarding there

OTP / magic-link confirmation was intentionally deferred because:

- the target market is primarily WhatsApp-native
- email is not a primary operating channel yet
- a lightweight onboarding flow is more important than stricter registration verification in this phase

### Decision 3: One shared form should support both sides of the marketplace

The self-registration flow should serve:

- customer seeking help
- provider offering services
- people who may do both

## Validation Commands Already Used

Run these again after fixing the env/schema issue:

```bash
cd marketing
npm test
npx tsc --noEmit
npm run dev
```

Then verify in browser and with a real POST.

## Suggested Outcome

Claude Code should finish with:

- fully working self-registration flow
- saved onboarding records in Supabase
- successful WhatsApp redirect after submit
- brief summary of what was fixed
- evidence of end-to-end verification
