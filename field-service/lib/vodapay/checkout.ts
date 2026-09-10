// ─── VodaPay bridge checkout (Task 18) ─────────────────────────────────────
// In-app payment for a customer running inside the VodaPay mini-program
// WebView: instead of a browser redirect to the PSP checkout URL, the host
// bridge's tradePay() opens the payment natively and calls back with a
// result code. Outside the mini-program (plain browser / WhatsApp / web),
// checkout is unchanged — a plain redirect to checkoutUrl.
//
// TESTABILITY: mirrors the useVodapayLogin.ts split (Task 15) — the decision
// of which path to take and the callback interpretation are pure/injectable
// functions, unit-tested headlessly in __tests__/lib/vodapay-checkout.test.ts.
// usePayCheckout()/openCheckout() bind this to real browser globals
// (window.my, navigator.userAgent, window.location).
import { detectMiniProgram, type MiniProgramBridge } from './bridge'

// VodaPay's tradePay success result code for "payment completed". Any other
// resultCode (or the fail callback) is treated as not-yet-settled — the
// webhook remains the source of truth for whether the booking is actually
// paid; this only decides whether to start polling for that outcome.
const TRADE_PAY_SUCCESS_CODE = '9000'

export interface TradePayResult {
  resultCode?: unknown
}

// Pure: true only for the one resultCode VodaPay documents as "success".
export function isTradePaySuccess(result: TradePayResult | null | undefined): boolean {
  return result?.resultCode === TRADE_PAY_SUCCESS_CODE
}

export interface CheckoutDeps {
  /** navigator.userAgent — used by detectMiniProgram. */
  ua: string
  /** window.my — undefined outside the VodaPay WebView. */
  bridge: MiniProgramBridge | undefined
  /** Plain-browser fallback + the eventual tradePay success path both end up here. */
  navigate: (url: string) => void
}

// Pure orchestration, no window access beyond what's injected via `deps` —
// safe to call directly from a test. Decides tradePay vs a plain redirect,
// and invokes `onSettled` exactly once tradePay calls back (success OR
// fail — the webhook is the source of truth for whether the booking is
// actually paid; onSettled's job is only to start the caller's
// poll/refresh loop so the UI catches up once it lands).
export function performCheckout(
  checkoutUrl: string,
  onSettled: () => void,
  deps: CheckoutDeps,
): void {
  if (deps.bridge && detectMiniProgram(deps.ua, deps.bridge)) {
    deps.bridge.tradePay({
      paymentUrl: checkoutUrl,
      success: (res) => {
        if (isTradePaySuccess(res)) onSettled()
      },
      // webhook remains source of truth; refresh shows state either way.
      fail: () => onSettled(),
    })
    return
  }
  deps.navigate(checkoutUrl)
}
