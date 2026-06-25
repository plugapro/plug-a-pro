# Client Follow-Up Queue — 2026-06-17

**Mode:** Paste-ready. Operator copy & send manually.
**Audit:** Log each send in OpenBrain or the existing message_events flow.
**No messages have been sent automatically.**

## Send strategy per recipient

WhatsApp has a 24-hour customer-service window. If the customer's last **inbound** to our number was >24h ago, a freeform message will be rejected as "Re-engagement". You MUST use an approved Meta template in that case. Approved MARKETING templates that already work outside 24h: `quick_match_provider_lead_offer`, `slot_available`. Inside 24h: any freeform text or interactive message is allowed.

If you don't have a matching approved template for the message below, send via a **personal WhatsApp** number rather than from the Plug A Pro number — this preserves the relationship and avoids the policy issue.

---

## Priority 1 — JR-B (Ishmael, +27686819941) — match made, not yet told

**Why:** Vigilance Chauke (+27787089063) accepted the lead today 07:46. The auto-notify failed with "Re-engagement message". Ishmael has no idea he was matched.

**Status of window:** Customer's last inbound was 2026-06-15 ~12:39 → **>24h ago, OUTSIDE window**. Cannot send freeform. Two options:
1. Use approved MARKETING template `slot_available` (it accepts a URL button — point to a "view your match" PWA URL).
2. Or have ops send from a personal WhatsApp number.

**Draft (for the personal-WA path):**
> Hi Ishmael, this is {ops_name} from Plug A Pro. Apologies for the delay on your handyman request in Honeydew — a provider has accepted: **Vigilance Chauke** (+27 78 708 9063). You can reach him directly on the number above, or reply YES and I'll connect you on a chat. Thank you for your patience.

**After sending:** Also notify Vigilance:
> Hi Vigilance, this is {ops_name} from Plug A Pro. Thanks for accepting Ishmael's handyman job in Honeydew. His number is +27 68 681 9941. Please reach out to him today to plan a visit. Let me know if anything blocks you.

**Ops follow-up:**
- Close DISPATCH case `cmqf77wlp002ol404tu0bb4vy` once Ishmael confirms contact.
- Update match `cmqhrozc7001djp04wau0lvct`: set `customerContactedAt = now()` when confirmed (via admin UI if available, else direct SQL with audit row).

---

## Priority 2 — JR-C (Andries, +27680805333) — garden expired, retry

**Why:** Andries's garden request expired today 07:01. Only Donald Bhunu was eligible and didn't accept. Last interactive sent today 07:01 was SENT successfully.

**Status of window:** Customer's last inbound was 2026-06-15 16:31 → **>24h ago, OUTSIDE window** (last comms today 07:01 were outbound). Same constraint as P1.

**Draft (personal-WA path):**
> Hi Andries, this is {ops_name} from Plug A Pro. Apologies — your garden tidy request in Honeydew didn't get a response in time. We do have providers who could help (handyman category, with garden experience) if you're still keen. Reply YES and I'll set you up today.

**If Andries replies YES:**
1. WhatsApp Donald Bhunu (+27 84 877 4952) again — he was the only garden-approved candidate.
2. If Donald can't, frame to Tshenolo Mogatosi (+27 81 064 2452) as a "handyman / outdoor tidy" job.

---

## Priority 3 — JR-A (+27726588278) — Honeydew Appliances, 15 days dark

**Why:** Original failed under KYC-block bug. Possibly a test (customer typed "Test user" as name + "are you stuck?" mid-flow). Treat as cold re-engage; do NOT spend ops effort if there's no reply.

**Status of window:** Last inbound 2026-06-02 → **definitely OUTSIDE window**. Use approved template ONLY.

**Draft (if `slot_available` MARKETING template is registered for this use):**
> Hi, this is Plug A Pro. Earlier this month you asked us to help with an appliances job in Honeydew. We're back online with more providers and our apologies for the delay. Tap below to restart your request.
> [PWA link button]

**If no reply within 48h:** mark as cold, no further outreach.

---

## Priority 4 — WL-7 (+27746255114) — painting Joburg, today 02:00

**Why:** Latest waitlist client. 0 outbound ever beyond initial "we don't serve your area" plain text. Still inside 24h window (joined ~17h ago).

**Status of window:** Last inbound 2026-06-17 02:01 → **INSIDE 24h** (until ~02:00 tomorrow). Freeform OK.

**Draft (send via Plug A Pro number, freeform):**
> Hi! Plug A Pro here. Thanks for getting in touch about a painting job. The suburb you picked is outside our current pilot area, but we may have providers nearby — can you confirm your suburb and what kind of painting work (interior / exterior / size)? We'll do our best.

**If no reply within 12h or if it's outside pilot:** send a closing "we'll add you to expansion list" reply within the window.

---

## Priority 5 — WL-4 (+27785982935) — carpentry Katlehong, 2026-06-15

**Why:** No outbound at all. East Rand (not pilot). Should at least be acknowledged.

**Status of window:** Last inbound 2026-06-15 06:11 → **OUTSIDE window**.

**Draft (template path, personal WA acceptable):**
> Hi, Plug A Pro here. You signed up looking for carpentry work in Katlehong. We're not yet active in East Rand, but we're tracking demand. We'll message you the day we go live there. Sorry for the silence.

---

## Priority 6 — WL-2 (+27655405077) — painting Outside Gauteng, 2026-06-12

**Why:** Zero outbound. 5 days dark.

**Status of window:** OUTSIDE. Template / personal WA.

**Draft:**
> Hi, Plug A Pro here. Thanks for getting in touch about a painting job. We're only operating in Johannesburg right now, so we couldn't book a provider for you. We've kept your number — when we expand to your area we'll let you know. Apologies for the wait.

---

## Priority 7 — WL-1 (+27734320218) — handyman "Gauteng - Other", 2026-06-11

**Why:** 6 days dark, 1 outbound (2026-06-11), nothing since.

**Status of window:** OUTSIDE.

**Draft:**
> Hi, Plug A Pro here. Earlier this month you asked us for help with a handyman job. We're only active in Johannesburg-West for now — can you tell us your suburb? If you're nearby we can probably still help.

---

## Priority 8 — STK-4 (+27788695657) — was one tap from submitting today

**Why:** Stuck on `addr_confirm` step at 05:35 today. Already gave us a category and address. One tap away from a real JobRequest. Within 24h window.

**Status of window:** Last inbound was during the stuck conversation today → **probably INSIDE 24h**.

**Draft (freeform):**
> Hi, Plug A Pro here. We noticed you were busy submitting a service request earlier and got disconnected. Want me to finish it for you? Reply with: 1) Your name, 2) The service you needed.

**If no reply within 4h:** drop.

---

## Other STK-* phones (STK-1, STK-2, STK-3 today; STK-5..STK-12 cold)

- STK-1/2/3 (today, browsing): light-touch one-line nudge within 24h, then drop.
- STK-5..STK-12 (>48h cold): do not bother — too far gone, low ROI.

---

## Suggested ops sequencing

| Time slot today | Action |
|---|---|
| Now | Reach Ishmael (P1) and Vigilance — fix the match-not-told gap. |
| +1h | Reach Andries (P2). Decide whether to push Donald or Tshenolo. |
| +2h | Send WL-7 (still in window) + STK-4 (still in window). |
| Today end | Send WL-1, WL-2, WL-4 templates. |
| Tomorrow | Decide on JR-A cold re-engage. Only if `slot_available` template is verified live. |
| This week | Action P-1 (name capture fix), P-2 (category case-normalisation), schedule the post-match template approval. |

---

**Reminder:** Nothing in this file has been sent. Audit each send manually after.
