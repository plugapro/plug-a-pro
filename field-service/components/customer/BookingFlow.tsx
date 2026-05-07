'use client'

// ─── Multi-step job request flow ──────────────────────────────────────────────
// Steps: address → description → confirm → submitted

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { buildLegacyStreetAddress } from '@/lib/address-format'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'
import {
  BUDGET_PREFERENCE_OPTIONS,
  JOB_TYPE_OPTIONS,
  PROVIDER_PREFERENCE_OPTIONS,
  TIME_WINDOW_OPTIONS,
  resolvePreferredTimingWindow,
  validateClientRequestDetails,
  type BudgetPreference,
  type JobType,
  type PreferredTimeWindow,
  type ProviderPreference,
} from '@/lib/client-request-flow'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryData {
  slug: string
  name: string
  description: string | null
}

interface SavedSite {
  id: string
  label: string | null
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string | null
  locationNodeId: string | null
}

interface BookingFlowProps {
  category: CategoryData
  initialDraft?: Partial<{
    subcategory: string
    jobType: string
    title: string
    description: string
    accessNotes: string
    urgency: string
    preferredDate: string
    preferredTimeWindow: string
    providerPreference: string
    budgetPreference: string
    photosSafeForPreview: boolean
  }>
  /** Saved customer addresses (address book). Only shown when addressBookEnabled=true. */
  savedSites?: SavedSite[]
  /** Whether the feature.customer.address_book flag is enabled. */
  addressBookEnabled?: boolean
}

interface Address {
  addressLine1: string
  addressLine2: string
  complexName: string
  unitNumber: string
  suburb: string
  region: string
  city: string
  province: string
  postalCode: string
}

type Step = 'address' | 'description' | 'confirm' | 'submitted' | 'waitlisted'

type Urgency = 'asap' | 'this_week' | 'flexible'

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

const PROVINCE_LABELS = Object.keys(PROVINCE_KEY_BY_LABEL)

// Categories that can be selected as "closest match" when a client picks Other
const REAL_CATEGORIES = SERVICE_CATEGORY_OPTIONS.filter((c) => c.tag !== 'other')

const URGENCY_LABELS: Record<Urgency, string> = {
  asap: 'Today / ASAP',
  this_week: 'This week',
  flexible: "I'm flexible",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow({
  category,
  initialDraft,
  savedSites = [],
  addressBookEnabled = false,
}: BookingFlowProps) {
  const [step, setStep] = useState<Step>('address')
  // null = no site chosen yet (show site picker), 'new' = user wants manual form
  const [selectedSiteId, setSelectedSiteId] = useState<string | 'new' | null>(null)
  const showSitePicker = addressBookEnabled && savedSites.length > 0
  const [address, setAddress] = useState<Address>({
    addressLine1: '',
    addressLine2: '',
    complexName: '',
    unitNumber: '',
    suburb: '',
    region: '',
    city: '',
    province: 'Gauteng',
    postalCode: '',
  })
  const [subcategory, setSubcategory] = useState(initialDraft?.subcategory ?? '')
  const [jobType, setJobType] = useState<JobType>(coerceOption(initialDraft?.jobType, JOB_TYPE_OPTIONS, 'repair'))
  const [title, setTitle] = useState(initialDraft?.title ?? '')
  const [description, setDescription] = useState(initialDraft?.description ?? '')
  const [accessNotes, setAccessNotes] = useState(initialDraft?.accessNotes ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [closestCategory, setClosestCategory] = useState('')
  const [urgency, setUrgency] = useState<Urgency>(coerceUrgency(initialDraft?.urgency))
  const [preferredDate, setPreferredDate] = useState(initialDraft?.preferredDate ?? '')
  const [preferredTimeWindow, setPreferredTimeWindow] = useState<PreferredTimeWindow>(
    coerceOption(initialDraft?.preferredTimeWindow, TIME_WINDOW_OPTIONS, 'flexible'),
  )
  const [providerPreference, setProviderPreference] = useState<ProviderPreference>(
    coerceOption(initialDraft?.providerPreference, PROVIDER_PREFERENCE_OPTIONS, 'fastest_available'),
  )
  const [budgetPreference, setBudgetPreference] = useState<BudgetPreference>(
    coerceOption(initialDraft?.budgetPreference, BUDGET_PREFERENCE_OPTIONS, 'balanced_value'),
  )
  const [maxCallOutFee, setMaxCallOutFee] = useState('')
  const [photosSafeForPreview, setPhotosSafeForPreview] = useState(true)
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
  const [termsAcknowledged, setTermsAcknowledged] = useState(false)
  const [locationNodeId, setLocationNodeId] = useState<string | null>(null)
  const [locationDetectedLabel, setLocationDetectedLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobRequestId, setJobRequestId] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [waitlistedCity, setWaitlistedCity] = useState<string | null>(null)
  const streetSummary = buildLegacyStreetAddress(address)
  const draftStorageKey = `plugapro:client-request-draft:${category.slug}`
  const hasInitialDraft = Boolean(initialDraft && Object.values(initialDraft).some(Boolean))

  useEffect(() => {
    if (hasInitialDraft) return
    const savedDraft = window.localStorage.getItem(draftStorageKey)
    if (!savedDraft) return

    try {
      const draft = JSON.parse(savedDraft) as Partial<{
        subcategory: string
        jobType: string
        title: string
        description: string
        accessNotes: string
        urgency: Urgency
        preferredDate: string
        preferredTimeWindow: PreferredTimeWindow
        providerPreference: ProviderPreference
        budgetPreference: BudgetPreference
        maxCallOutFee: string
        photosSafeForPreview: boolean
      }>
      setSubcategory(draft.subcategory ?? '')
      setJobType(coerceOption(draft.jobType, JOB_TYPE_OPTIONS, 'repair'))
      setTitle(draft.title ?? '')
      setDescription(draft.description ?? '')
      setAccessNotes(draft.accessNotes ?? '')
      setUrgency(coerceUrgency(draft.urgency))
      setPreferredDate(draft.preferredDate ?? '')
      setPreferredTimeWindow(coerceOption(draft.preferredTimeWindow, TIME_WINDOW_OPTIONS, 'flexible'))
      setProviderPreference(coerceOption(draft.providerPreference, PROVIDER_PREFERENCE_OPTIONS, 'fastest_available'))
      setBudgetPreference(coerceOption(draft.budgetPreference, BUDGET_PREFERENCE_OPTIONS, 'balanced_value'))
      setMaxCallOutFee(draft.maxCallOutFee ?? '')
      setPhotosSafeForPreview(draft.photosSafeForPreview ?? true)
    } catch {
      window.localStorage.removeItem(draftStorageKey)
    }
  }, [draftStorageKey, hasInitialDraft])

  useEffect(() => {
    const draft = {
      subcategory,
      jobType,
      title,
      description,
      accessNotes,
      urgency,
      preferredDate,
      preferredTimeWindow,
      providerPreference,
      budgetPreference,
      maxCallOutFee,
      photosSafeForPreview,
    }
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft))
  }, [
    budgetPreference,
    accessNotes,
    description,
    draftStorageKey,
    jobType,
    maxCallOutFee,
    preferredDate,
    preferredTimeWindow,
    providerPreference,
    subcategory,
    title,
    urgency,
    photosSafeForPreview,
  ])

  function normalizeValue(value: string) {
    return value.trim().replace(/\s+/g, ' ')
  }

  function validateAddressStep() {
    if (!locationNodeId) {
      return 'Select your suburb before continuing — use "Use my location" or type in the search box.'
    }

    const suburb = normalizeValue(address.suburb)
    const city = normalizeValue(address.city)
    const province = normalizeValue(address.province)
    const region = normalizeValue(address.region)
    const postalCode = address.postalCode.trim()

    if (!suburb || !city || !region || !province || !postalCode) {
      return 'Please complete the full service address before continuing.'
    }

    if (!Object.prototype.hasOwnProperty.call(PROVINCE_KEY_BY_LABEL, province)) {
      return 'Please select a valid South African province.'
    }

    if (!/^\d{4}$/.test(postalCode)) {
      return 'Postal code must come from the selected suburb.'
    }

    const addressLine1 = normalizeValue(address.addressLine1)
    if (!addressLine1) {
      return 'Enter the street address after choosing the suburb.'
    }

    return null
  }

  function validateDescriptionStep() {
    if (category.slug === 'other' && !closestCategory) {
      return 'Please choose the closest type of work so we can match you with the right provider.'
    }
    return validateClientRequestDetails({
      title,
      description,
      privacyAcknowledged: true,
      termsAcknowledged: true,
    })
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
        selection?: {
          locationNodeId: string
          suburb: string
          region: string
          city: string
          province: string
          postalCode: string
        } | null
      }

      setAddress((current) => ({
        ...current,
        addressLine1: data.street ?? current.addressLine1,
        ...(data.selection
          ? {
              suburb: data.selection.suburb,
              region: data.selection.region,
              city: data.selection.city,
              province: data.selection.province,
              postalCode: data.selection.postalCode,
            }
          : {}),
      }))
      if (data.selection) {
        setLocationNodeId(data.selection.locationNodeId)
        setLocationDetectedLabel(data.selection.suburb)
      } else {
        setError('We found your street, but could not match the suburb exactly. Search for your suburb using the box below.')
      }
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

  // ── Site picker helpers ────────────────────────────────────────────────────

  function applySavedSite(site: SavedSite) {
    setAddress((current) => ({
      ...current,
      addressLine1: site.street,
      suburb: site.suburb,
      city: site.city,
      province: site.province,
      postalCode: site.postalCode ?? '',
      // Clear fields that are not stored on CustomerAddress
      addressLine2: '',
      complexName: '',
      unitNumber: '',
      region: '',
    }))
    setLocationNodeId(site.locationNodeId ?? null)
    setLocationDetectedLabel(null)
    setSelectedSiteId(site.id)
  }

  function handleEnterNewAddress() {
    setAddress({
      addressLine1: '',
      addressLine2: '',
      complexName: '',
      unitNumber: '',
      suburb: '',
      region: '',
      city: '',
      province: 'Gauteng',
      postalCode: '',
    })
    setLocationNodeId(null)
    setLocationDetectedLabel(null)
    setSelectedSiteId('new')
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
      const acknowledgementError = validateClientRequestDetails({
        title,
        description,
        privacyAcknowledged,
        termsAcknowledged,
      })
      if (acknowledgementError) throw new Error(acknowledgementError)

      // Resolve category: when client picks "Other" they must also choose the closest
      // real category so the matching engine can find a suitable provider.
      const effectiveCategory =
        category.slug === 'other' && closestCategory ? closestCategory : category.slug
      const effectiveDescription =
        category.slug === 'other'
          ? `[Other — originally uncategorised]\nJob type: ${jobType}\n${description.trim()}`
          : `Job type: ${jobType}\n${description.trim()}`
      const timing = resolvePreferredTimingWindow({
        urgency,
        preferredDate: preferredDate || null,
        preferredTimeWindow,
      })

      const formData = new FormData()
      formData.set('category', effectiveCategory)
      formData.set('subcategory', normalizeValue(subcategory))
      formData.set('title', normalizeValue(title))
      formData.set('description', effectiveDescription)
      formData.set('addressLine1', normalizeValue(address.addressLine1))
      formData.set('addressLine2', normalizeValue(address.addressLine2))
      formData.set('complexName', normalizeValue(address.complexName))
      formData.set('unitNumber', normalizeValue(address.unitNumber))
      formData.set('locationNodeId', locationNodeId ?? '')
      formData.set('urgency', urgency)
      formData.set('providerPreference', providerPreference)
      formData.set('budgetPreference', budgetPreference)
      formData.set('verifiedOnly', String(providerPreference === 'verified_only'))
      if (accessNotes.trim()) formData.set('accessNotes', accessNotes.trim())
      if (maxCallOutFee.trim()) formData.set('maxCallOutFee', maxCallOutFee.trim())

      // Urgency → timing window fields (extracted by the bookings API route)
      if (timing.requestedWindowStart) formData.set('requestedWindowStart', timing.requestedWindowStart.toISOString())
      if (timing.requestedWindowEnd) formData.set('requestedWindowEnd', timing.requestedWindowEnd.toISOString())
      if (timing.requestedArrivalLatest) formData.set('requestedArrivalLatest', timing.requestedArrivalLatest.toISOString())

      // Photos are optional evidence. They travel with the request so the matched
      // provider can quote without asking the client to repeat the problem.
      photos.forEach((photo) => formData.append('photos', photo))
      if (photos.length > 0) {
        formData.set('photoSafeForPreview', JSON.stringify(photos.map(() => photosSafeForPreview)))
      }

      const res = await fetch('/api/customer/bookings', {
        method: 'POST',
        body: formData,
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

      if (data.waitlisted) {
        setWaitlistedCity(data.city ?? address.city)
        setStep('waitlisted')
        return
      }

      setJobRequestId(data.jobRequestId)
      setTicketUrl(data.ticketUrl ?? null)
      window.localStorage.removeItem(draftStorageKey)
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

      {/* Step indicator — hidden on waitlisted screen */}
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

          {/* ── Saved site picker (flag-gated) ────────────────────────── */}
          {showSitePicker && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Choose a saved site</p>
              <div className="space-y-2">
                {savedSites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => applySavedSite(site)}
                    className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                      selectedSiteId === site.id
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-border bg-card hover:bg-muted'
                    }`}
                  >
                    <span className="block font-medium">
                      {site.label ?? site.suburb}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {[site.street, site.suburb, site.city].filter(Boolean).join(', ')}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleEnterNewAddress}
                  className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                    selectedSiteId === 'new'
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  + Enter a new address
                </button>
              </div>
            </div>
          )}

          {/* Show the privacy notice + manual form when: no site picker, OR user chose "new", OR a site is selected */}
          {(!showSitePicker || selectedSiteId !== null) && (
            <>
          <Card>
            <CardContent className="space-y-1 px-4 py-4 text-sm">
              <p className="font-medium">Your address stays private</p>
              <p className="text-muted-foreground">
                Providers will only see your suburb, city, and province before you select one and they accept the job.
              </p>
              <p className="text-muted-foreground">
                Your exact address and phone number are only shared after acceptance.
              </p>
            </CardContent>
          </Card>

          {/* Primary CTA: Use my location */}
          <Card className="border-dashed bg-muted/40">
            <CardContent className="px-4 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Use your current location</p>
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll auto-fill your suburb and street address.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={locationLoading}
                onClick={handleUseMyLocation}
              >
                {locationLoading ? 'Finding address…' : 'Use my current location'}
              </Button>
              {locationDetectedLabel && (
                <p className="text-xs text-center text-muted-foreground">
                  Detected: <span className="font-medium">{locationDetectedLabel}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Divider */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex-1 border-t border-border" />
            <span>or enter your address manually</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="province" className="text-muted-foreground">Province</Label>
              <Select
                value={address.province}
                onValueChange={(val) => {
                  setAddress((current) => ({
                    ...current,
                    province: val,
                    city: '',
                    region: '',
                    suburb: '',
                    postalCode: '',
                  }))
                  setLocationNodeId(null)
                  setLocationDetectedLabel(null)
                }}
              >
                <SelectTrigger id="province" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCE_LABELS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Suburb</Label>
              <SuburbPicker
                provinceKey={PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'}
                onSelect={(selection) => {
                  setLocationDetectedLabel(null)
                  if (selection) {
                    setAddress((prev) => ({
                      ...prev,
                      suburb: selection.suburb,
                      region: selection.region,
                      city: selection.city,
                      province: selection.province,
                      postalCode: selection.postalCode,
                    }))
                    setLocationNodeId(selection.locationNodeId)
                  } else {
                    setAddress((prev) => ({
                      ...prev,
                      suburb: '',
                      region: '',
                      city: '',
                      postalCode: '',
                    }))
                    setLocationNodeId(null)
                  }
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="unitNumber" className="text-muted-foreground">
                  Unit number <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                <Input
                  id="unitNumber"
                  type="text"
                  value={address.unitNumber}
                  onChange={(e) => setAddress({ ...address, unitNumber: e.target.value })}
                  placeholder="12B"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="complexName" className="text-muted-foreground">
                  Complex name <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                <Input
                  id="complexName"
                  type="text"
                  value={address.complexName}
                  onChange={(e) => setAddress({ ...address, complexName: e.target.value })}
                  placeholder="Acacia Mews"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="addressLine1" className="text-muted-foreground">Street address</Label>
              <Input
                id="addressLine1"
                required
                type="text"
                value={address.addressLine1}
                onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })}
                placeholder="12 Main Road"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="addressLine2" className="text-muted-foreground">
                Address line 2 <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Input
                id="addressLine2"
                type="text"
                value={address.addressLine2}
                onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })}
                placeholder="Building entrance, floor, landmark"
              />
            </div>
          </div>
            </>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={showSitePicker && selectedSiteId === null}
          >
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
            {/* "Other" requires client to pick the closest real category */}
            {category.slug === 'other' && (
              <div className="space-y-1.5">
                <Label htmlFor="closestCategory" className="text-muted-foreground">
                  Closest type of work <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Choose the closest type of help so we can find the right worker.
                </p>
                <Select
                  value={closestCategory}
                  onValueChange={setClosestCategory}
                >
                  <SelectTrigger id="closestCategory" className="w-full">
                    <SelectValue placeholder="Select the closest match…" />
                  </SelectTrigger>
                  <SelectContent>
                    {REAL_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.tag} value={cat.tag}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="subcategory" className="text-muted-foreground">
                Specific type of work <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Input
                id="subcategory"
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="e.g. leaking tap, gate motor, DB board"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="jobType" className="text-muted-foreground">Job type</Label>
              <Select value={jobType} onValueChange={(value) => setJobType(value as JobType)}>
                <SelectTrigger id="jobType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
            <div className="space-y-1">
              <Label htmlFor="accessNotes" className="text-muted-foreground">
                Access notes <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Textarea
                id="accessNotes"
                value={accessNotes}
                onChange={(event) => setAccessNotes(event.target.value)}
                placeholder="Landmarks, gate/security instructions, parking notes, dog warnings"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Access notes are shared only with the selected provider after they accept your job.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="photos" className="text-muted-foreground">
                Photos <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []).slice(0, 5)
                  setPhotos(selected)
                }}
              />
              <p className="text-xs text-muted-foreground">
                Add up to 5 photos of the problem so the provider can quote with less back-and-forth.
              </p>
              {photos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {photos.length} photo{photos.length === 1 ? '' : 's'} selected.
                  </p>
                  <div className="space-y-1">
                    {photos.map((photo, index) => (
                      <div key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
                        <span className="truncate">{photo.name}</span>
                        <button
                          type="button"
                          className="font-medium text-destructive"
                          onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {photos.length > 0 && (
                <div className="space-y-1 border border-border rounded-xl px-4 py-3 bg-muted/30">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="photosSafeForPreview"
                      checked={photosSafeForPreview}
                      onCheckedChange={(value) => setPhotosSafeForPreview(value === true)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="photosSafeForPreview" className="text-muted-foreground">
                        Share photos with shortlisted providers before acceptance
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Keep this on so providers can better estimate arrival and pricing before you select one.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Urgency picker */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">When do you need this done?</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['asap', 'this_week', 'flexible'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUrgency(u)}
                    className={`rounded-lg border px-2 py-2 text-center text-xs transition-colors ${
                      urgency === u
                        ? 'border-primary bg-primary/10 font-semibold'
                        : 'border-border bg-card hover:bg-muted'
                    }`}
                  >
                    {URGENCY_LABELS[u]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="preferredDate" className="text-muted-foreground">
                  Preferred date <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                <Input
                  id="preferredDate"
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preferredTimeWindow" className="text-muted-foreground">Time</Label>
                <Select
                  value={preferredTimeWindow}
                  onValueChange={(value) => setPreferredTimeWindow(value as PreferredTimeWindow)}
                >
                  <SelectTrigger id="preferredTimeWindow" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_WINDOW_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="providerPreference" className="text-muted-foreground">Provider preference</Label>
              <Select
                value={providerPreference}
                onValueChange={(value) => setProviderPreference(value as ProviderPreference)}
              >
                <SelectTrigger id="providerPreference" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_PREFERENCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="budgetPreference" className="text-muted-foreground">Budget</Label>
                <Select
                  value={budgetPreference}
                  onValueChange={(value) => setBudgetPreference(value as BudgetPreference)}
                >
                  <SelectTrigger id="budgetPreference" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_PREFERENCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="maxCallOutFee" className="text-muted-foreground">
                  Max call-out <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                <Input
                  id="maxCallOutFee"
                  inputMode="numeric"
                  min="0"
                  type="number"
                  value={maxCallOutFee}
                  onChange={(e) => setMaxCallOutFee(e.target.value)}
                  placeholder="R"
                />
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg">
            Review request →
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              const validationError = validateDescriptionStep()
              if (validationError) {
                setError(validationError)
                return
              }
              setError(null)
              setStep('confirm')
            }}
          >
            Continue without photos
          </Button>
        </form>
      )}

      {/* ── Step 3: Confirm ──────────────────────────────────────────────── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="font-medium">Confirm your request</h2>

          <Card>
            <CardContent className="px-4 py-4 space-y-3 text-sm">
              <Row label="Category">
                {category.slug === 'other' && closestCategory
                  ? `${REAL_CATEGORIES.find((c) => c.tag === closestCategory)?.label ?? closestCategory} (Other)`
                  : category.name}
              </Row>
              {subcategory && <Row label="Specific">{subcategory}</Row>}
              <Row label="Type">{JOB_TYPE_OPTIONS.find((option) => option.value === jobType)?.label ?? jobType}</Row>
              <Row label="Job">{title}</Row>
              {description && <Row label="Details">{description}</Row>}
              {accessNotes && <Row label="Access notes">{accessNotes}</Row>}
              {photos.length > 0 && <Row label="Photos">{photos.length} attached</Row>}
              <Row label="Timing">{URGENCY_LABELS[urgency]}</Row>
              {preferredDate && (
                <Row label="Preferred">
                  {preferredDate} · {TIME_WINDOW_OPTIONS.find((option) => option.value === preferredTimeWindow)?.label ?? preferredTimeWindow}
                </Row>
              )}
              <Row label="Provider">
                {PROVIDER_PREFERENCE_OPTIONS.find((option) => option.value === providerPreference)?.label ?? providerPreference}
              </Row>
              <Row label="Budget">
                {BUDGET_PREFERENCE_OPTIONS.find((option) => option.value === budgetPreference)?.label ?? budgetPreference}
                {maxCallOutFee ? ` · Max R${maxCallOutFee}` : ''}
              </Row>
              <Row label="Address">
                {[streetSummary, address.suburb, address.region, address.city, address.province, address.postalCode]
                  .filter(Boolean)
                  .join(', ')}
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 px-4 py-4 text-sm">
              <p className="font-medium">Before we send this to providers</p>
              <p className="text-muted-foreground">
                Your phone number and exact address will only be shared after you select a provider and that provider accepts the job.
              </p>
              <label className="flex items-start gap-2">
                <input
                  checked={privacyAcknowledged}
                  className="mt-1"
                  type="checkbox"
                  onChange={(event) => setPrivacyAcknowledged(event.target.checked)}
                />
                <span>I understand when my contact and exact address are shared.</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  checked={termsAcknowledged}
                  className="mt-1"
                  type="checkbox"
                  onChange={(event) => setTermsAcknowledged(event.target.checked)}
                />
                <span>I confirm these request details are accurate.</span>
              </label>
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

      {/* ── Waitlisted: outside service area ─────────────────────────────── */}
      {step === 'waitlisted' && (
        <Card>
          <CardContent className="px-4 py-6 space-y-3 text-center">
            <p className="text-2xl">📍</p>
            <p className="font-semibold text-base">Not in your area yet</p>
            <p className="text-sm text-muted-foreground">
              We&apos;re not in <strong>{waitlistedCity}</strong> just yet, but we&apos;re growing fast.
            </p>
            <p className="text-sm text-muted-foreground">
              We&apos;ve saved your contact and will reach out the moment Plug A Pro goes live in your area. No action needed from you.
            </p>
            <p className="text-xs text-muted-foreground pt-2">
              Currently serving: <strong>Johannesburg</strong>
            </p>
          </CardContent>
        </Card>
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
                We&apos;re checking suitable providers in your area. We&apos;ll send you a WhatsApp message when your shortlist is ready.
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

function coerceUrgency(value?: string | null): Urgency {
  return value === 'asap' || value === 'this_week' || value === 'flexible' ? value : 'flexible'
}

function coerceOption<T extends readonly { value: string }[]>(
  value: string | null | undefined,
  options: T,
  fallback: T[number]['value'],
): T[number]['value'] {
  return options.some((option) => option.value === value) ? value! : fallback
}
