# Review Providers First Matching Consistency

Decision: Review Providers First must generate and persist provider candidates before telling the customer that provider review is ready. Read paths must not start matching.

Root cause fixed:
- Customer/PWA provider reads could previously trigger review-first matching as a side effect.
- WhatsApp status refresh counted raw ranked match rows, while the PWA rendered only displayable providers after active/status/category/area/profile filters.
- This allowed contradictory customer messages, such as ready/failure messages in close sequence, or a WhatsApp count that did not match the provider cards shown in the PWA.

Lifecycle for MVP1 customer matching cluster:
- `PENDING_VALIDATION` + no review decision: matching mode still pending or review matching is not ready.
- Customer selects Review Providers First: `selectCustomerRequestMatchingMode` explicitly runs review-first matching.
- `OPS_REVIEW` decision `RANKED` with displayable candidates: send one `View providers` CTA and render provider cards from the persisted decision.
- `OPS_REVIEW` decision `NO_MATCH` or no displayable candidates: send a no-provider state with Quick Match/status/menu actions.
- Customer shortlist/selection is persisted separately and must stop before provider notification/credit/accepted-lock workflows in this MVP1 cluster.

Operational rule:
WhatsApp and PWA must use the same displayable-candidate eligibility rules. A provider should not be counted in customer-facing messaging unless the PWA can render that provider safely.
