# MVP Scope Prioritisation Document
## ServiceMen App

## 1. Purpose

This document defines the smallest operationally credible MVP for ServiceMen App.

The objective is not to launch a complete field service suite. The objective is to launch a system that can reliably convert demand into completed, paid jobs while keeping trust, communication, and operational control intact.

## 2. Prioritisation Lens

Features are prioritised against six questions:

| Criterion | Why It Matters |
|---|---|
| Revenue impact | does it help requests become paid jobs? |
| Trust impact | does it reduce uncertainty, fear, or disputes? |
| Operational necessity | can the business run without it? |
| WhatsApp fit | does it reflect real user communication behaviour? |
| Complexity risk | will it slow the MVP or create edge-case overload? |
| Future leverage | does it create a foundation for later scale? |

Priority labels:

- `P0`: required for launch
- `P1`: important soon after launch
- `P2`: valuable but not urgent
- `P3`: strategic later-stage capability

## 3. Recommended MVP Position

The MVP should be positioned as:

- a mobile-first field service booking and operations platform
- with WhatsApp-led customer communication
- designed for platform-assisted execution, not a fully open marketplace
- focused on residential and light SME service categories first

It should not try to be:

- a full enterprise FSM suite
- a complex multi-provider quote comparison marketplace
- a full accounting platform
- a route optimisation engine
- a broad all-category service marketplace

## 4. MVP Service Scope

### Recommended early service categories

- plumbing
- electrical
- handyman
- basic repairs
- cleaning
- light maintenance

### Recommended early client focus

- household clients
- busy professionals
- family decision-makers
- urgent tenants
- small business owners
- light property-manager scenarios

### Recommended early provider focus

- solo operators
- small team owners
- emerging informal-to-formal providers
- light structured SMEs

## 5. Core Product Loop

The MVP must make this loop reliable:

1. client submits request quickly
2. system collects enough information to quote or book
3. quote is reviewed and approved clearly
4. booking is confirmed with slot and provider identity
5. provider receives structured job workflow
6. client receives WhatsApp-based reassurance and updates
7. extra work is approved in a traceable way
8. job is completed with proof
9. payment and invoice state are clear
10. support, review, and repeat booking become possible

## 6. P0 Scope

### Client P0

| Feature | Why It Is Core |
|---|---|
| mobile-first service request flow | the MVP starts with demand capture |
| WhatsApp entry into request flow | matches real behaviour |
| category, issue, location, and photo capture | necessary for scoping |
| quote review and approval screen | trust and conversion depend on this |
| booking confirmation | removes ambiguity |
| provider identity and status visibility | major trust requirement |
| ETA and delay visibility | reduces support load and anxiety |
| extra work approval flow | prevents verbal disputes |
| payment instruction and confirmation | money flow clarity |
| completion proof and invoice access | closeout and professionalism |
| issue reporting path | trust recovery mechanism |

### Provider / technician P0

| Feature | Why It Is Core |
|---|---|
| mobile provider access | field work is mobile-first |
| profile, categories, area, and availability | routing and assignment depend on this |
| quote response or creation workflow | core revenue step |
| job accept / reject | operational control |
| daily jobs list | field execution minimum |
| job detail with address, media, and notes | execution quality |
| en route / arrived / started / completed states | operational and client visibility |
| proof photo upload | dispute protection |
| extra work request flow | protects margins and trust |
| payment / payout visibility | provider trust requirement |

### Platform / admin P0

| Feature | Why It Is Core |
|---|---|
| request and job queue dashboard | control tower function |
| provider onboarding and approval | trust and quality control |
| quote and booking oversight | early operational intervention |
| manual assignment and reassignment | automation can wait, control cannot |
| late-job and failure visibility | service reliability |
| basic payment tracking and reconciliation | commercial integrity |
| complaint and dispute logging | trust recovery |
| volume, conversion, and completion reporting | necessary for learning |
| role-based internal permissions | operational separation and risk control |
| WhatsApp event logging into state | avoids channel-state mismatch |

## 7. P1 Scope

These should follow once the core loop is stable:

- repeat booking and saved addresses
- ratings and reviews with moderation
- narrower time windows and smarter sloting
- provider performance dashboards
- property profiles for landlords and repeat clients
- provider owner plus technician role separation
- recurring maintenance scheduling
- category-based quote templates
- automated reminders and nudges

## 8. P2 Scope

- automated dispatch and route optimisation
- deeper provider analytics and benchmarking
- SLA engine for business accounts
- inventory and materials tracking
- staff attendance or timesheets
- broader referral and loyalty mechanics
- multi-provider quote comparison

## 9. P3 Scope

- enterprise account hierarchies
- insurance workflows
- franchise or branch management
- procurement or supplier integrations
- dynamic pricing and AI scoping features
- deep CRM automation

## 10. What Must Stay Out of MVP

The MVP should explicitly avoid:

- solving every provider back-office need
- trying to support too many service verticals
- enterprise procurement complexity
- full accounting
- sophisticated dispatch science before enough volume exists
- feature sprawl that weakens the first completed-job loop

## 11. Operating Model Recommendation

The MVP should run as a semi-managed platform:

- platform validates providers
- platform can intervene in assignment and exception handling
- platform keeps payment and trust controls visible
- providers retain service and pricing control within guardrails
- clients see a simple, supported booking experience

This is safer than a fully self-serve model in the early stage because it protects the brand while operational patterns are still being learned.

## 12. Commercial Implications

Recommended early commercial assumptions:

- smaller providers will resist high fixed fees
- early monetisation should align to delivered value
- successful job flow matters more than complex package design

Likely models to test:

- per completed booking fee
- low subscription plus transaction fee
- premium provider plan later for multi-user workflow depth

## 13. MVP Success Metrics

Track from day one:

- request-to-quote rate
- quote-to-book rate
- booking completion rate
- on-time arrival rate
- payment completion rate
- complaint rate per completed job
- provider activation rate
- provider inactivity / churn
- repeat booking rate

## 14. Final Recommendation

Build the MVP around five pillars:

- request capture
- quote and approval
- booking and assignment
- field execution tracking
- payment and follow-up

Every proposed feature should be tested against those five pillars before it enters scope.
