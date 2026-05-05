// /admin/locations — the reference full-CRUD page, rebuilt on the kit.
//
// Demonstrates:
//   - List with inline edit (label textbox)
//   - Create dialog via <CRUDForm>
//   - Row-level actions: Deactivate / Reactivate / Delete (destructive confirm)
//   - Feature-flag gate + role gate for the page as a whole

import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireRole, hasRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { LocationsClient } from './client';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  // Require at least an admin role to see this page.
  const session = await requireRole([Role.ADMIN, Role.OWNER]);

  if (!(await isEnabled('admin.crud.locations', { userId: session.user.id }))) {
    notFound();
  }

  const nodes = await db.location.findMany({
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  });

  const canHardDelete = await hasRole([Role.OWNER]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Location Taxonomy</h1>
        <p className="text-sm text-muted-foreground">
          {nodes.length} nodes — {nodes.filter((n) => n.type === 'PROVINCE').length} provinces,{' '}
          {nodes.filter((n) => n.type === 'CITY').length} cities,{' '}
          {nodes.filter((n) => n.type === 'REGION').length} regions,{' '}
          {nodes.filter((n) => n.type === 'SUBURB').length} suburbs.
        </p>
      </header>

      <LocationsClient
        initialNodes={nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.label,
          slug: n.slug,
          parentId: n.parentId,
          isActive: n.isActive,
        }))}
        canHardDelete={canHardDelete}
      />
    </main>
  );
}
