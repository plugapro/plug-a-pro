export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createCustomerFromFormAction } from '../actions'

export const metadata = buildMetadata({ title: 'Add Customer', noIndex: true })

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams?: Promise<{ message?: string }>
}) {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.customers', { userId: actor.id })
  const query = (await searchParams) ?? {}

  if (!crudEnabled) {
    redirect('/admin/customers?message=Customer%20CRUD%20is%20currently%20disabled.')
  }

  async function submitCreateCustomer(formData: FormData) {
    'use server'
    const result = await createCustomerFromFormAction(formData)
    if (!result.ok) {
      redirect(`/admin/customers/new?message=${encodeURIComponent(result.error)}`)
    }
    redirect(`/admin/customers/${result.data.id}?message=${encodeURIComponent('Customer created.')}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/customers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Add customer</h1>
          <p className="text-sm text-muted-foreground">
            Create a customer record for WhatsApp, referral, import or PWA-origin users.
          </p>
        </div>
      </div>

      {query.message && (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          {query.message}
        </div>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Customer profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={submitCreateCustomer} className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                name="name"
                required
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Phone</span>
              <input
                name="phone"
                required
                placeholder="+27821234567"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Email</span>
              <input
                name="email"
                type="email"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Channel</span>
              <select
                name="channel"
                defaultValue="WHATSAPP"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
                rows={4}
                className="rounded-md border border-input bg-background px-3 py-2 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit">Create customer</Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/customers">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
