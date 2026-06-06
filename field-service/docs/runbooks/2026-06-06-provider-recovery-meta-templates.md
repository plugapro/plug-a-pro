# Provider Recovery Meta Templates (Outside-Session Path)

## Date
2026-06-06

## Feature flag
- `whatsapp.recovery.template_send` (off by default)

## Purpose
Enable sending approved WhatsApp templates to stalled provider onboarding rows that are older than 23h since last interaction.

## Templates

All templates are registered in `TEMPLATES` with:
- `language: en_ZA`
- `category: UTILITY`
- `{{1}}` in the body/`example` placeholder for provider first name (fallback: `there`)

Template keys:
- `provider_recovery_evidence`
- `provider_recovery_started_blocked`
- `provider_recovery_no_name`
- `provider_recovery_welcome_idle`
- `provider_recovery_flow_conflict`

## Copy mapping (message key → template key)
- `evidence_upload` → `provider_recovery_evidence`
- `started_blocked` → `provider_recovery_started_blocked`
- `register_started_no_name` → `provider_recovery_no_name`
- `welcome_idle` → `provider_recovery_welcome_idle`
- `flow_conflict` → `provider_recovery_flow_conflict`
- `submitted_no_recovery` → no template (manual/automated sends are skipped)

## Operator workflow (Admin Applications screen)
- Inside the recovery 23h window:
  - Action button label: **`Send now`**
  - Delivery path: free-text (session-based)
- Outside the 23h window when template flag is enabled:
  - Action button label: **`Send template`**
  - Delivery path: Meta template send
  - Banner: `recovery_sent_template`
- Outside the 23h window when template flag is disabled:
  - No template send
  - Banner: `recovery_skipped_window`

## Failure behavior
- Template send failures with Meta code `[TEMPLATE_NOT_APPROVED]` produce:
  - `recovery_template_not_approved`
  - Message claim is released so the row can be retried

## Audit
- `provider_onboarding_recovery.outcome_logged.after.via`
  - `template` for template sends
  - `session_text` for 23h-window free-text sends
