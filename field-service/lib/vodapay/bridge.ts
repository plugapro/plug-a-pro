// lib/vodapay/bridge.ts — VodaPay mini-program bridge (hylid-bridge) types + detection.
//
// Client-safe. No server-only import — this module is loaded from
// components/customer/VodapayBootstrap.tsx (a 'use client' component) and
// from tests directly.
//
// The VodaPay super-app hosts Plug A Pro inside a WebView and injects a
// `window.my` bridge object (via the hylid-bridge script) that exposes
// native capabilities: federated auth (getAuthCode, Task 15), in-app
// payment (tradePay, Task 18), device location and host env info.
export interface BridgeCallback<T> {
  success?: (res: T) => void
  fail?: (err: { error?: number; errorMessage?: string }) => void
  complete?: () => void
}

export interface MiniProgramBridge {
  getAuthCode(opts: { scopes: string[] } & BridgeCallback<{ authCode: string }>): void
  tradePay(opts: { paymentUrl: string } & BridgeCallback<{ resultCode: string }>): void
  getLocation(opts: BridgeCallback<{ latitude: string; longitude: string }>): void
  getEnv(opts: BridgeCallback<{ language: string }>): void
}

declare global {
  interface Window {
    my?: MiniProgramBridge
  }
}

// Detects whether the current page is running inside the VodaPay
// mini-program WebView. The UA marker ("MiniProgram") is the primary
// signal; the injected `window.my` bridge object is a fallback for hosts
// that don't stamp the UA but do inject the bridge.
export function detectMiniProgram(ua: string, my: unknown): boolean {
  if (/MiniProgram/i.test(ua)) return true
  return Boolean(my && typeof (my as MiniProgramBridge).getAuthCode === 'function')
}

export const HYLID_BRIDGE_SRC = 'https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js'
