'use client'

/* eslint-disable react-hooks/set-state-in-effect */

// ─── Multi-step job request flow ──────────────────────────────────────────────
// Steps: address → description → confirm → submitted

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ChevronLeft, MapPin, Shield, CheckCircle2, Zap, Clock, Calendar } from 'lucide-react'
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
import { SuburbPicker, type Selection as SuburbSelection } from './SuburbPicker'
import { buildLegacyStreetAddress } from '@/lib/address-format'
import { trackJobRequestSubmitted } from '@/lib/meta-pixel'
import { analytics } from '@/lib/analytics'
import { fireGoogleAdsConversion } from '@/lib/marketing/google-ads'
import { getStoredAttribution, getStoredUtm } from '@/lib/attribution'
import { WA_ENABLED } from '@/lib/whatsapp-client'
import { getPilotServiceCategories } from '@/lib/service-categories'
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
import { getRequestSuccessContent } from '@/lib/customer-request-success-content'

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
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
  suburb: string
  city: string
  province: string
  postalCode: string | null
  locationNodeId: string | null
  locationNode?: { regionKey: string | null } | null
}

interface BookingFlowProps {
  category: CategoryData
  preferredProviderId?: string | null
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
  initialAddress?: SuburbSelection | null
  initialAreaLabel?: string | null
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
type MatchingMode = 'quick_match' | 'review_first'

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
const REAL_CATEGORIES = getPilotServiceCategories()

const URGENCY_LABELS: Record<Urgency, string> = {
  asap: 'Today / ASAP',
  this_week: 'This week',
  flexible: "I'm flexible",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BookingFlow({
  category,
  preferredProviderId = null,
  initialDraft,
  initialAddress = null,
  initialAreaLabel = null,
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
    suburb: initialAddress?.suburb ?? '',
    region: initialAddress?.region ?? '',
    city: initialAddress?.city ?? '',
    province: initialAddress?.province ?? 'Gauteng',
    postalCode: initialAddress?.postalCode ?? '',
  })
  const [subcategory, setSubcategory] = useState(initialDraft?.subcategory ?? '')
  const [jobType, setJobType] = useState<JobType>(coerceOption(initialDraft?.jobType, JOB_TYPE_OPTIONS, 'repair'))
  const [title, setTitle] = useState(initialDraft?.title ?? '')
  const [description, setDescription] = useState(initialDraft?.description ?? '')
  const [accessNotes, setAccessNotes] = useState(initialDraft?.accessNotes ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [photoErrors, setPhotoErrors] = useState<string[]>([])
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
  const [locationNodeId, setLocationNodeId] = useState<string | null>(initialAddress?.locationNodeId ?? null)
  const [locationDetectedLabel, setLocationDetectedLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    initialAreaLabel
      ? `We could not prefill ${initialAreaLabel}. Please search for your suburb below.`
      : null,
  )
  const [jobRequestId, setJobRequestId] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [selectedMatchingMode, setSelectedMatchingMode] = useState<MatchingMode | null>(null)
  const [hasProviderResponses, setHasProviderResponses] = useState(false)
  const [matchingModeSubmitting, setMatchingModeSubmitting] = useState(false)
  const [waitlistedCity, setWaitlistedCity] = useState<string | null>(null)
  const streetSummary = buildLegacyStreetAddress(address)
  const draftStorageKey = `plugapro:client-request-draft:${category.slug}`
  const hasInitialDraft = Boolean(initialDraft && Object.values(initialDraft).some(Boolean))

  useEffect(() => {
    if (step !== 'submitted' || !jobRequestId) return

    const successView = getRequestSuccessContent({
      jobRequestId,
      ticketUrl,
      selectedMatchingMode,
      preferredProviderId,
      hasProviderResponses,
    })

    console.info('[booking-flow] request_submitted_success_viewed', {
      event: 'request_submitted_success_viewed',
      requestId: jobRequestId,
      matchMode: successView.mode,
      requestStatus: successView.statusLabel,
      authState: 'authenticated',
      source: 'pwa',
    })
    trackJobRequestSubmitted(jobRequestId)
    analytics.requestSubmitted({ job_request_id: jobRequestId, category: category.slug })
    fireGoogleAdsConversion('quote', { transactionId: jobRequestId })
  }, [category.slug, hasProviderResponses, jobRequestId, preferredProviderId, selectedMatchingMode, step, ticketUrl])

  // Funnel-top event — fires once on first mount even if the user bails
  // before reaching /api/customer/bookings.
  useEffect(() => {
    analytics.quoteStarted({
      service_slug: category.slug,
      category: category.slug,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      return 'Select your suburb before continuing - use "Use my location" or type in the search box.'
    }

    const suburb = normalizeValue(address.suburb)
    const city = normalizeValue(address.city)
    const province = normalizeValue(address.province)
    const region = normalizeValue(address.region)
    const postalCode = address.postalCode.trim()

    if (!suburb || !city || (!region && !locationNodeId) || !province || !postalCode) {
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
      const res = await fetch(`/api/customer/location-reverse?${params}`, {
        headers: { Accept: 'application/json' },
      })

      // A redirected or non-JSON response (e.g. an auth redirect landing on an
      // HTML page) must never reach res.json(): in WebKit that throws an opaque
      // "The string did not match the expected pattern." Treat anything that is
      // not a JSON 2xx as a handled failure.
      const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
      if (!res.ok || res.redirected || !isJson) {
        throw new Error('LOCATION_LOOKUP_FAILED')
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
      // Never surface a raw exception message to the customer (a native WebKit
      // error like "The string did not match the expected pattern." used to leak
      // here). Log the real error for diagnosis and show actionable copy.
      console.error('[booking-flow] use-my-location failed', err)
      setError('We could not read your location. Please enter your suburb below.')
    } finally {
      setLocationLoading(false)
    }
  }

  // ── Site picker helpers ────────────────────────────────────────────────────

  function applySavedSite(site: SavedSite) {
    setAddress((current) => ({
      ...current,
      addressLine1: site.street,
      addressLine2: site.addressLine2 ?? '',
      complexName: site.complexName ?? '',
      unitNumber: site.unitNumber ?? '',
      suburb: site.suburb,
      city: site.city,
      province: site.province,
      postalCode: site.postalCode ?? '',
      region: site.locationNode?.regionKey ?? '',
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
    // No job_request_id yet — draftStorageKey is stable per category for the
    // session and gives the dedup helper something to anchor on.
    analytics.bookingStarted({ job_request_id: draftStorageKey })
    setStep('confirm')
  }

  // ── Step 3: Confirm - create job request ───────────────────────────────────

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
          ? `[Other - originally uncategorised]\nJob type: ${jobType}\n${description.trim()}`
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
      if (preferredProviderId) formData.set('preferredProviderId', preferredProviderId)
      if (accessNotes.trim()) formData.set('accessNotes', accessNotes.trim())
      if (maxCallOutFee.trim()) formData.set('maxCallOutFee', maxCallOutFee.trim())

      const utm = getStoredUtm()
      if (utm?.utm_source) formData.set('utmSource', utm.utm_source)
      if (utm?.utm_medium) formData.set('utmMedium', utm.utm_medium)
      if (utm?.utm_campaign) formData.set('utmCampaign', utm.utm_campaign)
      if (utm?.utm_content) formData.set('utmContent', utm.utm_content)

      // Forward-compat: the richer attribution blob (click IDs, referrer,
      // landing path, first/last touch). The bookings API ignores unknown
      // form fields today; a follow-up Prisma migration will persist this.
      const attribution = getStoredAttribution()
      if (attribution) formData.set('attributionJson', JSON.stringify(attribution))

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
          // Draft is auto-saved to localStorage - redirect to sign-in and come back
          const returnPath = `${window.location.pathname}${window.location.search}`
          window.location.href = `/sign-in?next=${encodeURIComponent(returnPath || `/book/${category.slug}`)}`
          return
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
      // Timing window is only fully resolved after handleConfirm runs the
      // urgency → window calc; fire slot_selected here so it carries a real
      // job_request_id for dedup downstream.
      analytics.slotSelected({
        job_request_id: data.jobRequestId,
        window_start: timing.requestedWindowStart?.toISOString(),
        window_end: timing.requestedWindowEnd?.toISOString(),
      })
      window.localStorage.removeItem(draftStorageKey)
      setStep('submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not submit your request right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMatchingModeSelect(mode: MatchingMode) {
    if (!jobRequestId || matchingModeSubmitting) return
    setError(null)
    setMatchingModeSubmitting(true)
    try {
      const res = await fetch(`/api/customer/requests/${jobRequestId}/matching-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Your session has expired. Please sign in again.')
        }
        throw new Error('Could not start matching mode right now. Please try again.')
      }
      const data = await res.json().catch(() => ({})) as { status?: string }
      setHasProviderResponses(mode === 'review_first' && data.status === 'review_options_ready')
      setSelectedMatchingMode(mode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start matching mode right now. Please try again.')
    } finally {
      setMatchingModeSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const STEP_SEQUENCE = ['address', 'description', 'confirm', 'submitted'] as const
  const stepIndex = STEP_SEQUENCE.indexOf(step as typeof STEP_SEQUENCE[number])
  const STEP_LABELS: Partial<Record<Step, string>> = {
    address: 'Service address',
    description: 'Job details',
    confirm: 'Review',
    submitted: 'Request received',
    waitlisted: 'Area not covered',
  }

  return (
    <div className="min-h-screen pb-32">

      {/* Header strip */}
      {step !== 'submitted' && (
        <div className="px-[18px] pt-[54px] pb-4">
          <div className="flex items-center gap-3 mb-3">
            {step !== 'waitlisted' && (
              <button
                type="button"
                onClick={() => {
                  // Clear any banner so a message from a later step does not
                  // linger on the step we navigate back to.
                  setError(null)
                  if (step === 'description') setStep('address')
                  else if (step === 'confirm') setStep('description')
                  else if (step === 'address') window.history.back()
                }}
                className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
                style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink)' }}
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="flex-1">
              {step !== 'waitlisted' && (
                <div className="text-[11px] font-bold tracking-[0.06em] uppercase" style={{ color: 'var(--brand-purple)' }}>
                  {category.name} · Step {Math.max(stepIndex + 1, 1)} of 3
                </div>
              )}
              <div className="text-[19px] font-bold tracking-[-0.025em] mt-0.5" style={{ color: 'var(--ink)' }}>
                {STEP_LABELS[step] ?? ''}
              </div>
            </div>
          </div>
          {step !== 'waitlisted' && stepIndex < 3 && (
            <div
              className="flex gap-1"
              role="progressbar"
              aria-valuenow={stepIndex + 1}
              aria-valuemin={1}
              aria-valuemax={3}
              aria-label={`Step ${stepIndex + 1} of 3`}
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex-1 h-1 rounded-full"
                     style={{ background: i <= stepIndex ? 'var(--brand-gradient, var(--brand-purple))' : 'var(--border)', transition: 'background 0.3s' }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-[18px] mb-4 rounded-[14px] px-4 py-3 text-[13px]"
             style={{ background: 'rgba(229,72,77,0.08)', boxShadow: 'inset 0 0 0 1px rgba(229,72,77,0.2)', color: '#E5484D' }}>
          {error}
        </div>
      )}

      {/* ── Step 1: Address ──────────────────────────────────────────────────── */}
      {step === 'address' && (
        <form onSubmit={handleAddressSubmit} className="px-[18px] space-y-4">
          {/* Privacy notice */}
          <div className="rounded-[16px] p-4"
               style={{ background: 'var(--brand-gradient-soft, rgba(139,63,232,0.06))', boxShadow: 'inset 0 0 0 1px rgba(139,63,232,0.12)' }}>
            <div className="flex items-start gap-3">
              <Shield size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--brand-purple)' }} />
              <div className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--ink)' }}>
                <strong>Your address stays private.</strong> Providers only see your suburb and province until one accepts the job.
              </div>
            </div>
          </div>

          {/* Saved site picker (flag-gated) */}
          {showSitePicker && (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-mute)' }}>Saved sites</div>
              <div className="space-y-2">
                {savedSites.map((site) => (
                  <button key={site.id} type="button" onClick={() => applySavedSite(site)}
                          className="w-full text-left rounded-[14px] px-4 py-3"
                          style={{
                            background: selectedSiteId === site.id ? 'var(--brand-gradient-soft, rgba(139,63,232,0.08))' : 'var(--card)',
                            boxShadow: selectedSiteId === site.id ? 'inset 0 0 0 1.5px var(--brand-purple)' : 'inset 0 0 0 1px var(--border)',
                            color: 'var(--ink)',
                          }}>
                    <div className="text-[14px] font-semibold">{site.label ?? site.suburb}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                      {[site.street, site.suburb, site.city].filter(Boolean).join(', ')}
                    </div>
                  </button>
                ))}
                <button type="button" onClick={handleEnterNewAddress}
                        className="w-full text-left rounded-[14px] px-4 py-3"
                        style={{
                          background: selectedSiteId === 'new' ? 'var(--brand-gradient-soft, rgba(139,63,232,0.08))' : 'var(--card)',
                          boxShadow: selectedSiteId === 'new' ? 'inset 0 0 0 1.5px var(--brand-purple)' : 'inset 0 0 0 1px var(--border)',
                          color: 'var(--ink)',
                        }}>
                  <div className="text-[14px] font-semibold">+ Enter a new address</div>
                </button>
              </div>
            </div>
          )}

          {(!showSitePicker || selectedSiteId !== null) && (
            <>
              {/* Use my location */}
              <button type="button" onClick={handleUseMyLocation} disabled={locationLoading}
                      className="w-full h-12 rounded-[14px] flex items-center justify-center gap-2.5 text-[13.5px] font-semibold"
                      style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink)' }}>
                <MapPin size={16} style={{ color: 'var(--brand-purple)' }} />
                {locationLoading ? 'Finding your address…' : 'Use my current location'}
              </button>
              {locationDetectedLabel && (
                <div className="text-center text-[12px]" style={{ color: 'var(--ink-mute)' }}>
                  Detected: <span className="font-semibold">{locationDetectedLabel}</span>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-soft)' }}>or enter manually</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              <div className="space-y-3">
                {/* Province */}
                <div>
                  <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Province</div>
                  <Select
                    value={address.province}
                    onValueChange={(val) => {
                      setError(null)
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
                    <SelectTrigger id="province" className="w-full h-12 rounded-[14px]"
                                   style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVINCE_LABELS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Suburb */}
                <div>
                  <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Suburb</div>
                  <SuburbPicker
                    provinceKey={PROVINCE_KEY_BY_LABEL[address.province] ?? 'gauteng'}
                    initialSelection={initialAddress}
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

                {/* Unit + Complex */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                      Unit <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
                    </div>
                    <Input id="unitNumber" type="text" value={address.unitNumber}
                           onChange={(e) => setAddress({ ...address, unitNumber: e.target.value })}
                           placeholder="12B" className="h-12 rounded-[14px]" />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                      Complex <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
                    </div>
                    <Input id="complexName" type="text" value={address.complexName}
                           onChange={(e) => setAddress({ ...address, complexName: e.target.value })}
                           placeholder="Acacia Mews" className="h-12 rounded-[14px]" />
                  </div>
                </div>

                {/* Street address */}
                <div>
                  <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Street address</div>
                  <Input id="addressLine1" required type="text" value={address.addressLine1}
                         onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })}
                         placeholder="12 Main Road" className="h-12 rounded-[14px]" />
                </div>

                {/* Address line 2 */}
                <div>
                  <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                    Address line 2 <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
                  </div>
                  <Input id="addressLine2" type="text" value={address.addressLine2}
                         onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })}
                         placeholder="Building entrance, floor, landmark" className="h-12 rounded-[14px]" />
                </div>
              </div>
            </>
          )}

          <Button type="submit" className="w-full" size="lg"
                  disabled={showSitePicker && selectedSiteId === null}>
            Continue →
          </Button>
        </form>
      )}

      {/* ── Step 2: Description ────────────────────────────────────────────────── */}
      {step === 'description' && (
        <form onSubmit={handleDescriptionSubmit} className="px-[18px] space-y-4">
          {/* "Other" category fallback */}
          {category.slug === 'other' && (
            <div>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                Closest type of work <span style={{ color: '#E5484D' }}>*</span>
              </div>
              <p className="text-[11.5px] mb-2" style={{ color: 'var(--ink-mute)' }}>
                Choose the closest type of help so we can find the right worker.
              </p>
              <Select value={closestCategory} onValueChange={setClosestCategory}>
                <SelectTrigger id="closestCategory" className="w-full h-12 rounded-[14px]">
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

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
              Specific type of work <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
            </div>
            <Input id="subcategory" type="text" value={subcategory}
                   onChange={(e) => setSubcategory(e.target.value)}
                   placeholder="e.g. leaking tap, gate motor, DB board" className="h-12 rounded-[14px]" />
          </div>

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Job type</div>
            <Select value={jobType} onValueChange={(value) => setJobType(value as JobType)}>
              <SelectTrigger id="jobType" className="w-full h-12 rounded-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOB_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Job title</div>
            <Input id="title" required type="text" value={title}
                   onChange={(e) => setTitle(e.target.value)}
                   placeholder="e.g. Fix leaking kitchen tap" className="h-12 rounded-[14px]" />
          </div>

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
              Details <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
            </div>
            <Textarea id="description" value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe the problem, any access notes or urgency…"
                      rows={4} className="rounded-[14px]" />
          </div>

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
              Access notes <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
            </div>
            <Textarea id="accessNotes" value={accessNotes}
                      onChange={(event) => setAccessNotes(event.target.value)}
                      placeholder="Landmarks, gate/security instructions, parking notes"
                      rows={3} className="rounded-[14px]" />
            <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink-mute)' }}>
              Shared only with the selected provider after acceptance.
            </div>
          </div>

          {/* Photos */}
          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
              Photos <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
            </div>
            <Input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              className="rounded-[14px]"
              onChange={(event) => {
                const MAX_PHOTO_SIZE = 10 * 1024 * 1024
                const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
                const raw = Array.from(event.target.files ?? []).slice(0, 5)
                const valid: File[] = []
                const errors: string[] = []
                for (const file of raw) {
                  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
                    errors.push(`"${file.name}" is not a supported image type (JPEG, PNG, WEBP, HEIC, GIF).`)
                  } else if (file.size > MAX_PHOTO_SIZE) {
                    errors.push(`"${file.name}" is too large - photos must be 10 MB or smaller.`)
                  } else {
                    valid.push(file)
                  }
                }
                setPhotos(valid)
                setPhotoErrors(errors)
              }}
            />
            <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink-mute)' }}>
              Up to 5 photos help providers quote faster.
            </div>
            {photoErrors.length > 0 && (
              <div className="space-y-1 mt-2">
                {photoErrors.map((err, i) => (
                  <p key={i} className="text-[12px]" style={{ color: '#E5484D' }}>{err}</p>
                ))}
              </div>
            )}
            {photos.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="text-[12px]" style={{ color: 'var(--ink-mute)' }}>
                  {photos.length} photo{photos.length === 1 ? '' : 's'} selected.
                </div>
                <div className="space-y-1">
                  {photos.map((photo, index) => (
                    <div key={`${photo.name}-${index}`}
                         className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[12px]"
                         style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                      <span className="truncate" style={{ color: 'var(--ink)' }}>{photo.name}</span>
                      <button type="button" className="font-semibold shrink-0" style={{ color: '#E5484D' }}
                              onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="rounded-[12px] px-4 py-3"
                     style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="photosSafeForPreview"
                      checked={photosSafeForPreview}
                      onCheckedChange={(value) => setPhotosSafeForPreview(value === true)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="photosSafeForPreview" className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
                        Share photos with shortlisted providers before acceptance
                      </Label>
                      <p className="text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
                        Keep this on so providers can estimate pricing before you select one.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Urgency - 3 coloured tiles */}
          <div>
            <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>When do you need this done?</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'asap' as const, label: 'Emergency', sub: 'Today / ASAP', hue: 'var(--danger)', icon: <Zap size={14} /> },
                { id: 'this_week' as const, label: 'This week', sub: 'Within days', hue: 'var(--color-amber)', icon: <Clock size={14} /> },
                { id: 'flexible' as const, label: 'Flexible', sub: "I'm flexible", hue: 'var(--color-teal)', icon: <Calendar size={14} /> },
              ]).map((u) => {
                const active = urgency === u.id
                return (
                  <button key={u.id} type="button" onClick={() => setUrgency(u.id)}
                          aria-pressed={active}
                          className="rounded-[14px] px-2 py-3 text-left"
                          style={{
                            '--urgency-hue': u.hue,
                            background: 'var(--card)',
                            boxShadow: active ? 'inset 0 0 0 1.5px var(--urgency-hue), 0 4px 14px color-mix(in srgb, var(--urgency-hue) 9%, transparent)' : 'inset 0 0 0 1px var(--border)',
                            color: 'var(--ink)',
                          } as CSSProperties}>
                    <div aria-hidden="true" className="w-7 h-7 rounded-[8px] flex items-center justify-center mb-2"
                         style={{ background: 'color-mix(in srgb, var(--urgency-hue) 10%, transparent)', color: 'var(--urgency-hue)' }}>
                      {u.icon}
                    </div>
                    <div className="text-[13px] font-semibold leading-tight">{u.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>{u.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date + Time window */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                Preferred date <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
              </div>
              <Input id="preferredDate" type="date" value={preferredDate}
                     onChange={(e) => setPreferredDate(e.target.value)} className="h-12 rounded-[14px]" />
            </div>
            <div>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Time</div>
              <Select value={preferredTimeWindow} onValueChange={(value) => setPreferredTimeWindow(value as PreferredTimeWindow)}>
                <SelectTrigger id="preferredTimeWindow" className="w-full h-12 rounded-[14px]">
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

          <div>
            <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Provider preference</div>
            <Select value={providerPreference} onValueChange={(value) => setProviderPreference(value as ProviderPreference)}>
              <SelectTrigger id="providerPreference" className="w-full h-12 rounded-[14px]">
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
            <div>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>Budget</div>
              <Select value={budgetPreference} onValueChange={(value) => setBudgetPreference(value as BudgetPreference)}>
                <SelectTrigger id="budgetPreference" className="w-full h-12 rounded-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_PREFERENCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
                Max call-out <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span>
              </div>
              <Input id="maxCallOutFee" inputMode="numeric" min="0" type="number"
                     value={maxCallOutFee} onChange={(e) => setMaxCallOutFee(e.target.value)}
                     placeholder="R" className="h-12 rounded-[14px]" />
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg">Review request →</Button>
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
              analytics.bookingStarted({ job_request_id: draftStorageKey })
              setStep('confirm')
            }}
          >
            Continue without photos
          </Button>
        </form>
      )}

      {/* ── Step 3: Confirm ────────────────────────────────────────────────────── */}
      {step === 'confirm' && (
        <div className="px-[18px] space-y-4">
          {/* Service summary */}
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>Service</div>
            <Row label="Category">
              {category.slug === 'other' && closestCategory
                ? `${REAL_CATEGORIES.find((c) => c.tag === closestCategory)?.label ?? closestCategory} (Other)`
                : category.name}
            </Row>
            {subcategory && <Row label="Specific">{subcategory}</Row>}
            <Row label="Type">{JOB_TYPE_OPTIONS.find((option) => option.value === jobType)?.label ?? jobType}</Row>
            <Row label="Job">{title}</Row>
            {description && <Row label="Details">{description}</Row>}
            {accessNotes && <Row label="Access">{accessNotes}</Row>}
            {photos.length > 0 && <Row label="Photos">{photos.length} attached</Row>}
          </div>

          {/* Timing & preferences */}
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>Timing &amp; preferences</div>
            <Row label="Urgency">{URGENCY_LABELS[urgency]}</Row>
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
          </div>

          {/* Address */}
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>Address (suburb shared)</div>
            <div className="text-[13.5px]" style={{ color: 'var(--ink)', lineHeight: 1.55 }}>
              {[streetSummary, address.suburb, address.region, address.city, address.province, address.postalCode]
                .filter(Boolean)
                .join(', ')}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
              <Shield size={11} />
              Full address shared only after provider acceptance.
            </div>
          </div>

          {/* Acknowledgements */}
          <div className="rounded-[20px] p-4"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="text-[14px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Before we send this to providers</div>
            <div className="text-[12.5px] mb-4" style={{ color: 'var(--ink-mute)' }}>
              Your phone number and exact address will only be shared after you select a provider and they accept the job.
            </div>
            <label className="flex items-start gap-3 mb-3 cursor-pointer">
              <input type="checkbox" checked={privacyAcknowledged} className="mt-0.5"
                     onChange={(event) => setPrivacyAcknowledged(event.target.checked)} />
              <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
                I understand when my contact and exact address are shared.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={termsAcknowledged} className="mt-0.5"
                     onChange={(event) => setTermsAcknowledged(event.target.checked)} />
              <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
                I confirm these request details are accurate.
              </span>
            </label>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('description')} className="flex-1" size="lg">
              ← Back
            </Button>
            <Button onClick={handleConfirm} loading={loading} loadingLabel="Submitting..." className="flex-1" size="lg">
              Submit request
            </Button>
          </div>
        </div>
      )}

      {/* ── Waitlisted ─────────────────────────────────────────────────────────── */}
      {step === 'waitlisted' && (
        <div className="px-[18px]">
          <div className="rounded-[20px] p-6 text-center"
               style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <div className="w-[64px] h-[64px] rounded-[20px] flex items-center justify-center mx-auto mb-4"
                 style={{ background: 'var(--brand-gradient-soft, rgba(139,63,232,0.08))', color: 'var(--brand-purple)' }}>
              <MapPin size={28} />
            </div>
            <h2 className="text-[17px] font-bold mb-2" style={{ color: 'var(--ink)' }}>Not in your area yet</h2>
            <p className="text-[13px] mb-3" style={{ color: 'var(--ink-mute)' }}>
              We&apos;re not in <strong>{waitlistedCity}</strong> just yet, but we&apos;re growing fast.
            </p>
            <p className="text-[13px] mb-3" style={{ color: 'var(--ink-mute)' }}>
              We&apos;ve saved your contact and will reach out the moment Plug A Pro goes live in your area. No action needed.
            </p>
            <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
              Currently serving: <strong>Johannesburg</strong>
            </p>
          </div>
        </div>
      )}

      {/* ── Step 4: Submitted ─────────────────────────────────────────────────── */}
      {step === 'submitted' && jobRequestId && (
        <div className="relative">
          {/* Radial halo */}
          <div aria-hidden className="absolute inset-0 pointer-events-none"
               style={{ background: 'radial-gradient(60% 50% at 50% 30%, rgba(139,63,232,0.12), transparent 70%)' }} />

          <div className="relative px-[22px] pt-[60px] pb-10 flex flex-col items-center">
            {(() => {
              const modeAwareContent = (selectedMatchingMode || preferredProviderId)
                ? getRequestSuccessContent({
                    jobRequestId,
                    ticketUrl,
                    selectedMatchingMode,
                    preferredProviderId,
                    hasProviderResponses,
                  })
                : null
              const ctaHref = modeAwareContent?.primaryCtaHref ?? (ticketUrl ?? `/requests/${jobRequestId}`)
              const ctaLabel = modeAwareContent?.primaryCtaLabel ?? 'Track request'
              const secondaryHref = modeAwareContent?.secondaryCtaHref ?? '/bookings'
              const secondaryLabel = modeAwareContent?.secondaryCtaLabel ?? 'View my requests'

              return (
                <>
            {/* Layered icon */}
            <div className="w-[120px] h-[120px] rounded-[36px] flex items-center justify-center mb-5"
                 style={{ background: 'var(--brand-gradient-soft, rgba(139,63,232,0.08))' }}>
              <div className="w-[80px] h-[80px] rounded-[24px] flex items-center justify-center text-white"
                   style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)', boxShadow: '0 12px 32px rgba(139,63,232,0.4)' }}>
                <CheckCircle2 size={40} />
              </div>
            </div>

            <h1 className="text-[26px] font-bold tracking-[-0.03em] text-center mb-2"
                style={{ color: 'var(--ink)' }}>
              {modeAwareContent?.title ?? 'Request received'}
            </h1>
            <p className="text-[14.5px] text-center mb-6 leading-[1.55]"
               style={{ color: 'var(--ink-mute)', maxWidth: 320 }}>
              {modeAwareContent?.description ?? 'Choose your matching mode below so we can start provider outreach.'}
            </p>

            {/* Reference card */}
            <div className="w-full rounded-[20px] p-4 mb-4"
                 style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
                     style={{ background: 'var(--brand-gradient-soft, rgba(139,63,232,0.08))', color: 'var(--brand-purple)' }}>
                  <CheckCircle2 size={20} />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Reference</div>
                  <div className="text-[12.5px] tracking-[0.04em] mt-0.5"
                       style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--ink-mute)' }}>
                    {jobRequestId.slice(-8).toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-[11.5px] font-semibold"
                     style={{ background: 'rgba(255,194,43,0.15)', color: '#FFC22B' }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#FFC22B' }} />
                  {modeAwareContent?.statusLabel ?? 'Choose mode'}
                </div>
              </div>
            </div>

            {/* WhatsApp confirmation card */}
            {WA_ENABLED && (
              <div className="w-full rounded-[20px] p-4 mb-4"
                   style={{ background: 'rgba(37,211,102,0.06)', boxShadow: 'inset 0 0 0 1px rgba(37,211,102,0.18)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
                       style={{ background: '#25D366', color: '#fff' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={20} height={20} aria-hidden>
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Updates on WhatsApp</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>Live status, quotes &amp; messages.</div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1FAD52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
            )}

            {/* Matching mode selector */}
            {!selectedMatchingMode ? (
              !preferredProviderId ? (
              <div className="w-full rounded-[20px] p-4 mb-6"
                   style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <div className="text-[14px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                  How would you like to find a provider?
                </div>
                <div className="text-[12.5px] mb-4" style={{ color: 'var(--ink-mute)' }}>
                  Quick Match notifies one provider at a time. Review Providers First collects responses for you to compare.
                </div>
                <div className="space-y-2">
                  <Button className="w-full" disabled={matchingModeSubmitting}
                          onClick={() => handleMatchingModeSelect('quick_match')}>
                    {matchingModeSubmitting ? 'Starting…' : 'Quick Match'}
                  </Button>
                  <Button variant="outline" className="w-full" disabled={matchingModeSubmitting}
                          onClick={() => handleMatchingModeSelect('review_first')}>
                    Review Providers First
                  </Button>
                </div>
              </div>
              ) : null
            ) : (
              <div className="w-full rounded-[20px] p-4 mb-6"
                   style={{ background: 'rgba(15,162,138,0.06)', boxShadow: 'inset 0 0 0 1px rgba(15,162,138,0.2)' }}>
                <div className="text-[13.5px]" style={{ color: 'var(--ink)' }}>
                  {modeAwareContent?.whatsappNote ??
                    (selectedMatchingMode === 'quick_match'
                      ? 'Quick Match is active. We are checking with one suitable provider now and will rotate if they do not respond.'
                      : 'Review Providers First is active. We are collecting provider responses so you can compare before selecting.')}
                </div>
                {modeAwareContent?.helperNote && (
                  <div className="text-[12px] mt-2" style={{ color: 'var(--ink-mute)' }}>
                    {modeAwareContent.helperNote}
                  </div>
                )}
              </div>
            )}

            {modeAwareContent?.steps && (
              <div className="w-full rounded-[20px] p-4 mb-6"
                   style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <div className="text-[13px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>
                  What happens next?
                </div>
                <ol className="space-y-1 text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
                  {modeAwareContent.steps.map((stepLabel, index) => (
                    <li key={stepLabel}>{index + 1}. {stepLabel}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="w-full space-y-2.5">
              <Button asChild className="w-full" size="lg">
                <Link href={ctaHref}>{ctaLabel}</Link>
              </Button>
              <Link href={secondaryHref}
                    className="block text-center text-[13px]" style={{ color: 'var(--ink-mute)' }}>
                {secondaryLabel}
              </Link>
            </div>
                </>
              )
            })()}
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
