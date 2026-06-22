# Ops CRUD Capability Matrix

Legend:

- `Adequate` = materially usable in-product today
- `Partial` = some in-product support, operationally incomplete
- `Unsafe / DB only risk` = likely to require engineering or direct data intervention for real exceptions
- `Missing` = no meaningful in-product support

| Domain object | Current CRUD capability | Required CRUD capability | Permission / validation status | Auditability | Gap summary | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| `Category` | Read/Create/Update/Deactivate `Adequate`; delete/retire partial | Full governed lifecycle with dependency checks | Flag-gated, admin page present | Partial | one of the more mature reference-data areas | P2 |
| `LocationNode` | Read/Create/Update/Deactivate/Delete `Adequate` | Full governed lifecycle with impact checks | Flag-gated, validation present | Partial | strong relative maturity, but still partial audit detail | P2 |
| `AdminUser` | Read/Create/Update/Deactivate/Revoke `Adequate` | Adequate plus approval history | Better than most; owner-gated | Partial | should become template for privilege discipline elsewhere | P2 |
| `FeatureFlag` | Read implicit; update via script only `Partial` | Admin-governed flag management with audit | No admin UI | Weak | rollout depends on scripts and hidden state | P2 |
| Platform settings / env-backed config | Read-only `Partial` | Controlled update with validation and audit | No mutation UI | None | ops cannot safely manage runtime config | P1 |
| Reason codes / lookup registries | Missing | CRUD with deprecate-not-delete lifecycle | No in-product model | None | no governed reason-code registry for cases | P1 |
| Communication templates | Missing | Read/Create/Update/Retire with approval and preview | No in-product model | None | messaging ops not serviceable | P1 |
| Fee / pricing rules | Missing | Controlled rule CRUD with effective dating | No in-product model | None | pricing corrections require code or ad hoc work | P1 |
| Booking statuses / dispute categories / cancellation reasons | Missing as governed data | Controlled reference-data lifecycle | Mostly enum/code driven | None | operational taxonomy is not manageable as data | P1 |
| `Customer` master record | Read/Create/Update partial; retire/archive/merge/purge partial | Full correction lifecycle with stronger validation | Flag-gated; validation exists | Partial | address and reason handling inconsistent with schema | P1 |
| `Address` | Read in schema only; admin CRUD missing `Missing with operational impact` | Full CRUD with defaulting and impact checks | No admin address workspace | None | core customer correction gap | P1 |
| Customer contact preferences | Read/Update partial | Full update with justification and history | Some WhatsApp policy paths exist | Better than average | preference logs exist, but broader support context absent | P2 |
| Customer support notes / flags | Notes adequate; flags partial | Notes, flags, restrictions, active-case linkage | Partial | Partial | flags/restrictions not first-class enough | P2 |
| Customer conversation history | Read partial via logs only | Full read workspace with thread linkage | No customer-facing admin conversation view | Weak | support context fragmented | P1 |
| Customer duplicate merge | Merge/purge partial | Safer merge with review diff and reversibility | Partial | Partial | merge exists but broader duplicate review tooling is absent | P2 |
| `Provider` master record | Read/Create/Update partial; suspend/archive partial | Full lifecycle with structured trust reasons | Flag-gated; some validation exists | Partial | status reasons not persisted structurally | P1 |
| Provider certifications | Read/Create/Update/Delete/Verify partial | Adequate with expiry checks and attachments | Present on provider detail | Partial | workable but still thin on audit detail | P2 |
| Provider equipment | Read/Create/Update/Delete partial | Adequate with verification state | Present on provider detail | Partial | better than many areas | P2 |
| Provider availability / service areas | Read partial; update fragmented | Full CRUD with canonical structured area edits | Mixed legacy + structured models | Weak | area correction still partly legacy | P1 |
| Provider duplicate handling | Missing | Review/merge/retire flows | No admin workflow | None | ops cannot safely fix duplicate providers | P1 |
| `JobRequest` | Read adequate; create via customer flows; admin update/cancel partial | Full support correction and revalidation controls | Validation queue provides partial control | Partial | lacks rich correction and recovery tooling | P1 |
| `Quote` | Read adequate; admin claim/release only | Update/void/expire/reissue/close-out controls | Minimal | Weak | high operational gap | P0 |
| `Booking` | Read adequate; mark paid/cancel only | Reschedule/correct/cancel/reassign/note workflow | Minimal | Partial | high operational gap | P0 |
| `Job` | Read adequate; status flow exists | Admin/manual recovery and field exception closure | Better event history than most | Better than average | still lacks full ops closure tooling | P1 |
| `Payment` | Read adequate; refund partial | Reconcile/retry/write-off/adjust/refund workflow | Partial | Partial | finance ops underpowered | P0 |
| `Dispute` | Read adequate; status/resolution note partial | Full intake/review/outcome/evidence workflow | Partial | Partial | no taxonomy, weak evidence handling | P0 |
| `MessageEvent` outbound | Read only `Partial` | retry/resend/manual-send/support-thread tooling | No mutation tooling | Weak | comms recovery not serviceable | P1 |
| Inbound WhatsApp messages | Stored in schema, not operationally surfaced `Partial` | Full support visibility and linkage to cases | No admin workspace | Weak | support must work blind to inbound history | P1 |
| `OpsQueueAssignment` | Create/update via claim/release `Adequate` | Keep plus wrap in case model | Present on queues | Partial | useful ownership primitive, but not enough by itself | P2 |
| `AuditLog` / `AdminAuditEvent` | Create/read `Partial` | Full immutable evidence with diff quality controls | Present centrally | Partial | tables exist; content quality is the issue | P0 |

## Summary judgement

- Static/reference CRUD is **strongest** in `Category`, `LocationNode`, and `AdminUser`.
- Customer/provider master-data CRUD is **partially serviceable**, but misses important operational corrections.
- Transactional CRUD for bookings, quotes, payments, disputes, and messages is **not sufficient for production operations**.
- The biggest pattern is not absence of screens. It is **absence of safe, auditable, exception-ready workflows**.
