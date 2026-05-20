export type BookingFlowMatchingMode = 'quick_match' | 'review_first'

export type RequestSuccessMode = BookingFlowMatchingMode | 'preferred_provider' | 'unknown'

export interface RequestSuccessContent {
  mode: RequestSuccessMode
  statusLabel: string
  title: string
  description: string
  whatsappNote: string
  primaryCtaLabel: string
  primaryCtaHref: string
  secondaryCtaLabel: string
  secondaryCtaHref: string
  helperNote: string
  steps: string[]
}

function withTicketView(ticketUrl: string | null, view: string, fallbackHref: string): string {
  if (!ticketUrl) return fallbackHref
  try {
    if (ticketUrl.startsWith('http://') || ticketUrl.startsWith('https://')) {
      const parsed = new URL(ticketUrl)
      parsed.searchParams.set('view', view)
      return parsed.toString()
    }
    const parsed = new URL(ticketUrl, 'https://local.plugapro')
    parsed.searchParams.set('view', view)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ticketUrl
  }
}

export function getRequestSuccessContent(params: {
  jobRequestId: string
  ticketUrl: string | null
  selectedMatchingMode: BookingFlowMatchingMode | null
  preferredProviderId?: string | null
  hasProviderResponses?: boolean
}): RequestSuccessContent {
  const fallbackTrackHref = `/requests/${params.jobRequestId}`
  const secondaryCtaHref = '/bookings'
  const baseSteps = [
    'Providers review your request',
    'You get updates on this page and on WhatsApp',
    'You choose who you want to proceed with',
    'Your booking is confirmed',
  ]

  if (params.preferredProviderId) {
    return {
      mode: 'preferred_provider',
      statusLabel: 'Waiting for provider',
      title: 'Request sent to your selected provider',
      description: 'Your selected provider has been notified. We\'ll update you when they respond.',
      whatsappNote: 'We\'ll notify you on WhatsApp as soon as the provider responds.',
      primaryCtaLabel: 'Track provider response',
      primaryCtaHref: withTicketView(params.ticketUrl, 'provider_confirmation', fallbackTrackHref),
      secondaryCtaLabel: 'View my requests',
      secondaryCtaHref,
      helperNote: 'No action needed right now. We\'ll notify you when the provider responds.',
      steps: baseSteps,
    }
  }

  if (params.selectedMatchingMode === 'review_first') {
    const hasResponses = params.hasProviderResponses === true
    return {
      mode: 'review_first',
      statusLabel: hasResponses ? 'Responses available' : 'Collecting responses',
      title: hasResponses
        ? 'Provider responses are ready to review'
        : 'Request sent - waiting for provider responses',
      description: hasResponses
        ? 'Matched providers have started responding. Compare responses and choose who you want to proceed with.'
        : 'We\'re sending your request to matched providers. As they respond, you\'ll be able to compare them and choose who you want to proceed with.',
      whatsappNote: hasResponses
        ? 'We\'ve started receiving responses and will keep notifying you on WhatsApp.'
        : 'We\'ll notify you on WhatsApp when the first provider responds.',
      primaryCtaLabel: hasResponses ? 'Review provider responses' : 'Track provider responses',
      primaryCtaHref: withTicketView(params.ticketUrl, 'providers_reviewing', fallbackTrackHref),
      secondaryCtaLabel: 'View my requests',
      secondaryCtaHref,
      helperNote: hasResponses
        ? 'Review responses now and choose your provider.'
        : 'No action needed right now. We\'ll notify you when the first provider responds.',
      steps: baseSteps,
    }
  }

  if (params.selectedMatchingMode === 'quick_match') {
    return {
      mode: 'quick_match',
      statusLabel: 'Matching',
      title: 'Request sent - finding your provider',
      description: 'We\'re matching you with the fastest suitable provider. You\'ll get a WhatsApp update once a provider accepts.',
      whatsappNote: 'We\'ll notify you on WhatsApp when a provider accepts.',
      primaryCtaLabel: 'Track request',
      primaryCtaHref: withTicketView(params.ticketUrl, 'matching_progress', fallbackTrackHref),
      secondaryCtaLabel: 'View my requests',
      secondaryCtaHref,
      helperNote: 'No action needed right now. We\'re working on your match.',
      steps: [
        'We contact the fastest suitable provider first',
        'If they do not respond, we rotate to the next provider',
        'You get updates on this page and on WhatsApp',
        'Your booking is confirmed once a provider accepts',
      ],
    }
  }

  return {
    mode: 'unknown',
    statusLabel: 'Request sent',
    title: 'Request sent',
    description: 'Your request is saved and ready for provider matching.',
    whatsappNote: 'We\'ll send updates on WhatsApp.',
    primaryCtaLabel: 'Track request',
    primaryCtaHref: withTicketView(params.ticketUrl, 'request_submitted', fallbackTrackHref),
    secondaryCtaLabel: 'View my requests',
    secondaryCtaHref,
    helperNote: 'No action needed right now.',
    steps: baseSteps,
  }
}
