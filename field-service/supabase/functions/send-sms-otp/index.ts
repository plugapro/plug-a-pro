// ─── Supabase Auth Hook: Send SMS OTP via SMSPortal ───────────────────────────
// Triggered by Supabase whenever a phone OTP needs to be sent.
//
// Configure in: Supabase Dashboard → Auth → Auth Hooks → Send SMS
// Hook type: HTTPS
// URL: https://<project-ref>.supabase.co/functions/v1/send-sms-otp
//
// Required env vars (set via: supabase secrets set KEY=value):
//   SMSPORTAL_CLIENT_ID      — SMSPortal API client ID
//   SMSPORTAL_CLIENT_SECRET  — SMSPortal API secret
//   SEND_SMS_HOOK_SECRET     — shared secret set in Supabase Auth Hooks dashboard
//                              (format: v1,whsec_<base64> — copied from dashboard)

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const SMSPORTAL_CLIENT_ID     = Deno.env.get('SMSPORTAL_CLIENT_ID')!
const SMSPORTAL_CLIENT_SECRET = Deno.env.get('SMSPORTAL_CLIENT_SECRET')!
const HOOK_SECRET_FULL        = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? ''
// Strip the v1,whsec_ prefix — the standardwebhooks library expects raw base64
const HOOK_SECRET_RAW         = HOOK_SECRET_FULL.replace('v1,whsec_', '')

const SMSPORTAL_AUTH_URL = 'https://rest.smsportal.com/Authentication'
const SMSPORTAL_SEND_URL = 'https://rest.smsportal.com/v1/bulkmessages'

// ─── SMSPortal auth — exchange client credentials for a Bearer token ──────────

async function getSMSPortalToken(): Promise<string> {
  const credentials = btoa(`${SMSPORTAL_CLIENT_ID}:${SMSPORTAL_CLIENT_SECRET}`)
  const res = await fetch(SMSPORTAL_AUTH_URL, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  if (!res.ok) {
    throw new Error(`SMSPortal auth failed: ${res.status} ${await res.text()}`)
  }
  const { token } = await res.json()
  if (!token) throw new Error('SMSPortal: no token in auth response')
  return token
}

// ─── Send a single OTP message ────────────────────────────────────────────────

async function sendOtp(phone: string, otp: string): Promise<void> {
  const token = await getSMSPortalToken()

  const body = {
    messages: [
      {
        content: `Your Plug-A-Pro code is ${otp}. Valid for 10 minutes. Do not share this code.`,
        destination: phone,
      },
    ],
  }

  const res = await fetch(SMSPORTAL_SEND_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`SMSPortal send failed: ${res.status} ${await res.text()}`)
  }
}

// ─── Hook handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const reqId = crypto.randomUUID().slice(0, 8)
  const log   = (msg: string) => console.log(`[send-sms-otp:${reqId}] ${msg}`)

  // Read body as text first (required for standardwebhooks verification)
  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)

  // Log all incoming header names for diagnosis
  const headerNames = Object.keys(headers).join(', ')
  log(`DEBUG: headers present: ${headerNames}`)
  log(`DEBUG: hook_secret_full len=${HOOK_SECRET_FULL.length} raw len=${HOOK_SECRET_RAW.length}`)

  let verified = false

  // Strategy 1: Standard Webhooks HMAC (GoTrue sends webhook-id/timestamp/signature)
  if (HOOK_SECRET_RAW && headers['webhook-id']) {
    try {
      const wh = new Webhook(HOOK_SECRET_RAW)
      wh.verify(payload, headers)
      verified = true
      log('DEBUG: standardwebhooks verification passed')
    } catch (err) {
      log(`DEBUG: standardwebhooks failed — ${String(err)}`)
    }
  }

  // Strategy 2: Simple Bearer token (older GoTrue versions)
  if (!verified && HOOK_SECRET_FULL) {
    const authHeader = headers['authorization'] ?? ''
    if (authHeader === `Bearer ${HOOK_SECRET_FULL}`) {
      verified = true
      log('DEBUG: bearer token verification passed')
    } else {
      log(`DEBUG: bearer check failed — recv="${authHeader.slice(0, 20)}..." exp="Bearer ${HOOK_SECRET_FULL.slice(0, 20)}..."`)
    }
  }

  if (!verified) {
    log(`WARN: unauthorized — neither standardwebhooks nor bearer matched`)
    return new Response('Unauthorized', { status: 401 })
  }

  let parsedPayload: { user?: { phone?: string }; sms?: { otp?: string } }
  try {
    parsedPayload = JSON.parse(payload)
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const phone = parsedPayload.user?.phone
  const otp   = parsedPayload.sms?.otp

  if (!phone || !otp) {
    log(`WARN: missing fields — phone=${!!phone} otp=${!!otp}`)
    return json({ error: 'Missing phone or otp in payload' }, 400)
  }

  log(`sending OTP to phone=${phone.slice(0, 6)}****`)

  try {
    await sendOtp(phone, otp)
    log(`sent OK phone=${phone.slice(0, 6)}****`)
    return json({})
  } catch (err) {
    log(`ERROR: ${String(err)}`)
    return json({ error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
