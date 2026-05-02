# 05 — Provider Optional PWA Profile and Dashboard Flow

## Task

Implement or align the Provider PWA as an optional richer workspace.

## Why

Provider must not need PWA for core operations, but PWA should make profile, dashboard, credits, and job history easier.

## Suggested routes

```text
/provider
/provider/apply
/provider/application
/provider/dashboard
/provider/credits
/provider/credits/history
/provider/profile
/provider/profile/services
/provider/profile/areas
/provider/profile/availability
/provider/profile/rates
/provider/opportunities
/provider/jobs
/provider/jobs/:jobId
```

## Dashboard should show

```text
availability status
credit balance
new opportunities
selected jobs awaiting acceptance
active jobs
upcoming jobs
completed jobs
profile completeness
```

## Profile management

Provider can manage:

```text
profile photo
bio
service categories
sub-services
years of experience
work areas
availability
rates
documents
previous work photos
references
```

Some changes may require admin re-approval.

## Implementation requirements

1. Reuse current Worker Portal where possible.
2. Ensure PWA actions map to same backend state as WhatsApp.
3. Ensure PWA does not become mandatory.
4. Ensure restricted profile changes trigger review where needed.
5. Add tests.

## Acceptance criteria

- Provider dashboard exists or is aligned.
- Credits are visible.
- Active jobs are visible.
- Profile can be viewed/edited where allowed.
- WhatsApp still supports core actions.
- Tests pass.
