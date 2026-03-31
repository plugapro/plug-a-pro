// ─── Help / FAQ flow ──────────────────────────────────────────────────────────
// Accessible via main menu "❓ Get Help" or keywords "help", "question", etc.
// Designed for low-literacy users: plain language, button-driven, no dead ends.

import { sendButtons, sendList, sendText } from '../whatsapp-interactive'
import type { FlowContext, FlowResult } from './types'

const SUPPORT_PHONE = process.env.SUPPORT_WHATSAPP_NUMBER ?? ''

export const HELP_TRIGGERS = [
  'help', 'question', 'problem', 'issue', 'complaint', 'support',
  'hulp', // Afrikaans
  'usizo', // Zulu
]

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleHelpFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'help_menu':
      return handleHelpMenu(ctx)
    case 'help_faq':
      return handleFaqAnswer(ctx)
    default:
      return handleHelpMenu(ctx)
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleHelpMenu(ctx: FlowContext): Promise<FlowResult> {
  await sendList(
    ctx.phone,
    '❓ *Help & Support*\n\nWhat do you need help with?',
    [{
      title: 'Common Questions',
      rows: [
        { id: 'faq_cost',            title: '💰 Pricing & costs',    description: 'What does each service cost?' },
        { id: 'faq_areas',           title: '📍 Areas we cover',     description: 'Cities and suburbs we serve' },
        { id: 'faq_how_long',        title: '⏱ Job duration',        description: 'How long will the job take?' },
        { id: 'faq_cancel',          title: '❌ Cancellations',       description: 'Cancel a booking & refunds' },
        { id: 'faq_reschedule',      title: '🔄 Rescheduling',        description: 'Change your booking time' },
        { id: 'faq_payment',         title: '💳 How payment works',   description: 'Cards, EFT, and when to pay' },
        { id: 'faq_technician',      title: '👷 Our technicians',     description: 'Vetting and safety checks' },
        { id: 'faq_problem_with_job', title: '🚨 Problem with a job', description: 'Report an issue with a job' },
        { id: 'faq_contact_human',   title: '📞 Speak to a person',   description: 'Talk to our support team' },
      ],
    }],
    { buttonLabel: 'Choose Topic' }
  )
  return { nextStep: 'help_faq' }
}

async function handleFaqAnswer(ctx: FlowContext): Promise<FlowResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  switch (ctx.reply.id) {
    case 'faq_cost':
      await sendButtons(
        ctx.phone,
        `💰 *Pricing*\n\nPrices depend on the service:\n\n• Plumbing — from R 350\n• Electrical — from R 300\n• Cleaning — from R 450\n• Painting — from R 800\n\nYou will always see the price *before* you confirm your booking. No hidden fees.\n\nFor larger jobs, we will send you a quote first.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_areas':
      await sendButtons(
        ctx.phone,
        `📍 *Areas We Serve*\n\nWe currently operate in:\n\n• Johannesburg (Sandton, Randburg, Midrand, Soweto, Fourways)\n• Pretoria (Centurion, Hatfield, Sunnyside)\n• Cape Town (City Bowl, Northern Suburbs, Southern Suburbs)\n\nEnter your suburb when booking and we'll confirm availability. We're expanding! 🚀`,
        [
          { id: 'book', title: '🔧 Book Now' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_how_long':
      await sendButtons(
        ctx.phone,
        `⏱ *Job Duration*\n\nThis depends on the service:\n\n• Leak repair — 1–2 hours\n• Electrical fault finding — 1–3 hours\n• Regular clean — 2–4 hours\n• Deep clean — 4–6 hours\n\nYour technician will let you know if the job will take longer and get your approval before continuing.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_cancel':
      await sendButtons(
        ctx.phone,
        `❌ *Cancellation Policy*\n\n• Cancel *24h or more* before your booking — full refund\n• Cancel *less than 24h* before — 50% cancellation fee\n• No-show — no refund\n\nTo cancel, tap the button below or reply "cancel".`,
        [
          { id: 'start_cancel', title: '❌ Cancel My Booking' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_reschedule':
      await sendButtons(
        ctx.phone,
        `🔄 *Rescheduling*\n\nYou can reschedule your booking for free up to *6 hours* before your appointment.\n\nTap below to choose a new time.`,
        [
          { id: 'start_reschedule', title: '🔄 Reschedule Booking' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_payment':
      await sendButtons(
        ctx.phone,
        `💳 *How Payment Works*\n\nWe accept:\n• Credit & debit card (Visa / Mastercard)\n• Instant EFT\n\nYou pay *online when booking*. Your booking is only confirmed once payment is received.\n\nFor quote-based jobs, we send you the quote first — you only pay after you accept it.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_technician':
      await sendButtons(
        ctx.phone,
        `👷 *Our Technicians*\n\nAll Plug a Pro technicians are:\n\n✅ ID-verified\n✅ Skill-assessed\n✅ Rated by previous customers\n\nWe never share your contact details directly with technicians. All communication goes through the app for your safety.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_problem_with_job':
      await sendText(
        ctx.phone,
        `🚨 *Problem with a Job*\n\nWe take quality seriously. If something went wrong:\n\n1. Reply with a description of the issue\n2. Include a photo if possible\n3. We'll follow up within 2 hours\n\nFor urgent issues, contact us directly:${SUPPORT_PHONE ? `\n📞 ${SUPPORT_PHONE}` : ''}`
      )
      return { nextStep: 'done' }

    case 'faq_contact_human':
      if (SUPPORT_PHONE) {
        await sendText(
          ctx.phone,
          `📞 *Speak to a Person*\n\nYou can reach our support team at:\n${SUPPORT_PHONE}\n\nOperating hours: Mon–Fri 8am–6pm, Sat 8am–2pm`
        )
      } else {
        await sendText(
          ctx.phone,
          `📞 *Support*\n\nReply to this message and our team will get back to you within 2 hours.\n\nOperating hours: Mon–Fri 8am–6pm, Sat 8am–2pm`
        )
      }
      return { nextStep: 'done' }

    case 'back_to_help':
      return handleHelpMenu(ctx)

    case 'start_cancel':
      return { nextStep: 'cancel_confirm' as never }

    case 'start_reschedule':
      return { nextStep: 'reschedule_reason' as never }

    default:
      return handleHelpMenu(ctx)
  }
}
