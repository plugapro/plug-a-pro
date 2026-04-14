// ─── Customer: Browse job categories ──────────────────────────────────────────
// Lists the 8 static service categories.
// Auth required — unauthenticated users are redirected to /sign-in.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'Request a Job' })

const CATEGORIES = [
  { slug: 'plumbing',    name: 'Plumbing',       description: 'Leaks, installations, drain clearing and more.' },
  { slug: 'painting',    name: 'Painting',        description: 'Interior and exterior painting services.' },
  { slug: 'garden',      name: 'Garden',          description: 'Lawn care, landscaping, and tree trimming.' },
  { slug: 'handyman',    name: 'Handyman',        description: 'General repairs and odd jobs around the home.' },
  { slug: 'appliances',  name: 'Appliances',      description: 'Repairs and installation of home appliances.' },
  { slug: 'electrical',  name: 'Electrical',      description: 'Wiring, fault-finding, and compliance certificates.' },
  { slug: 'diy',         name: 'DIY & Assembly',  description: 'Flat-pack assembly, shelving, and mounting.' },
  { slug: 'roofing',     name: 'Roofing',         description: 'Roof repairs, waterproofing, and inspections.' },
]

export default async function ServicesPage() {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/services')}`)

  return (
    <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Request a Job</h1>

      <div className="grid gap-3">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat.slug}
            asChild
            variant="outline"
            className="h-auto rounded-xl px-4 py-4 justify-start"
          >
            <Link href={`/book/${cat.slug}`}>
              <div className="flex items-start justify-between gap-3 w-full">
                <div className="min-w-0 flex-1 text-left">
                  <p className="font-semibold text-sm">{cat.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {cat.description}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground shrink-0 self-center">Request →</p>
              </div>
            </Link>
          </Button>
        ))}
      </div>
    </div>
  )
}
