import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreditsEntryClient } from '@/components/provider/credits'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/app/(provider)/provider/credits/actions', () => ({
  cancelProviderPayatTopUpIntent: vi.fn(),
  createProviderPayatTopUpIntent: vi.fn(),
  notifyProviderPayatTopUpInitiated: vi.fn(),
  requestCreditVerificationUrl: vi.fn(),
}))

function walletFixture(creditPurchaseLocked: boolean) {
  return {
    credits: 0,
    starter: 0,
    pendingIntents: [],
    recentActivity: [],
    creditPurchaseLocked,
    identityVerificationStatus: {
      kycStatus: 'NOT_STARTED',
      label: 'Identity not started',
      shortLabel: 'ID not started',
      description: 'Identity verification has not been completed yet.',
      creditGateTitle: 'ID verification needed',
      creditGateDescription: 'Verify your identity to unlock credit top-ups.',
      tone: 'warning',
      isIdentityVerified: false,
    },
    creditGateStatus: {
      title: 'Top-ups are locked until your identity is verified.',
      description: 'We need to verify your profile before you can buy credits and accept paid job leads.',
      tone: 'warning',
    },
  }
}

describe('CreditsEntryClient top-up lock UI', () => {
  it('does not render top-up buttons or package links when credit purchases are locked', () => {
    const html = renderToStaticMarkup(
      <CreditsEntryClient wallet={walletFixture(true) as any} creditPriceZar={50} />,
    )

    expect(html).toContain('Complete verification')
    expect(html).toContain('Top-ups are locked until your identity is verified.')
    expect(html).not.toContain('lucide-zap')
    expect(html).not.toContain('Get link')
  })

  it('renders top-up affordances for an eligible provider', () => {
    const html = renderToStaticMarkup(
      <CreditsEntryClient wallet={walletFixture(false) as any} creditPriceZar={50} />,
    )

    expect(html).toContain('lucide-zap')
    expect(html).toContain('Get link')
    expect(html).not.toContain('Complete verification')
  })
})
