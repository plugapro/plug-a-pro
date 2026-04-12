'use client'

// ─── Multi-step job request flow ──────────────────────────────────────────────
// Steps: address → description → confirm → submitted

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryData {
  slug: string
  name: string
  description: string | null
}

interface Address {
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string
}

type Step = 'address' | 'description' | 'confirm' | 'submitted'

const SA_PROVINCES = [
  'Gauteng',
  'Western Cape',
  'KwaZulu-Natal',
  'Eastern Cape',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Free State',
  'Northern Cape',
]

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow({
  category,
}: {
  category: CategoryData
}) {
  const [step, setStep] = useState<Step>('address')
  const [address, setAddress] = useState<Address>({
    street: '',
    suburb: '',
    city: '',
    province: 'Gauteng',
    postalCode: '',
  })
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobRequestId, setJobRequestId] = useState<string | null>(null)

  // ── Step 1: Address submit ──────────────────────────────────────────────────

  function handleAddressSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setStep('description')
  }

  // ── Step 2: Description submit ─────────────────────────────────────────────

  function handleDescriptionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setStep('confirm')
  }

  // ── Step 3: Confirm — create job request ───────────────────────────────────

  async function handleConfirm() {
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/customer/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.slug,
          title,
          description,
          street: address.street,
          suburb: address.suburb,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Request failed — please try again')
      }

      const data = await res.json()
      setJobRequestId(data.jobRequestId)
      setStep('submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      {/* Category header */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{category.slug}</p>
        <h1 className="text-xl font-semibold mt-0.5">{category.name}</h1>
        {category.description && (
          <p className="text-sm text-muted-foreground mt-1">{category.description}</p>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {(['address', 'description', 'confirm', 'submitted'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                step === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : ['address', 'description', 'confirm', 'submitted'].indexOf(step) > i
                    ? 'tone-success'
                    : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {i + 1}
            </span>
            {i < 3 && <span className="text-muted-foreground/40">—</span>}
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="tone-danger rounded-2xl border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── Step 1: Address ──────────────────────────────────────────────── */}
      {step === 'address' && (
        <form onSubmit={handleAddressSubmit} className="space-y-4">
          <h2 className="font-medium">Service address</h2>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="street" className="text-muted-foreground">Street address</Label>
              <Input
                id="street"
                required
                type="text"
                value={address.street}
                onChange={(e) => setAddress({ ...address, street: e.target.value })}
                placeholder="12 Main Road"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="suburb" className="text-muted-foreground">Suburb</Label>
                <Input
                  id="suburb"
                  required
                  type="text"
                  value={address.suburb}
                  onChange={(e) => setAddress({ ...address, suburb: e.target.value })}
                  placeholder="Sandton"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="city" className="text-muted-foreground">City</Label>
                <Input
                  id="city"
                  required
                  type="text"
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  placeholder="Johannesburg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="province" className="text-muted-foreground">Province</Label>
                <Select
                  value={address.province}
                  onValueChange={(val) => setAddress({ ...address, province: val })}
                >
                  <SelectTrigger id="province" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SA_PROVINCES.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="postalCode" className="text-muted-foreground">Postal code</Label>
                <Input
                  id="postalCode"
                  type="text"
                  value={address.postalCode}
                  onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                  placeholder="2196"
                />
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg">
            Next: Describe your job →
          </Button>
        </form>
      )}

      {/* ── Step 2: Description ──────────────────────────────────────────── */}
      {step === 'description' && (
        <form onSubmit={handleDescriptionSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Describe your job</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep('address')}
              className="text-xs text-muted-foreground"
            >
              ← Back
            </Button>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="title" className="text-muted-foreground">Job title</Label>
              <Input
                id="title"
                required
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`e.g. Fix leaking kitchen tap`}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description" className="text-muted-foreground">
                Details <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem, any access notes, or urgency…"
                rows={4}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Scheduling is arranged directly with your provider after matching.
          </p>

          <Button type="submit" className="w-full" size="lg">
            Review request →
          </Button>
        </form>
      )}

      {/* ── Step 3: Confirm ──────────────────────────────────────────────── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="font-medium">Confirm your request</h2>

          <Card>
            <CardContent className="px-4 py-4 space-y-3 text-sm">
              <Row label="Category">{category.name}</Row>
              <Row label="Job">{title}</Row>
              {description && <Row label="Details">{description}</Row>}
              <Row label="Address">
                {address.street}, {address.suburb}, {address.city}
              </Row>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setStep('description')}
              className="flex-1"
              size="lg"
            >
              ← Back
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1"
              size="lg"
            >
              {loading ? 'Submitting…' : 'Submit request'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Submitted ────────────────────────────────────────────── */}
      {step === 'submitted' && jobRequestId && (
        <div className="space-y-4">
          <Card>
            <CardContent className="px-4 py-4 space-y-3">
              <p className="font-medium text-sm">Request submitted</p>
              <p className="text-xs text-muted-foreground font-mono">
                Ref: {jobRequestId.slice(-8).toUpperCase()}
              </p>
              <p className="text-sm text-muted-foreground">
                We&apos;re matching you with a provider. You&apos;ll receive a WhatsApp message when a provider accepts your job.
              </p>
            </CardContent>
          </Card>

          <Link
            href="/bookings"
            className="block text-center text-xs text-muted-foreground hover:text-foreground"
          >
            View my bookings
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <span>{children}</span>
    </div>
  )
}
