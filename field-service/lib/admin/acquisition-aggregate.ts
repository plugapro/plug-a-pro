// Pure aggregation helpers for the /admin/reports/acquisition page.
// Kept side-effect-free so they can be unit-tested without Prisma.

export type AcquisitionRow = {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  paid: boolean
  amount: number | null
}

export type ChannelGroup =
  | 'paid_search'
  | 'paid_social'
  | 'organic'
  | 'direct'
  | 'unknown'

export type AggregateBucket = {
  key: string
  bookings: number
  paidBookings: number
  revenue: number
}

// Classify a row into one of five mutually-exclusive channel groups.
// Direct = no UTM data at all. Unknown = has UTM data but doesn't match a known
// paid/organic medium — surfaced so unmapped traffic doesn't silently disappear.
export function classifyChannel(row: {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}): ChannelGroup {
  const medium = row.utmMedium?.toLowerCase() ?? null
  if (medium === 'cpc') return 'paid_search'
  if (medium === 'paid_social') return 'paid_social'
  if (medium === 'organic') return 'organic'
  if (!row.utmSource && !row.utmMedium && !row.utmCampaign) return 'direct'
  return 'unknown'
}

// Reduce rows into buckets keyed by an arbitrary string. Counts bookings, paid
// bookings, and sums revenue from paid bookings only.
function aggregate(
  rows: AcquisitionRow[],
  keyOf: (r: AcquisitionRow) => string | null,
): AggregateBucket[] {
  const map = new Map<string, AggregateBucket>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key == null) continue
    const bucket = map.get(key) ?? { key, bookings: 0, paidBookings: 0, revenue: 0 }
    bucket.bookings += 1
    if (row.paid) {
      bucket.paidBookings += 1
      bucket.revenue += row.amount ?? 0
    }
    map.set(key, bucket)
  }
  return [...map.values()]
}

export function aggregateByChannel(rows: AcquisitionRow[]): AggregateBucket[] {
  const buckets = aggregate(rows, (r) => classifyChannel(r))
  // Stable ordering matches the visual hierarchy in the report UI.
  const order: ChannelGroup[] = ['paid_search', 'paid_social', 'organic', 'direct', 'unknown']
  return buckets.sort(
    (a, b) =>
      order.indexOf(a.key as ChannelGroup) - order.indexOf(b.key as ChannelGroup),
  )
}

export function aggregateBySource(
  rows: AcquisitionRow[],
  limit = 10,
): AggregateBucket[] {
  return aggregate(rows, (r) => r.utmSource)
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, limit)
}

export function aggregateByCampaign(
  rows: AcquisitionRow[],
  limit = 10,
): AggregateBucket[] {
  return aggregate(rows, (r) => r.utmCampaign)
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, limit)
}

export function formatChannelLabel(key: string): string {
  switch (key) {
    case 'paid_search':
      return 'Paid search'
    case 'paid_social':
      return 'Paid social'
    case 'organic':
      return 'Organic'
    case 'direct':
      return 'Direct'
    case 'unknown':
      return 'Unknown'
    default:
      return key
  }
}
