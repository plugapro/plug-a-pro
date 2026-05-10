# Customer matching-mode selection gate (WhatsApp + PWA)

Status: implemented
Date: 2026-05-09

Decision:
New customer requests must remain in an explicit matching-mode selection state after submission. Quick Match must not auto-start until the customer selects it.

Implementation notes:
- Deferred request creation now defaults to `assignmentMode=OPS_REVIEW` and `status=PENDING_VALIDATION` when matching-mode selection is pending.
- The matching orchestrator now hard-skips non-Quick-Match requests (`assignmentMode !== AUTO_ASSIGN`) even if they are `OPEN`.
- The match-leads cron dispatcher now fetches only `OPEN + AUTO_ASSIGN` requests.
- WhatsApp-submitted requests now create in deferred mode with `assignmentMode=OPS_REVIEW` and immediately show explicit action buttons:
  - `Quick Match`
  - `Review Providers`
  - `Track request`
- A request can still open the ticket URL where available, but matching-mode actions are always present in WhatsApp.
- WhatsApp `status_mode_*`, `status_refresh_*`, and `status_req_*` button IDs are stateless and route into the status flow even when the prior conversation is idle or stale.
- Status flow parses matching-mode button IDs before pinned request refresh, so a stored `jobRequestId` from submission cannot swallow the customer's mode selection.
- The PWA and WhatsApp status views treat Review Providers First as active only after a review ranking decision exists. Neutral deferred requests still show the initial choice screen.
- Review First `NO_MATCH` ranking decisions are reused and shown as a no-provider recovery state instead of repeatedly reranking or showing a provider-options CTA.

Safety outcomes:
- Eliminates accidental Quick Match auto-start after submission.
- Preserves idempotent explicit mode selection via existing `status_mode_quick_*` / `status_mode_review_*` handlers.
- Keeps privacy gating intact: no customer full contact/address unlock before final selected-provider acceptance.
