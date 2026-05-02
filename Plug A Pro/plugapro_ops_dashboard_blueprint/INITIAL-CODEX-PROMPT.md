# Initial Prompt to Run Ops Dashboard + Scheduler Blueprint in Codex

Paste this into Codex from the repository root:

```text
Read and execute the Ops Dashboard + Scheduler blueprint controller file:

plugapro_ops_dashboard_blueprint/00-OPS-DASHBOARD-MASTER-RUNNER.md

Follow it exactly.

Important:
- This is for the internal Ops Dashboard web app and scheduler/cron alignment.
- The Ops Dashboard must support the three redesigned journeys:
  1. Client WhatsApp + PWA journey
  2. Service Provider WhatsApp-first + PWA-optional journey
  3. Matching / shortlist / provider acceptance / credit flow
- Start with 01-ops-as-is-assessment.md.
- Execute the blueprint files in the sequence defined by the master runner.
- After each blueprint file, write the required physical Markdown output file into docs/ops-dashboard-execution/.
- Update docs/ops-dashboard-execution/000-ops-dashboard-execution-index.md after each step.
- Do not create one final implementation summary.
- Each blueprint file must produce its own implementation output file.
- Reuse existing admin, ops, matching, scheduler, provider review, credit, notification, and audit logic wherever practical.
- Do not create duplicate admin dashboards, duplicate scheduler systems, duplicate matching engines, or duplicate credit ledgers.
- Review and update the existing auto-match cron that runs every 5 minutes so it supports the Qualified Shortlist Model and does not blindly assign providers.
- Review and update the existing provider auto-approval cron that runs every 30 minutes so it does not blindly approve unvetted providers.
- The matching scheduler must create provider opportunities, collect responses, support shortlists, and escalate exceptions.
- The provider review scheduler may support completeness checks, duplicate detection, risk scoring, and review queue routing, but final approval should require Ops action unless explicitly documented.
- Ops must be able to review provider applications, approve/reject/request more info, manage category approval, monitor requests, inspect matching decisions, manage shortlists, monitor jobs, review credits, retry notifications, and view scheduler health.
- Sensitive data must be role-protected and audited.
- Credit adjustments must be ledger-backed, reason-coded, and role-protected.
- Production links must use https://app.plugapro.co.za and never localhost.
- Stop only if the master runner stop conditions are met.
```
