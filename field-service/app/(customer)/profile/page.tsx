// ─── Customer: Profile ────────────────────────────────────────────────────────
// Account info with editable name/email. Phone is auth-managed (read-only).

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { SignOutButton } from '@/components/customer/SignOutButton'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WhatsappPreferencesCard } from './WhatsappPreferencesCard'

export const metadata = buildMetadata({ title: 'Profile', noIndex: true })

async function updateProfile(formData: FormData) {
  'use server'
  const { getSession: getServerSession } = await import('@/lib/auth')
  const session = await getServerSession()
  if (!session) return

  const name  = (formData.get('name')  as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()

  const { db: dbServer } = await import('@/lib/db')
  await dbServer.customer.update({
    where: { userId: session.id },
    data: {
      ...(name  ? { name }  : {}),
      ...(email !== null && email !== undefined ? { email: email || null } : {}),
    },
  })

  redirect('/profile')
}

export default async function ProfilePage() {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const customer = await db.customer.findUnique({
    where: { userId: session.id },
    include: { _count: { select: { jobRequests: true } } },
  })

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Profile</h1>

      {/* Edit form */}
      <Card>
        <CardContent className="px-4 py-4">
          <form action={updateProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={customer?.name ?? ''}
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
                defaultValue={customer?.email ?? ''}
                placeholder="your@email.com"
                className="h-9"
              />
            </div>
            <div className="space-y-1 text-sm">
              <span className="text-muted-foreground text-sm">Phone</span>
              <p className="text-sm pt-1">{session.phone ?? customer?.phone ?? '—'}</p>
            </div>
            <div className="space-y-1 text-sm">
              <span className="text-muted-foreground text-sm">Bookings</span>
              <p className="text-sm pt-1">{customer?._count?.jobRequests ?? 0}</p>
            </div>
            <Button type="submit" className="w-full">Save changes</Button>
          </form>
        </CardContent>
      </Card>

      {/* WhatsApp notifications */}
      <WhatsappPreferencesCard />

      {/* Navigation */}
      <div className="space-y-2">
        <Button asChild variant="outline" className="w-full justify-between rounded-xl h-auto px-4 py-4">
          <Link href="/bookings">
            <span>My Bookings</span>
            <span className="text-muted-foreground">→</span>
          </Link>
        </Button>
      </div>

      <SignOutButton />
    </div>
  )
}
