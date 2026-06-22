# 05 — Client PWA Photo, Address, and Privacy Flow

## Task

Implement or align photo upload, address capture, and privacy separation in the Client PWA.

## Why

Photos and address are key handoff reasons from WhatsApp to PWA. WhatsApp can receive images, but the PWA is better for reviewing attachments and capturing structured address details.

## Photo upload

Client can:

```text
upload photo
take photo
remove photo
retry failed photo
continue without photo where allowed
```

Stored attachment fields:

```text
attachment_id
request_id
storage_path
mime_type
file_size
status
safe_for_preview
created_at
```

Do not create completed attachment records unless upload succeeds.

## Address capture

Visible to providers before acceptance:

```text
province
region
city
suburb
```

Hidden until provider acceptance:

```text
street_address
house_number
complex_name
unit_number
access_notes
postal_code
latitude
longitude
```

## Privacy copy

Show clearly:

```text
Providers will only see your suburb, city, and province before you select one and they accept the job.

Your exact address and phone number are only shared after acceptance.
```

## WhatsApp handoff cases

1. Customer sent image in WhatsApp → PWA shows it in review.
2. Customer starts in WhatsApp but needs to add more images → PWA photo upload.
3. Customer enters rough suburb in WhatsApp → PWA captures exact address.
4. Customer opens old upload link after submission → state resolver sends them to current status screen if editing is no longer allowed.

## Implementation requirements

1. Reuse existing image storage flow.
2. Ensure images render in review and later ticket screens.
3. Ensure safe preview flags are set.
4. Ensure exact address is never returned in provider safe preview.
5. Use proper-case place names for display.
6. Use normalized location keys for matching.
7. Validate file size and MIME type.
8. Add loading/error/fallback states.
9. Add tests.

## Acceptance criteria

- Client can upload and review photos.
- WhatsApp-uploaded photos appear in PWA review when linked.
- Client can capture structured address.
- Privacy copy is shown.
- Provider preview cannot access exact address.
- Tests pass.
