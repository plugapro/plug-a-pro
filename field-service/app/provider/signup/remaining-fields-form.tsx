'use client'

import { useTransition } from 'react'
import { useForm, FormProvider, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { selectMissingSections, buildDynamicSchema } from '@/lib/web-signup-sections'
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

const COMPONENTS = {
  name: NameSection,
  identity: IdentitySection,
  skills: SkillsSection,
  service_areas: ServiceAreasSection,
  availability: AvailabilitySection,
  rates: RatesSection,
  profile_photo: ProfilePhotoSection,
  bio: BioSection,
  references: ReferencesSection,
  evidence: EvidenceSection,
} as const

export interface RemainingFieldsFormProps {
  rawToken: string
  conversationId: string
  phone: string
  capturedData: Record<string, unknown>
}

export function RemainingFieldsForm(props: RemainingFieldsFormProps) {
  const sections = selectMissingSections(props.capturedData)
  const schema = buildDynamicSchema(sections)
  const methods = useForm<Record<string, unknown>>({ resolver: zodResolver(schema), mode: 'onBlur' })
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onSubmit: SubmitHandler<Record<string, unknown>> = (values) =>
    startTransition(async () => {
      try {
        await submitProviderApplicationFromWebAction({ rawToken: props.rawToken, payload: values })
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
          const Component = COMPONENTS[s.key]
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
