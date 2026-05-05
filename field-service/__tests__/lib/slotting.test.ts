// ─── ProviderSchedule tests ───────────────────────────────────────────────────
//
// TODO: The old Slot model and its associated slotting engine (getAvailableSlots,
// holdSlot, releaseSlot, generateSlots) have been removed from the schema.
// Availability is now modelled via ProviderSchedule { providerId, dayOfWeek,
// startTime, endTime }.
//
// These tests should be rewritten once the ProviderSchedule query helpers are
// implemented in @/lib/schedules (or equivalent). Expected coverage:
//
//   • getProviderSchedule(providerId) — returns the weekly schedule for a provider
//   • getProvidersAvailableOn(dayOfWeek, serviceArea) — filters providers by day
//   • upsertSchedule(providerId, days) — creates or updates schedule rows
//
// Tracking issue: update this file when @/lib/schedules is shipped.

import { describe, it } from 'vitest'

describe('ProviderSchedule', () => {
  it.todo('getProviderSchedule returns schedule rows for a provider')
  it.todo('getProvidersAvailableOn filters by dayOfWeek and serviceArea')
  it.todo('upsertSchedule creates new schedule rows')
  it.todo('upsertSchedule updates existing schedule rows')
})
