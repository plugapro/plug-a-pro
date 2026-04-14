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
import { SuburbPicker } from './SuburbPicker'
import type { CityOption } from '@/lib/location-nodes'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryData {
  slug: string
  name: string
  description: string | null
}

interface BookingFlowProps {
  category: CategoryData
  initialCities: CityOption[]
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

const PROVINCE_KEY_BY_LABEL: Record<string, string> = {
  Gauteng: 'gauteng',
  'Western Cape': 'western_cape',
  'KwaZulu-Natal': 'kwazulu_natal',
  'Eastern Cape': 'eastern_cape',
  Limpopo: 'limpopo',
  Mpumalanga: 'mpumalanga',
  'North West': 'north_west',
  'Free State': 'free_state',
  'Northern Cape': 'northern_cape',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow({ category, initialCities }: BookingFlowProps) {
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
  const [locationNodeId, setLocationNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobRequestId, setJobRequestId] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)

  function normalizeValue(value: string) {
    return value.trim().replace(/\s+/g, ' ')
  }

  function validateAddressStep() {
    const suburb = normalizeValue(address.suburb)
    const city = normalizeValue(address.city)
    const province = normalizeValue(address.province)
    const postalCode = address.postalCode.trim()

    if (!suburb || !city) {
      return 'Select your province, city, region, and suburb first. Use manual entry if your area is not listed.'
    }

    if (!province) {
      return 'Please complete the full service address before continuing.'
    }

    if (!SA_PROVINCES.includes(province)) {
      return 'Please select a valid South African province.'
    }

    if (postalCode && !/^\d{4}$/.test(postalCode)) {
      return 'Postal code must be 4 digits if you include it.'
    }

    const street = normalizeValue(address.street)
    if (!street) {
      return 'Enter the street address after choosing the suburb.'
    }

    return null
  }

  function validateDescriptionStep() {
    const normalizedTitle = normalizeValue(title)
    if (normalizedTitle.length < 6) {
      return 'Please enter a short job title so the provider can identify the work clearly.'
    }
    if (normalizedTitle.length > 120) {
      return 'Job title is too long. Please keep it under 120 characters.'
    }
    if (description.trim().length > 1200) {
      return 'Job details are too long. Please keep them under 1200 characters.'
    }
    return null
  }

  async function handleUseMyLocation() {
    setError(null)

    if (!navigator.geolocation) {
      setError('Location services are not available in this browser.')
      return
    }

    setLocationLoading(true)

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        })
      })

      const params = new URLSearchParams({
        lat: String(position.coords.latitude),
        lng: String(position.coords.longitude),
      })
      const res = await fetch(`/api/customer/location-reverse?${params}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Could not use your location')
      }

      const data = await res.json() as {
        street?: string | null
        suburb?: string | null
        city?: string | null
        province?: string | null
        postalCode?: string | null
      }

      setAddress((current) => ({
        street: data.street ?? current.street,
        suburb: data.suburb ?? current.suburb,
        city: data.city ?? current.city,
        province: data.province ?? current.province,
        postalCode: data.postalCode ?? current.postalCode,
      }))
      setLocationNodeId(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'We could not read your location. Please enter the address manually.',
      )
    } finally {
      setLocationLoading(false)
    }
  }

  // ── Step 1: Address submit ──────────────────────────────────────────────────

  function handleAddressSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const validationError = validateAddressStep()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setStep('description')
  }

  // ── Step 2: Description submit ─────────────────────────────────────────────

  function handleDescriptionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const validationError = validateDescriptionStep()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setStep('confirm')
  }

  // ── Step 3: Confirm — create job request ───────────────────────────────────

  async function handleConfirm() {
    if (loading) return
    setError(null)
    setLoading(true)

    try {
      const addressError = validateAddressStep()
      if (addressError) throw new Error(addressError)

      const descriptionError = validateDescriptionStep()
      if (descriptionError) throw new Error(descriptionError)

      const res = await fetch('/api/customer/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.slug,
          title: normalizeValue(title),
          description: description.trim(),
          street: normalizeValue(address.street),
          suburb: normalizeValue(address.suburb),
          city: normalizeValue(address.city),
          province: normalizeValue(address.province),
          postalCode: address.postalCode.trim(),
          locationNodeId: locationNodeId ?? undefined,
        }),
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Your session has expired. Please sign in again before submitting your request.')
        }
        if (res.status === 400) {
          throw new Error('Please review your address and job details, then try again.')
        }
        throw new Error('We could not submit your request right now. Please try again.')
      }

      const data = await res.json()
      setJobRequestId(data.jobRequestId)
      setTicketUrl(data.ticketUrl ?? null)
      setStep('submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not submit your request right now. Please try again.')
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Service address</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locationLoading}
              onClick={handleUseMyLocation}
            >
              {locationLoading ? 'Finding address…' : 'Use my current location'}
            </Button>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="province" className="text-muted-foreground">Province</Label>
              <Select
                value={address.province}
                onValueChange={(val) => {
                  setAddress({ ...address, province: val, city: '', suburb: '' })
                  setLocationNodeId(null)
                }}
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

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Area</Label>
              <SuburbPicker
                initialCities={initialCities}
                provinceKey={PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'}
                onSelect={(selection) => {
                  if (selection) {
                    setAddress((prev) => ({ ...prev, suburb: selection.suburb, city: selection.city }))
                    setLocationNodeId(selection.locationNodeId)
                  } else {
                    setAddress((prev) => ({ ...prev, suburb: '', city: '' }))
                    setLocationNodeId(null)
                  }
                }}
              />
              {address.suburb && (
                <p className="text-xs text-muted-foreground">
                  {address.suburb}, {address.city}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="street" className="text-muted-foreground">Street address</Label>
                <Input
                  id="street"
                  required
                  type="text"
                  value={address.street}
                  onChange={(e) => setAddress({ ...address, street: e.target.value })}
                  placeholder="12 Main Road, Estate name, informal directions"
                />
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

          <div className="space-y-3">
            <Button asChild className="w-full">
              <Link href={ticketUrl ?? `/requests/${jobRequestId}`}>View ticket</Link>
            </Button>
            <Link
              href="/bookings"
              className="block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              View my requests &amp; bookings
            </Link>
          </div>
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
