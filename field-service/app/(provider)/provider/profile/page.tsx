// ─── Provider: Profile ────────────────────────────────────────────────────────
// Editable name/email + per-day availability schedule + sign out.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { SignOutButton } from '@/components/technician/SignOutButton'
import { PushSubscribeButton } from '@/components/technician/PushSubscribeButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = buildMetadata({ title: 'My Profile', noIndex: true })

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

async function updateProfile(formData: FormData) {
  'use server'
  const { requireProvider: getSession } = await import('@/lib/auth')
  const session = await getSession()

  const { db: dbServer } = await import('@/lib/db')
  const provider = await dbServer.provider.findUnique({
    where: { userId: session.id },
  })
  if (!provider) return

  const name  = (formData.get('name')  as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()

  // Update profile fields
  if (name || email !== undefined) {
    await dbServer.provider.update({
      where: { id: provider.id },
      data: {
        ...(name  ? { name }  : {}),
        ...(email !== null && email !== undefined ? { email: email || null } : {}),
      },
    })
  }

  // Upsert schedule for each day
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const active    = formData.get(`day_${day}_active`) === 'on'
    const startTime = (formData.get(`day_${day}_start`) as string | null) ?? '08:00'
    const endTime   = (formData.get(`day_${day}_end`)   as string | null) ?? '17:00'

    await dbServer.providerSchedule.upsert({
      where: { providerId_dayOfWeek: { providerId: provider.id, dayOfWeek: day } },
      create: { providerId: provider.id, dayOfWeek: day, startTime, endTime, active },
      update: { startTime, endTime, active },
    })
  }

  redirect('/provider/profile')
}

export default async function ProviderProfilePage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    include: { schedule: { orderBy: { dayOfWeek: 'asc' } } },
  })

  if (!provider) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Provider account not found.</p>
      </div>
    )
  }

  // Build a quick lookup: dayOfWeek → schedule row
  const scheduleMap = Object.fromEntries(
    provider.schedule.map((s) => [s.dayOfWeek, s])
  )

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">My Profile</h1>

      <form action={updateProfile} className="space-y-6">
        {/* Contact info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={provider.name ?? ''}
                placeholder="Your name"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={provider.email ?? ''}
                placeholder="your@email.com"
                className="h-9"
              />
            </div>
            <div className="space-y-1 text-sm">
              <span className="text-muted-foreground text-sm">Phone</span>
              <p className="text-sm pt-1">{provider.phone ?? '—'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Availability schedule */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Availability
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {DAYS.map(({ value: day, label }) => {
              const entry     = scheduleMap[day]
              const isActive  = entry?.active  ?? (day >= 1 && day <= 5)
              const startTime = entry?.startTime ?? '08:00'
              const endTime   = entry?.endTime   ?? '17:00'

              return (
                <div key={day} className="flex items-center gap-3">
                  {/* Active toggle */}
                  <label className="flex items-center gap-2 w-28 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      name={`day_${day}_active`}
                      defaultChecked={isActive}
                      className="h-4 w-4 rounded border-gray-300 accent-primary"
                    />
                    <span className="text-sm">{label.slice(0, 3)}</span>
                  </label>

                  {/* Time inputs */}
                  <input
                    type="time"
                    name={`day_${day}_start`}
                    defaultValue={startTime}
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    name={`day_${day}_end`}
                    defaultValue={endTime}
                    className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full">Save changes</Button>
      </form>

      <PushSubscribeButton />
      <SignOutButton />
    </div>
  )
}
