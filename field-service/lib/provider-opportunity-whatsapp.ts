export function parseProviderOpportunityArrivalText(value: string, now = new Date()) {
  const raw = value.trim().toLowerCase()
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed

  const base = new Date(now)
  if (raw.includes('tomorrow')) base.setDate(base.getDate() + 1)
  else if (!raw.includes('today')) return null

  if (raw.includes('morning')) base.setHours(9, 0, 0, 0)
  else if (raw.includes('afternoon')) base.setHours(14, 0, 0, 0)
  else if (raw.includes('evening')) base.setHours(17, 0, 0, 0)
  else base.setHours(Math.max(now.getHours() + 1, 9), 0, 0, 0)

  return base
}
