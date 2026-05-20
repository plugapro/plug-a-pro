// GET /api/technician/earnings/statement?month=2026-02
// Returns an HTML document with print stylesheet - client calls window.print() to save as PDF.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) return new NextResponse('Forbidden', { status: 403 })

  const month = request.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse('Invalid month parameter (expected YYYY-MM)', { status: 400 })
  }

  const [year, mon] = month.split('-').map(Number)
  const start = new Date(year, mon - 1, 1)
  const end = new Date(year, mon, 0, 23, 59, 59, 999)

  const payouts = await db.providerPayout.findMany({
    where: { providerId: provider.id, createdAt: { gte: start, lte: end } },
    include: {
      job: {
        include: {
          booking: {
            include: {
              match: { include: { jobRequest: { include: { address: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const gross = payouts.reduce((a, p) => a + Number(p.grossAmount), 0)
  const commission = payouts.reduce((a, p) => a + Number(p.commissionAmt), 0)
  const net = payouts.reduce((a, p) => a + Number(p.netAmount), 0)
  const monthLabel = start.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rows = payouts.map((p) => {
    const req = p.job.booking.match.jobRequest
    const date = (p.job.completedAt ?? p.createdAt).toLocaleDateString('en-ZA', {
      day: 'numeric', month: 'short',
    })
    return `<tr>
      <td>${esc(date)}</td>
      <td>${esc(req.category)}</td>
      <td>${esc(req.address?.suburb ?? '-')}</td>
      <td>R ${Number(p.grossAmount).toFixed(2)}</td>
      <td>R ${Number(p.commissionAmt).toFixed(2)}</td>
      <td>R ${Number(p.netAmount).toFixed(2)}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Earnings Statement - ${esc(monthLabel)}</title>
  <style>
    body { font-family: sans-serif; font-size: 13px; color: #111; padding: 32px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; border-bottom: 2px solid #ddd; padding: 6px 8px; font-size: 11px; text-transform: uppercase; color: #666; }
    td { border-bottom: 1px solid #eee; padding: 6px 8px; }
    .summary { margin-top: 24px; padding: 16px; background: #f5f5f5; border-radius: 8px; }
    .summary table { margin-top: 0; }
    .summary td:first-child { color: #444; }
    .summary td:last-child { text-align: right; font-weight: 600; }
    .total td { font-weight: 700; border-top: 2px solid #ddd; padding-top: 10px; }
    .empty { text-align: center; color: #999; padding: 20px; }
    @media print { body { padding: 0; } button { display: none; } }
  </style>
</head>
<body>
  <h1>Plug A Pro</h1>
  <p class="subtitle">Earnings Statement - ${esc(monthLabel)} &middot; ${esc(provider.name)}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Category</th><th>Area</th>
        <th>Gross</th><th>Commission</th><th>Net</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6" class="empty">No completed jobs this month</td></tr>`}
    </tbody>
  </table>
  <div class="summary">
    <table>
      <tr><td>Gross earnings</td><td>R ${gross.toFixed(2)}</td></tr>
      <tr><td>Commission (15%)</td><td>&minus;R ${commission.toFixed(2)}</td></tr>
      <tr class="total"><td>Net payout</td><td>R ${net.toFixed(2)}</td></tr>
    </table>
  </div>
  <br>
  <button onclick="window.print()" style="padding:8px 16px;cursor:pointer;">Print / Save as PDF</button>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
