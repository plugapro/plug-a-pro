// ─── WhatsApp template registry ───────────────────────────────────────────────
// Each template must be registered and approved in Meta Business Manager.
// Template names here must exactly match the approved names in your WABA.
//
// When cloning for a new venture:
// 1. Register these templates in your Meta Business Account
// 2. Update the `name` fields below to match your approved template names
// 3. Get approval (usually 24-72h for new templates)

export const TEMPLATES = {
  booking_confirmation: {
    name: 'booking_confirmation',
    language: 'en_ZA',
    description: 'Sent immediately when a booking is confirmed and paid',
    // Variables: {{1}} customer name, {{2}} service name, {{3}} date/window, {{4}} tracking URL
    example:
      'Hi {{1}}, your booking for {{2}} has been confirmed for {{3}}. Track your job: {{4}}',
  },
  booking_reminder: {
    name: 'booking_reminder',
    language: 'en_ZA',
    description: 'Sent 24h before the scheduled appointment',
    // Variables: {{1}} customer name, {{2}} service name, {{3}} date/window
    example:
      'Hi {{1}}, just a reminder that your {{2}} appointment is tomorrow, {{3}}. Reply STOP to unsubscribe.',
  },
  technician_on_the_way: {
    name: 'technician_on_the_way',
    language: 'en_ZA',
    description: 'Sent when technician status changes to EN_ROUTE',
    // Variables: {{1}} customer name, {{2}} technician name, {{3}} ETA
    example:
      'Hi {{1}}, {{2}} is on their way to you and should arrive in {{3}}.',
  },
  technician_arrived: {
    name: 'technician_arrived',
    language: 'en_ZA',
    description: 'Sent when technician status changes to ARRIVED',
    // Variables: {{1}} customer name, {{2}} technician name
    example: 'Hi {{1}}, {{2}} has arrived at your location.',
  },
  extra_work_approval: {
    name: 'extra_work_approval',
    language: 'en_ZA',
    description: 'Sent when technician raises an extra work request',
    // Variables: {{1}} customer name, {{2}} description, {{3}} amount, {{4}} approval URL
    example:
      'Hi {{1}}, your technician has found additional work needed: {{2}} ({{3}}). Approve or decline here: {{4}}',
  },
  job_completed: {
    name: 'job_completed',
    language: 'en_ZA',
    description: 'Sent when job status changes to COMPLETED',
    // Variables: {{1}} customer name, {{2}} invoice URL
    example:
      'Hi {{1}}, your job has been completed. View your invoice here: {{2}}. Thank you for using our service!',
  },
  follow_up: {
    name: 'follow_up',
    language: 'en_ZA',
    description: 'Sent 24h after job completion to collect rating',
    // Variables: {{1}} customer name, {{2}} rating URL
    example:
      'Hi {{1}}, how did we do? Share your feedback here: {{2}}. We appreciate your support!',
  },
  quote_ready: {
    name: 'quote_ready',
    language: 'en_ZA',
    description: 'Sent when admin completes a quote review',
    // Variables: {{1}} customer name, {{2}} service name, {{3}} quoted price, {{4}} quote URL
    example:
      'Hi {{1}}, your quote for {{2}} is ready: {{3}}. View and accept here: {{4}}',
  },
  booking_cancelled: {
    name: 'booking_cancelled',
    language: 'en_ZA',
    description: 'Sent when a booking is cancelled (by admin or customer)',
    // Variables: {{1}} customer name, {{2}} service name, {{3}} refund note (or empty)
    example:
      'Hi {{1}}, your {{2}} booking has been cancelled. {{3}}',
  },
} as const

export type TemplateName = keyof typeof TEMPLATES
