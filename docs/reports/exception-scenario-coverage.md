# Exception Scenario Coverage

| Scenario | Current support | Current workaround | Risk | Required improvement |
| --- | --- | --- | --- | --- |
| Customer wrong contact details | Partial | Edit customer master record | Weak audit of exact changed fields | field-level diff capture and contact-change reason logging |
| Customer wrong structured address | Missing with operational impact | overwrite free-text `Customer.address` or external note | booking/matching state can diverge from canonical address | full admin CRUD for `Address` with linkage to requests/bookings |
| Customer duplicate account | Partial | customer merge flow | limited review workspace and reversibility | duplicate review queue with side-by-side comparison |
| Customer wrong booking time | Weak | cancel and recreate, or manual off-platform coordination | inconsistent customer/provider state | booking reschedule workflow with notifications and audit |
| Customer requests reschedule | Weak | support by phone/WhatsApp, then manual follow-up | state drift and missed service commitments | admin reschedule action with reason, notifications, and timeline |
| Customer requests cancellation | Partial | booking cancel available in some cases | reason capture and downstream trace incomplete | structured cancel reasons and side-effect logging |
| Customer disputes quote amount | Weak | free-text notes, dispute entry, or off-platform handling | no safe quote correction path | quote amend/void/reissue workflow |
| Customer disputes completion | Partial | dispute record update | evidence/timeline weak | formal dispute workflow with attachments, outcomes, and reopen |
| Customer says provider never arrived | Partial | field exception queue + off-platform coordination | no structured close-out | field exception case model with outcome codes |
| Customer says wrong provider arrived | Weak | manual review | trust and liability risk | provider assignment reconciliation and incident case flow |
| Customer says extra work was unapproved | Partial | dispute intake | approval/evidence linking not strong enough | attach extra-work evidence and decision chain to dispute case |
| Customer needs refund or payment correction | Partial | refund button for paid records | no reconciliation / write-off / mismatch tooling | finance case workflow and payment adjustment controls |
| Provider profile correction | Partial | provider profile edit | audit details weak | stronger before/after and reason logging |
| Provider unavailable after match | Weak | dispatch override or manual coordination | booking/match may stall | reassignment/escalation workflow with timeline |
| Provider assigned wrong job | Weak | dispatch override or cancellation | no structured corrective case | provider/job correction flow with customer/provider notifications |
| Provider declines after acceptance | Partial | dispatch queue intervention | outcome chain incomplete | reassignment and closure reasons linked to case history |
| Provider disputes customer complaint | Partial | dispute status update | poor evidence richness | bilateral dispute workflow with evidence and adjudication template |
| Provider requests rate/category correction | Weak | profile edits or engineering changes | pricing/category drift risk | governed provider/category/rate maintenance workflow |
| Provider duplicate profile | Missing | likely DB intervention | trust and payout risk | provider duplicate review/merge tooling |
| Provider suspension / reactivation | Partial | provider status actions | reason persistence weak | structured enforcement model and trust notes |
| Provider identity detail correction | Partial | profile edit or KYC update | insufficient traceability | controlled identity-correction workflow with trust review |
| Booking created with bad data | Weak | cancel/recreate or DB fix | customer/provider confusion | safe booking edit/reschedule/correct workflow |
| Quote created incorrectly | Weak | off-platform customer/provider coordination | commercial disputes | admin quote correction and replacement flow |
| Wrong pricing rules in static data | Missing | code or env change | silent systemic pricing damage | governed fee/pricing rule admin with audit |
| Wrong service category mapping | Partial | categories admin + manual corrections | matching errors persist across requests | category governance plus request recategorization tools |
| Stale or invalid status | Weak | manual admin interpretation | support misreads state truth | reconciliation jobs and operator recovery actions |
| Orphaned records | Weak | engineering intervention | data integrity and support failures | exception reports and recovery tooling |
| Duplicate records from webhook replay or retries | Partial | some idempotency guards | still uneven across workflows | consistent idempotency keys and replay-safe audit/eventing |
| Payment mismatch | Weak | refund plus external finance work | cash leakage or dispute escalation | reconciliation queue and ledger-like event history |
| Communication failure | Weak | read-only message log | no retry/resend path | retry, resend, and support-thread workspace |
| Bad audit trail after manual override | Weak | engineer forensics | accountability gap | mandatory reason, field diff, and side-effect capture |
| Need to update data after support call or WhatsApp exchange | Partial | edit record + add note | context remains fragmented | linked notes/case timeline/conversation history |

## Overall assessment

- **Happy-path exceptions:** partially supportable
- **Real-world messy exceptions:** not yet safely supportable
- **Recovery posture:** too dependent on human memory, free text, and off-platform coordination

Most scenarios have at least one surface where ops can see the problem. Far fewer have a safe, auditable, reversible in-product way to resolve it.
