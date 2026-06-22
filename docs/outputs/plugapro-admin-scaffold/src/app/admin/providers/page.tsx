// /admin/providers — list.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { ProvidersListClient } from './list-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { q?: string; status?: string; kyc?: string; archived?: string };
}

export default async function ProvidersPage({ searchParams }: PageProps) {
  const session = await requireRole([Role.OPS, Role.ADMIN, Role.OWNER]);
  if (!(await isEnabled('admin.crud.providers', { userId: session.user.id }))) notFound();

  const q = searchParams.q?.trim();
  const statusFilter = searchParams.status;
  const kycFilter = searchParams.kyc;
  const includeArchived = searchParams.archived === '1';

  const providers = await db.provider.findMany({
    where: {
      archivedAt: includeArchived ? undefined : null,
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ] } : {}),
      ...(statusFilter ? { status: statusFilter as any } : {}),
      ...(kycFilter ? { kycStatus: kycFilter as any } : {}),
    },
    orderBy: { name: 'asc' },
    take: 200,
    include: { _count: { select: { certifications: true, equipment: true } } },
  });

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Providers</h1>
          <p className="text-sm text-muted-foreground">{providers.length} shown</p>
        </div>
        <Link href="/admin/providers/new" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          + Add provider
        </Link>
      </header>

      <ProvidersListClient
        initial={providers.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          status: p.status,
          kycStatus: p.kycStatus,
          strikes: p.strikes,
          certCount: p._count.certifications,
          equipCount: p._count.equipment,
          archivedAt: p.archivedAt,
        }))}
        filters={{ q: q ?? '', status: statusFilter ?? '', kyc: kycFilter ?? '', includeArchived }}
      />
    </main>
  );
}
