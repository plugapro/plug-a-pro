// ─── Service provider registration flow via WhatsApp ──────────────────────────
// Journey: trigger → name → skills (multi-select) → area → experience → availability → submit → pending review
// No direct connection given to customer — all mediated through Plug-a-Pro

import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import { db } from '../db'
import { syncProviderRecord } from '../provider-record'
import { normalizePhone } from '../utils'
import { findLatestActiveProviderApplicationByPhone } from '../provider-applications'
import type { FlowContext, FlowResult } from './types'

// Static category list — mirrors job-request.ts
const SKILL_CATEGORIES = [
  'Plumbing',
  'Painting',
  'Garden & Landscaping',
  'Handyman',
  'Appliances',
  'Electrical',
  'DIY & Assembly',
  'Roofing',
]

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
  // Existing active applications own the provider identity for this phone number.
  const existing = await findLatestActiveProviderApplicationByPhone(db, ctx.phone)

  if (existing?.status === 'APPROVED') {
    await sendButtons(
      ctx.phone,
      "✅ You're already registered as a Plug a Pro worker! You'll receive job leads through this number.\n\nWhat would you like to do?",
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
      `⏳ Your application is under review. We'll contact you within 24 hours.\n\nRef: *${existing.id.slice(-8).toUpperCase()}*\n\nReply *menu* anytime to return to the main menu.`
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `👷 *Join Plug a Pro as a Service Provider*\n\nEarn money doing what you're good at. We connect you with customers who need your skills.\n\n*Here's how it works:*\n• We send you job leads in your area\n• You confirm availability and go do the job\n• Plug a Pro keeps the quote and job record clear so payment can be settled properly\n\nReady to apply?`,
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

  await sendSkillList(ctx.phone, `Nice to meet you, *${name}*! 👋\n\nWhat type of work do you do?\n_(You can add multiple skills)_`)
  return { nextStep: 'reg_collect_skills_more', nextData: { name, skills: [] } }
}

async function handleCollectSkillsMore(ctx: FlowContext): Promise<FlowResult> {
  // Handle "done selecting skills"
  if (ctx.reply.id === 'skills_done') {
    const skills = ctx.data.skills ?? []
    if (skills.length === 0) {
      await sendSkillList(ctx.phone, 'Please select at least one skill.')
      return { nextStep: 'reg_collect_skills_more' }
    }
    return promptArea(ctx)
  }

  if (!ctx.reply.id?.startsWith('skill_')) {
    await sendSkillList(ctx.phone, 'Please choose from the list, or tap *Done* to continue.')
    return { nextStep: 'reg_collect_skills_more' }
  }

  const newSkill = ctx.reply.title ?? ''
  const existing = ctx.data.skills ?? []

  // Prevent duplicate selections
  if (existing.includes(newSkill)) {
    const skillList = existing.join(', ')
    await sendButtons(
      ctx.phone,
      `✅ *${newSkill}* is already in your list.\n\nSelected: *${skillList}*\n\nAdd another skill or continue?`,
      [
        { id: 'skills_more', title: '➕ Add another' },
        { id: 'skills_done', title: '✅ Done' },
      ]
    )
    return { nextStep: 'reg_collect_skills_more' }
  }

  const skills = [...existing, newSkill]
  const skillList = skills.join(', ')

  await sendButtons(
    ctx.phone,
    `✅ *${newSkill}* added!\n\nYour skills so far: *${skillList}*\n\nAdd another skill or continue?`,
    [
      { id: 'skills_more', title: '➕ Add another' },
      { id: 'skills_done', title: '✅ Done' },
    ]
  )
  return { nextStep: 'reg_collect_skills_more', nextData: { skills } }
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
  // This step is no longer reached directly — area is handled after skills_done via promptArea
  // Kept for backwards compat if a session was in this step before the update
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
  // Handle "add more skills" request (from skills_more button after area prompt)
  if (ctx.reply.id === 'skills_more') {
    await sendSkillList(ctx.phone, 'Choose another skill:')
    return { nextStep: 'reg_collect_skills_more' }
  }

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
      // No cities seeded yet — fall through to legacy area approach
      await sendExperiencePrompt(ctx.phone)
      return { nextStep: 'reg_collect_availability', nextData: { serviceAreas: [areaLabel] } }
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
    // DB unavailable — fall through to legacy flow
    await sendExperiencePrompt(ctx.phone)
    return { nextStep: 'reg_collect_availability', nextData: { serviceAreas: [areaLabel] } }
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
      // No regions — fall through to experience
      await sendExperiencePrompt(ctx.phone)
      return {
        nextStep: 'reg_collect_availability',
        nextData: { city: cityLabel, serviceAreas: [ctx.data.province ?? cityLabel] },
      }
    }

    const rows = regions.slice(0, 10).map(r => ({
      id: `region_${r.id}`,
      title: r.label,
    }))

    await sendList(
      ctx.phone,
      `🗺 Which area(s) of *${cityLabel}* do you work in?\n\n_(You can add multiple areas)_`,
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
  // "Done" — proceed to experience
  if (ctx.reply.id === 'region_done') {
    const nodeIds = ctx.data.locationNodeIds ?? []
    if (nodeIds.length === 0) {
      // Re-show region list
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

  const existing = ctx.data.locationNodeIds ?? []
  if (existing.includes(regionId)) {
    // Already selected
    const areaList = (ctx.data.selectedRegionLabels ?? []).join(', ')
    await sendButtons(
      ctx.phone,
      `✅ *${regionLabel}* is already selected.\n\nAreas: *${areaList}*\n\nAdd another or continue?`,
      [
        { id: 'region_more', title: '➕ Add another' },
        { id: 'region_done', title: '✅ Done' },
      ]
    )
    return { nextStep: 'reg_collect_region' }
  }

  const newNodeIds = [...existing, regionId]
  const newLabels = [...(ctx.data.selectedRegionLabels ?? []), regionLabel]
  const areaList = newLabels.join(', ')

  await sendButtons(
    ctx.phone,
    `✅ *${regionLabel}* added!\n\nAreas: *${areaList}*\n\nAdd another area or continue?`,
    [
      { id: 'region_more', title: '➕ Add another' },
      { id: 'region_done', title: '✅ Done' },
    ]
  )
  return {
    nextStep: 'reg_collect_region',
    nextData: { locationNodeIds: newNodeIds, selectedRegionLabels: newLabels },
  }
}

async function handleCollectRegionMore(ctx: FlowContext): Promise<FlowResult> {
  return showRegionList(ctx) // re-show the region list
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
      '🧾 Would you like to add an optional proof note?\n\nExamples: past jobs, references, or certificate names. This stays provider-supplied unless Plug a Pro says a specific item was reviewed.',
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
      '🧾 Share a short note about any past work, references, or certificate names you want customers to see later.\n\nReply with your note, or type *skip* to continue without one.'
    )
    return { nextStep: 'reg_collect_evidence' }
  }

  if (ctx.reply.id === 'evidence_skip' || ctx.reply.text?.trim().toLowerCase() === 'skip') {
    return showRegistrationSummary(ctx, { evidenceNote: '' })
  }

  const evidenceNote = ctx.reply.text?.trim()
  if (!evidenceNote) {
    await sendText(ctx.phone, 'Reply with your proof note, or type *skip* if you do not want to add one now.')
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
  const { name, skills, serviceAreas, experience, evidenceNote } = merged
  const skillList = (skills ?? []).join(', ')
  const areaList = (serviceAreas ?? []).join(', ')

  await sendButtons(
    ctx.phone,
    `📋 *Your Application Summary*\n\n👤 Name: *${name}*\n🔧 Skills: *${skillList}*\n📍 Area: *${areaList}*\n💼 Experience: *${experience ?? 'Not specified'}*\n📅 Availability: *${availLabel}*\n${evidenceNote ? `🧾 Proof note: *${evidenceNote}*\n` : ''}\nShall I submit your application?`,
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
        `✅ You're already registered as a Plug a Pro worker. You'll receive job leads through this number.\n\nReply *menu* to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    if (existingApp?.status === 'PENDING') {
      const ref = existingApp.id.slice(-8).toUpperCase()
      await sendText(
        ctx.phone,
        `⏳ Your application is already under review.\n\nRef: *${ref}*\n\nWe'll contact you within 24 hours. Reply *menu* anytime to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    const providerId = await syncProviderRecord(db, {
      phone: normalizedPhone,
      name: ctx.data.name ?? 'Unknown',
      skills: ctx.data.skills ?? [],
      serviceAreas: ctx.data.locationNodeIds && ctx.data.locationNodeIds.length > 0
        ? (ctx.data.selectedRegionLabels ?? ctx.data.serviceAreas ?? [])
        : (ctx.data.serviceAreas ?? []),
      active: true,
      availableNow: true,
      verified: false,
      locationNodeIds: ctx.data.locationNodeIds ?? [],
    })

    let application: { id: string }
    try {
      application = await db.providerApplication.create({
        data: {
          providerId,
          phone: normalizedPhone,
          name: ctx.data.name ?? 'Unknown',
          skills: ctx.data.skills ?? [],
          serviceAreas: ctx.data.locationNodeIds && ctx.data.locationNodeIds.length > 0
            ? (ctx.data.selectedRegionLabels ?? ctx.data.serviceAreas ?? [])
            : (ctx.data.serviceAreas ?? []),
          experience: ctx.data.experience ?? null,
          availability: availLabel,
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
        `⏳ Your application is already under review.\n\nRef: *${ref}*\n\nWe'll contact you within 24 hours. Reply *menu* anytime to return to the main menu.`
      )
      return { nextStep: 'done' }
    }

    const ref = application.id.slice(-8).toUpperCase()

    await sendText(
      ctx.phone,
      `🎉 *Application submitted!*\n\nThanks, *${ctx.data.name}* — we'll review your details and get back to you within *24 hours*.\n\nRef: *${ref}*\n\n_We'll message you here with the outcome._`
    )

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
      await sendSkillList(ctx.phone, 'Choose your skills. Tap *Done* when finished.\n\n_Your previous selection will be replaced._')
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
        '🧾 Share a short note about past work, references, or certificate names you want customers to see later.\n\nReply with your note, or type *skip* to clear it.'
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

async function sendSkillList(phone: string, bodyText: string): Promise<void> {
  const rows = SKILL_CATEGORIES.map((cat) => ({
    id: `skill_${cat.toLowerCase().replace(/[\s&/]+/g, '_')}`,
    title: cat,
  }))
  await sendList(
    phone,
    bodyText,
    [{ title: 'Skills', rows }],
    { buttonLabel: 'Choose Skill', footer: 'Select each skill then tap Done' }
  )
}
