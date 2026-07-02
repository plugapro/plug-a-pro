'use client'

// ─── Inline OTP dialog (customer.booking.inline_otp) ──────────────────────────
// Opens at booking submit so a signed-out customer can verify their number
// without losing the form to a /sign-in redirect. Two steps:
//   phone → send code   code → auto-verify at 6 digits, resend + change number
// All auth logic lives in useInlineOtp; this component is presentation only.

import { useEffect, useRef } from 'react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { OtpInput } from '@/components/ui/otp-input'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { WA_ENABLED } from '@/lib/whatsapp-client'
import { useInlineOtp } from '@/components/customer/useInlineOtp'

export type InlineOtpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the session cookie is set and the customer is linked. */
  onVerified: () => void | Promise<void>
  initialPhone?: string
}

function formatPhoneForDisplay(e164: string) {
  const digits = e164.replace(/\D/g, '')
  if (!digits.startsWith('27') || digits.length !== 11) return e164
  return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
}

export function InlineOtpDialog({ open, onOpenChange, onVerified, initialPhone }: InlineOtpDialogProps) {
  const {
    step,
    phone,
    setPhone,
    e164,
    code,
    setCode,
    sending,
    verifying,
    error,
    resendCooldown,
    sendCode,
    verifyCode,
    resend,
    reset,
  } = useInlineOtp({ onVerified, initialPhone })

  const isValidPhone = phone.replace(/\D/g, '').length >= 9

  // Auto-verify once 6 digits are in (mirrors /verify). The ref stops the
  // effect re-firing while the same 6-digit value is being verified.
  const submitRef = useRef(false)
  useEffect(() => {
    if (step !== 'code') return
    if (code.length === 6 && !verifying && !submitRef.current) {
      submitRef.current = true
      void verifyCode()
    }
    if (code.length < 6) submitRef.current = false
  }, [step, code, verifying, verifyCode])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:max-w-sm">
        {step === 'phone' ? (
          <>
            <DialogHeader>
              <DialogTitle>Almost there</DialogTitle>
              <DialogDescription>
                Confirm your number to submit your request. You&apos;ll get a written quote
                on WhatsApp before any work starts.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void sendCode()
              }}
              className="flex flex-col gap-[18px]"
            >
              <div>
                <label
                  htmlFor="inline-otp-phone"
                  className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]"
                >
                  Mobile number
                </label>
                <SaMobileNumberInput
                  id="inline-otp-phone"
                  value={phone}
                  onChange={setPhone}
                  disabled={sending}
                />
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-mute)]">
                  {SA_OTP_SIGN_IN_HELPER_TEXT}
                </p>
              </div>

              {error && (
                <p className="text-[13px] text-[var(--danger)] text-center">{error}</p>
              )}

              <Button
                type="submit"
                fullWidth
                variant={isValidPhone && !sending ? 'default' : 'secondary'}
                disabled={!isValidPhone || sending}
                size="md"
              >
                {sending ? 'Sending code…' : 'Send code'}
                {!sending && <ArrowRight size={18} />}
              </Button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Enter the 6-digit code</DialogTitle>
              <DialogDescription>
                Sent to{' '}
                <b className="text-[var(--ink)]">{e164 ? formatPhoneForDisplay(e164) : phone}</b>
                {WA_ENABLED ? ' via WhatsApp' : ''}.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-[18px]">
              <OtpInput value={code} onChange={setCode} disabled={verifying} />

              {error && (
                <div className="flex items-center justify-center gap-2 text-[13px] text-[var(--danger)] font-medium">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {verifying && (
                <p className="text-[13px] text-[var(--ink-mute)] text-center">Verifying…</p>
              )}

              <p className="text-[13px] text-[var(--ink-mute)] text-center">
                {resendCooldown > 0 ? (
                  <>
                    Resend code in{' '}
                    <span className="text-[var(--ink)] font-semibold font-mono">
                      0:{resendCooldown.toString().padStart(2, '0')}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void resend()}
                    disabled={sending}
                    className="text-[var(--brand-purple)] font-semibold outline-none focus-visible:underline disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Resend code'}
                  </button>
                )}
              </p>

              <Button
                type="button"
                fullWidth
                variant={code.length === 6 && !verifying ? 'default' : 'secondary'}
                disabled={code.length !== 6 || verifying}
                onClick={() => void verifyCode()}
                size="md"
              >
                Verify &amp; continue
              </Button>

              <button
                type="button"
                onClick={reset}
                className="text-[13px] text-[var(--ink-mute)] text-center outline-none focus-visible:underline"
              >
                ← Use a different number
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
