// ─── Service provider registration flow via WhatsApp ──────────────────────────
// Journey: trigger → name → skills (multi-select) → area → experience → availability → submit → pending review
// No direct connection given to customer — all mediated through Plug A Pro

import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import { downloadAndStoreWhatsAppMedia } from '../whatsapp-media'
import { db } from '../db'
import { syncProviderRecord } from '../provider-record'
import { checkJobsForNewProviderAvailability } from '../matching/customer-recontact'
import { normalizePhone } from '../utils'
import { findLatestActiveProviderApplicationByPhone } from '../provider-applications'
import {
  SERVICE_CATEGORY_OPTIONS,
  resolveServiceCategoryTag,
} from '../service-categories'
import {
  ACTIVE_PILOT_CITY_LABEL,
  ACTIVE_PILOT_REGION_LABEL,
  describeCityServiceStatus,
  describeRegionServiceStatus,
  getRegionServiceStatus,
  type ServiceAreaStatus,
} from '../service-area-guard'
import type { FlowContext, FlowResult } from './types'

// ─── Trigger keywords that start the registration flow ────────────────────────
export const REGISTRATION_TRIGGERS = [
  'register', 'join', 'technician', 'provider', 'apply', 'signup', 'sign up',
  'i want to work', 'want to work', 'looking for work', 'find work',
  'i want work', 'need work', 'find a job', 'get work',
  'ek wil werk',        // Afrikaans: "I want to work"
  'ngifuna ukusebenza', // Zulu: "I want to work"
]

// ─── Provider skill options (all categories except 'other', which is client-side) ─
// 'other' lets clients describe unusual jobs, but providers select real skill tags.
const PROVIDER_SKILL_OPTIONS = SERVICE_CATEGORY_OPTIONS.filter(o => o.tag !== 'other')
const MAX_EVIDENCE_FILES = 5

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function sendEvidenceFileProgress(phone: string, count: number) {
  const remaining = MAX_EVIDENCE_FILES - count

  if (remaining <= 0) {
    await sendButtons(
      phone,
      `✅ *${MAX_EVIDENCE_FILES} files received.* Maximum reached.\n\nContinue to the next step?`,
      [{ id: 'evidence_done', title: '✅ Continue' }]
    )
    return
  }

  await sendButtons(
    phone,
    `✅ *${count} file${count === 1 ? '' : 's'} received.* You can add up to ${remaining} more, or continue.`,
    [
      { id: 'evidence_done', title: '✅ Continue' },
      { id: 'evidence_add_more', title: '📎 Add another' },
    ]
  )
}

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleRegistrationFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'reg_start':
      return startRegistration(ctx)
    case 'reg_collect_name':
      return handleCollectName(ctx)
    case 'reg_collect_skills':
      return handleCollectSkills(ctx)
    case 'reg_collect_skills_more':
      return handleCollectSkillsMore(ctx)
    case 'reg_collect_area':
      return handleCollectArea(ctx)
    case 'reg_collect_experience':
      return handleCollectExperience(ctx)
    case 'reg_collect_city':
      return handleCollectCity(ctx)
    case 'reg_collect_region':
      return handleCollectRegion(ctx)
    case 'reg_collect_region_more':
      return handleCollectRegionMore(ctx)
    case 'reg_collect_suburb_select':
      return handleCollectSuburbSelect(ctx)
    case 'reg_collect_suburb_text':
      return handleCollectSuburbText(ctx)
    case 'reg_collect_availability':
      return handleCollectAvailability(ctx)
    case 'reg_collect_evidence':
      return handleCollectEvidence(ctx)
    case 'reg_confirm':
      return handleConfirm(ctx)
    case 'reg_pending':
      return handlePending(ctx)
    case 'reg_edit_field':
      return handleEditField(ctx)
    default:
      return startRegistration(ctx)
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function startRegistration(ctx: FlowContext): Promise<FlowResult> {
  // A known provider should never be sent through duplicate registration.
  const { normalizePhone } = await import('../utils')
  const normalizedPhone = normalizePhone(ctx.phone)
  const digits = normalizedPhone.replace(/\D/g, '')
  const phoneVariants = Array.from(new Set([
    normalizedPhone,
    digits ? `+${digits}` : null,
    digits || null,
    digits.startsWith('27') ? `0${digits.slice(2)}` : null,
  ].filter(Boolean) as string[]))

  const existingProvider = await (db as any).provider?.findFirst?.({
    where: { phone: { in: phoneVariants } },
    select: { id: true, name: true, status: true, active: true, availableNow: true },
  }) ?? null

  if (existingProvider) {
    const inactive =
      !existingProvider.active ||
      ['SUSPENDED', 'ARCHIVED', 'BANNED'].includes(existingProvider.status)
    await sendButtons(
      ctx.phone,
      inactive
        ? `👷 Hi ${existingProvider.name}, your provider profile is currently inactive.\n\nYou won't receive new job leads until this is resolved.`
        : `✅ Hi ${existingProvider.name}, you're already registered as a Plug A Pro provider.\n\nWhat would you like to manage?`,
      inactive
        ? [
            { id: 'provider_status', title: 'Provider Status' },
            { id: 'provider_support', title: 'Support' },
          ]
        : [
            { id: 'provider_my_jobs', title: 'My Jobs' },
            { id: 'provider_availability', title: 'Availability' },
            { id: 'back_home', title: 'Main Menu' },
          ],
    )
    return { nextStep: inactive ? 'pj_provider_status' : 'pj_toggle_available' }
  }

  const existingCustomer = await db.customer.findFirst({
    where: { phone: normalizedPhone },
    select: { id: true },
  })
  if (existingCustomer) {
    await sendText(
      ctx.phone,
      `⚠️ *Provider registration unavailable*\n\nThis number is already registered as a customer on Plug A Pro.\n\nTo join as a service provider, please use a *different phone number* and restart with *join*.`
    )
    return { nextStep: 'done' }
  }

  // Existing active applications own the provider identity for this phone number.
  const existing = await findLatestActiveProviderApplicationByPhone(db, ctx.phone)

  if (existing?.status === 'APPROVED') {
    await sendButtons(
      ctx.phone,
      "✅ You're already registered as a Plug A Pro worker! You'll receive job leads through this number.\n\nWhat would you like to do?",
      [
        { id: 'pj_view_jobs', title: '📋 My Jobs' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  if (existing?.status === 'PENDING') {
    await sendText(
      ctx.phone,
      `⏳ Your provider profile is already on file.\n\nRef: *${existing.id.slice(-8).toUpperCase()}*\n\nReply *jobs* to check leads or *menu* to return to the main menu.`
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `👷 *Join Plug A Pro as a Service Provider*\n\nEarn money doing odd jobs, repairs, and once-off work in your area.\n\n*Here's how it works:*\n• Share your name, skills, and work area\n• We send suitable job leads\n• You send a simple quote or arrangement\n• You and the client arrange the work directly\n\nReady to join?`,
    [
      { id: 'reg_start', title: '✅ Yes, Apply Now' },
      { id: 'reg_cancel', title: '❌ Not Now' },
    ]
  )
  return { nextStep: 'reg_collect_name' }
}

async function handleCollectName(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'reg_cancel') {
    await sendText(ctx.phone, "No problem! Reply *join* anytime when you're ready to apply. 👋")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'reg_start' || ctx.step === 'reg_collect_name') {
    await sendText(ctx.phone, '👤 What is your *full name*?\n\n_(Type and send your name)_')
    return { nextStep: 'reg_collect_skills' }
  }

  return { nextStep: 'reg_collect_name' }
}

async function handleCollectSkills(ctx: FlowContext): Promise<FlowResult> {
  const name = ctx.reply.text
  if (!name || name.length < 2) {
    await sendText(ctx.phone, 'Please type your full name (at least 2 characters).')
    return { nextStep: 'reg_collect_skills' }
  }

  await sendText(
    ctx.phone,
    buildSkillPromptText(`Nice to meet you, *${name}*! 👋\n\n🔧 *What type of work do you do?*`)
  )
  return { nextStep: 'reg_collect_skills_more', nextData: { name, skills: [] } }
}

async function handleCollectSkillsMore(ctx: FlowContext): Promise<FlowResult> {
  const existingSkills: string[] = ctx.data.skills ?? []

  // ── Button replies (from confirmation screen) ──────────────────────────────

  if (ctx.reply.id === 'skills_confirm') {
    if (existingSkills.length === 0) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please choose at least one skill first.*'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
    }
    return promptArea(ctx)
  }

  if (ctx.reply.id === 'skills_change' || ctx.reply.id === 'edit_skills') {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  // ── Text reply ─────────────────────────────────────────────────────────────

  const raw = ctx.reply.text?.trim() ?? ''

  if (/^done$/i.test(raw)) {
    if (existingSkills.length === 0) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please choose at least one skill first.*'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
    }
    return promptArea(ctx)
  }

  if (/^change(\s+skills?)?$/i.test(raw)) {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  // ── Parse number input ─────────────────────────────────────────────────────

  const indices = parseNumberedInput(raw)

  // No numbers found — try label matching as fallback.
  // 1. Try the full raw phrase first (handles "pest control", "air conditioning", etc.)
  // 2. If no full-phrase match, split into tokens (handles "plumbing electrical")
  let labelMatched: string[] = []
  if (indices.length === 0 && raw.length > 0) {
    const fullTag = resolveServiceCategoryTag(raw)
    if (fullTag && fullTag !== 'other') {
      const opt = PROVIDER_SKILL_OPTIONS.find(o => o.tag === fullTag)
      if (opt && !existingSkills.includes(opt.label)) labelMatched.push(opt.label)
    } else {
      const parts = raw.split(/[,;&\s]+/).filter(s => s.length > 1)
      for (const part of parts) {
        const tag = resolveServiceCategoryTag(part)
        if (!tag || tag === 'other') continue
        const opt = PROVIDER_SKILL_OPTIONS.find(o => o.tag === tag)
        if (opt && !existingSkills.includes(opt.label)) labelMatched.push(opt.label)
      }
    }
  }

  if (indices.length === 0 && labelMatched.length === 0) {
    if (!raw) {
      await sendText(ctx.phone, buildSkillPromptText('🔧 *What type of work do you do?*', existingSkills))
    } else {
      // Unrecognised text — ask for numbers
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Please reply with the numbers from the list below.*', existingSkills))
    }
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: existingSkills } }
  }

  // Validate indices (1-based) against PROVIDER_SKILL_OPTIONS
  const validSkills: string[] = []
  const invalidNums: number[] = []
  for (const n of indices) {
    const option = PROVIDER_SKILL_OPTIONS[n - 1]
    if (option) {
      validSkills.push(option.label)
    } else {
      invalidNums.push(n)
    }
  }

  // All numbers were invalid (no label matches either)
  if (validSkills.length === 0 && labelMatched.length === 0) {
    await sendText(
      ctx.phone,
      buildSkillPromptText(`❌ None of those numbers are on the list (${invalidNums.join(', ')}).\n\n🔧 *Choose your skills:*`, existingSkills)
    )
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: existingSkills } }
  }

  // Merge new selections into existing (deduplicated)
  const merged = [...new Set([...existingSkills, ...validSkills, ...labelMatched])]

  let confirmBody = `✅ *Skills selected:* ${merged.join(', ')}`
  if (invalidNums.length > 0) {
    confirmBody += `\n\n_(We ignored numbers not on the list: ${invalidNums.join(', ')})_`
  }
  confirmBody += '\n\nShall I continue?'

  await sendButtons(ctx.phone, confirmBody, [
    { id: 'skills_confirm', title: '✅ Continue' },
    { id: 'skills_change', title: '✏️ Change skills' },
  ])

  return { nextStep: 'reg_collect_skills_more', nextData: { skills: merged } }
}

async function promptArea(ctx: FlowContext): Promise<FlowResult> {
  const rows = [
    { id: 'area_gauteng', title: 'Gauteng', description: `🟢 Active pilot — ${ACTIVE_PILOT_REGION_LABEL}` },
    { id: 'area_western_cape', title: 'Western Cape', description: '🔜 Coming soon — register now' },
    { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: '🔜 Coming soon — register now' },
    { id: 'area_eastern_cape', title: 'Eastern Cape', description: '🔜 Coming soon — register now' },
    { id: 'area_other', title: 'Other province', description: '🔜 Coming soon — register now' },
  ]

  await sendList(
    ctx.phone,
    '📍 Which area do you mainly work in?',
    [{ title: 'Areas', rows }],
    { buttonLabel: 'Choose Area' }
  )
  return { nextStep: 'reg_collect_experience' }
}

async function handleCollectArea(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'edit_skills' || ctx.reply.id === 'skills_change') {
    await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  return promptArea(ctx)
}

// ─── Province key map ─────────────────────────────────────────────────────────

const PROVINCE_KEY_MAP: Record<string, string> = {
  'area_gauteng':       'gauteng',
  'area_western_cape':  'western_cape',
  'area_kwazulu_natal': 'kwazulu_natal',
  'area_eastern_cape':  'eastern_cape',
  'area_other':         'gauteng', // fallback to largest province
}

// ─── Experience and availability ──────────────────────────────────────────────

async function handleCollectExperience(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('area_')) {
    await sendList(
      ctx.phone,
      '📍 Please choose your area from the list.',
      [{
        title: 'Areas',
        rows: [
          { id: 'area_gauteng', title: 'Gauteng', description: `🟢 Active pilot — ${ACTIVE_PILOT_REGION_LABEL}` },
          { id: 'area_western_cape', title: 'Western Cape', description: '🔜 Coming soon — register now' },
          { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: '🔜 Coming soon — register now' },
          { id: 'area_eastern_cape', title: 'Eastern Cape', description: '🔜 Coming soon — register now' },
          { id: 'area_other', title: 'Other province', description: '🔜 Coming soon — register now' },
        ],
      }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_experience' }
  }

  const areaLabel = ctx.reply.title ?? ''
  const provinceKey = PROVINCE_KEY_MAP[ctx.reply.id ?? ''] ?? 'gauteng'

  // Soft pilot notice for providers outside Gauteng — still allow full registration
  if (ctx.reply.id !== 'area_gauteng') {
    await sendText(
      ctx.phone,
      `🌍 *Heads up — Pilot Phase*\n\nPlug A Pro is currently operating in Gauteng only. We are expanding soon!\n\nYou can still complete your profile now — we will WhatsApp you the moment we go live in your area. No need to re-register later.`
    )
  }

  try {
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(provinceKey)

    if (cities.length === 0) {
      // No cities seeded yet — ask provider to type their suburb for finer granularity
      await sendText(
        ctx.phone,
        `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
      )
      return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey, selectedRegionStatus: 'coming_soon' } }
    }

    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: c.label,
      description: describeCityServiceStatus({ cityKey: c.cityKey }),
    }))

    await sendList(
      ctx.phone,
      '🏙 Which city do you mainly work in?',
      [{ title: 'Cities', rows }],
      { buttonLabel: 'Choose City' }
    )
    return {
      nextStep: 'reg_collect_city',
      nextData: {
        serviceAreas: [areaLabel],
        province: areaLabel,
        provinceKey,
        selectedRegionStatus: ctx.reply.id === 'area_gauteng' ? undefined : 'coming_soon',
      },
    }
  } catch {
    // DB unavailable — ask provider to type their suburb
    await sendText(
      ctx.phone,
      `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
    )
    return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey, selectedRegionStatus: 'coming_soon' } }
  }
}

// ─── Experience prompt helper ─────────────────────────────────────────────────

async function sendExperiencePrompt(phone: string): Promise<void> {
  await sendList(
    phone,
    '💼 How many years of experience do you have in your trade?',
    [{
      title: 'Experience',
      rows: [
        { id: 'exp_lt1', title: 'Less than 1 year', description: 'Just starting out' },
        { id: 'exp_1_3', title: '1–3 years', description: 'Some experience' },
        { id: 'exp_3_5', title: '3–5 years', description: 'Experienced' },
        { id: 'exp_5plus', title: '5+ years', description: 'Highly experienced' },
      ],
    }],
    { buttonLabel: 'Choose Experience' }
  )
}

// ─── City and region selection (structured location) ─────────────────────────

async function handleCollectCity(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('city_')) {
    // Re-show city list using stored provinceKey
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(ctx.data.provinceKey ?? 'gauteng')
    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: c.label,
      description: describeCityServiceStatus({ cityKey: c.cityKey }),
    }))
    await sendList(ctx.phone, '🏙 Please choose your city:', [{ title: 'Cities', rows }], { buttonLabel: 'Choose City' })
    return { nextStep: 'reg_collect_city' }
  }

  const cityId = ctx.reply.id.replace('city_', '')
  const cityLabel = ctx.reply.title ?? ''
  const cityIsActive = ctx.reply.title === ACTIVE_PILOT_CITY_LABEL

  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(cityId)

    if (regions.length === 0) {
      // No regions for this city — ask provider to type their suburb
      await sendText(
        ctx.phone,
        `📍 Which suburb or area of *${cityLabel}* do you mainly work in?\n\nType the suburb name (e.g. *Allen's Nek*, *Fourways*, *Rondebosch*):`,
      )
      return {
        nextStep: 'reg_collect_suburb_text',
        nextData: { city: cityLabel, cityId, selectedRegionStatus: 'coming_soon' },
      }
    }

    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
      description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }),
    }))

    await sendList(
      ctx.phone,
      cityIsActive
        ? `🗺 Which area of *${cityLabel}* do you mainly work in?\n\nOnly *${ACTIVE_PILOT_REGION_LABEL}* is live for leads right now. Other areas are still welcome to register.`
        : `🗺 Which area of *${cityLabel}* do you mainly work in?\n\nThis city is coming soon. You can still register now and we will notify you when leads open there.`,
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return {
      nextStep: 'reg_collect_region',
      nextData: { city: cityLabel, cityId },
    }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability', nextData: { city: cityLabel } }
  }
}

async function showRegionList(ctx: FlowContext): Promise<FlowResult> {
  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(ctx.data.cityId ?? '')
    if (regions.length === 0) {
      await sendExperiencePrompt(ctx.phone)
      return { nextStep: 'reg_collect_availability' }
    }
    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
      description: describeRegionServiceStatus({ regionKey: r.regionKey, slug: r.slug }),
    }))
    await sendList(
      ctx.phone,
      '🗺 Please choose an area:',
      [{ title: 'Areas', rows }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_region' }
  } catch {
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability' }
  }
}

async function handleCollectRegion(ctx: FlowContext): Promise<FlowResult> {
  // Fallback "Done" — used if the user somehow re-enters this step
  if (ctx.reply.id === 'region_done') {
    const nodeIds = ctx.data.locationNodeIds ?? []
    if (nodeIds.length === 0) {
      return showRegionList(ctx)
    }
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability' }
  }

  if (ctx.reply.id === 'region_more') {
    return showRegionList(ctx)
  }

  if (!ctx.reply.id?.startsWith('region_')) {
    return showRegionList(ctx)
  }

  const regionId = ctx.reply.id.replace('region_', '')
  const regionLabel = ctx.reply.title ?? ''
  let regionStatus: ServiceAreaStatus = 'coming_soon'

  try {
    const { getRegions } = await import('@/lib/location-nodes')
    const regions = await getRegions(ctx.data.cityId ?? '')
    const selectedRegion = regions.find((region) => region.id === regionId)
    regionStatus = getRegionServiceStatus({
      regionKey: selectedRegion?.regionKey,
      slug: selectedRegion?.slug,
    })
  } catch {
    regionStatus = 'coming_soon'
  }

  if (regionStatus !== 'active') {
    await sendText(
      ctx.phone,
      `🔜 *Coming soon area*\n\nThanks. *${regionLabel}* is not live for leads yet, but your profile will still be saved. We'll notify you when Plug A Pro opens leads in this region.`
    )
  }

  // Drill down to suburb selection within this region (numbered text list)
  return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, regionStatus)
}

async function handleCollectRegionMore(ctx: FlowContext): Promise<FlowResult> {
  return showRegionList(ctx) // re-show the region list
}

// ─── Suburb multi-select within a region (numbered text list) ─────────────────
// Providers reply once with multiple numbers (e.g. "1,3,5") to select suburbs.
// Uses global 1-based numbering across all pages so "8" always means the 8th suburb.

const SUBURB_TEXT_PAGE_SIZE = 15

async function showSuburbNumberedPrompt(
  phone: string,
  regionId: string,
  regionLabel: string,
  selectedLabels: string[],
  selectedIds: string[],
  pageOffset: number,
  regionStatus: ServiceAreaStatus = 'coming_soon',
): Promise<FlowResult> {
  try {
    const { getSuburbs } = await import('@/lib/location-nodes')
    const suburbs = await getSuburbs(regionId)

    if (suburbs.length === 0) {
      // No suburbs seeded — skip drill-down, proceed to experience
      await sendExperiencePrompt(phone)
      return {
        nextStep: 'reg_collect_availability',
        nextData: {
          locationNodeIds: [regionId],
          selectedRegionLabels: [regionLabel],
          selectedRegionStatus: regionStatus,
        },
      }
    }

    await sendText(
      phone,
      buildSuburbPromptText(regionLabel, suburbs, pageOffset, selectedLabels),
    )

    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId,
        regionLabel,
        suburbPage: pageOffset,
        suburbOptions: suburbs.map(s => ({ id: s.id, label: s.label })),
        locationNodeIds: selectedIds,
        selectedSuburbLabels: selectedLabels,
        selectedRegionStatus: regionStatus,
      },
    }
  } catch {
    await sendExperiencePrompt(phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: { locationNodeIds: [regionId], selectedRegionLabels: [regionLabel], selectedRegionStatus: regionStatus },
    }
  }
}

async function handleCollectSuburbSelect(ctx: FlowContext): Promise<FlowResult> {
  const regionId = ctx.data.regionId as string ?? ''
  const regionLabel = ctx.data.regionLabel as string ?? ''
  const suburbOptions = (ctx.data.suburbOptions ?? []) as Array<{ id: string; label: string }>
  const suburbPage = (ctx.data.suburbPage as number) ?? 0
  const existingIds: string[] = (ctx.data.locationNodeIds as string[]) ?? []
  const existingLabels: string[] = (ctx.data.selectedSuburbLabels as string[]) ?? []
  const selectedRegionStatus = (ctx.data.selectedRegionStatus as ServiceAreaStatus | undefined) ?? 'coming_soon'

  // ── Button replies (from confirmation screen) ──────────────────────────────

  if (ctx.reply.id === 'suburb_confirm') {
    if (existingIds.length === 0) {
      await showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
      return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
    }
    await sendExperiencePrompt(ctx.phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: {
        locationNodeIds: existingIds,
        selectedRegionLabels: [regionLabel],
        selectedSuburbLabels: existingLabels,
        selectedRegionStatus,
      },
    }
  }

  // "add more" — show numbered list keeping current selections
  if (ctx.reply.id === 'suburb_add_more') {
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, 0, selectedRegionStatus)
  }

  // "change" — clear all and restart
  if (ctx.reply.id === 'suburb_change') {
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
  }

  // ── Text reply ─────────────────────────────────────────────────────────────

  const raw = ctx.reply.text?.trim() ?? ''
  const rawLower = raw.toLowerCase()

  if (rawLower === 'done') {
    if (existingIds.length === 0) {
      await sendText(ctx.phone, '📍 Please choose at least one suburb first.')
      return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], 0, selectedRegionStatus)
    }
    await sendExperiencePrompt(ctx.phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: {
        locationNodeIds: existingIds,
        selectedRegionLabels: [regionLabel],
        selectedSuburbLabels: existingLabels,
        selectedRegionStatus,
      },
    }
  }

  if (rawLower === 'more') {
    const nextOffset = suburbPage + SUBURB_TEXT_PAGE_SIZE
    if (nextOffset >= suburbOptions.length) {
      await sendText(
        ctx.phone,
        `📍 You have seen all ${suburbOptions.length} suburbs in ${regionLabel}.\n\nReply with numbers to select, or *done* to continue.`
      )
      return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
    }
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, nextOffset, selectedRegionStatus)
  }

  if (rawLower === 'all') {
    // TODO: If a business limit on max suburbs per provider is introduced, enforce it here.
    const allIds = suburbOptions.map(s => s.id)
    const allLabels = suburbOptions.map(s => s.label)
    const preview = allLabels.length > 8
      ? `${allLabels.slice(0, 8).join(', ')} + ${allLabels.length - 8} more`
      : allLabels.join(', ')
    await sendButtons(
      ctx.phone,
      `✅ *All ${allLabels.length} suburbs in ${regionLabel} selected!*\n\n${preview}\n\nContinue?`,
      [
        { id: 'suburb_confirm', title: '✅ Continue' },
        { id: 'suburb_change', title: '✏️ Change' },
      ],
    )
    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId, regionLabel, suburbPage, suburbOptions,
        locationNodeIds: allIds,
        selectedSuburbLabels: allLabels,
        selectedRegionStatus,
      },
    }
  }

  // ── Parse number input ─────────────────────────────────────────────────────
  // Numbers are 1-based and global (refer to suburbOptions index, not the current page).

  const indices = parseNumberedInput(raw)

  if (indices.length === 0) {
    if (!raw) {
      return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, existingLabels, existingIds, suburbPage, selectedRegionStatus)
    }
    await sendText(ctx.phone, '📍 Please reply with suburb numbers from the list, e.g. *1,3,5*')
    return { nextStep: 'reg_collect_suburb_select', nextData: { ...ctx.data } }
  }

  // Validate against full suburbOptions (global, 1-based)
  const newIds: string[] = []
  const newLabels: string[] = []
  const invalidNums: number[] = []

  for (const n of indices) {
    const suburb = suburbOptions[n - 1]
    if (!suburb) {
      invalidNums.push(n)
    } else if (!existingIds.includes(suburb.id)) {
      newIds.push(suburb.id)
      newLabels.push(suburb.label)
    }
    // silently skip already-selected suburbs (no duplicate message needed)
  }

  // Every number was invalid and nothing was already selected
  if (newIds.length === 0 && existingIds.length === 0 && invalidNums.length > 0) {
    await sendText(
      ctx.phone,
      `❌ None of those numbers match suburbs on the list (${invalidNums.join(', ')}).\n\nPlease try again, e.g. *1,3,5*`
    )
    return showSuburbNumberedPrompt(ctx.phone, regionId, regionLabel, [], [], suburbPage, selectedRegionStatus)
  }

  const mergedIds = [...existingIds, ...newIds]
  const mergedLabels = [...existingLabels, ...newLabels]

  let confirmBody = `✅ *Selected suburbs:* ${mergedLabels.join(', ')}`
  if (invalidNums.length > 0) {
    confirmBody += `\n\n_(We ignored numbers not on the list: ${invalidNums.join(', ')})_`
  }
  confirmBody += '\n\nReady to continue?'

  await sendButtons(
    ctx.phone,
    confirmBody,
    [
      { id: 'suburb_confirm', title: '✅ Continue' },
      { id: 'suburb_add_more', title: '➕ Add more' },
      { id: 'suburb_change', title: '✏️ Change' },
    ],
  )

  return {
    nextStep: 'reg_collect_suburb_select',
    nextData: {
      regionId, regionLabel, suburbPage, suburbOptions,
      locationNodeIds: mergedIds,
      selectedSuburbLabels: mergedLabels,
      selectedRegionStatus,
    },
  }
}

// ─── Suburb free-text fallback (when location_nodes DB has no region data) ────

async function handleCollectSuburbText(ctx: FlowContext): Promise<FlowResult> {
  const typed = ctx.reply.text?.trim() ?? ''
  if (!typed || typed.length < 2) {
    await sendText(
      ctx.phone,
      `📍 Please type your main working suburb or area (e.g. *Randburg*, *Allen's Nek*):`,
    )
    return { nextStep: 'reg_collect_suburb_text' }
  }

  const suburbLabel = typed.charAt(0).toUpperCase() + typed.slice(1)
  const city = ctx.data.city ?? ''
  const area = city ? `${suburbLabel}, ${city}` : suburbLabel

  await sendExperiencePrompt(ctx.phone)
  return {
    nextStep: 'reg_collect_availability',
    nextData: { serviceAreas: [area] },
  }
}

async function handleCollectAvailability(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('exp_')) {
    await sendText(ctx.phone, 'Please choose your experience level from the list above.')
    return { nextStep: 'reg_collect_availability' }
  }

  const expLabels: Record<string, string> = {
    exp_lt1: 'Less than 1 year',
    exp_1_3: '1–3 years',
    exp_3_5: '3–5 years',
    exp_5plus: '5+ years',
  }
  const experience = expLabels[ctx.reply.id] ?? ctx.reply.title ?? ''

  await sendButtons(
    ctx.phone,
    '📅 Are you available on weekends?\n\nWe get many weekend requests — workers who work Saturdays often get more leads.',
    [
      { id: 'avail_weekdays_only', title: '📋 Weekdays only' },
      { id: 'avail_incl_sat', title: '📅 Mon–Sat' },
      { id: 'avail_any_day', title: '✅ Any day' },
    ]
  )
  return { nextStep: 'reg_collect_evidence', nextData: { experience } }
}

async function handleCollectEvidence(ctx: FlowContext): Promise<FlowResult> {
  const availMap: Record<string, { label: string; days: string[] }> = {
    avail_weekdays_only: { label: 'Weekdays only', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    avail_incl_sat: { label: 'Mon–Sat', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
    avail_any_day: { label: 'Any day', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  }

  if (ctx.reply.id?.startsWith('avail_')) {
    const avail = availMap[ctx.reply.id]
    const availability = avail?.days ?? []

    await sendButtons(
      ctx.phone,
      '🧾 Would you like to add an optional work note?\n\nExamples: past jobs, references, or types of repairs you have done. This stays provider-supplied unless Plug A Pro says a specific item was reviewed.',
      [
        { id: 'evidence_add', title: '✍️ Add proof note' },
        { id: 'evidence_skip', title: '⏭️ Skip for now' },
      ]
    )
    return { nextStep: 'reg_collect_evidence', nextData: { availability } }
  }

  if (ctx.reply.id === 'evidence_add') {
    await sendText(
      ctx.phone,
      '🧾 Share optional work examples — you can send:\n• A text note about past jobs or references\n• One photo or PDF at a time (up to 5 files)\n\nOr type *skip* to continue without one.'
    )
    return { nextStep: 'reg_collect_evidence' }
  }

  if (ctx.reply.id === 'evidence_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    return showRegistrationSummary(ctx, { evidenceNote: '' })
  }

  // ── Media upload (image or document) ──────────────────────────────────────
  if (ctx.reply.type === 'image' || ctx.reply.type === 'document') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, "⚠️ Couldn't process that file. Please try again or type *skip* to continue without one.")
      return { nextStep: 'reg_collect_evidence' }
    }
    const existing = uniqueStrings(ctx.data.evidenceFileUrls ?? [])
    const existingMediaIds = uniqueStrings(ctx.data.evidenceMediaIds ?? [])

    if (existingMediaIds.includes(ctx.reply.mediaId)) {
      await sendEvidenceFileProgress(ctx.phone, existing.length)
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: existing, evidenceMediaIds: existingMediaIds },
      }
    }

    if (existing.length >= MAX_EVIDENCE_FILES) {
      await sendEvidenceFileProgress(ctx.phone, existing.length)
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: existing, evidenceMediaIds: existingMediaIds },
      }
    }

    // providerApplicationId is not yet created — attachment starts with null FK.
    // handlePending backfills the FK once the ProviderApplication row exists.
    try {
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        // no providerApplicationId yet — backfilled at submission
      })
      const updated = uniqueStrings([...existing, attachmentId]).slice(0, MAX_EVIDENCE_FILES)
      const updatedMediaIds = uniqueStrings([...existingMediaIds, ctx.reply.mediaId])
      await sendEvidenceFileProgress(ctx.phone, updated.length)
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls: updated, evidenceMediaIds: updatedMediaIds },
      }
    } catch (err) {
      console.error(
        `[registration:handleCollectEvidence] media upload failed — mediaId=${ctx.reply.mediaId} mimeType=${ctx.reply.mimeType ?? 'unknown'}:`,
        err
      )
      await sendText(ctx.phone, "⚠️ Couldn't upload that file. Please try again or type *skip* to continue without one.")
      return { nextStep: 'reg_collect_evidence' }
    }
  }

  if (ctx.reply.id === 'evidence_done') {
    return showRegistrationSummary(ctx, {})
  }

  if (ctx.reply.id === 'evidence_add_more') {
    const existing = uniqueStrings(ctx.data.evidenceFileUrls ?? [])
    const remaining = Math.max(0, MAX_EVIDENCE_FILES - existing.length)
    await sendText(ctx.phone, `📎 Send your next file — one at a time. You can add up to ${remaining} more, or type *skip* to finish.`)
    return { nextStep: 'reg_collect_evidence' }
  }

  const evidenceNote = ctx.reply.text?.trim()
  if (!evidenceNote) {
    await sendText(ctx.phone, 'Reply with your proof note or send a file, or type *skip* if you do not want to add one now.')
    return { nextStep: 'reg_collect_evidence' }
  }

  return showRegistrationSummary(ctx, { evidenceNote })
}

async function showRegistrationSummary(
  ctx: FlowContext,
  overrides?: Partial<FlowContext['data']>
): Promise<FlowResult> {
  const availLabel =
    (overrides?.availability?.length ?? ctx.data.availability?.length ?? 0) >= 7 ? 'Any day'
    : (overrides?.availability?.length ?? ctx.data.availability?.length ?? 0) >= 6 ? 'Mon–Sat'
    : 'Weekdays only'

  const merged = { ...ctx.data, ...overrides }
  const { name, skills, serviceAreas, experience, evidenceNote, evidenceFileUrls } = merged
  const skillList = (skills ?? []).join(', ')
  // Prefer suburb-level labels if the provider drilled down, else fall back to region/area labels
  const suburbLabels = merged.selectedSuburbLabels as string[] | undefined
  const regionLabels = merged.selectedRegionLabels as string[] | undefined
  const areaList = (suburbLabels?.length ? suburbLabels : regionLabels?.length ? regionLabels : serviceAreas ?? []).join(', ')
  const fileCount = evidenceFileUrls?.length ?? 0

  await sendButtons(
    ctx.phone,
    `📋 *Your Application Summary*\n\n👤 Name: *${name}*\n🔧 Skills: *${skillList}*\n📍 Area: *${areaList}*\n💼 Experience: *${experience ?? 'Not specified'}*\n📅 Availability: *${availLabel}*\n${evidenceNote ? `🧾 Proof note: *${evidenceNote}*\n` : ''}${fileCount > 0 ? `📎 Files: *${fileCount} uploaded*\n` : ''}\nShall I submit your application?`,
    [
      { id: 'submit_yes', title: '✅ Submit' },
      { id: 'reg_edit', title: '✏️ Edit' },
      { id: 'submit_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'reg_pending', nextData: overrides }
}

async function handleConfirm(ctx: FlowContext): Promise<FlowResult> {
  return showRegistrationSummary(ctx)
}

async function handlePending(ctx: FlowContext): Promise<FlowResult> {
  // Edit — show field selection, not full restart
  if (ctx.reply.id === 'reg_edit') {
    return showEditMenu(ctx)
  }

  if (ctx.reply.id === 'submit_no') {
    await sendText(ctx.phone, "Application cancelled. Reply *join* anytime to apply. 👋")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id !== 'submit_yes') {
    return { nextStep: 'reg_pending' }
  }

  try {
    const availLabel =
      (ctx.data.availability?.length ?? 0) >= 7 ? 'Any day'
      : (ctx.data.availability?.length ?? 0) >= 6 ? 'Mon–Sat'
      : 'Weekdays only'

    // ── Idempotency guard: prevent duplicate application on double-tap ─────────
    // Race condition: user taps "Submit" twice (or retries quickly). Check for
    // an existing active application before creating a new record.
    const normalizedPhone = normalizePhone(ctx.phone)
    const existingApp = await findLatestActiveProviderApplicationByPhone(db, normalizedPhone)

    if (existingApp?.status === 'APPROVED') {
      await sendText(
        ctx.phone,
        `✅ You're already registered as a Plug A Pro worker. You'll receive job leads through this number.\n\nReply *menu* to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    if (existingApp?.status === 'PENDING') {
      const ref = existingApp.id.slice(-8).toUpperCase()
      await sendText(
        ctx.phone,
      `⏳ Your provider profile is already on file.\n\nRef: *${ref}*\n\nReply *jobs* to check leads or *menu* anytime to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    const resolvedAreaLabels = ctx.data.locationNodeIds && (ctx.data.locationNodeIds as string[]).length > 0
      ? ((ctx.data.selectedSuburbLabels as string[] | undefined)?.length
          ? (ctx.data.selectedSuburbLabels as string[])
          : (ctx.data.selectedRegionLabels as string[] | undefined) ?? ctx.data.serviceAreas ?? [])
      : (ctx.data.serviceAreas ?? [])

    const providerId = await syncProviderRecord(db, {
      phone: normalizedPhone,
      name: ctx.data.name ?? 'Unknown',
      skills: ctx.data.skills ?? [],
      serviceAreas: resolvedAreaLabels,
      active: true,
      availableNow: true,
      verified: false,
      locationNodeIds: ctx.data.locationNodeIds ?? [],
    })

    // evidenceFileUrls holds Attachment IDs (not blob URLs) — created during evidence collection
    // with providerApplicationId=null; we backfill the FK below after the application is created.
    const evidenceAttachmentIds = ctx.data.evidenceFileUrls ?? []

    let application: { id: string }
    try {
      application = await db.providerApplication.create({
        data: {
          providerId,
          phone: normalizedPhone,
          name: ctx.data.name ?? 'Unknown',
          skills: ctx.data.skills ?? [],
          serviceAreas: resolvedAreaLabels,
          experience: ctx.data.experience ?? null,
          availability: availLabel,
          evidenceNote: ctx.data.evidenceNote ?? null,
          evidenceFileUrls: evidenceAttachmentIds,
          status: 'PENDING',
        },
      })
    } catch (error) {
      const duplicateRace =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'

      if (!duplicateRace) throw error

      const racedExisting = await findLatestActiveProviderApplicationByPhone(db, normalizedPhone)
      if (!racedExisting) throw error

      const ref = racedExisting.id.slice(-8).toUpperCase()
      await sendText(
        ctx.phone,
      `⏳ Your provider profile is already on file.\n\nRef: *${ref}*\n\nReply *jobs* to check leads or *menu* anytime to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    const ref = application.id.slice(-8).toUpperCase()

    // Backfill providerApplicationId on any evidence Attachments created during the flow.
    // They were created with providerApplicationId=null (no app row existed yet).
    if (evidenceAttachmentIds.length > 0) {
      await db.attachment.updateMany({
        where: { id: { in: evidenceAttachmentIds }, providerApplicationId: null },
        data: { providerApplicationId: application.id },
      }).catch((err: unknown) => {
        console.error(`[registration-flow:handlePending] evidence attachment backfill failed for app ${application.id}:`, err)
      })
    }

    const isComingSoonRegion = ctx.data.selectedRegionStatus === 'coming_soon'
    await sendText(
      ctx.phone,
      isComingSoonRegion
        ? `🎉 *Profile submitted!*\n\nThanks, *${ctx.data.name}* — this area is not live yet, but your profile has been saved.\n\nWe'll notify you when Plug A Pro opens leads in this region.\n\nRef: *${ref}*\n\nReply *jobs* anytime to check available work.`
        : `🎉 *Profile submitted!*\n\nThanks, *${ctx.data.name}* — your provider profile is ready to receive suitable job leads while we keep your details on record.\n\nRef: *${ref}*\n\nReply *jobs* anytime to check available work.`
    )

    // A new provider can unlock older unmatched demand, so check open and
    // recently expired jobs immediately instead of waiting for the next cron run.
    checkJobsForNewProviderAvailability(providerId).catch((err) => {
      console.error(`[registration-flow] new-provider job check failed for provider ${providerId}:`, err)
    })

    // Send template confirmation (covers the case where >24h passes before we reply)
    // Intentional direct sendTemplate bypass: provider applicants have no Customer record yet,
    // so canSend() would return 'customer_not_found'. This is a provider-facing transactional
    // message (application acknowledgement) — opt-in policy does not apply.
    const { sendTemplate } = await import('../whatsapp')
    sendTemplate({
      to: ctx.phone,
      template: 'technician_application_received',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: ctx.data.name ?? 'Applicant' }, { type: 'text', text: ref }] },
      ],
    }).catch(() => {}) // non-blocking

    // Notify admin of new application (non-blocking)
    const { sendAdminNewApplication } = await import('../whatsapp')
    sendAdminNewApplication({
      applicantName: ctx.data.name ?? 'Unknown',
      applicantPhone: ctx.phone,
      skills: ctx.data.skills ?? [],
      serviceAreas: ctx.data.locationNodeIds?.length
        ? (ctx.data.selectedRegionLabels ?? ctx.data.serviceAreas ?? [])
        : (ctx.data.serviceAreas ?? []),
      applicationId: application.id,
    }).catch(() => {})

    return { nextStep: 'done' }
  } catch (err) {
    console.error('[registration-flow] Submit error:', err)
    await sendText(
      ctx.phone,
      '😔 Something went wrong submitting your application. Please try again or reply *join* to restart.'
    )
    return { nextStep: 'done' }
  }
}

// ─── Field-level edit ─────────────────────────────────────────────────────────

async function showEditMenu(ctx: FlowContext): Promise<FlowResult> {
  const { name, skills, serviceAreas, experience, evidenceNote } = ctx.data
  const summary = [
    name            ? `👤 ${name}` : null,
    skills?.length  ? `🔧 ${skills.join(', ')}` : null,
    serviceAreas?.[0] ? `📍 ${serviceAreas[0]}` : null,
    experience      ? `💼 ${experience}` : null,
    evidenceNote    ? `🧾 ${evidenceNote}` : null,
  ].filter(Boolean).join('\n')

  await sendList(
    ctx.phone,
    `✏️ *What would you like to change?*\n\n${summary}\n\nTap a field to update it:`,
    [{ title: 'Your details', rows: [
      { id: 'edit_name',         title: '👤 Name' },
      { id: 'edit_skills',       title: '🔧 Skills' },
      { id: 'edit_area',         title: '📍 Area' },
      { id: 'edit_experience',   title: '💼 Experience' },
      { id: 'edit_evidence',     title: '🧾 Proof note' },
      { id: 'edit_availability', title: '📅 Availability' },
    ]}],
    { buttonLabel: 'Choose Field' }
  )
  return { nextStep: 'reg_edit_field' }
}

async function handleEditField(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.reply.id) {
    case 'edit_name':
      await sendText(ctx.phone, '👤 What is your *full name*?\n\n_(Type and send your name)_')
      return { nextStep: 'reg_collect_skills' }   // handleCollectSkills reads the text as the new name

    case 'edit_skills':
      await sendText(ctx.phone, buildSkillPromptText('🔧 *Choose your skills* — previous selection will be replaced.'))
      return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }

    case 'edit_area':
      return promptArea(ctx)   // sends area list, nextStep: reg_collect_experience

    case 'edit_experience': {
      await sendList(
        ctx.phone,
        '💼 How many years of experience do you have in your trade?',
        [{
          title: 'Experience',
          rows: [
            { id: 'exp_lt1',   title: 'Less than 1 year', description: 'Just starting out' },
            { id: 'exp_1_3',   title: '1–3 years',        description: 'Some experience' },
            { id: 'exp_3_5',   title: '3–5 years',        description: 'Experienced' },
            { id: 'exp_5plus', title: '5+ years',          description: 'Highly experienced' },
          ],
        }],
        { buttonLabel: 'Choose Experience' }
      )
      return { nextStep: 'reg_collect_availability' }
    }

    case 'edit_evidence':
      await sendText(
        ctx.phone,
        '🧾 Share a short note about past work or references you want customers to see later.\n\nReply with your note, or type *skip* to clear it.'
      )
      return { nextStep: 'reg_collect_evidence' }

    case 'edit_availability':
      await sendButtons(
        ctx.phone,
        '📅 Are you available on weekends?\n\nWe get many weekend requests — workers who work Saturdays often get more leads.',
        [
          { id: 'avail_weekdays_only', title: '📋 Weekdays only' },
          { id: 'avail_incl_sat',      title: '📅 Mon–Sat' },
          { id: 'avail_any_day',       title: '✅ Any day' },
        ]
      )
      return { nextStep: 'reg_collect_evidence' }

    default:
      // Unknown reply — re-show the edit menu
      return showEditMenu(ctx)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a WhatsApp reply into a deduplicated, sorted list of 1-based positive integers.
 * Accepts comma, semicolon, and whitespace separators.
 * Rejects floats ("1.2"), non-numeric fragments, and zero/negative numbers.
 * Strips leading # (e.g. "#3" → 3) and trailing period (e.g. "1." → 1).
 * Trailing periods appear when users copy or mimic WhatsApp's rendered numbered list
 * format ("1. Plumbing" → user types "1.").
 *
 * Examples:
 *   "1,3,6"     → [1, 3, 6]
 *   "1 2 3"     → [1, 2, 3]
 *   "1;2;3"     → [1, 2, 3]
 *   "1, 2, 3"   → [1, 2, 3]
 *   "1,1,2,3,2" → [1, 2, 3]  (deduplicated)
 *   "#1,#3"     → [1, 3]
 *   "1.,3."     → [1, 3]      (trailing periods stripped)
 *   "1.2,3"     → [3]         (1.2 is not an integer — rejected)
 *   "1a,3"      → [3]         (1a is not a pure integer — rejected)
 */
function parseNumberedInput(raw: string): number[] {
  const parts = raw.trim().split(/[\s,;]+/).filter(Boolean)
  const seen = new Set<number>()
  for (const part of parts) {
    // Strip leading # (e.g. "#1") and trailing period (e.g. "1." from WhatsApp list copy)
    const stripped = part.replace(/^#/, '').replace(/\.$/, '')
    // Only accept pure digit strings — no floats, no mixed alphanumeric
    if (!/^\d+$/.test(stripped)) continue
    const n = parseInt(stripped, 10)
    if (n > 0) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * Builds a numbered skill selection prompt as a plain text message.
 * Skills are numbered 1–N (PROVIDER_SKILL_OPTIONS, 'other' excluded).
 * Provider replies with comma-separated numbers, e.g. "1,3,6".
 */
function buildSkillPromptText(intro: string, selected: string[] = []): string {
  const lines = PROVIDER_SKILL_OPTIONS.map((o, i) => {
    const selectedSuffix = selected.includes(o.label) ? ' (selected)' : ''
    return `${i + 1}. ${o.label}${selectedSuffix}`
  })
  return (
    `${intro}\n\n` +
    `Reply with all numbers that apply, separated by commas.\n` +
    `Example: *1,3,6*\n\n` +
    lines.join('\n')
  )
}

/**
 * Builds a numbered suburb selection prompt as a plain text message.
 * Numbers are global (1-based across all pages) so "8" always means the 8th suburb
 * regardless of the current page offset.
 */
function buildSuburbPromptText(
  regionLabel: string,
  allSuburbs: Array<{ id: string; label: string }>,
  pageOffset: number,
  selectedLabels: string[],
): string {
  const page = allSuburbs.slice(pageOffset, pageOffset + SUBURB_TEXT_PAGE_SIZE)
  const hasMore = allSuburbs.length > pageOffset + SUBURB_TEXT_PAGE_SIZE
  const total = allSuburbs.length

  const selectedSummary = selectedLabels.length > 0
    ? `\nSelected so far: *${selectedLabels.join(', ')}*\n`
    : ''

  // Global numbering: suburb at index i has number (pageOffset + i + 1)
  const lines = page.map((s, i) => {
    const selectedSuffix = selectedLabels.includes(s.label) ? ' (selected)' : ''
    return `${pageOffset + i + 1}. ${s.label}${selectedSuffix}`
  })

  // Build example numbers from the current page
  const exNums = [pageOffset + 1, Math.min(pageOffset + 3, total)].filter((v, i, a) => a.indexOf(v) === i)
  const example = exNums.join(',')

  const instructions: string[] = [
    `Reply with all numbers for suburbs you cover. Example: *${example}*`,
  ]
  if (selectedLabels.length > 0) instructions.push(`Reply *done* to continue with your current selection.`)
  if (hasMore) instructions.push(`Reply *more* to see the next batch of suburbs.`)
  instructions.push(`Reply *all* to cover the whole ${regionLabel} area.`)

  return (
    `📍 *Which suburbs in ${regionLabel} do you work in?*${selectedSummary}\n` +
    lines.join('\n') +
    `\n\n` +
    instructions.join('\n')
  )
}
