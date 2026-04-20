// ─── Admin: Providers ──────────────────────────────────────────────────────────
// Lists all providers with active job count and status.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Providers', noIndex: true })

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  APPLICATION_PENDING: 'outline',
  UNDER_REVIEW: 'secondary',
  ACTIVE: 'default',
  SUSPENDED: 'destructive',
  ARCHIVED: 'outline',
  BANNED: 'destructive',
}

export default async function ProvidersPage() {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.providers', actor.id)

  const providers = await db.provider.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      status: true,
      verified: true,
      active: true,
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Providers</h1>
        <p className="text-sm text-muted-foreground">
          {providers.length} registered · {activeCount} active
          {suspendedCount > 0 && <span className="ml-2 text-destructive">· {suspendedCount} suspended/banned</span>}
        </p>
      </div>

      {!crudEnabled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Provider mutations are disabled. Enable the <code>admin.crud.providers</code> feature flag to verify, suspend, or update providers.
        </div>
      )}

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Phone</TableHead>
              <TableHead className="hidden md:table-cell">Skills</TableHead>
              <TableHead>Provider Status</TableHead>
              <TableHead className="text-right">Active Jobs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No providers yet. Approve applications to add providers.
                </TableCell>
              </TableRow>
            )}
            {providers.map((provider) => (
              <TableRow key={provider.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Link href={`/admin/providers/${provider.id}`} className="block">
                    <p className="font-medium hover:text-primary">{provider.name}</p>
                    {provider.verified && (
                      <p className="text-xs text-green-600">Verified</p>
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
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[provider.status] ?? 'outline'} className="rounded-full text-xs">
                    {provider.status.replace(/_/g, ' ')}
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
