export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import {
  activateVendorConfigFormAction,
  updateVendorConfigFormAction,
} from './actions'

export const metadata = buildMetadata({ title: 'Verification Vendors', noIndex: true })

const FLAG = 'admin.crud.verifications'
const VENDOR_KEYS = ['manual', 'mock', 'smile_id', 'thisisme', 'datanamix', 'omnicheck'] as const

type VendorKey = typeof VENDOR_KEYS[number]

export default async function VerificationVendorsPage() {
  const admin = await requireAdmin()
  const enabled = await isEnabled(FLAG, { userId: admin.id })
  const rows = await db.verificationVendorConfig.findMany({
    orderBy: [{ active: 'desc' }, { vendorKey: 'asc' }],
  })
  const rowsByVendor = new Map(rows.map((row) => [row.vendorKey, row]))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/admin/verifications" className="text-xs text-muted-foreground hover:text-foreground">
            Identity verifications
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Verification vendors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select the active automation provider and tune confidence/liveness requirements.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/verifications">Review queue</Link>
        </Button>
      </div>

      {!enabled ? (
        <div className="tone-warning rounded-xl border px-4 py-3 text-sm">
          Vendor changes are disabled by feature flag <span className="font-mono">{FLAG}</span>.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Vendor</th>
              <th className="px-4 py-3 text-left font-medium">State</th>
              <th className="px-4 py-3 text-left font-medium">Threshold</th>
              <th className="px-4 py-3 text-left font-medium">Liveness</th>
              <th className="px-4 py-3 text-left font-medium">Updated</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {VENDOR_KEYS.map((vendorKey) => {
              const config = rowsByVendor.get(vendorKey)
              const active = Boolean(config?.active)
              const confidenceThreshold = config?.confidenceThreshold ?? 0.9
              const livenessRequired = config?.livenessRequired ?? vendorKey !== 'manual'
              return (
                <tr key={vendorKey} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{vendorLabel(vendorKey)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{vendorKey}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={active ? 'success' : 'neutral'}>{active ? 'active' : 'inactive'}</Badge>
                    {isScaffoldOnly(vendorKey) ? (
                      <p className="mt-2 text-xs text-muted-foreground">Adapter scaffold only.</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{confidenceThreshold.toFixed(2)}</td>
                  <td className="px-4 py-3">{livenessRequired ? 'required' : 'not required'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{config ? formatDate(config.updatedAt) : 'not seeded'}</td>
                  <td className="px-4 py-3">
                    <div className="grid gap-3 md:min-w-[320px]">
                      <form action={updateVendorConfigFormAction} className="grid gap-2 rounded-md border p-3">
                        <input type="hidden" name="vendorKey" value={vendorKey} />
                        <label className="grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">Confidence threshold</span>
                          <input
                            type="number"
                            name="confidenceThreshold"
                            min="0"
                            max="1"
                            step="0.01"
                            defaultValue={confidenceThreshold}
                            className="h-9 rounded-md border bg-background px-3 text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="livenessRequired" defaultChecked={livenessRequired} />
                          Require liveness
                        </label>
                        <Button type="submit" size="sm" variant="outline">Save config</Button>
                      </form>
                      <form action={activateVendorConfigFormAction}>
                        <input type="hidden" name="vendorKey" value={vendorKey} />
                        <Button type="submit" size="sm" disabled={active || isScaffoldOnly(vendorKey)}>
                          Make active
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function isScaffoldOnly(vendorKey: VendorKey) {
  return vendorKey === 'thisisme' || vendorKey === 'datanamix' || vendorKey === 'omnicheck'
}

function vendorLabel(vendorKey: VendorKey) {
  if (vendorKey === 'smile_id') return 'Smile ID'
  if (vendorKey === 'thisisme') return 'ThisIsMe'
  if (vendorKey === 'datanamix') return 'Datanamix'
  if (vendorKey === 'omnicheck') return 'OmniCheck'
  if (vendorKey === 'mock') return 'Mock'
  return 'Manual review'
}

function formatDate(value: Date) {
  return value.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
