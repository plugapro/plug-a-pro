# Task Handoff For Claude: Meta WhatsApp Template Verification

Date: 2026-04-08
Project: Plug-A-Pro
Owner: Claude
Status: External operational verification, not code implementation

## Objective

Verify the remaining non-code Phase 1 item from the marketplace spec:

- WhatsApp notification templates approved in Meta

This is an operational verification task. Do not change product code unless you find a documentation mismatch that must be corrected to reflect the real Meta state.

## Context

The engineering implementation is now largely aligned to the Phase 1 marketplace model. The remaining checklist item that cannot be proven from repository code is the actual approval state of the WhatsApp templates inside Meta Business Manager / WhatsApp Manager.

Relevant files:

- [docs/architecture/marketplace-model.md](../architecture/marketplace-model.md)
- [docs/spec-trace-marketplace-model-2026-04-08.md](../spec-trace-marketplace-model-2026-04-08.md)
- [field-service/scripts/register-whatsapp-templates.mjs](../../field-service/scripts/register-whatsapp-templates.mjs)
- [field-service/README.md](../../field-service/README.md)
- [field-service/lib/messaging-templates.ts](../../field-service/lib/messaging-templates.ts)

## Required Outcome

Produce a verification result that answers all of these:

1. Which templates are currently approved in Meta?
2. Which templates are pending, rejected, paused, disabled, or missing?
3. Do the approved templates cover the currently implemented runtime flows?
4. Is any production flow blocked because a required template is not approved?
5. What exact operator action is needed next?

## Execution Instructions

1. Inspect the repository template inventory.
   - Use the registration script and runtime messaging files to compile the full expected template list.
   - Separate:
     - templates actively used by production flows
     - templates present for future flows only

2. Verify the live state in Meta.
   - Check WhatsApp Manager / Meta Business Manager for the WABA used by Plug-A-Pro.
   - Record each template name and current state.
   - If direct dashboard access is unavailable, use the Graph API if valid credentials are available.

3. Cross-check runtime dependency.
   - Confirm whether every customer/provider/admin WhatsApp notification path relies only on approved templates.
   - Identify any flow that would fail, silently degrade, or require fallback messaging because approval is missing.

4. Produce an operational decision.
   - Mark the item as:
     - verified complete
     - conditionally complete
     - incomplete / launch-blocked
   - Base that only on real Meta evidence, not repository comments.

5. Update documentation if needed.
   - If the repo claims templates are approved and Meta evidence contradicts that, update the documentation.
   - Do not change product logic unless the documentation fix requires a code comment update.

## Deliverables

Create or update a concise verification note under `docs/` that includes:

- verification date
- WABA or environment checked
- template-by-template status
- impacted runtime flows
- operational recommendation
- final verdict

If there is a blocker, include a short remediation plan with:

- exact template names
- exact state
- who needs to act
- expected lead time

## Constraints

- This is not a feature build task.
- Do not implement mediated messaging relay in this task.
- Do not enable mandatory payment collection in this task.
- Prefer evidence from Meta over repository comments or assumptions.

## Suggested Final Output Format

1. Verified templates
2. Missing / non-approved templates
3. Runtime impact
4. Launch recommendation
5. Follow-up actions
