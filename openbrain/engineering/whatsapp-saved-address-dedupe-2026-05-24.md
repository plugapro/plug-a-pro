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

## 2026-05-24 follow-up — Sarah address cleanup and DIY request timeline

### Address cleanup

Deleted the older generic Sarah address snapshot after moving its two linked historical job requests to the richer address row.

- Deleted address: `cmpcgwrr9003nlg04igjbwkik` (`21 Jump Street`, no unit number)
- Retained address: `cmpdy4vqz0001l8042gx02yqu` (`Unit 21, 21 Jump Street`)
- Reassigned requests:
  - `PAP-222C9321` / `cmpcgwrwh003plg04924oftqi` (`DIY & Assembly`, `MATCHED`)
  - `PAP-25775D00` / `cmpdrf66h000sl4044kkg2m48` (`Garden & Landscaping`, `ACCEPTED_LOCKED`)
- Verification: Sarah now has one raw `addresses` row and the WhatsApp identity resolver returns `rawSavedAddressCount: 1`, `savedAddressCount: 1`.

### Today DIY request

Request `PAP-5484E8B2` / `cmpjwmmaf0017jx04box167x2` was submitted on `2026-05-24T15:00:28.887Z` for `DIY & Assembly`: "I need a table assembled for the house", preferred availability "This week".

Quick Match path:

1. Lovemore Sibanda received the first offer and declined at `2026-05-24T15:01:27.674Z`.
2. Tshepo serve2 was offered next; the offer expired at `2026-05-24T15:11:29.912Z` and was marked timed out at `2026-05-24T15:15:14.787Z`.
3. Tshepo serve1 was offered third; the offer expired at `2026-05-24T15:25:17.592Z` and was marked timed out at `2026-05-24T15:30:13.429Z`.
4. The dispatch decision was updated to `NO_MATCH`, and the job request was marked `EXPIRED` at `2026-05-24T15:30:24.947Z`.

Provider WhatsApp events for both Tshepo serve1 and Tshepo serve2 failed with Meta's `Re-engagement message` failure reason, which explains why those two offers timed out rather than receiving provider responses.

Customer notifications were sent/read for the initial offer, matching progress, provider rotation, timeout rotation, and final no-match message.
