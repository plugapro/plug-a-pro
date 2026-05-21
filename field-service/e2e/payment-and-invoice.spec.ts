// E2E — Payment and invoice API auth guards
//
// Verifies that payment-related and invoice API endpoints require a valid
// customer session and that the PSP webhook rejects unsigned payloads:
//
//   1. Booking creation (payment initiation path) requires auth (401)
//   2. Invoice download for a specific booking requires auth (401)
//   3. Fetching the customer bookings list requires auth (401)
//   4. Payment webhook endpoint rejects requests without a valid PSP signature
//   5. (Conditional) Invoice PDF is accessible for a completed booking with a
//      valid session token — verifies content-type and PDF magic bytes
//
// Required env vars:
//   E2E_BASE_URL — full URL of the environment under test
//
// Optional env vars:
//   E2E_BYPASS_BOOKING_ID        — ID of a seeded booking in COMPLETED state
//   E2E_CUSTOMER_SESSION_TOKEN   — Supabase session token for a customer who owns
//                                   the above booking

import { test, expect } from '@playwright/test'

// ─── Auth guard — booking creation (payment initiation path) ─────────────────

test('booking creation endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/customer/bookings', {
    data: {
      category: 'plumbing',
      title: 'Leaking tap',
      addressLine1: '1 Test Street',
      locationNodeId: 'nonexistent-node',
    },
  })
  expect(res.status()).toBe(401)
})

// ─── Auth guard — invoice download ───────────────────────────────────────────

test('invoice download endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.get('/api/customer/bookings/nonexistent-booking-id/invoice')
  expect(res.status()).toBe(401)
})

// ─── Auth guard — customer bookings list ─────────────────────────────────────

test('customer bookings list endpoint returns 401 without auth', async ({ request }) => {
  // GET /api/customer/bookings is not currently exposed (only POST exists).
  // This test confirms the endpoint does not leak an unguarded 200 response;
  // 401, 404, or 405 are all acceptable — anything except 200.
  const res = await request.get('/api/customer/bookings')
  expect(res.status()).not.toBe(200)
})

// ─── Webhook — unsigned payload rejection ─────────────────────────────────────

test('payment webhook endpoint rejects unsigned payloads', async ({ request }) => {
  // The webhook handler verifies an HMAC signature from the PSP before
  // processing. An unsigned (or incorrectly signed) payload must not return 200.
  const res = await request.post('/api/webhooks/payments', {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ booking_id: 'test', status: 'COMPLETE' }),
  })
  // A missing or invalid signature returns 401; any non-200 response is
  // acceptable — we only need to confirm unsigned webhooks are never processed.
  expect(res.status()).not.toBe(200)
})

// ─── Optional smoke — invoice PDF for a completed booking ────────────────────

test('invoice PDF is accessible for a completed booking', async ({ request }) => {
  const bookingId = process.env.E2E_BYPASS_BOOKING_ID
  const sessionToken = process.env.E2E_CUSTOMER_SESSION_TOKEN

  if (!bookingId || !sessionToken) {
    test.skip(true, 'E2E_BYPASS_BOOKING_ID and E2E_CUSTOMER_SESSION_TOKEN not set — skipping completed booking invoice smoke')
    return
  }

  const res = await request.get(`/api/customer/bookings/${bookingId}/invoice`, {
    headers: {
      Cookie: `sb-access-token=${sessionToken}`,
    },
  })

  expect(res.status()).toBe(200)

  const contentType = res.headers()['content-type'] ?? ''
  expect(contentType).toContain('application/pdf')

  // Verify PDF magic bytes — first 4 bytes must be "%PDF"
  const body = await res.body()
  const magic = body.slice(0, 4).toString('ascii')
  expect(magic).toBe('%PDF')
})
