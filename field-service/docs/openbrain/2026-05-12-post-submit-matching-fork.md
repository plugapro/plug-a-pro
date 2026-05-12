# Post-Submit Matching Fork

Decision: After customer service request submission, Plug A Pro must save the request and ask the customer to choose matching mode before contacting providers. Undecided requests must show Quick Match / Review Providers First options, not the old passive still-searching state.

Lifecycle:
- New customer request is persisted as `PENDING_VALIDATION` with `assignmentMode = OPS_REVIEW`; this maps to `awaiting_matching_mode`.
- No provider lead, assignment hold, or quick-match orchestration should start during submission.
- Quick Match starts only after the customer selects `Quick Match`; then the request moves to active quick matching and provider outreach may begin.
- Review Providers First starts only after the customer selects `Review Providers First`; candidates are generated and the customer gets either a `View providers` CTA or a no-provider action state.

Active request recovery:
- `PENDING_VALIDATION` requests always ask the customer to choose matching mode.
- Legacy `OPEN` + `AUTO_ASSIGN` requests with no leads and no dispatch decision are treated as undecided and prompt the matching-mode fork.
- Legacy requests with dispatch decisions or provider outreach are treated as already-started Quick Match so customers are not stranded.

The old "still searching" copy must not be used for undecided requests.
