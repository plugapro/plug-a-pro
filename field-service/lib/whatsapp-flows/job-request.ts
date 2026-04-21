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
import type { FlowContext, FlowResult } from './types'

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

// WhatsApp list cap is 10 rows total per message.
// When paging is needed we use 8 item rows + up to 2 nav rows.
const PAGE_SIZE = 8

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
    case 'collect_availability':
      return handleCollectAvailability(ctx)
    case 'confirm_job_request':
      return handleConfirmJobRequest(ctx)
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

    const existingCustomer = await db.customer.findUnique({
      where: { phone: ctx.phone },
      select: { name: true, id: true },
    })
    const isFirstBooking = !existingCustomer || existingCustomer.name === 'WhatsApp Customer'

    if (!isFirstBooking) {
      const lastAddress = await db.address.findFirst({
        where: { customerId: existingCustomer!.id },
        orderBy: { createdAt: 'desc' },
      })

      const baseData = {
        selectedCategory: category,
        category,
        customerName: existingCustomer?.name,
        isFirstBooking: false,
      }

      if (lastAddress?.locationNodeId) {
        // Structured saved address — verify it's still valid and offer reuse
        const selection = await getStructuredAddressSelection(lastAddress.locationNodeId)
        if (selection) {
          const streetLine = lastAddress.addressLine1 ?? lastAddress.street
          const display = [streetLine, selection.suburb, selection.city].filter(Boolean).join(', ')
          await sendButtons(
            ctx.phone,
            `📍 *Where do you need the ${category} work done?*\n\nLast used:\n_${display}_`,
            [
              { id: 'addr_same', title: '📍 Same address' },
              { id: 'addr_new', title: '✏️ New address' },
            ]
          )
          return {
            nextStep: 'collect_address',
            nextData: {
              ...baseData,
              addressLine1: streetLine,
              addrLocationNodeId: lastAddress.locationNodeId,
              addrCityLabel: selection.city,
              addrSuburbLabel: selection.suburb,
              addrRegionLabel: selection.region,
              addrProvinceLabel: selection.province,
              addrPostalCode: selection.postalCode,
              address: display,
              hasSavedAddress: true,
            },
          }
        }
      }

      // Legacy address (no locationNodeId) or unresolvable node — force new entry
      await sendText(
        ctx.phone,
        `📍 *Where do you need the ${category} work done?*\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
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
    where: { phone: ctx.phone, name: 'WhatsApp Customer' },
    data: { name: text },
  })

  await sendText(
    ctx.phone,
    `Nice to meet you, *${text}*! 👋\n\n*Street address:* Type your street address:\n\n_Example: 14 Main Street_`,
  )
  return { nextStep: 'collect_address_street', nextData: { customerName: text } }
}

// ─── Address collection ───────────────────────────────────────────────────────

async function handleCollectAddress(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_same') {
    // addrLocationNodeId + addressLine1 are already in ctx.data — go to availability
    return handleCollectAvailability(ctx)
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
  const street = ctx.reply.text?.trim()
  if (!street || street.length < 3) {
    await sendText(ctx.phone, '❗ Please type your *street address*.\n\n_Example: 14 Main Street_')
    return { nextStep: 'collect_address_street' }
  }

  await renderProvinceList(ctx.phone)
  return {
    nextStep: 'addr_select_province',
    nextData: { addressLine1: street, addressStreet: street, addrPage: 0 },
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
      `Plug a Pro is currently only available in *Gauteng*, but we're expanding fast.\n\n` +
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
        `We've saved your contact and will send you a WhatsApp the moment Plug a Pro goes live in your area. ` +
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
    return handleCollectAvailability(ctx)
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

  const { selectedCategory, address } = ctx.data

  await sendButtons(
    ctx.phone,
    `✅ *Job Request Summary*\n\n🔧 ${selectedCategory}\n📍 ${address}\n🗓 ${availabilityNote}\n\nShall I submit this request? We'll share it with nearby providers whose profiles match this type of work.`,
    [
      { id: 'confirm_yes', title: '✅ Submit Request' },
      { id: 'confirm_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'job_request_submitted', nextData: { availabilityNote } }
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
        title: ctx.data.selectedCategory ?? category,
        description: ctx.data.availabilityNote
          ? `Preferred availability: ${ctx.data.availabilityNote}`
          : '',
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
      })
    } else {
      // ── Legacy path — old in-flight conversations only ────────────────────
      const addrParts = (ctx.data.address ?? '').split(',').map((p: string) => p.trim())
      result = await createJobRequest({
        phone: ctx.phone,
        customerName: ctx.data.customerName ?? 'WhatsApp Customer',
        category,
        title: ctx.data.selectedCategory ?? category,
        description: ctx.data.availabilityNote
          ? `Preferred availability: ${ctx.data.availabilityNote}`
          : '',
        street:   ctx.data.addressStreet ?? addrParts[0] ?? '',
        suburb:   ctx.data.addressSuburb ?? addrParts[1] ?? '',
        city:     ctx.data.addressCity   ?? addrParts[2] ?? addrParts[1] ?? '',
        province: addrParts[3] ?? '',
        locationNodeId: ctx.data.addressLocationNodeId ?? null,
      })
    }

    const successMessage =
      `🎉 *Request submitted!*\n\n🔧 ${ctx.data.selectedCategory}\nRef: *${result.jobRequestId.slice(-8).toUpperCase()}*\n\n` +
      `We're finding you a nearby worker — you'll get a WhatsApp update when matched.` +
      (categoryRequirements.policy.bookingOnAssignment
        ? `\n\n_If your price is already agreed for this type of work, the booking can be confirmed as soon as a provider accepts._`
        : '')

    if (result.ticketUrl) {
      await sendCtaUrl(ctx.phone, successMessage, 'View Ticket', result.ticketUrl)
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

    return { nextStep: 'done', nextData: { jobRequestId: result.jobRequestId, customerId: result.customerId } }
  } catch (err) {
    console.error('[job-request-flow] Create job request error:', err)
    await sendText(
      ctx.phone,
      "😔 Something went wrong submitting your request. Please try again or contact us directly."
    )
    return { nextStep: 'done' }
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
      `We've saved your contact and will send you a WhatsApp the moment Plug a Pro goes live in your area. ` +
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
  await sendList(
    phone,
    '👋 Welcome to Plug a Pro!\n\nHow can I help you today?',
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
          { id: 'find_work', title: '👷 Find Work',         description: 'Apply to join as a service provider' },
        ],
      },
    ],
    { buttonLabel: 'Choose Option' }
  )
}
