Decision: public customer ticket links must treat `PENDING_VALIDATION` with no dispatch decision as awaiting matching-mode choice, not as Review Providers First in progress.

Context:
- New customer requests intentionally pause matching after submit so the customer can choose Quick Match or Review Providers First.
- The current schema does not have a separate `matchingMode = undecided` field, so deferred requests are represented as `JobRequest.status = PENDING_VALIDATION` and `assignmentMode = OPS_REVIEW`.
- A Review Providers First attempt is only considered started once a `latestDispatchDecisionId` exists for the request.

Rules:
- `PENDING_VALIDATION` + no `latestDispatchDecisionId` means ask the customer to choose matching mode.
- Quick Match may start provider outreach only after the customer chooses Quick Match.
- Review Providers First may show provider candidates only after candidate generation creates a dispatch decision.
- Public WhatsApp ticket links must allow the customer to choose matching mode without requiring normal login.
- Do not show passive "checking/searching providers" copy for undecided requests.
