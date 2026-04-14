// ─── Admin: Location Taxonomy ──────────────────────────────────────────────────
// Lists all location nodes grouped by type with CRUD actions.

export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
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
import { deactivateLocationNodeAction, deleteLocationNodeAction } from './actions'

export const metadata = buildMetadata({ title: 'Location Taxonomy', noIndex: true })

const TYPE_LABELS: Record<string, string> = {
  PROVINCE: 'Province',
  CITY: 'City',
  REGION: 'Region',
  SUBURB: 'Suburb',
}

export default async function LocationsPage() {
  await requireAdmin()

  const nodes = await db.locationNode.findMany({
    orderBy: [{ nodeType: 'asc' }, { label: 'asc' }],
    select: {
      id: true,
      nodeType: true,
      slug: true,
      label: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      active: true,
      parentId: true,
      _count: {
        select: {
          children: true,
          technicianServiceAreas: true,
          addresses: true,
        },
      },
    },
  })

  const byType = {
    PROVINCE: nodes.filter((n) => n.nodeType === 'PROVINCE'),
    CITY: nodes.filter((n) => n.nodeType === 'CITY'),
    REGION: nodes.filter((n) => n.nodeType === 'REGION'),
    SUBURB: nodes.filter((n) => n.nodeType === 'SUBURB'),
  }

  const totalCities = byType.CITY.length
  const totalRegions = byType.REGION.length
  const totalSuburbs = byType.SUBURB.length
  const totalAddresses = nodes.reduce((sum, n) => sum + n._count.addresses, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Location Taxonomy</h1>
        <p className="text-sm text-muted-foreground">
          {nodes.length} nodes total &mdash; {totalCities} cities, {totalRegions} regions,{' '}
          {totalSuburbs} suburbs, {totalAddresses} addresses
        </p>
      </div>

      {(Object.keys(byType) as Array<keyof typeof byType>).map((type) => {
        const group = byType[type]
        return (
          <div key={type} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">
              {TYPE_LABELS[type]}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({group.length})
              </span>
            </h2>

            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead className="hidden sm:table-cell">Slug</TableHead>
                    <TableHead className="hidden md:table-cell">Keys</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Refs</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No {TYPE_LABELS[type].toLowerCase()} nodes yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {group.map((node) => {
                    const refCount =
                      node._count.children +
                      node._count.technicianServiceAreas +
                      node._count.addresses
                    return (
                      <TableRow key={node.id}>
                        <TableCell>
                          <p className="font-medium">{node.label}</p>
                          <p className="text-xs text-muted-foreground font-mono">{node.id.slice(0, 8)}&hellip;</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground font-mono text-xs">
                          {node.slug}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          <div className="space-y-0.5">
                            {node.provinceKey && <div>prov: {node.provinceKey}</div>}
                            {node.cityKey && <div>city: {node.cityKey}</div>}
                            {node.regionKey && <div>region: {node.regionKey}</div>}
                            {!node.provinceKey && !node.cityKey && !node.regionKey && (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {node.active ? (
                            <Badge variant="default" className="rounded-full">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {node._count.children > 0 && (
                            <span className="mr-2">{node._count.children} children</span>
                          )}
                          {node._count.technicianServiceAreas > 0 && (
                            <span className="mr-2">{node._count.technicianServiceAreas} areas</span>
                          )}
                          {node._count.addresses > 0 && (
                            <span>{node._count.addresses} addr</span>
                          )}
                          {refCount === 0 && <span>—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <form
                              action={
                                deactivateLocationNodeAction.bind(null, node.id) as unknown as (
                                  fd: FormData,
                                ) => Promise<void>
                              }
                            >
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                disabled={!node.active}
                                className="text-orange-600 hover:text-orange-700"
                              >
                                Deactivate
                              </Button>
                            </form>
                            <form
                              action={
                                deleteLocationNodeAction.bind(null, node.id) as unknown as (
                                  fd: FormData,
                                ) => Promise<void>
                              }
                            >
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                disabled={
                                  node._count.children > 0 ||
                                  node._count.technicianServiceAreas > 0 ||
                                  node._count.addresses > 0
                                }
                                className="text-destructive hover:text-destructive/80"
                              >
                                Delete
                              </Button>
                            </form>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
