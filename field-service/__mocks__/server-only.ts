// No-op shim for `server-only` in Vitest (Node environment).
// In production Next.js, the real package is used and its webpack plugin ensures
// it throws only when imported from a Client Component.
// In the test suite (plain Node) there is no webpack plugin, so we stub it out.
export {}
