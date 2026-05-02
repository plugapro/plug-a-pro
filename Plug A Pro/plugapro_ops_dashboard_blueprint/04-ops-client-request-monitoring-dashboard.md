# 04 — Ops Client Request Monitoring Dashboard

## Task

Implement or align the Ops dashboard for monitoring client service requests across WhatsApp and PWA.

## Required views

Ops should see:

```text
request reference
customer name/contact according to permission
category/subcategory
description
photos/attachments
general area
full address if permitted
urgency
preferred time
request source
current status
matching status
shortlist status
selected provider
job status
created/submitted timestamps
```

## Required actions

Ops may need to:

```text
view request timeline
view attachments
view safe preview as provider would see it
view customer-facing status
edit/correct categorisation
edit/correct area where safe
cancel request
escalate request
trigger/rematch manually
send customer update
```

## Privacy

Viewing full address/customer phone should require proper role and audit.

## Acceptance criteria

- Ops can monitor client requests.
- Ops can see request lifecycle.
- Ops can inspect matching state.
- Sensitive data is protected/audited.
- Tests pass.
