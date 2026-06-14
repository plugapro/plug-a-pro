import { describe, it, expect } from 'vitest'
import {
  requiresHumanReview,
  classifyChangeRisk,
  areaForFlow,
  HUMAN_REVIEW_REQUIRED_AREAS,
  LOWER_RISK_AREAS,
} from '../../../lib/ai-loop/human-review-policy'

describe('requiresHumanReview', () => {
  it('requires review for every gated high-risk area', () => {
    for (const area of HUMAN_REVIEW_REQUIRED_AREAS) {
      expect(requiresHumanReview(area)).toBe(true)
    }
  })

  it('does not gate the lower-risk areas', () => {
    for (const area of LOWER_RISK_AREAS) {
      expect(requiresHumanReview(area)).toBe(false)
    }
  })

  it('fails safe for unknown areas (defaults to review required)', () => {
    expect(requiresHumanReview('something_new')).toBe(true)
  })
})

describe('classifyChangeRisk', () => {
  it('rates payment/kyc/security/secrets as critical', () => {
    for (const area of ['payment_logic', 'kyc_logic', 'security_auth_rbac', 'secrets_credentials']) {
      expect(classifyChangeRisk(area).riskLevel).toBe('critical')
    }
  })

  it('never marks payment as low-risk', () => {
    const c = classifyChangeRisk('payment_logic')
    expect(c.riskLevel).not.toBe('low')
    expect(c.humanReviewRequired).toBe(true)
  })

  it('rates documentation/tests as low and ungated', () => {
    expect(classifyChangeRisk('documentation')).toMatchObject({ riskLevel: 'low', humanReviewRequired: false })
    expect(classifyChangeRisk('test_addition')).toMatchObject({ riskLevel: 'low', humanReviewRequired: false })
  })

  it('coerces unknown area to other + high + review required', () => {
    expect(classifyChangeRisk('zzz')).toMatchObject({
      area: 'other',
      riskLevel: 'high',
      humanReviewRequired: true,
    })
  })
})

describe('areaForFlow', () => {
  it.each([
    ['payment', 'payment_logic'],
    ['payat', 'payment_logic'],
    ['kyc', 'kyc_logic'],
    ['identity_verification', 'kyc_logic'],
    ['auth', 'security_auth_rbac'],
    ['otp_login', 'security_auth_rbac'],
    ['voucher', 'voucher_credit_balance'],
    ['provider_activation', 'provider_activation'],
    ['whatsapp_campaign', 'bulk_whatsapp_campaign'],
    ['privacy_legal', 'privacy_popia'],
    ['booking', 'other'],
  ])('maps %s -> %s', (flow, expected) => {
    expect(areaForFlow(flow)).toBe(expected)
  })
})
