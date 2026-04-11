'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalised })

      if (otpError) {
        // Map known Supabase infrastructure errors to user-friendly messages
        const msg = otpError.message.toLowerCase()
        if (msg.includes('unsupported') || msg.includes('provider') || msg.includes('sms')) {
          setError('SMS login is temporarily unavailable. Please contact support@plugapro.co.za.')
        } else if (msg.includes('rate') || msg.includes('limit')) {
          setError('Too many attempts. Please wait a few minutes and try again.')
        } else {
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      router.push(`/verify?phone=${encodeURIComponent(normalised)}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Enter your number to receive a one-time code</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-foreground">Mobile number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            placeholder="+27 82 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={loading}
            className="h-11 bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" size="lg" disabled={loading || !phone} className="w-full">
          {loading ? 'Sending code…' : 'Send code'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Your number is never shared. By continuing you agree to our terms.
      </p>
    </div>
  )
}
