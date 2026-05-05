# 01 — Provider As-Is Assessment

## Task

Perform a focused as-is assessment of the current provider WhatsApp journey, provider PWA journey, credits, lead acceptance, job execution, and handoff behaviour.

Do not implement product changes in this step unless needed to generate assessment documentation.

## Why

The provider journey must be WhatsApp-first and WhatsApp-complete. We need to inspect current flows before changing anything.

## Inspect

Search for:

```text
provider
worker
serviceman
WhatsApp webhook
button_reply
interactive
menu
Register
Find Work
application submitted
application approved
provider approved
credit
credits
ledger
balance
lead
opportunity
Accept Lead
interested
arrival
on the way
arrived
complete
provider portal
worker portal
secure token
handoff
```

Inspect:

```text
WhatsApp bot handlers
provider onboarding state machine
provider PWA routes
provider dashboard
lead preview pages
accept lead handlers
credit services
job status APIs
notification services
secure token resolver
tests
```

## Questions to answer

1. Which provider actions currently work fully in WhatsApp?
2. Which provider actions require PWA today?
3. What provider PWA routes exist?
4. What WhatsApp commands exist?
5. How does provider onboarding work today?
6. How does provider approval work today?
7. How are credits shown and deducted?
8. How does provider receive and accept leads today?
9. Does provider receive full customer details in WhatsApp after acceptance?
10. Can provider confirm arrival in WhatsApp?
11. Can provider update job status in WhatsApp?
12. Can provider complete a job in WhatsApp?
13. What secure token/handoff model exists?
14. Where are privacy rules enforced?
15. What gaps block a WhatsApp-complete provider journey?

## Required output

Create:

```text
docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md
```

The output must list:

```text
existing WhatsApp provider commands
existing provider routes
existing webhook handlers
existing provider APIs/server actions
existing credit services
existing job status flows
existing secure token/access model
current gaps
reuse recommendations
implementation risks
```

## Acceptance criteria

- No major product changes made.
- Existing provider WhatsApp journey is documented.
- Existing provider PWA journey is documented.
- Gaps against WhatsApp-complete journey are identified.
- OpenBrain note is included.
