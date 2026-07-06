# Positioning Backlog — 2026-07-06

Priorities: **P0** must fix before scaling paid acquisition · **P1** before provider-acquisition expansion · **P2** during pilot hardening · **P3** later.

---

## P0

### P0-1 — Re-submit 4 reworded WhatsApp template bodies to Meta
- **Task:** Submit new bodies for `technician_assigned`, `technician_on_the_way`, `extra_work_approval`, `customer_match_found` (bodies now in `lib/messaging-templates.ts`; placeholder count/order unchanged). Meta does not allow in-place edits of approved templates without re-review — expect either an edit-review cycle or new template versions.
- **Why:** live customer sends still say "your Plug A Pro technician…" — the strongest employer-impression claim found — regardless of the repo fix.
- **Good output:** Meta shows the new bodies APPROVED; a live send renders the new wording.
- **Acceptance criteria:** all 4 templates approved with new copy; send path verified in staging (no error 132000); old bodies no longer reachable.
- **Risk if not done:** every dispatch message contradicts the terms ("we do not employ Providers") in writing, in the customer's hands — discoverable in any dispute.
- **Implementation notes:** use the WABA management token per `reference_whatsapp_template_mgmt` memory (132000 = param mismatch, not missing template). If Meta forces new template names, prefer the `provider_*` renames from P1-2 in the same pass. Do NOT delete old templates until the new ones are approved and wired.

### P0-2 — South African attorney review of terms/privacy/copy
- **Task:** Brief an attorney with `TERMS_POLICY_REVIEW_NOTES.md` §5 (CPA s29/41/51/61/63, LRA s200A, POPIA operators/biometrics/retention/cross-border, ECTA acceptance formalities).
- **Why:** the liability cap, indemnity, independent-contractor framing and refund matrix are the load-bearing legal structures for a marketplace; none have been professionally reviewed as far as the repo shows.
- **Good output:** attorney-redlined terms/privacy; sign-off on the positioning guide wording.
- **Acceptance criteria:** written attorney opinion; redlines merged; "Last updated" bumped.
- **Risk if not done:** unenforceable caps/indemnities; POPIA exposure on biometric KYC data; deemed-employment challenge.
- **Implementation notes:** budget item; not engineering. Everything else in this backlog can proceed in parallel.

## P1

### P1-1 — Regulated/high-risk work advisory at the decision point
- **Task:** Add one line to `/for-customers` protections and the booking flow (customer app): "For regulated or high-risk work (like fixed electrical installations or gas), ask the provider for the relevant certification or insurance documents before work begins."
- **Why:** the advisory currently lives only in terms + chatbot; CPA-friendly disclosure belongs where the customer decides.
- **Good output:** advisory visible pre-approval without killing conversion (muted styling, one sentence).
- **Acceptance criteria:** line present on `/for-customers` and in the quote-approval screen; copy passes claimGuard.
- **Risk if not done:** "the platform never told me" argument in a regulated-work dispute.

### P1-2 — Rename `technician_*` templates to `provider_*` at next re-registration
- **Task:** When templates are next re-registered (P0-1 may force it), rename `technician_assigned` → `provider_confirmed`, `technician_on_the_way` → `provider_on_the_way`, etc.; update `messaging-templates.ts`, senders in `lib/whatsapp.ts`, and `MANAGED_EXISTING_TEMPLATE_NAMES`.
- **Why:** names shape operational interpretation and leak into body copy over time (it already happened twice).
- **Acceptance criteria:** no `technician_*` template names in the send path; old names removed from Meta after cutover.
- **Risk if not done:** future copy edits reintroduce "technician" employer framing.
- **Implementation notes:** keep aliases during migration; internal routes (`/admin/technicians`, `api/technician/*`) are out of scope.

### P1-3 — Chatbot FAQ sync with `/faq`
- **Task:** Generate `chat-context.ts` FAQ block from the `/faq` page source (export CUSTOMER_FAQS/PROVIDER_FAQS and import them) instead of a hand-maintained copy.
- **Why:** the comment "keep in sync" already failed once — the bot lacked every trust/vetting disclaimer until this audit.
- **Acceptance criteria:** single source of truth; positioning-rules block retained; token budget checked.
- **Risk if not done:** the generative surface drifts from reviewed copy again.

### P1-4 — Provider terms acceptance checkpoint (verify/build)
- **Task:** Verify that both provider signup paths (web `/provider/signup`, WhatsApp registration) capture logged acceptance of Terms §28 (version + timestamp); add if missing.
- **Why:** §28 (independence, indemnity, licensing) only helps if provably accepted.
- **Acceptance criteria:** acceptance record exists for every new provider; backfill decision documented for existing 132 approved providers.
- **Risk if not done:** §28 protections may be unenforceable against providers who never saw them.

## P2

### P2-1 — Extend claimGuard enforcement to `field-service/` copy
- **Task:** Run `marketing/lib/marketing/claimGuard.ts` (or a port) over `field-service` user-facing string surfaces (messaging-templates, whatsapp-flows, customer/provider pages) in CI.
- **Why:** every risky claim this audit found was in `field-service/`, exactly where the guardrail doesn't run.
- **Good output:** CI job failing on banned literals ("vetted", "our technician", bare "verified" badge strings, hard SLAs).
- **Acceptance criteria:** CI green on current tree; seeded violation fails.
- **Risk if not done:** drift re-accumulates in operational copy, invisible until the next audit.

### P2-2 — Standardise "reviewed/verified" labels via `provider-trust.ts` helpers
- **Task:** Make all customer-facing trust labels (badges, shortlists, profile headers) render via `lib/provider-trust.ts` helpers so the qualifier ("ID verified", "not a … workmanship certification") travels with the label; remove ad-hoc strings like the one fixed in `status.ts:845`.
- **Why:** the helpers already contain the correct qualified language; ad-hoc labels bypass it.
- **Acceptance criteria:** grep shows no hardcoded "verified"-family labels outside `provider-trust.ts`.
- **Risk if not done:** the next surface (e.g. PWA push, new shortlist UI) ships another bare "verified".

### P2-3 — Align stale bodies in `register-whatsapp-templates.mjs`
- **Task:** Reconcile remaining divergent bodies (`technician_welcome` "Download the app — jobs are waiting!", `booking_rescheduled`, `slot_available`, `job_offer`, `technician_job_reminder`) with `messaging-templates.ts`; or better, make the register script import from `messaging-templates.ts` so one source exists.
- **Why:** the same template name with two bodies caused the 24h-SLA divergence this audit fixed.
- **Acceptance criteria:** single body source per template.

## P3

### P3-1 — LocalBusiness schema refinement
- **Task:** Evaluate replacing/augmenting `LocalBusiness` with `Organization` + `WebSite`, or a `LocalBusiness` subtype that reflects intermediary status, keeping local-SEO benefits (Map Pack alignment with the planned Google Business Profile).
- **Why:** typing is a mild we-perform signal; the added `description` (CC-14) mitigates but doesn't resolve.
- **Acceptance criteria:** decision documented; GSC rich results stable after change.

### P3-2 — Canonical FAQ sourcing for JSON-LD
- **Task:** Ensure `faqLd` consumes the same exported FAQ constants as the page and (per P1-3) the chatbot, so attorney-approved answers propagate everywhere automatically.
- **Why:** FAQ answers are durable public claims (rich results).
- **Acceptance criteria:** one FAQ source, three consumers (page, JSON-LD, chatbot).
