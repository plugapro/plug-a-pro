import { listVoucherBatchesAction } from './actions'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminVouchersPage() {
  const batches = await listVoucherBatchesAction()

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Vouchers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pilot voucher batches — each code grants 1 credit on redemption.
          To generate new codes, run:{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
            npx tsx scripts/generate-vouchers.ts --help
          </code>
        </p>
      </div>

      {batches.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No voucher batches yet. Generate one using the CLI script.
          </CardContent>
        </Card>
      )}

      {batches.map((batch) => (
        <Card key={batch.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{batch.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Campaign: <code className="font-mono">{batch.campaignCode}</code>
                  {' · '}Created: {new Date(batch.createdAt).toLocaleDateString()}
                  {batch.expiresAt && ` · Expires: ${new Date(batch.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <Badge variant="outline">{batch.creditAmount} credit each</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4 text-center text-sm">
              <div><div className="font-semibold">{batch.stats.total}</div><div className="text-muted-foreground text-xs">Total</div></div>
              <div><div className="font-semibold text-green-700">{batch.stats.active}</div><div className="text-muted-foreground text-xs">Active</div></div>
              <div><div className="font-semibold text-blue-700">{batch.stats.redeemed}</div><div className="text-muted-foreground text-xs">Redeemed</div></div>
              <div><div className="font-semibold text-yellow-700">{batch.stats.expired}</div><div className="text-muted-foreground text-xs">Expired</div></div>
              <div><div className="font-semibold text-red-700">{batch.stats.cancelled}</div><div className="text-muted-foreground text-xs">Cancelled</div></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
