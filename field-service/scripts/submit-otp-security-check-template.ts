/**
 * One-shot script to register the `otp_security_check` WhatsApp template
 * with Meta via the WhatsApp Business Management API.
 *
 * Run from the repo root (or field-service/) with production env loaded:
 *
 *   pnpm --filter field-service exec tsx scripts/submit-otp-security-check-template.ts
 *
 * Required env:
 *   WHATSAPP_ACCESS_TOKEN          — must have `whatsapp_business_management`
 *                                    scope (same scope used by sendTemplate)
 *
 * Optional env:
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   — WABA id. Defaults to the value recorded
 *                                    approved for Plug A Pro on 2026-06-02.
 *                                    Override here if your project's WABA
 *                                    has changed since.
 *
 * Behaviour:
 *   - POSTs the template definition to Meta's Graph API.
 *   - Exits 0 on success OR on `Template already exists` (idempotent).
 *   - Exits 1 on any real failure (auth, scope, validation).
 *   - Never prints the access token. Prints the WABA id (public identifier).
 *
 * Output: a JSON line on stdout with { id, status, category } on success.
 */

const DEFAULT_WABA_ID = '104200042667877' // Approved otp_security_check WABA, 2026-06-02.
const GRAPH_API_VERSION = 'v18.0'

const TEMPLATE_DEFINITION = {
  name: 'otp_security_check',
  language: 'en_ZA',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: "Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn't request this, tap below to block it — your account stays safe.",
    },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'QUICK_REPLY',
          text: "I didn't request this",
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
        '  set -a && source .env.local && set +a\n' +
        'Or paste it inline:\n' +
        '  WHATSAPP_ACCESS_TOKEN=EAAB... pnpm --filter field-service exec tsx scripts/submit-otp-security-check-template.ts',
    )
    process.exit(1)
  }

  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || DEFAULT_WABA_ID
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

    // Meta returns code 100 with a specific subcode for "name already taken"
    // OR a clear-text "already exists" message. Treat both as success.
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
    '\nNext: poll for approval. Either via Meta Business Manager → Message Templates, ' +
      'or via API:\n' +
      `  curl -s 'https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${TEMPLATE_DEFINITION.name}' \\\n` +
      `    -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" | jq '.data[] | {name,status,category}'\n` +
      'Approval is typically minutes to a few hours. Status moves PENDING → APPROVED (or REJECTED with reason).',
  )
}

main().catch((err) => {
  console.error('[submit-template] unexpected error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
