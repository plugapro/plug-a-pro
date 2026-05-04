export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'
import { ProviderCard } from '@/components/shared/ProviderCard'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Find a Provider', noIndex: true })

export default async function ProviderCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; area?: string }>
}) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    redirect('/sign-in')
  }

  const flagEnabled = await isEnabled('feature.customer.provider_browse', { userId: session.id })
  if (!flagEnabled) redirect('/')

  const { category, area } = await searchParams

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      ...(category ? { skills: { has: category } } : {}),
      ...(area ? { serviceAreas: { has: area } } : {}),
    },
    orderBy: { averageRating: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      bio: true,
      skills: true,
      serviceAreas: true,
      averageRating: true,
      completedJobsCount: true,
      verified: true,
      avatarUrl: true,
    },
  })

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Find a Provider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse verified service providers near you.
        </p>
      </div>

      {/* Category filter bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        <Link
          href="/providers"
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !category
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          All
        </Link>
        {SERVICE_CATEGORY_OPTIONS.filter((o) => o.tag !== 'other').map((option) => {
          const isActive = category === option.tag
          return (
            <Link
              key={option.tag}
              href={`/providers?category=${option.tag}${area ? `&area=${area}` : ''}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {option.label}
            </Link>
          )
        })}
      </div>

      {/* Provider list */}
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No providers found for this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={{
                id: provider.id,
                name: provider.name,
                avatarUrl: provider.avatarUrl,
                skills: provider.skills,
                serviceArea: provider.serviceAreas[0] ?? null,
                averageRating: provider.averageRating,
                completedJobsCount: provider.completedJobsCount,
                verified: provider.verified,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
