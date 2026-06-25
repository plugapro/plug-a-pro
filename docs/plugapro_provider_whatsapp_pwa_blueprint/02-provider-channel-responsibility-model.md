# 02 — Provider Channel Responsibility Model

## Task

Implement or document the channel responsibility model for provider WhatsApp and provider PWA.

## Why

The provider journey must not assume the provider has data for PWA use. WhatsApp must be enough for daily provider operations.

## Required channel model

### WhatsApp must support

```text
application
profile data capture
service category capture
work area capture
availability capture
rate capture
application status
approval/rejection/more info
credit balance
opportunity preview
interest response
call-out fee and arrival response
customer selected notification
job acceptance
credit confirmation
full customer details
arrival confirmation
job status updates
completion
help/menu/status
```

### PWA may support

```text
dashboard
full profile editing
bulk area/rate management
credit ledger/history
full job card
image gallery
document management
job history
performance dashboard
```

## Implementation requirements

1. Document channel ownership in code/docs.
2. Ensure no core provider operation is PWA-only.
3. Where existing PWA-only operation exists, add WhatsApp path or document blocker.
4. Ensure WhatsApp messages can link to PWA as optional enhancement.
5. Add tests or assertions where practical to prevent required PWA-only flows.

## Acceptance criteria

- Channel responsibility is documented.
- Core provider actions have WhatsApp paths or explicit blockers.
- PWA is optional for normal provider operations.
- OpenBrain note is included.
