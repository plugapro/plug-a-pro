// ─── App-level instrumentation ────────────────────────────────────────────────
// Next.js calls register() once per server instance (and per edge runtime
// boot). We use it to lock the process timezone to SAST so date formatting,
// cron evaluation, and inbound webhook timestamps all use the same wall clock
// as the South African market.

export async function register() {
  if (!process.env.TZ) {
    process.env.TZ = 'Africa/Johannesburg'
  }
}
