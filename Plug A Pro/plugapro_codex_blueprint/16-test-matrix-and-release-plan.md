# 16 — Test Matrix and Release Plan

## Task to execute

Create the final test matrix, rollout plan, and release checklist for the three-journey implementation.

## Why this is needed

This change touches provider onboarding, client request capture, matching, credits, WhatsApp, PWA, admin, security, and data migrations. It must be released in controlled phases.

## Test matrix

### Provider onboarding

```text
provider can submit application
application enters pending_review
admin can approve provider
admin can reject provider
admin can request more info
approved provider receives starter credits
pending provider cannot receive leads
suspended provider cannot receive leads
category-specific approval works
```

### Client request

```text
client can create request
client can upload photos
request stores full address privately
safe preview excludes exact address
request submits successfully
matching starts after submission
client can view shortlist
client can select provider
```

### Matching

```text
wrong-category provider excluded
out-of-area provider excluded
pending provider excluded
suspended provider excluded
approved provider included
trusted provider ranks higher
availability affects score
call-out fee affects score
threshold filters weak matches
admin can view match explanation
```

### Provider response

```text
provider receives safe preview
provider can respond interested
provider can set call-out fee
provider can set estimated arrival
provider can decline
expired invite cannot respond
```

### Shortlist

```text
shortlist shows only interested providers
shortlist hides provider private data
client can view provider profile
client can select provider
selected provider receives confirmation request
```

### Credit and acceptance

```text
provider acceptance deducts 1 credit
credit deduction and job assignment are atomic
insufficient credits blocks acceptance
decline does not deduct credits
expired invite does not deduct credits
duplicate accept does not double-deduct
ledger records balance before and after
provider receives confirmation with balance
customer receives provider accepted message
```

### Privacy

```text
provider cannot see customer phone before acceptance
provider cannot see exact address before acceptance
provider can see suburb/city before acceptance
accepted provider can see full details
unauthorized provider cannot access another job
expired token cannot access full details
```

## Rollout plan

### Phase 1

State machines, schema, and migrations.

### Phase 2

Provider onboarding and admin approval.

### Phase 3

Client request capture and privacy split.

### Phase 4

Matching engine v1.

### Phase 5

Provider preview and interest response.

### Phase 6

Customer shortlist and selection.

### Phase 7

Provider final acceptance and credit deduction.

### Phase 8

WhatsApp, security, expiry, logs, and support hardening.

## Release checklist

```text
migrations tested
seed data updated
production env URLs verified
WhatsApp templates tested
credit ledger tested
image rendering tested
privacy tests passed
provider login tested
customer request tested
matching tested
shortlist tested
acceptance tested
OpenBrain logs complete
rollback plan documented
```

## Acceptance criteria

- All journeys pass end-to-end tests.
- Manual pilot scenario works with Fannie/Sarah test providers.
- No localhost URLs in production messages.
- No customer private details exposed before acceptance.
- Credits deducted only on selected provider final acceptance.
- Admin can trace and support every step.
