/**
 * VodaPay bridge checkout tests (Task 18).
 *
 * Mirrors the useVodapayLogin.ts split (Task 15): performCheckout is a pure,
 * dependency-injected orchestration function (no window/DOM access), so it's
 * tested headlessly here without any browser stub or jsdom environment.
 */

import { describe, expect, it, vi } from 'vitest'
import { isTradePaySuccess, performCheckout, type CheckoutDeps } from '@/lib/vodapay/checkout'
import type { MiniProgramBridge } from '@/lib/vodapay/bridge'

describe('isTradePaySuccess', () => {
  it('resultCode "9000" is success', () => {
    expect(isTradePaySuccess({ resultCode: '9000' })).toBe(true)
  })
  it('any other resultCode is not success', () => {
    expect(isTradePaySuccess({ resultCode: '4000' })).toBe(false)
    expect(isTradePaySuccess({ resultCode: 9000 })).toBe(false) // numeric, not the string
  })
  it('missing/null/undefined result is not success', () => {
    expect(isTradePaySuccess(undefined)).toBe(false)
    expect(isTradePaySuccess(null)).toBe(false)
    expect(isTradePaySuccess({})).toBe(false)
  })
})

describe('performCheckout', () => {
  function buildBridge(overrides: {
    resultCode?: string
    failInstead?: boolean
  } = {}): { bridge: MiniProgramBridge; tradePay: ReturnType<typeof vi.fn> } {
    const tradePay = vi.fn((opts: Parameters<MiniProgramBridge['tradePay']>[0]) => {
      if (overrides.failInstead) {
        opts.fail?.({ errorMessage: 'payment cancelled' })
        return
      }
      opts.success?.({ resultCode: overrides.resultCode ?? '9000' })
    })
    // getAuthCode is required by MiniProgramBridge / detectMiniProgram's
    // fallback signal — present so detectMiniProgram(ua, bridge) resolves true
    // even without the UA marker.
    return {
      bridge: { getAuthCode: () => {}, tradePay } as unknown as MiniProgramBridge,
      tradePay,
    }
  }

  it('inside the mini-program: calls tradePay with the checkoutUrl as paymentUrl', () => {
    const { bridge, tradePay } = buildBridge()
    const navigate = vi.fn()
    const onSettled = vi.fn()
    const deps: CheckoutDeps = { ua: 'Mozilla/5.0 Chrome', bridge, navigate }

    performCheckout('https://pay.example/session-1', onSettled, deps)

    expect(tradePay).toHaveBeenCalledTimes(1)
    expect(tradePay.mock.calls[0][0]).toEqual(
      expect.objectContaining({ paymentUrl: 'https://pay.example/session-1' }),
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it('tradePay success with resultCode 9000 → onSettled called', () => {
    const { bridge } = buildBridge({ resultCode: '9000' })
    const onSettled = vi.fn()
    performCheckout('https://pay.example/x', onSettled, { ua: 'x', bridge, navigate: vi.fn() })
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('tradePay success with a non-9000 resultCode → onSettled NOT called', () => {
    const { bridge } = buildBridge({ resultCode: '4000' })
    const onSettled = vi.fn()
    performCheckout('https://pay.example/x', onSettled, { ua: 'x', bridge, navigate: vi.fn() })
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('tradePay fail callback → onSettled still called (webhook remains source of truth)', () => {
    const { bridge } = buildBridge({ failInstead: true })
    const onSettled = vi.fn()
    performCheckout('https://pay.example/x', onSettled, { ua: 'x', bridge, navigate: vi.fn() })
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('UA marker alone (no bridge object) also routes through tradePay-capable detection', () => {
    const { bridge, tradePay } = buildBridge()
    const navigate = vi.fn()
    performCheckout('https://pay.example/x', vi.fn(), {
      ua: 'Mozilla/5.0 MiniProgram',
      bridge,
      navigate,
    })
    expect(tradePay).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('plain browser (no bridge): navigates to checkoutUrl, never calls onSettled synchronously', () => {
    const navigate = vi.fn()
    const onSettled = vi.fn()
    performCheckout('https://pay.example/x', onSettled, {
      ua: 'Mozilla/5.0 Chrome',
      bridge: undefined,
      navigate,
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('https://pay.example/x')
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('bridge present but UA/bridge do not signal mini-program: falls back to navigate', () => {
    // A bridge without getAuthCode as a function fails detectMiniProgram's
    // fallback check, and the UA has no MiniProgram marker.
    const navigate = vi.fn()
    const brokenBridge = { tradePay: vi.fn() } as unknown as MiniProgramBridge
    performCheckout('https://pay.example/x', vi.fn(), {
      ua: 'Mozilla/5.0 Chrome',
      bridge: brokenBridge,
      navigate,
    })
    expect(navigate).toHaveBeenCalledWith('https://pay.example/x')
  })
})
