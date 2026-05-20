import type { InboundMessage } from './whatsapp-interactive'

export type BatchEntry = {
  messages: InboundMessage[]
  timer: ReturnType<typeof setTimeout>
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>
}

export type CityQueueEntry = {
  message: InboundMessage
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: unknown) => void
}

export type RecentCityEntry = {
  messageId: string
  timer: ReturnType<typeof setTimeout>
}

export interface BatchAccumulators {
  customerPhotoBatches: Map<string, BatchEntry>
  providerEvidenceBatches: Map<string, BatchEntry>
  pendingCityTextMessages: Map<string, CityQueueEntry>
  recentCityInteractiveSelections: Map<string, RecentCityEntry>
}

export function createBatchAccumulators(): BatchAccumulators {
  return {
    customerPhotoBatches: new Map(),
    providerEvidenceBatches: new Map(),
    pendingCityTextMessages: new Map(),
    recentCityInteractiveSelections: new Map(),
  }
}
