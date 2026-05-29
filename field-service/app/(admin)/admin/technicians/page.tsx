// ─── Admin: Providers ──────────────────────────────────────────────────────────
// Lists all providers with active job count and status.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { KycStatus, ProviderStatus } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Providers', noIndex: true })

const STATUS_BADGE: Record<ProviderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  APPLICATION_PENDING: 'outline',
  UNDER_REVIEW: 'secondary',
  ACTIVE: 'default',
  SUSPENDED: 'destructive',
  ARCHIVED: 'outline',
  BANNED: 'destructive',
}

const KYC_OPTIONS = Object.values(KycStatus)
const STATUS_OPTIONS = Object.values(ProviderStatus)

interface ProvidersPageProps {
  searchParams?: Promise<{
    q?: string
    status?: string
    kyc?: string
    archived?: string
    message?: string
  }>
}

export default async function ProvidersPage({ searchParams }: ProvidersPageProps) {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.providers', { userId: actor.id })
  const filters = (await searchParams) ?? {}
  const q = filters.q?.trim() ?? ''

  const providers = await db.provider.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(filters.status && STATUS_OPTIONS.includes(filters.status as ProviderStatus)
        ? { status: filters.status as ProviderStatus }
        : {}),
      ...(filters.kyc && KYC_OPTIONS.includes(filters.kyc as KycStatus)
        ? { kycStatus: filters.kyc as KycStatus }
        : {}),
      ...(filters.archived === 'true'
        ? { archivedAt: { not: null } }
        : filters.archived === 'false'
          ? { archivedAt: null }
          : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      skills: true,
      status: true,
      kycStatus: true,
      verified: true,
      active: true,
      archivedAt: true,
      _count: {
        select: {
          jobs: { where: { status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } } },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: 500,
  })

  const activeCount = providers.filter((p) => p.status === 'ACTIVE').length
  const suspendedCount = providers.filter((p) => p.status === 'SUSPENDED' || p.status === 'BANNED').length

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Providers</h1>
          <p className="text-sm text-muted-foreground">
            {providers.length} matching · {activeCount} active
            {suspendedCount > 0 && <span className="ml-2 text-destructive">· {suspendedCount} suspended/banned</span>}
          </p>
        </div>
        {crudEnabled && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/api/admin/providers/export?q=${encodeURIComponent(q)}&status=${encodeURIComponent(filters.status ?? '')}&kyc=${encodeURIComponent(filters.kyc ?? '')}&archived=${encodeURIComponent(filters.archived ?? '')}`}
              >
                Export CSV
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/providers/new">Add provider</Link>
            </Button>
          </div>
        )}
      </div>

      {!crudEnabled && (
        <div className="tone-warning mb-4 rounded-lg border px-4 py-2 text-sm">
          Provider mutations are disabled. Enable the <code>admin.crud.providers</code> feature flag to verify, suspend or update providers.
        </div>
      )}

      {filters.message && (
        <div className="tone-success mb-4 rounded-lg border px-4 py-2 text-sm">
          {filters.message}
        </div>
      )}

      <form className="mb-4 grid gap-3 rounded-xl border p-4 md:grid-cols-4" method="get">
        <input
          type="search"
          name="q"
          placeholder="Search name, phone, email"
          defaultValue={q}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          name="status"
          defaultValue={filters.status ?? ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="kyc"
          defaultValue={filters.kyc ?? ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All KYC states</option>
          {KYC_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            name="archived"
            defaultValue={filters.archived ?? ''}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All archive states</option>
            <option value="false">Active records only</option>
            <option value="true">Archived only</option>
          </select>
          <Button type="submit" variant="outline" size="sm" className="h-9">
            Filter
          </Button>
        </div>
      </form>

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Skills</TableHead>
              <TableHead>Provider Status</TableHead>
              <TableHead className="hidden lg:table-cell">KYC</TableHead>
              <TableHead className="text-right">Active Jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No providers yet. Approve applications to add providers.
                </TableCell>
              </TableRow>
            )}
            {providers.map((provider) => (
              <TableRow key={provider.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Link href={`/admin/providers/${provider.id}`} className="block">
                    <p className="font-medium hover:text-primary">{provider.name}</p>
                    {provider.archivedAt ? (
                      <p className="text-xs text-muted-foreground">Archived</p>
                    ) : provider.verified ? (
                      <>
                        <p className="text-xs text-green-600">Verified</p>
                        {provider.email && (
                          <p className="text-xs text-muted-foreground">{provider.email}</p>
                        )}
                      </>
                    ) : null}
                    {!provider.verified && provider.email && (
                      <p className="text-xs text-muted-foreground">{provider.email}</p>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">
                  {provider.phone}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {provider.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {provider.skills.slice(0, 3).map((skill) => (
                        <Badge key={skill} variant="secondary" className="rounded-full text-xs">
                          {skill}
                        </Badge>
                      ))}
                      {provider.skills.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{provider.skills.length - 3}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[provider.status] ?? 'outline'} className="rounded-full text-xs">
                    {provider.status.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Badge variant="outline" className="rounded-full text-xs">
                    {provider.kycStatus.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {provider._count.jobs}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
