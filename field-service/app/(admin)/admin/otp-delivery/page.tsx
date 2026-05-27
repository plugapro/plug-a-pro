export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'

export const metadata = buildMetadata({ title: 'OTP Delivery', noIndex: true })

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  const normalized = status.toLowerCase()
  if (normalized === 'failed') return 'destructive'
  if (normalized === 'delivered' || normalized === 'read' || normalized === 'sent') return 'default'
  return 'secondary'
}

function formatDate(date: Date): string {
  return `${date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} ${date.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export default async function OtpDeliveryPage() {
  await requireAdmin()

  const attempts = await db.otpDeliveryAttempt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">OTP Delivery</h1>
        <p className="text-sm text-muted-foreground">WhatsApp OTP delivery attempts from the Plug A Pro WABA sender.</p>
      </div>

      {attempts.length === 0 ? (
        <EmptyState
          title="No OTP delivery attempts"
          description="Attempt records appear here when auth OTP sends are triggered."
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Showing last {attempts.length} attempts</p>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">To</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Failure code</th>
                  <th className="px-3 py-2">Failure reason</th>
                  <th className="px-3 py-2">Message ID</th>
                  <th className="px-3 py-2">Hook request</th>
                  <th className="px-3 py-2">User</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(attempt.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{attempt.phoneE164}</td>
                    <td className="px-3 py-2">{attempt.templateName ?? 'otp_login'}</td>
                    <td className="px-3 py-2">{attempt.channel}</td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(attempt.status)} className="capitalize">
                        {attempt.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{attempt.failureCode ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs break-words">
                      {attempt.failureReason ?? '-'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {attempt.whatsappMessageId ?? '-'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{attempt.hookRequestId ?? '-'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{attempt.userId ?? 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
