# Plug A Pro Engineering Instructions

## Project context

Plug A Pro is a mobile-first, WhatsApp-enabled field service marketplace. The platform connects customers with verified service providers and supports booking, lead matching, payments, job execution, and customer communication.

The current implementation priority is provider monetisation through a credit wallet system.

## Engineering rules

- Use the existing project conventions before introducing new patterns.
- Prefer simple, explicit services over clever abstractions.
- Keep payment and wallet logic ledger-first.
- Do not store wallet balance changes without a corresponding immutable ledger entry.
- Separate paid credits from promo credits.
- Promo credits cannot be withdrawn, refunded as cash, or transferred.
- KYC-approved providers only may unlock full customer lead details.
- Use comments in generated code to explain what each meaningful line or block is doing.
- Add tests for wallet balance calculation, lead unlock charging, payment crediting, promo awards, and refund handling.
- Do not reference tracker.md. Use OpenBrain-aligned implementation notes only.

## Validation expectations

Before completing any task:

- Run type checks.
- Run linting.
- Run the relevant test suite.
- Add or update tests for new business logic.
- Document key implementation decisions in an OpenBrain-compatible implementation note.