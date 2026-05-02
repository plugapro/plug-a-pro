// /admin/team — admin users list + invite + edit roles + deactivate/revoke.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireRole, hasRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { TeamClient } from './team-client';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  // Owner-only surface.
  const session = await requireRole([Role.OWNER]);
  if (!(await isEnabled('admin.users.v2', { userId: session.user.id }))) notFound();

  const admins = await db.adminUser.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin team</h1>
          <p className="text-sm text-muted-foreground">
            {admins.filter((a) => a.isActive).length} active · {admins.length} total
          </p>
        </div>
        <Link href="/admin/team/permissions" className="text-sm underline">
          Role permission matrix →
        </Link>
      </header>

      <TeamClient
        admins={admins.map((a) => ({
          id: a.id,
          email: a.email,
          name: a.name,
          roles: a.roles,
          isActive: a.isActive,
          lastLoginAt: a.lastLoginAt,
          invitedAt: a.invitedAt,
          isMe: a.id === session.user.id,
        }))}
      />
    </main>
  );
}
