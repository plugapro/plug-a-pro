# Provider onboarding high-risk proof

Provider onboarding must detect selected services that are high-risk or regulated and ask for clearer proof during the evidence step.

## Classification

Service compliance metadata lives in `lib/service-category-policy.ts`.

- `standard`: normal portfolio/examples prompt.
- `high_risk`: proof recommended for review.
- `regulated`: certification/licence/trade proof should be reviewed before approval.

Current high-risk or regulated categories are Electrical, Pest Control, Air Conditioning, and Roofing. Plumbing is currently classified as standard and must not prompt for certification or block auto-approval.

## WhatsApp behaviour

- Standard services see the generic optional work-note prompt.
- High-risk selections see a certification-specific prompt naming the selected services.
- Providers can add a text proof note or upload a proof document/photo.
- Uploaded certification proof uses the private `provider_certification` attachment label.
- Proof notes and files are provider-supplied until reviewed. The app must not claim Plug A Pro verified them automatically.

## Review and customer display

- Admin/provider review screens show high-risk services and certification proof files.
- Certification proof files are private review documents and must not be shown to customers.
- Customer-facing “certified” or “verified” claims require an explicit reviewer decision, not merely an upload.
- Auto-approval skips high-risk or regulated applications so ops can review proof and risk before approval.

## Application summary

The WhatsApp application summary shows:

- `High-risk review: <services>` when high-risk services were selected.
- `Certification proof: Received`, `Provider note added`, or `Not added yet`.

Submission remains allowed for MVP, but approval is routed to manual review for high-risk categories.
