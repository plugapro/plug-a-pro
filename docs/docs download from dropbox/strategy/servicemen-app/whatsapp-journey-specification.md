# WhatsApp Journey Specification
## ServiceMen App

## 1. Purpose

This document defines how WhatsApp should be used across the ServiceMen App journey.

Core principle:

- WhatsApp is the conversational front door and reassurance layer.
- The PWA is the structured action and record layer.
- The admin system is the operational control and audit layer.

WhatsApp should accelerate action, not become an unstructured shadow workflow.

## 2. WhatsApp Strategy Principles

1. Use WhatsApp where users want speed and familiarity.
2. Use the PWA where users must review, approve, pay, or track clearly.
3. Keep messages concise and action-oriented.
4. Always provide a clear next step.
5. Preserve sent, delivered, clicked, and action state where possible.
6. Sync all important WhatsApp-driven events into the system of record.
7. Design for mobile-first, interruption-heavy, low-data behaviour.

## 3. Role of WhatsApp by Persona

| Persona | Role of WhatsApp |
|---|---|
| Household client | enquiry, reassurance, reminders, approvals, support |
| Busy professional | action prompts and low-effort updates |
| Urgent client | triage, ETA, escalation, rapid approval |
| Business client | alerts, approvals, payment and invoice nudges |
| Solo provider | work intake, reminders, payment visibility |
| Team owner | assignment alerts, exception prompts, payout updates |
| Technician | assignment, route, status, completion prompts |
| Platform ops | rescue channel when workflows stall |

## 4. Journey Map by Stage

| Stage | WhatsApp Objective | Sender | Recipient | Main Message Type | PWA Action |
|---|---|---|---|---|---|
| Discovery / entry | capture intent fast | platform | client | welcome and triage | start request |
| Request completion | collect missing information | platform | client | prompt for photos, location, urgency | complete request |
| Quote ready | drive review and approval | platform or provider via platform | client | quote summary + CTA | view quote |
| Quote reminder | recover stalled demand | platform | client | reminder and urgency cue | review quote |
| Booking confirmed | reduce ambiguity | platform | client | date, slot, provider, next step | view booking |
| Provider assigned | build trust | platform | client | who is coming and what to expect | booking detail |
| Job alert | ensure provider action | platform | provider / technician | new job / upcoming job | open job |
| En route | reduce anxiety | provider / platform | client | ETA and access prompt | view live status |
| Delay / reschedule | save the relationship | platform / provider | client | delay explanation and new next step | reschedule / support |
| Extra work approval | get rapid traceable consent | provider / platform | client | issue explanation + CTA | approve change |
| Completion | close the loop | provider / platform | client | job complete, proof, invoice | review completion |
| Payment reminder | collect payment cleanly | platform | client | amount due and method | pay / confirm payment |
| Payout / settlement | maintain provider trust | platform | provider | payment received / payout state | view payout |
| Review / rebook | encourage retention | platform | client | rate, review, or rebook | review / repeat booking |
| Complaint recovery | contain service failure | platform | client / provider | acknowledgement and next step | open case |

## 5. Detailed Journey Design

### 5.1 Entry and request capture

Recommended entry points:

- landing page WhatsApp CTA
- QR code
- ad or referral campaign links
- repeat customer conversation re-entry

WhatsApp should:

- greet and orient
- ask for service type
- ask for urgency
- ask for area or location pin
- request photos or voice notes
- hand off to PWA when structured details are required

Design implication:
WhatsApp lowers activation energy. It should not carry the full request workflow alone.

### 5.2 Quote stage

WhatsApp should:

- notify that quote is ready
- summarise price or call-out at a high level
- prompt the user to open the quote in the PWA

The PWA should hold:

- full pricing detail
- scope inclusions and exclusions
- validity
- extra-work rules
- approval action

### 5.3 Booking confirmation

Booking confirmation messages should include:

- service type
- date and time window
- provider or business name
- payment expectation if relevant
- support path if anything changes

### 5.4 Pre-arrival and ETA

This is a high-trust stage.

Messages should include:

- reminder before appointment
- provider / technician identity where appropriate
- en route update
- delay notification when needed
- access instructions prompt if missing

Design implication:
Silence between booking and arrival creates support load and trust erosion.

### 5.5 Extra work approval

WhatsApp should:

- alert the client that extra work is needed
- summarise the reason
- link to a structured approval screen

The PWA should capture:

- why extra work is needed
- photo evidence
- revised amount
- timing implications
- approval or decline action

### 5.6 Completion and payment

Completion message should include:

- job marked complete
- view proof or photos
- view invoice or receipt
- payment prompt where needed
- support option if there is an issue

Payment reminders should be:

- amount-specific
- professional
- linked to visible invoice or payment state

### 5.7 Follow-up

Follow-up should do one of three things:

- request a review
- offer support if the job is not right
- encourage repeat booking

Avoid requesting reviews too early or before payment / issue resolution.

## 6. WhatsApp vs PWA Split

| Task | WhatsApp | PWA |
|---|---|---|
| start enquiry | yes | optional |
| collect photos and voice notes | yes | yes |
| structured request detail | assist only | yes |
| quote notification | yes | yes |
| full quote review | no | yes |
| booking confirmation | yes | yes |
| status tracking | light | yes |
| ETA updates | yes | yes |
| extra work alert | yes | yes |
| approval record | no | yes |
| payment reminder | yes | yes |
| invoice / receipt detail | light | yes |
| complaint acknowledgement | yes | yes |
| case management | no | yes |

## 7. Core MVP Message Categories

- welcome / onboarding
- request completion prompt
- quote ready
- quote reminder
- booking confirmed
- booking reminder
- provider assigned
- en route
- delay notice
- extra work approval prompt
- completion notice
- payment due
- payment received
- review request
- rebook prompt
- support acknowledgement
- complaint update

Keep the template set small in MVP.

## 8. Rules by Context

### Urgent jobs

- prioritise speed and reassurance
- ask only essential questions first
- keep messages short
- send faster status updates
- minimise comparison language

### Planned jobs

- support clearer scoping
- allow richer quote review
- provide scheduling flexibility
- use reminders more deliberately

### First-time clients

- show stronger trust markers
- provide more identity and support context
- use more expectation-setting

### Repeat clients

- shorten message copy
- use faster rebook actions
- reduce repeated explanation

## 9. Provider-Facing WhatsApp Journeys

Provider and technician WhatsApp use cases:

- new quote request alert
- booking assignment alert
- upcoming appointment reminder
- unresponsive client warning
- late-status prompt
- payout update
- complaint response request

These should deep-link into the PWA instead of becoming the actual workflow source.

## 10. Escalation Use Cases

WhatsApp is useful when:

- a client is about to abandon due to silence
- a provider is late
- a payment proof is missing
- a complaint needs immediate acknowledgement
- a booking has changed and all parties need rapid notification

All escalations should also create structured case or job-state updates.

## 11. Failure States To Design For

- user reads but does not act
- provider ignores assignment alert
- message reaches wrong or inactive number
- user responds only in free text
- critical voice-note info is not structured
- promises made in chat are not reflected in system state
- user completes action in the PWA but follow-up messaging is stale

Design implications:

- support manual follow-up
- flag missing required information
- log action state where possible
- avoid overcomplicated branching logic

## 12. Recommended MVP WhatsApp Priorities

Build first:

1. enquiry initiation
2. request completion prompts
3. quote ready and quote reminder
4. booking confirmation and reminder
5. en route and delay updates
6. extra work approval prompt
7. completion and invoice/payment follow-up
8. review and support follow-up

Avoid in MVP:

- overly complex conversational automation
- too many templates
- WhatsApp-only approvals without system record
- provider CRM campaigns
- broad outbound marketing automation

## 13. KPI Recommendations

Track:

- WhatsApp conversation to request completion rate
- quote message click-through rate
- quote reminder recovery rate
- booking confirmation engagement rate
- ETA update engagement rate
- extra work approval turnaround time
- payment reminder recovery rate
- complaint acknowledgement time
- repeat booking from WhatsApp follow-up

## 14. Final Recommendation

The strongest model is:

- WhatsApp for conversation and reassurance
- PWA for structured action
- admin system for operational control

That split should stay explicit in product design, workflow design, and instrumentation.
