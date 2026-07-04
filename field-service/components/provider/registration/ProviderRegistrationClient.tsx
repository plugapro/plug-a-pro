'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  Info,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { WhatsAppLink } from '@/components/shared/WhatsAppLink'
import { EvidenceUploader } from '@/components/provider/registration/EvidenceUploader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OtpInput } from '@/components/ui/otp-input'
import { Textarea } from '@/components/ui/textarea'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { evidenceStepComplete, MIN_EVIDENCE_PHOTOS } from '@/lib/provider-onboarding/quality-gate'
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'
import type { ServiceCategoryOption } from '@/lib/service-categories'

const STATE_KEY = 'pap_provider_registration_state_v2'
const TOKEN_KEY = 'pap_provider_registration_resume_token_v1'
const DRAFT_ID_KEY = 'pap_provider_registration_draft_id_v1'

// Vercel Functions reject request bodies larger than 4.5 MB with a non-JSON
// 413 from the platform layer, so the multipart never reaches our handler.
// Capping the client at 4 MB keeps the request inside that envelope.
export const PROFILE_PHOTO_MAX_BYTES = 4 * 1024 * 1024

// Map HTTP status returned by the profile-photo route (or, for HTML 413/502s,
// the Vercel platform) to a user-facing string. The route already returns
// structured JSON for the cases it knows about; this only kicks in when the
// response body is missing or not JSON.
export function mapUploadStatusToMessage(status: number): string {
  if (status === 401) return 'Verify your mobile number, then try again.'
  if (status === 413) return 'Photo is too large. Use an image under 4 MB.'
  if (status === 415 || status === 422) return 'Use a JPG, PNG, WEBP, or HEIC photo.'
  if (status === 429) return 'Too many uploads. Please wait a minute and try again.'
  if (status >= 500) return 'Photo upload is temporarily unavailable. Please try again.'
  return 'Could not upload the photo. Please try again.'
}

const STEP_KEYS = [
  'welcome',
  'phone',
  'otp',
  'conflict',
  'profile',
  'services',
  'area',
  'availability',
  'verify',
  'evidence',
  'review',
  'submitted',
  'draft',
  'status',
] as const
type StepKey = (typeof STEP_KEYS)[number]
type ApplicationState = 'draft' | 'pending' | 'more_info' | 'approved' | 'rejected' | 'cancelled'
type PreferredContact = '' | 'WHATSAPP' | 'CALL' | 'SMS'

type RegistrationFormState = {
  phone: string
  otp: string
  name: string
  businessName: string
  email: string
  identityBasis: string
  preferredContact: PreferredContact
  profilePhotoUrl: string
  mainSkill: string
  secondarySkills: string[]
  serviceAreas: string[]
  locationNodeIds: string[]
  selectedProvinceId: string
  selectedProvinceKey: string
  selectedCityId: string
  selectedRegionId: string
  travelRadiusKm: number
  experience: string
  bio: string
  availabilityDays: string[]
  availabilityHours: string
  emergencyAvailable: boolean
  callOutFee: string
  evidenceNote: string
  evidenceFileUrls: string[]
  certificationRef: string
  reference1Name: string
  reference1Mobile: string
  reference2Name: string
  reference2Mobile: string
  consentAccepted: boolean
  submittedRef: string
}

type Props = {
  initialStep: StepKey
  initialApplicationState?: ApplicationState | null
  initialApplicationRef?: string | null
  initialDraftResumeStep?: StepKey
  skillOptions: ServiceCategoryOption[]
  qualityGateEnabled?: boolean
}

const DEFAULT_STATE: RegistrationFormState = {
  phone: '',
  otp: '',
  name: '',
  businessName: '',
  email: '',
  identityBasis: 'SA_ID',
  preferredContact: 'WHATSAPP',
  profilePhotoUrl: '',
  mainSkill: '',
  secondarySkills: [],
  serviceAreas: [],
  locationNodeIds: [],
  selectedProvinceId: '',
  selectedProvinceKey: '',
  selectedCityId: '',
  selectedRegionId: '',
  travelRadiusKm: 25,
  experience: '',
  bio: '',
  availabilityDays: [],
  availabilityHours: 'Standard 7am-5pm',
  emergencyAvailable: false,
  callOutFee: '',
  evidenceNote: '',
  evidenceFileUrls: [],
  certificationRef: '',
  reference1Name: '',
  reference1Mobile: '',
  reference2Name: '',
  reference2Mobile: '',
  consentAccepted: false,
  submittedRef: '',
}

const STEP_META: Record<StepKey, { step?: number; title: string; eyebrow: string; icon: ReactNode }> = {
  welcome: { title: 'Get work near you', eyebrow: 'Provider registration', icon: <BriefcaseBusiness /> },
  phone: { step: 1, title: 'Confirm your mobile number', eyebrow: 'Step 1 of 8', icon: <Phone /> },
  otp: { step: 1, title: 'Enter the 6-digit code', eyebrow: 'Step 1 of 8', icon: <ShieldCheck /> },
  conflict: { title: 'That number is a customer account', eyebrow: 'Account check', icon: <Info /> },
  profile: { step: 2, title: 'Tell us who you are', eyebrow: 'Step 2 of 8', icon: <UserRound /> },
  services: { step: 3, title: 'Choose your work', eyebrow: 'Step 3 of 8', icon: <Wrench /> },
  area: { step: 4, title: 'Set your service area', eyebrow: 'Step 4 of 8', icon: <MapPin /> },
  availability: { step: 5, title: 'When can you work?', eyebrow: 'Step 5 of 8', icon: <Clock /> },
  verify: { step: 6, title: 'Identity verification', eyebrow: 'Step 6 of 8', icon: <ShieldCheck /> },
  evidence: { step: 7, title: 'Show your work', eyebrow: 'Step 7 of 8', icon: <Camera /> },
  review: { step: 8, title: 'Review your application', eyebrow: 'Step 8 of 8', icon: <FileCheck2 /> },
  submitted: { title: 'Application received', eyebrow: 'Submitted', icon: <CheckCircle2 /> },
  draft: { title: 'Your application is saved', eyebrow: 'Saved draft', icon: <CheckCircle2 /> },
  status: { title: 'Application status', eyebrow: 'Provider registration', icon: <Check /> },
}

const AVAILABILITY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CONTACT_OPTIONS: { value: PreferredContact; label: string }[] = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'CALL', label: 'Call' },
  { value: 'SMS', label: 'SMS' },
]
const IDENTITY_OPTIONS = [
  { value: 'SA_ID', label: 'SA ID' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'ASYLUM_PERMIT', label: 'Permit' },
]
const EXPERIENCE_OPTIONS = ['0-1 years', '1-3 years', '3-5 years', '5+ years']
const HOURS_OPTIONS = ['Standard 7am-5pm', 'Extended 6am-8pm', '24/7']

type StatusActionHref = string | ((reference: string) => string)
type ProvinceOption = { id: string; slug: string; label: string }
type CityOption = { id: string; slug: string; label: string; provinceKey: string; cityKey: string }
type RegionOption = { id: string; slug: string; label: string; provinceKey: string; cityKey: string; regionKey: string; suburbCount?: number }
type SuburbOption = {
  id: string
  slug: string
  label: string
  regionLabel: string
  cityLabel: string
  provinceLabel: string
  postalCode: string
  provinceKey: string
  cityKey: string
  regionKey: string
}

function supportHref(message: string) {
  const configured = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER
  const digits = configured?.replace(/\D/g, '')
  if (!digits) return `mailto:support@plugapro.co.za?subject=${encodeURIComponent('Provider registration support')}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

function resolveStatusActionHref(href: StatusActionHref, reference: string) {
  return typeof href === 'function' ? href(reference) : href
}

const STATUS_COPY: Record<Exclude<ApplicationState, 'draft'>, {
  title: string
  body: (reference: string) => string
  tone: 'success' | 'warning' | 'danger'
  actionLabel: string
  actionHref: StatusActionHref
}> = {
  pending: {
    title: "We're reviewing your application",
    body: (reference) => `Ref: ${reference || 'Pending'}. We will send review updates on WhatsApp.`,
    tone: 'success',
    actionLabel: 'Contact support',
    actionHref: (reference) => supportHref(
      `Hi Plug A Pro, I want to add work evidence to my provider application${reference ? ` Ref: ${reference}.` : '.'}`,
    ),
  },
  more_info: {
    title: 'Your application needs more information',
    body: () => 'The review team needs an update before your profile can go live. Check WhatsApp for the requested detail.',
    tone: 'warning',
    actionLabel: 'Update application',
    actionHref: '/provider/register/profile',
  },
  approved: {
    title: 'Welcome aboard',
    body: () => 'Your provider profile is approved. Verify identity to unlock credits before buying paid lead credits.',
    tone: 'success',
    actionLabel: 'Verify identity to unlock credits',
    actionHref: '/provider/verification',
  },
  rejected: {
    title: 'Your application was not approved yet',
    body: () => 'This registration cannot be activated in its current form. Check WhatsApp for the review outcome and support options.',
    tone: 'danger',
    actionLabel: 'Contact support',
    actionHref: '/support',
  },
  cancelled: {
    title: 'Your application was cancelled',
    body: () => 'This registration is no longer under review. Start a new application only if support asks you to reapply.',
    tone: 'warning',
    actionLabel: 'Go to sign in',
    actionHref: '/provider-sign-in',
  },
}

function parseStoredState(): RegistrationFormState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) return DEFAULT_STATE
  try {
    const parsed = JSON.parse(raw) as Partial<RegistrationFormState>
    return {
      ...DEFAULT_STATE,
      ...parsed,
      secondarySkills: Array.isArray(parsed.secondarySkills) ? parsed.secondarySkills : [],
      serviceAreas: Array.isArray(parsed.serviceAreas) ? parsed.serviceAreas : [],
      locationNodeIds: Array.isArray(parsed.locationNodeIds) ? parsed.locationNodeIds : [],
      selectedProvinceId: typeof parsed.selectedProvinceId === 'string' ? parsed.selectedProvinceId : '',
      selectedProvinceKey: typeof parsed.selectedProvinceKey === 'string' ? parsed.selectedProvinceKey : '',
      selectedCityId: typeof parsed.selectedCityId === 'string' ? parsed.selectedCityId : '',
      selectedRegionId: typeof parsed.selectedRegionId === 'string' ? parsed.selectedRegionId : '',
      availabilityDays: Array.isArray(parsed.availabilityDays) ? parsed.availabilityDays : [],
      profilePhotoUrl: usableProfilePhotoUrl(parsed.profilePhotoUrl) ?? '',
      travelRadiusKm: Number.isFinite(Number(parsed.travelRadiusKm)) ? Number(parsed.travelRadiusKm) : DEFAULT_STATE.travelRadiusKm,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function usableProfilePhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

function providerRegistrationPhoneInputValue(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('27') && digits.length >= 11) return digits.slice(2)
  return value
}

function routeForStep(step: StepKey): string {
  return step === 'welcome' ? '/provider/register' : `/provider/register/${step}`
}

function backStep(step: StepKey): StepKey {
  const order: StepKey[] = ['welcome', 'phone', 'otp', 'profile', 'services', 'area', 'availability', 'verify', 'evidence', 'review']
  const index = order.indexOf(step)
  return index <= 0 ? 'welcome' : order[index - 1]
}

function stepNumber(step: StepKey): number {
  return STEP_META[step].step ?? 0
}

function serviceTags(form: RegistrationFormState): string[] {
  return Array.from(new Set([form.mainSkill, ...form.secondarySkills].filter(Boolean)))
}

function selectedServiceLabels(form: RegistrationFormState, options: ServiceCategoryOption[]): string {
  const selected = serviceTags(form)
  const labels = options.filter((option) => selected.includes(option.tag)).map((option) => option.label)
  return labels.length > 0 ? labels.join(', ') : 'None selected'
}

function logProviderRegistrationEvent(event: 'provider_registration_start' | 'provider_registration_resume', fields: Record<string, unknown> = {}) {
  try {
    console.info(JSON.stringify({
      event,
      surface: 'provider_registration_pwa',
      ...fields,
    }))
  } catch {
    // Telemetry must never block registration.
  }
}

export function ProviderRegistrationClient({ initialStep, initialApplicationState, initialApplicationRef, initialDraftResumeStep = 'profile', skillOptions, qualityGateEnabled = false }: Props) {
  const router = useRouter()
  const profilePhotoInputRef = useRef<HTMLInputElement>(null)
  const otpSubmitRef = useRef(false)
  const step = initialStep
  const [form, setForm] = useState<RegistrationFormState>(DEFAULT_STATE)
  const [draftId, setDraftId] = useState('')
  const [resumeToken, setResumeToken] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [uploadingProfilePhoto, setUploadingProfilePhoto] = useState(false)
  const [provinces, setProvinces] = useState<ProvinceOption[]>([])
  const [cities, setCities] = useState<CityOption[]>([])
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [suburbs, setSuburbs] = useState<SuburbOption[]>([])
  const [locationLoading, setLocationLoading] = useState({
    provinces: false,
    cities: false,
    regions: false,
    suburbs: false,
  })
  const [locationLoadError, setLocationLoadError] = useState('')

  useEffect(() => {
    setForm(parseStoredState())
    const storedDraftId = window.localStorage.getItem(DRAFT_ID_KEY) ?? ''
    const storedResumeToken = window.localStorage.getItem(TOKEN_KEY) ?? ''
    setDraftId(storedDraftId)
    setResumeToken(storedResumeToken)
    if (storedDraftId || storedResumeToken) {
      logProviderRegistrationEvent('provider_registration_resume', {
        source: 'local_storage',
        hasDraftId: Boolean(storedDraftId),
        hasResumeToken: Boolean(storedResumeToken),
      })
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(form))
    }
  }, [form])

  useEffect(() => {
    if (step !== 'otp') return
    if (form.otp.length === 6 && !verifyingCode && !otpSubmitRef.current) {
      otpSubmitRef.current = true
      void verifyCode(form.otp)
    }
    if (form.otp.length < 6) otpSubmitRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.otp, step, verifyingCode])

  useEffect(() => {
    if (step !== 'area') return
    let cancelled = false

    setLocationLoading((current) => ({ ...current, provinces: true }))
    setLocationLoadError('')
    fetch('/api/locations/provinces')
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload)) throw new Error('Location options unavailable')
        if (!cancelled) setProvinces(payload as ProvinceOption[])
      })
      .catch(() => {
        if (!cancelled) setLocationLoadError('Could not load provinces. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setLocationLoading((current) => ({ ...current, provinces: false }))
      })

    return () => {
      cancelled = true
    }
  }, [step])

  useEffect(() => {
    setCities([])
    setRegions([])
    setSuburbs([])
    if (step !== 'area' || !form.selectedProvinceKey) return
    let cancelled = false

    setLocationLoading((current) => ({ ...current, cities: true }))
    setLocationLoadError('')
    fetch(`/api/locations/cities?provinceKey=${encodeURIComponent(form.selectedProvinceKey)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload)) throw new Error('Location options unavailable')
        if (!cancelled) setCities(payload as CityOption[])
      })
      .catch(() => {
        if (!cancelled) setLocationLoadError('Could not load cities. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setLocationLoading((current) => ({ ...current, cities: false }))
      })

    return () => {
      cancelled = true
    }
  }, [form.selectedProvinceKey, step])

  useEffect(() => {
    setRegions([])
    setSuburbs([])
    if (step !== 'area' || !form.selectedCityId) return
    let cancelled = false

    setLocationLoading((current) => ({ ...current, regions: true }))
    setLocationLoadError('')
    fetch(`/api/locations/regions?cityId=${encodeURIComponent(form.selectedCityId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload)) throw new Error('Location options unavailable')
        if (!cancelled) setRegions(payload as RegionOption[])
      })
      .catch(() => {
        if (!cancelled) setLocationLoadError('Could not load regions. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setLocationLoading((current) => ({ ...current, regions: false }))
      })

    return () => {
      cancelled = true
    }
  }, [form.selectedCityId, step])

  useEffect(() => {
    setSuburbs([])
    if (step !== 'area' || !form.selectedRegionId) return
    let cancelled = false

    setLocationLoading((current) => ({ ...current, suburbs: true }))
    setLocationLoadError('')
    fetch(`/api/locations/suburbs?regionId=${encodeURIComponent(form.selectedRegionId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(payload)) throw new Error('Location options unavailable')
        if (!cancelled) setSuburbs(payload as SuburbOption[])
      })
      .catch(() => {
        if (!cancelled) setLocationLoadError('Could not load suburbs. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setLocationLoading((current) => ({ ...current, suburbs: false }))
      })

    return () => {
      cancelled = true
    }
  }, [form.selectedRegionId, step])

  const progress = useMemo(() => {
    const current = stepNumber(step)
    if (current <= 0) return 0
    return Math.min(100, Math.max(12.5, (current / 8) * 100))
  }, [step])

  function update<K extends keyof RegistrationFormState>(key: K, value: RegistrationFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  function toggleSecondarySkill(tag: string) {
    setForm((current) => ({
      ...current,
      secondarySkills: current.secondarySkills.includes(tag)
        ? current.secondarySkills.filter((skill) => skill !== tag)
        : [...current.secondarySkills, tag],
    }))
    setError('')
  }

  function toggleDay(day: string) {
    setForm((current) => ({
      ...current,
      availabilityDays: current.availabilityDays.includes(day)
        ? current.availabilityDays.filter((entry) => entry !== day)
        : [...current.availabilityDays, day],
    }))
    setError('')
  }

  function selectProvince(provinceId: string) {
    const selected = provinces.find((province) => province.id === provinceId)
    setForm((current) => ({
      ...current,
      selectedProvinceId: selected?.id ?? '',
      selectedProvinceKey: selected?.slug ?? '',
      selectedCityId: '',
      selectedRegionId: '',
      serviceAreas: [],
      locationNodeIds: [],
    }))
    setError('')
  }

  function selectCity(cityId: string) {
    setForm((current) => ({
      ...current,
      selectedCityId: cityId,
      selectedRegionId: '',
      serviceAreas: [],
      locationNodeIds: [],
    }))
    setError('')
  }

  function selectRegion(regionId: string) {
    setForm((current) => ({
      ...current,
      selectedRegionId: regionId,
      serviceAreas: [],
      locationNodeIds: [],
    }))
    setError('')
  }

  function toggleSuburb(suburb: SuburbOption) {
    setForm((current) => {
      const existingIndex = current.locationNodeIds.indexOf(suburb.id)
      if (existingIndex >= 0) {
        return {
          ...current,
          locationNodeIds: current.locationNodeIds.filter((id) => id !== suburb.id),
          serviceAreas: current.serviceAreas.filter((_, index) => index !== existingIndex),
        }
      }

      return {
        ...current,
        locationNodeIds: [...current.locationNodeIds, suburb.id],
        serviceAreas: [...current.serviceAreas, suburb.label],
      }
    })
    setError('')
  }

  function registrationPayload(lastCompletedStep: number) {
    return {
      phone: form.phone,
      email: form.email,
      name: form.name,
      businessName: form.businessName,
      preferredContact: form.preferredContact,
      identityBasis: form.identityBasis,
      profilePhotoUrl: form.profilePhotoUrl,
      skills: serviceTags(form),
      categorySlugs: serviceTags(form),
      serviceAreas: form.serviceAreas,
      locationNodeIds: form.locationNodeIds,
      provinceId: form.selectedProvinceId,
      cityId: form.selectedCityId,
      regionId: form.selectedRegionId,
      experience: form.experience,
      bio: form.bio,
      availabilityDays: form.availabilityDays,
      availabilityHours: form.availabilityHours,
      availability: form.availabilityDays.join(', '),
      emergencyAvailable: form.emergencyAvailable,
      callOutFee: form.callOutFee,
      travelRadiusKm: form.travelRadiusKm,
      evidenceNote: form.evidenceNote,
      evidenceFileUrls: form.evidenceFileUrls,
      certificationRef: form.certificationRef || undefined,
      reference1Name: form.reference1Name,
      reference1Mobile: form.reference1Mobile,
      reference2Name: form.reference2Name,
      reference2Mobile: form.reference2Mobile,
      consentAccepted: form.consentAccepted,
      draftId,
      resumeToken,
      lastCompletedStep,
    }
  }

  function validateCurrentStep(currentStep: StepKey): boolean {
    if (currentStep === 'phone' && form.phone.replace(/\D/g, '').length < 9) {
      setError('Enter a valid South African mobile number.')
      return false
    }
    if (currentStep === 'otp' && form.otp.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code we sent to your phone.')
      return false
    }
    if (currentStep === 'profile' && !form.name.trim()) {
      setError('Enter your full name.')
      return false
    }
    if (currentStep === 'services' && serviceTags(form).length === 0) {
      setError('Choose your main service.')
      return false
    }
    if (currentStep === 'area' && form.locationNodeIds.length === 0) {
      setError('Select at least one suburb from the list.')
      return false
    }
    if (currentStep === 'availability' && (form.availabilityDays.length === 0 || !form.callOutFee.trim())) {
      setError('Choose availability days and enter your call-out fee.')
      return false
    }
    if (currentStep === 'evidence' && qualityGateEnabled) {
      if (!evidenceStepComplete(form.evidenceFileUrls, qualityGateEnabled)) {
        setError(`Add ${MIN_EVIDENCE_PHOTOS} work photos before continuing.`)
        return false
      }
      if (hasHighRiskServiceSelection(serviceTags(form)) && !form.certificationRef.trim()) {
        setError('Enter your certification or registration number for the high-risk trade you selected.')
        return false
      }
    }
    if (currentStep === 'review' && !form.consentAccepted) {
      setError('Accept the provider terms before submitting.')
      return false
    }
    return true
  }

  async function saveDraft(lastCompletedStep: number): Promise<{ draftId: string; resumeToken: string } | null> {
    if (!form.phone.trim()) return null
    setSaving(true)
    try {
      const response = await fetch('/api/provider/registration/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationPayload(lastCompletedStep)),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? payload.error?.message ?? 'Could not save your progress.')
        return null
      }
      setDraftId(payload.draftId)
      window.localStorage.setItem(DRAFT_ID_KEY, payload.draftId)
      if (payload.resumeToken) {
        setResumeToken(payload.resumeToken)
        window.localStorage.setItem(TOKEN_KEY, payload.resumeToken)
      }
      return { draftId: payload.draftId, resumeToken: payload.resumeToken || resumeToken }
    } finally {
      setSaving(false)
    }
  }

  async function goTo(nextStep: StepKey) {
    if (!validateCurrentStep(step)) return
    const completedStep = stepNumber(step)
    if (completedStep > 1) {
      const saved = await saveDraft(completedStep)
      if (!saved) return
    }
    router.push(routeForStep(nextStep))
  }

  function startRegistration() {
    logProviderRegistrationEvent('provider_registration_start', { source: 'welcome_cta' })
    router.push('/provider/register/phone')
  }

  async function sendCode() {
    if (!validateCurrentStep('phone')) return
    setSendingCode(true)
    setError('')
    try {
      const response = await fetch('/api/provider/registration/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? payload.error?.message ?? 'Could not send the code.')
        return
      }
      update('phone', payload.phone ?? form.phone)
      router.push('/provider/register/otp')
    } finally {
      setSendingCode(false)
    }
  }

  async function verifyCode(code = form.otp) {
    if (!validateCurrentStep('otp')) return
    setVerifyingCode(true)
    setError('')
    try {
      const response = await fetch('/api/provider/registration/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? payload.error?.message ?? 'Could not verify the code.')
        return
      }
      update('phone', payload.phone ?? form.phone)
      if (payload.nextStep === 'conflict') {
        router.push('/provider/register/conflict')
        return
      }
      router.push(payload.redirectTo ?? '/provider/register/profile')
    } finally {
      setVerifyingCode(false)
    }
  }

  async function handleProfilePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')

    // Accept image/* OR an unknown MIME paired with a recognised image
    // extension. iOS Safari occasionally surfaces HEIC/HEIF files with
    // file.type === '' or 'application/octet-stream' (Files app share-sheet),
    // which we must not silently reject as "not an image".
    const typeIsUnknown = file.type === '' || file.type === 'application/octet-stream'
    const looksLikeImage =
      file.type.startsWith('image/') ||
      (typeIsUnknown && /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name))
    if (!looksLikeImage) {
      setError('Please choose a JPG, PNG, WEBP, or HEIC photo.')
      event.target.value = ''
      return
    }

    // Keep the client cap aligned with Vercel Functions' 4.5 MB request-body
    // limit so the platform never rejects the multipart POST with a non-JSON
    // 413 (which previously fell through to the generic client fallback).
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError('Photo is too large. Use an image under 4 MB.')
      event.target.value = ''
      return
    }

    const upload = new FormData()
    upload.set('file', file)
    setUploadingProfilePhoto(true)

    try {
      const response = await fetch('/api/provider/registration/profile-photo', {
        method: 'POST',
        body: upload,
      })
      const payload = await response.json().catch(() => null) as {
        ok?: boolean
        profilePhotoUrl?: string
        message?: string
        error?: { message?: string }
      } | null

      if (!response.ok || !payload || !payload.ok || !payload.profilePhotoUrl) {
        // Prefer the server's structured message when present. Fall back to a
        // status-aware default so an HTML 413 from Vercel still tells the user
        // the actual problem rather than an opaque generic.
        const fallback = mapUploadStatusToMessage(response.status)
        setError(payload?.message ?? payload?.error?.message ?? fallback)
        return
      }

      update('profilePhotoUrl', payload.profilePhotoUrl)
    } catch {
      setError('Could not upload the photo. Check your connection and try again.')
    } finally {
      setUploadingProfilePhoto(false)
      event.target.value = ''
    }
  }

  async function saveAndExit() {
    const completedStep = step === 'area' && form.locationNodeIds.length === 0
      ? 3
      : Math.max(1, stepNumber(step))
    const saved = await saveDraft(completedStep)
    if (saved) router.push('/provider/register/draft')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!validateCurrentStep('review')) return
    setSubmitting(true)
    setError('')
    try {
      const saved = await saveDraft(8)
      if (!saved) return
      const response = await fetch('/api/provider/registration/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...registrationPayload(8),
          draftId: saved.draftId,
          resumeToken: saved.resumeToken,
          consentAccepted: form.consentAccepted,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? payload.error?.message ?? 'Could not submit your application.')
        return
      }
      if (payload.outcome === 'awaiting_verification') {
        window.localStorage.removeItem(TOKEN_KEY)
        if (payload.verificationUrl) {
          window.location.href = payload.verificationUrl
        } else {
          setError('We need to verify your identity. We\'ll confirm here once verification passes.')
        }
        return
      }
      const nextForm = { ...form, submittedRef: payload.ref ?? '' }
      setForm(nextForm)
      window.localStorage.setItem(STATE_KEY, JSON.stringify(nextForm))
      window.localStorage.removeItem(TOKEN_KEY)
      router.push('/provider/register/submitted')
    } finally {
      setSubmitting(false)
    }
  }

  const meta = STEP_META[step]
  const statusKey = initialApplicationState && initialApplicationState !== 'draft' ? initialApplicationState : 'pending'
  const statusCopy = STATUS_COPY[statusKey]
  const statusReference = initialApplicationRef ?? form.submittedRef
  const statusActionHref = resolveStatusActionHref(statusCopy.actionHref, statusReference)
  const statusActionUsesAnchor = statusActionHref.startsWith('http') || statusActionHref.startsWith('mailto:')
  const statusActionOpensNewTab = statusActionHref.startsWith('http')
  const statusActionIsWhatsApp = statusActionHref.startsWith('https://wa.me/')
  const showStepper = Boolean(meta.step)

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-background text-[var(--ink)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -left-20 -right-20 h-80"
        style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgba(139,63,232,0.15), transparent 70%)' }}
      />
      <div className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-4 pb-28 pt-4">
        <header className="sticky top-0 z-20 -mx-4 border-b border-[var(--border)] bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Go back"
              onClick={() => router.push(routeForStep(backStep(step)))}
            >
              <ArrowLeft size={18} />
            </Button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[12px] font-semibold text-[var(--brand-purple)]">{meta.eyebrow}</p>
              <h1 className="truncate text-[17px] font-bold text-[var(--ink)]">{meta.title}</h1>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={saveAndExit} loading={saving}>
              Save
            </Button>
          </div>
          {showStepper && (
            <div className="mt-3">
              <div className="grid grid-cols-8 gap-1">
                {Array.from({ length: 8 }, (_, index) => (
                  <span
                    key={index}
                    className={[
                      'h-1.5 rounded-full',
                      index + 1 <= (meta.step ?? 0) ? 'brand-gradient' : 'bg-[var(--border)]',
                    ].join(' ')}
                  />
                ))}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border)]">
                <div className="h-full rounded-full brand-gradient" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </header>

        <section className="flex-1 py-5">
          {error && (
            <div className="mb-4 rounded-lg border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-[13px] font-medium text-[var(--tone-danger-fg)]">
              {error}
            </div>
          )}

          {step === 'welcome' && (
            <ScreenPanel icon={meta.icon} title="Get work near you" description="Apply once, get reviewed, then manage provider leads from your phone.">
              <div className="grid gap-3">
                <InfoRow title="Reviewed before you go live" body="The team checks your service area, trade fit, rates and contact details." />
                <InfoRow title="WhatsApp stays active" body="Registration updates are sent on WhatsApp while the PWA keeps your draft saved." />
                <InfoRow title="What you'll need" body="Mobile number, trade details, areas covered, availability and optional work evidence." />
              </div>
              <FooterActions>
                <Button fullWidth onClick={startRegistration}>
                  Start application
                  <ArrowRight size={18} />
                </Button>
                <Button fullWidth variant="secondary" asChild>
                  <Link href="/provider-sign-in">I already have provider access</Link>
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'phone' && (
            <ScreenPanel icon={meta.icon} title="What number should we use?" description="Use the number you want Plug A Pro to contact for provider work.">
              <Field label="Mobile number">
                <SaMobileNumberInput
                  id="provider-registration-phone"
                  value={providerRegistrationPhoneInputValue(form.phone)}
                  onChange={(next) => update('phone', next)}
                  disabled={sendingCode}
                />
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-mute)]">
                  {SA_OTP_SIGN_IN_HELPER_TEXT}
                </p>
              </Field>
              <Notice>
                Use a provider number. If this number already belongs to a customer account, we will show account options before you continue.
              </Notice>
              <FooterActions>
                <Button fullWidth onClick={sendCode} loading={sendingCode} loadingLabel="Sending...">
                  Send code
                  <ArrowRight size={18} />
                </Button>
                <Button fullWidth variant="secondary" onClick={() => router.push('/provider/register/conflict')}>
                  See options
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'otp' && (
            <ScreenPanel icon={meta.icon} title="Enter the 6-digit code" description="We sent a one-time code to the mobile number you entered.">
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-[var(--ink)]">Verification code</p>
                <OtpInput
                  value={form.otp}
                  onChange={(next) => update('otp', next)}
                  disabled={verifyingCode}
                />
              </div>
              <FooterActions>
                <Button
                  fullWidth
                  onClick={() => verifyCode(form.otp)}
                  loading={verifyingCode}
                  loadingLabel="Checking..."
                  disabled={form.otp.length !== 6}
                  variant={form.otp.length === 6 && !verifyingCode ? 'default' : 'secondary'}
                >
                  Verify code
                  <ArrowRight size={18} />
                </Button>
                <Button fullWidth variant="secondary" onClick={sendCode} loading={sendingCode}>
                  Resend code
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'conflict' && (
            <ScreenPanel icon={meta.icon} title="That number is a customer account" description="Provider and customer access need separate account paths so job details and wallet access stay protected.">
              <div className="grid gap-3">
                <InfoRow title="Use another mobile number" body="Continue provider registration with a number that belongs to the provider profile." />
                <InfoRow title="Keep this customer account" body="Sign in as a customer if you want to manage bookings or requests." />
                <InfoRow title="Need help?" body="Support can advise if the same person needs both account types." />
              </div>
              <FooterActions>
                <Button fullWidth onClick={() => router.push('/provider/register/phone')}>
                  Use another number
                </Button>
                <Button fullWidth variant="secondary" asChild>
                  <Link href="/auth/login">Customer sign in</Link>
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'profile' && (
            <ScreenPanel icon={meta.icon} title="Your provider profile" description="This is the public profile the review team checks before activation.">
              <div className="grid gap-4">
                <button
                  type="button"
                  onClick={() => profilePhotoInputRef.current?.click()}
                  disabled={uploadingProfilePhoto}
                  className="flex min-h-[84px] items-center gap-3 rounded-lg border border-dashed border-[var(--tone-brand-border)] bg-[var(--tone-brand-bg)] p-4 text-left"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-card text-[var(--brand-purple)]">
                    <Camera size={20} />
                  </span>
                  <span>
                    <span className="block text-[14px] font-bold text-[var(--ink)]">
                      {uploadingProfilePhoto ? 'Uploading profile photo...' : form.profilePhotoUrl ? 'Profile photo uploaded' : 'Add a profile photo'}
                    </span>
                    <span className="block text-[12px] leading-relaxed text-[var(--ink-mute)]">
                      A clear face or work photo helps the team review your profile.
                    </span>
                  </span>
                </button>
                <input
                  ref={profilePhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleProfilePhotoChange}
                />
                <Field label="Full name">
                  <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Thabo Nkosi" />
                </Field>
                <Field label="Business or trading name">
                  <Input value={form.businessName} onChange={(event) => update('businessName', event.target.value)} placeholder="Nkosi Plumbing" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" />
                </Field>
                <ChoiceGroup label="ID type">
                  {IDENTITY_OPTIONS.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={form.identityBasis === option.value}
                      onClick={() => update('identityBasis', option.value)}
                    >
                      {option.label}
                    </ChoiceButton>
                  ))}
                </ChoiceGroup>
                <ChoiceGroup label="Preferred contact">
                  {CONTACT_OPTIONS.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={form.preferredContact === option.value}
                      onClick={() => update('preferredContact', option.value)}
                    >
                      {option.label}
                    </ChoiceButton>
                  ))}
                </ChoiceGroup>
              </div>
              <FooterActions>
                <Button fullWidth onClick={() => goTo('services')} loading={saving || uploadingProfilePhoto} loadingLabel={uploadingProfilePhoto ? 'Uploading...' : undefined}>
                  Continue
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'services' && (
            <ScreenPanel icon={meta.icon} title="What work do you want?" description="Pick one main service and any secondary services you can reliably handle.">
              <Field label="Main service">
                <select
                  value={form.mainSkill}
                  onChange={(event) => update('mainSkill', event.target.value)}
                  className="h-[52px] w-full rounded-[16px] bg-card px-[14px] text-[15px] font-medium text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
                >
                  <option value="">Select main trade</option>
                  {skillOptions.map((option) => (
                    <option key={option.tag} value={option.tag}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <ChoiceGroup label="Secondary services">
                {skillOptions.map((option) => (
                  <ChoiceButton
                    key={option.tag}
                    selected={form.secondarySkills.includes(option.tag)}
                    onClick={() => toggleSecondarySkill(option.tag)}
                  >
                    {option.label}
                  </ChoiceButton>
                ))}
              </ChoiceGroup>
              <ChoiceGroup label="Experience">
                {EXPERIENCE_OPTIONS.map((option) => (
                  <ChoiceButton
                    key={option}
                    selected={form.experience === option}
                    onClick={() => update('experience', option)}
                  >
                    {option}
                  </ChoiceButton>
                ))}
              </ChoiceGroup>
              <Field label="Short work summary">
                <Textarea value={form.bio} onChange={(event) => update('bio', event.target.value)} placeholder="What kind of jobs do you usually handle?" />
              </Field>
              <FooterActions>
                <Button fullWidth onClick={() => goTo('area')} loading={saving}>
                  Continue
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'area' && (
            <ScreenPanel icon={meta.icon} title="Where can you work?" description="Select the suburbs you can reach reliably. Exact job addresses stay private until a lead is unlocked.">
              {locationLoadError && (
                <div className="rounded-lg border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-[12px] font-medium text-[var(--tone-danger-fg)]">
                  {locationLoadError}
                </div>
              )}
              <div className="grid gap-3">
                <Field label="Province">
                  <LocationSelect
                    ariaLabel="Province"
                    value={form.selectedProvinceId}
                    onChange={selectProvince}
                    disabled={locationLoading.provinces}
                    placeholder={locationLoading.provinces ? 'Loading provinces...' : 'Select province'}
                  >
                    {provinces.map((province) => (
                      <option key={province.id} value={province.id}>{province.label}</option>
                    ))}
                  </LocationSelect>
                  {!locationLoading.provinces && provinces.length === 0 && (
                    <p className="mt-1 text-[12px] text-[var(--ink-mute)]">No provinces available right now</p>
                  )}
                </Field>
                <Field label="City">
                  <LocationSelect
                    ariaLabel="City"
                    value={form.selectedCityId}
                    onChange={selectCity}
                    disabled={!form.selectedProvinceKey || locationLoading.cities}
                    placeholder={
                      !form.selectedProvinceKey
                        ? 'Select a province first'
                        : locationLoading.cities
                          ? 'Loading cities...'
                          : 'Select city'
                    }
                  >
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>{city.label}</option>
                    ))}
                  </LocationSelect>
                  {!form.selectedProvinceKey && (
                    <p className="mt-1 text-[12px] text-[var(--ink-mute)]">Select a province first</p>
                  )}
                  {form.selectedProvinceKey && !locationLoading.cities && cities.length === 0 && (
                    <p className="mt-1 text-[12px] text-[var(--ink-mute)]">No cities available for this province</p>
                  )}
                </Field>
                <Field label="Region">
                  <LocationSelect
                    ariaLabel="Region"
                    value={form.selectedRegionId}
                    onChange={selectRegion}
                    disabled={!form.selectedCityId || locationLoading.regions}
                    placeholder={
                      !form.selectedCityId
                        ? 'Select a city first'
                        : locationLoading.regions
                          ? 'Loading regions...'
                          : 'Select region'
                    }
                  >
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.suburbCount ? `${region.label} (${region.suburbCount})` : region.label}
                      </option>
                    ))}
                  </LocationSelect>
                  {!form.selectedCityId && (
                    <p className="mt-1 text-[12px] text-[var(--ink-mute)]">Select a city first</p>
                  )}
                  {form.selectedCityId && !locationLoading.regions && regions.length === 0 && (
                    <p className="mt-1 text-[12px] text-[var(--ink-mute)]">No regions available for this city</p>
                  )}
                </Field>
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-[var(--ink)]">Sub-area / suburb</p>
                  {!form.selectedRegionId && (
                    <div className="rounded-lg border border-[var(--border)] bg-card p-3 text-[12px] text-[var(--ink-mute)]">
                      Select a region first
                    </div>
                  )}
                  {form.selectedRegionId && locationLoading.suburbs && (
                    <div className="rounded-lg border border-[var(--border)] bg-card p-3 text-[12px] text-[var(--ink-mute)]">
                      Loading suburbs...
                    </div>
                  )}
                  {form.selectedRegionId && !locationLoading.suburbs && suburbs.length === 0 && (
                    <div className="rounded-lg border border-[var(--border)] bg-card p-3 text-[12px] text-[var(--ink-mute)]">
                      No suburbs available for this region
                    </div>
                  )}
                  {suburbs.length > 0 && (
                    <div className="grid max-h-[260px] gap-2 overflow-y-auto rounded-lg border border-[var(--border)] bg-card p-2">
                      {suburbs.map((suburb) => {
                        const selected = form.locationNodeIds.includes(suburb.id)
                        return (
                          <button
                            key={suburb.id}
                            type="button"
                            onClick={() => toggleSuburb(suburb)}
                            aria-pressed={selected}
                            className={[
                              'flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                              selected
                                ? 'brand-gradient-soft text-[var(--brand-purple)] shadow-[inset_0_0_0_1.5px_var(--tone-brand-border)]'
                                : 'bg-background text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[var(--card-alt)]',
                            ].join(' ')}
                          >
                            <span>
                              <span className="block font-semibold">{suburb.label}</span>
                              <span className="block text-[11px] text-[var(--ink-mute)]">
                                {[suburb.regionLabel, suburb.postalCode].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            {selected && <Check size={17} aria-hidden />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              {form.serviceAreas.length > 0 && (
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-[var(--ink)]">Selected suburbs</p>
                  <div className="flex flex-wrap gap-2">
                    {form.serviceAreas.map((area, index) => {
                      const suburbId = form.locationNodeIds[index]
                      const suburb = suburbs.find((item) => item.id === suburbId)
                      return (
                        <button
                          key={`${suburbId}-${area}`}
                          type="button"
                          onClick={() => suburb && toggleSuburb(suburb)}
                          className="rounded-full brand-gradient-soft px-3 py-1.5 text-[12px] font-semibold text-[var(--brand-purple)] shadow-[inset_0_0_0_1px_var(--tone-brand-border)]"
                        >
                          {area}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <Field label={`Travel radius: ${form.travelRadiusKm} km`}>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={form.travelRadiusKm}
                  onChange={(event) => update('travelRadiusKm', Number(event.target.value))}
                  className="w-full accent-[var(--brand-purple)]"
                />
              </Field>
              <Notice>Customers see your general service area first. Full contact handover happens only through approved lead flows.</Notice>
              <FooterActions>
                <Button fullWidth onClick={() => goTo('availability')} loading={saving}>
                  Continue
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'availability' && (
            <ScreenPanel icon={meta.icon} title="When are you available?" description="Set the days, hours and base call-out fee the review team can use.">
              <ChoiceGroup label="Days available">
                {AVAILABILITY_DAYS.map((day) => (
                  <ChoiceButton key={day} selected={form.availabilityDays.includes(day)} onClick={() => toggleDay(day)}>
                    {day}
                  </ChoiceButton>
                ))}
              </ChoiceGroup>
              <ChoiceGroup label="Typical hours">
                {HOURS_OPTIONS.map((option) => (
                  <ChoiceButton key={option} selected={form.availabilityHours === option} onClick={() => update('availabilityHours', option)}>
                    {option}
                  </ChoiceButton>
                ))}
              </ChoiceGroup>
              <Field label="Base call-out fee">
                <Input inputMode="decimal" value={form.callOutFee} onChange={(event) => update('callOutFee', event.target.value)} placeholder="150" />
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-card p-3">
                <input
                  type="checkbox"
                  checked={form.emergencyAvailable}
                  onChange={(event) => update('emergencyAvailable', event.target.checked)}
                  className="mt-1 size-4 accent-[var(--brand-purple)]"
                />
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--ink)]">Available for emergency jobs</span>
                  <span className="block text-[12px] text-[var(--ink-mute)]">This helps dispatch find providers for urgent requests.</span>
                </span>
              </label>
              <FooterActions>
                <Button fullWidth onClick={() => goTo('verify')} loading={saving}>
                  Continue
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'verify' && (
            <ScreenPanel icon={meta.icon} title="Verify now or later" description="Identity verification is required before paid credit purchases, but you can submit the application first.">
              <div className="grid gap-3">
                <InfoRow title="Verify now" body="Open the identity check and return to finish your provider application." />
                <InfoRow title="Verify later" body="Submit now and complete verification before buying lead credits." />
              </div>
              <FooterActions>
                <Button fullWidth asChild>
                  <Link href="/provider/verification">Verify now</Link>
                </Button>
                <Button fullWidth variant="secondary" onClick={() => goTo('evidence')} loading={saving}>
                  Verify later
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'evidence' && (
            <ScreenPanel
              icon={meta.icon}
              title="Show your work"
              description={
                qualityGateEnabled
                  ? `Add at least ${MIN_EVIDENCE_PHOTOS} work photos. This is required to progress your application.`
                  : 'Add optional evidence that helps the team review your trade fit faster.'
              }
            >
              {qualityGateEnabled && (
                <Field label={`Work photos (${MIN_EVIDENCE_PHOTOS} required)`}>
                  <EvidenceUploader
                    value={form.evidenceFileUrls}
                    onChange={(urls) => update('evidenceFileUrls', urls)}
                    min={MIN_EVIDENCE_PHOTOS}
                    uploadFile={async (file) => {
                      const fd = new FormData()
                      fd.append('file', file)
                      const res = await fetch('/api/provider/registration/evidence-photo', {
                        method: 'POST',
                        body: fd,
                      })
                      const payload = await res.json()
                      if (!res.ok || !payload.ok) {
                        throw new Error(payload.message ?? 'Upload failed')
                      }
                      return payload.url as string
                    }}
                  />
                </Field>
              )}
              {qualityGateEnabled && hasHighRiskServiceSelection(serviceTags(form)) && (
                <Field label="Certification / registration number">
                  <Input
                    value={form.certificationRef}
                    onChange={(event) => update('certificationRef', event.target.value)}
                    placeholder="e.g. wireman licence, gas installer number"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    One of your selected trades requires a certification reference. Enter your licence or registration number.
                  </p>
                </Field>
              )}
              <Field label="Work note">
                <Textarea
                  value={form.evidenceNote}
                  onChange={(event) => update('evidenceNote', event.target.value)}
                  placeholder="Past jobs, tools, certifications or brands you have worked with."
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Reference 1 name">
                  <Input value={form.reference1Name} onChange={(event) => update('reference1Name', event.target.value)} placeholder="Customer name" />
                </Field>
                <Field label="Reference 1 mobile">
                  <Input inputMode="tel" value={form.reference1Mobile} onChange={(event) => update('reference1Mobile', event.target.value)} placeholder="082 000 0000" />
                </Field>
                <Field label="Reference 2 name">
                  <Input value={form.reference2Name} onChange={(event) => update('reference2Name', event.target.value)} placeholder="Customer name" />
                </Field>
                <Field label="Reference 2 mobile">
                  <Input inputMode="tel" value={form.reference2Mobile} onChange={(event) => update('reference2Mobile', event.target.value)} placeholder="082 000 0000" />
                </Field>
              </div>
              <Notice>
                {qualityGateEnabled
                  ? 'Do not upload customer private records here.'
                  : 'Evidence is optional. Do not upload customer private records here.'}
              </Notice>
              <FooterActions>
                <Button fullWidth onClick={() => goTo('review')} loading={saving}>
                  Review application
                  <ArrowRight size={18} />
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'review' && (
            <form onSubmit={submit}>
              <ScreenPanel icon={meta.icon} title="Check your details" description="Edit any section before submitting. The review team may ask for more information on WhatsApp.">
                <ReviewSection title="Profile" editStep="profile" onEdit={(target) => router.push(routeForStep(target))}>
                  <SummaryRow label="Name" value={form.name || 'Missing'} />
                  <SummaryRow label="Business" value={form.businessName || 'Not added'} />
                  <SummaryRow label="Contact" value={form.preferredContact || 'WhatsApp'} />
                </ReviewSection>
                <ReviewSection title="Services" editStep="services" onEdit={(target) => router.push(routeForStep(target))}>
                  <SummaryRow label="Trades" value={selectedServiceLabels(form, skillOptions)} />
                  <SummaryRow label="Experience" value={form.experience || 'Not selected'} />
                </ReviewSection>
                <ReviewSection title="Area and availability" editStep="area" onEdit={(target) => router.push(routeForStep(target))}>
                  <SummaryRow label="Areas" value={form.serviceAreas.join(', ') || 'Missing'} />
                  <SummaryRow label="Days" value={form.availabilityDays.join(', ') || 'Missing'} />
                  <SummaryRow label="Call-out" value={form.callOutFee ? `R${form.callOutFee}` : 'Missing'} />
                </ReviewSection>
                <ReviewSection title="Identity" editStep="verify" onEdit={(target) => router.push(routeForStep(target))}>
                  <SummaryRow label="ID type" value={form.identityBasis || 'Not selected'} />
                  <SummaryRow label="Verification" value="Can be completed after submit" />
                </ReviewSection>
                <div className="rounded-lg border border-[var(--tone-info-border)] bg-[var(--tone-info-bg)] p-3">
                  <p className="text-[13px] font-bold text-[var(--tone-info-fg)]">What happens next</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-mute)]">
                    We review the application, ask for more information if needed, then activate approved providers. Identity verification remains required before credit top-ups.
                  </p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-card p-3">
                  <input
                    type="checkbox"
                    checked={form.consentAccepted}
                    onChange={(event) => update('consentAccepted', event.target.checked)}
                    className="mt-1 size-4 accent-[var(--brand-purple)]"
                  />
                  <span className="text-[12.5px] leading-relaxed text-[var(--ink-mute)]">
                    I confirm this information is accurate and I accept the provider terms. Plug A Pro may review my profile before activating job leads.
                  </span>
                </label>
                <FooterActions>
                  <Button type="submit" fullWidth loading={submitting || saving} loadingLabel="Submitting...">
                    Submit application
                    <ArrowRight size={18} />
                  </Button>
                </FooterActions>
              </ScreenPanel>
            </form>
          )}

          {step === 'submitted' && (
            <ScreenPanel icon={meta.icon} title="Application received" description={`Thanks${form.name ? `, ${form.name.split(' ')[0]}` : ''}. Your provider application is in review.`}>
              <div className="grid gap-3">
                <InfoRow title="What happens next" body="The review team checks your trade, service area, evidence and contact details." />
                <InfoRow title="WhatsApp updates" body={`We will send updates to ${form.phone || 'your mobile number'}.`} />
                <InfoRow title="Reference" body={form.submittedRef || 'Reference will show after review sync.'} />
              </div>
              <FooterActions>
                <Button fullWidth asChild>
                  <Link href="/provider/register/status">View status</Link>
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'draft' && (
            <ScreenPanel icon={meta.icon} title="Your application is saved" description="Continue from your saved draft or leave it here until you are ready.">
              <div className="grid gap-3">
                <InfoRow title="Saved on this device" body="Your draft token is stored locally so you can continue this registration flow." />
                <InfoRow title="Next section" body="Continue to complete profile, services, area, availability, verification choice, evidence and review." />
              </div>
              <FooterActions>
                <Button fullWidth onClick={() => router.push(routeForStep(initialDraftResumeStep))}>
                  Continue application
                  <ArrowRight size={18} />
                </Button>
                <Button fullWidth variant="secondary" asChild>
                  <Link href="/provider-sign-in">Provider sign in</Link>
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}

          {step === 'status' && (
            <ScreenPanel icon={meta.icon} title={statusCopy.title} description={statusCopy.body(statusReference)}>
              <div
                className={[
                  'rounded-lg border p-4',
                  statusCopy.tone === 'danger'
                    ? 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)]'
                    : statusCopy.tone === 'warning'
                      ? 'border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]'
                      : 'border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]',
                ].join(' ')}
              >
                <p
                  className={[
                    'text-[13px] font-bold',
                    statusCopy.tone === 'danger'
                      ? 'text-[var(--tone-danger-fg)]'
                      : statusCopy.tone === 'warning'
                        ? 'text-[var(--tone-warning-fg)]'
                        : 'text-[var(--tone-success-fg)]',
                  ].join(' ')}
                >
                  {statusCopy.title}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-mute)]">
                  {statusKey === 'approved' ? 'Credits locked until verification is complete.' : 'Keep this phone number available for review updates.'}
                </p>
              </div>
              <FooterActions>
                <Button fullWidth asChild>
                  {statusActionIsWhatsApp ? (
                    <WhatsAppLink
                      href={statusActionHref}
                      source="provider_registration_status"
                      ctaLabel={statusCopy.actionLabel}
                    >
                      {statusCopy.actionLabel}
                    </WhatsAppLink>
                  ) : statusActionUsesAnchor ? (
                    <a
                      href={statusActionHref}
                      target={statusActionOpensNewTab ? '_blank' : undefined}
                      rel={statusActionOpensNewTab ? 'noreferrer' : undefined}
                    >
                      {statusCopy.actionLabel}
                    </a>
                  ) : (
                    <Link href={statusActionHref}>{statusCopy.actionLabel}</Link>
                  )}
                </Button>
                <Button fullWidth variant="secondary" asChild>
                  <Link href="/provider-sign-in">Provider sign in</Link>
                </Button>
              </FooterActions>
            </ScreenPanel>
          )}
        </section>
      </div>
    </main>
  )
}

function ScreenPanel({ icon, title, description, children }: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg brand-gradient text-white">
          {icon}
        </div>
        <div>
          <h2 className="text-[22px] font-bold leading-tight text-[var(--ink)]">{title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-mute)]">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function FooterActions({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-background/95 px-4 py-3 shadow-[0_-10px_30px_rgba(0,0,0,0.18)] backdrop-blur">
      <div className="mx-auto grid max-w-[460px] gap-2">
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-semibold text-[var(--ink)]">{label}</span>
      {children}
    </label>
  )
}

function LocationSelect({ ariaLabel, value, onChange, disabled, placeholder, children }: {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder: string
  children: ReactNode
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="h-[52px] w-full rounded-[16px] bg-card px-[14px] text-[15px] font-medium text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)] outline-none transition-shadow focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  )
}

function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-[var(--ink)]">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'min-h-10 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors',
        selected
          ? 'border-[var(--tone-brand-border)] brand-gradient-soft text-[var(--brand-purple)]'
          : 'border-[var(--border)] bg-card text-[var(--ink)] hover:bg-[var(--card-alt)]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function InfoRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-card p-3">
      <p className="text-[13px] font-bold text-[var(--ink)]">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-mute)]">{body}</p>
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] p-3 text-[12px] leading-relaxed text-[var(--tone-warning-fg)]">
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function ReviewSection({ title, editStep, onEdit, children }: {
  title: string
  editStep: StepKey
  onEdit: (step: StepKey) => void
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-[var(--ink)]">{title}</h3>
        <button type="button" onClick={() => onEdit(editStep)} className="text-[12px] font-bold text-[var(--brand-purple)]">
          Edit
        </button>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[13px]">
      <span className="text-[var(--ink-mute)]">{label}</span>
      <span className="max-w-[230px] text-right font-semibold text-[var(--ink)]">{value}</span>
    </div>
  )
}
