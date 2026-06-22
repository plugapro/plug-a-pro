# Role-by-Role Feature Requirements Matrix
## ServiceMen App

## 1. Purpose

This matrix translates persona realities into concrete role-based feature requirements for the MVP and near-term roadmap.

Roles covered:

- platform owner
- operations / admin manager
- dispatch coordinator
- finance / compliance operator
- growth / customer success
- provider owner
- technician / field worker
- household client
- business client / property manager

Requirement labels:

- `Must Have`
- `Should Have`
- `Later`

## 2. Core Feature Matrix

| Capability Area | Platform Owner | Ops / Admin | Dispatch | Finance / Compliance | Growth / Success | Provider Owner | Technician | Household Client | Business Client / Property Manager |
|---|---|---|---|---|---|---|---|---|---|
| role-based login and access | Must Have | Must Have | Must Have | Must Have | Must Have | Must Have | Must Have | Should Have | Must Have |
| mobile-first interface | Should Have | Should Have | Should Have | Should Have | Should Have | Must Have | Must Have | Must Have | Must Have |
| dashboard / home screen | Must Have | Must Have | Must Have | Must Have | Must Have | Must Have | Must Have | Should Have | Must Have |
| new request queue | Must Have | Must Have | Should Have | Later | Should Have | Should Have | Later | Later | Later |
| category and issue capture | Should Have | Should Have | Should Have | Later | Later | Should Have | Later | Must Have | Must Have |
| photo / document capture | Should Have | Must Have | Should Have | Should Have | Later | Must Have | Must Have | Must Have | Must Have |
| quote creation | Should Have | Must Have | Later | Later | Later | Must Have | Later | Must Have to review and approve | Must Have to review and approve |
| quote review and approval | Visibility only | Visibility only | Later | Later | Later | Must Have visibility | Later | Must Have | Must Have |
| booking confirmation | Visibility only | Must Have | Must Have | Later | Later | Must Have | Must Have visibility | Must Have | Must Have |
| provider / technician assignment | Visibility only | Must Have | Must Have | Later | Later | Must Have for own team | Must Have visibility | Later | Later |
| availability / slot management | Should Have | Must Have | Must Have | Later | Later | Must Have | Should Have | visible result required | visible result required |
| status tracking | Visibility only | Must Have | Must Have | Later | Later | Must Have | Must Have | Must Have visibility | Must Have visibility |
| ETA updates | Visibility only | Must Have | Must Have | Later | Later | Must Have | Must Have | Must Have | Must Have |
| in-app job details | Visibility only | Must Have | Must Have | Later | Later | Must Have | Must Have | Should Have limited | Must Have limited |
| extra work approval | Visibility only | Must Have | Should Have | Later | Later | Must Have | Must Have | Must Have | Must Have |
| payment status | Must Have | Must Have | Should Have | Must Have | Later | Must Have | Should Have | Must Have | Must Have |
| invoice / receipt generation | Visibility only | Must Have | Later | Must Have | Later | Must Have | Later | Must Have | Must Have |
| proof-of-payment capture | Later | Must Have | Later | Must Have | Later | Must Have visibility | Later | Must Have where EFT applies | Must Have where EFT applies |
| payout tracking | Must Have | Must Have | Later | Must Have | Later | Must Have | Should Have | Later | Later |
| complaint / dispute logging | Must Have | Must Have | Should Have | Must Have | Should Have | Must Have visibility | Should Have visibility | Must Have | Must Have |
| job history / audit trail | Must Have | Must Have | Must Have | Must Have | Should Have | Must Have | Should Have | Should Have | Must Have |
| provider verification visibility | Must Have | Must Have | Should Have | Must Have | Later | Must Have visibility | Later | Must Have | Must Have |
| communication timeline | Must Have | Must Have | Must Have | Should Have | Should Have | Must Have | Should Have | Should Have | Must Have |
| WhatsApp-triggered messages | Visibility only | Must Have | Must Have | Should Have | Must Have | Must Have | Must Have | Must Have | Must Have |
| manual override tools | Must Have | Must Have | Must Have | Must Have | Later | Should Have for own team | Later | Later | Later |
| reporting / KPI views | Must Have | Must Have | Should Have | Must Have | Must Have | Must Have | Later | Later | Should Have |
| repeat booking | Should Have | Should Have | Later | Later | Must Have | Should Have | Later | Should Have | Must Have |
| ratings / reviews | Must Have visibility | Must Have moderation | Later | Later | Must Have | Must Have visibility | Should Have visibility | Should Have | Should Have |
| multi-property management | Later | Should Have | Later | Later | Later | Later | Later | Later | Must Have |
| team management | Later | Later | Later | Later | Later | Must Have | Must Have visibility | Later | Later |

## 3. Role-Specific Requirements

### Platform Owner

Needs:

- executive dashboard
- funnel and revenue visibility
- provider quality and complaint trends
- payment and payout health
- exception summaries and escalation signals

Design implication:
Show trends, risks, and levers, not just raw operational noise.

### Ops / Admin Manager

Needs:

- queue-based work views
- booking and complaint ownership
- late-job alerts
- missing-information flags
- manual intervention tools

Design implication:
This role needs fast actions with strong context.

### Dispatch Coordinator

Needs:

- available provider and technician views
- zone and category matching
- assignment and reassignment tools
- live status and lateness visibility

Design implication:
Dispatch screens should optimise speed and fit, not reporting.

### Finance / Compliance

Needs:

- provider verification status
- invoice and payment state
- POP review support
- payout hold / release controls
- dispute-linked transaction visibility

Design implication:
Finance needs traceability tied to jobs and cases.

### Growth / Customer Success

Needs:

- activation funnel visibility
- repeat booking and churn signals
- provider inactivity detection
- complaint theme visibility

Design implication:
Growth insights should be tied to actual service journey stages.

### Provider Owner

Needs:

- jobs list
- quote tools
- team visibility
- customer communication support
- invoice and payout visibility
- performance reporting

Design implication:
Provider features must feel like business support, not admin burden.

### Technician

Needs:

- simple job list
- address and contact details
- notes and photos
- status update actions
- extra approval request
- proof capture

Design implication:
The technician interface must assume low attention, movement, and intermittent signal.

### Household Client

Needs:

- easy service request
- booking and ETA visibility
- quote clarity
- provider identity
- payment and receipt clarity
- issue reporting

Design implication:
The client experience should optimise certainty over feature depth.

### Business Client / Property Manager

Needs:

- repeat use and property history
- invoice discipline
- proof of work
- clear support and accountability

Design implication:
Business clients need more structure, even inside a WhatsApp-led model.

## 4. Requirement Themes

### Trust

Must be visible in:

- provider identity
- verification status
- quote clarity
- completion proof
- issue reporting path
- payment transparency

### Operational Control

Must exist in:

- queues
- assignment
- manual override
- case logging
- audit trail
- status ownership

### Field Workflow

Must support:

- accept job
- navigate and arrive
- start work
- request extra approval
- upload evidence
- complete job

### Communication

Must support:

- WhatsApp entry points
- confirmations
- reminders
- ETA and delay updates
- approval prompts
- payment prompts
- follow-up messages

## 5. Permission Model Recommendation

| Permission Layer | Recommended Roles |
|---|---|
| platform-wide control | founder, ops lead |
| booking and dispatch | ops admin, dispatcher |
| finance and payout control | finance / compliance |
| provider business admin | provider owner |
| field execution only | technician |
| client self-service | client |
| business account management | property manager / office admin |

## 6. Final Recommendation

If a feature does not clearly support one or more role groups in their real workflow, it should not enter MVP scope by default.

This matrix should be used to drive:

- PRD writing
- UX flows
- role permissions
- backlog prioritisation
- admin console design
