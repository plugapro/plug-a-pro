# fix — WhatsApp saved address dedupe (2026-05-24)

## Root cause

A customer had two historical `addresses` snapshots for the same visible WhatsApp address. One row stored `street = "Unit 1, 123 Test Street"` with `addressLine1 = "123 Test Street"`; the other stored `street = "123 Test Street"`.

The returning-customer WhatsApp picker read historical `Address` rows, while the canonical reusable `CustomerAddress` table already had one saved site. The WhatsApp dedupe key used the legacy `street` field, but the picker rendered `addressLine1`, so two internally different rows rendered as identical options.

## The clues that pointed here

- The customer's resolver query returned `rawSavedAddressCount: 2`.
- Both rows rendered as `123 Test Street, Suburb, City, Province`.
- The richer row carried `unitNumber = "1"` and was linked to recent requests.
- The live resolver check after the fix returned `savedAddressCount: 1`.

## Fix applied

1. Added `deduplicateWhatsAppSavedAddresses()` in `field-service/lib/whatsapp-identity.ts`.
2. Grouped saved addresses by the fields WhatsApp actually displays: structured street line, suburb, city, and province.
3. Preferred more complete rows when duplicates differ only by hidden metadata or street-level detail.
4. Reused the same helper in `field-service/lib/whatsapp-flows/job-request.ts` for the first-booking saved-site picker.
5. Added regression tests for the identity resolver, the returning-customer picker, and the first-booking picker.

## Result

- The customer's two raw historical rows now resolve to one WhatsApp selectable address.
- No data deletion was required; historical job request address links remain intact.
- Validation run: `118` focused Vitest tests passing, `pnpm typecheck` passing, `pnpm lint` passing.

## 2026-05-24 follow-up — address cleanup and DIY request timeline

### Address cleanup

Deleted the older generic address snapshot after moving its two linked historical job requests to the richer address row.

- Deleted address: `address-id-example-a` (`123 Test Street`, no unit number)
- Retained address: `address-id-example-b` (`Unit 1, 123 Test Street`)
- Reassigned requests:
  - `PAP-EXAMPLE1` / `request-id-example-a` (`DIY & Assembly`, `MATCHED`)
  - `PAP-EXAMPLE2` / `request-id-example-b` (`Garden & Landscaping`, `ACCEPTED_LOCKED`)
- Verification: the customer now has one raw `addresses` row and the WhatsApp identity resolver returns `rawSavedAddressCount: 1`, `savedAddressCount: 1`.

### DIY request

Request `PAP-EXAMPLE3` / `request-id-example-c` was submitted for `DIY & Assembly`: "I need a table assembled for the house", preferred availability "This week".

Quick Match path:

1. Provider A received the first offer and declined.
2. Provider B was offered next; the offer expired and was marked timed out.
3. Provider C was offered third; the offer expired and was marked timed out.
4. The dispatch decision was updated to `NO_MATCH`, and the job request was marked `EXPIRED`.

Provider WhatsApp events for both Provider B and Provider C failed with Meta's `Re-engagement message` failure reason, which explains why those two offers timed out rather than receiving provider responses.

Customer notifications were sent/read for the initial offer, matching progress, provider rotation, timeout rotation, and final no-match message.
