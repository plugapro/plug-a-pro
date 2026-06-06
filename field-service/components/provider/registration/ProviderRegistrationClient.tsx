'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Clock,
  FileCheck2,
  MapPin,
  Phone,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { AuthShell } from '@/components/shared/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ServiceCategoryOption } from '@/lib/service-categories'

const STATE_KEY = 'pap_provider_registration_state_v1'
const TOKEN_KEY = 'pap_provider_registration_resume_token_v1'
const DRAFT_ID_KEY = 'pap_provider_registration_draft_id_v1'

const STEP_KEYS = ['welcome', 'phone', 'profile', 'services', 'area', 'availability', 'review', 'status'] as const
type StepKey = (typeof STEP_KEYS)[number]
type ApplicationState = 'pending' | 'more_info' | 'approved' | 'rejected' | 'cancelled'

type RegistrationFormState = {
  phone: string
  name: string
  email: string
  skills: string[]
  serviceAreas: string
  experience: string
  bio: string
  availabilityDays: string[]
  availabilityHours: string
  emergencyAvailable: boolean
  callOutFee: string
  evidenceNote: string
  consentAccepted: boolean
  submittedRef: string
}

type Props = {
  initialStep: StepKey
  initialApplicationState?: ApplicationState | null
  skillOptions: ServiceCategoryOption[]
}

const DEFAULT_STATE: RegistrationFormState = {
  phone: '',
  name: '',
  email: '',
  skills: [],
  serviceAreas: '',
  experience: '',
  bio: '',
  availabilityDays: [],
  availabilityHours: '',
  emergencyAvailable: false,
  callOutFee: '',
  evidenceNote: '',
  consentAccepted: false,
  submittedRef: '',
}

const STEP_META: Record<StepKey, { index: number; title: string; eyebrow: string; icon: React.ReactNode }> = {
  welcome: { index: 0, title: 'Apply as a provider', eyebrow: 'Provider registration', icon: <BriefcaseBusiness /> },
  phone: { index: 1, title: 'Your mobile number', eyebrow: 'Step 1 of 7', icon: <Phone /> },
  profile: { index: 2, title: 'Profile details', eyebrow: 'Step 2 of 7', icon: <FileCheck2 /> },
  services: { index: 3, title: 'Services you offer', eyebrow: 'Step 3 of 7', icon: <Wrench /> },
  area: { index: 4, title: 'Where you work', eyebrow: 'Step 4 of 7', icon: <MapPin /> },
  availability: { index: 5, title: 'Availability and rates', eyebrow: 'Step 5 of 7', icon: <Clock /> },
  review: { index: 6, title: 'Review and submit', eyebrow: 'Step 6 of 7', icon: <ShieldCheck /> },
  status: { index: 7, title: 'Application received', eyebrow: 'Step 7 of 7', icon: <Check /> },
}

const AVAILABILITY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const STATUS_COPY: Record<ApplicationState, {
  title: string
  body: (reference: string) => string
  tone: 'success' | 'warning' | 'danger'
  actionLabel: string
  actionHref: string
}> = {
  pending: {
    title: 'Your application is waiting for review.',
    body: (reference) => `Ref: ${reference || 'Pending'}. We will send updates on WhatsApp after review.`,
    tone: 'success',
    actionLabel: 'Go to provider sign in',
    actionHref: '/provider-sign-in',
  },
  more_info: {
    title: 'Your application needs more information.',
    body: () => 'Our team needs a few more details before marketplace access can be reviewed. Check WhatsApp for the requested update.',
    tone: 'warning',
    actionLabel: 'Go to provider sign in',
    actionHref: '/provider-sign-in',
  },
  approved: {
    title: 'Your provider access is approved.',
    body: () => 'Open the provider portal to review your profile, availability and credits before taking leads.',
    tone: 'success',
    actionLabel: 'Open provider portal',
    actionHref: '/provider',
  },
  rejected: {
    title: 'Your application was not approved yet.',
    body: () => 'This registration cannot be activated in its current form. Check WhatsApp for the review outcome and support options.',
    tone: 'danger',
    actionLabel: 'Go to provider sign in',
    actionHref: '/provider-sign-in',
  },
  cancelled: {
    title: 'Your application was cancelled.',
    body: () => 'This registration is no longer under review. Start a new application only if the support team asks you to reapply.',
    tone: 'warning',
    actionLabel: 'Go to provider sign in',
    actionHref: '/provider-sign-in',
  },
}

function parseStoredState(): RegistrationFormState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) return DEFAULT_STATE
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATE
  }
}

function routeForStep(step: StepKey): string {
  return step === 'welcome' ? '/provider/register' : `/provider/register/${step}`
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

function selectedServiceLabels(form: RegistrationFormState, options: ServiceCategoryOption[]): string {
  const labels = options.filter((option) => form.skills.includes(option.tag)).map((option) => option.label)
  return labels.length > 0 ? labels.join(', ') : 'None selected'
}

export function ProviderRegistrationClient({ initialStep, initialApplicationState, skillOptions }: Props) {
  const router = useRouter()
  const step = initialStep
  const statusCopy = STATUS_COPY[initialApplicationState ?? 'pending']
  const [form, setForm] = useState<RegistrationFormState>(DEFAULT_STATE)
  const [draftId, setDraftId] = useState('')
  const [resumeToken, setResumeToken] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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

  const progress = useMemo(() => {
    const index = STEP_META[step].index
    return Math.min(100, Math.max(8, (index / 7) * 100))
  }, [step])

  function update<K extends keyof RegistrationFormState>(key: K, value: RegistrationFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  function toggleSkill(tag: string) {
    setForm((current) => ({
      ...current,
      skills: current.skills.includes(tag)
        ? current.skills.filter((skill) => skill !== tag)
        : [...current.skills, tag],
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

  function validateCurrentStep(currentStep: StepKey): boolean {
    if (currentStep === 'phone' && form.phone.replace(/\D/g, '').length < 9) {
      setError('Enter a valid South African mobile number.')
      return false
    }
    if (currentStep === 'profile' && !form.name.trim()) {
      setError('Enter your full name.')
      return false
    }
    if (currentStep === 'services' && form.skills.length === 0) {
      setError('Choose at least one service.')
      return false
    }
    if (currentStep === 'area' && !form.serviceAreas.trim()) {
      setError('Enter at least one suburb or area.')
      return false
    }
    if (currentStep === 'availability' && (form.availabilityDays.length === 0 || !form.callOutFee.trim())) {
      setError('Choose availability days and enter your call-out fee.')
      return false
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
        body: JSON.stringify({ ...form, draftId, resumeToken, lastCompletedStep }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? 'Could not save your progress.')
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
    const completedStep = STEP_META[step].index
    if (completedStep > 0) {
      const saved = await saveDraft(completedStep)
      if (!saved) return
    }
    router.push(routeForStep(nextStep))
  }

  function startRegistration() {
    logProviderRegistrationEvent('provider_registration_start', { source: 'welcome_cta' })
    router.push('/provider/register/phone')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!validateCurrentStep('review')) return
    setSubmitting(true)
    setError('')
    try {
      const saved = await saveDraft(7)
      if (!saved) return
      const response = await fetch('/api/provider/registration/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          draftId: saved.draftId,
          resumeToken: saved.resumeToken,
          consentAccepted: form.consentAccepted,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? 'Could not submit your application.')
        return
      }
      update('submittedRef', payload.ref)
      window.localStorage.removeItem(TOKEN_KEY)
      router.push('/provider/register/status')
    } finally {
      setSubmitting(false)
    }
  }

  const meta = STEP_META[step]

  return (
    <AuthShell
      backHref={step === 'welcome' ? '/provider-sign-in' : routeForStep(STEP_KEYS[Math.max(0, meta.index - 1)] ?? 'welcome')}
      eyebrow={meta.eyebrow}
      title={meta.title}
      subtitle={step === 'welcome'
        ? 'Apply in the app, then our team reviews your profile before job leads are unlocked.'
        : 'Your application is saved as you move through the steps.'}
      dense
    >
      <div className="mx-auto max-w-[430px] space-y-5">
        <div className="h-2 rounded-full bg-[var(--card-alt)] shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="h-full rounded-full brand-gradient" style={{ width: `${progress}%` }} />
        </div>

        <div className="rounded-[20px] border border-[var(--border)] bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--card-alt)] text-[var(--brand-purple)]">
              {meta.icon}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--ink)]">{meta.title}</p>
              <p className="text-[12px] text-[var(--ink-mute)]">{saving ? 'Saving progress...' : 'Provider application'}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-[14px] border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-[13px] font-medium text-[var(--tone-danger-fg)]">
              {error}
            </div>
          )}

          {step === 'welcome' && (
            <div className="space-y-4">
              <div className="grid gap-2 text-[13px] text-[var(--ink-mute)]">
                <p>We review service areas, skills and rates before activating a provider profile.</p>
                <p>Identity verification can be completed later, but it is required before paid credit purchases.</p>
              </div>
              <Button fullWidth onClick={startRegistration}>
                Start application
                <ArrowRight size={18} />
              </Button>
              <Button fullWidth variant="secondary" asChild>
                <Link href="/provider-sign-in">I already have an account</Link>
              </Button>
            </div>
          )}

          {step === 'phone' && (
            <div className="space-y-4">
              <Field label="Mobile number">
                <Input
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                  placeholder="082 123 4567"
                />
              </Field>
              <Button fullWidth onClick={() => goTo('profile')} loading={saving}>
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <Field label="Full name">
                <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Thabo Nkosi" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" />
              </Field>
              <Field label="Experience">
                <select
                  value={form.experience}
                  onChange={(event) => update('experience', event.target.value)}
                  className="h-[52px] w-full rounded-[16px] bg-card px-[14px] text-[15px] font-medium text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
                >
                  <option value="">Select experience</option>
                  <option value="0-1 years">0-1 years</option>
                  <option value="1-3 years">1-3 years</option>
                  <option value="3-5 years">3-5 years</option>
                  <option value="5+ years">5+ years</option>
                </select>
              </Field>
              <Field label="Short work summary">
                <Textarea value={form.bio} onChange={(event) => update('bio', event.target.value)} placeholder="What kind of jobs do you usually handle?" />
              </Field>
              <Button fullWidth onClick={() => goTo('services')} loading={saving}>
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 'services' && (
            <div className="space-y-4">
              <div className="grid gap-2">
                {skillOptions.map((option) => {
                  const checked = form.skills.includes(option.tag)
                  return (
                    <button
                      key={option.tag}
                      type="button"
                      onClick={() => toggleSkill(option.tag)}
                      className={[
                        'flex min-h-[64px] items-start gap-3 rounded-[16px] border p-3 text-left transition-colors',
                        checked ? 'border-[var(--brand-purple)] bg-[rgba(139,63,232,0.08)]' : 'border-[var(--border)] bg-card',
                      ].join(' ')}
                    >
                      <span className={[
                        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[7px] border',
                        checked ? 'border-[var(--brand-purple)] bg-[var(--brand-purple)] text-white' : 'border-[var(--border)]',
                      ].join(' ')}>
                        {checked && <Check size={14} />}
                      </span>
                      <span>
                        <span className="block text-[14px] font-semibold text-[var(--ink)]">{option.label}</span>
                        <span className="block text-[12px] leading-relaxed text-[var(--ink-mute)]">{option.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <Button fullWidth onClick={() => goTo('area')} loading={saving}>
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 'area' && (
            <div className="space-y-4">
              <Field label="Suburbs or areas">
                <Textarea
                  value={form.serviceAreas}
                  onChange={(event) => update('serviceAreas', event.target.value)}
                  placeholder="Maboneng, Sandton, Randburg"
                />
              </Field>
              <Field label="Work note">
                <Textarea
                  value={form.evidenceNote}
                  onChange={(event) => update('evidenceNote', event.target.value)}
                  placeholder="Past jobs, references or tools you bring."
                />
              </Field>
              <Button fullWidth onClick={() => goTo('availability')} loading={saving}>
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 'availability' && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-[var(--ink)]">Days available</p>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABILITY_DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={[
                        'h-11 rounded-[14px] border text-[13px] font-semibold',
                        form.availabilityDays.includes(day)
                          ? 'border-[var(--brand-purple)] bg-[rgba(139,63,232,0.08)] text-[var(--brand-purple)]'
                          : 'border-[var(--border)] bg-card text-[var(--ink)]',
                      ].join(' ')}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Typical hours">
                <Input value={form.availabilityHours} onChange={(event) => update('availabilityHours', event.target.value)} placeholder="08:00-17:00" />
              </Field>
              <Field label="Call-out fee">
                <Input inputMode="decimal" value={form.callOutFee} onChange={(event) => update('callOutFee', event.target.value)} placeholder="150" />
              </Field>
              <label className="flex items-start gap-3 rounded-[16px] border border-[var(--border)] bg-card p-3">
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
              <Button fullWidth onClick={() => goTo('review')} loading={saving}>
                Review application
                <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 'review' && (
            <form onSubmit={submit} className="space-y-4">
              <SummaryRow label="Name" value={form.name || 'Missing'} />
              <SummaryRow label="Mobile" value={form.phone || 'Missing'} />
              <SummaryRow label="Services" value={selectedServiceLabels(form, skillOptions)} />
              <SummaryRow label="Areas" value={form.serviceAreas || 'Missing'} />
              <SummaryRow label="Availability" value={form.availabilityDays.join(', ') || 'Missing'} />
              <SummaryRow label="Call-out" value={form.callOutFee ? `R${form.callOutFee}` : 'Missing'} />
              <label className="flex items-start gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--card-alt)] p-3">
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
              <Button type="submit" fullWidth loading={submitting || saving} loadingLabel="Submitting...">
                Submit application
                <ArrowRight size={18} />
              </Button>
            </form>
          )}

          {step === 'status' && (
            <div className="space-y-4">
              <div
                className={[
                  'rounded-[18px] border p-4',
                  statusCopy.tone === 'danger'
                    ? 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)]'
                    : statusCopy.tone === 'warning'
                      ? 'border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]'
                      : 'border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]',
                ].join(' ')}
              >
                <p
                  className={[
                    'text-[14px] font-bold',
                    statusCopy.tone === 'danger'
                      ? 'text-[var(--tone-danger-fg)]'
                      : statusCopy.tone === 'warning'
                        ? 'text-[var(--tone-warning-fg)]'
                        : 'text-[var(--tone-success-fg)]',
                  ].join(' ')}
                >
                  {statusCopy.title}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-mute)]">
                  {statusCopy.body(form.submittedRef)}
                </p>
              </div>
              <Button fullWidth asChild>
                <Link href={statusCopy.actionHref}>{statusCopy.actionLabel}</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </AuthShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-semibold text-[var(--ink)]">{label}</span>
      {children}
    </label>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
      <span className="text-[var(--ink-mute)]">{label}</span>
      <span className="max-w-[210px] text-right font-semibold text-[var(--ink)]">{value}</span>
    </div>
  )
}
