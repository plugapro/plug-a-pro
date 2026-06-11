import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { VENDOR_MONTHLY_FREE_TIER_DEFAULT } from '@/lib/kyc-fee/constants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createKycCampaignFromFormAction,
  grantKycSponsorshipFromFormAction,
  listKycCampaignsAction,
  revokeKycSponsorshipFromFormAction,
  setKycCampaignStatusFromFormAction,
} from './actions'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline',
  ACTIVE: 'default',
  PAUSED: 'secondary',
  CLOSED: 'destructive',
}

const NEXT_STATUSES: Record<string, string[]> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
}

export default async function AdminKycCampaignsPage() {
  const enabled = await isEnabled('admin.kyc_campaigns')
  if (!enabled) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            The KYC campaigns feature is not enabled. Enable the{' '}
            <code className="font-mono text-xs">admin.kyc_campaigns</code> flag to use it.
          </CardContent>
        </Card>
      </div>
    )
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const [campaigns, vendorChecksThisMonth] = await Promise.all([
    listKycCampaignsAction(),
    db.providerIdentityVerification.count({
      where: { vendorReference: { not: null }, createdAt: { gte: monthStart } },
    }),
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Launch KYC campaigns</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sponsor the once-off ID verification fee for the first N verified providers in a
          launch area. Sponsorships are granted automatically on successful verification
          while a campaign is active and has allocation remaining.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor checks this month</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            <span className="font-semibold">{vendorChecksThisMonth}</span> verification
            checks submitted to the vendor since {monthStart.toLocaleDateString()}.
            Free-tier allowance: {VENDOR_MONTHLY_FREE_TIER_DEFAULT}/month (reconcile against
            the vendor invoice monthly — this counter is informational and separate from
            campaign allocations).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createKycCampaignFromFormAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="West Rand launch" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaignCode">Campaign code</Label>
              <Input id="campaignCode" name="campaignCode" placeholder="WEST_RAND_LAUNCH" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="locationNodeSlug">Area slug (blank = global)</Label>
              <Input
                id="locationNodeSlug"
                name="locationNodeSlug"
                placeholder="gauteng__johannesburg__jhb_west"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="maxSponsoredCount">Max sponsored providers</Label>
              <Input
                id="maxSponsoredCount"
                name="maxSponsoredCount"
                type="number"
                min={1}
                placeholder="200"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="startsAt">Starts</Label>
              <Input id="startsAt" name="startsAt" type="datetime-local" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endsAt">Ends (optional)</Label>
              <Input id="endsAt" name="endsAt" type="datetime-local" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Create as draft</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {campaigns.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No campaigns yet. Create one above — it starts as DRAFT and only sponsors once
            activated.
          </CardContent>
        </Card>
      )}

      {campaigns.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{c.name}</CardTitle>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Code: <code className="font-mono">{c.campaignCode}</code>
                  {' · '}Area: {c.areaLabel ?? 'Global'}
                  {' · '}
                  {new Date(c.startsAt).toLocaleDateString()} →{' '}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : 'open-ended'}
                </p>
              </div>
              <Badge variant={STATUS_BADGE[c.status] ?? 'outline'}>{c.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center text-sm">
              <div>
                <p className="font-semibold">{c.maxSponsoredCount}</p>
                <p className="text-muted-foreground text-xs">Allocation</p>
              </div>
              <div>
                <p className="font-semibold">{c.consumed}</p>
                <p className="text-muted-foreground text-xs">Sponsored</p>
              </div>
              <div>
                <p className="font-semibold">{c.reversed}</p>
                <p className="text-muted-foreground text-xs">Reversed</p>
              </div>
              <div>
                <p className="font-semibold">{c.remaining}</p>
                <p className="text-muted-foreground text-xs">Remaining</p>
              </div>
            </div>
            <div className="flex gap-2">
              {NEXT_STATUSES[c.status].map((next) => (
                <form key={next} action={setKycCampaignStatusFromFormAction}>
                  <input type="hidden" name="campaignId" value={c.id} />
                  <input type="hidden" name="status" value={next} />
                  <Button
                    type="submit"
                    size="sm"
                    variant={next === 'CLOSED' ? 'destructive' : 'outline'}
                  >
                    {next === 'ACTIVE' ? 'Activate' : next === 'PAUSED' ? 'Pause' : 'Close'}
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual grant</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={grantKycSponsorshipFromFormAction} className="grid gap-3 sm:grid-cols-3">
            <Input name="campaignId" placeholder="Campaign ID" required />
            <Input name="providerId" placeholder="Provider ID" required />
            <Input name="reason" placeholder="Reason (audited)" required />
            <div className="sm:col-span-3">
              <Button type="submit" variant="outline">
                Grant sponsorship
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revoke sponsorship</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={revokeKycSponsorshipFromFormAction} className="grid gap-3 sm:grid-cols-2">
            <Input name="sponsorshipId" placeholder="Sponsorship ID" required />
            <Input name="reason" placeholder="Reason (audited)" required />
            <div className="sm:col-span-2">
              <Button type="submit" variant="destructive">
                Revoke
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
