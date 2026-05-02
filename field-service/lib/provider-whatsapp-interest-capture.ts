// ─── Provider WhatsApp interest capture ──────────────────────────────────────
// When a provider taps "I'm interested" on a dispatched opportunity the bot
// stores the lead id in conversation data and prompts for call-out fee and
// arrival time as free text. This module parses that follow-up text into a
// structured opportunity response so providers can complete interest capture
// entirely inside WhatsApp.
//
// Accepted shapes (case-insensitive):
//   "R250 | tomorrow morning"
//   "250, tomorrow 09:00"
//   "R 250 today 14:00"
//   "300 today afternoon"
//   "150 this evening"
//   "200 asap"

export type ParsedInterestRate = {
  callOutFee: number
  estimatedArrivalAt: Date
  raw: string
}

const FEE_PATTERN = /R?\s*(\d{2,5})/i

const TIME_PATTERN = /(\d{1,2})[:.](\d{2})\s*(am|pm)?/i
const SHORT_TIME_PATTERN = /(\d{1,2})\s*(am|pm)/i

const DAY_KEYWORDS: Array<{ words: string[]; offsetDays: number }> = [
  { words: ['today', 'tonight', 'this evening', 'this morning', 'this afternoon'], offsetDays: 0 },
  { words: ['tomorrow', 'tmr', 'tmrw'], offsetDays: 1 },
]

const RELATIVE_WINDOWS: Array<{ words: string[]; hour: number; minute: number; offsetDays: number }> = [
  { words: ['morning'], hour: 8, minute: 0, offsetDays: 0 },
  { words: ['afternoon'], hour: 13, minute: 0, offsetDays: 0 },
  { words: ['evening', 'tonight'], hour: 18, minute: 0, offsetDays: 0 },
  { words: ['asap', 'now'], hour: 0, minute: 0, offsetDays: 0 },
]

function parseFee(text: string): number | null {
  const match = text.match(FEE_PATTERN)
  if (!match) return null
  const numeric = Number(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000) return null
  return numeric
}

function parseArrival(text: string, now: Date): Date | null {
  const lower = text.toLowerCase()
  const baseDate = new Date(now)
  baseDate.setSeconds(0, 0)

  // ASAP / now → +1 hour
  if (/\b(asap|right now|immediately|now)\b/i.test(lower)) {
    const asap = new Date(baseDate)
    asap.setHours(baseDate.getHours() + 1, 0, 0, 0)
    return asap
  }

  let dayOffset = 0
  for (const day of DAY_KEYWORDS) {
    if (day.words.some((w) => lower.includes(w))) {
      dayOffset = day.offsetDays
      break
    }
  }

  let hour: number | null = null
  let minute = 0

  const timeMatch = lower.match(TIME_PATTERN)
  if (timeMatch) {
    const h = Number(timeMatch[1])
    const m = Number(timeMatch[2])
    const meridiem = (timeMatch[3] ?? '').toLowerCase()
    if (Number.isFinite(h) && Number.isFinite(m) && m >= 0 && m <= 59) {
      hour = h
      minute = m
      if (meridiem === 'pm' && hour < 12) hour += 12
      if (meridiem === 'am' && hour === 12) hour = 0
    }
  }

  if (hour == null) {
    const shortTime = lower.match(SHORT_TIME_PATTERN)
    if (shortTime) {
      const h = Number(shortTime[1])
      const meridiem = shortTime[2].toLowerCase()
      if (Number.isFinite(h) && h >= 1 && h <= 12) {
        hour = h
        if (meridiem === 'pm' && hour < 12) hour += 12
        if (meridiem === 'am' && hour === 12) hour = 0
      }
    }
  }

  if (hour == null) {
    for (const window of RELATIVE_WINDOWS) {
      if (window.words.some((w) => lower.includes(w))) {
        hour = window.hour
        minute = window.minute
        break
      }
    }
  }

  if (hour == null) return null
  if (hour < 0 || hour > 23) return null

  const candidate = new Date(baseDate)
  candidate.setDate(candidate.getDate() + dayOffset)
  candidate.setHours(hour, minute, 0, 0)
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}

export function parseProviderInterestRateText(
  text: string | null | undefined,
  options?: { now?: Date },
): ParsedInterestRate | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  // Split on | or , to separate fee from arrival when the provider used the
  // suggested format. Otherwise use the whole text for both extractors.
  const separatorIndex = trimmed.search(/[|,]/)
  const feePart = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed
  const arrivalPart = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed

  const callOutFee = parseFee(feePart) ?? parseFee(trimmed)
  if (callOutFee == null) return null

  const now = options?.now ?? new Date()
  const arrival = parseArrival(arrivalPart, now) ?? parseArrival(trimmed, now)
  if (!arrival) return null

  return { callOutFee, estimatedArrivalAt: arrival, raw: trimmed }
}
