import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_CREDIT_PRICE_CENTS } from '../../lib/provider-credit-pricing'

async function loadConstants(envValue?: string) {
  vi.resetModules()
  if (envValue === undefined) {
    vi.stubEnv('KYC_FEE_CENTS', '')
    delete process.env.KYC_FEE_CENTS
  } else {
    vi.stubEnv('KYC_FEE_CENTS', envValue)
  }
  return import('../../lib/kyc-fee/constants')
}

describe('KYC_FEE_CENTS env guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults to exactly one credit', async () => {
    const { KYC_FEE_CENTS } = await loadConstants()
    expect(KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS)
  })

  it('accepts a whole-credit-multiple override', async () => {
    const { KYC_FEE_CENTS } = await loadConstants(String(PROVIDER_CREDIT_PRICE_CENTS * 2))
    expect(KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS * 2)
  })

  it('rejects a non-whole-credit override so recovery can never strand the debt', async () => {
    const { KYC_FEE_CENTS } = await loadConstants('3000')
    expect(KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS)
  })

  it('rejects garbage and non-positive overrides', async () => {
    expect((await loadConstants('abc')).KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS)
    expect((await loadConstants('-5000')).KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS)
    expect((await loadConstants('0')).KYC_FEE_CENTS).toBe(PROVIDER_CREDIT_PRICE_CENTS)
  })
})
