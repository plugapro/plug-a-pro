# 15 — Security and Privacy Audit

## Task to execute

Audit and harden privacy, authorization, secure tokens, and protected data exposure across all three journeys.

## Why this is needed

The shortlist model depends on careful privacy separation. Providers may preview job information, but exact customer contact and address details must remain hidden until provider acceptance.

## Server-side privacy rules

Before provider final acceptance, provider may see:

```text
category
subcategory
description
photos
suburb
city
province
region
urgency
preferred date/time
budget preference
```

Before final acceptance, provider must not see:

```text
customer mobile
customer email
exact street address
house number
unit number
complex access details
GPS coordinates
access notes
private notes
```

After final acceptance, the accepted provider may see full job details.

## Audit areas

```text
lead preview API
job detail API
customer ticket API
provider profile API
attachment/image API
secure lead token handling
WhatsApp link token handling
Worker Portal authorization
Admin role checks
storage bucket policies
signed URL generation
```

## Implementation requirements

1. Enforce privacy at API/query level.
2. Do not rely only on frontend hiding.
3. Protect image URLs with authorization.
4. Ensure secure tokens only grant access to allowed records.
5. Ensure accepted provider can access full details.
6. Ensure non-selected providers cannot access full details.
7. Ensure expired/superseded invites cannot unlock details.
8. Use trace IDs for access denials.
9. Do not log sensitive customer data unnecessarily.

## Acceptance criteria

- Provider preview cannot access customer phone.
- Provider preview cannot access exact address.
- Accepted provider can access full details.
- Non-selected provider cannot access full details.
- Expired/superseded invite cannot access full details.
- Image attachments respect same access rules.
- Tests pass.

## Test cases

```text
safe preview excludes phone
safe preview excludes address
safe preview includes suburb/city
accepted provider gets full details
non-selected provider blocked
expired token blocked
image URL denied for unauthorized provider
admin can access with admin role
customer can access own ticket
```
