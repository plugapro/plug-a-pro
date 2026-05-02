# 07 — Client PWA Shortlist, Provider Profile, and Selection Flow

## Task

Implement or align the Client PWA shortlist and provider selection experience.

## Why

This is the main PWA experience that WhatsApp cannot handle well. Customers need to compare provider options, view profile details, and select the preferred provider.

## Shortlist screen

Show:

```text
We found {{count}} suitable providers
Compare their experience, call-out fee, availability, and profile before choosing.
```

Provider card fields:

```text
provider name
profile photo
service category
years of experience
verification badge
call-out fee
rate / negotiable flag
estimated arrival time
rating if available
completed jobs if available
short bio
```

Actions:

```text
View profile
Select provider
Ask for more options
Cancel request
```

## Provider profile screen

Show:

```text
profile photo
short bio
service categories
years of experience
verification badge
call-out fee
rate / negotiable flag
areas served
previous work photos
rating if available
completed jobs if available
```

Hide:

```text
provider phone
provider private address
ID/passport
private documents
reference contact details
admin notes
```

## Selection flow

When client selects provider:

```text
request.status = provider_confirmation_pending
lead_invite.status = customer_selected
selected_provider_id = provider_id
```

Show:

```text
You selected {{provider_name}}.

We’re asking them to confirm the job now.
You’ll be notified once accepted.
```

## Credit rule

Do not deduct provider credits at client selection stage.

Credits are deducted only when selected provider accepts the job.

## Acceptance criteria

- Client sees shortlist.
- Client can view provider profile.
- Client can select provider.
- Selected provider gets notification/request to accept.
- No credit deducted at selection.
- Full customer details remain locked.
- Tests pass.
