// ─── Durable post-response work ──────────────────────────────────────────────
//
// Vercel freezes a serverless function as soon as its response is returned, so
// a bare `void somePromise()` is NOT guaranteed to finish — it is abandoned
// mid-flight, silently, with no error and no log.
//
// That is not theoretical here. Between 2026-07-01 and 2026-09-08 every
// post-acceptance handoff message was dropped this way: providers accepted
// leads, the acceptance transaction committed, and the three fire-and-forget
// notifications that tell the provider "customer contact is released, here is
// your job page" never ran. Four customers were told they had been matched and
// then heard nothing; not one quote was ever created. There were no failure
// rows to investigate, because the code never reached its own error handling.
//
// next/server's after() keeps the invocation alive until the callback settles.
// The codebase already relies on it for match orchestration
// (lib/job-requests/create-job-request.ts); this helper makes that pattern
// reusable so the next caller cannot forget it.
//
// after() is unavailable outside a request scope — inside another after()
// callback, in cron scripts, in tests. There the work is awaited inline, which
// still runs it, just synchronously with the caller.

export interface RunAfterResponseResult {
  /** How the work was executed: registered with after(), or awaited inline. */
  mode: 'after' | 'inline'
  /** False when the work threw. The error is logged, never rethrown. */
  ok: boolean
}

/**
 * Run non-critical follow-up work without risking it being dropped.
 *
 * Never throws: the caller has already committed its state change, and a
 * failed notification must not roll that back or surface as a request error.
 *
 * @param label  Stable identifier used in logs, e.g. 'post-match-acceptance'.
 * @param work   The work to run. Executed at most once.
 */
export async function runAfterResponse(
  label: string,
  work: () => Promise<unknown>,
): Promise<RunAfterResponseResult> {
  let ok = true

  const guarded = async () => {
    try {
      await work()
    } catch (error) {
      ok = false
      console.error('[after-response] deferred work failed', {
        label,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    const { after } = await import('next/server')
    after(guarded)
    return { mode: 'after', ok }
  } catch {
    // No request scope: run it here so the work still happens.
    await guarded()
    return { mode: 'inline', ok }
  }
}
