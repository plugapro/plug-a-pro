// ─── Technician / service provider registration flow via WhatsApp ─────────────
// Journey: trigger → name → skills → area → ID → submit → pending review
// No direct connection given to customer — all mediated through Plug-a-Pro

import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import { db } from '../db'
import type { FlowContext, FlowResult } from './types'

// ─── Trigger keywords that start the registration flow ────────────────────────
export const REGISTRATION_TRIGGERS = [
  'register', 'join', 'technician', 'provider', 'work', 'apply', 'signup', 'sign up',
  'ek wil werk', // Afrikaans: "I want to work"
  'ngifuna ukusebenza', // Zulu: "I want to work"
]

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleRegistrationFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'reg_collect_name':
      return handleCollectName(ctx)
    case 'reg_collect_skills':
      return handleCollectSkills(ctx)
    case 'reg_collect_area':
      return handleCollectArea(ctx)
    case 'reg_confirm':
      return handleConfirm(ctx)
    case 'reg_pending':
      return handlePending(ctx)
    default:
      return startRegistration(ctx)
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function startRegistration(ctx: FlowContext): Promise<FlowResult> {
  // Check if already registered or application pending
  const existing = await db.technicianApplication.findFirst({
    where: { phone: ctx.phone, businessId: ctx.businessId },
    orderBy: { submittedAt: 'desc' },
  })

  if (existing?.status === 'APPROVED') {
    await sendText(
      ctx.phone,
      "✅ You're already registered as a Plug a Pro technician! You'll receive job assignments through this number."
    )
    return { nextStep: 'done' }
  }

  if (existing?.status === 'PENDING') {
    await sendText(
      ctx.phone,
      `⏳ Your application is under review. We'll contact you within 24 hours.\n\nRef: *${existing.id.slice(-8).toUpperCase()}*`
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `👷 *Join Plug a Pro as a Service Provider*\n\nEarn money doing what you're good at. We connect you with customers who need your skills.\n\n*Here's how it works:*\n• We send you job leads in your area\n• You confirm availability and go do the job\n• We handle payment — you get paid reliably\n\nReady to apply?`,
    [
      { id: 'reg_start', title: '✅ Yes, Apply Now' },
      { id: 'reg_cancel', title: '❌ Not Now' },
    ]
  )
  return { nextStep: 'reg_collect_name' }
}

async function handleCollectName(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'reg_cancel') {
    await sendText(ctx.phone, "No problem! Send 'Join' anytime when you're ready to apply. 👋")
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
    await sendText(ctx.phone, 'Please type your full name.')
    return { nextStep: 'reg_collect_skills' }
  }

  const services = await db.service.findMany({
    where: { businessId: ctx.businessId, active: true },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  })

  const rows = services.map((s) => ({
    id: `skill_${s.category.toLowerCase().replace(/\s+/g, '_')}`,
    title: s.category,
  }))

  // Add "Other" option
  rows.push({ id: 'skill_other', title: 'Other / Multiple' })

  await sendList(
    ctx.phone,
    `Nice to meet you, *${name}*! 👋\n\nWhat type of work do you do?`,
    [{ title: 'Your Skills', rows }],
    { buttonLabel: 'Choose Skills', footer: 'Select your main skill' }
  )
  return { nextStep: 'reg_collect_area', nextData: { name } }
}

async function handleCollectArea(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('skill_')) {
    await sendText(ctx.phone, 'Please choose your skill from the list above.')
    return { nextStep: 'reg_collect_area' }
  }

  const skillLabel = ctx.reply.title ?? ''
  const skills = ctx.data.skills ? [...ctx.data.skills, skillLabel] : [skillLabel]

  // Get unique cities/provinces served by the business
  const areas = await db.serviceArea.findMany({
    where: { service: { businessId: ctx.businessId } },
    select: { city: true, province: true },
    distinct: ['city'],
  })

  const rows = [...new Map(areas.map((a) => [a.city, a])).values()].map((a) => ({
    id: `area_${a.city.toLowerCase().replace(/\s+/g, '_')}`,
    title: a.city.slice(0, 24),
    description: a.province,
  }))

  if (rows.length === 0) {
    rows.push({ id: 'area_gauteng', title: 'Gauteng', description: 'South Africa' })
    rows.push({ id: 'area_western_cape', title: 'Western Cape', description: 'South Africa' })
  }

  await sendList(
    ctx.phone,
    '📍 Which area do you work in?',
    [{ title: 'Areas', rows }],
    { buttonLabel: 'Choose Area' }
  )
  return { nextStep: 'reg_confirm', nextData: { skills } }
}

async function handleConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('area_')) {
    await sendText(ctx.phone, 'Please choose your area from the list above.')
    return { nextStep: 'reg_confirm' }
  }

  const areaLabel = ctx.reply.title ?? ''
  const serviceAreas = [areaLabel]

  const { name, skills } = ctx.data
  const skillList = (skills ?? []).join(', ')

  await sendButtons(
    ctx.phone,
    `📋 *Your Application Summary*\n\n👤 Name: *${name}*\n🔧 Skills: *${skillList}*\n📍 Area: *${areaLabel}*\n\nShall I submit your application?`,
    [
      { id: 'submit_yes', title: '✅ Submit' },
      { id: 'submit_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'reg_pending', nextData: { serviceAreas } }
}

async function handlePending(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'submit_no') {
    await sendText(ctx.phone, "Application cancelled. Send 'Join' anytime to apply. 👋")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id !== 'submit_yes') {
    return { nextStep: 'reg_pending' }
  }

  try {
    const application = await db.technicianApplication.create({
      data: {
        businessId: ctx.businessId,
        phone: ctx.phone,
        name: ctx.data.name ?? 'Unknown',
        skills: ctx.data.skills ?? [],
        serviceAreas: ctx.data.serviceAreas ?? [],
        status: 'PENDING',
      },
    })

    await sendText(
      ctx.phone,
      `🎉 *Application submitted!*\n\nThank you, *${ctx.data.name}*! We'll review your application and get back to you within *24 hours*.\n\nRef: *${application.id.slice(-8).toUpperCase()}*\n\nQuestions? Reply anytime. 👋`
    )

    // Notify admin of new application (non-blocking — ADMIN_WHATSAPP_NUMBER env var)
    const { sendAdminNewApplication } = await import('../whatsapp')
    sendAdminNewApplication({
      applicantName: ctx.data.name ?? 'Unknown',
      applicantPhone: ctx.phone,
      skills: ctx.data.skills ?? [],
      serviceAreas: ctx.data.serviceAreas ?? [],
      applicationId: application.id,
    }).catch(() => {}) // fire-and-forget

    return { nextStep: 'done' }
  } catch (err) {
    console.error('[registration-flow] Submit error:', err)
    await sendText(
      ctx.phone,
      '😔 Something went wrong. Please try again or contact us directly.'
    )
    return { nextStep: 'done' }
  }
}
