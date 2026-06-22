// /admin/customers — list page with Add, search, filters, export, bulk.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role, CustomerChannel } from '@prisma/client';
import { CustomersListClient } from './list-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    q?: string;
    channel?: string;
    blocked?: string;
    archived?: string;
  };
}

export default async function CustomersPage({ searchParams }: PageProps) {
  const session = await requireRole([Role.OPS, Role.ADMIN, Role.OWNER]);

  if (!(await isEnabled('admin.crud.customers', { userId: session.user.id }))) {
    notFound();
  }

  const q = searchParams.q?.trim();
  const channel = searchParams.channel;
  const blocked = searchParams.blocked === '1';
  const includeArchived = searchParams.archived === '1';

  const customers = await db.customer.findMany({
    where: {
      archivedAt: includeArchived ? undefined : null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(channel ? { channel: channel as CustomerChannel } : {}),
      ...(blocked ? { isBlocked: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">{customers.length} shown</p>
        </div>
        <Link
          href="/admin/customers/new"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          + Add customer
        </Link>
      </header>

      <CustomersListClient
        initial={customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          channel: c.channel,
          isBlocked: c.isBlocked,
          archivedAt: c.archivedAt,
        }))}
        filters={{ q: q ?? '', channel: channel ?? '', blocked, includeArchived }}
      />
    </main>
  );
}
