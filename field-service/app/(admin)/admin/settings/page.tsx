// ─── Admin: Settings ──────────────────────────────────────────────────────────
// Business profile — name, phone, email. Read-only platform info.

export const dynamic = 'force-dynamic'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Settings', noIndex: true })

export default async function SettingsPage() {
  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
  })

  async function updateBusiness(formData: FormData) {
    'use server'
    const name  = String(formData.get('name') ?? '').trim()
    const phone = String(formData.get('phone') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim()

    if (!name) return

    const { db: dbServer } = await import('@/lib/db')
    await dbServer.business.update({
      where: { id: businessId },
      data: {
        name,
        phone: phone || null,
        email: email || null,
      },
    })
    revalidatePath('/admin/settings')
  }

  if (!business) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Business configuration not found.
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Business profile and configuration</p>
      </div>

      {/* Business details */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Business Profile
        </h2>
        <form action={updateBusiness} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" name="name" defaultValue={business.name} required />
            <Field label="Phone" name="phone" defaultValue={business.phone ?? ''} />
            <Field label="Email" name="email" type="email" defaultValue={business.email ?? ''} />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Save changes
          </button>
        </form>
      </section>

      {/* Read-only platform info */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Platform
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
          <Row label="Business ID">{business.id.slice(-12)}</Row>
          <Row label="Slug">{business.slug}</Row>
          <Row label="Timezone">{business.timezone}</Row>
          <Row label="Currency">{business.currency}</Row>
          <Row label="Mode">
            {process.env.MULTI_TENANT_MODE === 'true' ? 'Multi-tenant' : 'Single-tenant'}
          </Row>
        </div>
      </section>

      {/* Integration reference */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Integrations
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-2 text-sm text-muted-foreground">
          <p>
            WhatsApp, payments, storage, and notification settings are configured via
            environment variables. See{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              .env.local.example
            </code>{' '}
            for the full list.
          </p>
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  required,
}: {
  label: string
  name: string
  defaultValue: string
  type?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}
