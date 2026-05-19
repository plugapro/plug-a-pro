# Uploads And Attachment Proxy Incident Runbook

## Detect

- Upload validation errors spike.
- Attachment proxy returns elevated 403, 413, or 502 responses.
- Blob metadata/read failures increase.

## Triage

1. Confirm file type, extension, and size distribution.
2. Check Blob service health.
3. Verify proxy host allowlist and signed URL behavior.
4. Confirm affected attachment IDs are authorized for the user/session/token.

## Mitigate

- Do not bypass the attachment proxy.
- Do not make Blob URLs public in UI or WhatsApp copy.
- For false positives, add a targeted file-signature rule with tests.

## Close

Record attachment IDs, validation failure type, proxy status codes, user impact, and test evidence in OpenBrain.
