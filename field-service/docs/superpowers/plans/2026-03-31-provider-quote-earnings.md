# Provider Quote & Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the provider journey by adding quote submission (WhatsApp 3-button offer → PWA form → client approval → auto-schedule) and an earnings/payouts dashboard.

**Architecture:** Provider gets a WhatsApp lead notification with 3 buttons (Accept & Quote / Inspect First / Decline). Accept sends a CTA link to `/technician/quotes/[matchId]` where the provider fills in a quote form. Submission notifies the client via WhatsApp with Accept/Decline buttons + a token-gated web fallback page at `/quotes/[token]`. Client approval creates a Booking and Job automatically. The earnings dashboard at `/technician/earnings` reads ProviderPayout records with 15% commission breakdown.

**Tech Stack:** Next.js 15 App Router, Prisma + Supabase PostgreSQL (via MCP `apply_migration`), WhatsApp Cloud API (`sendButtons` / `sendCtaUrl`), shadcn/ui, TypeScript

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `labourCost`, `materialsCost`, `estimatedHours`, `postInspection`, `approvalToken`, `preferredDate` to `Quote` |
| `lib/whatsapp-bot.ts` | Modify | `notifyProviderNewJob` → 3 buttons, add `match_accept/inspect/decline` routing |
| `app/api/technician/quotes/route.ts` | Create | POST — submit quote, generate approvalToken, notify client |
| `app/api/quotes/[token]/route.ts` | Create | GET — fetch quote; PATCH — approve/decline, create Booking+Job |
| `app/api/technician/earnings/route.ts` | Create | GET — earnings summary + history |
| `app/api/technician/earnings/statement/route.ts` | Create | GET — HTML print statement for a given month |
| `app/(technician)/technician/quotes/[matchId]/page.tsx` | Create | Quote submission form (server + client) |
| `app/(technician)/technician/earnings/page.tsx` | Create | Earnings dashboard |
| `app/(public)/quotes/[token]/page.tsx` | Create | Client quote approval (public, token-gated) |
| `app/(technician)/layout.tsx` | Modify | Add "Earnings" tab to bottom nav |

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Apply via: Supabase MCP `apply_migration`

- [ ] **Step 1: Update Quote model in schema.prisma**

In `prisma/schema.prisma`, replace the `Quote` model with:

```prisma
model Quote {
  id             String      @id @default(cuid())
  matchId        String
  amount         Decimal     @db.Decimal(10, 2)
  labourCost     Decimal     @db.Decimal(10, 2) @default(0)
  materialsCost  Decimal     @db.Decimal(10, 2) @default(0)
  estimatedHours Float?
  description    String
  validUntil     DateTime?
  preferredDate  DateTime?   // provider's suggested job date
  postInspection Boolean     @default(false)
  approvalToken  String?     @unique
  status         QuoteStatus @default(PENDING)
  approvedAt     DateTime?
  declinedAt     DateTime?
  notes          String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  match   Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  booking Booking?

  @@map("quotes")
}
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool with migration name `add_quote_fields` and SQL:

```sql
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "labour_cost"      DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "materials_cost"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "estimated_hours"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "preferred_date"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "post_inspection"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approval_token"   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_approval_token_key"
  ON "quotes"("approval_token")
  WHERE "approval_token" IS NOT NULL;
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add quote fields (labourCost, materialsCost, approvalToken, preferredDate)"
```

---

## Task 2: WhatsApp Lead Notification — 3-Button Offer

**Files:**
- Modify: `lib/whatsapp-bot.ts`

- [ ] **Step 1: Update `notifyProviderNewJob` signature and message**

In `lib/whatsapp-bot.ts`, replace the `notifyProviderNewJob` function:

```typescript
export async function notifyProviderNewJob(params: {
  providerPhone: string
  matchId: string          // Match.id — used for quote routing
  category: string
  area: string             // suburb/city for display
  description: string      // short job description
  customerInitial: string  // first name only
}): Promise<void> {
  const { sendButtons } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendButtons(
    params.providerPhone,
    `🔔 *New Job Lead*\n\n🔧 ${params.category}\n📍 ${params.area}\n📋 ${params.description}\n👤 Customer: ${params.customerInitial}\n\nHow would you like to proceed?`,
    [
      { id: `match_accept_${params.matchId}`, title: '✅ Accept & Quote' },
      { id: `match_inspect_${params.matchId}`, title: '🔍 Inspect First' },
      { id: `match_decline_${params.matchId}`, title: '❌ Decline' },
    ],
    { footer: `Lead ref: ${params.matchId.slice(-8).toUpperCase()}` }
  )
}
```

- [ ] **Step 2: Add match button routing in `processInboundMessage`**

In `lib/whatsapp-bot.ts`, find the block that routes `reply.id?.startsWith('view_job_')` and add above it:

```typescript
// ── Match-level lead responses (quote flow) ─────────────────────────────
if (
  reply.id?.startsWith('match_accept_') ||
  reply.id?.startsWith('match_inspect_') ||
  reply.id?.startsWith('match_decline_')
) {
  await handleMatchLeadResponse(phone, reply.id)
  return
}
```

- [ ] **Step 3: Add `handleMatchLeadResponse` function**

Add this function before `handleProviderJobFlow` in `lib/whatsapp-bot.ts`:

```typescript
async function handleMatchLeadResponse(phone: string, buttonId: string): Promise<void> {
  const { sendButtons, sendCtaUrl, sendText } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const matchId = buttonId
    .replace('match_accept_', '')
    .replace('match_inspect_', '')
    .replace('match_decline_', '')

  // Verify provider owns this match
  const provider = await db.provider.findUnique({ where: { phone } })
  if (!provider) {
    await sendText(phone, "You're not registered as a provider.")
    return
  }

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { jobRequest: { include: { address: true } } },
  })

  if (!match || match.providerId !== provider.id) {
    await sendText(phone, '⚠️ This lead is no longer available.')
    return
  }

  const quoteUrl = `${appUrl}/technician/quotes/${matchId}`

  if (buttonId.startsWith('match_accept_')) {
    // Provider ready to quote immediately
    await sendCtaUrl(
      phone,
      `✅ *Great! Submit your quote here:*\n\nInclude your labour cost, any materials, and estimated time.`,
      'Submit Quote',
      quoteUrl,
      { footer: 'Quote will be sent to the customer for approval' }
    )
    return
  }

  if (buttonId.startsWith('match_inspect_')) {
    // Provider needs to visit site first
    await db.match.update({
      where: { id: matchId },
      data: { inspectionNeeded: true, status: 'INSPECTION_SCHEDULED' },
    })
    await sendCtaUrl(
      phone,
      `🔍 *Inspection noted.*\n\nVisit the customer to assess the job, then submit your quote:`,
      'Submit Quote After Inspection',
      quoteUrl,
      { footer: 'Contact the customer to arrange the inspection time' }
    )
    return
  }

  if (buttonId.startsWith('match_decline_')) {
    // Show decline reason buttons
    await sendButtons(
      phone,
      '❌ *Decline Lead*\n\nWhy are you declining?',
      [
        { id: `mdc_unavailable_${matchId}`, title: '📅 Not available' },
        { id: `mdc_area_${matchId}`, title: '📍 Too far' },
        { id: `mdc_other_${matchId}`, title: '✏️ Other reason' },
      ]
    )
    return
  }
}
```

- [ ] **Step 4: Add match decline reason handler in `processInboundMessage`**

Add the `mdc_*` handler directly above the `match_accept/inspect/decline` block you just added (so it is checked first):

```typescript
// ── Match decline reason responses ──────────────────────────────────────
if (reply.id?.startsWith('mdc_')) {
  const matchId = reply.id.replace(/^mdc_(unavailable|area|other)_/, '')
  const reasonMap: Record<string, string> = {
    [`mdc_unavailable_${matchId}`]: 'Not available',
    [`mdc_area_${matchId}`]: 'Too far',
    [`mdc_other_${matchId}`]: 'Other',
  }
  const reason = reasonMap[reply.id] ?? 'Declined'

  // Mark the lead as declined
  const provider = await db.provider.findUnique({ where: { phone } })
  if (provider) {
    await db.lead.updateMany({
      where: { jobRequestId: (await db.match.findUnique({ where: { id: matchId } }))?.jobRequestId ?? '', providerId: provider.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    })
    await db.match.update({
      where: { id: matchId },
      data: { status: 'CANCELLED' },
    }).catch(() => {}) // ignore if match not found
  }

  const { sendText } = await import('./whatsapp-interactive')
  await sendText(phone, `Got it — lead declined (${reason}). We'll find another provider. 👍`)
  return
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to whatsapp-bot.ts.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp-bot.ts
git commit -m "feat: WhatsApp 3-button job lead offer (Accept & Quote / Inspect First / Decline)"
```

---

## Task 3: Quote Submission API

**Files:**
- Create: `app/api/technician/quotes/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// POST /api/technician/quotes
// Body: { matchId, labourCost, materialsCost?, description, estimatedHours?, validForHours, preferredDate?, postInspection? }
// Creates a Quote linked to the Match and sends WhatsApp notification to the client.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { sendQuoteToClient } from '@/lib/whatsapp-bot'

const VALID_FOR_OPTIONS: Record<string, number> = {
  '24h': 24, '48h': 48, '72h': 72, '1w': 168,
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    matchId?: string
    labourCost?: number
    materialsCost?: number
    description?: string
    estimatedHours?: number
    validFor?: string         // '24h' | '48h' | '72h' | '1w'
    preferredDate?: string    // ISO date string
    postInspection?: boolean
  }

  const { matchId, labourCost, materialsCost = 0, description, estimatedHours, validFor = '48h', preferredDate, postInspection = false } = body

  if (!matchId || !labourCost || labourCost <= 0 || !description || description.length < 10) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const hours = VALID_FOR_OPTIONS[validFor] ?? 48
  const validUntil = new Date(Date.now() + hours * 60 * 60 * 1000)

  // Verify this provider owns the match
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: {
        include: {
          customer: { select: { phone: true, name: true } },
        },
      },
    },
  })

  if (!match || match.providerId !== provider.id) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  if (!['MATCHED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETE'].includes(match.status)) {
    return NextResponse.json({ error: 'Quote already submitted for this match' }, { status: 409 })
  }

  // Check for existing quote (idempotent)
  const existing = await db.quote.findFirst({ where: { matchId } })
  if (existing) {
    return NextResponse.json({ quoteId: existing.id, alreadySubmitted: true })
  }

  const totalAmount = labourCost + materialsCost
  const approvalToken = `${matchId.slice(-12)}-${Date.now().toString(36)}`

  const quote = await db.quote.create({
    data: {
      matchId,
      amount: totalAmount,
      labourCost,
      materialsCost,
      estimatedHours: estimatedHours ?? null,
      description,
      validUntil,
      preferredDate: preferredDate ? new Date(preferredDate) : null,
      postInspection,
      approvalToken,
      status: 'PENDING',
    },
  })

  await db.match.update({
    where: { id: matchId },
    data: { status: 'QUOTED' },
  })

  // Notify client via WhatsApp (non-blocking)
  const customerPhone = match.jobRequest.customer.phone
  if (customerPhone) {
    sendQuoteToClient({
      customerPhone,
      providerName: provider.name,
      quoteId: quote.id,
      labourCost,
      materialsCost,
      totalAmount,
      description,
      estimatedHours: estimatedHours ?? null,
      validUntil,
      approvalToken,
    }).catch((err: unknown) => {
      console.error('[quotes] Failed to send WhatsApp quote notification:', err)
    })
  }

  return NextResponse.json({ quoteId: quote.id })
}
```

- [ ] **Step 2: Add `sendQuoteToClient` stub so TypeScript passes before Task 7**

Add this stub to `lib/whatsapp-bot.ts` immediately after `notifyProviderApplicationResult`. It will be replaced with the real implementation in Task 7:

```typescript
// Stub — full implementation in Task 7
export async function sendQuoteToClient(_params: {
  customerPhone: string; providerName: string; quoteId: string
  labourCost: number; materialsCost: number; totalAmount: number
  description: string; estimatedHours: number | null
  validUntil: Date; approvalToken: string
}): Promise<void> {
  // implemented in Task 7
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "api/technician/quotes" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/technician/quotes/route.ts lib/whatsapp-bot.ts
git commit -m "feat: add POST /api/technician/quotes — submit quote, notify client"
```

---

## Task 4: Quote Submission PWA

**Files:**
- Create: `app/(technician)/technician/quotes/[matchId]/page.tsx`
- Create: `components/technician/QuoteForm.tsx`

- [ ] **Step 1: Create the QuoteForm client component**

Create `components/technician/QuoteForm.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

interface QuoteFormProps {
  matchId: string
  postInspection?: boolean
  category: string
  area: string
  description: string
}

export function QuoteForm({ matchId, postInspection: preChecked = false, category, area, description }: QuoteFormProps) {
  const router = useRouter()
  const [labourCost, setLabourCost] = useState('')
  const [materialsCost, setMaterialsCost] = useState('')
  const [desc, setDesc] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [validFor, setValidFor] = useState('48h')
  const [preferredDate, setPreferredDate] = useState('')
  const [isInspection, setIsInspection] = useState(preChecked)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const labour = parseFloat(labourCost) || 0
  const materials = parseFloat(materialsCost) || 0
  const total = labour + materials

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (labour <= 0) { setError('Labour cost is required'); return }
    if (desc.trim().length < 10) { setError('Description must be at least 10 characters'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/technician/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          labourCost: labour,
          materialsCost: materials,
          description: desc.trim(),
          estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
          validFor,
          preferredDate: preferredDate || undefined,
          postInspection: isInspection,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Failed to submit quote')
      }

      router.push('/technician?quote=sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Job summary (read-only) */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-1">
        <p className="text-sm font-medium">{category}</p>
        <p className="text-xs text-muted-foreground">{area}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
      </div>

      {/* Inspection banner */}
      {preChecked && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 px-4 py-3">
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            You marked this as needing an inspection. Submit your quote once you've assessed the site.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="labour">Labour cost (R) *</Label>
            <Input
              id="labour"
              type="number"
              min="1"
              step="0.01"
              placeholder="0.00"
              value={labourCost}
              onChange={(e) => setLabourCost(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="materials">Materials (R)</Label>
            <Input
              id="materials"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={materialsCost}
              onChange={(e) => setMaterialsCost(e.target.value)}
            />
          </div>
        </div>

        {total > 0 && (
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">R {total.toFixed(2)}</span>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="desc">Scope of work *</Label>
          <Textarea
            id="desc"
            placeholder="Describe what is included in your quote..."
            rows={4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            required
            minLength={10}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="hours">Estimated hours</Label>
            <Input
              id="hours"
              type="number"
              min="0.5"
              step="0.5"
              placeholder="e.g. 2"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="validFor">Quote valid for</Label>
            <Select value={validFor} onValueChange={setValidFor}>
              <SelectTrigger id="validFor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 hours</SelectItem>
                <SelectItem value="48h">48 hours</SelectItem>
                <SelectItem value="72h">72 hours</SelectItem>
                <SelectItem value="1w">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="preferredDate">Preferred job date</Label>
          <Input
            id="preferredDate"
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
        </div>

        {!preChecked && (
          <div className="flex items-start gap-3">
            <Checkbox
              id="inspection"
              checked={isInspection}
              onCheckedChange={(v) => setIsInspection(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="inspection" className="text-sm leading-snug cursor-pointer">
              I need to inspect the site before finalising this quote
            </Label>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Quote to Client'}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create the quote page (server component)**

Create `app/(technician)/technician/quotes/[matchId]/page.tsx`:

```typescript
// Provider: Submit quote for a matched job
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { QuoteForm } from '@/components/technician/QuoteForm'

export const metadata = buildMetadata({ title: 'Submit Quote', noIndex: true })

export default async function QuotePage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const session = await requireProvider()
  const { matchId } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: { include: { address: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  if (!match || match.providerId !== provider.id) notFound()

  // Already quoted — redirect to jobs
  if (match.quotes.length > 0 && match.status === 'QUOTED') {
    redirect('/technician?quote=already-sent')
  }

  const jobRequest = match.jobRequest
  const addr = jobRequest.address
  const area = addr ? `${addr.suburb}, ${addr.city ?? addr.state}` : 'Location in app'

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div>
        <h1 className="text-xl font-semibold">Submit Quote</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This quote will be sent to the customer for approval.
        </p>
      </div>

      <QuoteForm
        matchId={matchId}
        postInspection={match.inspectionNeeded}
        category={jobRequest.category}
        area={area}
        description={jobRequest.description}
      />
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "quotes|QuoteForm" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/\(technician\)/technician/quotes/ components/technician/QuoteForm.tsx
git commit -m "feat: provider quote submission PWA (/technician/quotes/[matchId])"
```

---

## Task 5: Client Approval API

**Files:**
- Create: `app/api/quotes/[token]/route.ts`

- [ ] **Step 1: Create the approval API**

```typescript
// GET  /api/quotes/[token]  — fetch quote details for the approval page
// PATCH /api/quotes/[token] — body: { action: 'approve' | 'decline' }
//   approve: creates Booking + Job, notifies both parties
//   decline: marks quote declined, notifies provider

import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const quote = await db.quote.findUnique({
    where: { approvalToken: token },
    include: {
      match: {
        include: {
          provider: { select: { name: true } },
          jobRequest: {
            include: { address: true },
          },
        },
      },
    },
  })

  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: quote.id,
    status: quote.status,
    providerName: quote.match.provider.name,
    labourCost: Number(quote.labourCost),
    materialsCost: Number(quote.materialsCost),
    totalAmount: Number(quote.amount),
    description: quote.description,
    estimatedHours: quote.estimatedHours,
    validUntil: quote.validUntil?.toISOString() ?? null,
    preferredDate: quote.preferredDate?.toISOString() ?? null,
    category: quote.match.jobRequest.category,
    area: quote.match.jobRequest.address?.suburb ?? null,
    expired: quote.validUntil ? new Date() > quote.validUntil : false,
  })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { token } = await params
  const body = await request.json().catch(() => ({})) as { action?: string }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Transaction: idempotency-safe status check + update
  const result = await db.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { approvalToken: token },
      include: {
        match: {
          include: {
            provider: { select: { id: true, phone: true, name: true } },
            jobRequest: {
              include: {
                customer: { select: { id: true, phone: true, name: true } },
                address: true,
              },
            },
          },
        },
      },
    })

    if (!quote) throw new Error('NOT_FOUND')
    if (quote.status !== 'PENDING') throw new Error('ALREADY_ACTIONED')
    if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

    if (body.action === 'decline') {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'DECLINED', declinedAt: new Date() },
      })
      await tx.match.update({
        where: { id: quote.matchId },
        data: { status: 'QUOTE_DECLINED' },
      })
      return { action: 'declined', quote }
    }

    // Approve: create Booking + Job
    await tx.quote.update({
      where: { id: quote.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    })
    await tx.match.update({
      where: { id: quote.matchId },
      data: { status: 'QUOTE_APPROVED' },
    })
    await tx.jobRequest.update({
      where: { id: quote.match.jobRequestId },
      data: { status: 'MATCHED' },
    })

    const scheduledDate = quote.preferredDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000)

    const booking = await tx.booking.create({
      data: {
        matchId: quote.matchId,
        quoteId: quote.id,
        status: 'SCHEDULED',
        scheduledDate,
        scheduledWindow: null,
        notes: null,
      },
    })

    const job = await tx.job.create({
      data: {
        bookingId: booking.id,
        providerId: quote.match.provider.id,
        status: 'SCHEDULED',
      },
    })

    return { action: 'approved', quote, booking, job }
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    return { error: msg }
  })

  if ('error' in result) {
    const status =
      result.error === 'NOT_FOUND' ? 404 :
      result.error === 'ALREADY_ACTIONED' ? 409 :
      result.error === 'EXPIRED' ? 410 : 422
    return NextResponse.json({ error: result.error }, { status })
  }

  // Notify both parties (non-blocking, after response)
  notifyAfterDecision(result).catch(() => {})

  return NextResponse.json({ status: result.action })
}

async function notifyAfterDecision(result: {
  action: string
  quote: {
    match: {
      provider: { phone: string; name: string }
      jobRequest: { customer: { phone: string; name: string }; category: string }
    }
  }
  booking?: { scheduledDate: Date }
}) {
  const { sendText, sendCtaUrl } = await import('@/lib/whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const providerPhone = result.quote.match.provider.phone
  const customerPhone = result.quote.match.jobRequest.customer.phone
  const category = result.quote.match.jobRequest.category

  if (result.action === 'approved' && result.booking) {
    const dateStr = result.booking.scheduledDate.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    // Notify provider
    await sendCtaUrl(
      providerPhone,
      `✅ *Quote Approved!*\n\n${category} job is confirmed for ${dateStr}.\n\nOpen the app to view full details:`,
      'View Job',
      `${appUrl}/technician`,
      { footer: 'Navigate and update job status from the app' }
    ).catch(() => {})
    // Notify customer
    await sendText(
      customerPhone,
      `✅ *Booking Confirmed!*\n\n${result.quote.match.provider.name} will arrive on ${dateStr}.\n\nYou'll receive a reminder the day before.`
    ).catch(() => {})
  } else {
    // Declined — notify provider
    await sendText(
      providerPhone,
      `❌ The customer declined your quote for the ${category} job. The lead has been returned to the queue.`
    ).catch(() => {})
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "api/quotes" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/quotes/
git commit -m "feat: add GET/PATCH /api/quotes/[token] — client approval creates Booking+Job"
```

---

## Task 6: Client Quote Approval Page

**Files:**
- Create: `app/(public)/quotes/[token]/page.tsx` (note: check if `(public)` route group exists, else use `app/quotes/[token]/page.tsx`)

- [ ] **Step 1: Check if (public) route group exists**

```bash
ls /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/ | grep public
```

If `(public)` does not exist, create the page at `app/quotes/[token]/page.tsx` directly.

- [ ] **Step 2: Create the client approval page**

Create `app/quotes/[token]/page.tsx` (or `app/(public)/quotes/[token]/page.tsx` if group exists):

```typescript
// Client quote approval page — public, no auth required
// Token is a unique per-quote identifier

import { notFound } from 'next/navigation'
import { QuoteApproval } from '@/components/quotes/QuoteApproval'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Review Quote', noIndex: true })
export const dynamic = 'force-dynamic'

interface QuoteData {
  id: string
  status: string
  providerName: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: string | null
  preferredDate: string | null
  category: string
  area: string | null
  expired: boolean
}

export default async function QuoteApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const res = await fetch(`${appUrl}/api/quotes/${token}`, { cache: 'no-store' })
  if (!res.ok) notFound()

  const quote = await res.json() as QuoteData

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Quote from {quote.providerName}</h1>
          <p className="text-sm text-muted-foreground mt-1">{quote.category}{quote.area ? ` · ${quote.area}` : ''}</p>
        </div>

        <QuoteApproval quote={quote} token={token} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create QuoteApproval client component**

Create `components/quotes/QuoteApproval.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface Quote {
  id: string
  status: string
  providerName: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: string | null
  preferredDate: string | null
  expired: boolean
}

export function QuoteApproval({ quote, token }: { quote: Quote; token: string }) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [result, setResult] = useState<'approved' | 'declined' | null>(null)
  const [error, setError] = useState('')

  if (quote.status === 'APPROVED' || result === 'approved') {
    return (
      <div className="rounded-lg border bg-green-50 dark:bg-green-950 p-6 text-center space-y-2">
        <p className="text-2xl">✅</p>
        <p className="font-semibold">Quote Accepted</p>
        <p className="text-sm text-muted-foreground">
          {quote.providerName} has been notified. You'll receive a confirmation message on WhatsApp.
        </p>
      </div>
    )
  }

  if (quote.status === 'DECLINED' || result === 'declined') {
    return (
      <div className="rounded-lg border p-6 text-center space-y-2">
        <p className="text-2xl">❌</p>
        <p className="font-semibold">Quote Declined</p>
        <p className="text-sm text-muted-foreground">We've notified the provider. We'll find you another option.</p>
      </div>
    )
  }

  if (quote.expired || quote.status === 'EXPIRED') {
    return (
      <div className="rounded-lg border p-6 text-center space-y-2">
        <p className="text-2xl">⏱️</p>
        <p className="font-semibold">Quote Expired</p>
        <p className="text-sm text-muted-foreground">
          This quote expired on {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('en-ZA') : 'an earlier date'}.
          Please contact {quote.providerName} to request a new one.
        </p>
      </div>
    )
  }

  async function respond(action: 'approve' | 'decline') {
    setStatus('submitting')
    setError('')
    try {
      const res = await fetch(`/api/quotes/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (data.error === 'ALREADY_ACTIONED') {
          setResult(action === 'approve' ? 'approved' : 'declined')
          return
        }
        throw new Error(data.error ?? 'Something went wrong')
      }
      setResult(action === 'approve' ? 'approved' : 'declined')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatus('idle')
    }
  }

  const fmt = (v: number) => `R ${v.toFixed(2)}`

  return (
    <div className="space-y-5">
      {/* Cost breakdown */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Labour</span>
          <span>{fmt(quote.labourCost)}</span>
        </div>
        {quote.materialsCost > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Materials</span>
            <span>{fmt(quote.materialsCost)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>{fmt(quote.totalAmount)}</span>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground font-medium">Scope of work</p>
        <p>{quote.description}</p>
      </div>

      {(quote.estimatedHours || quote.preferredDate || quote.validUntil) && (
        <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-sm">
          {quote.estimatedHours && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated time</span>
              <span>{quote.estimatedHours}h</span>
            </div>
          )}
          {quote.preferredDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Suggested date</span>
              <span>{new Date(quote.preferredDate).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </div>
          )}
          {quote.validUntil && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valid until</span>
              <span>{new Date(quote.validUntil).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={status === 'submitting'}
          onClick={() => respond('decline')}
        >
          Decline
        </Button>
        <Button
          className="flex-1"
          disabled={status === 'submitting'}
          onClick={() => respond('approve')}
        >
          {status === 'submitting' ? 'Processing…' : 'Accept Quote'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "quotes/\[token\]|QuoteApproval" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/quotes/ components/quotes/
git commit -m "feat: client quote approval page (/quotes/[token]) + QuoteApproval component"
```

---

## Task 7: WhatsApp Quote Notification + Client Response Handlers

**Files:**
- Modify: `lib/whatsapp-bot.ts`

- [ ] **Step 1: Add `sendQuoteToClient` export function**

Add this export function to `lib/whatsapp-bot.ts` (after `notifyProviderApplicationResult`):

```typescript
export async function sendQuoteToClient(params: {
  customerPhone: string
  providerName: string
  quoteId: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: Date
  approvalToken: string
}): Promise<void> {
  const { sendButtons } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const webLink = `${appUrl}/quotes/${params.approvalToken}`

  const materialsLine = params.materialsCost > 0
    ? `\nMaterials:  R ${params.materialsCost.toFixed(2)}`
    : ''
  const hoursLine = params.estimatedHours ? `\nEst. time:  ${params.estimatedHours}h` : ''
  const validLine = `\nValid until: ${params.validUntil.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`

  await sendButtons(
    params.customerPhone,
    `💼 *Quote from ${params.providerName}*\n\nLabour:     R ${params.labourCost.toFixed(2)}${materialsLine}\n──────────────────\nTotal:      R ${params.totalAmount.toFixed(2)}${hoursLine}${validLine}\n\n📋 ${params.description}\n\nOr review online:\n${webLink}`,
    [
      { id: `quote_accept_${params.quoteId}`, title: '✅ Accept Quote' },
      { id: `quote_decline_${params.quoteId}`, title: '❌ Decline' },
    ]
  )
}
```

- [ ] **Step 2: Add quote button routing in `processInboundMessage`**

In `lib/whatsapp-bot.ts`, add the following block in `processInboundMessage` — add it near the other button ID routing, alongside the `match_*` routing:

```typescript
// ── Quote response buttons (customer accepting/declining a provider quote) ───
if (reply.id?.startsWith('quote_accept_') || reply.id?.startsWith('quote_decline_')) {
  await handleCustomerQuoteResponse(phone, reply.id)
  return
}
```

- [ ] **Step 3: Add `handleCustomerQuoteResponse` function**

Add this function after `handleMatchLeadResponse`:

```typescript
async function handleCustomerQuoteResponse(phone: string, buttonId: string): Promise<void> {
  const { sendText } = await import('./whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const quoteId = buttonId.replace('quote_accept_', '').replace('quote_decline_', '')
  const action = buttonId.startsWith('quote_accept_') ? 'approve' : 'decline'

  // Delegate to the approval API (reuses the transaction + notify logic)
  const res = await fetch(`${appUrl}/api/quotes/internal/${quoteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    body: JSON.stringify({ action }),
  }).catch(() => null)

  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) as { error?: string } : {}
    if (data.error === 'ALREADY_ACTIONED') {
      await sendText(phone, action === 'approve'
        ? "✅ You've already accepted this quote."
        : "❌ You've already declined this quote.")
      return
    }
    if (data.error === 'EXPIRED') {
      await sendText(phone, "⏱️ This quote has expired. Please ask the provider to send a new one.")
      return
    }
    await sendText(phone, "Something went wrong processing your response. Please try the link in the original message.")
    return
  }

  if (action === 'approve') {
    await sendText(phone, "✅ *Quote accepted!* The provider has been notified and will confirm the booking. You'll receive a reminder before the job.")
  } else {
    await sendText(phone, "❌ *Quote declined.* We've notified the provider. We'll find you another option.")
  }
}
```

- [ ] **Step 4: Add internal quote approval API route**

The WhatsApp bot runs server-side so it can call the DB directly instead of HTTP. Replace the `fetch` call approach with a direct DB call:

Replace the `handleCustomerQuoteResponse` function body with:

```typescript
async function handleCustomerQuoteResponse(phone: string, buttonId: string): Promise<void> {
  const { sendText } = await import('./whatsapp-interactive')

  const quoteId = buttonId.replace('quote_accept_', '').replace('quote_decline_', '')
  const action = buttonId.startsWith('quote_accept_') ? 'approve' : 'decline'

  try {
    const result = await db.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: quoteId },
        include: {
          match: {
            include: {
              provider: { select: { id: true, phone: true, name: true } },
              jobRequest: {
                include: {
                  customer: { select: { id: true, phone: true, name: true } },
                },
              },
            },
          },
        },
      })

      if (!quote) throw new Error('NOT_FOUND')
      if (quote.status !== 'PENDING') throw new Error('ALREADY_ACTIONED')
      if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

      if (action === 'decline') {
        await tx.quote.update({ where: { id: quoteId }, data: { status: 'DECLINED', declinedAt: new Date() } })
        await tx.match.update({ where: { id: quote.matchId }, data: { status: 'QUOTE_DECLINED' } })
        return { action: 'declined', providerPhone: quote.match.provider.phone, category: quote.match.jobRequest.category }
      }

      await tx.quote.update({ where: { id: quoteId }, data: { status: 'APPROVED', approvedAt: new Date() } })
      await tx.match.update({ where: { id: quote.matchId }, data: { status: 'QUOTE_APPROVED' } })
      await tx.jobRequest.update({ where: { id: quote.match.jobRequestId }, data: { status: 'MATCHED' } })

      const scheduledDate = quote.preferredDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000)
      const booking = await tx.booking.create({
        data: { matchId: quote.matchId, quoteId: quote.id, status: 'SCHEDULED', scheduledDate },
      })
      await tx.job.create({
        data: { bookingId: booking.id, providerId: quote.match.provider.id, status: 'SCHEDULED' },
      })

      return {
        action: 'approved',
        providerPhone: quote.match.provider.phone,
        category: quote.match.jobRequest.category,
        scheduledDate,
        providerName: quote.match.provider.name,
      }
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (result.action === 'approved' && 'scheduledDate' in result) {
      const dateStr = result.scheduledDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
      const { sendCtaUrl } = await import('./whatsapp-interactive')
      await sendCtaUrl(result.providerPhone, `✅ *Quote Approved!*\n\n${result.category} job confirmed for ${dateStr}.`, 'View Job', `${appUrl}/technician`).catch(() => {})
      await sendText(phone, `✅ *Booking Confirmed!*\n\n${result.providerName} will arrive on ${dateStr}. You'll receive a reminder the day before.`)
    } else {
      await sendText(result.providerPhone, `❌ The customer declined your quote for the ${result.category} job.`).catch(() => {})
      await sendText(phone, "❌ *Quote declined.* We've notified the provider. We'll find you another option.")
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    if (msg === 'ALREADY_ACTIONED') {
      await sendText(phone, action === 'approve' ? "✅ You've already accepted this quote." : "❌ You've already declined this quote.")
    } else if (msg === 'EXPIRED') {
      await sendText(phone, "⏱️ This quote has expired. Please ask the provider to send a new one.")
    } else {
      await sendText(phone, "Something went wrong. Please try the link in the original message.")
    }
  }
}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "whatsapp-bot" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp-bot.ts
git commit -m "feat: WhatsApp quote notification to client + accept/decline response handlers"
```

---

## Task 8: Earnings API

**Files:**
- Create: `app/api/technician/earnings/route.ts`
- Create: `app/api/technician/earnings/statement/route.ts`

- [ ] **Step 1: Create the earnings API**

Create `app/api/technician/earnings/route.ts`:

```typescript
// GET /api/technician/earnings
// Returns current month summary + job breakdown + historical monthly totals.
// Commission is always 15% (0.15) applied to grossAmount on ProviderPayout.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(_request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 403 })

  // Current month date range
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  // All time payouts for history
  const allPayouts = await db.providerPayout.findMany({
    where: { providerId: provider.id },
    include: {
      job: {
        include: {
          booking: {
            include: {
              match: { include: { jobRequest: { include: { address: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const currentPayouts = allPayouts.filter(
    (p) => p.createdAt >= monthStart && p.createdAt <= monthEnd
  )

  const sum = (payouts: typeof allPayouts, field: 'grossAmount' | 'commissionAmt' | 'netAmount') =>
    payouts.reduce((acc, p) => acc + Number(p[field]), 0)

  const currentMonthJobs = currentPayouts.map((p) => {
    const req = p.job.booking.match.jobRequest
    return {
      id: p.job.id,
      category: req.category,
      area: req.address?.suburb ?? 'Unknown',
      completedAt: p.job.completedAt?.toISOString() ?? p.createdAt.toISOString(),
      gross: Number(p.grossAmount),
      net: Number(p.netAmount),
    }
  })

  // Group history by month
  const historyMap = new Map<string, { gross: number; net: number; paid: boolean; payoutId: string | null }>()
  for (const p of allPayouts) {
    const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`
    const existing = historyMap.get(key)
    if (!existing) {
      historyMap.set(key, {
        gross: Number(p.grossAmount),
        net: Number(p.netAmount),
        paid: p.status === 'PAID',
        payoutId: p.id,
      })
    } else {
      existing.gross += Number(p.grossAmount)
      existing.net += Number(p.netAmount)
      if (p.status !== 'PAID') existing.paid = false
    }
  }

  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const history = [...historyMap.entries()]
    .filter(([k]) => k !== currentMonthKey)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, data]) => ({ month, ...data }))

  const pending = currentPayouts
    .filter((p) => p.status !== 'PAID')
    .reduce((acc, p) => acc + Number(p.netAmount), 0)
  const paid = currentPayouts
    .filter((p) => p.status === 'PAID')
    .reduce((acc, p) => acc + Number(p.netAmount), 0)

  return NextResponse.json({
    currentMonth: {
      gross: sum(currentPayouts, 'grossAmount'),
      commission: sum(currentPayouts, 'commissionAmt'),
      net: sum(currentPayouts, 'netAmount'),
      pending,
      paid,
      jobs: currentMonthJobs,
    },
    history,
  })
}
```

- [ ] **Step 2: Create the statement route**

Create `app/api/technician/earnings/statement/route.ts`:

```typescript
// GET /api/technician/earnings/statement?month=2026-02
// Returns an HTML document with print stylesheet for saving as PDF.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) return new NextResponse('Forbidden', { status: 403 })

  const month = request.nextUrl.searchParams.get('month') // '2026-02'
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse('Invalid month', { status: 400 })
  }

  const [year, mon] = month.split('-').map(Number)
  const start = new Date(year, mon - 1, 1)
  const end = new Date(year, mon, 0, 23, 59, 59, 999)

  const payouts = await db.providerPayout.findMany({
    where: { providerId: provider.id, createdAt: { gte: start, lte: end } },
    include: {
      job: {
        include: {
          booking: {
            include: {
              match: { include: { jobRequest: { include: { address: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const gross = payouts.reduce((a, p) => a + Number(p.grossAmount), 0)
  const commission = payouts.reduce((a, p) => a + Number(p.commissionAmt), 0)
  const net = payouts.reduce((a, p) => a + Number(p.netAmount), 0)
  const monthLabel = start.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

  const rows = payouts.map((p) => {
    const req = p.job.booking.match.jobRequest
    const date = (p.job.completedAt ?? p.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
    return `
      <tr>
        <td>${date}</td>
        <td>${req.category}</td>
        <td>${req.address?.suburb ?? '-'}</td>
        <td>R ${Number(p.grossAmount).toFixed(2)}</td>
        <td>R ${Number(p.commissionAmt).toFixed(2)}</td>
        <td>R ${Number(p.netAmount).toFixed(2)}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Earnings Statement — ${monthLabel}</title>
  <style>
    body { font-family: sans-serif; font-size: 13px; color: #111; padding: 32px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; border-bottom: 2px solid #ddd; padding: 6px 8px; font-size: 12px; text-transform: uppercase; color: #666; }
    td { border-bottom: 1px solid #eee; padding: 6px 8px; }
    .summary { margin-top: 24px; padding: 16px; background: #f5f5f5; border-radius: 8px; }
    .summary table { margin-top: 0; }
    .summary td:last-child { text-align: right; font-weight: 600; }
    .total td { font-weight: 700; border-top: 2px solid #ddd; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Plug a Pro</h1>
  <p class="subtitle">Earnings Statement — ${monthLabel} · ${provider.name}</p>

  <table>
    <thead>
      <tr><th>Date</th><th>Category</th><th>Area</th><th>Gross</th><th>Commission</th><th>Net</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px">No jobs this month</td></tr>'}</tbody>
  </table>

  <div class="summary">
    <table>
      <tr><td>Gross earnings</td><td>R ${gross.toFixed(2)}</td></tr>
      <tr><td>Commission (15%)</td><td>−R ${commission.toFixed(2)}</td></tr>
      <tr class="total"><td>Net payout</td><td>R ${net.toFixed(2)}</td></tr>
    </table>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "earnings" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/technician/earnings/
git commit -m "feat: add GET /api/technician/earnings + /statement — earnings data and HTML print statement"
```

---

## Task 9: Earnings Dashboard PWA + Nav Update

**Files:**
- Create: `app/(technician)/technician/earnings/page.tsx`
- Modify: `app/(technician)/layout.tsx`

- [ ] **Step 1: Create the earnings page**

Create `app/(technician)/technician/earnings/page.tsx`:

```typescript
// Provider: Earnings dashboard
// Current month summary + job breakdown + history with print statements.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { EarningsDashboard } from '@/components/technician/EarningsDashboard'

export const metadata = buildMetadata({ title: 'Earnings', noIndex: true })

interface EarningsData {
  currentMonth: {
    gross: number
    commission: number
    net: number
    pending: number
    paid: number
    jobs: { id: string; category: string; area: string; completedAt: string; gross: number; net: number }[]
  }
  history: { month: string; gross: number; net: number; paid: boolean; payoutId: string | null }[]
}

export default async function EarningsPage() {
  const session = await requireProvider()
  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/technician/earnings`, {
    headers: { Cookie: `session=${session.id}` }, // forwarded for auth
    cache: 'no-store',
  })

  // Fall back to empty state on error
  const data: EarningsData = res.ok ? await res.json() as EarningsData : {
    currentMonth: { gross: 0, commission: 0, net: 0, pending: 0, paid: 0, jobs: [] },
    history: [],
  }

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div className="flex items-center gap-2">
        <Link href="/technician" className="text-xs text-muted-foreground hover:text-foreground">← Jobs</Link>
        <h1 className="text-xl font-semibold">Earnings</h1>
      </div>
      <EarningsDashboard data={data} />
    </div>
  )
}
```

- [ ] **Step 2: Create the EarningsDashboard client component**

Create `components/technician/EarningsDashboard.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface EarningsData {
  currentMonth: {
    gross: number
    commission: number
    net: number
    pending: number
    paid: number
    jobs: { id: string; category: string; area: string; completedAt: string; gross: number; net: number }[]
  }
  history: { month: string; gross: number; net: number; paid: boolean; payoutId: string | null }[]
}

const fmt = (v: number) => `R ${v.toFixed(2)}`

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function currentMonthLabel() {
  return new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

export function EarningsDashboard({ data }: { data: EarningsData }) {
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const { currentMonth, history } = data

  return (
    <div className="space-y-5">
      {/* Current month summary */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{currentMonthLabel()}</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross earned</span>
              <span>{fmt(currentMonth.gross)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>Commission (15%)</span>
              <span>−{fmt(currentMonth.commission)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold text-base">
              <span>Net payout</span>
              <span>{fmt(currentMonth.net)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pending</span>
              <span>{fmt(currentMonth.pending)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Paid out</span>
              <span>{fmt(currentMonth.paid)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* This month's jobs */}
      {currentMonth.jobs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jobs this month</p>
          <div className="space-y-1">
            {currentMonth.jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                <div>
                  <p className="font-medium">{job.category}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.area} · {new Date(job.completedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{fmt(job.net)}</p>
                  <p className="text-xs text-muted-foreground">{fmt(job.gross)} gross</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentMonth.jobs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No completed jobs this month yet.</p>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</p>
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.month} className="border rounded-lg">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-sm"
                  onClick={() => setOpenHistory(openHistory === h.month ? null : h.month)}
                >
                  <span className="font-medium">{monthLabel(h.month)}</span>
                  <div className="flex items-center gap-3">
                    <span>{fmt(h.net)}</span>
                    <span className={`text-xs ${h.paid ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                      {h.paid ? 'Paid' : 'Pending'}
                    </span>
                    <span className="text-muted-foreground">{openHistory === h.month ? '▲' : '▼'}</span>
                  </div>
                </button>
                {openHistory === h.month && (
                  <div className="px-4 pb-3 pt-0 border-t">
                    <div className="space-y-1 text-xs text-muted-foreground py-2">
                      <div className="flex justify-between">
                        <span>Gross</span><span>{fmt(h.gross)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Commission</span><span>−{fmt(h.gross - h.net)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-foreground pt-1 border-t">
                        <span>Net</span><span>{fmt(h.net)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 text-xs"
                      onClick={() => {
                        const url = `/api/technician/earnings/statement?month=${h.month}`
                        window.open(url, '_blank')
                      }}
                    >
                      ↓ Download Statement
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commission note */}
      <p className="text-xs text-muted-foreground text-center pb-4">
        Plug a Pro charges 15% commission on gross earnings. This covers platform fees and customer acquisition.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Add Earnings tab to bottom nav**

In `app/(technician)/layout.tsx`, replace the nav section:

```typescript
<nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-bottom">
  <div className="flex h-16 items-center justify-around px-2">
    <NavLink href="/technician" label="Jobs" />
    <NavLink href="/technician/earnings" label="Earnings" />
    <NavLink href="/technician/profile" label="Profile" />
  </div>
</nav>
```

- [ ] **Step 4: Fix the earnings page data fetch (use DB directly)**

The `EarningsPage` server component should call the DB directly rather than fetching itself. Update `app/(technician)/technician/earnings/page.tsx` — replace the fetch block:

```typescript
// Replace the fetch call with a direct DB query
const now = new Date()
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

const allPayouts = await db.providerPayout.findMany({
  where: { providerId: provider.id },
  include: {
    job: {
      include: {
        booking: {
          include: {
            match: { include: { jobRequest: { include: { address: true } } } },
          },
        },
      },
    },
  },
  orderBy: { createdAt: 'desc' },
})

const currentPayouts = allPayouts.filter(
  (p) => p.createdAt >= monthStart && p.createdAt <= monthEnd
)

const sumField = (arr: typeof allPayouts, f: 'grossAmount' | 'commissionAmt' | 'netAmount') =>
  arr.reduce((acc, p) => acc + Number(p[f]), 0)

const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const historyMap = new Map<string, { gross: number; net: number; paid: boolean; payoutId: string | null }>()
for (const p of allPayouts) {
  const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`
  const entry = historyMap.get(key)
  if (!entry) historyMap.set(key, { gross: Number(p.grossAmount), net: Number(p.netAmount), paid: p.status === 'PAID', payoutId: p.id })
  else { entry.gross += Number(p.grossAmount); entry.net += Number(p.netAmount); if (p.status !== 'PAID') entry.paid = false }
}

const data: EarningsData = {
  currentMonth: {
    gross: sumField(currentPayouts, 'grossAmount'),
    commission: sumField(currentPayouts, 'commissionAmt'),
    net: sumField(currentPayouts, 'netAmount'),
    pending: currentPayouts.filter((p) => p.status !== 'PAID').reduce((a, p) => a + Number(p.netAmount), 0),
    paid: currentPayouts.filter((p) => p.status === 'PAID').reduce((a, p) => a + Number(p.netAmount), 0),
    jobs: currentPayouts.map((p) => ({
      id: p.job.id,
      category: p.job.booking.match.jobRequest.category,
      area: p.job.booking.match.jobRequest.address?.suburb ?? 'Unknown',
      completedAt: (p.job.completedAt ?? p.createdAt).toISOString(),
      gross: Number(p.grossAmount),
      net: Number(p.netAmount),
    })),
  },
  history: [...historyMap.entries()]
    .filter(([k]) => k !== currentMonthKey)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, d]) => ({ month, ...d })),
}
```

(Remove the `res` / `data` fetch lines and the `EarningsData` interface import — keep the interface declared locally or move to a shared types file.)

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "earnings|EarningsDash" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/\(technician\)/technician/earnings/ components/technician/EarningsDashboard.tsx app/\(technician\)/layout.tsx
git commit -m "feat: earnings dashboard PWA + Earnings tab in provider nav"
```

---

## Task 10: Deploy to Production

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service
npx tsc --noEmit 2>&1
```

Expected: 0 errors. Fix any type errors before proceeding.

- [ ] **Step 2: Deploy to preview**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro
VERCEL_ORG_ID=<org_id> VERCEL_PROJECT_ID=<project_id> vercel
```

Expected: preview URL printed, build succeeds.

- [ ] **Step 3: Smoke test**

- Open `/quotes/test-token-123` — should show "not found" (confirms route works)
- Open `/technician/earnings` — should show empty state (no payouts yet)
- Open `/technician/quotes/test-match-id` — should show 404 or redirect

- [ ] **Step 4: Deploy to production (requires user confirmation)**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro
VERCEL_ORG_ID=<org_id> VERCEL_PROJECT_ID=<project_id> vercel --prod
```

- [ ] **Step 5: Log to OpenBrain**

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend
pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "engineering" \
  --title "feat — provider quote & earnings journey shipped (2026-03-31)" \
  --tags "whatsapp,pwa,quote,earnings,booking" \
  --content "Implemented: 3-button WhatsApp job offer (Accept & Quote / Inspect First / Decline), /technician/quotes/[matchId] quote form, /quotes/[token] client approval page (creates Booking+Job), /technician/earnings dashboard with monthly history + print statements. Schema: added labourCost, materialsCost, estimatedHours, approvalToken, preferredDate, postInspection to Quote table."
```
