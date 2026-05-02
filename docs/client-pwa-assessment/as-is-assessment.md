# Client PWA As-Is Assessment

Date: 2026-05-02

## Existing Client Routes

| Route | Purpose | Notes |
|---|---|---|
| `/` | Customer landing/start page | Authenticated customer entry with service links. |
| `/services` | Service category list | Starts PWA booking by category. |
| `/book/[serviceId]` | Authenticated request creation | Renders `BookingFlow`; requires sign-in. |
| `/bookings` | Authenticated customer requests/bookings list | Shows active requests and confirmed bookings. |
| `/requests/[id]` | Authenticated request detail | Shows request, photos, provider/match/quote/job state. |
| `/bookings/[id]` | Authenticated booking/job tracking | Supports cancel, completion confirmation, issue reporting. |
| `/bookings/[id]/rate` | Authenticated review flow | Customer rating after completed booking. |
| `/providers/[id]` | Authenticated provider profile | Customer can view provider profile from booking/request context. |
| `/requests/access/[token]` | Secure ticket link | WhatsApp-friendly request ticket route; now includes shortlist cards and selection. |
| `/requests/handover/[token]` | Customer/provider handover route | Tokenized handover after provider/customer connection. |
| `/approve/[token]` | Quote approval | Tokenized customer quote approval route. |
| `/confirm-completion/[token]` | Job completion confirmation | Tokenized completion route. |

## Existing Components

| Component | Purpose |
|---|---|
| `components/customer/BookingFlow.tsx` | Mobile-first multi-step request form for address, description, photos, urgency, review, submit. |
| `components/customer/SuburbPicker.tsx` | Structured suburb/location selection. |
| `components/shared/AttachmentThumbnail.tsx` | Protected attachment thumbnail rendering with fallback diagnostics. |
| `components/shared/StatusBadge.tsx` | Request, match, booking, job, and quote status rendering. |
| `components/shared/provider-trust-note.tsx` | Provider trust/provenance copy. |
| `components/shared/provider-trust-signals.tsx` | Provider trust signal display. |
| `components/quotes/QuoteHistoryTimeline.tsx` | Customer/provider quote timeline. |

## Existing APIs and Server Actions

| API/action | Purpose |
|---|---|
| `POST /api/customer/bookings` | Authenticated PWA request creation with address, location node, timing, and photos. |
| `GET /api/customer/location-reverse` | Reverse geolocation for PWA address capture. |
| `GET /api/customer/services/[serviceId]` | Service detail data. |
| `GET /api/customer/slots` | Customer slot lookup. |
| `GET /api/attachments/[id]` | Authenticated/token-scoped attachment proxy. |
| `GET/POST /api/quotes/[token]` | Tokenized quote approval handling. |
| `requests/access/[token]` server actions | Select shortlisted provider, ask for more options, cancel request. |

## Existing WhatsApp Handoff Links

| Link source | Destination | Notes |
|---|---|---|
| `getJobRequestAccessUrl` | `/requests/access/[token]` | Main request/ticket handoff used by matching/customer notifications and shortlist-ready messages. |
| `getCustomerProviderHandoverUrl` | `/requests/handover/[token]` | Tokenized post-match handover. |
| Quote notifications | `/quotes/[token]` and `/api/quotes/[token]` | Customer quote approval. |
| Job/completion notifications | `/bookings/[id]`, `/confirm-completion/[token]` | Job tracking and completion. |
| Provider lead links | `/leads/access/[token]` | Provider side, not client PWA, but important for privacy boundary. |

## Existing Token / Access Model

- `customerAccessToken` on `JobRequest` backs `/requests/access/[token]`.
- Tokens expire after 90 days and can be revoked.
- `resolveJobRequestAccessScope` provides attachment access scope for request/job photos.
- `resolveJobRequestAccessToken` loads full customer-owned request details for the ticket route.
- Provider lead tokens are signed HMAC payloads with scope lists and expiry.
- Attachments are served through `/api/attachments/[id]`, which validates session or token scope before proxying storage.

## Existing Request States

Rendered via `StatusBadge`:

- `PENDING_VALIDATION`
- `OPEN`
- `MATCHING`
- `SHORTLIST_READY`
- `PROVIDER_CONFIRMATION_PENDING`
- `MATCHED`
- `EXPIRED`
- `CANCELLED`

## Existing Customer Fields Captured

PWA `BookingFlow` captures:

- service category
- closest category for `other`
- structured suburb/location node
- province, region, city, postal code
- unit number, complex name, street address, address line 2
- title
- description
- urgency/timing window
- up to five photos

WhatsApp captures overlapping data plus provider preference and budget preference from the earlier qualified shortlist work.

## Existing Privacy Rules

- Provider preview services select only safe fields.
- Provider opportunity preview now truncates description through `previewNotes`.
- Full customer details require accepted lead plus provider-owned unlock.
- Customer ticket route can show the customer's own full address and photos.
- Attachment API enforces admin, customer, provider, request token, or lead token scope before serving files.
- Production public URL helper blocks localhost.

## Existing Gaps

- PWA request form does not yet capture provider preference, budget preference, or explicit subcategory to match the WhatsApp request model.
- PWA submission success copy still says a provider accepts the job, not that providers respond and the customer compares a shortlist.
- Secure ticket route renders current content, but it is not yet organized around a single explicit state resolver that redirects/branches old links by backend state.
- Shortlist cards exist on `/requests/access/[token]`, but there is not a dedicated provider profile detail view inside the tokenized customer shortlist journey.
- Authenticated `/requests/[id]` does not yet reuse the same shortlist actions/cards as the secure ticket route.
- PWA photo upload does not classify photos as safe-for-preview.
- Strong free-text access-note redaction remains a follow-up beyond preview truncation.

## Reuse Recommendations

- Keep `/requests/access/[token]` as the canonical WhatsApp handoff route.
- Add a state resolver around the existing token route instead of creating a parallel route system.
- Reuse `BookingFlow` for PWA request creation, but align fields and copy with WhatsApp.
- Reuse `createJobRequest` and `/api/customer/bookings` rather than creating a separate PWA request API.
- Reuse `customer-shortlists.ts` for shortlist cards, selection, more options, cancel, and selected-provider decline.
- Reuse `/api/attachments/[id]` for every PWA image surface.

## Implementation Risks

- Old WhatsApp links must not show stale shortlist UI after a request is already matched or cancelled.
- Duplicating authenticated and tokenized request views could cause divergent behavior.
- Adding richer PWA form fields must not bypass WhatsApp-first customer records or request creation logic.
- Photo safe-preview classification needs a schema/product decision before public rollout.
- Provider credit timing must remain in selected-provider acceptance only.

## OpenBrain Note

Client PWA as-is assessment completed. The app already has the core building blocks for a WhatsApp-first PWA handoff: tokenized request access, authenticated request and booking pages, request creation with address/photos, attachment proxying, and shortlist selection. The next work should consolidate state resolution and align PWA request/shortlist/tracking screens with the same backend journey rather than adding duplicate flows.
