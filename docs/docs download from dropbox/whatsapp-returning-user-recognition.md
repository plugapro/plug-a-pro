# WhatsApp returning-user recognition

WhatsApp journeys must resolve the sender by normalized phone number before asking for profile details.

## Phone normalization

Use `normalizePhone` and `phoneLookupVariants` for WhatsApp/customer/provider lookups.

Equivalent South African inputs:
- `0823035070`
- `823035070`
- `27823035070`
- `+27823035070`
- `whatsapp:+27823035070`

All resolve to canonical `+27823035070` for storage and comparison.

## Context resolver

Use `resolveWhatsAppUserContext({ whatsappSender })` or `resolveWhatsAppIdentity(phone)` instead of duplicating lookups inside flows.

The resolver returns customer and provider candidates independently. A number can be both a customer and a provider; customer journeys should use `customerId` and `customerDisplayName`, while provider journeys should use provider fields.

## Customer request rule

Known customers must not be asked for their name again.

If `customerId` exists and `customerDisplayName` is usable:
- greet with `Welcome back, Sarah.`
- set `customerName` in conversation data
- skip `collect_name`
- offer saved addresses/sites if available

Ask for name only when no customer profile exists or the stored name is blank/placeholder.

## Saved address/site reuse

If saved structured addresses exist:
- one address: ask whether to use it
- multiple addresses: show a site list
- different address: continue to street address capture

Keep address copy short and do not expose internal ids, full phone numbers, raw URLs, or private notes.

## Active journey priority

Active flows still beat generic greetings. If a user sends `Hi` during an active request or provider application, resume or offer Continue/Cancel/Main menu rather than restarting profile capture.
