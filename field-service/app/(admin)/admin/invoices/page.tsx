export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { EmptyState } from '@/components/shared/EmptyState'
import { VoidInvoiceButton } from './_components/VoidInvoiceButton'
import { generateInvoiceFromFormAction, sendInvoiceFromFormAction } from './actions'

export const metadata = buildMetadata({ title: 'Invoices', noIndex: true })

const FLAG = 'admin.invoices.actions'

function formatCurrency(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function AdminInvoicesPage() {
  const admin = await requireAdmin()
  const actionsEnabled = await isEnabled(FLAG, { userId: admin.id })

  const invoices = await db.invoice.findMany({
    select: {
      id: true,
      number: true,
      pdfUrl: true,
      sentAt: true,
      totalAmount: true,
      createdAt: true,
      booking: {
        select: {
          id: true,
          status: true,
          match: {
            select: {
              jobRequest: {
                select: {
                  title: true,
                  customer: { select: { id: true, name: true } },
                },
              },
              provider: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      {!actionsEnabled && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Invoice mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate, send and void customer invoices.
          </p>
        </div>
        <Badge variant={invoices.length > 0 ? 'neutral' : 'outline'}>{invoices.length} total</Badge>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices"
          description="Invoices are generated from completed bookings."
        />
      ) : (
        <div className="space-y-4">
          {invoices.map((invoice) => {
            const customer = invoice.booking.match.jobRequest.customer
            const provider = invoice.booking.match.provider

            return (
              <Card key={invoice.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {invoice.booking.match.jobRequest.title}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {customer.name} · {provider.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={invoice.pdfUrl ? 'success' : 'outline'}>
                        {invoice.pdfUrl ? 'PDF ready' : 'Not generated'}
                      </Badge>
                      <Badge variant={invoice.sentAt ? 'neutral' : 'outline'}>
                        {invoice.sentAt ? `Sent ${formatDate(invoice.sentAt)}` : 'Not sent'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">#{invoice.number}</Badge>
                    <Badge variant="outline">{formatCurrency(Number(invoice.totalAmount))}</Badge>
                    {invoice.pdfUrl && (
                      <Badge variant="outline">
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          View PDF
                        </a>
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!invoice.pdfUrl && (
                      <ActionForm
                        action={generateInvoiceFromFormAction}
                        successMessage="Invoice generated"
                        refreshOnSuccess
                      >
                        <input type="hidden" name="bookingId" value={invoice.booking.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!actionsEnabled}>
                          Generate PDF
                        </SubmitButton>
                      </ActionForm>
                    )}

                    {invoice.pdfUrl && !invoice.sentAt && (
                      <ActionForm
                        action={sendInvoiceFromFormAction}
                        successMessage="Invoice sent to customer"
                        refreshOnSuccess
                      >
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!actionsEnabled}>
                          Send to customer
                        </SubmitButton>
                      </ActionForm>
                    )}

                    {invoice.pdfUrl && (
                      <VoidInvoiceButton
                        invoiceId={invoice.id}
                        invoiceNumber={invoice.number}
                        disabled={!actionsEnabled}
                      />
                    )}

                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/customers/${customer.id}`}>Open customer</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/bookings/${invoice.booking.id}`}>Open booking</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
