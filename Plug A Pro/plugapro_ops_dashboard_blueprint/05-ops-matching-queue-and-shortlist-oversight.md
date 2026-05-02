# 05 — Ops Matching Queue and Shortlist Oversight

## Task

Implement or align Ops views for matching queue, provider scoring, lead invites, provider responses, and customer shortlists.

## Required matching visibility

For each request, Ops should see:

```text
eligible providers
excluded providers
reason for exclusion
match score
ranking
invite status
provider response
call-out fee
estimated arrival
negotiable flag
shortlist status
customer selection
provider final acceptance status
```

## Required actions

Ops should be able to:

```text
rerun matching
manually include provider
manually exclude provider with reason
send opportunity invite
expire invite
request more provider responses
publish shortlist
unpublish shortlist if safe
select provider on behalf of customer only with audit
escalate no-match case
```

## Matching model constraints

Ops tooling must support:

```text
match
invite
provider interest/rate response
shortlist
customer selection
provider acceptance
credit deduction
assignment
```

It must not revert to blind auto-assignment.

## Acceptance criteria

- Ops can inspect matching decisions.
- Ops can see why providers were included/excluded.
- Ops can manage no-match/no-response cases.
- Ops can manually intervene with audit.
- Tests pass.
