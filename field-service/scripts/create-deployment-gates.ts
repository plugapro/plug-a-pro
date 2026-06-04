import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

type Args = {
  release: string
  pr: string
  branch: string
  env: string
  date: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--release' && next) args.release = next
    if (arg === '--pr' && next) args.pr = next
    if (arg === '--branch' && next) args.branch = next
    if (arg === '--env' && next) args.env = next
    if (arg === '--date' && next) args.date = next
  }

  if (!args.release) {
    throw new Error('Missing --release "<release-name>"')
  }

  return {
    release: args.release,
    pr: args.pr ?? 'TBD',
    branch: args.branch ?? 'main',
    env: args.env ?? 'production',
    date: args.date ?? new Date().toISOString().slice(0, 10),
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildMarkdown(args: Args) {
  const slug = slugify(args.release)
  const openBrainPath = '/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend'

  return `# Deployment Gates — ${args.release}

- Release: \`${args.release}\`
- Date: \`${args.date}\`
- Environment: \`${args.env}\`
- Branch: \`${args.branch}\`
- PR: \`${args.pr}\`
- Status: \`NOT_RUN\`

## References

- Framework: [../deployment-framework.md](../deployment-framework.md)
- Workflow image: [../deployment-workflow.svg](../deployment-workflow.svg)
- Verification checklist: [../post-deploy-verification.md](../post-deploy-verification.md)

## OpenBrain Kickoff

\`\`\`bash
cd ${openBrainPath}
pnpm brain -- knowledge add \\
  --project "Plug A Pro" \\
  --domain "engineering" \\
  --title "release kickoff — ${args.release} (${args.date})" \\
  --tags "deployment,release,production" \\
  --content "Kickoff for ${args.release}. PR: ${args.pr}. Branch: ${args.branch}. Environment: ${args.env}. Planned gates: 0-7."
\`\`\`

## Gate 0 — Change Readiness

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - PR merged / approved:
  - Typecheck result:
  - Test result:
  - Scope summary:
- Decision:
- Notes:

## Gate 1 — Schema and Migration Readiness

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Migration names:
  - Rollback notes:
  - Post-migrate scripts:
- Decision:
- Notes:

## Gate 2 — Production Deploy Readiness

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Target environment:
  - NEXT_PUBLIC_APP_URL:
  - Required secrets verified:
  - Webhook/public callback dependencies:
- Decision:
- Notes:

## Gate 3 — Data Rollout Readiness

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - \`pnpm db:migrate:prod\`:
  - \`pnpm db:backfill\`:
  - Production seed policy: Do not run broad database seed scripts in production.
  - Idempotency re-run:
- Decision:
- Notes:

## Gate 4 — Public/Auth Access Validation

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Public signed routes:
  - Protected route redirects:
  - /api/health behavior:
- Decision:
- Notes:

## Gate 5 — Feature Smoke Validation

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Happy path:
  - Failure path:
  - Network/API proof:
  - UI/runtime proof:
- Decision:
- Notes:

## Gate 6 — Backfill and Operational Risk Review

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Unresolved counts:
  - Deferred switches / flags:
  - Follow-up actions:
- Decision:
- Notes:

## Gate 7 — Release Close-Out

- Status: \`NOT_RUN\`
- Owner: \`TBD\`
- Evidence:
  - Final go/no-go:
  - Incidents observed:
  - Deferred risks:
  - Follow-up PRs/issues:
- Decision:
- Notes:

## OpenBrain Gate Update Template

\`\`\`bash
cd ${openBrainPath}
pnpm brain -- knowledge add \\
  --project "Plug A Pro" \\
  --domain "engineering" \\
  --title "release gate update — ${args.release} gate <n> (${args.date})" \\
  --tags "deployment,release,production" \\
  --content "Gate <n> for ${args.release}: <status>. Evidence: <evidence>. Risks: <risks>. Decision: <decision>."
\`\`\`

## OpenBrain Close-Out

\`\`\`bash
cd ${openBrainPath}
pnpm brain -- knowledge add \\
  --project "Plug A Pro" \\
  --domain "engineering" \\
  --title "release close-out — ${args.release} (${args.date})" \\
  --tags "deployment,release,production" \\
  --content "Release ${args.release} close-out. Final status: <PASS/BLOCKED/DEFERRED>. Summary: <summary>. Issues: <issues>. Follow-up: <follow-up>."
\`\`\`

## Command Log

\`\`\`bash
pnpm db:migrate:prod
pnpm db:backfill
\`\`\`

## Verification Reference

Run the standard checklist in [../post-deploy-verification.md](../post-deploy-verification.md).
`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const slug = slugify(args.release)
  const outputDir = join(process.cwd(), 'docs', 'releases')
  const outputPath = join(outputDir, `${args.date}-${slug}-deployment-gates.md`)

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(outputPath, buildMarkdown(args))

  console.log(`Created ${outputPath}`)
}

main()
