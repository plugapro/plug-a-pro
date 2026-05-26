'use client'

import { useEffect, useRef, useState } from 'react'

export const REPORT_API_PATH = '/api/security/otp/report'

type ReportStatus = 'idle' | 'sending' | 'sent' | 'error'

export async function submitOtpReport(token: string): Promise<void> {
  await fetch(REPORT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export function ReportClient({ token }: { token: string }) {
  const submittedRef = useRef(false)
  const [status, setStatus] = useState<ReportStatus>('idle')

  async function submit() {
    setStatus('sending')
    try {
      await submitOtpReport(token)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    void submit()
    // submit is intentionally scoped to the initial token carried by the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <form
      action={REPORT_API_PATH}
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <input type="hidden" name="token" value={token} readOnly />
      <div className="rounded-[16px] border border-border bg-card px-4 py-4 text-sm leading-6 text-card-foreground shadow-[var(--shadow-soft)]">
        {status === 'error'
          ? 'We could not confirm from this device. You can try again.'
          : 'Thanks. If this was not you, the account protection process has started.'}
      </div>
      <button
        type="submit"
        disabled={status === 'sending'}
        className="min-h-11 w-full rounded-[16px] bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === 'sending' ? 'Sending...' : 'Send again'}
      </button>
    </form>
  )
}
