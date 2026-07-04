// ─── Admin: Customer detail ───────────────────────────────────────────────────
// Contact info + full booking history for a single customer.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { formatCurrency } from '@/lib/payments'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ArrowLeft } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { CustomerActionsPanel, WhatsAppMarketingToggle } from './_components/CustomerActionsPanel'
import {
  updateCustomerFromFormAction,
  addCustomerNoteFromFormAction,
} from './actions'

export const metadata = buildMetadata({ title: 'Customer', noIndex: true })

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ message?: string }>
}) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const admin = await requireAdmin()
  const [crudEnabled, whatsappPrefToggleEnabled] = await Promise.all([
    isEnabled('admin.crud.customers', { userId: admin.id }),
    isEnabled('admin.customers.whatsapp_pref_toggle', { userId: admin.id }),
  ])

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      jobRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
          match: {
            include: {
              booking: {
                include: {
                  payment: { select: { status: true, amount: true } },
                },
              },
            },
          },
        },
      },
      _count: { select: { jobRequests: true } },
      whatsappPreferenceLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          field: true,
          oldValue: true,
          newValue: true,
          source: true,
          createdAt: true,
          note: true,
        },
      },
      customerNotes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, body: true, pinned: true, authorId: true, createdAt: true },
      },
    },
  })

  if (!customer) notFound()

  const auditEvents = await db.adminAuditEvent.findMany({
    where: {
      OR: [
        { entityType: 'Customer', entityId: customer.id },
        ...(customer.customerNotes.length > 0
          ? customer.customerNotes.map((note) => ({
              entityType: 'CustomerNote',
              entityId: note.id,
            }))
          : []),
      ],
    },
    include: {
      admin: {
        select: {
          name: true,
          role: true,
          email: true,
        },
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
  })

  // Flatten to a list of bookings with enough context to render the table
  // jr typed as any to avoid Prisma Decimal vs number mismatch in render shape
  const bookings = customer.jobRequests.flatMap((jr: any) =>
    jr.match?.booking
      ? [{
          id:          jr.match.booking.id,
          createdAt:   jr.match.booking.createdAt,
          status:      jr.match.booking.status,
          payment:     jr.match.booking.payment,
          jobTitle:    jr.title,
        }]
      : []
  )

  const lastBooking = bookings[0]
  const channel = customer.userId ? 'PWA + WhatsApp' : 'WhatsApp only'
  const isSuspended = Boolean(customer.suspendedUntil && customer.suspendedUntil > new Date())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Customers
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{customer.phone}</p>
        </div>
        <div className="flex items-center gap-2">
          {customer.isBlocked && (
            <Badge variant="destructive" className="rounded-full">Blocked</Badge>
          )}
          {!customer.active && (
            <Badge variant="outline" className="rounded-full text-muted-foreground">Inactive</Badge>
          )}
          <Badge variant={customer.userId ? 'secondary' : 'outline'} className="rounded-full">
            {channel}
          </Badge>
        </div>
      </div>

      {query.message && (
        <div className="tone-success rounded-lg border px-4 py-2 text-sm">
          {query.message}
        </div>
      )}

      {isSuspended && (
        <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">
            Customer suspended until{' '}
            {customer.suspendedUntil?.toLocaleString('en-ZA', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {customer.suspendedReason && (
            <p className="mt-1">{customer.suspendedReason}</p>
          )}
        </div>
      )}

      {/* ── Admin actions ───────────────────────────────────────────────────── */}
      {crudEnabled && (
        <CustomerActionsPanel
          customerId={customer.id}
          customerPhone={customer.phone}
          customerName={customer.name}
          isBlocked={customer.isBlocked}
          active={customer.active}
          isSuspended={isSuspended}
          archivedAt={customer.archivedAt ?? null}
          purgeAfter={customer.purgeAfter ?? null}
          mergedIntoCustomerId={customer.mergedIntoCustomerId ?? null}
          whatsappMarketingOptIn={customer.whatsappMarketingOptIn}
          adminRole={admin.adminRole}
        />
      )}

      {crudEnabled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Edit Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={updateCustomerFromFormAction}
              successMessage="Profile updated"
              refreshOnSuccess
              className="grid gap-4 md:grid-cols-2"
            >
              <input type="hidden" name="customerId" value={id} />
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Name</span>
                <input
                  name="name"
                  required
                  defaultValue={customer.name}
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Phone</span>
                <input
                  name="phone"
                  required
                  defaultValue={customer.phone}
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Email</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={customer.email ?? ''}
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Channel</span>
                <select
                  name="channel"
                  defaultValue={customer.channel ?? 'WHATSAPP'}
                  className="h-9 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="PWA">PWA</option>
                  <option value="REFERRAL">Referral</option>
                  <option value="IMPORT">Import</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm md:col-span-2">
                <span className="font-medium">Address</span>
                <textarea
                  name="address"
                  defaultValue={customer.address ?? ''}
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="md:col-span-2">
                <SubmitButton variant="outline" size="sm" pendingLabel="Saving profile…">
                  Save profile changes
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      {/* ── Admin notes ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Admin Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {customer.customerNotes.length === 0 && (
            <p className="text-muted-foreground">No notes yet.</p>
          )}
          {customer.customerNotes.map((note) => (
            <div key={note.id} className={`rounded-md border p-3 text-sm ${note.pinned ? 'tone-warning' : ''}`}>
              <p>{note.body}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {note.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                {note.pinned && <span className="ml-2 font-medium">pinned</span>}
              </p>
            </div>
          ))}
          {crudEnabled && (
            <ActionForm
              action={addCustomerNoteFromFormAction}
              successMessage="Note added"
              resetOnSuccess
              refreshOnSuccess
              className="flex gap-2 pt-2 border-t"
            >
              <input type="hidden" name="customerId" value={id} />
              <input
                name="body"
                required
                placeholder="Add a note…"
                className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring flex-1"
              />
              <SubmitButton variant="outline" size="sm" pendingLabel="Adding note…">Add</SubmitButton>
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {auditEvents.length === 0 ? (
            <p className="text-muted-foreground">No audit events yet.</p>
          ) : (
            auditEvents.map((event) => (
              <div key={event.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[11px]">
                      {event.entityType}
                    </Badge>
                    <span className="font-medium">{event.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {event.timestamp.toLocaleString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.admin.name} · {event.admin.role} · {event.admin.email}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Contact info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Phone">{customer.phone}</Row>
          {customer.email && <Row label="Email">{customer.email}</Row>}
          <Row label="Channel">{channel}</Row>
          {customer.archivedAt && (
            <Row label="Archived at">
              {customer.archivedAt.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
          {customer.purgeAfter && (
            <Row label="Eligible for purge">
              {customer.purgeAfter.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
          {customer.mergedIntoCustomerId && (
            <Row label="Merged into">
              <Link href={`/admin/customers/${customer.mergedIntoCustomerId}`} className="text-primary underline-offset-4 hover:underline">
                {customer.mergedIntoCustomerId}
              </Link>
            </Row>
          )}
          <Row label="Customer since">
            {customer.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {lastBooking && (
            <Row label="Last booking">
              {lastBooking.createdAt.toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Row>
          )}
        </CardContent>
      </Card>

      {/* Acquisition (first-touch attribution) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Acquisition
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <AcquisitionBlock
            source={customer.firstTouchSource ?? null}
            medium={customer.firstTouchMedium ?? null}
            campaign={customer.firstTouchCampaign ?? null}
            gclid={customer.firstTouchGclid ?? null}
            fbclid={customer.firstTouchFbclid ?? null}
            at={customer.firstTouchAt ?? null}
            landingPath={customer.firstTouchLandingPath ?? null}
            referrer={customer.firstTouchReferrer ?? null}
          />
        </CardContent>
      </Card>

      {/* WhatsApp Preferences */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            WhatsApp Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Service messages">
            {customer.whatsappServiceOptIn
              ? <Badge variant="secondary">Opted in</Badge>
              : <Badge variant="outline">Opted out</Badge>}
          </Row>
          <Row label="Marketing messages">
            {customer.whatsappMarketingOptIn
              ? <Badge variant="secondary">Opted in</Badge>
              : <Badge variant="outline">Opted out</Badge>}
          </Row>
          {customer.whatsappMarketingOptInAt && (
            <Row label="Opted in at">
              {customer.whatsappMarketingOptInAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Row>
          )}
          {customer.whatsappMarketingOptOutAt && (
            <Row label="Opted out at">
              {customer.whatsappMarketingOptOutAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Row>
          )}
          {customer.whatsappMarketingSource && (
            <Row label="Last source">{customer.whatsappMarketingSource}</Row>
          )}

          {crudEnabled && whatsappPrefToggleEnabled && (
            <div className="pt-2 border-t">
              <WhatsAppMarketingToggle
                customerId={customer.id}
                whatsappMarketingOptIn={customer.whatsappMarketingOptIn}
              />
            </div>
          )}

          {/* Audit log */}
          {customer.whatsappPreferenceLogs.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">Recent changes</p>
              <div className="space-y-1">
                {customer.whatsappPreferenceLogs.map((log) => (
                  <div key={log.id} className="text-xs text-muted-foreground flex gap-2">
                    <span className="w-24 flex-shrink-0">
                      {log.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                    </span>
                    <span>{log.field}: {String(log.oldValue)} → {String(log.newValue)}</span>
                    <span className="ml-auto">{log.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking history */}
      <div>
        <h2 className="text-sm font-semibold mb-3">
          Booking history ({bookings.length})
        </h2>
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Job Request</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No bookings yet.
                  </TableCell>
                </TableRow>
              )}
              {bookings.map((b: {
                id: string
                createdAt: Date
                status: string
                payment: { status: string; amount: number | null } | null
                jobTitle: string
              }) => (
                <TableRow key={b.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="font-mono text-xs hover:text-primary"
                    >
                      {b.id.slice(-8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.jobTitle ?? '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.createdAt.toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status as import('@prisma/client').BookingStatus} type="booking" />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {b.payment?.amount != null
                      ? formatCurrency(Number(b.payment.amount))
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-32 flex-shrink-0">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}

function AcquisitionBlock({
  source,
  medium,
  campaign,
  gclid,
  fbclid,
  at,
  landingPath,
  referrer,
}: {
  source: string | null
  medium: string | null
  campaign: string | null
  gclid: string | null
  fbclid: string | null
  at: Date | null
  landingPath: string | null
  referrer: string | null
}) {
  const hasAny =
    source || medium || campaign || gclid || fbclid || at || landingPath || referrer
  if (!hasAny) {
    return <p className="text-muted-foreground">No attribution captured</p>
  }
  return (
    <>
      {source && <Row label="Source">{source}</Row>}
      {medium && <Row label="Medium">{medium}</Row>}
      {campaign && <Row label="Campaign">{campaign}</Row>}
      {gclid && (
        <Row label="Google click ID">
          <span className="font-mono text-xs break-all">{gclid}</span>
        </Row>
      )}
      {fbclid && (
        <Row label="Meta click ID">
          <span className="font-mono text-xs break-all">{fbclid}</span>
        </Row>
      )}
      {referrer && (
        <Row label="Referrer">
          <span className="text-xs break-all">{referrer}</span>
        </Row>
      )}
      {(() => {
        // Defence-in-depth: even though parseAttributionJson rejects non-same-
        // site paths, any rows persisted before that validation landed could
        // carry a hostile href. Render plain text if the path doesn't look
        // like a safe same-site pathname.
        const safeLanding =
          landingPath && landingPath.startsWith('/') && !landingPath.startsWith('//')
            ? landingPath
            : null
        if (!landingPath) return null
        return (
          <Row label="Landing page">
            {safeLanding ? (
              <Link
                href={safeLanding}
                className="text-primary underline-offset-4 hover:underline break-all"
              >
                {safeLanding}
              </Link>
            ) : (
              <span className="text-xs break-all text-muted-foreground">{landingPath}</span>
            )}
          </Row>
        )
      })()}
      {at && (
        <Row label="First touch at">
          {at.toLocaleString('en-ZA', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Row>
      )}
    </>
  )
}
