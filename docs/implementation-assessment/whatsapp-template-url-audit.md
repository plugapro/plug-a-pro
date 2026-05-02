# WhatsApp Template and URL Audit

Date: 2026-05-02

## Scope

Audited WhatsApp-facing copy and link generation related to provider onboarding, provider opportunity/credit rules, customer shortlist flow, selected-provider confirmation, and production public URLs.

## URL Findings

- Central helper: `field-service/lib/provider-credit-copy.ts`
- Canonical production URL expected by environment: `https://app.plugapro.co.za`
- Primary app URL env vars: `APP_PUBLIC_URL`, then `NEXT_PUBLIC_APP_URL`
- Provider lead URL env vars: `PROVIDER_LEAD_APP_URL`, `NEXT_PUBLIC_PROVIDER_LEAD_APP_URL`, then app URL fallbacks
- Provider terms env vars: `PROVIDER_TERMS_URL`, `NEXT_PUBLIC_PROVIDER_TERMS_URL`, then `/provider/terms/credits`

## Updates Made

- Safe path joining now collapses duplicate leading slashes before appending to the public base URL.
- Provider terms override URLs are now validated as absolute URLs.
- Provider terms override URLs containing `localhost` or `127.0.0.1` are blocked in production.
- Provider onboarding and opportunity copy now explains the shortlist credit rule:
  - previewing/responding is free
  - credit is spent only after the customer selects the provider and the provider accepts the selected job
  - full customer details unlock only after selected-job acceptance

## Template Alignment Notes

Provider copy now aligns with the Qualified Shortlist Model for:

- onboarding intro
- application submitted
- opportunity preview
- quick response/action copy
- insufficient credits copy

Step 12 and 13 added selected-provider notification copy:

- `interactive:provider_selected_for_confirmation`
- `interactive:selected_job_accepted_provider`
- `interactive:selected_job_accepted_customer`

## Remaining Follow-Ups

- Legacy WhatsApp bot branches still contain some old "lead accepted" wording for the sequential assignment compatibility path.
- WhatsApp button IDs for "Interested" and "Not interested" should be fully wired to the step 11 opportunity response service before public rollout.
- Customer "shortlist ready" outbound message should be added when shortlist generation is triggered automatically.

## OpenBrain Note

WhatsApp URL and template audit completed. Public URL generation continues to fail safely when production URL configuration is missing or invalid, blocks localhost in production, and central provider credit copy now reflects shortlist monetisation: free preview/interest, customer selection, then paid provider final acceptance.
