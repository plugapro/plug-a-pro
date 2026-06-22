# 07 — Client Request As-Is and Gap

## Task to execute

Perform a focused as-is and gap analysis of the client service request journey.

## Why this is needed

The new matching model depends on high-quality request data: category, subcategory, problem description, photos, location, urgency, timing, budget, and provider preference.

## Investigate

Search for:

```text
customer request
service request
booking
ticket
quote
request submitted
customer photos
attachments
address
suburb
urgency
preferred time
WhatsApp customer
view ticket
```

## Questions to answer

1. How does a client currently start a request?
2. Which channels exist: WhatsApp, PWA, Instagram, direct link?
3. Which fields are captured?
4. Are category and subcategory structured?
5. Are photos stored permanently and linked correctly?
6. Is address structured or free text?
7. Is suburb/city/province captured separately?
8. Are exact address and contact details protected from providers before acceptance?
9. Is urgency captured?
10. Is preferred time captured?
11. Is budget preference captured?
12. Is provider preference captured?
13. What request statuses exist?
14. How is the request linked to lead/job records?

## Output required

Create:

```text
docs/implementation-assessment/client-request-gap.md
```

Include:

```text
current flow
current captured fields
current address handling
current attachment handling
current status model
privacy handling
gaps against target flow
recommended reuse
required changes
risks
```

## Acceptance criteria

- Current client request flow is documented.
- Missing matching fields are identified.
- Privacy gaps are identified.
- Photo handling gaps are identified.
- Location data gaps are identified.
- OpenBrain note is logged.
