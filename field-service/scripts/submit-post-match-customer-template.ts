/**
 * One-shot script to register the `post_match_customer_provider_accepted`
 * WhatsApp template with Meta via the WhatsApp Business Management API.
 *
 * Why this exists:
 *   The legacy post-match customer notification sent free-form interactive
 *   messages that Meta rejects with "Re-engagement message" when the
 *   customer's last inbound was >24h old. lib/post-match-communications.ts
 *   now routes through sendTemplate first; this template is the preferred
 *   primary target. Until it's APPROVED at Meta, the code falls through to
 *   the already-approved `customer_match_found` template.
 *
 * Run from the repo root (or field-service/) with production env loaded:
 *
 *   set -a && source .env.production.local && set +a
 *   pnpm --filter field-service exec tsx scripts/submit-post-match-customer-template.ts
 *
 * Required env:
 *   WHATSAPP_ACCESS_TOKEN          — must have `whatsapp_business_management`
 *                                    scope (same scope used by sendTemplate)
 *   WHATSAPP_WABA_ID OR
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   — WABA id. Defaults to 104200042667877
 *                                    (Kgolaentle Holdings, recorded approved
 *                                    on 2026-04-08 for the existing 21
 *                                    production templates).
 *
 * Behaviour:
 *   - POSTs the template definition to Meta's Graph API.
 *   - Exits 0 on success OR on `Template already exists` (idempotent).
 *   - Exits 1 on any real failure (auth, scope, validation).
 *   - Never prints the access token. Prints the WABA id (public identifier).
 *
 * Output: a JSON line on stdout with { id, status, category } on success.
 */

const DEFAULT_WABA_ID = '104200042667877' // Kgolaentle Holdings, recorded 2026-04-08.
const GRAPH_API_VERSION = 'v21.0'

const TEMPLATE_DEFINITION = {
  name: 'post_match_customer_provider_accepted',
  language: 'en_ZA',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text:
        'Hi {{1}}, great news — {{2}} has accepted your {{3}} request and will contact you shortly to confirm the visit. Tap below to view the details.',
      example: { body_text: [['Stephanie', 'Sipho', 'Plumbing']] },
    },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: 'View request',
          url: 'https://app.plugapro.co.za/requests/{{1}}',
          example: ['https://app.plugapro.co.za/requests/demo-job-request-id'],
        },
      ],
    },
  ],
} as const

async function main(): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim().replace(/\\n$/, '')
  if (!accessToken) {
    console.error(
      'WHATSAPP_ACCESS_TOKEN is required. Source your env first:\n' +
        '  set -a && source .env.production.local && set +a\n' +
        'Or paste it inline:\n' +
        '  WHATSAPP_ACCESS_TOKEN=EAAB... pnpm --filter field-service exec tsx scripts/submit-post-match-customer-template.ts',
    )
    process.exit(1)
  }

  const wabaId =
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ||
    process.env.WHATSAPP_WABA_ID?.trim() ||
    DEFAULT_WABA_ID
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`

  console.error(`[submit-template] POST ${url}`)
  console.error(`[submit-template] template name: ${TEMPLATE_DEFINITION.name} (${TEMPLATE_DEFINITION.category}, ${TEMPLATE_DEFINITION.language})`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(TEMPLATE_DEFINITION),
  })

  const data = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    const metaError = data.error as Record<string, unknown> | undefined
    const metaCode = metaError?.code
    const metaMessage = String(metaError?.message ?? '')

    const alreadyExists =
      metaMessage.toLowerCase().includes('already exists') ||
      metaMessage.toLowerCase().includes('name has already been used')

    if (alreadyExists) {
      console.error('[submit-template] template already exists — no action needed.')
      console.log(JSON.stringify({ ok: true, alreadyExists: true, name: TEMPLATE_DEFINITION.name }))
      process.exit(0)
    }

    console.error('[submit-template] Meta rejected the submission:')
    console.error(JSON.stringify(data, null, 2))
    if (metaCode === 200 || metaMessage.toLowerCase().includes('permission')) {
      console.error(
        '\nHint: the access token does NOT have `whatsapp_business_management` scope, OR it cannot edit this WABA. ' +
          'Open Meta Business Manager → System Users → check the token scope.',
      )
    }
    process.exit(1)
  }

  console.error('[submit-template] success — template submitted for review.')
  console.log(
    JSON.stringify({
      ok: true,
      name: TEMPLATE_DEFINITION.name,
      id: data.id,
      status: data.status,
      category: data.category,
    }),
  )

  console.error(
    '\nNext: poll for approval.\n' +
      `  curl -s 'https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${TEMPLATE_DEFINITION.name}' \\\n` +
      `    -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" | jq '.data[] | {name,status,category}'\n` +
      'Approval is typically minutes to a few hours. Status moves PENDING → APPROVED (or REJECTED with reason).',
  )
}

main().catch((err) => {
  console.error('[submit-template] unexpected error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
