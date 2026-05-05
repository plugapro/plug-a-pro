# 06 — Provider Admin Review and Approval

## Task to execute

Implement or upgrade admin review so provider approval has clear meaning.

## Why this is needed

A provider should not receive leads just because they registered. Admin must review and approve provider suitability.

## Admin capabilities required

Admin must be able to:

```text
view provider application
approve provider
reject provider
request more information
approve specific service categories
reject specific service categories
set verification level
set trust level
suspend provider
add internal notes
award starter credits
view provider documents
view previous work photos
view references
```

## Provider verification levels

```text
basic_reviewed
identity_verified
reference_checked
certification_verified
trusted
```

## Category approval rules

A provider can be approved for one category and not another.

Example:

```text
Plumbing: approved
Electrical: pending_certification
Handyman: approved
```

## Approval side effects

When admin approves a provider:

1. Set provider status to `approved` or `trusted`.
2. Activate approved service categories.
3. Ensure Worker Portal login can resolve this provider.
4. Award starter credits using the credit ledger.
5. Send provider approval WhatsApp message.
6. Log activity.
7. Log OpenBrain implementation note.

## Approval WhatsApp message

```text
✅ Application approved

Hi {{provider_name}}, you’re now active on Plug A Pro.

Starter credits awarded: {{starter_credits}} credits
Available balance: {{available_credits}} credits

Each customer-selected job you accept uses 1 credit. Full customer details unlock after acceptance.

Worker Portal:
{{worker_portal_url}}

Provider terms and credit rules:
{{terms_url}}
```

## Implementation requirements

1. Reuse existing admin screens where possible.
2. Add missing review fields/actions.
3. Ensure approval is transactional.
4. Starter credits must be added through credit ledger, not direct balance mutation only.
5. Ensure WhatsApp links use production public URL helper.
6. Ensure approval creates or links provider portal identity if required.
7. Add audit log entries.

## Acceptance criteria

- Admin can approve/reject/request more info.
- Admin can approve categories separately.
- Approved provider can log into Worker Portal.
- Approved provider receives starter credits.
- Credit ledger records starter credit award.
- Approval WhatsApp message includes credits and terms link.
- Pending providers cannot receive leads.
- Suspended providers cannot receive leads.
- Tests pass.

## Test cases

```text
admin approves provider
provider status becomes approved
category approval saved
starter credits awarded once
approval message sent
approval message has production URLs
pending provider cannot receive leads
suspended provider excluded from matching
provider login works after approval
duplicate approval does not double-award credits
```
