import { manualVerificationAdapter } from './manual'
import { mockVerificationAdapter } from './mock'
import { smileIdVerificationAdapter } from './smile-id'
import type { VendorKey, VerificationVendorAdapter } from './types'

export function getAdapter(vendorKey: VendorKey): VerificationVendorAdapter {
  if (vendorKey === 'manual') return manualVerificationAdapter
  if (vendorKey === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Mock verification provider cannot be used in production')
    }
    return mockVerificationAdapter
  }
  if (vendorKey === 'smile_id') {
    return smileIdVerificationAdapter
  }
  if (vendorKey === 'thisisme' || vendorKey === 'datanamix' || vendorKey === 'omnicheck') {
    return notImplementedAdapter(vendorKey)
  }
  throw new Error(`Unknown identity verification vendor: ${vendorKey satisfies never}`)
}

export function toVendorKey(value: string | null | undefined): VendorKey | null {
  if (
    value === 'smile_id' ||
    value === 'thisisme' ||
    value === 'datanamix' ||
    value === 'omnicheck' ||
    value === 'manual' ||
    value === 'mock'
  ) {
    return value
  }
  return null
}

function notImplementedAdapter(vendorKey: VendorKey): VerificationVendorAdapter {
  return {
    vendorKey,
    async submitDocumentCheck() {
      throw new Error(`${vendorKey} identity verification adapter is not implemented`)
    },
    async parseWebhook() {
      throw new Error(`${vendorKey} identity verification adapter is not implemented`)
    },
    async cancelVerificationJob() {
      return { supported: false, vendorAcknowledged: false }
    },
  }
}
