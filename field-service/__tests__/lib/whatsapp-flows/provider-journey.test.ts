import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    job: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    jobStatusEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
}))

import { handleProviderJourneyFlow } from '@/lib/whatsapp-flows/provider-journey'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'

const mockCtx = (step: string, replyId?: string, replyText?: string, data: object = {}) => ({
  phone: '+27711111111',
  step: step as any,
  data: data as any,
  flow: 'provider_journey' as const,
  reply: {
    type: replyId ? 'button_reply' as const : 'text' as const,
    id: replyId,
    text: replyText,
    title: replyId,
  },
})

describe('handleProviderJourneyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pj_menu step', () => {
    it('shows provider menu when provider exists and is online', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Sipho'),
        expect.arrayContaining([expect.objectContaining({ id: 'back_home' })])
      )
      expect(result.nextStep).toBe('pj_toggle_available')
    })

    it('prompts to register when provider not found', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('join'))
      expect(result.nextStep).toBe('done')
    })

    it('shows offline status when availableNow is false', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false,
      })
      await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Offline'),
        expect.any(Array)
      )
    })
  })

  describe('pj_toggle_available step', () => {
    it('sets availableNow=false when provider is online and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: false })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: false },
      })
    })

    it('sets availableNow=true when provider is offline and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: true })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: true },
      })
    })

    it('returns done when back_home tapped', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'back_home'))
      expect(result.nextStep).toBe('done')
    })
  })
})
