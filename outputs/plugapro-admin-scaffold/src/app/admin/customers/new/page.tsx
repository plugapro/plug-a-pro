// /admin/customers/new — manual concierge create.

import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { isEnabled } from '@/lib/flags';
import { Role } from '@prisma/client';
import { NewCustomerForm } from './form-client';

export default async function NewCustomerPage() {
  const session = await requireRole([Role.OPS, Role.ADMIN, Role.OWNER]);
  if (!(await isEnabled('admin.crud.customers', { userId: session.user.id }))) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Add customer</h1>
        <p className="text-sm text-muted-foreground">
          Create a customer record on their behalf. Usually used when someone
          phones in or walks up.
        </p>
      </header>
      <NewCustomerForm />
    </main>
  );
}
