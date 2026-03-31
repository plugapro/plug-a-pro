# WhatsApp Marketplace Journeys — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both sides of the Plug a Pro marketplace (client + provider) fully operational through WhatsApp — loop-safe, exception-handled, and production-ready.

**Architecture:** Central conversation state machine in `whatsapp-bot.ts` dispatches to per-flow handlers. New `provider-journey.ts` handles provider availability and job status. New `matching-engine.ts` auto-identifies candidates and dispatches leads. All flows return to main menu via a universal `back_home` pattern.

**Tech Stack:** Next.js 15 App Router, Prisma + PostgreSQL (Supabase), WhatsApp Cloud API (Meta), Vercel Cron

---

## Gap Analysis (Current State)

| Area | Client Journey | Provider Journey |
|---|---|---|
| Main menu | ✅ Fixed (sendList + 4 options) | ✅ "Find Work" entry added |
| Registration | ✅ Works | ⚠️ Skips intro screen |
| Active availability toggle | N/A | ❌ Missing |
| Job status update via WA | N/A | ❌ Missing |
| Automatic matching | ❌ Manual only | ❌ Manual only |
| Loop-back to main menu | ⚠️ Partial | ⚠️ Partial |
| No-match escalation | ❌ Missing | ❌ Missing |
| Provider timeout/reassign | N/A | ❌ Missing |
| Admin WA alerts | ❌ Missing | ❌ Missing |

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/whatsapp-flows/types.ts` | Modify | Add new FlowNames + FlowSteps |
| `lib/whatsapp-flows/registration.ts` | Modify | Fix intro skip on "I want to work" entry |
| `lib/whatsapp-flows/provider-journey.ts` | **Create** | Provider availability + job status via WA |
| `lib/matching-engine.ts` | **Create** | Find candidates + dispatch leads |
| `lib/whatsapp-bot.ts` | Modify | Route new flows, universal loop-back |
| `lib/whatsapp-flows/job-request.ts` | Modify | Add back_home to terminal states |
| `lib/whatsapp-flows/help.ts` | Modify | Add back_home to terminal states |
| `lib/whatsapp-flows/status.ts` | Modify | Add back_home + main menu CTA |
| `lib/whatsapp.ts` | Modify | Add admin alert functions |
| `app/api/cron/match-leads/route.ts` | **Create** | Auto-match OPEN job requests + expire stale leads |
| `prisma/schema.prisma` | Modify | Add `availableNow` to Provider |
| `prisma/migrations/` | **Create** | Migration for availableNow |
| `__tests__/lib/matching-engine.test.ts` | **Create** | Matching engine unit tests |
| `__tests__/lib/whatsapp-flows/provider-journey.test.ts` | **Create** | Provider journey tests |

---

## Task 1: Fix Registration Entry Intro

**The bug:** When user types "I want to work", `whatsapp-bot.ts` sets `step = 'reg_collect_name'` which calls `handleCollectName` directly — skipping the `startRegistration` intro screen ("Join Plug a Pro as a Service Provider" with Yes/No buttons).

**Fix:** Route to `reg_start` step (falls to `default → startRegistration`) instead of `reg_collect_name`.

**Files:**
- Modify: `lib/whatsapp-flows/types.ts:17-56` — add `'reg_start'` to FlowStep
- Modify: `lib/whatsapp-bot.ts:94-95` — change step to `'reg_start'`

- [ ] **Step 1.1: Add `reg_start` to FlowStep in types.ts**

```typescript
// In types.ts, add 'reg_start' to the Registration section:
// Registration (provider onboarding)
| 'reg_start'           // shows intro + yes/no — NEW
| 'reg_collect_name'
```

- [ ] **Step 1.2: Fix routing in whatsapp-bot.ts**

In `whatsapp-bot.ts`, change line ~95:
```typescript
// BEFORE:
} else if ((isRegistration || reply.id === 'find_work') && flow === 'idle') {
  flow = 'registration'
  step = 'reg_collect_name'

// AFTER:
} else if ((isRegistration || reply.id === 'find_work') && flow === 'idle') {
  flow = 'registration'
  step = 'reg_start'
```

- [ ] **Step 1.3: Handle `reg_start` step in registration.ts**

In `handleRegistrationFlow`, the `switch` needs a `reg_start` case (or rely on `default`). The `default` already calls `startRegistration(ctx)` which is correct. But add explicit case for clarity:

```typescript
// In handleRegistrationFlow switch:
case 'reg_start':
  return startRegistration(ctx)
```

- [ ] **Step 1.4: Test manually — send "I want to work" to WhatsApp**

Expected: Bot shows "👷 Join Plug a Pro as a Service Provider..." with [Yes, Apply Now] [Not Now] buttons.

- [ ] **Step 1.5: Commit**

```bash
git add lib/whatsapp-flows/types.ts lib/whatsapp-bot.ts lib/whatsapp-flows/registration.ts
git commit -m "fix(whatsapp): show registration intro screen on 'I want to work' trigger"
```

---

## Task 2: Extend Types for Provider Journey

**Files:**
- Modify: `lib/whatsapp-flows/types.ts`

- [ ] **Step 2.1: Add `provider_journey` FlowName and provider step names**

Replace current FlowName and FlowStep definitions in `types.ts`:

```typescript
export type FlowName =
  | 'idle'
  | 'job_request'
  | 'registration'
  | 'status'
  | 'reschedule'
  | 'cancel'
  | 'help'
  | 'provider_job'
  | 'provider_journey'  // NEW — availability + job updates for registered providers
```

Add to FlowStep (after `tech_job_confirm_decline`):
```typescript
// Provider journey (registered provider WhatsApp interactions)
| 'pj_menu'                 // provider main menu
| 'pj_toggle_available'     // going online/offline
| 'pj_job_list'             // view active jobs
| 'pj_job_detail'           // view single job
| 'pj_status_update'        // select new job status
| 'pj_status_confirm'       // confirm status change
| 'pj_problem_report'       // report a job problem
```

Add to ConversationData:
```typescript
// Provider journey
availableNow?: boolean
activeJobId?: string        // job being managed in current flow
statusUpdate?: string       // pending status to confirm
```

- [ ] **Step 2.2: Commit**

```bash
git add lib/whatsapp-flows/types.ts
git commit -m "feat(types): add provider_journey flow and steps"
```

---

## Task 3: Schema — Add `availableNow` to Provider

**Purpose:** Track whether a registered, active provider is currently accepting new leads. Separate from `active` (account enabled/disabled).

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration

- [ ] **Step 3.1: Add field to Provider model in schema.prisma**

```prisma
model Provider {
  // ... existing fields ...
  active       Boolean  @default(true)
  availableNow Boolean  @default(true)   // NEW — provider is currently online and accepting leads
  verified     Boolean  @default(false)
  // ...
}
```

- [ ] **Step 3.2: Run migration**

```bash
cd /Users/shimane/Projects/Plug-A-Pro/field-service
npx prisma migrate dev --name add_provider_available_now
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3.3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client`

- [ ] **Step 3.4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add availableNow boolean to Provider model"
```

---

## Task 4: Provider Journey Flow (new file)

**Purpose:** Registered providers can manage their availability and update job status via WhatsApp.

**Entry points:**
- Keyword `available`, `online`, `im available`, `ek is beskikbaar` → toggle available
- Keyword `offline`, `not available`, `not working` → toggle unavailable
- Keyword `my jobs` already routes to `provider_job` (existing). We extend this.
- From within a job, provider can update status

**Files:**
- Create: `lib/whatsapp-flows/provider-journey.ts`

- [ ] **Step 4.1: Write test file first**

Create `__tests__/lib/whatsapp-flows/provider-journey.test.ts`:

```typescript
import { handleProviderJourneyFlow } from '../../../lib/whatsapp-flows/provider-journey'
import { db } from '../../../lib/db'

jest.mock('../../../lib/db', () => ({
  db: {
    provider: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    job: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    jobStatusEvent: {
      create: jest.fn(),
    },
  },
}))

jest.mock('../../../lib/whatsapp-interactive', () => ({
  sendText: jest.fn(),
  sendButtons: jest.fn(),
  sendList: jest.fn(),
}))

const mockCtx = (step: string, replyId?: string, replyText?: string, data: object = {}) => ({
  phone: '+27711111111',
  step,
  data,
  flow: 'provider_journey' as const,
  reply: { id: replyId, text: replyText, title: undefined },
})

const { sendText, sendButtons } = require('../../../lib/whatsapp-interactive')
const mockDb = db as jest.Mocked<typeof db>

describe('handleProviderJourneyFlow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('pj_menu: shows provider menu when provider exists', async () => {
    ;(mockDb.provider.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov_1', name: 'Sipho', availableNow: true,
    })
    await handleProviderJourneyFlow(mockCtx('pj_menu'))
    expect(sendButtons).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('Provider Menu'),
      expect.any(Array)
    )
  })

  it('pj_menu: prompts to register when provider not found', async () => {
    ;(mockDb.provider.findUnique as jest.Mock).mockResolvedValue(null)
    await handleProviderJourneyFlow(mockCtx('pj_menu'))
    expect(sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('join')
    )
  })

  it('pj_toggle_available: sets availableNow=true when tapping go_online', async () => {
    ;(mockDb.provider.findUnique as jest.Mock).mockResolvedValue({ id: 'prov_1', name: 'Sipho', availableNow: false })
    ;(mockDb.provider.update as jest.Mock).mockResolvedValue({ availableNow: true })
    await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_go_online'))
    expect(mockDb.provider.update).toHaveBeenCalledWith({
      where: { id: 'prov_1' },
      data: { availableNow: true },
    })
  })

  it('pj_toggle_available: sets availableNow=false when tapping go_offline', async () => {
    ;(mockDb.provider.findUnique as jest.Mock).mockResolvedValue({ id: 'prov_1', name: 'Sipho', availableNow: true })
    ;(mockDb.provider.update as jest.Mock).mockResolvedValue({ availableNow: false })
    await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_go_offline'))
    expect(mockDb.provider.update).toHaveBeenCalledWith({
      where: { id: 'prov_1' },
      data: { availableNow: false },
    })
  })
})
```

- [ ] **Step 4.2: Run test to confirm it fails (TDD)**

```bash
cd /Users/shimane/Projects/Plug-A-Pro/field-service
npx jest provider-journey --no-coverage 2>&1 | head -20
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 4.3: Implement `provider-journey.ts`**

Create `lib/whatsapp-flows/provider-journey.ts`:

```typescript
// ─── Provider WhatsApp journey ────────────────────────────────────────────────
// Registered providers manage availability and job status through WhatsApp.
// Entry: keywords "available", "offline", "my jobs", or "provider menu"

import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import { db } from '../db'
import type { FlowContext, FlowResult } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

export const PROVIDER_JOURNEY_TRIGGERS = [
  'available', 'online', 'im available', "i'm available", 'ek is beskikbaar',
  'offline', 'not available', 'not working', 'ek is nie beskikbaar',
  'provider menu', 'my dashboard', 'provider',
]

export async function handleProviderJourneyFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'pj_menu':
      return handleProviderMenu(ctx)
    case 'pj_toggle_available':
      return handleToggleAvailable(ctx)
    case 'pj_job_detail':
      return handleJobDetail(ctx)
    case 'pj_status_update':
      return handleStatusUpdate(ctx)
    case 'pj_status_confirm':
      return handleStatusConfirm(ctx)
    case 'pj_problem_report':
      return handleProblemReport(ctx)
    default:
      return handleProviderMenu(ctx)
  }
}

// ─── Provider Menu ────────────────────────────────────────────────────────────

async function handleProviderMenu(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })

  if (!provider) {
    await sendText(
      ctx.phone,
      "👷 You're not registered as a Plug a Pro provider yet.\n\nReply *join* to apply, or *Hi* for the main menu."
    )
    return { nextStep: 'done' }
  }

  const statusEmoji = provider.availableNow ? '🟢' : '🔴'
  const statusText = provider.availableNow ? 'Online — accepting leads' : 'Offline — not accepting leads'
  const toggleLabel = provider.availableNow ? '🔴 Go Offline' : '🟢 Go Online'

  await sendButtons(
    ctx.phone,
    `👷 *Provider Menu*\n\nHi ${provider.name}!\n${statusEmoji} Status: *${statusText}*\n\nWhat would you like to do?`,
    [
      { id: 'pj_toggle', title: toggleLabel },
      { id: 'pj_view_jobs', title: '📋 My Jobs' },
      { id: 'back_home', title: '🏠 Main Menu' },
    ]
  )

  return { nextStep: 'pj_toggle_available' }
}

// ─── Availability Toggle ──────────────────────────────────────────────────────

async function handleToggleAvailable(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_view_jobs') {
    return handleJobList(ctx)
  }

  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_go_online' || ctx.reply.id === 'pj_toggle') {
    // Toggle: if currently online → go offline, if offline → go online
    const goingOnline = !provider.availableNow
    await db.provider.update({ where: { id: provider.id }, data: { availableNow: goingOnline } })

    if (goingOnline) {
      await sendButtons(
        ctx.phone,
        `🟢 *You are now Online*\n\nYou'll receive job leads in your area. We'll send them here on WhatsApp.\n\nMake sure notifications are turned on!`,
        [
          { id: 'pj_view_jobs', title: '📋 View My Jobs' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
    } else {
      await sendButtons(
        ctx.phone,
        `🔴 *You are now Offline*\n\nYou won't receive new job leads until you go online again.\n\nReply *available* or tap Online when you're ready to work.`,
        [
          { id: 'pj_go_online', title: '🟢 Go Online' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
    }
    return { nextStep: 'pj_toggle_available' }
  }

  if (ctx.reply.id === 'pj_go_offline') {
    await db.provider.update({ where: { id: provider.id }, data: { availableNow: false } })
    await sendButtons(
      ctx.phone,
      `🔴 *You are now Offline*\n\nYou won't receive new job leads until you go online again.`,
      [
        { id: 'pj_go_online', title: '🟢 Go Online' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  // Unexpected input — re-show menu
  return handleProviderMenu(ctx)
}

// ─── Job List ─────────────────────────────────────────────────────────────────

async function handleJobList(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const activeJobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL'] },
    },
    include: {
      booking: {
        include: { match: { include: { jobRequest: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (activeJobs.length === 0) {
    await sendButtons(
      ctx.phone,
      `📋 *No active jobs right now.*\n\nYou'll receive a WhatsApp notification when a new lead comes in.\n\nMake sure you're online to receive leads.`,
      [
        { id: 'pj_toggle', title: '🟢 Go Online' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const statusLabel: Record<string, string> = {
    SCHEDULED: 'Scheduled',
    EN_ROUTE: 'On the way',
    ARRIVED: 'Arrived',
    STARTED: 'In progress',
    PAUSED: 'Paused',
    AWAITING_APPROVAL: 'Awaiting approval',
  }

  const rows = activeJobs.slice(0, 5).map((job) => {
    const category = job.booking?.match?.jobRequest?.category ?? 'Job'
    const status = statusLabel[job.status] ?? job.status
    return {
      id: `pj_job_${job.id}`,
      title: category.slice(0, 24),
      description: status,
    }
  })

  rows.push({ id: 'back_home', title: '🏠 Main Menu', description: 'Back to main menu' })

  await sendList(
    ctx.phone,
    `📋 *Your Active Jobs*\n\nTap a job to update its status:`,
    [{ title: 'Active Jobs', rows }],
    { buttonLabel: 'Choose Job' }
  )

  return { nextStep: 'pj_job_detail' }
}

// ─── Job Detail & Status Update ───────────────────────────────────────────────

async function handleJobDetail(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (!ctx.reply.id?.startsWith('pj_job_')) {
    return handleJobList(ctx)
  }

  const jobId = ctx.reply.id.replace('pj_job_', '')

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: { include: { address: true } },
            },
          },
        },
      },
    },
  })

  if (!job) {
    await sendText(ctx.phone, "Job not found. Reply *my jobs* to see your active jobs.")
    return { nextStep: 'done' }
  }

  const category = job.booking?.match?.jobRequest?.category ?? 'Job'
  const address = job.booking?.match?.jobRequest?.address
  const addressStr = address
    ? `${address.street}, ${address.suburb}`
    : 'Address on file'

  const statusLabel: Record<string, string> = {
    SCHEDULED: '📅 Scheduled',
    EN_ROUTE: '🚗 On the way',
    ARRIVED: '📍 Arrived',
    STARTED: '🔧 In progress',
    PAUSED: '⏸ Paused',
    AWAITING_APPROVAL: '⌛ Awaiting approval',
  }

  const currentStatus = statusLabel[job.status] ?? job.status
  const jobUrl = `${APP_URL}/technician/jobs/${job.id}`

  // Show next valid status transitions
  const nextSteps = getNextStatusOptions(job.status)

  if (nextSteps.length === 0) {
    await sendText(
      ctx.phone,
      `🔧 *${category}*\n📍 ${addressStr}\n${currentStatus}\n\nThis job has no more status updates. Reply *my jobs* to see all jobs.`
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `🔧 *${category}*\n📍 ${addressStr}\n\nCurrent status: ${currentStatus}\n\nUpdate status to:`,
    nextSteps.map((s) => ({ id: `pj_update_${jobId}_${s.id}`, title: s.label }))
  )

  return { nextStep: 'pj_status_confirm', nextData: { activeJobId: jobId } }
}

function getNextStatusOptions(currentStatus: string): Array<{ id: string; label: string }> {
  const transitions: Record<string, Array<{ id: string; label: string }>> = {
    SCHEDULED:         [{ id: 'EN_ROUTE', label: '🚗 On My Way' }],
    EN_ROUTE:          [{ id: 'ARRIVED', label: '📍 I\'ve Arrived' }],
    ARRIVED:           [{ id: 'STARTED', label: '🔧 Starting Work' }],
    STARTED:           [{ id: 'COMPLETED', label: '✅ Job Done' }, { id: 'PAUSED', label: '⏸ Pause Job' }],
    PAUSED:            [{ id: 'STARTED', label: '🔧 Resume Work' }],
    AWAITING_APPROVAL: [],
  }
  return transitions[currentStatus] ?? []
}

async function handleStatusConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (!ctx.reply.id?.startsWith('pj_update_')) {
    return { nextStep: 'pj_status_confirm' }
  }

  // Parse: pj_update_<jobId>_<newStatus>
  const withoutPrefix = ctx.reply.id.replace('pj_update_', '')
  const lastUnderscore = withoutPrefix.lastIndexOf('_')
  const jobId = withoutPrefix.slice(0, lastUnderscore)
  const newStatus = withoutPrefix.slice(lastUnderscore + 1)

  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: { customer: true },
              },
            },
          },
        },
      },
    },
  })

  if (!job || job.providerId !== provider.id) {
    await sendText(ctx.phone, "⚠️ This job is no longer available or doesn't belong to you.")
    return { nextStep: 'done' }
  }

  await db.job.update({ where: { id: jobId }, data: { status: newStatus as any } })
  await db.jobStatusEvent.create({
    data: {
      jobId,
      status: newStatus,
      note: `Updated via WhatsApp by provider`,
    },
  })

  const statusMessages: Record<string, string> = {
    EN_ROUTE: '🚗 Status updated — *On My Way*!\n\nThe customer has been notified you are en route.',
    ARRIVED: '📍 Status updated — *Arrived*!\n\nThe customer has been notified you\'re at the location.',
    STARTED: '🔧 Status updated — *Work Started*!\n\nThe clock is running. Update to ✅ Done when finished.',
    PAUSED: '⏸ Status updated — *Job Paused*.\n\nReply *my jobs* to resume when ready.',
    COMPLETED: `🎉 *Job marked as complete!*\n\nGreat work! The customer will receive a completion notification.\n\nView your full job record here: ${APP_URL}/technician/jobs/${jobId}`,
  }

  // Notify customer of status change
  await notifyCustomerStatusChange(job, newStatus)

  await sendButtons(
    ctx.phone,
    statusMessages[newStatus] ?? `✅ Status updated to ${newStatus}.`,
    [
      { id: 'pj_view_jobs', title: '📋 My Jobs' },
      { id: 'back_home', title: '🏠 Main Menu' },
    ]
  )

  return { nextStep: 'pj_toggle_available' }
}

async function handleStatusUpdate(ctx: FlowContext): Promise<FlowResult> {
  return handleJobList(ctx)
}

async function handleProblemReport(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  await sendText(
    ctx.phone,
    `🚨 *Report a Problem*\n\nPlease describe the problem in a reply and we'll follow up within 2 hours.\n\nInclude:\n• Your job reference number (if you have it)\n• What went wrong\n• Any photos if relevant\n\nOr call us directly: ${process.env.SUPPORT_WHATSAPP_NUMBER ?? 'our support number'}`
  )
  return { nextStep: 'done' }
}

// ─── Internal: Notify customer of job status change ───────────────────────────

async function notifyCustomerStatusChange(
  job: any,
  newStatus: string
): Promise<void> {
  const customer = job.booking?.match?.jobRequest?.customer
  if (!customer?.phone) return

  const { sendText: waText } = await import('../whatsapp-interactive')
  const category = job.booking?.match?.jobRequest?.category ?? 'Job'

  const messages: Record<string, string> = {
    EN_ROUTE: `🚗 *Your ${category} worker is on the way!*\n\nThey should arrive shortly. Make sure someone is home to let them in.`,
    ARRIVED: `📍 *Your ${category} worker has arrived.*\n\nThey're at your location now.`,
    STARTED: `🔧 *Work has started on your ${category} job.*\n\nYou'll be notified when it's done.`,
    COMPLETED: `🎉 *Your ${category} job is complete!*\n\nPlease let your worker know if you're happy with the work.\n\nReply *Hi* to leave a rating — it takes 30 seconds and helps our workers greatly.`,
  }

  const msg = messages[newStatus]
  if (msg) {
    await waText(customer.phone, msg).catch(() => {})
  }
}
```

- [ ] **Step 4.4: Run tests**

```bash
cd /Users/shimane/Projects/Plug-A-Pro/field-service
npx jest provider-journey --no-coverage 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 4.5: Commit**

```bash
git add lib/whatsapp-flows/provider-journey.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts
git commit -m "feat(whatsapp): add provider journey flow — availability toggle + job status updates"
```

---

## Task 5: Matching Engine

**Purpose:** When a JobRequest is validated (status → OPEN), automatically find candidate providers by skill + area + availableNow, create Lead records, and dispatch WhatsApp notifications.

**Files:**
- Create: `lib/matching-engine.ts`
- Create: `__tests__/lib/matching-engine.test.ts`

- [ ] **Step 5.1: Write tests first**

Create `__tests__/lib/matching-engine.test.ts`:

```typescript
import { findCandidateProviders, dispatchLeads } from '../../lib/matching-engine'
import { db } from '../../lib/db'
import { notifyProviderNewJob } from '../../lib/whatsapp-bot'

jest.mock('../../lib/db', () => ({
  db: {
    jobRequest: { findUnique: jest.fn() },
    provider: { findMany: jest.fn() },
    lead: { create: jest.fn(), findFirst: jest.fn() },
  },
}))
jest.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: jest.fn(),
}))

const mockDb = db as jest.Mocked<typeof db>

describe('findCandidateProviders', () => {
  it('returns providers matching skill and serviceArea', async () => {
    ;(mockDb.provider.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'Sipho', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    const result = await findCandidateProviders({
      category: 'Plumbing',
      suburb: 'Sandton',
      city: 'Johannesburg',
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('returns empty array when no matching providers', async () => {
    ;(mockDb.provider.findMany as jest.Mock).mockResolvedValue([])
    const result = await findCandidateProviders({ category: 'Plumbing', suburb: 'Unknown', city: 'Unknown' })
    expect(result).toHaveLength(0)
  })
})

describe('dispatchLeads', () => {
  it('creates Lead records and sends WA notifications', async () => {
    const jobRequest = {
      id: 'jr_1',
      category: 'Plumbing',
      title: 'Leaking tap',
      description: 'Kitchen tap',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Zanele' },
    }
    ;(mockDb.jobRequest.findUnique as jest.Mock).mockResolvedValue(jobRequest)
    ;(mockDb.provider.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'Sipho', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    ;(mockDb.lead.findFirst as jest.Mock).mockResolvedValue(null)
    ;(mockDb.lead.create as jest.Mock).mockResolvedValue({ id: 'lead_1' })

    const result = await dispatchLeads('jr_1')

    expect(result.leadsDispatched).toBe(1)
    expect(notifyProviderNewJob).toHaveBeenCalledTimes(1)
  })

  it('does not re-dispatch lead if one already exists', async () => {
    ;(mockDb.jobRequest.findUnique as jest.Mock).mockResolvedValue({
      id: 'jr_1', category: 'Plumbing', title: 'Test', description: '',
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      customer: { name: 'Test' },
    })
    ;(mockDb.provider.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', phone: '+27711000001', name: 'Sipho', skills: ['Plumbing'], serviceAreas: ['Sandton'], availableNow: true },
    ])
    ;(mockDb.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'existing_lead' })

    const result = await dispatchLeads('jr_1')
    expect(result.leadsDispatched).toBe(0)
    expect(notifyProviderNewJob).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5.2: Run test to confirm failure**

```bash
npx jest matching-engine --no-coverage 2>&1 | head -10
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 5.3: Implement `matching-engine.ts`**

Create `lib/matching-engine.ts`:

```typescript
// ─── Matching Engine ──────────────────────────────────────────────────────────
// Finds candidate service providers for a job request, creates Lead records,
// and dispatches WhatsApp notifications. Called when a job is validated.
//
// Matching criteria (in priority order):
//   1. Skills: provider.skills includes job category (case-insensitive)
//   2. Area: provider.serviceAreas overlaps job suburb or city
//   3. Availability: provider.active AND provider.availableNow
//   4. No existing lead for this job+provider pair

import { db } from './db'
import { notifyProviderNewJob } from './whatsapp-bot'

const LEAD_EXPIRY_HOURS = 4  // Provider must respond within 4 hours

export interface CandidateInput {
  category: string
  suburb: string
  city: string
}

export interface DispatchResult {
  jobRequestId: string
  leadsDispatched: number
  candidatesFound: number
  noMatch: boolean
}

export async function findCandidateProviders(input: CandidateInput) {
  const categoryNorm = input.category.toLowerCase()
  const areaTerms = [input.suburb.toLowerCase(), input.city.toLowerCase()].filter(Boolean)

  const providers = await db.provider.findMany({
    where: {
      active: true,
      availableNow: true,
      verified: true,
    },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      availableNow: true,
    },
  })

  return providers.filter((p) => {
    const hasSkill = p.skills.some((s) => s.toLowerCase() === categoryNorm)
    const inArea = p.serviceAreas.some((a) =>
      areaTerms.some((term) => a.toLowerCase().includes(term) || term.includes(a.toLowerCase()))
    )
    return hasSkill && inArea
  })
}

export async function dispatchLeads(jobRequestId: string): Promise<DispatchResult> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    include: {
      address: true,
      customer: { select: { name: true } },
    },
  })

  if (!jobRequest) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  const candidates = await findCandidateProviders({
    category: jobRequest.category,
    suburb: jobRequest.address?.suburb ?? '',
    city: jobRequest.address?.city ?? '',
  })

  if (candidates.length === 0) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  const expiresAt = new Date(Date.now() + LEAD_EXPIRY_HOURS * 60 * 60 * 1000)
  let leadsDispatched = 0

  for (const provider of candidates) {
    // Idempotency: skip if lead already exists for this pair
    const existing = await db.lead.findFirst({
      where: { jobRequestId, providerId: provider.id },
    })
    if (existing) continue

    // Create match record to get an ID for the WhatsApp buttons
    // Note: in future this could be a separate "candidacy" record, but for now
    // we reuse the Match model with status PENDING (if not already matched)
    const existingMatch = await db.match.findFirst({ where: { jobRequestId } })
    if (existingMatch) continue  // Already matched to another provider — skip

    // Create lead
    await db.lead.create({
      data: {
        jobRequestId,
        providerId: provider.id,
        status: 'SENT',
        expiresAt,
      },
    })

    // Create provisional match (used for the WhatsApp button IDs)
    const match = await db.match.create({
      data: {
        jobRequestId,
        providerId: provider.id,
        status: 'MATCHED',
      },
    })

    // Dispatch WhatsApp notification
    const description = jobRequest.title || jobRequest.description?.slice(0, 60) || jobRequest.category
    await notifyProviderNewJob({
      providerPhone: provider.phone,
      matchId: match.id,
      category: jobRequest.category,
      area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
      description: description,
      customerInitial: (jobRequest.customer?.name ?? '').split(' ')[0] ?? 'Customer',
    }).catch((err) => {
      console.error(`[matching-engine] Failed to notify provider ${provider.id}:`, err)
    })

    leadsDispatched++
    // For now dispatch to first available match only — can be extended to multi-dispatch
    break
  }

  return {
    jobRequestId,
    leadsDispatched,
    candidatesFound: candidates.length,
    noMatch: leadsDispatched === 0,
  }
}

export async function expireStaleLeads(): Promise<number> {
  // Find leads past expiry with no response
  const staleLeads = await db.lead.findMany({
    where: {
      status: 'SENT',
      expiresAt: { lt: new Date() },
    },
    include: {
      jobRequest: { include: { address: true, customer: true } },
      provider: true,
    },
  })

  let expired = 0
  for (const lead of staleLeads) {
    await db.lead.update({ where: { id: lead.id }, data: { status: 'EXPIRED' } })

    // Cancel provisional match so re-dispatch can happen
    await db.match.deleteMany({
      where: {
        jobRequestId: lead.jobRequestId,
        providerId: lead.providerId,
        status: 'MATCHED',
      },
    }).catch(() => {})

    expired++
  }

  return expired
}
```

- [ ] **Step 5.4: Run tests**

```bash
npx jest matching-engine --no-coverage 2>&1 | tail -15
```

Expected: All tests PASS

- [ ] **Step 5.5: Commit**

```bash
git add lib/matching-engine.ts __tests__/lib/matching-engine.test.ts
git commit -m "feat: add matching engine — auto-dispatch leads to candidate providers"
```

---

## Task 6: Wire Provider Journey into Bot Router + Universal Loop-back

**Files:**
- Modify: `lib/whatsapp-bot.ts`

- [ ] **Step 6.1: Add provider journey import to whatsapp-bot.ts**

At the top imports section, add:
```typescript
import {
  handleProviderJourneyFlow,
  PROVIDER_JOURNEY_TRIGGERS,
} from './whatsapp-flows/provider-journey'
```

- [ ] **Step 6.2: Add provider journey trigger keywords**

After the `PROVIDER_KEYWORDS` constant (~line 44), add:
```typescript
// Keywords that open the provider's personal journey menu
const PROVIDER_AVAIL_TRIGGERS = PROVIDER_JOURNEY_TRIGGERS
```

- [ ] **Step 6.3: Add routing for provider journey**

In the routing block (after the `isProviderJobList` check, ~line 91), add before the `isRegistration` check:

```typescript
} else if (PROVIDER_AVAIL_TRIGGERS.some((k) => rawText === k || rawText.startsWith(k)) && flow === 'idle') {
  flow = 'provider_journey'
  step = 'pj_menu'
```

- [ ] **Step 6.4: Add dispatch for provider_journey flow**

In the dispatch block (~line 181), add:
```typescript
} else if (flow === 'provider_journey') {
  result = await handleProviderJourneyFlow(ctx)
```

- [ ] **Step 6.5: Add universal `back_home` handler**

In the routing block, add handling for `reply.id === 'back_home'` from ANY flow:

```typescript
// Universal back-to-menu — works from any flow
if (reply.id === 'back_home') {
  await showMainMenu(phone)
  await saveConversation({ phone, flow: 'idle', step: 'welcome', data: {} })
  return
}
```

Add this BEFORE the `isReset` check block, immediately after building `rawText`.

- [ ] **Step 6.6: Add `menu` keyword as an in-flow reset (not just when idle)**

Change the `isReset` keywords to include `menu` as a mid-flow trigger:
```typescript
const RESET_KEYWORDS = ['hi', 'hello', 'hey', 'start', 'menu', 'home', 'restart', 'hola', 'sawubona', 'howzit']
// Note: 'menu' already in RESET_KEYWORDS — but isReset only triggers when not within a started flow.
// The universal back_home above handles button-based return.
// For text 'menu', the isReset path handles it.
```

Actually the current isReset check at line 61 is fine — the `RESET_KEYWORDS.some((k) => rawText === k || rawText.startsWith(k + ' '))` includes 'menu'. So typing "menu" will always show the main menu. ✓

- [ ] **Step 6.7: Add `pj_job_list` step dispatch**

The `pj_view_jobs` button in provider journey needs routing. In `handleProviderJourneyFlow`, the `pj_toggle_available` step handles `pj_view_jobs` by calling `handleJobList`. This is handled internally in the flow. ✓

- [ ] **Step 6.8: Build + type-check**

```bash
cd /Users/shimane/Projects/Plug-A-Pro/field-service
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 6.9: Commit**

```bash
git add lib/whatsapp-bot.ts
git commit -m "feat(bot): route provider_journey flow + universal back_home pattern"
```

---

## Task 7: Add Loop-back CTAs to Terminal States in All Flows

**Files:**
- Modify: `lib/whatsapp-flows/status.ts`
- Modify: `lib/whatsapp-flows/help.ts`
- Modify: `lib/whatsapp-flows/job-request.ts`
- Modify: `lib/whatsapp-flows/registration.ts`

The pattern: wherever a flow currently returns `{ nextStep: 'done' }` with just a `sendText`, replace with `sendButtons` that includes a `back_home` CTA.

- [ ] **Step 7.1: status.ts — add menu CTA to status display**

In `handleStatusFlow`, replace the final `sendCtaUrl` return with:
```typescript
await sendCtaUrl(
  ctx.phone,
  `📋 *Your latest request*\n\n🔧 ${latest.category}\n${statusLabel}`,
  'View Request',
  trackingUrl,
  { footer: 'Tap to view full details' }
)

// Also send quick-action buttons underneath
const { sendButtons } = await import('../whatsapp-interactive')
await sendButtons(
  ctx.phone,
  'What would you like to do next?',
  [
    { id: 'book', title: '🔧 New Request' },
    { id: 'help', title: '❓ Get Help' },
    { id: 'back_home', title: '🏠 Main Menu' },
  ]
)
return { nextStep: 'welcome' }
```

Actually: WhatsApp doesn't support sending two messages simultaneously well. Instead, embed the menu option in the CTA message footer:
```typescript
await sendCtaUrl(
  ctx.phone,
  `📋 *Your latest request*\n\n🔧 ${latest.category}\n${statusLabel}\n\nReply *menu* to return to the main menu.`,
  'View Request',
  trackingUrl,
  { footer: 'Reply "menu" for main menu · Reply "help" for FAQs' }
)
return { nextStep: 'done' }
```

- [ ] **Step 7.2: registration.ts — add menu CTA when already registered or pending**

In `startRegistration`, when sending "already registered" or "pending" messages, add a `sendButtons` follow-up:
```typescript
// In the APPROVED case:
await sendButtons(
  ctx.phone,
  "✅ You're already registered as a Plug a Pro worker! You'll receive job leads through this number.\n\nWhat would you like to do?",
  [
    { id: 'pj_view_jobs', title: '📋 My Jobs' },
    { id: 'back_home', title: '🏠 Main Menu' },
  ]
)
return { nextStep: 'pj_toggle_available' }

// In the PENDING case: add footer to existing sendText
await sendText(
  ctx.phone,
  `⏳ Your application is under review. We'll contact you within 24 hours.\n\nRef: *${existing.id.slice(-8).toUpperCase()}*\n\nReply *menu* anytime to return to the main menu.`
)
return { nextStep: 'done' }
```

- [ ] **Step 7.3: help.ts — add menu CTA for contact_human and problem_with_job**

After `faq_contact_human` and `faq_problem_with_job` send their text, they currently return `{ nextStep: 'done' }`. Change both to also append a buttons message:

In `faq_contact_human` after sendText:
```typescript
await sendButtons(ctx.phone, 'Is there anything else I can help with?', [
  { id: 'back_to_help', title: '← More Questions' },
  { id: 'back_home', title: '🏠 Main Menu' },
])
return { nextStep: 'help_faq' }
```

In `faq_problem_with_job` after sendText:
```typescript
await sendButtons(ctx.phone, 'Is there anything else I can help with?', [
  { id: 'back_to_help', title: '← Back to Help' },
  { id: 'back_home', title: '🏠 Main Menu' },
])
return { nextStep: 'help_faq' }
```

- [ ] **Step 7.4: job-request.ts — add menu CTA to confirmation messages**

In `handleJobRequestSubmitted` success case after `sendText`:
```typescript
await sendButtons(
  ctx.phone,
  'What would you like to do next?',
  [
    { id: 'status', title: '📋 Track My Request' },
    { id: 'back_home', title: '🏠 Main Menu' },
  ]
)
```

- [ ] **Step 7.5: Commit**

```bash
git add lib/whatsapp-flows/status.ts lib/whatsapp-flows/help.ts lib/whatsapp-flows/job-request.ts lib/whatsapp-flows/registration.ts
git commit -m "feat(whatsapp): add loop-back CTAs to all terminal flow states"
```

---

## Task 8: Matching Cron — Auto-dispatch + Stale Lead Expiry

**Files:**
- Create: `app/api/cron/match-leads/route.ts`

- [ ] **Step 8.1: Create cron route**

Create `app/api/cron/match-leads/route.ts`:

```typescript
// ─── Cron: Auto-match open job requests + expire stale leads ──────────────────
// Runs every 30 minutes via Vercel Cron.
// 1. Finds JobRequests in OPEN state with no leads dispatched → dispatch
// 2. Expires leads that passed their expiresAt without response → re-dispatch
// Secured by CRON_SECRET header.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchLeads, expireStaleLeads } from '@/lib/matching-engine'
import { sendText } from '@/lib/whatsapp-interactive'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const results = { dispatched: 0, expired: 0, noMatch: 0, errors: 0 }

  // 1. Expire stale leads and free up job requests for re-dispatch
  try {
    results.expired = await expireStaleLeads()
    if (results.expired > 0) {
      console.log(`[cron/match-leads] Expired ${results.expired} stale leads`)
    }
  } catch (err) {
    console.error('[cron/match-leads] Error expiring leads:', err)
    results.errors++
  }

  // 2. Find OPEN job requests with no active leads → dispatch
  const openRequests = await db.jobRequest.findMany({
    where: { status: 'OPEN' },
    include: { address: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  for (const jr of openRequests) {
    // Check if there's already an active lead
    const activeLead = await db.lead.findFirst({
      where: { jobRequestId: jr.id, status: { in: ['SENT'] } },
    })
    if (activeLead) continue  // Already waiting on provider response

    try {
      const result = await dispatchLeads(jr.id)
      if (result.leadsDispatched > 0) {
        results.dispatched++
        // Update status to MATCHING
        await db.jobRequest.update({ where: { id: jr.id }, data: { status: 'MATCHING' } })
      } else if (result.noMatch) {
        results.noMatch++
        console.warn(`[cron/match-leads] No providers found for job ${jr.id} (${jr.category} in ${jr.address?.suburb})`)
      }
    } catch (err) {
      console.error(`[cron/match-leads] Error dispatching for job ${jr.id}:`, err)
      results.errors++
    }
  }

  // Alert admin if there are unmatched jobs (>1h old)
  const unmatched1h = await db.jobRequest.count({
    where: {
      status: 'OPEN',
      createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
    },
  })

  if (unmatched1h > 0 && ADMIN_PHONE) {
    await sendText(
      ADMIN_PHONE,
      `⚠️ *Ops Alert*\n\n${unmatched1h} job request(s) have been OPEN for over 1 hour with no provider match.\n\nReview: ${process.env.NEXT_PUBLIC_APP_URL}/admin/bookings`
    ).catch(() => {})
  }

  console.log('[cron/match-leads] Complete:', results)
  return NextResponse.json({ ok: true, ...results })
}
```

- [ ] **Step 8.2: Register cron in vercel.json**

Check if `vercel.json` exists:
```bash
cat /Users/shimane/Projects/Plug-A-Pro/field-service/vercel.json 2>/dev/null || echo "NOT FOUND"
```

If it exists, add to crons array. If not, create:
```json
{
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/follow-up",
      "schedule": "0 10 * * *"
    },
    {
      "path": "/api/cron/match-leads",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

- [ ] **Step 8.3: Add `ADMIN_WHATSAPP_NUMBER` to env**

```bash
# In .env.local:
ADMIN_WHATSAPP_NUMBER=+27XXXXXXXXXX
```

Also add to Vercel env:
```bash
vercel env add ADMIN_WHATSAPP_NUMBER production
```

- [ ] **Step 8.4: Commit**

```bash
git add app/api/cron/match-leads/route.ts vercel.json
git commit -m "feat(cron): auto-match open job requests every 30 minutes + expire stale leads"
```

---

## Task 9: Dispatch Leads on Job Request Submission

**Purpose:** When a customer submits a job request and admin validates it (status → OPEN), trigger matching. For MVP, also trigger immediately on submission.

**Files:**
- Modify: `lib/whatsapp-flows/job-request.ts` — call `dispatchLeads` after job creation
- Modify: `app/api/admin/job-requests/[id]/route.ts` (if exists) — call on validate

- [ ] **Step 9.1: Trigger matching after job request submitted**

In `handleJobRequestSubmitted` in `job-request.ts`, after the `db.jobRequest.create` call:

```typescript
// Trigger matching in background (non-blocking)
const { dispatchLeads } = await import('../../matching-engine')
dispatchLeads(jobRequest.id)
  .then((result) => {
    if (result.noMatch) {
      console.log(`[job-request] No providers found for job ${jobRequest.id} — will retry via cron`)
    } else {
      console.log(`[job-request] Dispatched ${result.leadsDispatched} leads for job ${jobRequest.id}`)
    }
  })
  .catch((err) => console.error('[job-request] Matching dispatch error:', err))
```

Also update the JobRequest status to OPEN immediately on submission:
```typescript
// In db.jobRequest.create, set status: 'OPEN' instead of 'PENDING_VALIDATION'
status: 'OPEN',
```

- [ ] **Step 9.2: Update seed.ts if needed**

The seed uses `JobRequestStatus.OPEN` — verify the existing seed still works.

- [ ] **Step 9.3: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors

- [ ] **Step 9.4: Commit**

```bash
git add lib/whatsapp-flows/job-request.ts
git commit -m "feat(matching): trigger lead dispatch on job request submission"
```

---

## Task 10: Add Admin Alert Functions

**Purpose:** Ops needs to know about stuck cases.

**Files:**
- Modify: `lib/whatsapp.ts` — add admin notification helpers

- [ ] **Step 10.1: Add admin notification functions to whatsapp.ts**

Add to `lib/whatsapp.ts`:

```typescript
// ─── Admin Operations Alerts ──────────────────────────────────────────────────

export async function sendAdminNoMatch(params: {
  jobRequestId: string
  category: string
  area: string
  customerName: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendText(
    adminPhone,
    `⚠️ *No Match Found*\n\nJob: ${params.category}\nArea: ${params.area}\nCustomer: ${params.customerName}\nRef: ${params.jobRequestId.slice(-8).toUpperCase()}\n\nManual assignment needed:\n${appUrl}/admin/dispatch`
  )
}

export async function sendAdminProviderDropped(params: {
  providerName: string
  jobId: string
  category: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendText(
    adminPhone,
    `🚨 *Provider Dropped Job*\n\nProvider: ${params.providerName}\nJob: ${params.category}\nRef: ${params.jobId.slice(-8).toUpperCase()}\n\nReassignment needed:\n${appUrl}/admin/bookings`
  )
}

export async function sendAdminEscalation(params: {
  reason: string
  userPhone: string
  context: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return

  await sendText(
    adminPhone,
    `📣 *Escalation Alert*\n\nReason: ${params.reason}\nUser: ${params.userPhone}\nContext: ${params.context}\n\nPlease follow up directly.`
  )
}
```

- [ ] **Step 10.2: Commit**

```bash
git add lib/whatsapp.ts
git commit -m "feat(ops): add admin WhatsApp alert functions for no-match, drop, escalation"
```

---

## Task 11: Full Build, Test, Deploy

- [ ] **Step 11.1: Run full test suite**

```bash
cd /Users/shimane/Projects/Plug-A-Pro/field-service
npx jest --no-coverage 2>&1 | tail -20
```

Expected: All existing tests pass, new tests pass

- [ ] **Step 11.2: Type-check everything**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors

- [ ] **Step 11.3: Build**

```bash
npx next build 2>&1 | tail -20
```

Expected: Build succeeds

- [ ] **Step 11.4: Push to GitHub**

```bash
git push origin feat/marketing-mvp-refinement
```

- [ ] **Step 11.5: Deploy to production**

```bash
cd /Users/shimane/Projects/Plug-A-Pro && vercel --prod 2>&1 | tail -5
```

- [ ] **Step 11.6: Log to OpenBrain**

```bash
cd /Users/shimane/Projects/MobileApps/OpenBrain/backend && pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "engineering" \
  --title "feature — WhatsApp marketplace journeys full implementation (2026-03-31)" \
  --tags "whatsapp,provider,matching,flows" \
  --content "Implemented full WhatsApp marketplace journeys: (1) Fixed registration intro skip on 'I want to work' trigger, (2) Added provider_journey flow for availability toggle and job status updates via WhatsApp, (3) Built matching engine with skill+area filtering and idempotent lead dispatch, (4) Added universal back_home loop-back pattern from all flows, (5) Added 30-min matching cron with stale lead expiry, (6) Added admin alert functions for no-match/escalation. Key files: lib/whatsapp-flows/provider-journey.ts (new), lib/matching-engine.ts (new), app/api/cron/match-leads/route.ts (new)."
```

---

## Self-Review Checklist

| Spec Requirement | Task |
|---|---|
| Main menu as default root | ✅ Task 1 + existing fix |
| Both journeys first-class | ✅ Tasks 4 + 5 |
| Every step supports loop-back | ✅ Task 6 + 7 |
| Provider availability toggle | ✅ Task 4 |
| Provider job status via WA | ✅ Task 4 |
| Automatic matching | ✅ Tasks 5 + 9 |
| No-match escalation | ✅ Task 8 + 10 |
| Provider non-response handling | ✅ Task 5 (expireStaleLeads) + Task 8 |
| Admin visibility | ✅ Task 10 |
| Duplicate lead prevention | ✅ Task 5 (idempotency check) |
| Registration intro screen | ✅ Task 1 |
| Customer status updates on job moves | ✅ Task 4 (notifyCustomerStatusChange) |
| Tests | ✅ Tasks 4.1 + 5.1 |
| OpenBrain logging | ✅ Task 11.6 |
