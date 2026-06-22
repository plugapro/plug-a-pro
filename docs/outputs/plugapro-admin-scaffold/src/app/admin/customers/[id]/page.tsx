// /admin/customers/[id] — detail page with Edit, Block/Unblock, Suspend,
// Archive, Delete (OWNER), Merge, notes timeline, audit trail.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireRole, hasRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { formatDateTime } from '@/lib/utils';
import { CustomerDetailClient } from './detail-client';

export const dynamic = 'force-dynamic';

interface PageProps { params: { id: string } }

export default async function CustomerDetailPage({ params }: PageProps) {
  const session = await requireRole([Role.OPS, Role.ADMIN, Role.OWNER]);
  if (!(await isEnabled('admin.crud.customers', { userId: session.user.id }))) {
    notFound();
  }

  const customer = await db.customer.findUnique({
    where: { id: params.id },
    include: {
      notes: { orderBy: { createdAt: 'desc' }, take: 50, include: { author: { select: { id: true, name: true } } } },
    },
  });
  if (!customer) notFound();

  const audit = await db.adminAuditEvent.findMany({
    where: { entityType: 'Customer', entityId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });

  // Count open/closed bookings. Adjust field names to match your schema.
  const bookingCount = await db.booking.count({ where: { customerId: params.id } });

  const canOwner = await hasRole([Role.OWNER]);
  const canAdmin = await hasRole([Role.ADMIN, Role.OWNER]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <nav className="text-sm text-muted-foreground">
        <Link href="/admin/customers" className="hover:underline">← Customers</Link>
      </nav>

      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
            {' · '}
            <span className="uppercase text-xs tracking-wide">{customer.channel}</span>
          </p>
          <p className="text-xs text-muted-foreground">Since {formatDateTime(customer.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          {customer.isBlocked && (
            <span className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
              BLOCKED — {customer.blockedReason}
            </span>
          )}
          {customer.suspendedUntil && new Date(customer.suspendedUntil) > new Date() && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
              SUSPENDED until {formatDateTime(customer.suspendedUntil)}
            </span>
          )}
          {customer.archivedAt && (
            <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              ARCHIVED
            </span>
          )}
        </div>
      </header>

      <CustomerDetailClient
        customer={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          channel: customer.channel,
          address: customer.address,
          internalFlags: customer.internalFlags,
          isBlocked: customer.isBlocked,
          blockedReason: customer.blockedReason,
          suspendedUntil: customer.suspendedUntil,
          archivedAt: customer.archivedAt,
        }}
        notes={customer.notes.map((n) => ({
          id: n.id,
          body: n.body,
          createdAt: n.createdAt,
          authorName: n.author.name,
        }))}
        audit={audit.map((a) => ({
          id: a.id,
          action: a.action,
          createdAt: a.createdAt,
          actorName: a.actor.name,
          payload: a.payload,
        }))}
        bookingCount={bookingCount}
        canHardDelete={canOwner}
        canArchive={canAdmin}
      />
    </main>
  );
}
