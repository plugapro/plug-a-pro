# Persona Clarification Document
## ServiceMen App

## 1. Executive Summary

ServiceMen App serves three major role groups:

| Role Group | Core Job To Be Done | Primary Concern | Platform Expectation |
|---|---|---|---|
| Platform Role | Operate a reliable, scalable field service business system | Control, quality, margin, exceptions | Strong admin visibility and intervention tools |
| Service Provider Role | Win work, execute profitably, get paid, protect reputation | Cash flow, scheduling, trust, admin load | Easy mobile workflows and fair commercial value |
| Client / Service Requester Role | Get a service problem solved safely and quickly | Trust, speed, price clarity, communication | Low-friction booking and strong reassurance |

Misunderstanding these personas creates direct risk:

- The platform may overbuild software but underbuild operations.
- Providers may churn if workflows feel controlling, unclear, or financially unfair.
- Clients may abandon bookings if trust, responsiveness, and visibility are weak.
- WhatsApp may become an uncontrolled shadow workflow if it is not tied to system state.

The biggest differences across the three groups are:

- The platform wants reliability, control, and profitable unit economics.
- Providers want utilisation, simplicity, and faster payment.
- Clients want certainty, convenience, and trust with minimal effort.

## 2. Persona Clarification Approach

This analysis uses a service design and operating model lens, not a demographic-only lens.

It covers:

- involvement in the business process
- motivations and decision patterns
- operational realities
- daily workflow behaviour
- digital habits
- trust and adoption barriers
- pain points and exception handling
- success measures and KPI implications

The purpose is to design the product, workflows, messaging, onboarding, and admin controls around how service delivery actually happens.

## 3. Platform Role Persona Clarification

The platform role is the human operating layer behind the software. In the MVP this may be a founder and one admin. Over time it separates into:

- platform owner / founder
- operations or admin manager
- dispatch coordinator
- support / compliance / finance function
- growth / customer success role

### Core responsibilities

| Internal Actor | Main Responsibility | Daily System Use | Key Decisions |
|---|---|---|---|
| Founder / Platform Owner | Business model, service quality, commercial performance | Reviews dashboards, complaints, provider quality | pricing, policy, service expansion, escalation standards |
| Ops / Admin Manager | Keeps daily operations stable | Works queues, booking exceptions, complaints | reassign, intervene, prioritise, recover failures |
| Dispatch Coordinator | Matches jobs to the right provider or technician | Manages availability, zones, jobs at risk | who gets the job, when, and under what constraints |
| Finance / Compliance | Protects money flow and trust controls | Reviews payments, payout states, docs, disputes | hold/release payouts, verification actions, payment exception handling |
| Growth / Customer Success | Improves activation and retention | Tracks funnel drop-off, churn, repeat usage | where to intervene, which cohorts need support |

### What the platform role needs

- end-to-end job visibility
- provider onboarding and verification controls
- request, quote, booking, and exception queues
- status tracking with timestamps and ownership
- payment and payout visibility
- complaint and dispute handling
- WhatsApp event visibility without losing system control
- reporting by category, provider, geography, and funnel stage

### What could go wrong if support is weak

- double-booking and missed slots
- no audit trail for quote or extra-work approvals
- slow dispute resolution
- revenue leakage and payout disputes
- poor provider quality control
- support overload from avoidable client uncertainty

### WhatsApp: useful but not enough

WhatsApp is useful for:

- enquiry capture
- booking reminders
- ETA and delay updates
- extra work approval prompts
- payment reminders
- review and follow-up nudges

WhatsApp is not enough for:

- admin audit trails
- finance controls
- dispatch ownership
- provider permissions
- complaint case management
- reporting and KPI analysis

### Platform archetypes

| Role Title | Persona Name | Goals | Frustrations | KPIs | Biggest Risks | Product Design Implications |
|---|---|---|---|---|---|---|
| Founder / Owner | Thabo the Operator-Founder | grow revenue without losing control | blind spots, inconsistent provider quality | GMV, repeat rate, complaint rate | reputation damage, weak unit economics | executive dashboard with exceptions, trends, and provider performance |
| Ops / Admin Manager | Lerato the Control Tower | stable day-to-day operations | too many manual follow-ups, unclear ownership | on-time arrival, completion rate, escalations resolved | operational overload | queue-based console with SLA timers and ownership |
| Dispatch Coordinator | Yusuf the Matcher | better fit between job, timing, and provider | poor availability data, vague job info | fill rate, reassignment rate, on-time start | bad assignments and travel waste | fast assignment tools, zone and skill views |
| Finance / Compliance | Naledi the Gatekeeper | protect payment integrity and provider legitimacy | manual POP matching, payout disputes | payment completion, payout cycle, fraud loss | chargebacks, unresolved finance disputes | ledger visibility, holds, document status, case links |
| Growth / Success | Aisha the Retention Driver | improve activation and repeat use | weak funnel visibility, unclear churn reasons | activation, repeat booking, provider activation | wasted acquisition and churn | lifecycle dashboards, cohort visibility, trigger-based follow-up |

## 4. Service Provider Persona Clarification

There is no single provider persona. Relevant segments include:

- solo operator
- small team owner
- experienced tradesman with informal processes
- established SME service business
- subcontractor network operator
- part-time side-hustle operator becoming formal

### Common provider realities

- WhatsApp often acts as CRM, quoting tool, and dispatch channel
- pricing consistency is often weak
- scheduling is reactive
- admin maturity varies sharply
- cash flow pressure shapes behaviour
- trust in a platform depends on fairness, payout speed, and lead quality
- many want professionalism without heavy admin overhead

### Key provider segments

| Segment | Typical Reality | Main Need From Platform | Main Adoption Barrier |
|---|---|---|---|
| Solo Operator | one person doing service and admin | more jobs, less admin, faster payment | fear of fees and loss of control |
| Small Team Owner | manages a few staff or helpers | scheduling, visibility, customer communication | concern platform will not reflect real field complexity |
| Informal Expert | highly skilled but weak on business systems | professional front-end, easy admin | distrust of formal systems and document burden |
| Structured SME | already has some business process | workflow, reporting, repeat business | rejects oversimplified lead-only tools |
| Network Operator | wins jobs then sub-allocates | accountability, visibility, margin control | fear of exposing network or losing flexibility |
| Side-Hustle Formaliser | inconsistent but ambitious | activation, reputation, lightweight structure | inconsistent capacity and weak process discipline |

### Provider profile examples

| Persona Name | Role / Type | Backstory | Team Size | Average Job Value | Current Tools | Goals | Frustrations | Needs From Platform | Product Design Implications |
|---|---|---|---|---|---|---|---|---|---|
| Sipho the Solo Fixer | solo plumber/electrician | built business through referrals | 1-2 | R500-R2,500 | WhatsApp, calls, bank app | steady work, less chasing, faster payout | no-shows, delayed payment, quote follow-up gaps | fast quoting, job status flow, payment visibility | one-thumb mobile flows and low typing burden |
| Johan the Small Team Owner | owner-manager | handles customers and staff all day | 4-8 | R800-R4,000 | WhatsApp groups, Excel, paper job cards | keep team busy, reduce chaos, improve professionalism | staff lateness, low visibility, customer confusion | dispatch board, technician updates, invoice clarity | owner/admin and technician role separation |
| Mandla the Master Tradesman | informal but skilled operator | respected for workmanship, weak on formal admin | 1-3 | R300-R1,800 | WhatsApp, calls, notebook | more work and easier admin | distrust of paperwork-heavy systems | guided onboarding, trust-building, assisted admin | tiered compliance and very simple workflows |
| Fatima the Structured SME | established service business | already serves residential and SME clients | 8-25 | R1,200-R8,000 | WhatsApp, accounting app, spreadsheets/CRM | utilisation, reporting, repeat business | lead-only tools that waste time | multi-role controls, repeat scheduling, reporting | configurable workflows and business account support |

### Provider maturity spectrum

| Maturity Level | Characteristics | Product Adaptation |
|---|---|---|
| Informal | reactive, low documentation, WhatsApp-heavy | guided onboarding, fewer mandatory steps, pay-per-use pricing |
| Emerging | some repeat clients and basic invoicing | templates, service area setup, simple team support |
| Operational | team-based with growing process needs | dispatch, job tracking, invoicing, performance visibility |
| Structured SME | multi-role business with stronger finance and reporting needs | permissions, reporting, repeat accounts, branded outputs |

## 5. Client / Service Requester Persona Clarification

Relevant client types include:

- household client
- busy professional
- family decision-maker
- landlord or property manager
- tenant with urgent need
- small business owner
- office or retail operations person
- recurring maintenance client
- emergency one-time requester
- price-sensitive client
- convenience-driven client
- trust-sensitive client

### Common client triggers and concerns

Typical triggers:

- leak or electrical fault
- broken appliance or fixture
- cleaning requirement
- maintenance issue affecting comfort or trading
- tenant complaint
- move-in / move-out requirement

Typical concerns:

- can I trust the provider?
- how quickly can someone come?
- will the final price change?
- do I know who is arriving?
- what happens if something goes wrong?
- how do I pay and get proof?

### Client persona profiles

| Persona Name | Context | Typical Need | Decision Drivers | Trust Requirements | Communication Preference | Budget Mindset | Product Design Implications |
|---|---|---|---|---|---|---|---|
| Zanele the Busy Professional | time-poor working homeowner | repairs, cleaning, quick fixes | convenience, speed, professionalism | verified provider and ETA clarity | WhatsApp first | willing to pay more for smooth service | keep booking short and status visibility strong |
| Nomsa the Household Decision-Maker | manages family home and risk | household maintenance and service decisions | trust, punctuality, price clarity | reviews, verification, support path | WhatsApp and phone | budget-aware, not cheapest-only | show trust signals and explain quotes clearly |
| Sibusiso the Urgent Tenant | urgent issue with limited authority | leak, lock, electrical problem | response speed and communication | visible escalation path and shareable quote | WhatsApp and calls | price-sensitive if paying personally | support urgent triage and landlord-share flow |
| Pieter the Property Manager | manages multiple units | repairs, turnovers, recurring maintenance | speed, records, accountability | proof of work and invoice discipline | WhatsApp plus web | cost-conscious but efficiency-driven | support property history, repeat booking, invoices |
| Amina the Small Business Owner | maintenance affects trading | electrical, plumbing, cleaning, repairs | uptime, reliability, invoice quality | verified provider and narrow appointment windows | WhatsApp during day, web for records | pragmatic | support business-friendly slots and records |
| Claire the Trust-Sensitive First-Time Booker | new to digital service booking | one-off home service | safety, predictability, reassurance | strong verification and support access | WhatsApp with clear detail | moderate | strong confidence-building copy and provider identity |

### Client decision journey

| Stage | Emotional State | Main Question | Friction Point | Messaging Need | WhatsApp Role | PWA Role |
|---|---|---|---|---|---|---|
| Need recognition | stress or irritation | who can solve this? | no trusted provider known | we can help quickly and safely | fast enquiry entry | service discovery |
| Quote request | cautious hope | how do I explain the issue quickly? | too much effort | send photos, voice note, or short detail | capture intent | structured request |
| Quote review | analytical and suspicious | is this fair and complete? | hidden cost fear | clear inclusion and exclusion explanation | prompt to review | full quote detail |
| Booking | relieved but watchful | is this confirmed? | weak confirmation | booking certainty and next steps | confirmation and reminders | booking detail |
| Pre-arrival | watchful | are they really coming? | silence or late updates | ETA and identity reassurance | ETA and delay updates | status tracking |
| Job execution | alert | will the scope change? | surprise extra work | explain why extra work is needed | approval prompt | structured approval |
| Completion and payment | evaluative | is the job really done and what do I owe? | weak proof or payment confusion | completion summary, invoice, receipt | completion and payment reminder | proof, invoice, payment |
| Follow-up | reflective | would I use this again? | no support path | review, support, rebook | follow-up and review | repeat booking and issue reporting |

## 6. Cross-Persona Comparison

| Dimension | Platform | Service Provider | Client |
|---|---|---|---|
| Main Goal | reliable, profitable operations | profitable work and faster payment | fast, safe problem resolution |
| Incentive | control and retention | utilisation and cash flow | convenience and trust |
| Fear | fraud, complaints, operational chaos | bad leads, hidden fees, slow payouts | scams, hidden costs, poor workmanship |
| Digital Behaviour | queue and dashboard based | mobile, in-field, WhatsApp-heavy | episodic, mobile-first, WhatsApp-heavy |
| Scheduling Concern | fill rate and reliability | double-booking and route waste | narrow windows and arrival certainty |
| Payment Concern | reconciliation and disputes | payout speed and non-payment | payment safety and receipt clarity |
| Quality Concern | provider inconsistency | unfair blame and unclear scope | professionalism and workmanship |
| Main Adoption Driver | operational leverage | more jobs with less admin | easier trusted booking |
| Main Rejection Driver | if ops still stay manual | if platform feels extractive or rigid | if booking feels risky or too hard |

## 7. Business Process and Role Involvement Map

| Stage | Main Roles | What They Want | System Need | WhatsApp Need | Main Failure Point |
|---|---|---|---|---|---|
| Service discovery | client, platform | trust and conversion | request capture | quick entry prompt | weak trust signals |
| Quote request | client, provider, ops | fast scoping | structured request | photo / voice note prompts | missing info |
| Quote review | client, provider | clarity and approval | quote review and approval record | quote alert and reminder | hidden cost fear |
| Booking | client, provider, ops | certainty | booking confirmation | confirmation message | slot ambiguity |
| Dispatch / allocation | dispatch, provider | correct assignment | assignment tools | provider alerts | wrong provider or delay |
| Travel / en route | client, technician | ETA certainty | status tracking | en route and delay updates | silence during delay |
| Job start / execution | client, technician | clear scope | job status and notes | start confirmation if needed | verbal-only scope changes |
| Extra work approval | client, provider | fast and fair approval | structured change request | approval prompt | disputed verbal approvals |
| Completion | client, provider | proof and closeout | completion logging | completion notice | weak proof of completion |
| Invoicing / payment | client, finance, provider | clear settlement | invoice, payment status, payout state | payment reminders | payment mismatch |
| Follow-up / complaint | client, platform | issue resolution or repeat use | support case logging | acknowledgement and update | poor recovery handling |

## 8. Product Design Implications

- onboarding must differ by role and provider maturity
- provider and technician permissions must be distinct
- admin needs action queues, not just reports
- client booking should minimise effort and maximise trust
- quote flow should explain scope, pricing, and extra-work rules
- payment flow should support South African practical realities including EFT and POP handling
- WhatsApp should write back to structured system state
- trust and safety must be built into workflow, not just marketing
- complaint and exception handling must exist from MVP

## 9. Assumptions, Unknowns, and Research Gaps

### Assumptions

- WhatsApp is the preferred communication channel for most users.
- Provider maturity will vary widely.
- Client trust and communication matter at least as much as price.
- The MVP will operate with platform intervention rather than full self-service automation.

### Main gaps to validate

- which client segment converts best first
- which provider segment activates and retains most easily
- how much payment handling the platform should own
- how often extra-work disputes happen
- how much property-manager demand exists in the early market
- which trust signals matter most to first-time clients

## 10. Recommended Next-Step Interview Questions

### Platform / admin

- Walk me through how a job gets handled today from first request to payment.
- Which exceptions take the most manual effort?
- What evidence do you need most often when resolving disputes?
- Where does WhatsApp help, and where does it create chaos?
- Which operational metrics matter most to you?

### Service providers

- How do you currently get jobs and manage your schedule?
- What usually makes a job unprofitable?
- How do you handle extra work on site?
- What would make you trust a platform like this?
- What would make you stop using it?

### Clients

- Tell me about the last time you needed a home or business service.
- How did you decide whom to trust?
- When do you ask for multiple quotes?
- What information do you need before approving a booking?
- What would make you book again without comparing alternatives?
