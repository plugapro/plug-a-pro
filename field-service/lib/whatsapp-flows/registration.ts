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
  getServiceCategorySelectionSummary,
  labelsFromServiceCategoryTags,
  normalizeServiceCategorySelections,
} from '../service-categories'
import type { FlowContext, FlowResult } from './types'

// ─── Trigger keywords that start the registration flow ────────────────────────
export const REGISTRATION_TRIGGERS = [
  'register', 'join', 'technician', 'provider', 'apply', 'signup', 'sign up',
  'i want to work', 'want to work', 'looking for work', 'find work',
  'i want work', 'need work', 'find a job', 'get work',
  'ek wil werk',        // Afrikaans: "I want to work"
  'ngifuna ukusebenza', // Zulu: "I want to work"
]

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
  // Block customers from registering as providers with the same number.
  const { normalizePhone } = await import('../utils')
  const normalizedPhone = normalizePhone(ctx.phone)
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

  await sendSkillPrompt(ctx.phone, `Nice to meet you, *${name}*! 👋`)
  return { nextStep: 'reg_collect_skills_more', nextData: { name, skills: [] } }
}

async function handleCollectSkillsMore(ctx: FlowContext): Promise<FlowResult> {
  const rawInput = ctx.reply.text?.trim() ?? ctx.reply.title?.trim() ?? ''
  const skills = parseSkillSelections(rawInput)

  if (skills.length === 0) {
    await sendSkillPrompt(
      ctx.phone,
      'Please choose at least one valid skill. Reply with numbers or a comma-separated list.',
    )
    return { nextStep: 'reg_collect_skills_more' }
  }

  await sendButtons(
    ctx.phone,
    `✅ Selected skills: *${skills.join(', ')}*\n\nUse these skills for your application, or replace them before continuing.`,
    [
      { id: 'skills_done', title: '✅ Continue' },
      { id: 'edit_skills', title: '✏️ Change skills' },
    ]
  )
  return { nextStep: 'reg_collect_area', nextData: { skills } }
}

async function promptArea(ctx: FlowContext): Promise<FlowResult> {
  const rows = [
    { id: 'area_gauteng', title: 'Gauteng', description: 'Johannesburg & surrounds' },
    { id: 'area_western_cape', title: 'Western Cape', description: 'Cape Town area (coming soon)' },
    { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: 'Durban & surrounds' },
    { id: 'area_eastern_cape', title: 'Eastern Cape', description: 'Port Elizabeth & surrounds' },
    { id: 'area_other', title: 'Other province', description: 'Rest of South Africa' },
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
  if (ctx.reply.id === 'edit_skills') {
    await sendSkillPrompt(ctx.phone, 'Reply with your updated skill selection. Your previous selection will be replaced.')
    return { nextStep: 'reg_collect_skills_more', nextData: { skills: [] } }
  }

  if (ctx.reply.id === 'skills_done') {
    const skills = ctx.data.skills ?? []
    if (skills.length === 0) {
      await sendSkillPrompt(ctx.phone, 'Please choose at least one skill before continuing.')
      return { nextStep: 'reg_collect_skills_more' }
    }
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
          { id: 'area_gauteng', title: 'Gauteng', description: 'Johannesburg & surrounds' },
          { id: 'area_western_cape', title: 'Western Cape', description: 'Cape Town area (coming soon)' },
          { id: 'area_kwazulu_natal', title: 'KwaZulu-Natal', description: 'Durban & surrounds' },
          { id: 'area_eastern_cape', title: 'Eastern Cape', description: 'Port Elizabeth & surrounds' },
          { id: 'area_other', title: 'Other province', description: 'Rest of South Africa' },
        ],
      }],
      { buttonLabel: 'Choose Area' }
    )
    return { nextStep: 'reg_collect_experience' }
  }

  const areaLabel = ctx.reply.title ?? ''
  const provinceKey = PROVINCE_KEY_MAP[ctx.reply.id ?? ''] ?? 'gauteng'

  try {
    const { getCities } = await import('@/lib/location-nodes')
    const cities = await getCities(provinceKey)

    if (cities.length === 0) {
      // No cities seeded yet — ask provider to type their suburb for finer granularity
      await sendText(
        ctx.phone,
        `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
      )
      return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey } }
    }

    const rows = cities.slice(0, 10).map(c => ({
      id: `city_${c.id}`,
      title: c.label,
    }))

    await sendList(
      ctx.phone,
      '🏙 Which city do you mainly work in?',
      [{ title: 'Cities', rows }],
      { buttonLabel: 'Choose City' }
    )
    return {
      nextStep: 'reg_collect_city',
      nextData: { serviceAreas: [areaLabel], province: areaLabel, provinceKey },
    }
  } catch {
    // DB unavailable — ask provider to type their suburb
    await sendText(
      ctx.phone,
      `📍 Which suburb or area do you mainly work in?\n\nType the suburb name (e.g. *Randburg*, *Allen's Nek*, *Sandton*):`,
    )
    return { nextStep: 'reg_collect_suburb_text', nextData: { province: areaLabel, provinceKey } }
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
    const rows = cities.slice(0, 10).map(c => ({ id: `city_${c.id}`, title: c.label }))
    await sendList(ctx.phone, '🏙 Please choose your city:', [{ title: 'Cities', rows }], { buttonLabel: 'Choose City' })
    return { nextStep: 'reg_collect_city' }
  }

  const cityId = ctx.reply.id.replace('city_', '')
  const cityLabel = ctx.reply.title ?? ''

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
        nextData: { city: cityLabel, cityId },
      }
    }

    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
    }))

    await sendList(
      ctx.phone,
      `🗺 Which area of *${cityLabel}* do you mainly work in?`,
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
    const rows = regions.slice(0, 10).map(r => ({ id: `region_${r.id}`, title: r.label }))
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

  // Drill down to suburb selection within this region
  return showSuburbSelectPrompt(ctx.phone, regionId, regionLabel, [])
}

async function handleCollectRegionMore(ctx: FlowContext): Promise<FlowResult> {
  return showRegionList(ctx) // re-show the region list
}

// ─── Suburb multi-select within a region ──────────────────────────────────────

const SUBURB_PAGE_SIZE = 10

async function showSuburbSelectPrompt(
  phone: string,
  regionId: string,
  regionLabel: string,
  alreadySelected: string[],
  pageOffset = 0,
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
        },
      }
    }

    const page = suburbs.slice(pageOffset, pageOffset + SUBURB_PAGE_SIZE)
    const hasMore = suburbs.length > pageOffset + SUBURB_PAGE_SIZE

    const numberedList = page
      .map((s, i) => `${pageOffset + i + 1}. ${s.label}`)
      .join('\n')

    const selectedSummary = alreadySelected.length > 0
      ? `\n\n✅ Selected so far: *${alreadySelected.join(', ')}*`
      : ''

    const moreNote = hasMore
      ? `\n\nType *more* to see more suburbs, or *done* when finished.`
      : `\n\nType the numbers of your suburbs, then *done* when finished.`

    await sendText(
      phone,
      `📍 *Which suburbs in ${regionLabel} do you work in?*\n\nReply with numbers separated by commas (e.g. *1,3*).${selectedSummary}${moreNote}\n\n${numberedList}`,
    )

    return {
      nextStep: 'reg_collect_suburb_select',
      nextData: {
        regionId,
        regionLabel,
        suburbPage: pageOffset,
        suburbPageTotal: suburbs.length,
        // Preserve suburb options so we can resolve numbers to IDs
        suburbOptions: suburbs.map(s => ({ id: s.id, label: s.label })),
      },
    }
  } catch {
    await sendExperiencePrompt(phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: { locationNodeIds: [regionId], selectedRegionLabels: [regionLabel] },
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

  const input = ctx.reply.text?.trim().toLowerCase() ?? ''

  // "done" — proceed if at least one suburb selected
  if (input === 'done' || ctx.reply.id === 'suburb_done') {
    if (existingIds.length === 0) {
      await sendText(ctx.phone, 'Please select at least one suburb, or type *done* to use the whole region.')
      return { nextStep: 'reg_collect_suburb_select' }
    }
    await sendExperiencePrompt(ctx.phone)
    return {
      nextStep: 'reg_collect_availability',
      nextData: {
        locationNodeIds: existingIds,
        selectedRegionLabels: [regionLabel],
        selectedSuburbLabels: existingLabels,
      },
    }
  }

  // "more" — next page
  if (input === 'more' || ctx.reply.id === 'suburb_more') {
    const nextOffset = suburbPage + SUBURB_PAGE_SIZE
    return showSuburbSelectPrompt(ctx.phone, regionId, regionLabel, existingLabels, nextOffset)
  }

  // Parse number selections
  const tokens = input.split(/[,\s]+/).filter(Boolean)
  const numbers = tokens.map(t => parseInt(t, 10)).filter(n => !isNaN(n) && n >= 1)

  if (numbers.length === 0) {
    await sendText(ctx.phone, 'Reply with the numbers of your suburbs (e.g. *1,3*), or type *done* when finished.')
    return { nextStep: 'reg_collect_suburb_select' }
  }

  const newIds = [...existingIds]
  const newLabels = [...existingLabels]

  for (const n of numbers) {
    const suburb = suburbOptions[n - 1]
    if (suburb && !newIds.includes(suburb.id)) {
      newIds.push(suburb.id)
      newLabels.push(suburb.label)
    }
  }

  const summary = newLabels.join(', ')
  const hasMore = (ctx.data.suburbPageTotal as number ?? 0) > suburbPage + SUBURB_PAGE_SIZE

  await sendButtons(
    ctx.phone,
    `✅ *Suburbs selected:* ${summary}\n\n${hasMore ? 'Add more suburbs, or continue to the next step.' : 'Continue to the next step, or change your selection.'}`,
    [
      { id: 'suburb_done', title: '✅ Continue' },
      { id: 'suburb_more', title: '➕ Add more' },
    ],
  )

  return {
    nextStep: 'reg_collect_suburb_select',
    nextData: {
      regionId,
      regionLabel,
      suburbPage,
      suburbPageTotal: ctx.data.suburbPageTotal,
      suburbOptions,
      locationNodeIds: newIds,
      selectedSuburbLabels: newLabels,
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
      '🧾 Share optional work examples — you can send:\n• A text note about past jobs or references\n• A photo or PDF of previous work\n\nOr type *skip* to continue without one.'
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
    // providerApplicationId is not yet created — attachment starts with null FK.
    // handlePending backfills the FK once the ProviderApplication row exists.
    try {
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        // no providerApplicationId yet — backfilled at submission
      })
      const existing = ctx.data.evidenceFileUrls ?? []
      const updated = [...existing, attachmentId]
      await sendButtons(
        ctx.phone,
        `✅ File received (${updated.length} total). Add another or continue?`,
        [
          { id: 'evidence_done', title: '✅ Continue' },
          { id: 'evidence_add_more', title: '📎 Add another' },
        ]
      )
      return { nextStep: 'reg_collect_evidence', nextData: { evidenceFileUrls: updated } }
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
    await sendText(ctx.phone, '📎 Send your next file, or type *skip* to finish.')
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

    await sendText(
      ctx.phone,
      `🎉 *Profile submitted!*\n\nThanks, *${ctx.data.name}* — your provider profile is ready to receive suitable job leads while we keep your details on record.\n\nRef: *${ref}*\n\nReply *jobs* anytime to check available work.`
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
      await sendSkillPrompt(ctx.phone, 'Reply with your updated skill selection. Your previous selection will be replaced.')
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

async function sendSkillPrompt(phone: string, intro: string): Promise<void> {
  const numberedList = SERVICE_CATEGORY_OPTIONS.map(
    (option, index) => `${index + 1}. ${option.label}`,
  ).join('\n')

  await sendText(
    phone,
    `${intro}\n\n🔧 *Choose your skills in one reply.*\nReply with numbers separated by commas.\nExample: *1,3,5*\n\n${numberedList}`,
  )
}

function parseSkillSelections(input: string): string[] {
  if (!input.trim()) return []

  const tokens = input
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) return []

  const numericSelections = tokens.every((token) => /^\d+$/.test(token))
  if (numericSelections) {
    const tags = tokens
      .map((token) => Number(token))
      .map((index) => SERVICE_CATEGORY_OPTIONS[index - 1]?.tag)
      .filter((value): value is string => Boolean(value))
    return labelsFromServiceCategoryTags(tags)
  }

  return labelsFromServiceCategoryTags(normalizeServiceCategorySelections(tokens))
}
