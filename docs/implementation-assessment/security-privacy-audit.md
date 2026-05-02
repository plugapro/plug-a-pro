# Security and Privacy Audit

Date: 2026-05-02

## Scope

Audited provider previews, selected-provider full-detail unlock, customer ticket access, provider lead tokens, attachment access, and public URL/privacy copy introduced during the Qualified Shortlist implementation.

## Findings and Actions

### Provider Preview

- `getProviderLeadDetailForProvider` already separates preview and full details.
- `resolveProviderLeadAccessToken` already withholds customer PII and exact address before acceptance.
- `getSafeProviderOpportunityPreview` selected only safe location fields, but returned raw description.
- Action: updated opportunity preview to use `previewNotes`, matching existing lead detail behavior and reducing risk of leaking access notes embedded late in free text.

### Full Details

- Full customer details require `Lead.status = ACCEPTED` and a provider-owned `LeadUnlock`.
- Step 13 selected-provider final acceptance creates the unlock only after the selected provider accepts and spends 1 credit.
- Non-selected providers are rejected before wallet debit or assignment.

### Customer Ticket Access

- Customer request links use `customerAccessToken`, expiry, and revocation checks.
- Customer ticket links intentionally show the customer their own full request address and attachments.
- Provider shortlist cards expose provider profile/business data, not provider private personal data.

### Attachments

- Attachment route proxies storage server-side and sets private cache headers.
- Customer ticket token grants access only to attachments on the matching request/job.
- Provider lead token grants access only to attachments scoped to the lead job request.
- Provider session access to pre-acceptance request photos is allowed for active non-expired lead previews.

### Logging

- Denial logs use trace IDs and record entity IDs/statuses.
- No new logs were added that include customer phone, exact address, unit, complex, or access notes.

## Remaining Risks

- Free-text customer descriptions can still include private information near the beginning of the text. The current mitigation is truncation; stronger structured capture or automated redaction should be considered before broad rollout.
- Legacy sequential acceptance paths still exist for compatibility and should remain behind rollout controls while shortlist flow is validated.
- Storage bucket policy was not directly inspected from infrastructure; application proxy rules are in place.

## OpenBrain Note

Security/privacy audit completed. The shortlist preview/detail separation is enforced server-side through query selection and unlock checks. Opportunity preview descriptions now use the existing preview-note truncation. Full customer detail access remains gated by accepted lead plus provider-owned unlock after selected-provider final acceptance.
