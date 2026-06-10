export function trackMetaEvent(eventName: string, data?: Record<string, unknown>) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  window.fbq('track', eventName, data)
}

export function trackJobRequestSubmitted(jobRequestId: string) {
  const key = `pap_px_jrs_${jobRequestId}`
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  trackMetaEvent('job_request_submitted')
}
