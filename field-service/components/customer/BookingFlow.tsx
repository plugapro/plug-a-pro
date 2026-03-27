'use client'

// ─── Multi-step booking flow ──────────────────────────────────────────────────
// Steps: address → slot → confirm → payment

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Service {
  id: string
  name: string
  description: string | null
  category: string
  pricingType: string
  basePrice: number | null
  callOutFee: number | null
  duration: number
  active: boolean
  businessId: string
}

interface Slot {
  id: string
  date: string        // ISO date "2026-04-01"
  windowStart: string // "09:00"
  windowEnd: string   // "12:00"
  capacity: number
  booked: number
}

interface Address {
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string
}

type Step = 'address' | 'slot' | 'confirm' | 'payment'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function groupSlotsByDate(slots: Slot[]): Record<string, Slot[]> {
  return slots.reduce<Record<string, Slot[]>>((acc, slot) => {
    if (!acc[slot.date]) acc[slot.date] = []
    acc[slot.date].push(slot)
    return acc
  }, {})
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow({
  service,
  businessId,
}: {
  service: Service
  businessId: string
}) {
  const [step, setStep] = useState<Step>('address')
  const [address, setAddress] = useState<Address>({
    street: '',
    suburb: '',
    city: '',
    province: 'Gauteng',
    postalCode: '',
  })
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Payment step
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)

  const totalAmount =
    (service.basePrice ?? 0) + (service.callOutFee ?? 0)

  const priceLabel =
    service.pricingType === 'QUOTE_REQUIRED' || !service.basePrice
      ? 'Quote required'
      : `R ${totalAmount.toFixed(0)}`

  // ── Step 1: Address submit — fetch slots ────────────────────────────────────

  async function handleAddressSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(
        `/api/customer/slots?businessId=${encodeURIComponent(businessId)}`
      )
      if (!res.ok) throw new Error('Could not load available slots')
      const data: Slot[] = await res.json()
      setSlots(data)
      setStep('slot')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3: Confirm — create booking ───────────────────────────────────────

  async function handleConfirm() {
    if (!selectedSlot) return
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/customer/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          businessId,
          slotId: selectedSlot.id,
          street: address.street,
          suburb: address.suburb,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Booking failed — please try again')
      }

      const data = await res.json()
      setBookingId(data.bookingId)
      setCheckoutUrl(data.checkoutUrl)
      setStep('payment')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      {/* Service header */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{service.category}</p>
        <h1 className="text-xl font-semibold mt-0.5">{service.name}</h1>
        {service.description && (
          <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
        )}
        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
          <span>{service.duration} min</span>
          <span className="font-medium text-foreground">{priceLabel}</span>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {(['address', 'slot', 'confirm', 'payment'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s
                  ? 'bg-foreground text-background'
                  : ['address', 'slot', 'confirm', 'payment'].indexOf(step) > i
                  ? 'bg-green-500 text-white'
                  : 'bg-muted text-muted-foreground'
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
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
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
                  required
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

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? 'Loading slots…' : 'Find available slots →'}
          </Button>
        </form>
      )}

      {/* ── Step 2: Slot ─────────────────────────────────────────────────── */}
      {step === 'slot' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Choose a time slot</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('address')}
              className="text-xs text-muted-foreground"
            >
              ← Back
            </Button>
          </div>

          {slots.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
              No slots available right now. Please check back soon.
            </div>
          ) : (
            Object.entries(groupSlotsByDate(slots)).map(([date, dateSlots]) => (
              <div key={date} className="space-y-2">
                <p className="text-sm font-medium">{formatDate(date)}</p>
                {dateSlots.map((slot) => {
                  const remaining = slot.capacity - slot.booked
                  return (
                    <Button
                      key={slot.id}
                      variant="outline"
                      onClick={() => {
                        setSelectedSlot(slot)
                        setStep('confirm')
                      }}
                      className="w-full justify-between px-4 py-3 h-auto rounded-xl"
                    >
                      <span className="text-sm font-medium">
                        {slot.windowStart}–{slot.windowEnd}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {remaining} slot{remaining !== 1 ? 's' : ''} left
                      </span>
                    </Button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Step 3: Confirm ──────────────────────────────────────────────── */}
      {step === 'confirm' && selectedSlot && (
        <div className="space-y-4">
          <h2 className="font-medium">Confirm your booking</h2>

          <Card>
            <CardContent className="px-4 py-4 space-y-3 text-sm">
              <Row label="Service">{service.name}</Row>
              <Row label="Price">{priceLabel}</Row>
              <Row label="Address">
                {address.street}, {address.suburb}, {address.city}
              </Row>
              <Row label="Date">{formatDate(selectedSlot.date)}</Row>
              <Row label="Window">{selectedSlot.windowStart}–{selectedSlot.windowEnd}</Row>
              {service.pricingType !== 'QUOTE_REQUIRED' && (
                <div className="border-t pt-3 flex justify-between font-medium">
                  <span>Total</span>
                  <span>R {totalAmount.toFixed(2)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setStep('slot')}
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
              {loading ? 'Processing…' : 'Confirm & Pay'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Payment ──────────────────────────────────────────────── */}
      {step === 'payment' && bookingId && (
        <div className="space-y-4">
          <Card>
            <CardContent className="px-4 py-4 space-y-3">
              <p className="font-medium text-sm">Booking confirmed</p>
              <p className="text-xs text-muted-foreground font-mono">
                Ref: {bookingId.slice(-8).toUpperCase()}
              </p>
              <p className="text-sm text-muted-foreground">
                Complete your payment to secure the booking.
              </p>
            </CardContent>
          </Card>

          {checkoutUrl ? (
            <Button asChild className="w-full" size="lg">
              <a href={checkoutUrl}>Pay now →</a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              Payment link unavailable — please contact support with ref {bookingId.slice(-8).toUpperCase()}.
            </p>
          )}

          <a
            href={`/bookings/${bookingId}`}
            className="block text-center text-xs text-muted-foreground hover:text-foreground"
          >
            View booking details
          </a>
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
