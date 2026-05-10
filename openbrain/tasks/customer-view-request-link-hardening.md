# Customer View Ticket / View Request link hardening

Date: 2026-05-10
Status: implemented

Decision:
Customer request links opened from WhatsApp must render a safe request-status experience for active, expired, cancelled, completed, and missing-data states. Older links must either load safely or show a clear unavailable/expired state, never the generic PWA crash page.

Implementation notes:
- Added `buildCustomerRequestTicketViewModel()` to centralize safe token-route resolution for `/requests/access/[token]`.
- Wrapped destination resolution and shortlist fetch in defensive error handling with structured logs.
- Updated `/requests/access/[token]` to render explicit unavailable states:
  - expired link
  - invalid link
  - lookup failed
- Added runtime fallback status mapping in `client-pwa-state` to prevent crash on unmapped status values.
- Updated WhatsApp CTA label from `View Ticket` to `View request` without changing route/token format, preserving old-link compatibility.

Safety notes:
- No private customer details are exposed through public token views.
- Existing token-gated attachment access model remains intact.
