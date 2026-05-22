// ─── Webhook handler tests ────────────────────────────────────────────────────
// Tests the WhatsApp webhook verification and payment webhook parsing.
// No DB connections — all external dependencies are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    business: { findUnique: vi.fn().mockResolvedValue({ id: 'biz_1', slug: 'test-co' }) },
    messageEvent: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    booking: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/whatsapp-bot', () => ({
  processInboundMessage: vi.fn().mockResolvedValue(undefined),
}))

// ─── WhatsApp webhook challenge verification ──────────────────────────────────

import { verifyWebhookChallenge } from '@/lib/webhook-auth'

describe('verifyWebhookChallenge', () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token-123'
  })

  it('returns the challenge when mode and token match', () => {
    const result = verifyWebhookChallenge('subscribe', 'test-verify-token-123', 'abc123')
    expect(result).toBe('abc123')
  })

  it('returns null when verify token does not match', () => {
    const result = verifyWebhookChallenge('subscribe', 'wrong-token', 'abc123')
    expect(result).toBeNull()
  })

  it('returns null when mode is not subscribe', () => {
    const result = verifyWebhookChallenge('unsubscribe', 'test-verify-token-123', 'abc123')
    expect(result).toBeNull()
  })

  it('returns null when challenge is null', () => {
    const result = verifyWebhookChallenge('subscribe', 'test-verify-token-123', null)
    expect(result).toBeNull()
  })

  it('returns null when mode is null', () => {
    const result = verifyWebhookChallenge(null, 'test-verify-token-123', 'abc123')
    expect(result).toBeNull()
  })
})

// ─── WhatsApp delivery receipt processing ────────────────────────────────────

import { processWebhookEvent } from '@/lib/whatsapp'
import { db } from '@/lib/db'

describe('processWebhookEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates message status to DELIVERED on delivery receipt', async () => {
    await processWebhookEvent({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'msg_ext_1',
                    status: 'delivered',
                    timestamp: '1234567890',
                    recipient_id: '+27821234567',
                    conversation: undefined,
                    pricing: undefined,
                    errors: undefined,
                  },
                ],
                messages: [],
              },
              field: 'messages',
            },
          ],
        },
      ],
    })

    expect(db.messageEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: 'msg_ext_1' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      })
    )
  })

  it('updates message status to READ on read receipt', async () => {
    await processWebhookEvent({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'msg_ext_2',
                    status: 'read',
                    timestamp: '1234567890',
                    recipient_id: '+27821234567',
                    conversation: undefined,
                    pricing: undefined,
                    errors: undefined,
                  },
                ],
                messages: [],
              },
              field: 'messages',
            },
          ],
        },
      ],
    })

    expect(db.messageEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: 'msg_ext_2' },
        data: expect.objectContaining({ status: 'READ' }),
      })
    )
  })

  it('handles empty payload gracefully', async () => {
    await expect(
      processWebhookEvent({
        object: 'whatsapp_business_account',
        entry: [],
      })
    ).resolves.not.toThrow()

    expect(db.messageEvent.updateMany).not.toHaveBeenCalled()
  })
})

// ─── Payment webhook HMAC verification ───────────────────────────────────────

import { verifyWebhookSignature } from '@/lib/payments'

describe('verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.PEACH_WEBHOOK_SECRET = 'test-webhook-secret'
  })

  it('returns false when secret is not configured', () => {
    delete process.env.PEACH_WEBHOOK_SECRET
    const result = verifyWebhookSignature('raw body', 'any-signature')
    expect(result).toBe(false)
  })

  it('returns false for mismatched signature', () => {
    process.env.PEACH_WEBHOOK_SECRET = 'test-secret'
    const result = verifyWebhookSignature('raw body', 'invalid-sig')
    expect(result).toBe(false)
  })
})

// Note: verifyMetaSignature and payments idempotency tests are in webhooks-security.test.ts
// (kept separate to avoid mock hoisting conflicts)
