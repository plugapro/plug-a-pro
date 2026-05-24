# fix — WhatsApp saved address dedupe (2026-05-24)

## Root cause

Sarah had two historical `addresses` snapshots for the same visible WhatsApp address. One row stored `street = "Unit 21, 21 Jump Street"` with `addressLine1 = "21 Jump Street"`; the other stored `street = "21 Jump Street"`.

The returning-customer WhatsApp picker read historical `Address` rows, while the canonical reusable `CustomerAddress` table already had one saved site. The WhatsApp dedupe key used the legacy `street` field, but the picker rendered `addressLine1`, so two internally different rows rendered as identical options.

## The clues that pointed here

- Sarah's resolver query returned `rawSavedAddressCount: 2`.
- Both rows rendered as `21 Jump Street, Constantia Kloof, Johannesburg, Gauteng`.
- The richer row carried `unitNumber = "21"` and was linked to recent requests.
- The live resolver check after the fix returned `savedAddressCount: 1`.

## Fix applied

1. Added `deduplicateWhatsAppSavedAddresses()` in `field-service/lib/whatsapp-identity.ts`.
2. Grouped saved addresses by the fields WhatsApp actually displays: structured street line, suburb, city, and province.
3. Preferred more complete rows when duplicates differ only by hidden metadata or street-level detail.
4. Reused the same helper in `field-service/lib/whatsapp-flows/job-request.ts` for the first-booking saved-site picker.
5. Added regression tests for the identity resolver, the returning-customer picker, and the first-booking picker.

## Result

- Sarah's two raw historical rows now resolve to one WhatsApp selectable address.
- No data deletion was required; historical job request address links remain intact.
- Validation run: `118` focused Vitest tests passing, `pnpm typecheck` passing, `pnpm lint` passing.
