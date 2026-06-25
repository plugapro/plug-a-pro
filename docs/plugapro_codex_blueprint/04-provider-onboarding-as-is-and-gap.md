# 04 — Provider Onboarding As-Is and Gap

## Task to execute

Perform a focused as-is and gap analysis of the current service provider onboarding journey.

## Why this is needed

Provider registration must not equal approval. We need to know whether current onboarding captures enough information to support trust-aware matching.

## Investigate

Search for:

```text
provider onboarding
Join Plug A Pro
Find Work
Register
provider application
application submitted
application approved
provider approved
service provider
worker
skills
work areas
availability
call-out fee
references
documents
profile photo
credits awarded
```

## Questions to answer

1. Where does provider onboarding start?
2. Is it WhatsApp-only, PWA-only, or both?
3. What fields are captured today?
4. Which fields are mandatory?
5. Where are uploaded documents/photos stored?
6. Does the current approval process include admin review?
7. Does the approval process award credits?
8. Does the approval process create login access?
9. Are service categories approved separately?
10. Are provider work areas structured or free text?
11. Are rates captured?
12. Are references captured?
13. Are certificates/documents captured?
14. Is there a provider profile visible to customers?

## Output required

Create:

```text
docs/implementation-assessment/provider-onboarding-gap.md
```

Include:

```text
current flow
current captured fields
current data storage
current statuses
current admin review process
current WhatsApp templates
gaps against target onboarding
recommended reuse
required changes
risks
```

## Acceptance criteria

- Current provider onboarding is documented.
- Missing trust/suitability fields are identified.
- Approval gaps are identified.
- WhatsApp template gaps are identified.
- Admin review gaps are identified.
- OpenBrain note is logged.
