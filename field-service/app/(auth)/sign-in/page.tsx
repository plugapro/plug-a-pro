'use client'

// ─── Customer sign-in — phone OTP ─────────────────────────────────────────────
// Accepts an E.164 phone number, sends a Supabase OTP, redirects to /verify.
// No password. No registration form. If the customer already has a WhatsApp
// booking history, linkCustomerAccount() in /verify will stitch the records.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { siteConfig } from '@/lib/metadata'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function SignInPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Normalise to E.164 — assume SA (+27) if no country code entered
  function normalise(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('27')) return `+${digits}`
    if (digits.startsWith('0') && digits.length === 10) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const normalised = normalise(phone)
    if (!/^\+\d{10,15}$/.test(normalised)) {
      setError('Please enter a valid South African mobile number.')
      setLoading(false)
      return
    }

    try {
      const supabase = getSupabaseClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: normalised,
      })

      if (otpError) {
        setError(otpError.message)
        return
      }

      // Pass the normalised number to the verify page
      router.push(`/verify?phone=${encodeURIComponent(normalised)}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <p className="text-xs font-semibold tracking-widest uppercase text-zinc-500">
          {siteConfig.name}
        </p>
        <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
        <p className="text-sm text-zinc-400">
          Enter your phone number to continue
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone" className="text-zinc-300">
            Mobile number
          </Label>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            placeholder="+27 82 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={loading}
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:border-zinc-500 focus-visible:ring-zinc-500/20 h-11"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={loading || !phone}
          className="w-full"
        >
          {loading ? 'Sending code…' : 'Send code'}
        </Button>
      </form>

      {/* Footer note */}
      <p className="text-center text-xs text-zinc-600">
        By continuing you agree to our terms of service.
        Your number is never shared with anyone.
      </p>
    </div>
  )
}
