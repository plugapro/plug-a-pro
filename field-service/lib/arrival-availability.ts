const TZ_OFFSET = '+02:00'

export type ArrivalAvailabilityRuleCode =
  | 'ANY_TIME'
  | 'MORNING'
  | 'AFTERNOON'
  | 'EVENING'
  | 'WEEKEND'
  | 'WEEKDAY'
  | 'SPECIFIC_WINDOW'
  | 'ARRIVAL_LATEST'

export type ArrivalValidationErrorCode =
  | 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY'
  | 'ARRIVAL_END_BEFORE_START'
  | 'ARRIVAL_DATE_IN_PAST'
  | 'INVALID_ARRIVAL_TIME'

export type ArrivalAvailabilityInput = {
  requestedWindowStart?: Date | null
  requestedWindowEnd?: Date | null
  requestedArrivalLatest?: Date | null
  description?: string | null
}

export type ArrivalAvailabilitySummary = {
  label: string
  helper: string
  rule: ArrivalAvailabilityRuleCode
  note: string | null
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  requestedArrivalLatest: Date | null
  allowedWindows: string[]
}

export type ArrivalValidationResult =
  | {
      isValid: true
      label: string
      allowedWindows: string[]
      errorCode: null
      reason: null
    }
  | {
      isValid: false
      label: string
      allowedWindows: string[]
      errorCode: ArrivalValidationErrorCode
      reason: string
    }

const PERIODS = {
  MORNING: { start: '06:00', end: '12:00', label: 'between 06:00 and 12:00' },
  AFTERNOON: { start: '12:00', end: '17:00', label: 'between 12:00 and 17:00' },
  EVENING: { start: '17:00', end: '20:00', label: 'between 17:00 and 20:00' },
} as const

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value)
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function dateInputValue(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

function timeInputValue(value: Date) {
  return [
    String(value.getHours()).padStart(2, '0'),
    String(value.getMinutes()).padStart(2, '0'),
  ].join(':')
}

function extractAvailabilityNote(description: string | null | undefined) {
  const trimmed = description?.trim() ?? ''
  const match = trimmed.match(/preferred availability:\s*([^\n.]+)/i)
  return (match?.[1] ?? '').trim() || null
}

function ruleFromNote(note: string | null): ArrivalAvailabilityRuleCode {
  const normalized = note?.toLowerCase() ?? ''
  if (/\bmorning/.test(normalized)) return 'MORNING'
  if (/\bafternoon/.test(normalized)) return 'AFTERNOON'
  if (/\bevening/.test(normalized)) return 'EVENING'
  if (/\bweekend|sat|sun/.test(normalized)) return 'WEEKEND'
  if (/\bweekday|monday|mon.?fri|this week/.test(normalized)) return 'WEEKDAY'
  return 'ANY_TIME'
}

export function getCustomerAvailabilitySummary(input: ArrivalAvailabilityInput): ArrivalAvailabilitySummary {
  if (input.requestedWindowStart && input.requestedWindowEnd) {
    const label = `Specific date: ${formatDate(input.requestedWindowStart)}, ${formatTime(input.requestedWindowStart)}-${formatTime(input.requestedWindowEnd)}`
    return {
      label,
      helper: 'Choose an arrival window that fits the customer’s requested availability.',
      rule: 'SPECIFIC_WINDOW',
      note: null,
      requestedWindowStart: input.requestedWindowStart,
      requestedWindowEnd: input.requestedWindowEnd,
      requestedArrivalLatest: input.requestedArrivalLatest ?? null,
      allowedWindows: [label],
    }
  }

  if (input.requestedArrivalLatest) {
    const label = `Before ${formatDate(input.requestedArrivalLatest)}, ${formatTime(input.requestedArrivalLatest)}`
    return {
      label,
      helper: 'Choose an arrival window that fits the customer’s requested availability.',
      rule: 'ARRIVAL_LATEST',
      note: null,
      requestedWindowStart: input.requestedWindowStart ?? null,
      requestedWindowEnd: input.requestedWindowEnd ?? null,
      requestedArrivalLatest: input.requestedArrivalLatest,
      allowedWindows: [label],
    }
  }

  const note = extractAvailabilityNote(input.description)
  const rule = ruleFromNote(note)
  const labelByRule: Record<ArrivalAvailabilityRuleCode, string> = {
    ANY_TIME: note || 'No preferred availability captured.',
    MORNING: 'Mornings only',
    AFTERNOON: 'Afternoons only',
    EVENING: 'Evenings only',
    WEEKEND: 'Weekends only',
    WEEKDAY: note || 'Weekdays only',
    SPECIFIC_WINDOW: 'Specific date',
    ARRIVAL_LATEST: 'Before requested time',
  }
  const allowedByRule: Record<ArrivalAvailabilityRuleCode, string[]> = {
    ANY_TIME: ['Any date and time'],
    MORNING: ['Any day between 06:00 and 12:00'],
    AFTERNOON: ['Any day between 12:00 and 17:00'],
    EVENING: ['Any day between 17:00 and 20:00'],
    WEEKEND: ['Saturday or Sunday'],
    WEEKDAY: ['Monday to Friday'],
    SPECIFIC_WINDOW: [],
    ARRIVAL_LATEST: [],
  }

  return {
    label: labelByRule[rule],
    helper: rule === 'ANY_TIME'
      ? 'No preferred availability captured.'
      : 'Choose an arrival window that fits the customer’s requested availability.',
    rule,
    note,
    requestedWindowStart: input.requestedWindowStart ?? null,
    requestedWindowEnd: input.requestedWindowEnd ?? null,
    requestedArrivalLatest: input.requestedArrivalLatest ?? null,
    allowedWindows: allowedByRule[rule],
  }
}

function minutesSinceMidnight(value: Date) {
  return value.getHours() * 60 + value.getMinutes()
}

function periodMinutes(period: keyof typeof PERIODS) {
  const [startHour, startMinute] = PERIODS[period].start.split(':').map(Number)
  const [endHour, endMinute] = PERIODS[period].end.split(':').map(Number)
  return {
    start: startHour * 60 + startMinute,
    end: endHour * 60 + endMinute,
  }
}

function isWeekend(value: Date) {
  const day = value.getDay()
  return day === 0 || day === 6
}

function inPeriod(start: Date, end: Date, period: keyof typeof PERIODS) {
  if (dateInputValue(start) !== dateInputValue(end)) return false
  const window = periodMinutes(period)
  return minutesSinceMidnight(start) >= window.start && minutesSinceMidnight(end) <= window.end
}

export function validateArrivalWindowAgainstCustomerAvailability(params: {
  availability: ArrivalAvailabilitySummary
  proposedStart: Date
  proposedEnd?: Date | null
  now?: Date
}): ArrivalValidationResult {
  const { availability, proposedStart } = params
  const proposedEnd = params.proposedEnd ?? proposedStart
  const now = params.now ?? new Date()

  if (Number.isNaN(proposedStart.getTime()) || Number.isNaN(proposedEnd.getTime())) {
    return {
      isValid: false,
      label: availability.label,
      allowedWindows: availability.allowedWindows,
      errorCode: 'INVALID_ARRIVAL_TIME',
      reason: 'The selected arrival date or time is invalid.',
    }
  }

  if (proposedEnd < proposedStart) {
    return {
      isValid: false,
      label: availability.label,
      allowedWindows: availability.allowedWindows,
      errorCode: 'ARRIVAL_END_BEFORE_START',
      reason: 'Arrival end time must be after the start time.',
    }
  }

  if (proposedStart < now) {
    return {
      isValid: false,
      label: availability.label,
      allowedWindows: availability.allowedWindows,
      errorCode: 'ARRIVAL_DATE_IN_PAST',
      reason: 'Arrival time cannot be in the past.',
    }
  }

  const outside = (detail: string): ArrivalValidationResult => ({
    isValid: false,
    label: availability.label,
    allowedWindows: availability.allowedWindows,
    errorCode: 'ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY',
    reason: `Selected time is outside the customer’s requested availability: ${availability.label}. ${detail}`,
  })

  switch (availability.rule) {
    case 'SPECIFIC_WINDOW':
      if (
        availability.requestedWindowStart &&
        availability.requestedWindowEnd &&
        (proposedStart < availability.requestedWindowStart || proposedEnd > availability.requestedWindowEnd)
      ) {
        return outside(`Please choose a time inside ${formatTime(availability.requestedWindowStart)}-${formatTime(availability.requestedWindowEnd)} on ${formatDate(availability.requestedWindowStart)}, or contact the customer before scheduling this time.`)
      }
      break
    case 'ARRIVAL_LATEST':
      if (availability.requestedArrivalLatest && proposedEnd > availability.requestedArrivalLatest) {
        return outside(`Please choose a time before ${formatTime(availability.requestedArrivalLatest)} on ${formatDate(availability.requestedArrivalLatest)}, or contact the customer before scheduling this time.`)
      }
      break
    case 'MORNING':
      if (!inPeriod(proposedStart, proposedEnd, 'MORNING')) {
        return outside(`Please choose a time ${PERIODS.MORNING.label}, or contact the customer before scheduling this time.`)
      }
      break
    case 'AFTERNOON':
      if (!inPeriod(proposedStart, proposedEnd, 'AFTERNOON')) {
        return outside(`Please choose a time ${PERIODS.AFTERNOON.label}, or contact the customer before scheduling this time.`)
      }
      break
    case 'EVENING':
      if (!inPeriod(proposedStart, proposedEnd, 'EVENING')) {
        return outside(`Please choose a time ${PERIODS.EVENING.label}, or contact the customer before scheduling this time.`)
      }
      break
    case 'WEEKEND':
      if (!isWeekend(proposedStart) || !isWeekend(proposedEnd)) {
        return outside('Please choose Saturday or Sunday, or contact the customer before scheduling this time.')
      }
      break
    case 'WEEKDAY':
      if (isWeekend(proposedStart) || isWeekend(proposedEnd)) {
        return outside('Please choose Monday to Friday, or contact the customer before scheduling this time.')
      }
      break
    case 'ANY_TIME':
      break
  }

  return {
    isValid: true,
    label: availability.label,
    allowedWindows: availability.allowedWindows,
    errorCode: null,
    reason: null,
  }
}

function withDateAndTime(date: Date, time: string) {
  return new Date(`${dateInputValue(date)}T${time}:00${TZ_OFFSET}`)
}

function nextDateMatching(from: Date, predicate: (date: Date) => boolean) {
  const date = new Date(from)
  date.setHours(0, 0, 0, 0)
  for (let i = 0; i < 14; i += 1) {
    if (predicate(date) && date >= new Date(from.getFullYear(), from.getMonth(), from.getDate())) return date
    date.setDate(date.getDate() + 1)
  }
  return new Date(from)
}

export function deriveDefaultArrivalWindow(availability: ArrivalAvailabilitySummary, now = new Date()) {
  if (availability.rule === 'SPECIFIC_WINDOW' && availability.requestedWindowStart) {
    return {
      date: dateInputValue(availability.requestedWindowStart),
      start: timeInputValue(availability.requestedWindowStart),
      end: availability.requestedWindowEnd ? timeInputValue(availability.requestedWindowEnd) : '',
    }
  }

  if (availability.rule === 'ARRIVAL_LATEST' && availability.requestedArrivalLatest) {
    const start = new Date(availability.requestedArrivalLatest.getTime() - 2 * 60 * 60 * 1000)
    return {
      date: dateInputValue(start > now ? start : now),
      start: timeInputValue(start > now ? start : now),
      end: timeInputValue(availability.requestedArrivalLatest),
    }
  }

  const defaultByRule: Record<ArrivalAvailabilityRuleCode, { start: string; end: string }> = {
    ANY_TIME: { start: '09:00', end: '11:00' },
    MORNING: { start: '08:00', end: '10:00' },
    AFTERNOON: { start: '13:00', end: '15:00' },
    EVENING: { start: '17:00', end: '19:00' },
    WEEKEND: { start: '09:00', end: '11:00' },
    WEEKDAY: { start: '09:00', end: '11:00' },
    SPECIFIC_WINDOW: { start: '09:00', end: '11:00' },
    ARRIVAL_LATEST: { start: '09:00', end: '11:00' },
  }
  const times = defaultByRule[availability.rule]
  const date = nextDateMatching(now, (candidate) => {
    if (availability.rule === 'WEEKEND') return isWeekend(candidate)
    if (availability.rule === 'WEEKDAY') return !isWeekend(candidate)
    return withDateAndTime(candidate, times.start) > now
  })

  return {
    date: dateInputValue(date),
    start: times.start,
    end: times.end,
  }
}
