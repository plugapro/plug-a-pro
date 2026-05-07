# 10 — Provider Full Job Details and Privacy Unlock Flow

## Task

Implement or align full customer detail unlock after selected provider accepts and 1 credit is deducted.

## Before acceptance, provider must not receive

```text
customer phone
customer email
exact street address
house number
unit number
complex access details
GPS coordinates
private access notes
```

## After acceptance, accepted provider receives

```text
customer full name
customer mobile number
full service address
unit/complex details
access notes
job description
photos
preferred time
job reference
```

## WhatsApp accepted message

```text
Job accepted.

1 credit used.
Available balance: {{available_credits}}

Customer details:
Name: {{customer_name}}
Phone: {{customer_phone}}
Address: {{full_address}}

Next step:
Reply with your arrival time.
Example: 14:00
```

## Implementation requirements

1. Enforce unlock server-side.
2. Send full details via WhatsApp after acceptance.
3. Ensure only accepted provider receives details.
4. Ensure PWA full job detail also respects same rule.
5. Ensure logs do not expose sensitive details unnecessarily.
6. Add tests.

## Acceptance criteria

- Full details are not available before acceptance.
- Full details are sent in WhatsApp after acceptance.
- Only accepted provider can access full details.
- Tests pass.
