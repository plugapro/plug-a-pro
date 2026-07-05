'use client'

import { useTransition } from 'react'
import { useForm, FormProvider, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { selectMissingSections, buildDynamicSchema } from '@/lib/web-signup-sections'
import { MIN_EVIDENCE_PHOTOS } from '@/lib/provider-onboarding/quality-gate'
import { submitProviderApplicationFromWebAction } from './actions'
import { NameSection } from './sections/name'
import { IdentitySection } from './sections/identity'
import { SkillsSection } from './sections/skills'
import { ServiceAreasSection } from './sections/service-areas'
import { AvailabilitySection } from './sections/availability'
import { RatesSection } from './sections/rates'
import { ProfilePhotoSection } from './sections/profile-photo'
import { BioSection } from './sections/bio'
import { ReferencesSection } from './sections/references'
import { EvidenceSection } from './sections/evidence'
import { CertificationSection } from './sections/certification'
import type { SectionKey } from '@/lib/web-signup-sections'

type SimpleComponent = () => React.JSX.Element

const SIMPLE_COMPONENTS: Partial<Record<SectionKey, SimpleComponent>> = {
  name: NameSection,
  identity: IdentitySection,
  skills: SkillsSection,
  service_areas: ServiceAreasSection,
  availability: AvailabilitySection,
  rates: RatesSection,
  profile_photo: ProfilePhotoSection,
  bio: BioSection,
  references: ReferencesSection,
}

export interface RemainingFieldsFormProps {
  rawToken: string
  conversationId: string
  phone: string
  capturedData: Record<string, unknown>
  gateEnabled?: boolean
}

export function RemainingFieldsForm(props: RemainingFieldsFormProps) {
  const { gateEnabled = false } = props
  const opts = { gateEnabled }
  const sections = selectMissingSections(props.capturedData, opts)
  const schema = buildDynamicSchema(sections, opts)
  // Fix 5: when skills are also collected in-form, the certification section is
  // included unconditionally by selectMissingSections and rendered client-side
  // only when the live skill selection is high-risk.
  const skillsSectionInForm = sections.some((s) => s.key === 'skills')
  const methods = useForm<Record<string, unknown>>({ resolver: zodResolver(schema), mode: 'onBlur' })
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onSubmit: SubmitHandler<Record<string, unknown>> = (values) =>
    startTransition(async () => {
      try {
        const result = await submitProviderApplicationFromWebAction({ rawToken: props.rawToken, payload: values })
        if ('awaitingVerification' in result && result.awaitingVerification) {
          if (result.verificationUrl) {
            window.location.href = result.verificationUrl
          } else {
            toast.info('Verification in progress. We\'ll confirm here once verification passes.')
          }
          return
        }
        router.push('/provider/signup/confirmation')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not submit. Try again.')
      }
    })

  if (sections.length === 0) {
    return (
      <form onSubmit={methods.handleSubmit(onSubmit)} className="rounded border p-4 text-sm">
        <p>Everything is captured. Tap below to submit.</p>
        <Button type="submit" disabled={pending} className="mt-3 w-full">
          Submit application
        </Button>
      </form>
    )
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-6">
        {sections.map((s) => {
          if (s.key === 'evidence') {
            return (
              <EvidenceSection
                key={s.key}
                rawToken={props.rawToken}
                gateEnabled={gateEnabled}
                minPhotos={MIN_EVIDENCE_PHOTOS}
              />
            )
          }
          if (s.key === 'certification') {
            return <CertificationSection key={s.key} conditionalOnSkills={skillsSectionInForm} />
          }
          const Component = SIMPLE_COMPONENTS[s.key]
          if (!Component) return null
          return <Component key={s.key} />
        })}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Submitting…' : 'Submit application'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Your progress is saved if you leave this page.
        </p>
      </form>
    </FormProvider>
  )
}
