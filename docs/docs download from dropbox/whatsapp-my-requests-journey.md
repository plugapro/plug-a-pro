# WhatsApp My Requests journey

OpenBrain-compatible implementation note, 2026-05-05.

## Decision

WhatsApp `My Requests` must show a returning customer their recent logged service requests and allow them to track or manage a selected request. It must not use a single-request generic refresh error when the user is trying to access a request list.

## Root cause fixed

The previous WhatsApp status flow treated `My Requests` as `Track latest active request`. If rendering that hidden request failed, the user received the generic recovery copy: `We couldn't load the latest status right now. Your request is still saved. Please try again.` Refreshing repeated the same route without a specific request-list recovery path.

## Journey split

`My Requests`

- Resolve the returning customer from the normalized WhatsApp phone.
- Fetch recent requests for that customer.
- Sort active requests first, newest first.
- Show a WhatsApp-friendly list of recent requests.
- Include `Start new request` and `Main menu` recovery actions.

`Track Request`

- Requires a specific request id from a list row, pinned conversation state, or refresh button payload.
- Shows the latest status for that request only.
- Refresh buttons must carry the specific request id.

`Error handling`

- No requests: show `You don't have any job requests yet` with `Request a Service`.
- List load failure: show `We couldn't load your requests right now. Please try again.`
- Unknown or stale request: show `My Requests`, `New Request`, or `Main Menu` actions.
- Do not expose raw database ids, raw enum values, raw URLs, phone numbers, or stack traces.

## Status labels

Customer-facing status copy must use short labels such as:

- Checking your request
- Finding a provider
- Matching you with a provider
- Provider options are ready
- Waiting for your selected provider to confirm
- Provider matched
- Request expired
- Cancelled

Raw enum values such as `PROVIDER_CONFIRMATION_PENDING` must not be shown to customers.
