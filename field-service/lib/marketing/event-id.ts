// Deterministic event id for client/server conversion deduplication.
//
// Meta CAPI and GA4 Measurement Protocol both dedupe by `event_id` when a
// browser-side Pixel event and a server-side event refer to the same business
// event. Building it from the event name + the business entity id (booking,
// payment, quote, job) makes the value reconstructable on either side without
// passing state through — they just need to agree on the entity that anchors
// the conversion.
//
// Pure function, no DB / fetch / time, so this file is safe to import from any
// runtime (edge, node, browser, test).

export function eventId(eventName: string, entityId: string): string {
  // Trim because PSP webhooks have occasionally sent reference IDs with
  // trailing whitespace; we'd hate to break dedup for that.
  return `${eventName}:${entityId.trim()}`
}
