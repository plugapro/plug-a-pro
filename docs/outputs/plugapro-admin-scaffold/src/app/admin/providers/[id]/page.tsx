// /admin/providers/[id] — tabbed detail: Profile, Certs, Equipment, Notes, Audit.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireRole, hasRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { ProviderDetailClient } from './detail-client';

export const dynamic = 'force-dynamic';

interface PageProps { params: { id: string } }

export default async function ProviderDetailPage({ params }: PageProps) {
  const session = await requireRole([Role.OPS, Role.TRUST, Role.ADMIN, Role.OWNER]);
  if (!(await isEnabled('admin.crud.providers', { userId: session.user.id }))) notFound();

  // Defensive load: if any related record is null, render with partial data
  // rather than throwing. The error boundary catches anything we miss.
  const provider = await db.provider.findUnique({
    where: { id: params.id },
    include: {
      certifications: { orderBy: { createdAt: 'desc' } },
      equipment: { orderBy: { createdAt: 'desc' } },
      notes: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!provider) notFound();

  const audit = await db.adminAuditEvent.findMany({
    where: { entityType: { in: ['Provider', 'ProviderCertification', 'ProviderEquipment', 'ProviderNote'] }, entityId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });

  const categories = await db.category.findMany({ where: { isActive: true }, orderBy: { label: 'asc' } });
  const locations = await db.location.findMany({ where: { type: 'REGION', isActive: true }, orderBy: { label: 'asc' } });

  const canAdmin = await hasRole([Role.ADMIN, Role.OWNER]);
  const canTrust = await hasRole([Role.TRUST, Role.ADMIN, Role.OWNER]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <nav className="text-sm text-muted-foreground">
        <Link href="/admin/providers" className="hover:underline">← Providers</Link>
      </nav>

      <ProviderDetailClient
        provider={{
          id: provider.id,
          name: provider.name,
          phone: provider.phone,
          status: provider.status,
          kycStatus: provider.kycStatus,
          strikes: provider.strikes,
          skills: provider.skills ?? [],
          serviceAreas: provider.serviceAreas ?? [],
          suspendedUntil: provider.suspendedUntil,
          archivedAt: provider.archivedAt,
        }}
        certifications={provider.certifications.map((c) => ({
          id: c.id,
          type: c.type,
          number: c.number,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          attachmentUrl: c.attachmentUrl,
        }))}
        equipment={provider.equipment.map((e) => ({
          id: e.id,
          type: e.type,
          notes: e.notes,
        }))}
        notes={provider.notes.map((n) => ({
          id: n.id,
          body: n.body,
          isStrike: n.isStrike,
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
        skillOptions={categories.map((c) => ({ value: c.slug, label: c.label }))}
        areaOptions={locations.map((l) => ({ value: l.id, label: l.label }))}
        canAdmin={canAdmin}
        canTrust={canTrust}
      />
    </main>
  );
}
