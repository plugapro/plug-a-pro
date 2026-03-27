// ─── Admin: Service catalogue ──────────────────────────────────────────────────
// Lists all services for the business. Add / edit / toggle / delete inline.

export const dynamic = 'force-dynamic'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin, resolveBusinessId } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import type { PricingType } from '@prisma/client'

export const metadata = buildMetadata({ title: 'Services', noIndex: true })

// ─── Server Actions ───────────────────────────────────────────────────────────

async function createService(formData: FormData) {
  'use server'
  await requireAdmin()
  const businessId = await resolveBusinessId()

  const name        = formData.get('name') as string
  const category    = formData.get('category') as string
  const pricingType = formData.get('pricingType') as PricingType
  const basePrice   = formData.get('basePrice') ? Number(formData.get('basePrice')) : null
  const callOutFee  = formData.get('callOutFee') ? Number(formData.get('callOutFee')) : null
  const duration    = Number(formData.get('duration') ?? 60)
  const description = (formData.get('description') as string) || undefined

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  await db.service.create({
    data: {
      businessId,
      name,
      slug,
      category,
      pricingType,
      basePrice:   basePrice   !== null ? basePrice   : undefined,
      callOutFee:  callOutFee  !== null ? callOutFee  : undefined,
      duration,
      description,
      active: true,
    },
  })

  revalidatePath('/admin/services')
}

async function updateService(formData: FormData) {
  'use server'
  await requireAdmin()
  await resolveBusinessId()

  const id          = formData.get('id') as string
  const name        = formData.get('name') as string
  const category    = formData.get('category') as string
  const pricingType = formData.get('pricingType') as PricingType
  const basePrice   = formData.get('basePrice') ? Number(formData.get('basePrice')) : null
  const callOutFee  = formData.get('callOutFee') ? Number(formData.get('callOutFee')) : null
  const duration    = Number(formData.get('duration') ?? 60)
  const description = (formData.get('description') as string) || undefined

  await db.service.update({
    where: { id },
    data: {
      name,
      category,
      pricingType,
      basePrice:   basePrice  !== null ? basePrice  : null,
      callOutFee:  callOutFee !== null ? callOutFee : null,
      duration,
      description,
    },
  })

  revalidatePath('/admin/services')
}

async function toggleActive(formData: FormData) {
  'use server'
  await requireAdmin()

  const id     = formData.get('id') as string
  const active = formData.get('active') === 'true'

  await db.service.update({
    where: { id },
    data:  { active: !active },
  })

  revalidatePath('/admin/services')
}

async function deleteService(formData: FormData) {
  'use server'
  await requireAdmin()

  const id = formData.get('id') as string

  // Only delete if no bookings are attached
  const bookingCount = await db.booking.count({ where: { serviceId: id } })
  if (bookingCount > 0) {
    // Cannot delete — has bookings. Silently return; UI should not show button.
    return
  }

  await db.service.delete({ where: { id } })
  revalidatePath('/admin/services')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  await requireAdmin()
  const businessId = await resolveBusinessId()
  const { edit } = await searchParams

  const services = await db.service.findMany({
    where:   { businessId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  // Booking counts per service (to decide whether delete is allowed)
  const bookingCounts = await db.booking.groupBy({
    by:    ['serviceId'],
    where: { serviceId: { in: services.map((s) => s.id) } },
    _count: { serviceId: true },
  })
  const bookingCountMap = Object.fromEntries(
    bookingCounts.map((b) => [b.serviceId, b._count.serviceId])
  )

  const editingService = edit ? services.find((s) => s.id === edit) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Services</h1>
        <p className="text-sm text-muted-foreground mt-1">{services.length} services in catalogue</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Service list ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Price</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
                <th className="text-left px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {services.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No services yet — add one using the form
                  </td>
                </tr>
              )}
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.category}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.pricingType === 'FIXED'
                        ? 'bg-zinc-100 text-zinc-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {s.pricingType === 'FIXED' ? 'Fixed' : 'Quote'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.basePrice !== null ? `R ${Number(s.basePrice).toFixed(2)}` : '—'}
                    {s.callOutFee !== null && (
                      <span className="block text-xs">+R {Number(s.callOutFee).toFixed(2)} call-out</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.duration} min</td>
                  <td className="px-4 py-3">
                    <form action={toggleActive}>
                      <input type="hidden" name="id"     value={s.id} />
                      <input type="hidden" name="active" value={String(s.active)} />
                      <button
                        type="submit"
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          s.active ? 'bg-green-500' : 'bg-zinc-300'
                        }`}
                        title={s.active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          s.active ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <a
                        href={`/admin/services?edit=${s.id}`}
                        className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 transition-colors"
                      >
                        Edit
                      </a>
                      {!bookingCountMap[s.id] && (
                        <form action={deleteService}>
                          <input type="hidden" name="id" value={s.id} />
                          <button
                            type="submit"
                            className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                            onClick={(e) => {
                              if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) {
                                e.preventDefault()
                              }
                            }}
                          >
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Add / Edit form ───────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">
            {editingService ? `Edit: ${editingService.name}` : 'Add Service'}
          </h2>

          <form action={editingService ? updateService : createService} className="space-y-3">
            {editingService && (
              <input type="hidden" name="id" value={editingService.id} />
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
              <input
                type="text"
                name="name"
                required
                defaultValue={editingService?.name ?? ''}
                placeholder="e.g. Electrical Inspection"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category *</label>
              <input
                type="text"
                name="category"
                required
                defaultValue={editingService?.category ?? ''}
                placeholder="e.g. Electrical"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Pricing Type *</label>
              <select
                name="pricingType"
                required
                defaultValue={editingService?.pricingType ?? 'FIXED'}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              >
                <option value="FIXED">Fixed Price</option>
                <option value="QUOTE_REQUIRED">Quote Required</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Base Price (R)</label>
                <input
                  type="number"
                  name="basePrice"
                  min="0"
                  step="0.01"
                  defaultValue={editingService?.basePrice !== null ? Number(editingService?.basePrice) : ''}
                  placeholder="450.00"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Call-out Fee (R)</label>
                <input
                  type="number"
                  name="callOutFee"
                  min="0"
                  step="0.01"
                  defaultValue={editingService?.callOutFee !== null ? Number(editingService?.callOutFee) : ''}
                  placeholder="150.00"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Duration (minutes) *</label>
              <input
                type="number"
                name="duration"
                required
                min="15"
                step="15"
                defaultValue={editingService?.duration ?? 60}
                placeholder="60"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <textarea
                name="description"
                rows={3}
                defaultValue={editingService?.description ?? ''}
                placeholder="Describe what this service includes..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                className="flex-1 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity"
              >
                {editingService ? 'Save Changes' : 'Add Service'}
              </button>
              {editingService && (
                <a
                  href="/admin/services"
                  className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </a>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
