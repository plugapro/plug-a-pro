import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { NewProviderForm } from './form-client';

export default async function NewProviderPage() {
  const session = await requireRole([Role.ADMIN, Role.OWNER]);
  if (!(await isEnabled('admin.crud.providers', { userId: session.user.id }))) notFound();

  // Fetch the taxonomy lists once on the server.
  const categories = await db.category.findMany({ where: { isActive: true }, orderBy: { label: 'asc' } });
  const locations = await db.location.findMany({ where: { type: 'REGION', isActive: true }, orderBy: { label: 'asc' } });

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Add provider</h1>
        <p className="text-sm text-muted-foreground">
          Admin-initiated create — bypasses the WhatsApp onboarding for providers vetted in person.
        </p>
      </header>
      <NewProviderForm
        skillOptions={categories.map((c) => ({ value: c.slug, label: c.label }))}
        areaOptions={locations.map((l) => ({ value: l.id, label: l.label }))}
      />
    </main>
  );
}
