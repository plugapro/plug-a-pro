export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { requireRole } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Team Permissions', noIndex: true })

const CAPABILITIES = [
  {
    name: 'Operations dashboard and queues',
    minimumRole: 'OPS',
    summary: 'View and work queue modules such as validation, dispatch, field exceptions, quotes, bookings, disputes, and payments.',
  },
  {
    name: 'Customer and provider mutations',
    minimumRole: 'OPS',
    summary: 'Run flagged CRUD-style mutations such as block, suspend, verify, note, and location updates.',
  },
  {
    name: 'Financial operations',
    minimumRole: 'FINANCE',
    summary: 'Access payment-specific workflows and future refund / reconciliation controls.',
  },
  {
    name: 'Trust and safety interventions',
    minimumRole: 'TRUST',
    summary: 'Handle provider trust actions, KYC review, and risk-led interventions.',
  },
  {
    name: 'Platform administration',
    minimumRole: 'ADMIN',
    summary: 'Manage broad platform settings and non-owner admin workflows as those surfaces are added.',
  },
  {
    name: 'Team management and owner safety actions',
    minimumRole: 'OWNER',
    summary: 'Invite admins, change admin roles, deactivate admins, and retain the last-owner safety rail.',
  },
]

const ROLE_SUMMARY = [
  {
    role: 'OPS',
    description: 'Queue operations, dispatch, and day-to-day marketplace administration.',
  },
  {
    role: 'FINANCE',
    description: 'Everything OPS can do, plus finance-oriented controls and reporting.',
  },
  {
    role: 'TRUST',
    description: 'Everything FINANCE can do, plus trust, safety, and KYC-related interventions.',
  },
  {
    role: 'ADMIN',
    description: 'Everything TRUST can do, plus higher-level platform administration.',
  },
  {
    role: 'OWNER',
    description: 'Full platform control, including team access management and last-owner safety decisions.',
  },
]

export default async function TeamPermissionsPage() {
  await requireRole(['OWNER'])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Permission matrix</h1>
          <p className="text-sm text-muted-foreground">
            Canonical reference for the current admin role ladder and expected capability boundaries.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/team">Back to team</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {ROLE_SUMMARY.map((item) => (
          <Card key={item.role}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge variant={item.role === 'OWNER' || item.role === 'ADMIN' ? 'default' : 'secondary'}>
                  {item.role}
                </Badge>
                <span>{item.role}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {item.description}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capability floor</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Minimum role</TableHead>
                <TableHead className="hidden md:table-cell">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CAPABILITIES.map((capability) => (
                <TableRow key={capability.name}>
                  <TableCell className="font-medium">{capability.name}</TableCell>
                  <TableCell>
                    <Badge variant={capability.minimumRole === 'OWNER' || capability.minimumRole === 'ADMIN' ? 'default' : 'secondary'}>
                      {capability.minimumRole}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {capability.summary}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
