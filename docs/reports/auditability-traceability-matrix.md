# Auditability and Traceability Matrix

Ratings:

- `Yes` = materially present
- `Partial` = present but insufficient for reliable reconstruction
- `No` = not materially present
- `Adequacy` = overall judgement for support/compliance/dispute reconstruction

| Admin / ops action | Actor capture | Timestamp capture | Before / after capture | Reason capture | Entity linkage | Downstream event logging | Adequacy | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer create | Yes | Yes | Partial | No | Yes | No | Weak | `crudAction()` logs, but many create actions return only `{ id }` |
| Customer update | Yes | Yes | Partial | No | Yes | No | Weak | `field-service/app/(admin)/admin/customers/actions.ts:130-167` |
| Customer block | Yes | Yes | Partial | Partial | Yes | No | Weak | reason is written to `notes`, not structured block metadata |
| Customer suspend | Yes | Yes | Partial | Yes | Yes | No | Partial | reason persisted to `suspendedReason`; diff capture still weak |
| Customer archive | Yes | Yes | Partial | Yes | Yes | No | Partial | depends on action payload quality |
| Customer merge | Yes | Yes | Partial | Yes | Yes | Partial | Partial | `CustomerMergeEvent` helps, but linked side effects still limited |
| Customer purge | Yes | Yes | Partial | Partial | Yes | No | Weak | destructive action needs stronger evidence chain |
| Provider profile update | Yes | Yes | Partial | No | Yes | No | Weak | `provider.update_profile` returns only `{ id }` |
| Provider status change | Yes | Yes | Partial | Partial | Yes | No | Weak | form requires reason, but action does not persist it structurally |
| Provider KYC update | Yes | Yes | Partial | No | Yes | No | Weak | adequate actor/timestamp, weak narrative trace |
| Provider note add | Yes | Yes | Partial | Partial | Yes | No | Partial | note body helps, but action audit still thin |
| Provider strike add | Yes | Yes | Partial | Yes | Yes | No | Partial | note row includes reason code / strike delta |
| Location create/update/delete | Yes | Yes | Partial | No | Yes | No | Partial | better than most, but still wrapper-limited |
| Category config changes | Yes | Yes | Partial | No | Yes | No | Partial | DB-backed but no rich reason/outcome chain |
| Validation claim/release | Yes | Yes | Partial | No | Yes | No | Partial | ownership change is visible, but activity query has entity mismatch risk |
| Validation promote/cancel | Yes | Yes | Partial | Partial | Yes | Partial | Partial | dispatch attempt happens after promote, but not as linked audit side effect |
| Dispatch claim/release | Yes | Yes | Partial | No | Yes | No | Partial | useful but incomplete |
| Dispatch rerank / auto-assign / override | Yes | Yes | Partial | Partial | Yes | Partial | Partial | business effect is high; audit detail should be stronger |
| Quote queue claim/release | Yes | Yes | Partial | No | Yes | No | Weak | no meaningful resolution record |
| Booking cancel | Yes | Yes | Partial | Partial | Yes | Partial | Partial | cancellation recorded, but diff quality limited |
| Booking mark paid | Yes | Yes | Partial | No | Yes | Partial | Weak | payment side effect lacks strong event linkage |
| Payment refund | Yes | Yes | Partial | Partial | Yes | Partial | Partial | no full reconciliation/audit narrative |
| Dispute update | Yes | Yes | Partial | Partial | Yes | No | Partial | free-text resolution exists; structured outcome metadata is weak |
| Messages page viewing | No | No | No | No | No | No | None | privileged reads are not themselves audited |
| Customer CSV export | Partial | Partial | No | No | Partial | No | Weak | route is gated but no explicit export audit event observed |
| Provider CSV export | Partial | Partial | No | No | Partial | No | Weak | same issue as customer export |
| Payment webhook success/failure handling | System | Yes | Partial | Partial | Yes | Partial | Partial | operationally important, but recovery chain is incomplete |
| Job status transition | Yes | Yes | Yes | Partial | Yes | No | Better | `JobStatusEvent` is one of the strongest event models in the repo |

## Cross-cutting assessment

### Strongest traceability area

- job lifecycle transitions via `JobStatusEvent`

### Weakest traceability areas

- customer/provider admin CRUD through `crudAction()` with thin payloads
- queue claim/release actions without case context
- exports and privileged reads
- payment/message failure recovery

## Required standard vs current state

The required standard from this sweep was:

- who acted
- when
- what entity changed
- old value
- new value
- reason / justification
- related context
- downstream side effects

Current state is:

- **actor and timestamp:** usually present
- **entity linkage:** usually present
- **before / after:** inconsistently useful
- **reason:** inconsistent
- **side effects:** rarely linked

Bottom line: **formal audit tables exist, but traceability adequacy is only partial and is below production operations standard**.
