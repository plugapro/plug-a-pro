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
        { id: 'faq_technician',      title: '👷 Our providers',       description: 'How profiles and records work' },
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
        `💰 *Pricing*\n\nPrices depend on the job and the provider.\n\nWe always send a written quote before anything starts — you approve the price before confirming.\n\nAny extra work is quoted and approved separately before the provider continues.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_areas':
      await sendButtons(
        ctx.phone,
        `📍 *Areas We Serve*\n\nWe're launching in Johannesburg and Pretoria, with more cities coming soon.\n\nTell us your suburb when booking and we'll check if we have providers near you. If we're not in your area yet, we'll add you to the waitlist and let you know when we arrive. 🚀`,
        [
          { id: 'book', title: '🔧 Book Now' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_how_long':
      await sendButtons(
        ctx.phone,
        `⏱ *Job Duration*\n\nDuration depends on the job and the provider. Typical ranges:\n\n• Leak repair — 1–2 hours\n• Electrical fault finding — 1–3 hours\n• Regular clean — 2–4 hours\n• Deep clean — 4–6 hours\n\nThe provider will let you know if the job will take longer, and must get your approval before continuing.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_cancel':
      await sendButtons(
        ctx.phone,
        `❌ *Cancellation Help*\n\nSend a cancellation request through Plug A Pro and we’ll stop the job on the platform.\n\nIf you paid online, our team reviews your case against the booking stage and payment method and aims to respond within 2 business hours. Refund eligibility depends on when you cancel and whether work has started — we’ll walk you through the options.\n\nTo cancel, tap the button below or reply "cancel".`,
        [
          { id: 'start_cancel', title: '❌ Cancel My Booking' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_reschedule':
      await sendButtons(
        ctx.phone,
        `🔄 *Rescheduling*\n\nTell us why you need to move the booking and the new availability that works for you.\n\nPlug A Pro will log the request and confirm the updated time with you through the platform.`,
        [
          { id: 'start_reschedule', title: '🔄 Reschedule Booking' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_payment':
      await sendButtons(
        ctx.phone,
        `💳 *How Payment Works*\n\nDuring our launch phase, payment is arranged after your quote is accepted and confirmed with the provider.\n\nFor some jobs we may send an online payment link. For others, Plug A Pro support will confirm the payment method with you directly.\n\nFor quote-based jobs, we always send the quote first so you can approve the price before anything moves ahead.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_technician':
      await sendButtons(
        ctx.phone,
        `👷 *Our Providers*\n\nPlug A Pro shows provider profiles, completed job history, and customer ratings where those records exist on the platform.\n\nProfile details such as skills and service areas come from the provider unless a field says it was checked by Plug A Pro.\n\nWe keep the early quote and update flow on the platform so there is a written record of what was agreed.`,
        [
          { id: 'book', title: '🔧 Book a Service' },
          { id: 'back_to_help', title: '← Back to Help' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_problem_with_job':
      await sendButtons(
        ctx.phone,
        `🚨 *Problem with a Job*\n\nReply with a description of the issue — include a photo if possible. We'll follow up within 2 hours.${SUPPORT_PHONE ? `\n\nUrgent? 📞 ${SUPPORT_PHONE}` : ''}`,
        [
          { id: 'back_to_help', title: '← Back to Help' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
      return { nextStep: 'help_faq' }

    case 'faq_contact_human':
      await sendButtons(
        ctx.phone,
        SUPPORT_PHONE
          ? `📞 *Speak to a Person*\n\n${SUPPORT_PHONE}\nMon–Fri 8am–6pm, Sat 8am–2pm`
          : `📞 *Support*\n\nReply to this message — our team gets back within 2 hours.\nMon–Fri 8am–6pm, Sat 8am–2pm`,
        [
          { id: 'back_to_help', title: '← More Questions' },
          { id: 'back_home', title: '🏠 Main Menu' },
        ]
      )
      return { nextStep: 'help_faq' }

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
