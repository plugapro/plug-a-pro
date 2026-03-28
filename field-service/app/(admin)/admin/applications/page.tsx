// ─── Admin: Provider application review ───────────────────────────────────────
// Lists all ProviderApplications submitted via WhatsApp.
// Approve: creates Provider + Supabase user invite + WhatsApp notification.
// Reject: sends rejection WhatsApp + updates status.

export const dynamic = 'force-dynamic'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin, createServiceClient } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ApplicationStatus } from '@prisma/client'

export const metadata = buildMetadata({ title: 'Applications', noIndex: true })

// ─── Server Actions ───────────────────────────────────────────────────────────

async function approveApplication(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({ where: { id } })
  if (!app || app.status !== 'PENDING') return

  // Create Supabase user (phone OTP — no email/password)
  const supabase = createServiceClient()
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    phone: app.phone,
    user_metadata: {
      role: 'provider',
      name: app.name,
    },
    phone_confirm: true,
  })

  if (authError || !authData.user) {
    console.error('[applications] Supabase user create failed:', authError)
    // Still create Provider record — user can be linked later
  }

  // Create Provider record
  await db.provider.create({
    data: {
      userId: authData?.user?.id ?? null,
      name: app.name,
      phone: app.phone,
      skills: app.skills,
      serviceAreas: app.serviceAreas,
      active: true,
    },
  })

  // Update application status
  await db.providerApplication.update({
    where: { id },
    data: {
      status: 'APPROVED',
      reviewedAt: new Date(),
      reviewedById: session.id,
    },
  })

  // WhatsApp notification
  const { notifyTechnicianApplicationResult } = await import('@/lib/whatsapp-bot')
  await notifyTechnicianApplicationResult({
    phone: app.phone,
    name: app.name,
    approved: true,
  }).catch(() => {})

  revalidatePath('/admin/applications')
}

async function rejectApplication(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const reason = (formData.get('reason') as string) || undefined
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({ where: { id } })
  if (!app || app.status !== 'PENDING') return

  await db.providerApplication.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedAt: new Date(),
      reviewedById: session.id,
      notes: reason,
    },
  })

  const { notifyTechnicianApplicationResult } = await import('@/lib/whatsapp-bot')
  await notifyTechnicianApplicationResult({
    phone: app.phone,
    name: app.name,
    approved: false,
    reason,
  }).catch(() => {})

  revalidatePath('/admin/applications')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function getStatusVariant(status: ApplicationStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'APPROVED') return 'default'
  if (status === 'REJECTED') return 'destructive'
  return 'secondary'
}

export default async function ApplicationsPage() {
  await requireAdmin()

  const applications = await db.providerApplication.findMany({
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })

  const pending  = applications.filter((a) => a.status === 'PENDING')
  const reviewed = applications.filter((a) => a.status !== 'PENDING')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Provider Applications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Applications submitted via WhatsApp — review and approve to onboard new providers
        </p>
      </div>

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Pending ({pending.length})
        </h2>

        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No pending applications.</p>
        )}

        {pending.map((app) => (
          <Card key={app.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="font-medium">{app.name}</p>
                  <p className="text-sm text-muted-foreground">{app.phone}</p>
                </div>
                <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                  {app.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Skills: </span>
                  {app.skills.join(', ') || '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Area: </span>
                  {app.serviceAreas.join(', ') || '—'}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Submitted {app.submittedAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}Ref: {app.id.slice(-8).toUpperCase()}
              </p>

              <div className="flex gap-2 pt-1">
                <form action={approveApplication}>
                  <input type="hidden" name="id" value={app.id} />
                  <Button type="submit" size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                    Approve
                  </Button>
                </form>

                <form action={rejectApplication} className="flex gap-2">
                  <input type="hidden" name="id" value={app.id} />
                  <Input
                    type="text"
                    name="reason"
                    placeholder="Reason (optional)"
                    className="h-8 w-48 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Reject
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Reviewed */}
      {reviewed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Reviewed ({reviewed.length})
          </h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Skills</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewed.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>{app.name}</TableCell>
                    <TableCell className="text-muted-foreground">{app.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{app.skills.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                        {app.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.reviewedAt?.toLocaleDateString('en-ZA') ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  )
}
