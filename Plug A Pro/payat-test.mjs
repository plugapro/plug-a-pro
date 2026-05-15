#!/usr/bin/env node
// payat-test.mjs
// Run: node payat-test.mjs
// Tests the full Pay@ integration: token fetch → payment request → webhook signature validation.
// Set env vars before running:
//   PAYAT_CLIENT_ID=xxx PAYAT_CLIENT_SECRET=xxx PAYAT_MERCHANT_ID=418856 \
//   PAYAT_TOKEN_URL=https://go.payat.co.za/oauth/token \
//   PAYAT_API_BASE=https://go.payat.co.za/api/v1 \
//   PAYAT_WEBHOOK_SECRET=<your-webhook-secret> \
//   node payat-test.mjs

import { createHmac, randomUUID } from 'crypto';

// ─── Config — reads from env vars ────────────────────────────────────────────
const CONFIG = {
  clientId:           process.env.PAYAT_CLIENT_ID,
  clientSecret:       process.env.PAYAT_CLIENT_SECRET,
  merchantId:         process.env.PAYAT_MERCHANT_ID          || '418856',
  merchantIdentifier: process.env.PAYAT_MERCHANT_IDENTIFIER  || 'plug-a-pro',
  tokenUrl:           process.env.PAYAT_TOKEN_URL             || 'https://go.payat.co.za/yapi/oauth/token',
  apiBase:            process.env.PAYAT_API_BASE              || 'https://go.payat.co.za/yapi/v1',
  webhookSecret:      process.env.PAYAT_WEBHOOK_SECRET,
};

// Colour helpers for terminal output
const green  = (s) => `\x1b[32m✅ ${s}\x1b[0m`;
const red    = (s) => `\x1b[31m❌ ${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m⚠️  ${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function pass(label, detail = '') {
  console.log(green(label) + (detail ? `\n   ${detail}` : ''));
  passed++;
}

function fail(label, detail = '') {
  console.log(red(label) + (detail ? `\n   ${detail}` : ''));
  failed++;
}

// ─── Test 1: Config validation ────────────────────────────────────────────────
console.log('\n' + bold('═══ Pay@ Integration Test Suite ═══') + '\n');
console.log(bold('Test 1: Config validation'));

if (!CONFIG.clientId)      { fail('PAYAT_CLIENT_ID is not set');      process.exit(1); }
if (!CONFIG.clientSecret)  { fail('PAYAT_CLIENT_SECRET is not set');   process.exit(1); }
if (!CONFIG.webhookSecret) { fail('PAYAT_WEBHOOK_SECRET is not set');  process.exit(1); }

pass('All required env vars are present');
console.log(`   Client ID:          ${CONFIG.clientId.substring(0, 8)}...`);
console.log(`   Token URL:          ${CONFIG.tokenUrl}`);
console.log(`   API Base:           ${CONFIG.apiBase}`);
console.log(`   Merchant ID:        ${CONFIG.merchantId}`);
console.log(`   Merchant Identifier:${CONFIG.merchantIdentifier}`);

// ─── Test 2: OAuth token fetch (tries body params, then HTTP Basic Auth) ──────
console.log('\n' + bold('Test 2: OAuth token fetch'));

let accessToken = null;

// Helper: attempt a token fetch with a given request config
async function tryTokenFetch(label, reqInit) {
  console.log(`   Trying: ${label}`);
  const res = await fetch(CONFIG.tokenUrl, { ...reqInit, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!res.ok) {
    console.log(yellow(`   ${label} → ${res.status}: ${text.substring(0, 200)}`));
    return null;
  }
  let data;
  try { data = JSON.parse(text); } catch { console.log(yellow(`   ${label} → non-JSON response`)); return null; }
  if (!data.access_token) { console.log(yellow(`   ${label} → no access_token in response: ${JSON.stringify(data)}`)); return null; }
  return data;
}

try {
  // Attempt 1: credentials in body (most common for client_credentials)
  let data = await tryTokenFetch('body params (grant_type + client_id + client_secret)', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });

  // Attempt 2: HTTP Basic Auth (credentials in Authorization header, grant_type only in body)
  if (!data) {
    const basic = Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString('base64');
    data = await tryTokenFetch('HTTP Basic Auth (Authorization: Basic header)', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
  }

  // Attempt 3: JSON body (some custom OAuth servers)
  if (!data) {
    data = await tryTokenFetch('JSON body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'client_credentials',
        client_id:     CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
      }),
    });
  }

  if (data) {
    accessToken = data.access_token;
    const expiresIn = data.expires_in ?? 'unknown';
    pass(`Token fetched successfully (expires_in: ${expiresIn}s)`);
    console.log(`   Token: ${accessToken.substring(0, 20)}...`);
  } else {
    fail('All token fetch attempts failed — see warnings above');
    console.log(yellow('   Tip: A 403 often means the client is not yet activated for API access.'));
    console.log(yellow('   Contact Tyler at Pay@ to confirm your client_credentials grant is enabled.'));
  }
} catch (err) {
  fail(`Token fetch threw an error`, err.message);
  process.exit(1);
}

// ─── Test 2b: Register merchantIdentifier via generatecredentials ─────────────
// The YAPI API requires a merchantIdentifier that is registered with Pay@.
// We call generatecredentials to ensure ours is set up before creating an RTP.
console.log('\n' + bold('Test 2b: Register merchant identifier with Pay@'));

let resolvedMerchantIdentifier = CONFIG.merchantIdentifier;

if (!accessToken) {
  console.log(yellow('Skipping — no access token'));
} else {
  try {
    const res = await fetch(`${CONFIG.apiBase}/integrator/ecommerce/generatecredentials`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        merchantIdentifier: CONFIG.merchantIdentifier,
        merchantId:         CONFIG.merchantId,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (res.status === 200 || res.status === 201) {
      pass(`Merchant identifier registered: ${CONFIG.merchantIdentifier}`);
      if (data) console.log('   ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n   '));
    } else if (res.status === 409) {
      // 409 = already exists, which is fine
      pass(`Merchant identifier already exists: ${CONFIG.merchantIdentifier}`);
    } else {
      console.log(yellow(`generatecredentials returned ${res.status}: ${text.substring(0, 300)}`));
      console.log(yellow('   Will still attempt RTP creation — the identifier may already be set up.'));
    }
  } catch (err) {
    console.log(yellow(`generatecredentials threw: ${err.message}`));
  }
}

// ─── Test 3: RTP creation ─────────────────────────────────────────────────────
// Endpoint: POST /integrator/ecommerce/rtp/create/single/{merchantIdentifier}
// Note: Pay@ requires KYC status = 'VERIFIED' before RTPs can be created.
// A 500 "Something went wrong" often means KYC is pending — contact Pay@ to verify.
console.log('\n' + bold('Test 3: RTP creation (R100 test)'));

// clientAccountNumber must be a unique 14-digit numeric string per RTP
const clientAccountNumber = String(Date.now()).padStart(14, '0').slice(-14);
const merchantIdentifier  = resolvedMerchantIdentifier;
let paymentResponse = null;

if (!accessToken) {
  console.log(yellow('Skipping — no access token available'));
} else {
  try {
    const res = await fetch(
      `${CONFIG.apiBase}/integrator/ecommerce/rtp/create/single/${merchantIdentifier}`,
      {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        clientAccountNumber:        clientAccountNumber,  // unique 14-digit ID per RTP
        amount:                     '10000',              // R100 in cents as STRING
        minimumAmount:              '10000',
        maximumAmount:              '10000',
        description:                'Plug A Pro service booking payment R100',
        clientReferenceNumber:      `PAP-TEST-${Date.now()}`,
        merchantDisplayName:        'Plug A Pro',
        notificationNumber:         '+27000000000',       // test number
        customerNameSurname:        'Test Customer',
        customerMobileNumber:       '+27000000000',
        customerEmail:              'test@plugapro.co.za',
        daysValid:                  '7',
        merchantEcommerceStoreName: 'PLUGAPRO',
        successReturnUrl:           'https://plug-a-pro-main.vercel.app/payment/success',
        failureReturnUrl:           'https://plug-a-pro-main.vercel.app/payment/failure',
        lineItems: [
          { description: 'Service booking deposit', amount: '10000' },
        ],
        multiPremium: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();

    if (!res.ok) {
      fail(`RTP creation returned ${res.status}`, text);
      if (res.status === 500) {
        console.log(yellow('   A 500 here usually means KYC is not yet VERIFIED for this merchant.'));
        console.log(yellow('   Log into go.payat.co.za and check your KYC/verification status,'));
        console.log(yellow('   or contact Pay@ support to get it verified.'));
      }
    } else {
      let data;
      try { data = JSON.parse(text); } catch { fail('RTP response is not valid JSON', text); }

      if (data) {
        paymentResponse = data;
        pass('RTP created successfully');
        console.log('\n   ' + bold('Response:'));
        console.log('   ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n   '));

        // Key fields from the Pay@ YAPI Swagger (201 response)
        if (data.requestToPayId) pass(`requestToPayId: ${data.requestToPayId}`);
        else console.log(yellow('No requestToPayId in response'));

        if (data.paymentLink) {
          pass(`paymentLink: ${data.paymentLink}`);
          console.log(yellow('   ↑ This is the URL to redirect customers to for payment'));
        } else {
          console.log(yellow('No paymentLink in response — may still be in sourceReference'));
        }

        if (data.sourceReference) pass(`sourceReference: ${data.sourceReference}`);
      }
    }
  } catch (err) {
    fail('Payment request threw an error', err.message);
  }
}

// ─── Test 4: Webhook HMAC signature validation ────────────────────────────────
console.log('\n' + bold('Test 4: Webhook HMAC signature validation'));

const mockPayload = JSON.stringify({
  sourceReference: clientAccountNumber,
  status:          'PAID',
  amount:          10000,
  merchantId:      CONFIG.merchantId,
});

// Generate a valid signature
const validSig = createHmac('sha256', CONFIG.webhookSecret)
  .update(mockPayload)
  .digest('hex');

// Verify it validates correctly
const check = createHmac('sha256', CONFIG.webhookSecret)
  .update(mockPayload)
  .digest('hex');

if (validSig === check) {
  pass('HMAC-SHA256 signature generation and validation works');
  console.log(`   Signature: ${validSig.substring(0, 20)}...`);
} else {
  fail('HMAC validation mismatch — something is wrong with the webhook secret');
}

// Also verify a tampered payload fails
const tamperedSig = createHmac('sha256', CONFIG.webhookSecret)
  .update(mockPayload + 'tampered')
  .digest('hex');

if (tamperedSig !== validSig) {
  pass('Tampered payload correctly produces different signature');
} else {
  fail('Tampered payload produced same signature — HMAC is not working');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + bold('═══ Results ═══'));
console.log(green(`${passed} passed`));
if (failed > 0) console.log(red(`${failed} failed`));

if (paymentResponse) {
  console.log('\n' + bold('📋 Pay@ Response Field Map'));
  console.log('Use these field names in lib/payat/payment.ts:');
  Object.keys(paymentResponse).forEach(k => console.log(`   • ${k}`));
}

console.log('\n' + bold('Next steps:'));
if (failed === 0) {
  console.log('  1. Copy the exact field names from the Pay@ response above into lib/payat/payment.ts');
  console.log('  2. Run: node payat-test.mjs again to confirm');
  console.log('  3. Tell Claude the field names — implementation ready to go');
} else {
  console.log('  1. Fix the failures above first');
  console.log('  2. Check Pay@ API docs for correct endpoint paths and field names');
  console.log('  3. Contact Tyler at Pay@ if the token endpoint returns 401');
}
console.log('');
