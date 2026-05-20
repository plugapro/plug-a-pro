import { getInvoiceByToken } from '@/lib/server/client'
import { LinkExpiredScreen } from '@/components/client/link-expired-screen'

export const dynamic = 'force-dynamic'

export default async function TicketTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invoice = await getInvoiceByToken(token)
  if (!invoice) return <LinkExpiredScreen />

  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <div className="rounded-3xl border border-border bg-card p-5">
        <p className="text-sm font-semibold">Plug A Pro</p>
        <p className="font-mono text-xs text-[var(--ink-mute)]">Invoice #{invoice.number}</p>
        <p className="mt-2 text-3xl font-bold">R{Number(invoice.totalAmount).toFixed(2)}</p>
        <p className="mt-2 text-xs text-[var(--ink-mute)]">Public token receipt for WhatsApp in-app browser.</p>
      </div>
    </div>
  )
}

