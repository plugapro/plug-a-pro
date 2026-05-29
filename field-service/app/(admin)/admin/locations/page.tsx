// ─── Admin: Location Taxonomy ──────────────────────────────────────────────────
// Lists all location nodes grouped by type with CRUD actions.

export const dynamic = 'force-dynamic'

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
import {
  createLocationNodeFromFormAction,
  deleteLocationNodeAction,
  updateLabelFromFormAction,
} from './actions'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { DeactivateLocationButton } from './_components/DeactivateLocationButton'
import { normaliseLocationDisplayName } from '@/lib/location-format'

export const metadata = buildMetadata({ title: 'Location Taxonomy', noIndex: true })

const TYPE_LABELS: Record<string, string> = {
  PROVINCE: 'Province',
  CITY: 'City',
  REGION: 'Region',
  SUBURB: 'Suburb',
}

export default async function LocationsPage() {
  const session = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.locations', { userId: session?.id })

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

  const displayNodes = nodes.map((node) => ({
    ...node,
    label: normaliseLocationDisplayName(node.label),
  }))

  const byType = {
    PROVINCE: displayNodes.filter((n) => n.nodeType === 'PROVINCE'),
    CITY: displayNodes.filter((n) => n.nodeType === 'CITY'),
    REGION: displayNodes.filter((n) => n.nodeType === 'REGION'),
    SUBURB: displayNodes.filter((n) => n.nodeType === 'SUBURB'),
  }

  const totalCities = byType.CITY.length
  const totalRegions = byType.REGION.length
  const totalSuburbs = byType.SUBURB.length
  const totalAddresses = displayNodes.reduce((sum, n) => sum + n._count.addresses, 0)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Location Taxonomy</h1>
          <p className="text-sm text-muted-foreground">
            {nodes.length} nodes total &mdash; {totalCities} cities, {totalRegions} regions,{' '}
            {totalSuburbs} suburbs, {totalAddresses} addresses
          </p>
        </div>
      </div>

      {/* ── Flag banner ────────────────────────────────────────────────────── */}
      {!crudEnabled && (
        <div className="tone-warning mb-4 rounded-lg border px-4 py-2 text-sm">
          Location mutations are disabled. Enable the <code>admin.crud.locations</code> feature flag to create, update or delete nodes.
        </div>
      )}

      {/* ── Add node form ──────────────────────────────────────────────────── */}
      {crudEnabled && (
      <details className="mb-8 rounded-xl border overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium bg-muted/30 hover:bg-muted/50 select-none">
          Add node
        </summary>
        <ActionForm action={createLocationNodeFromFormAction} successMessage="Location node created" resetOnSuccess refreshOnSuccess className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-nodeType">Type</label>
            <select id="create-nodeType" name="nodeType" required
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Select type…</option>
              <option value="PROVINCE">Province</option>
              <option value="CITY">City</option>
              <option value="REGION">Region</option>
              <option value="SUBURB">Suburb</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-label">Label</label>
            <input id="create-label" name="label" required placeholder="Cape Town"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-slug">Slug</label>
            <input id="create-slug" name="slug" required placeholder="cape_town"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-parentId">Parent node ID</label>
            <select id="create-parentId" name="parentId"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">None (Province)</option>
              {displayNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  [{n.nodeType}] {n.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-lat">Lat (optional)</label>
            <input id="create-lat" name="lat" type="number" step="any" placeholder="-33.9249"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium" htmlFor="create-lng">Lng (optional)</label>
            <input id="create-lng" name="lng" type="number" step="any" placeholder="18.4241"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <SubmitButton size="sm">Add node</SubmitButton>
          </div>
        </ActionForm>
      </details>
      )}

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
                          <ActionForm action={updateLabelFromFormAction} successMessage="Label updated" refreshOnSuccess className="flex items-center gap-1">
                            <input type="hidden" name="id" value={node.id} />
                            <input
                              name="label"
                              defaultValue={node.label}
                              className="font-medium bg-transparent border-b border-transparent hover:border-input focus:border-ring focus:outline-none text-sm w-full min-w-0"
                            />
                            <button type="submit" className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-1">✓</button>
                          </ActionForm>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{node.id.slice(0, 8)}&hellip;</p>
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
                              <span className="text-muted-foreground">-</span>
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
                          {refCount === 0 && <span>-</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {crudEnabled && (
                              <DeactivateLocationButton
                                nodeId={node.id}
                                nodeSlug={node.slug}
                                nodeLabel={node.label}
                                isActive={node.active}
                              />
                            )}
                            {crudEnabled && (
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
                            )}
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
