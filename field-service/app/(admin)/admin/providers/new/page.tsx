export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createProviderFromFormAction } from '../actions'

export const metadata = buildMetadata({ title: 'Add Provider', noIndex: true })

export default async function NewProviderPage({
  searchParams,
}: {
  searchParams?: Promise<{ message?: string }>
}) {
  const actor = await requireRole(['ADMIN', 'OWNER'])
  const crudEnabled = await isEnabled('admin.crud.providers', { userId: actor.id })
  const query = (await searchParams) ?? {}

  if (!crudEnabled) {
    redirect('/admin/providers?message=Provider%20CRUD%20is%20currently%20disabled.')
  }

  async function submitCreateProvider(formData: FormData) {
    'use server'
    const result = await createProviderFromFormAction(formData)
    if (!result.ok) {
      redirect(`/admin/providers/new?message=${encodeURIComponent(result.error)}`)
    }
    redirect(`/admin/providers/${result.data.id}?message=${encodeURIComponent('Provider created.')}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/providers">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Add provider</h1>
          <p className="text-sm text-muted-foreground">
            Create a provider record and seed the profile fields used by admin dispatch review.
          </p>
        </div>
      </div>

      {query.message && (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          {query.message}
        </div>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Provider profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={submitCreateProvider} className="grid gap-4 md:grid-cols-2">
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
              <span className="font-medium">Experience</span>
              <input
                name="experience"
                placeholder="e.g. 5 years"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Skills</span>
              <input
                name="skills"
                placeholder="Comma-separated skills"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Service areas</span>
              <input
                name="serviceAreas"
                placeholder="Comma-separated service areas"
                className="h-10 rounded-md border border-input bg-background px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit">Create provider</Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/providers">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
