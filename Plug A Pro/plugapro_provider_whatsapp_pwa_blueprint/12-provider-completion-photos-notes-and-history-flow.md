# 12 — Provider Completion, Photos, Notes, and History Flow

## Task

Implement or align provider job completion flow in WhatsApp and optional PWA history.

## Completion flow

```text
Provider replies complete
↓
Bot asks completion note
↓
Provider sends note
↓
Bot asks for completion photo if available
↓
Provider uploads photo or skips
↓
Job marked completed
↓
Customer notified
↓
Job appears in provider history
```

## Completion data

```text
work_completed_summary
completion_photos
materials_used optional
amount_charged optional
issue_notes optional
completed_at
```

## WhatsApp copy

```text
Please send a short completion note.
```

```text
Please upload a completion photo, or reply SKIP.
```

```text
Job completed.

The customer has been notified.
```

## Implementation requirements

1. Support completion via WhatsApp.
2. Support photo upload where possible.
3. Store completion notes/photos.
4. Mark job completed.
5. Notify customer.
6. Show completed job in PWA history if available.
7. Add tests.

## Acceptance criteria

- Provider can complete job in WhatsApp.
- Completion note stored.
- Completion photo stored if provided.
- Customer notified.
- Tests pass.
