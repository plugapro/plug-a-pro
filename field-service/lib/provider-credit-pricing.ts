// Browser-safe provider credit pricing constants.
//
// This module intentionally has NO database, crypto, webhook, or secret-env
// imports so it is safe to import from client components and server code alike.
// Keep it dependency-free: the moment a server-only dependency is added here,
// the client/server boundary that protects lib/provider-wallet.ts is lost.
//
// lib/provider-wallet.ts re-exports these so existing server importers keep
// working; client components should import directly from this module.

export const PROVIDER_CREDIT_PRICE_ZAR = 50
export const PROVIDER_CREDIT_PRICE_CENTS = PROVIDER_CREDIT_PRICE_ZAR * 100
export const PLUG_A_PRO_CREDIT_VALUE_CENTS = PROVIDER_CREDIT_PRICE_CENTS
