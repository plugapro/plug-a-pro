# Customer Lifecycle Policy

This document records the customer merge and purge rules implemented in the current admin slice.

## Archive and purge

- Archiving a customer now schedules a purge date 30 days in the future.
- Purge is only allowed after that date.
- Purge is only allowed when no `JobRequest` rows still reference the customer.
- Before delete, nullable historical references are detached:
  - `MessageEvent.customerId -> null`
  - `Review.customerId -> null`
- Addresses, notes, and WhatsApp preference logs delete through cascade with the customer row.

## Merge rules

Merging treats the target customer as canonical.

Target fields:

- `phone`: target remains authoritative
- `userId`: target keeps its value; if target has none, source `userId` is adopted
- `email`: target keeps its value; if target has none, source `email` is adopted
- `address`: target keeps its value; if target has none, source `address` is adopted
- `notes`: target and source notes are concatenated
- `marketingOptIn` / `serviceOptIn`: merged with logical OR
- block/suspension fields: target keeps its value first; source fills gaps when target is empty

Reparented from source to target:

- `Address`
- `CustomerNote`
- `JobRequest`
- `MessageEvent`
- `WhatsappPreferenceLog`
- `Review`

Source customer after merge:

- set inactive
- archived immediately
- scheduled for purge after 30 days
- `mergedIntoCustomerId` points to target
- `userId` is cleared to avoid uniqueness conflicts after transfer

## Guardrails

- Source and target must be different customers.
- Merge is refused if both customers are linked to different authenticated accounts (`userId` conflict).
- Purge is refused while required history (`JobRequest`) still points at the customer.
