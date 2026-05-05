# WhatsApp provider status journey

Provider Status must work for approved, pending, inactive, suspended, and rejected providers.

## Status model

- Application status explains the review journey: pending review, more details needed, approved, rejected, or cancelled.
- Provider profile status explains marketplace eligibility: active, inactive, suspended, archived, or banned.
- Availability explains whether an approved active provider is currently receiving leads.
- Credits status is shown only as a supporting provider-wallet summary and must not block status lookup.

## Recovery rules

- Inactive is not an error by itself. If an application is pending review, explain that the profile stays inactive until approval is complete.
- Missing credits wallet, verification, profile photo, or availability records must not crash Provider Status.
- Provider Status retry actions must route back to Provider Status, not to application submit or generic journey recovery.
- If no application or provider is linked to the WhatsApp number, offer Apply as provider and Main Menu.

## Root cause fixed

The previous Provider Status path entered the active-provider availability and credits summary before resolving application state. Pending or inactive providers can legitimately lack wallet, verification, or availability records, which caused generic recovery errors. The handler now resolves provider plus latest application by normalized phone variants/provider id and returns state-specific copy before touching active-provider-only services.
