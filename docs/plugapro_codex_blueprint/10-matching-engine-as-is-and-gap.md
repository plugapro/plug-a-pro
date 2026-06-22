# 10 — Matching Engine As-Is and Gap

## Task to execute

Perform a focused as-is and gap analysis of current matching, lead generation, lead invite, expiry, and assignment logic.

## Why this is needed

The new model requires explainable matching, provider responses, customer shortlist, and credit deduction only after selected provider acceptance.

## Investigate

Search for:

```text
match
matching
lead invite
lead
provider assignment
assign
round robin
available provider
expires_at
respond by
Accept Lead
Unlock
credit
shortlist
rank
score
```

## Questions to answer

1. How are providers selected today?
2. Is there a matching score?
3. Are lead invites separate from jobs?
4. Can multiple providers receive the same request?
5. Is there a provider response model?
6. How does expiry work?
7. How does reassignment work?
8. When are credits deducted?
9. How does provider acceptance assign the job?
10. Is acceptance atomic with credit deduction?
11. Does the system support customer selection?
12. Are matching decisions auditable?

## Output required

Create:

```text
docs/implementation-assessment/matching-gap.md
```

Include:

```text
current matching algorithm
current lead invite model
current job assignment flow
current credit deduction timing
current expiry handling
current WhatsApp payloads
gaps against Qualified Shortlist Model
reuse recommendations
required changes
risks
```

## Acceptance criteria

- Current matching flow is documented.
- Current lead/assignment model is documented.
- Current credit timing is documented.
- Gaps are clear.
- OpenBrain note is logged.
