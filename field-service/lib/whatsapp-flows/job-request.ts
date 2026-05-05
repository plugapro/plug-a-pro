// ─── Customer job request flow via WhatsApp ───────────────────────────────────
// Full journey: browse categories → name → street → province → city → region
//               → suburb → confirm address → availability → confirm → submitted
//
// Province/city/region/suburb are always selected from controlled lists.
// Only street-level fields (addressLine1) remain free text.
// Postal code is derived from the selected suburb node, never typed.

import {
  sendText,
  sendButtons,
  sendList,
  sendCtaUrl,
  type ListRow,
} from '../whatsapp-interactive'
import { db } from '../db'
import { resolveCategoryRequirements } from '../category-config'
import { createJobRequest } from '../job-requests/create-job-request'
import { downloadAndStoreWhatsAppMedia } from '../whatsapp-media'
import {
  isInActiveServiceArea,
  isActiveProvince,
  isActiveCity,
  isActiveRegion,
  addToServiceAreaWaitlist,
} from '../service-area-guard'
import {
  getProvinces,
  getCities,
  getRegions,
  getSuburbs,
  getStructuredAddressSelection,
} from '../location-nodes'
import {
  resolveStructuredAddressCapture,
  InvalidStructuredAddressError,
} from '../structured-address'
import {
  phoneLookupVariants,
  resolveWhatsAppIdentity,
  type WhatsAppSavedAddress,
} from '../whatsapp-identity'
import { createTraceId } from '../support-diagnostics'
import { JOURNEY_RECOVERY_COPY, sendWhatsAppJourneyRecovery } from '../journey-recovery'
import {
  mapAvailabilityToUrgency,
  preferenceLabel,
  providerPreferenceFromReply,
} from '../client-request-data'
import {
  DuplicateActiveRequestError,
  JobRequestPhotoLinkError,
} from '../job-requests/create-job-request'
import type { ConversationData, FlowContext, FlowResult } from './types'

// Static category list — replaces db.service queries
const JOB_CATEGORIES = [
  { id: 'cat_plumbing',       label: 'Plumbing' },
  { id: 'cat_painting',       label: 'Painting' },
  { id: 'cat_garden',         label: 'Garden & Landscaping' },
  { id: 'cat_handyman',       label: 'Handyman' },
  { id: 'cat_appliances',     label: 'Appliances' },
  { id: 'cat_electrical',     label: 'Electrical' },
  { id: 'cat_diy',            label: 'DIY & Assembly' },
  { id: 'cat_roofing',        label: 'Roofing' },
  { id: 'cat_cleaning',       label: 'Cleaning' },
  { id: 'cat_tiling',         label: 'Tiling' },
  { id: 'cat_pest_control',   label: 'Pest Control' },
  { id: 'cat_carpentry',      label: 'Carpentry' },
  { id: 'cat_waterproofing',  label: 'Waterproofing' },
  { id: 'cat_air_conditioning', label: 'Air Conditioning' },
]

const STREET_ADDRESS_RETRY =
  "We couldn't save that address. Please send the street address again, for example: 14 Main Street."
const STREET_ADDRESS_SAVED_NEXT_STEP_RETRY =
  "We saved that street address. Please reply *continue* and we'll show the province list again."
const STREET_ADDRESS_SEND_TIMEOUT_MS = Number(process.env.WHATSAPP_STREET_ADDRESS_SEND_TIMEOUT_MS) || 8000
// Mirror the bot-level TTL floor so persistStreetAddressProgress sets an expiry
// that's consistent with what whatsapp-bot.ts writes on every other save.
// Cannot import the constant from whatsapp-bot.ts (circular dependency).
const ADDR_STEP_TTL_MS = Math.max(Number(process.env.WHATSAPP_SESSION_TIMEOUT_MS) || 30 * 60 * 1000, 30 * 60 * 1000)

// WhatsApp list cap is 10 rows total per message.
// When paging is needed we use 8 item rows + up to 2 nav rows.
const PAGE_SIZE = 8
function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function applicationRef(id: string) {
  return id.slice(-8).toUpperCase()
}

function maskedPhone(phone: string) {
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`
}

function validateStreetAddress(input: string | undefined) {
  const street = input?.trim().replace(/\s+/g, ' ')
  if (!street) return { ok: false as const, street: '', reason: 'empty' }
  if (street.length < 3) return { ok: false as const, street, reason: 'too_short' }
  return { ok: true as const, street, reason: 'valid' }
}

async function withStreetStepSendTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('street_address_next_step_send_timeout')),
          STREET_ADDRESS_SEND_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function persistStreetAddressProgress(ctx: FlowContext, street: string): Promise<ConversationData> {
  const nextData = { ...ctx.data, addressLine1: street, addressStreet: street, addrPage: 0 }

  // Persist before sending the next WhatsApp prompt. Serverless outbound sends
  // can fail, hang, or be retried independently; the request draft must already
  // be advanced so the next inbound message resumes the active request instead
  // of falling back to the generic menu.
  await db.conversation.upsert({
    where: { phone: ctx.phone },
    create: {
      phone: ctx.phone,
      flow: 'job_request',
      step: 'addr_select_province',
      // Prisma's recursive Json type is not structurally compatible with
      // ConversationData at compile time — cast required on all Json field writes.
      data: nextData as any,
      expiresAt: new Date(Date.now() + ADDR_STEP_TTL_MS),
    },
    update: {
      flow: 'job_request',
      step: 'addr_select_province',
      data: nextData as any, // same Prisma Json type reason
      expiresAt: new Date(Date.now() + ADDR_STEP_TTL_MS),
    },
  })

  return nextData
}

function savedAddressDisplay(address: Pick<WhatsAppSavedAddress, 'addressLine1' | 'street' | 'suburb' | 'city' | 'province'>) {
  return [
    address.addressLine1 ?? address.street,
    address.suburb,
    address.city,
    address.province,
  ].filter(Boolean).join(', ')
}

function savedAddressShortLabel(address: Pick<WhatsAppSavedAddress, 'addressLine1' | 'street' | 'suburb'>) {
  return [address.addressLine1 ?? address.street, address.suburb].filter(Boolean).join(', ').slice(0, 24)
}

async function savedAddressToConversationData(address: WhatsAppSavedAddress) {
  if (!address.locationNodeId) return null

  const selection = await getStructuredAddressSelection(address.locationNodeId)
  if (!selection) return null

  const streetLine = address.addressLine1 ?? address.street
  const display = [streetLine, selection.suburb, selection.city].filter(Boolean).join(', ')

  return {
    addressLine1: streetLine,
    addrLocationNodeId: address.locationNodeId,
    addrCityLabel: selection.city,
    addrSuburbLabel: selection.suburb,
    addrRegionLabel: selection.region,
    addrProvinceLabel: selection.province,
    addrPostalCode: selection.postalCode,
    address: display,
    hasSavedAddress: true,
  }
}

// ─── Paging helper ────────────────────────────────────────────────────────────

/**
 * Slices an item list for one WhatsApp list page and appends navigation rows.
 * When items.length <= 10 no paging is applied.
 */
function buildPagedRows<T extends { id: string; label: string }>(
  items: T[],
  page: number,
  idPrefix: string,
): { rows: ListRow[]; totalPages: number } {
  if (items.length <= 10) {
    return {
      rows: items.map((item) => ({ id: `${idPrefix}__${item.id}`, title: item.label.slice(0, 24) })),
      totalPages: 1,
    }
  }

  const totalPages = Math.ceil(items.length / PAGE_SIZE)
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1))
  const start = clampedPage * PAGE_SIZE
  const pageItems = items.slice(start, start + PAGE_SIZE)
  const hasNext = start + PAGE_SIZE < items.length
  const hasPrev = clampedPage > 0

  const rows: ListRow[] = pageItems.map((item) => ({
    id: `${idPrefix}__${item.id}`,
    title: item.label.slice(0, 24),
  }))

  if (hasPrev) rows.push({ id: `${idPrefix}_prev`, title: '← Previous' })
  if (hasNext) rows.push({ id: `${idPrefix}_next`, title: 'Next →' })

  return { rows, totalPages }
}

// ─── List-render helpers ──────────────────────────────────────────────────────

const AREA_NOT_LISTED_ROW = { id: 'area_not_listed', title: '🔔 My area isn\'t listed' }

async function renderProvinceList(phone: string): Promise<void> {
  const provinces = await getProvinces()
  const active = provinces.filter((p) => isActiveProvince(p.slug))
  if (active.length === 0) {
    // Location nodes not yet seeded — sending an empty list section fails at the Meta API level.
    // Surface the "area not listed" path so the user is captured on the waitlist.
    await sendText(
      phone,
      `📍 We're expanding our coverage soon! We don't have selectable provinces set up yet.\n\nReply *area not listed* and we'll add you to the waitlist to be notified when we launch in your area.`,
    )
    return
  }
  const rows = active.map((p) => ({ id: `prov__${p.slug}`, title: p.label.slice(0, 24) }))
  await sendList(
    phone,
    '🏙 *Select your province:*',
    [{ title: 'Available now', rows }, { title: 'Coming soon', rows: [AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose Province' },
  )
}

async function renderCityList(
  phone: string,
  provinceKey: string,
  provinceLabel: string,
  page: number,
): Promise<boolean> {
  const cities = await getCities(provinceKey)
  const active = cities.filter((c) => isActiveCity(c.cityKey))
  if (active.length === 0) return false
  const { rows, totalPages } = buildPagedRows(active, page, 'city')
  const pageNote = totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''
  await sendList(
    phone,
    `📍 *Select your city* in ${provinceLabel}${pageNote}:`,
    [{ title: 'Available now', rows }, { title: 'Coming soon', rows: [AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose City' },
  )
  return true
}

async function renderRegionList(
  phone: string,
  cityId: string,
  cityLabel: string,
  page: number,
): Promise<boolean> {
  const regions = await getRegions(cityId)
  const active = regions.filter((r) => isActiveRegion(r.regionKey))
  if (active.length === 0) return false
  const { rows, totalPages } = buildPagedRows(active, page, 'rgn')
  const pageNote = totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''
  await sendList(
    phone,
    `🗺 *Select your area* in ${cityLabel}${pageNote}:`,
    [{ title: 'Available now', rows }, { title: 'Coming soon', rows: [AREA_NOT_LISTED_ROW] }],
    { buttonLabel: 'Choose Area' },
  )
  return true
}

async function renderSuburbList(
  phone: string,
  regionId: string,
  regionLabel: string,
  page: number,
): Promise<boolean> {
  const suburbs = await getSuburbs(regionId)
  if (suburbs.length === 0) return false
  const { rows, totalPages } = buildPagedRows(suburbs, page, 'sub')
  const pageNote = totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''
  await sendList(
    phone,
    `🏘 *Select your suburb* in ${regionLabel}${pageNote}:`,
    [{ rows }],
    { buttonLabel: 'Choose Suburb' },
  )
  return true
}

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleJobRequestFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'welcome':
      return handleWelcome(ctx)
    case 'browse_categories':
      return handleBrowseCategories(ctx)
    case 'collect_name':
      return handleCollectNameStep(ctx)
    case 'collect_address':
      return handleCollectAddress(ctx)
    case 'collect_site':
      return handleCollectSite(ctx)
    case 'collect_address_street':
      return handleCollectStreet(ctx)
    // Structured location selection
    case 'addr_select_province':
      return handleAddrSelectProvince(ctx)
    case 'addr_select_city':
      return handleAddrSelectCity(ctx)
    case 'addr_select_region':
      return handleAddrSelectRegion(ctx)
    case 'addr_select_suburb':
      return handleAddrSelectSuburb(ctx)
    case 'addr_confirm':
      return handleAddrConfirm(ctx)
    // Legacy steps — handled only for in-flight conversations at deploy time
    case 'collect_address_suburb':
      return handleLegacyCollectSuburb(ctx)
    case 'confirm_address':
      return handleLegacyConfirmAddress(ctx)
    case 'collect_issue_description':
      return handleCollectIssueDescription(ctx)
    case 'collect_availability':
      return handleCollectAvailability(ctx)
    case 'collect_request_preferences':
      return handleCollectRequestPreferences(ctx)
    case 'collect_budget_preference':
      return handleCollectBudgetPreference(ctx)
    case 'confirm_job_request':
      return handleConfirmJobRequest(ctx)
    case 'collect_photos':
      return handleCollectPhotos(ctx)
    case 'job_request_submitted':
      return handleJobRequestSubmitted(ctx)
    case 'notify_me':
      return handleNotifyMe(ctx)
    default:
      await showMainMenu(ctx.phone)
      return { nextStep: 'welcome' }
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleWelcome(ctx: FlowContext): Promise<FlowResult> {
  await showMainMenu(ctx.phone)
  return { nextStep: 'welcome' }
}

async function handleBrowseCategories(ctx: FlowContext): Promise<FlowResult> {
  // If the user selected a category, delegate immediately to name-capture step.
  if (ctx.reply.id?.startsWith('cat_') && ctx.reply.id !== 'cat_prev' && ctx.reply.id !== 'cat_next') {
    return handleCollectNameStep({ ...ctx, step: 'collect_name' })
  }

  // Determine which page to show.
  let page = ctx.data.addrPage ?? 0
  if (ctx.reply.id === 'cat_prev') page = Math.max(0, page - 1)
  else if (ctx.reply.id === 'cat_next') page = page + 1

  // WhatsApp hard-caps list messages at 10 rows total (across all sections).
  // We use 8 item slots + up to 2 nav rows, matching PAGE_SIZE.
  const totalPages = Math.ceil(JOB_CATEGORIES.length / PAGE_SIZE)
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1))
  const pageItems = JOB_CATEGORIES.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)
  const hasPrev = clampedPage > 0
  const hasNext = (clampedPage + 1) * PAGE_SIZE < JOB_CATEGORIES.length

  const rows: ListRow[] = pageItems.map((c) => ({ id: c.id, title: c.label.slice(0, 24) }))
  if (hasPrev) rows.push({ id: 'cat_prev', title: '← Previous' })
  if (hasNext) rows.push({ id: 'cat_next', title: 'Next →' })

  const pageNote = totalPages > 1 ? ` (${clampedPage + 1}/${totalPages})` : ''
  await sendList(
    ctx.phone,
    `What type of service do you need? 👇${pageNote}`,
    [{ title: 'Our Services', rows }],
    { buttonLabel: 'Choose Service' },
  )

  return { nextStep: 'browse_categories', nextData: { addrPage: clampedPage } }
}

// ─── Name capture ─────────────────────────────────────────────────────────────

async function handleCollectNameStep(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id?.startsWith('cat_')) {
    const categoryEntry = JOB_CATEGORIES.find((c) => c.id === ctx.reply.id)
    const category = categoryEntry?.label ?? ctx.reply.title ?? ''

    const identity = await resolveWhatsAppIdentity(ctx.phone)
    if ((identity.role === 'provider' || identity.role === 'provider_pending' || identity.role === 'provider_inactive') && !identity.customerId) {
      await sendText(
        ctx.phone,
        `This number is registered as a Plug A Pro provider.\n\nFor now, provider and customer profiles must use separate WhatsApp numbers.\n\nPlease request a service using a different number.`
      )
      await showMainMenu(ctx.phone)
      return { nextStep: 'done' }
    }

    const PLACEHOLDER_NAMES = new Set(['WhatsApp Customer', 'Customer'])
    const isKnownCustomer = Boolean(identity.customerId)
    const knownCustomerName = identity.customerDisplayName ?? identity.displayName
    const knownCustomerFirstName = identity.customerFirstName ?? firstName(knownCustomerName)
    const hasUsableName = Boolean(knownCustomerName && !PLACEHOLDER_NAMES.has(knownCustomerName))
    const isFirstBooking = !isKnownCustomer || !hasUsableName

    if (!isFirstBooking) {
      console.info('[job-request-flow] returning customer recognized; skipping name step', {
        traceId: identity.traceId,
        phone: maskedPhone(ctx.phone),
        customerId: identity.customerId,
        savedAddressCount: identity.savedAddresses.length,
        roleConflict: identity.conflict,
      })
      const baseData = {
        selectedCategory: category,
        category,
        customerId: identity.customerId,
        customerName: knownCustomerName,
        isFirstBooking: false,
      }

      const savedAddresses = identity.savedAddresses
      if (savedAddresses.length > 1) {
        await sendList(
          ctx.phone,
          `Welcome back, ${knownCustomerFirstName}.\n\nWhich site is this ${category} service for?`,
          [{
            title: 'Saved addresses',
            rows: [
              ...savedAddresses.slice(0, 9).map((address) => ({
                id: `addr_saved_${address.id}`,
                title: savedAddressShortLabel(address) || 'Saved address',
                description: savedAddressDisplay(address).slice(0, 72),
              })),
              { id: 'addr_new', title: 'Add new address' },
            ],
          }],
          { buttonLabel: 'Choose Address' },
        )
        return { nextStep: 'collect_address', nextData: baseData }
      }

      const savedAddress = savedAddresses[0]
      if (savedAddress) {
        const addressData = await savedAddressToConversationData(savedAddress)
        if (addressData) {
          await sendButtons(
            ctx.phone,
            `Welcome back, ${knownCustomerFirstName}.\n\nIs this service for your saved address?\n\n_${savedAddressDisplay(savedAddress)}_`,
            [
              { id: 'addr_same', title: 'Yes, use this' },
              { id: 'addr_new', title: 'Add new address' },
            ]
          )
          return { nextStep: 'collect_address', nextData: { ...baseData, ...addressData, savedAddressId: savedAddress.id } }
        }
      }

      // Legacy address (no locationNodeId) or unresolvable node — force new entry
      await sendText(
        ctx.phone,
        `Welcome back, ${knownCustomerFirstName}.\n\nNo saved structured address is ready for this request yet.\n\n📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
      )
      return { nextStep: 'collect_address_street', nextData: baseData }
    }

    await sendText(ctx.phone, '👤 What is your *first name*?\n\n_(Just your first name is fine — e.g. "Annah")_')
    return {
      nextStep: 'collect_name',
      nextData: { selectedCategory: category, category, isFirstBooking: true, addrPage: undefined },
    }
  }

  // They sent their name as text
  const text = ctx.reply.text?.trim()
  if (!text || text.length < 2) {
    await sendText(ctx.phone, '👤 What is your *first name*?\n\n_(Just your first name is fine — e.g. "Annah")_')
    return { nextStep: 'collect_name' }
  }

  await db.customer.updateMany({
    where: { phone: ctx.phone, name: { in: ['WhatsApp Customer', 'Customer'] } },
    data: { name: text },
  })

  // After capturing the name, check for saved addresses so first-booking
  // customers with existing Address records can reuse a site instead of
  // re-entering their address from scratch.
  return handleCollectSite({
    ...ctx,
    step: 'collect_site',
    // Inject a synthetic "name entered" reply so the handler knows to show
    // the site picker prompt rather than process a list selection.
    reply: { ...ctx.reply, id: 'collect_site_start', text: undefined },
    data: { ...ctx.data, customerName: text },
  })
}

// ─── Address collection ───────────────────────────────────────────────────────

/**
 * Multi-site picker — shown to first-booking customers who already have saved
 * Address records (e.g. created via the web portal or a previous booking on a
 * different channel).
 *
 * Entry conditions:
 *  - reply.id === 'collect_site_start'  → show the picker (or fall through if 0 addresses)
 *  - reply.id === 'site_new'            → customer wants to enter a new address
 *  - reply.id starts with 'site:'       → customer selected a saved address
 */
async function handleCollectSite(ctx: FlowContext): Promise<FlowResult> {
  const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
  const customerName = ctx.data.customerName ?? 'there'

  // ── Entry — show the picker (or fall through) ─────────────────────────────
  if (ctx.reply.id === 'collect_site_start') {
    // Look up addresses for this customer.  customerId may not be in ctx.data
    // yet for a first-booking user, so resolve via phone.
    const customer = await db.customer.findFirst({
      where: { phone: { in: phoneLookupVariants(ctx.phone) } },
      select: {
        id: true,
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          take: 9, // leave one slot for the "Enter new address" row (WA cap = 10)
          select: {
            id: true,
            label: true,
            street: true,
            addressLine1: true,
            suburb: true,
            city: true,
            locationNodeId: true,
            isDefault: true,
          },
        },
      },
    })

    if (!customer || customer.addresses.length === 0) {
      // No saved addresses — skip the site picker entirely and go straight to
      // manual street entry (unchanged legacy path).
      await sendText(
        ctx.phone,
        `Nice to meet you, *${customerName}*! 👋\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
      )
      return { nextStep: 'collect_address_street', nextData: { customerId: customer?.id } }
    }

    const rows: ListRow[] = [
      ...customer.addresses.map((a) => ({
        id: `site:${a.id}`,
        title: (a.label ?? (savedAddressShortLabel(a as Parameters<typeof savedAddressShortLabel>[0]) || 'Saved address')).slice(0, 24),
        description: `${a.addressLine1 ?? a.street}, ${a.suburb}`.slice(0, 72),
      })),
      { id: 'site_new', title: 'Enter a new address', description: 'Type my address manually' },
    ]

    await sendList(
      ctx.phone,
      `Nice to meet you, *${customerName}*! 👋\n\nWhich site is this *${category}* service for?`,
      [{ title: 'Saved sites', rows }],
      { buttonLabel: 'Choose Site' },
    )
    return { nextStep: 'collect_site', nextData: { customerId: customer.id } }
  }

  // ── Customer chose "Enter a new address" ─────────────────────────────────
  if (ctx.reply.id === 'site_new') {
    await sendText(
      ctx.phone,
      `📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
    )
    return { nextStep: 'collect_address_street' }
  }

  // ── Customer selected a saved site ────────────────────────────────────────
  if (ctx.reply.id?.startsWith('site:')) {
    const addressId = ctx.reply.id.slice('site:'.length)
    const customerId = ctx.data.customerId

    const address = await db.address.findFirst({
      where: { id: addressId, ...(customerId ? { customerId } : {}) },
    })

    if (!address) {
      await sendText(ctx.phone, '❗ I could not find that saved address. Please choose again or add a new one.')
      return { nextStep: 'collect_site' }
    }

    const addressData = await savedAddressToConversationData(address as WhatsAppSavedAddress)
    if (!addressData) {
      await sendText(
        ctx.phone,
        `That saved address needs to be re-confirmed.\n\n📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
      )
      return { nextStep: 'collect_address_street' }
    }

    // Address resolved — skip straight to issue description (same as collect_address with addr_saved_*)
    return handleCollectIssueDescription({
      ...ctx,
      data: { ...ctx.data, ...addressData, savedAddressId: addressId },
    })
  }

  // ── Unknown reply — resend the site picker ────────────────────────────────
  // Re-enter via a synthetic start reply so the DB lookup runs again.
  return handleCollectSite({
    ...ctx,
    reply: { ...ctx.reply, id: 'collect_site_start', text: undefined },
  })
}

async function handleCollectAddress(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_same') {
    // addrLocationNodeId + addressLine1 are already in ctx.data — collect issue description next
    return handleCollectIssueDescription(ctx)
  }

  if (ctx.reply.id?.startsWith('addr_saved_')) {
    const addressId = ctx.reply.id.slice('addr_saved_'.length)
    const address = await db.address.findFirst({
      where: { id: addressId, customerId: ctx.data.customerId },
    })

    if (!address) {
      await sendText(ctx.phone, '❗ I could not find that saved address. Please choose another address or add a new one.')
      return { nextStep: 'collect_address' }
    }

    const addressData = await savedAddressToConversationData(address as WhatsAppSavedAddress)
    if (!addressData) {
      const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
      await sendText(
        ctx.phone,
        `That saved address needs to be re-confirmed.\n\n📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
      )
      return { nextStep: 'collect_address_street' }
    }

    return handleCollectIssueDescription({
      ...ctx,
      data: { ...ctx.data, ...addressData, savedAddressId: addressId },
    })
  }

  // addr_new or any other reply — start new structured address entry
  const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
  await sendText(
    ctx.phone,
    `📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
  )
  return { nextStep: 'collect_address_street' }
}

async function handleCollectStreet(ctx: FlowContext): Promise<FlowResult> {
  const validation = validateStreetAddress(ctx.reply.text)
  const logContext = {
    traceId: createTraceId('street'),
    phone: maskedPhone(ctx.phone),
    flow: ctx.flow,
    step: ctx.step,
    // jobRequestId is only populated after submission — null here is expected
    draftId: ctx.data.savedAddressId ?? null,
  }

  console.info('[job-request-flow] street address response received', {
    ...logContext,
    validation: validation.reason,
  })

  if (!validation.ok) {
    console.info('[job-request-flow] street address validation failed', {
      ...logContext,
      errorCode: `street_address_${validation.reason}`,
    })
    await sendText(ctx.phone, 'Please send your street address, for example: 14 Main Street.')
    return { nextStep: 'collect_address_street' }
  }

  let nextData: ConversationData
  try {
    nextData = await persistStreetAddressProgress(ctx, validation.street)
    console.info('[job-request-flow] street address saved', {
      ...logContext,
      nextStep: 'addr_select_province',
    })
  } catch (err) {
    console.error('[job-request-flow] street address save failed', {
      ...logContext,
      errorCode: 'street_address_save_failed',
      error: err instanceof Error ? err.message : String(err),
    })
    await sendText(ctx.phone, STREET_ADDRESS_RETRY)
    return { nextStep: 'collect_address_street' }
  }

  try {
    console.info('[job-request-flow] street address accepted; sending next step', {
      ...logContext,
      nextStep: 'addr_select_province',
    })
    await withStreetStepSendTimeout(renderProvinceList(ctx.phone))
    console.info('[job-request-flow] street address next step sent', {
      ...logContext,
      nextStep: 'addr_select_province',
    })
  } catch (err) {
    // Root cause guard: this step used to wait for the province-list send before
    // the conversation save happened. If Meta/list delivery hung or failed, the
    // customer's valid street text was never persisted and a later "Hi" could
    // fall through to the generic menu. Keep the user on the same step and send
    // a plain-text retry instead of failing silently.
    console.error('[job-request-flow] street address next step failed', {
      ...logContext,
      errorCode: 'street_address_next_step_send_failed',
      error: err instanceof Error ? err.message : String(err),
    })
    await sendText(ctx.phone, STREET_ADDRESS_SAVED_NEXT_STEP_RETRY)
    console.info('[job-request-flow] street address error response sent', {
      ...logContext,
      errorCode: 'street_address_next_step_send_failed',
    })
    return {
      nextStep: 'addr_select_province',
      nextData,
    }
  }

  return {
    nextStep: 'addr_select_province',
    nextData,
  }
}

// ─── Structured province / city / region / suburb selection ───────────────────

async function handleAddrSelectProvince(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: 'Outside Gauteng',
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(
      ctx.phone,
      `Thanks for your interest! 🙏\n\n` +
      `Plug A Pro is currently only available in *Gauteng*, but we're expanding fast.\n\n` +
      `We've noted your details and will send you a WhatsApp the moment we go live in your area. No action needed from you! 🚀`,
    )
    return { nextStep: 'done' }
  }

  if (ctx.reply.id?.startsWith('prov__')) {
    const provinceSlug = ctx.reply.id.slice(6) // strip 'prov__'
    const provinces = await getProvinces()
    const selected = provinces.find((p) => p.slug === provinceSlug)

    if (!selected) {
      await sendText(ctx.phone, '❗ Please *choose from the list* above.')
      await renderProvinceList(ctx.phone)
      return { nextStep: 'addr_select_province' }
    }

    const ok = await renderCityList(ctx.phone, provinceSlug, selected.label, 0)
    if (!ok) {
      await sendText(ctx.phone, `😔 No cities available in *${selected.label}* yet. Please choose a different province.`)
      await renderProvinceList(ctx.phone)
      return { nextStep: 'addr_select_province' }
    }

    return {
      nextStep: 'addr_select_city',
      nextData: { addrProvinceKey: provinceSlug, addrProvinceLabel: selected.label, addrPage: 0 },
    }
  }

  // Text reply or unknown button — reject
  await sendText(ctx.phone, '❗ Please *choose from the list* above. Typed text is not accepted for province selection.')
  await renderProvinceList(ctx.phone)
  return { nextStep: 'addr_select_province' }
}

async function handleAddrSelectCity(ctx: FlowContext): Promise<FlowResult> {
  const provinceKey = ctx.data.addrProvinceKey ?? ''
  const provinceLabel = ctx.data.addrProvinceLabel ?? ''

  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: `${provinceLabel} - other`,
      province: provinceLabel,
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(
      ctx.phone,
      `Thanks for your interest! 🙏\n\n` +
      `We're currently only serving *Johannesburg* in ${provinceLabel}, but we're expanding soon.\n\n` +
      `We've saved your details and will send you a WhatsApp the moment we activate your city. No action needed! 🚀`,
    )
    return { nextStep: 'done' }
  }

  // Page navigation
  if (ctx.reply.id === 'city_prev' || ctx.reply.id === 'city_next') {
    const currentPage = ctx.data.addrPage ?? 0
    const newPage = ctx.reply.id === 'city_next' ? currentPage + 1 : Math.max(0, currentPage - 1)
    await renderCityList(ctx.phone, provinceKey, provinceLabel, newPage)
    return { nextStep: 'addr_select_city', nextData: { addrPage: newPage } }
  }

  if (ctx.reply.id?.startsWith('city__')) {
    const cityId = ctx.reply.id.slice(6) // strip 'city__'
    const cities = await getCities(provinceKey)
    const selected = cities.find((c) => c.id === cityId)

    if (!selected) {
      await sendText(ctx.phone, '❗ Please *choose from the list* above.')
      await renderCityList(ctx.phone, provinceKey, provinceLabel, ctx.data.addrPage ?? 0)
      return { nextStep: 'addr_select_city' }
    }

    // ── Service area gate ────────────────────────────────────────────────────
    if (!isInActiveServiceArea(selected.label)) {
      await addToServiceAreaWaitlist({
        phone: ctx.phone,
        name: ctx.data.customerName ?? null,
        category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
        city: selected.label,
        province: provinceLabel,
        source: 'whatsapp',
      }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))

      await sendText(
        ctx.phone,
        `Thank you for reaching out! 🙏\n\n` +
        `We're not in *${selected.label}* just yet, but we're expanding fast.\n\n` +
        `We've saved your contact and will send you a WhatsApp the moment Plug A Pro goes live in your area. ` +
        `No action needed from you. 🚀`,
      )
      return { nextStep: 'done' }
    }
    // ────────────────────────────────────────────────────────────────────────

    const ok = await renderRegionList(ctx.phone, selected.id, selected.label, 0)
    if (!ok) {
      await sendText(ctx.phone, `😔 No areas available in *${selected.label}* yet. Please choose a different city.`)
      await renderCityList(ctx.phone, provinceKey, provinceLabel, 0)
      return { nextStep: 'addr_select_city', nextData: { addrPage: 0 } }
    }

    return {
      nextStep: 'addr_select_region',
      nextData: { addrCityId: selected.id, addrCityLabel: selected.label, addrPage: 0 },
    }
  }

  // Text reply or unknown button — reject
  await sendText(ctx.phone, '❗ Please *choose from the list* above. Typed text is not accepted for city selection.')
  await renderCityList(ctx.phone, provinceKey, provinceLabel, ctx.data.addrPage ?? 0)
  return { nextStep: 'addr_select_city' }
}

async function handleAddrSelectRegion(ctx: FlowContext): Promise<FlowResult> {
  const cityId = ctx.data.addrCityId ?? ''
  const cityLabel = ctx.data.addrCityLabel ?? ''

  if (ctx.reply.id === 'area_not_listed') {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      city: cityLabel,
      province: ctx.data.addrProvinceLabel ?? null,
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))
    await sendText(
      ctx.phone,
      `Thanks for your interest! 🙏\n\n` +
      `We're currently only serving *JHB West* (Roodepoort, Florida, Little Falls and surrounding areas) in ${cityLabel}.\n\n` +
      `We're expanding to more ${cityLabel} areas soon — we've saved your details and will notify you via WhatsApp when your area goes live! 🚀`,
    )
    return { nextStep: 'done' }
  }

  // Page navigation
  if (ctx.reply.id === 'rgn_prev' || ctx.reply.id === 'rgn_next') {
    const currentPage = ctx.data.addrPage ?? 0
    const newPage = ctx.reply.id === 'rgn_next' ? currentPage + 1 : Math.max(0, currentPage - 1)
    await renderRegionList(ctx.phone, cityId, cityLabel, newPage)
    return { nextStep: 'addr_select_region', nextData: { addrPage: newPage } }
  }

  if (ctx.reply.id?.startsWith('rgn__')) {
    const regionId = ctx.reply.id.slice(5) // strip 'rgn__'
    const regions = await getRegions(cityId)
    const selected = regions.find((r) => r.id === regionId)

    if (!selected) {
      await sendText(ctx.phone, '❗ Please *choose from the list* above.')
      await renderRegionList(ctx.phone, cityId, cityLabel, ctx.data.addrPage ?? 0)
      return { nextStep: 'addr_select_region' }
    }

    const ok = await renderSuburbList(ctx.phone, selected.id, selected.label, 0)
    if (!ok) {
      await sendText(ctx.phone, `😔 No suburbs available in *${selected.label}* yet. Please choose a different area.`)
      await renderRegionList(ctx.phone, cityId, cityLabel, 0)
      return { nextStep: 'addr_select_region', nextData: { addrPage: 0 } }
    }

    return {
      nextStep: 'addr_select_suburb',
      nextData: { addrRegionId: selected.id, addrRegionLabel: selected.label, addrPage: 0 },
    }
  }

  // Text reply or unknown button — reject
  await sendText(ctx.phone, '❗ Please *choose from the list* above. Typed text is not accepted for area selection.')
  await renderRegionList(ctx.phone, cityId, cityLabel, ctx.data.addrPage ?? 0)
  return { nextStep: 'addr_select_region' }
}

async function handleAddrSelectSuburb(ctx: FlowContext): Promise<FlowResult> {
  const regionId = ctx.data.addrRegionId ?? ''
  const regionLabel = ctx.data.addrRegionLabel ?? ''

  // Page navigation
  if (ctx.reply.id === 'sub_prev' || ctx.reply.id === 'sub_next') {
    const currentPage = ctx.data.addrPage ?? 0
    const newPage = ctx.reply.id === 'sub_next' ? currentPage + 1 : Math.max(0, currentPage - 1)
    await renderSuburbList(ctx.phone, regionId, regionLabel, newPage)
    return { nextStep: 'addr_select_suburb', nextData: { addrPage: newPage } }
  }

  if (ctx.reply.id?.startsWith('sub__')) {
    const suburbId = ctx.reply.id.slice(5) // strip 'sub__'
    const selection = await getStructuredAddressSelection(suburbId)

    if (!selection) {
      await sendText(ctx.phone, '❗ Please *choose from the list* above.')
      await renderSuburbList(ctx.phone, regionId, regionLabel, ctx.data.addrPage ?? 0)
      return { nextStep: 'addr_select_suburb' }
    }

    const streetLine = ctx.data.addressLine1 ?? ctx.data.addressStreet ?? ''
    const addressDisplay = [streetLine, selection.suburb, selection.region, selection.city].filter(Boolean).join(', ')

    await sendButtons(
      ctx.phone,
      `📍 *Your address:*\n\n🏠 ${streetLine}\n🏘 ${selection.suburb}, ${selection.region}\n🏙 ${selection.city}, ${selection.province} ${selection.postalCode}\n\nIs this correct?`,
      [
        { id: 'addr_yes', title: '✅ Yes, correct' },
        { id: 'addr_no', title: '✏️ Re-enter' },
      ]
    )

    return {
      nextStep: 'addr_confirm',
      nextData: {
        addrLocationNodeId: selection.locationNodeId,
        addrSuburbLabel: selection.suburb,
        addrRegionLabel: selection.region,
        addrCityLabel: selection.city,
        addrProvinceLabel: selection.province,
        addrPostalCode: selection.postalCode,
        address: addressDisplay,
      },
    }
  }

  // Text reply or unknown button — reject
  await sendText(ctx.phone, '❗ Please *choose from the list* above. Typed text is not accepted for suburb selection.')
  await renderSuburbList(ctx.phone, regionId, regionLabel, ctx.data.addrPage ?? 0)
  return { nextStep: 'addr_select_suburb' }
}

async function handleAddrConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_no') {
    const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
    await sendText(
      ctx.phone,
      `📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
    )
    return { nextStep: 'collect_address_street' }
  }

  if (ctx.reply.id === 'addr_yes') {
    return handleCollectIssueDescription(ctx)
  }

  // Unknown reply — resend confirmation
  const streetLine = ctx.data.addressLine1 ?? ctx.data.addressStreet ?? ''
  await sendButtons(
    ctx.phone,
    `📍 *Your address:*\n\n🏠 ${streetLine}\n🏘 ${ctx.data.addrSuburbLabel}, ${ctx.data.addrRegionLabel}\n🏙 ${ctx.data.addrCityLabel}, ${ctx.data.addrProvinceLabel} ${ctx.data.addrPostalCode}\n\nIs this correct?`,
    [
      { id: 'addr_yes', title: '✅ Yes, correct' },
      { id: 'addr_no', title: '✏️ Re-enter' },
    ]
  )
  return { nextStep: 'addr_confirm' }
}

// ─── Description helpers ──────────────────────────────────────────────────────

/**
 * Builds the JobRequest.description from the two free-text fields captured
 * during the WhatsApp flow.  Either part can be absent.
 */
function buildDescription(issueDescription?: string, availabilityNote?: string): string {
  const parts: string[] = []
  if (issueDescription) parts.push(issueDescription)
  if (availabilityNote) parts.push(`Preferred availability: ${availabilityNote}`)
  return parts.join('\n\n')
}

// ─── Issue description capture ────────────────────────────────────────────────

/**
 * Prompts the customer for a free-text description of their problem.
 * Called inline (immediately after address confirmation) so ctx.reply still
 * carries the address-step button id — in that case we just show the prompt
 * and wait for the next message.
 */
async function handleCollectIssueDescription(ctx: FlowContext): Promise<FlowResult> {
  // Inline entry from address steps: reply id is addr_* — just show the prompt.
  const comingFromAddressStep = Boolean(ctx.reply.id?.startsWith('addr_'))
  const text = ctx.reply.text?.trim()

  if (comingFromAddressStep || !text) {
    const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
    await sendText(
      ctx.phone,
      `📝 *Describe the ${category} issue*\n\nIn a few sentences, tell us what needs to be done.\n\n_Example: "My kitchen tap is dripping and needs a new washer."_`,
    )
    return { nextStep: 'collect_issue_description' }
  }

  if (text.length < 5) {
    await sendText(
      ctx.phone,
      '❗ Please describe the issue in a little more detail so the worker knows what to expect.',
    )
    return { nextStep: 'collect_issue_description' }
  }

  return handleCollectAvailability({ ...ctx, data: { ...ctx.data, issueDescription: text } })
}

// ─── Availability ─────────────────────────────────────────────────────────────

async function handleCollectAvailability(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_no') {
    const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
    await sendText(
      ctx.phone,
      `📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
    )
    return { nextStep: 'collect_address_street' }
  }

  await sendList(
    ctx.phone,
    '🗓 When are you available for the worker to visit?',
    [{
      title: 'Availability',
      rows: [
        { id: 'avail_asap', title: 'As soon as possible', description: 'First available slot' },
        { id: 'avail_this_week', title: 'This week', description: 'Mon–Fri' },
        { id: 'avail_weekend', title: 'This weekend', description: 'Sat or Sun' },
        { id: 'avail_next_week', title: 'Next week', description: 'Flexible' },
        { id: 'avail_morning', title: 'Mornings only', description: '7am–12pm' },
        { id: 'avail_afternoon', title: 'Afternoons only', description: '12pm–5pm' },
      ],
    }],
    { buttonLabel: 'Choose Availability' }
  )
  return { nextStep: 'confirm_job_request' }
}

// ─── Confirm & submit ─────────────────────────────────────────────────────────

async function handleConfirmJobRequest(ctx: FlowContext): Promise<FlowResult> {
  const availLabels: Record<string, string> = {
    avail_asap:       'As soon as possible',
    avail_this_week:  'This week',
    avail_weekend:    'This weekend',
    avail_next_week:  'Next week',
    avail_morning:    'Mornings only',
    avail_afternoon:  'Afternoons only',
  }

  let availabilityNote = ctx.data.availabilityNote

  if (ctx.reply.id?.startsWith('avail_')) {
    availabilityNote = availLabels[ctx.reply.id] ?? ctx.reply.title ?? ''
  } else if (!availabilityNote) {
    return handleCollectAvailability(ctx)
  }

  const urgency = mapAvailabilityToUrgency(ctx.reply.id)
  await sendButtons(
    ctx.phone,
    'What matters most when choosing a provider?\n\nWe\'ll use this to show better provider matches.',
    [
      { id: 'pref_money',   title: '💰 Save money' },
      { id: 'pref_value',   title: '⚖️ Best value' },
      { id: 'pref_quality', title: '⭐ Best quality' },
    ],
  )
  return { nextStep: 'collect_request_preferences', nextData: { availabilityNote, urgency } }
}

const PREF_BUTTON_IDS = new Set([
  // MVP button IDs
  'pref_money', 'pref_value', 'pref_quality',
  // Legacy IDs — in-flight conversations from before the MVP simplification
  'pref_fastest', 'pref_experienced', 'pref_rated', 'pref_budget', 'pref_verified',
])

async function handleCollectRequestPreferences(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id || !PREF_BUTTON_IDS.has(ctx.reply.id)) {
    await sendButtons(
      ctx.phone,
      'Please choose what matters most when comparing providers.',
      [
        { id: 'pref_money',   title: '💰 Save money' },
        { id: 'pref_value',   title: '⚖️ Best value' },
        { id: 'pref_quality', title: '⭐ Best quality' },
      ],
    )
    return { nextStep: 'collect_request_preferences' }
  }

  const providerPreference = providerPreferenceFromReply(ctx.reply.id)
  await sendButtons(
    ctx.phone,
    `📸 *Add a photo?*\n\nA photo of the problem helps the provider understand the job and quote more accurately.\n\n_Optional — you can skip this step._`,
    [
      { id: 'photos_skip', title: '⏭ Skip' },
      { id: 'photos_start', title: '📷 Add photo' },
    ]
  )
  return {
    nextStep: 'collect_photos',
    nextData: {
      providerPreference,
      verifiedOnly: false,
      photoAttachmentIds: [],
    },
  }
}

// Budget preference step removed in MVP — kept as a pass-through so in-flight conversations
// already at this step advance gracefully to photos without re-asking the removed question.
async function handleCollectBudgetPreference(ctx: FlowContext): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    `📸 *Add a photo?*\n\nA photo of the problem helps the provider understand the job and quote more accurately.\n\n_Optional — you can skip this step._`,
    [
      { id: 'photos_skip', title: '⏭ Skip' },
      { id: 'photos_start', title: '📷 Add photo' },
    ]
  )
  return {
    nextStep: 'collect_photos',
    nextData: { photoAttachmentIds: [] },
  }
}

async function showJobRequestSummary(ctx: FlowContext): Promise<FlowResult> {
  const { selectedCategory, address, issueDescription, availabilityNote, urgency, providerPreference } = ctx.data
  const photoCount = (ctx.data.photoAttachmentIds ?? []).length
  const descriptionLine = issueDescription ? `\n📝 ${issueDescription}` : ''
  const photoLine = photoCount > 0 ? `\n📸 Photos: *${photoCount} attached*` : ''

  await sendButtons(
    ctx.phone,
    `✅ *Job Request Summary*\n\n🔧 ${selectedCategory}\n📍 ${address}${descriptionLine}\n🗓 ${availabilityNote}\n⚡ Urgency: *${urgency ?? 'flexible'}*\n⭐ Matching preference: *${preferenceLabel(providerPreference)}*${photoLine}\n\nYour phone number and exact address will only be shared after you select a provider and that provider accepts the job.\n\nReady to submit this request? We'll share a safe preview with suitable providers.`,
    [
      { id: 'confirm_yes', title: '✅ Submit Request' },
      { id: 'confirm_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'job_request_submitted' }
}

const MAX_CUSTOMER_PHOTOS = 5
const MAX_CUSTOMER_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB — tighter than the 15 MB evidence limit

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function sendCustomerPhotoProgress(phone: string, count: number) {
  // Debounce across Vercel function instances — see lib/whatsapp-media-batch.ts.
  // Each media event claims a seq and waits; only the latest event sends the
  // consolidated count, eliminating "2 photos received" → "3 photos received"
  // partial-count regressions for multi-file uploads.
  const { debounceMediaBatch, readMediaBatchSeq } = await import('../whatsapp-media-batch')
  const { isLatest, mySeq } = await debounceMediaBatch({
    phone,
    scope: 'customer_photo',
  })
  if (!isLatest) {
    const currentSeq = await readMediaBatchSeq(phone, 'customer_photo')
    console.info('[job-request-flow:sendCustomerPhotoProgress] superseded — newer media event in batch', {
      phone,
      mySeq,
      currentSeq,
      countObservedAtClaim: count,
    })
    return
  }

  // Re-read the settled count from the conversation record.
  const { db } = await import('../db')
  const fresh = await db.conversation.findUnique({
    where: { phone },
    select: { data: true },
  })
  const freshIds = ((fresh?.data as { photoAttachmentIds?: unknown[] } | null)?.photoAttachmentIds ?? []) as unknown[]
  const settledCount = Math.max(count, Math.min(freshIds.length, MAX_CUSTOMER_PHOTOS))
  const remaining = MAX_CUSTOMER_PHOTOS - settledCount

  if (remaining <= 0) {
    const outboundId = await sendButtons(
      phone,
      `✅ *${MAX_CUSTOMER_PHOTOS} photos received.* Maximum reached.\n\nContinue to the next step?`,
      [{ id: 'photos_done', title: '✅ Continue' }]
    )
    console.info('[job-request-flow] customer photo confirmation sent', {
      normalized_phone: phone,
      final_count_shown: MAX_CUSTOMER_PHOTOS,
      remaining_slots: 0,
      outbound_confirmation_message_id: outboundId || null,
    })
    return
  }

  const outboundId = await sendButtons(
    phone,
    `✅ *${settledCount} photo${settledCount === 1 ? '' : 's'} received.* You can add ${remaining} more or continue.`,
    [
      { id: 'photos_done', title: '✅ Continue' },
      { id: 'photos_add_more', title: '📷 Add more photos' },
    ]
  )
  console.info('[job-request-flow] customer photo confirmation sent', {
    normalized_phone: phone,
    final_count_shown: settledCount,
    remaining_slots: remaining,
    outbound_confirmation_message_id: outboundId || null,
  })
}

async function handleCollectPhotos(ctx: FlowContext): Promise<FlowResult> {
  const photoAttachmentIds = uniqueStrings(ctx.data.photoAttachmentIds ?? [])
  const photoMediaIds = uniqueStrings(ctx.data.photoMediaIds ?? [])
  const rawText = ctx.reply.text?.trim().toLowerCase()

  // Button: skip or done (with 0 photos)
  if (ctx.reply.id === 'photos_skip' || rawText === 'skip') {
    return showJobRequestSummary(ctx)
  }

  // Button: done (with photos already added)
  if (ctx.reply.id === 'photos_done' || rawText === 'done') {
    return showJobRequestSummary(ctx)
  }

  // User tapped "Add photo" / "Add more" — instruct them to send a media message
  if (ctx.reply.id === 'photos_start' || ctx.reply.id === 'photos_add_more') {
    const remaining = MAX_CUSTOMER_PHOTOS - photoAttachmentIds.length
    const limitCopy = remaining === MAX_CUSTOMER_PHOTOS
      ? `up to ${MAX_CUSTOMER_PHOTOS} photos`
      : `up to ${remaining} more photo${remaining === 1 ? '' : 's'}`
    await sendText(
      ctx.phone,
      `📸 Please upload *${limitCopy}* of the issue. You can send them together or one at a time.`
    )
    return { nextStep: 'collect_photos' }
  }

  // Documents are not accepted — customer photos must be images
  if (ctx.reply.type === 'document') {
    await sendText(
      ctx.phone,
      `❗ Please send a *photo* (image), not a document.\n\nTap *Skip* if you don't have any photos to add.`
    )
    return { nextStep: 'collect_photos' }
  }

  // Image received
  if (ctx.reply.type === 'image') {
    if (!ctx.reply.mediaId) {
      await sendText(ctx.phone, '❗ Photo did not come through. Please try sending it again.')
      return { nextStep: 'collect_photos' }
    }

    if (photoMediaIds.includes(ctx.reply.mediaId)) {
      if (!ctx.suppressCustomerPhotoProgress) {
        await sendCustomerPhotoProgress(ctx.phone, photoAttachmentIds.length)
      }
      return { nextStep: 'collect_photos', nextData: { photoAttachmentIds, photoMediaIds } }
    }

    if (photoAttachmentIds.length >= MAX_CUSTOMER_PHOTOS) {
      if (!ctx.suppressCustomerPhotoProgress) {
        await sendCustomerPhotoProgress(ctx.phone, photoAttachmentIds.length)
      }
      return { nextStep: 'collect_photos', nextData: { photoAttachmentIds, photoMediaIds } }
    }

    try {
      const { attachmentId } = await downloadAndStoreWhatsAppMedia({
        mediaId: ctx.reply.mediaId,
        prefix: 'customer-photos',
        label: 'customer_photo',
        maxSizeBytes: MAX_CUSTOMER_PHOTO_BYTES,
      })
      const updated = uniqueStrings([...photoAttachmentIds, attachmentId]).slice(0, MAX_CUSTOMER_PHOTOS)
      const updatedMediaIds = uniqueStrings([...photoMediaIds, ctx.reply.mediaId])

      if (!ctx.suppressCustomerPhotoProgress) {
        await sendCustomerPhotoProgress(ctx.phone, updated.length)
      }
      return { nextStep: 'collect_photos', nextData: { photoAttachmentIds: updated, photoMediaIds: updatedMediaIds } }
    } catch (err) {
      console.error('[job-request-flow:handleCollectPhotos] media upload failed:', err)
      await sendWhatsAppJourneyRecovery(ctx.phone, {
        userRole: 'customer',
        channel: 'whatsapp',
        flowName: ctx.flow,
        currentStep: ctx.step,
        failureType: 'storage_failure',
        recoveryClass: 'retry_same_step',
        error: err,
      })
      return { nextStep: 'collect_photos' }
    }
  }

  // Unknown reply — resend the appropriate prompt
  if (photoAttachmentIds.length > 0) {
    const count = photoAttachmentIds.length
    await sendButtons(
      ctx.phone,
      `📸 *${count} photo${count > 1 ? 's' : ''} added.*\n\nSend another or tap Done to continue.`,
      [
        { id: 'photos_done', title: '✅ Continue' },
        { id: 'photos_add_more', title: '📷 Add more photos' },
      ]
    )
  } else {
    await sendButtons(
      ctx.phone,
      `📸 *Add a photo?*\n\nA photo of the problem helps the provider understand the job and quote more accurately.\n\n_Optional — you can skip this step._`,
      [
        { id: 'photos_skip', title: '⏭ Skip' },
        { id: 'photos_start', title: '📷 Add photo' },
      ]
    )
  }
  return { nextStep: 'collect_photos' }
}

async function handleJobRequestSubmitted(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'confirm_no') {
    await sendText(
      ctx.phone,
      "No problem! Your request has been discarded. Send 'Hi' anytime to start a new request. 👋"
    )
    return { nextStep: 'cancelled' }
  }

  if (ctx.reply.id !== 'confirm_yes') {
    return { nextStep: 'job_request_submitted' }
  }

  try {
    const category = ctx.data.category ?? ctx.data.selectedCategory ?? ''
    const photoAttachmentIds = uniqueStrings(ctx.data.photoAttachmentIds ?? []).slice(0, MAX_CUSTOMER_PHOTOS)

    // Dedup is now enforced inside createJobRequest.$transaction via
    // DuplicateActiveRequestError — handled in the catch block below.

    const categoryRequirements = await resolveCategoryRequirements({ category })

    let result: Awaited<ReturnType<typeof createJobRequest>>

    if (ctx.data.addrLocationNodeId) {
      // ── New structured path ────────────────────────────────────────────────
      const addressLine1 = ctx.data.addressLine1 ?? ctx.data.addressStreet ?? ''

      let resolvedAddr
      try {
        resolvedAddr = await resolveStructuredAddressCapture({
          addressLine1,
          locationNodeId: ctx.data.addrLocationNodeId,
        })
      } catch (err) {
        if (err instanceof InvalidStructuredAddressError) {
          await sendText(
            ctx.phone,
            '❗ We could not validate your address. Please enter it again.',
          )
          return { nextStep: 'collect_address_street' }
        }
        throw err
      }

      result = await createJobRequest({
        phone: ctx.phone,
        customerName: ctx.data.customerName ?? 'WhatsApp Customer',
        category,
        source: 'whatsapp',
        urgency: ctx.data.urgency ?? null,
        budgetPreference: ctx.data.budgetPreference ?? null,
        providerPreference: ctx.data.providerPreference ?? null,
        verifiedOnly: ctx.data.verifiedOnly === true,
        title: ctx.data.selectedCategory ?? category,
        description: buildDescription(ctx.data.issueDescription, ctx.data.availabilityNote),
        existingAddressId: ctx.data.savedAddressId ?? undefined,
        street: resolvedAddr.street,
        addressLine1: resolvedAddr.addressLine1,
        addressLine2: resolvedAddr.addressLine2,
        complexName: resolvedAddr.complexName,
        unitNumber: resolvedAddr.unitNumber,
        suburb: resolvedAddr.suburb,
        region: resolvedAddr.region,
        city: resolvedAddr.city,
        province: resolvedAddr.province,
        postalCode: resolvedAddr.postalCode,
        locationNodeId: resolvedAddr.locationNodeId,
        photoAttachmentIds,
      })
    } else {
      // ── Legacy path — old in-flight conversations only ────────────────────
      const addrParts = (ctx.data.address ?? '').split(',').map((p: string) => p.trim())
      result = await createJobRequest({
        phone: ctx.phone,
        customerName: ctx.data.customerName ?? 'WhatsApp Customer',
        category,
        source: 'whatsapp',
        urgency: ctx.data.urgency ?? null,
        budgetPreference: ctx.data.budgetPreference ?? null,
        providerPreference: ctx.data.providerPreference ?? null,
        verifiedOnly: ctx.data.verifiedOnly === true,
        title: ctx.data.selectedCategory ?? category,
        description: buildDescription(ctx.data.issueDescription, ctx.data.availabilityNote),
        street:   ctx.data.addressStreet ?? addrParts[0] ?? '',
        suburb:   ctx.data.addressSuburb ?? addrParts[1] ?? '',
        city:     ctx.data.addressCity   ?? addrParts[2] ?? addrParts[1] ?? '',
        province: addrParts[3] ?? '',
        locationNodeId: ctx.data.addressLocationNodeId ?? null,
        photoAttachmentIds,
      })
    }

    const photosLinked = photoAttachmentIds.length
    const photoNote = photosLinked > 0
      ? `\n📸 ${photosLinked} photo${photosLinked === 1 ? '' : 's'} attached.`
      : ''

    const successMessage =
      `🎉 *Request submitted!*\n\n🔧 ${ctx.data.selectedCategory}\nRef: *${result.requestRef}*${photoNote}\n\n` +
      `We're checking suitable providers in your area. Your phone number and exact address will only be shared after you select a provider and that provider accepts the job.` +
      (categoryRequirements.policy.bookingOnAssignment
        ? `\n\n_If your price is already agreed for this type of work, the booking can be confirmed as soon as a provider accepts._`
        : '')

    // ── Send success confirmation ─────────────────────────────────────────────
    // The job request is in the DB at this point. Success message delivery
    // failures must NOT propagate to the outer catch — that would incorrectly
    // tell the customer their submission failed when it actually succeeded.
    try {
      if (result.ticketUrl) {
        try {
          await sendCtaUrl(ctx.phone, successMessage, 'View Ticket', result.ticketUrl)
        } catch (ctaErr) {
          console.error('[job-request-flow] Ticket CTA send failed:', ctaErr)
          // CTA URL failed (e.g. non-HTTPS URL, domain not approved) — fall back
          // to a plain button message which has no URL requirements.
          await sendButtons(
            ctx.phone,
            successMessage,
            [
              { id: 'status', title: '📋 Track My Request' },
              { id: 'back_home', title: '🏠 Main Menu' },
            ]
          )
        }
      } else {
        await sendButtons(
          ctx.phone,
          successMessage,
          [
            { id: 'status', title: '📋 Track My Request' },
            { id: 'back_home', title: '🏠 Main Menu' },
          ]
        )
      }
    } catch (sendErr) {
      // Interactive message failed — last-resort plain text so the customer
      // knows their request was received. sendText is simpler and more resilient.
      console.error('[job-request-flow] Success message send failed:', sendErr)
      await sendText(
        ctx.phone,
        `${successMessage}\n\nReply *Hi* anytime to check your request status.`
      ).catch((e) => console.error('[job-request-flow] Plain-text fallback also failed:', e))
    }

    return { nextStep: 'done', nextData: { jobRequestId: result.jobRequestId, customerId: result.customerId } }
  } catch (err) {
    // ── Duplicate active request ───────────────────────────────────────────────
    if (err instanceof DuplicateActiveRequestError) {
      const ref = err.existingId.slice(-8).toUpperCase()
      const statusLine =
        err.existingStatus === 'MATCHING'
          ? "We've notified nearby providers and are waiting for one to accept."
          : "We're still searching for a suitable provider in your area."

      // Patch description if we now have richer data from the customer
      const latestDescription = buildDescription(ctx.data.issueDescription, ctx.data.availabilityNote)
      if (latestDescription && latestDescription !== err.existingDescription) {
        await db.jobRequest.update({
          where: { id: err.existingId },
          data: { description: latestDescription },
        }).catch((e) => console.error('[job-request-flow] dedup description patch failed:', e))
      }

      await sendText(
        ctx.phone,
        `ℹ️ *You have an active ${ctx.data.selectedCategory ?? ctx.data.category ?? 'service'} request.*\n\nRef: *${ref}*\n\n${statusLine}\n\nYou'll receive a WhatsApp notification as soon as a provider is confirmed.\n\nReply *Hi* to check status, or *Cancel* if you'd like to start a fresh request. 👍`,
      )
      return { nextStep: 'done', nextData: { jobRequestId: err.existingId, customerId: err.customerId } }
    }

    if (err instanceof JobRequestPhotoLinkError) {
      const traceId = createTraceId('req')
      console.error('[job-request-flow] customer photo link failed:', {
        traceId,
        expected: err.expectedCount,
        linked: err.linkedCount,
      })
      await sendText(
        ctx.phone,
        `😔 We received your request details, but could not safely attach your photo. Please try submitting again or type *skip* to continue without photos.\n\n_Ref: ${traceId}_`,
      )
      // Clear stale attachment IDs so a retry does not attempt to re-link the same
      // records and loop. The orphaned Attachment rows are still in Blob storage but
      // unlinked — they will be cleaned up by the storage GC job.
      return { nextStep: 'collect_photos', nextData: { photoAttachmentIds: [], photoMediaIds: [] } }
    }

    const errorMessage = err instanceof Error ? err.message : String(err)
    const traceId = createTraceId('req')
    console.error('[job-request-flow] Create job request error:', { traceId, err })

    // In pilot mode, append a truncated technical error to the WhatsApp message
    // so failures can be triaged without needing server logs. Disable by removing
    // PILOT_DEBUG_ERRORS from env once stable.
    const debugSuffix = process.env.PILOT_DEBUG_ERRORS === 'true'
      ? `\n\n_🔧 Debug: ${errorMessage.slice(0, 300)}_`
      : ''

    await sendText(
      ctx.phone,
      `${JOURNEY_RECOVERY_COPY.savedProgressRetry}\n\nRef: ${traceId}${debugSuffix}`
    )
    return { nextStep: 'confirm_job_request' }
  }
}

// ─── Legacy handlers — in-flight conversations only ──────────────────────────
// These steps are no longer entered from new flows. They handle any conversation
// that was mid-flow at deploy time. They redirect to the new structured flow.

async function handleLegacyCollectSuburb(ctx: FlowContext): Promise<FlowResult> {
  await sendText(
    ctx.phone,
    "We've updated our address selection. Let's re-enter your address using our new area picker.",
  )
  await renderProvinceList(ctx.phone)
  return { nextStep: 'addr_select_province', nextData: { addrPage: 0 } }
}

async function handleLegacyConfirmAddress(ctx: FlowContext): Promise<FlowResult> {
  // Service area check for old conversations that typed their city
  const city = ctx.reply.text?.trim() ?? ctx.data.addressCity ?? ''

  if (city && !isInActiveServiceArea(city)) {
    await addToServiceAreaWaitlist({
      phone: ctx.phone,
      name: ctx.data.customerName ?? null,
      category: ctx.data.selectedCategory ?? ctx.data.category ?? null,
      suburb: ctx.data.addressSuburb ?? null,
      city,
      source: 'whatsapp',
    }).catch((err) => console.error('[job-request] waitlist upsert failed:', err))

    await sendText(
      ctx.phone,
      `Thank you for reaching out! 🙏\n\n` +
      `We're not in *${city}* just yet, but we're expanding fast.\n\n` +
      `We've saved your contact and will send you a WhatsApp the moment Plug A Pro goes live in your area. ` +
      `No action needed from you. 🚀`,
    )
    return { nextStep: 'done' }
  }

  // City was valid or unknown — redirect to new structured flow
  await sendText(
    ctx.phone,
    "We've updated our address selection. Let's re-enter your address using our new area picker.",
  )
  await renderProvinceList(ctx.phone)
  return { nextStep: 'addr_select_province', nextData: { addrPage: 0 } }
}

// ─── Notify Me (no providers in area) ─────────────────────────────────────────

async function handleNotifyMe(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    await showMainMenu(ctx.phone)
    return { nextStep: 'welcome' }
  }

  if (ctx.reply.id === 'notify_me' || ctx.step === 'notify_me') {
    await db.customer.upsert({
      where: { phone: ctx.phone },
      create: {
        phone: ctx.phone,
        name: ctx.data.customerName ?? 'WhatsApp Customer',
      },
      update: {},
    })

    await sendText(
      ctx.phone,
      `✅ Got it! We'll notify you as soon as a worker is available for *${ctx.data.selectedCategory ?? 'your service'}* in your area.\n\nYou'll receive a WhatsApp message when we have a match. 🔔`
    )

    return { nextStep: 'done' }
  }

  return { nextStep: 'notify_me' }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export async function showMainMenu(phone: string): Promise<void> {
  const menu = await resolveWhatsAppIdentity(phone)

  if (menu.conflict && menu.customerId) {
    const name = menu.customerFirstName ?? firstName(menu.customerDisplayName ?? menu.displayName)
    await sendList(
      phone,
      `Welcome back, ${name}. What would you like to do?`,
      [
        {
          title: 'Customer',
          rows: [
            { id: 'book', title: 'Request a Service', description: 'Start a new customer request' },
            { id: 'status', title: 'Track Request', description: 'Check your customer request' },
          ],
        },
        {
          title: 'Provider',
          rows: [
            { id: 'provider_my_jobs', title: 'Provider Menu', description: 'Manage your provider work' },
            { id: 'provider_worker_portal', title: 'Worker Portal', description: 'Open provider tools' },
          ],
        },
      ],
      { buttonLabel: 'Choose Option' },
    )
    return
  }

  if (menu.customerId) {
    const name = menu.customerFirstName ?? menu.firstName ?? firstName(menu.customerDisplayName ?? menu.displayName)

    await sendList(
      phone,
      `Welcome back, ${name}. How can we help today?`,
      [
        {
          title: 'Services',
          rows: [
            { id: 'book', title: 'Request a Service', description: 'Book a plumber, electrician, cleaner & more' },
            { id: 'status', title: 'My Requests', description: 'Track or manage existing requests' },
            { id: 'help', title: 'Get Help', description: 'FAQs, pricing, support' },
          ],
        },
      ],
      { buttonLabel: 'Choose Option' },
    )
    return
  }

  if (menu.role === 'provider_pending') {
    const name = menu.firstName ?? firstName(menu.displayName)
    const ref = menu.applicationId ? applicationRef(menu.applicationId) : 'Pending'

    await sendList(
      phone,
      `Hi ${name}, your Plug A Pro provider application is still under review.\n\nRef: *${ref}*\n\nWe'll notify you here once it's approved.`,
      [
        {
          title: 'Provider',
          rows: [
            { id: 'provider_application_status', title: 'Application Status', description: 'Check your provider application' },
            { id: 'provider_update_application', title: 'Update Application', description: 'Edit your details or service areas' },
            { id: 'provider_support', title: 'Support', description: 'Get help with your application' },
          ],
        },
      ],
      { buttonLabel: 'Choose Option' },
    )
    return
  }

  if (menu.role === 'provider') {
    const name = menu.firstName ?? firstName(menu.displayName)
    const activeJobsLine = menu.activeJobCount > 0
      ? `\n\nYou have *${menu.activeJobCount} active job${menu.activeJobCount === 1 ? '' : 's'}*.`
      : ''
    const statusLine = menu.isPaused
      ? '\n\nStatus: 🔴 Leads paused\n\nYou won’t receive new leads until you go available again.'
      : '\n\nStatus: 🟢 Available for leads'
    const pauseRow = menu.isPaused
      ? { id: 'provider_go_available', title: 'Go Available', description: 'Start receiving matching leads again' }
      : { id: 'provider_pause_leads', title: 'Pause Leads', description: 'Stop new leads temporarily' }

    await sendList(
      phone,
      `Welcome back, ${name}.${statusLine}${activeJobsLine}\n\nWhat would you like to do?`,
      [
        {
          title: 'Provider',
          rows: [
            { id: 'provider_my_jobs', title: 'My Jobs', description: 'Manage accepted and scheduled work' },
            { id: 'provider_available_jobs', title: 'Available Jobs', description: 'View leads you can accept' },
            { id: 'provider_check_status', title: 'Check Status', description: 'See if you can receive leads' },
            pauseRow,
            { id: 'provider_worker_portal', title: 'Worker Portal', description: 'Manage detailed availability' },
            { id: 'provider_support', title: 'Support', description: 'Get help' },
          ],
        },
      ],
      { buttonLabel: 'Choose Option' },
    )
    return
  }

  if (menu.role === 'provider_inactive') {
    const name = menu.firstName ?? firstName(menu.displayName)

    await sendList(
      phone,
      `Hi ${name}, your provider profile is currently inactive.\n\nYou won't receive new job leads until this is resolved.`,
      [
        {
          title: 'Provider',
          rows: [
            { id: 'provider_status', title: 'Provider Status', description: 'See why your account is inactive' },
            { id: 'provider_support', title: 'Contact Support', description: 'Get help with your account' },
          ],
        },
      ],
      { buttonLabel: 'Choose Option' },
    )
    return
  }

  await sendList(
    phone,
    '👋 Welcome to Plug A Pro!\n\nHow can I help you today?',
    [
      {
        title: 'Services',
        rows: [
          { id: 'book',      title: '🔧 Request a Service', description: 'Book a plumber, electrician, cleaner & more' },
          { id: 'status',    title: '📋 My Request',        description: 'Track or manage an existing booking' },
          { id: 'help',      title: '❓ Get Help',          description: 'FAQs, pricing, support' },
        ],
      },
      {
        title: 'For Service Providers',
        rows: [
          { id: 'find_work', title: '👷 Find Work',         description: 'Apply, get reviewed, then accept leads with credits' },
        ],
      },
    ],
    { buttonLabel: 'Choose Option' }
  )
}

// ─── Rebook flow ──────────────────────────────────────────────────────────────
// Entry point when a customer sends a rebook keyword ("book again", "rebook", etc.)
// Finds their most recent COMPLETED job request and offers a one-tap pre-fill.

export async function handleRebookFlow(phone: string): Promise<void> {
  const customer = await db.customer.findFirst({
    where: { phone },
    select: { id: true },
  })

  if (!customer) {
    await sendText(
      phone,
      "You don't have any completed jobs to re-book. To start a new booking, type *Request a job*."
    )
    return
  }

  // Find the most recent completed job for this customer by traversing
  // Customer → JobRequest → Match → Booking → Job (status COMPLETED)
  const completedJob = await db.job.findFirst({
    where: {
      status: 'COMPLETED',
      booking: {
        match: {
          jobRequest: {
            customerId: customer.id,
          },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
    select: {
      booking: {
        select: {
          match: {
            select: {
              jobRequest: {
                select: { id: true, category: true, title: true, description: true },
              },
            },
          },
        },
      },
    },
  })

  const jobRequest = completedJob?.booking?.match?.jobRequest
  if (!jobRequest) {
    await sendText(
      phone,
      "You don't have any completed jobs to re-book. To start a new booking, type *Request a job*."
    )
    return
  }

  const label = jobRequest.title || jobRequest.category || 'previous job'

  await sendButtons(
    phone,
    `Book again? Your last job was: *${label}*.\n\nShall I pre-fill the details so you can skip ahead?`,
    [
      { id: `rebook_confirm:${jobRequest.id}`, title: 'Yes, book again' },
      { id: 'rebook_cancel', title: 'No thanks' },
    ]
  )
}
