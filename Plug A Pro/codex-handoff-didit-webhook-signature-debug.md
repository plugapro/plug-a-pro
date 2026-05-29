# Codex handoff — Didit webhook signature debug

Last updated: 2026-05-29 by Cowork
Repo: `plugapro/plug-a-pro`
Working tree: `/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro/field-service`
Vercel project: `plug-a-pro` under team `lebogangs-projects-6ffadd97` (project id `prj_xHSXSrkueFjJezsgi8xkR3EpGGya`)
Operator: Lebo (`iamfootprint` on GitHub; signed in to Vercel + Didit Business Console in Chrome)

---

## 1. The goal

Get the Didit identity-verification webhook endpoint at `https://app.plugapro.co.za/api/webhooks/verification/didit` to **return 200** when Didit's "Test Webhook" button POSTs a sample event from `https://business.didit.me/`. It currently returns **401 INVALID_SIGNATURE**.

The 401 is **our app rejecting Didit's signature**, not Didit refusing us. HMAC-SHA256 on the same message with what should be the same secret produces different digests on the two sides. Until this works, no real provider can complete KYC because the route would reject Didit's real callbacks the same way.

This blocks the Didit pilot rollout. Everything *around* signature verification has been verified working — env vars present, route reachable, adapter registered, config strictness firing — so the bug is narrow and lives in `signing.ts` and/or how we feed it the secret.

---

## 2. What's already been done

### 2.1 Vercel production+preview env (set via dashboard UI, all marked Sensitive)
- `DIDIT_PROVIDER_KYC_WORKFLOW_ID` = `aacaa8ad-5334-4a94-98ae-a56e824b6186` (KYC + AML workflow)
- `DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID` = `030d6dec-ac69-4800-8b52-6d098821fe89` (Custom KYC workflow, default for provider onboarding)
- `DIDIT_API_KEY` = (Didit "Primary" key — value leaked into the Cowork chat transcript during paste; **rotate after this work is done**)
- `DIDIT_WEBHOOK_SECRET` = (43-character string copied from the "Plug A Pro production" destination's Signing secret panel)

### 2.2 Didit webhook destination created
- Name: `Plug A Pro production`
- URL: `https://app.plugapro.co.za/api/webhooks/verification/didit`
- Subscribed events: `status.updated`, `data.updated`, `user.status.updated`, `user.data.updated`
- Version: v3
- Destination ID: `a06f7283-231...29a6...` (truncated in UI)

### 2.3 Two debug-logging commits landed on `main`
- `be2ef5442` — first probe; logs `our_hmac_canonical`, `our_hmac_raw_body`, `secret_length`, `raw_body`, `canonical`
- `889f253ae` — second probe; adds `our_hmac_b64decoded_canonical`, `our_hmac_b64decoded_raw`, `secret_b64decoded_length`

Both are additive, gated on the request header `X-Didit-Test-Webhook: true`. Real production webhooks (which never carry that header) never trigger the log. Grep `TEMP-DIDIT-DEBUG` to find every line to revert when this work is done.

### 2.4 OpenBrain entry already logged
`ops — Didit credentials added to Vercel production (2026-05-29)` in OpenBrain project `PlugAPro`, domain `engineering`. Add a new entry there when the fix lands.

---

## 3. The diagnostic data we have

Captured from Vercel runtime logs after sending Didit's Test Webhook with the second probe deployed. The payload is the standard `status.updated, approved, All Features` test event Didit generates.

```text
provided_v2:                    d641411b656ca53eec73e234f772f5572444917f0d27a43910960730abf0ae74
provided_v1:                    d641411b656ca53eec73e234f772f5572444917f0d27a43910960730abf0ae74
provided_simple:                f3333b283350ce3e0f1a6c89d6c6b1bc53e1b9d80b62c28e4822db26487527d1
provided_timestamp:             1780045046

our_hmac_canonical:             37ba747873f69024532268305ab867ada946745730f392cc14ecf498d755c809
our_hmac_raw_body:              37ba747873f69024532268305ab867ada946745730f392cc14ecf498d755c809
our_hmac_b64decoded_canonical:  488d31407a8cad2116e7a456142c5ec778b06f4e6cef1d8633565b9e2239138a
our_hmac_b64decoded_raw:        (Vercel UI obscured this from the JS readout; same value, easy to re-capture)

raw_body_length:                3713
canonical_length:               3713
raw_body == canonical:          true
secret_length:                  43
secret_b64decoded_length:       (obscured by Vercel UI, but base64-decode of 43 unpadded chars = 32 bytes)

raw_body first 200 chars:
  {"created_at":1780045046,"decision":{"aml_screenings":[{"hits":[],"is_ongoing_monitoring_enabled":false,"node_id":"node-aml-1","ongoing_monitoring_last_check":null,"screened_data":{"date_of_birth":"19...

raw_body last 200 chars:
  ...67c59-5482-4e4b-8475-0e7adc967517","status":"Approved","timestamp":1780045046,"vendor_data":"test-vendor-data-123","webhook_type":"status.updated","workflow_id":"030d6dec-ac69-4800-8b52-6d098821fe89"}
```

**Headers from the same delivery:**
```
X-Signature-V2:                 d641411b656ca53eec73e234f772f5572444917f0d27a43910960730abf0ae74
X-Signature-Simple:             f3333b283350ce3e0f1a6c89d6c6b1bc53e1b9d80b62c28e4822db26487527d1
X-Timestamp:                    1780045046
X-Didit-Test-Webhook:           true
User-Agent:                     DiditWebhook/2.0 +https://didit.me
```

---

## 4. What this rules out

| Hypothesis | Status | Why |
|---|---|---|
| Our canonical JSON differs from Didit's | **Ruled out** | `raw_body == canonical` for this payload (keys already sorted, no non-ASCII to escape). Our HMAC over canonical and over raw body are identical, so canonicalization is a no-op here. |
| V1 vs V2 algorithm differ | **Ruled out** | `provided_v1 == provided_v2`. For an ASCII-sorted payload, both Didit variants produce the same bytes. Confirms the docs' algorithm. |
| Secret needs base64-decoding before HMAC | **Ruled out** | `our_hmac_b64decoded_canonical` (computed with `Buffer.from(secret, 'base64')`) does not match `provided_v2` either. |
| `signing.ts` has a hidden bug like wrong digest encoding | **Unlikely** | Both `our_hmac_*` values are 64 hex chars (32 raw bytes) = valid SHA-256 output. Algorithm is invoked correctly. |
| Secret got truncated/expanded on paste | **Unlikely but unproven** | `secret_length` is exactly 43 — the canonical unpadded-base64 length of 32 bytes. Off-by-one paste error would give 42 or 44. |

---

## 5. The remaining hypotheses (in priority order)

### Hypothesis A — Test webhooks sign with a different secret than the destination's `secret_shared_key` (most likely)
The `X-Didit-Test-Webhook: true` header on every test delivery is the smoking gun. Didit's published webhook docs say "test webhooks use the same signing as production," but the persistent failure across three independent probes strongly suggests they don't. Real production deliveries from a real KYC flow may sign correctly with the secret we hold.

### Hypothesis B — Didit prepends/appends data to the message before signing
e.g. some webhook providers sign `"<timestamp>.<body>"` (Stripe) or `"<destination_id>.<body>"`. The docs we found don't mention this for Didit, but the docs also said V2 == canonical JSON only and we confirmed V1 == V2 here, which means either (a) the docs are imperfectly accurate, or (b) something else is being signed. (a) makes (B) plausible.

### Hypothesis C — A second secret displayed *under* the visible one in the destination panel is the actual signing key
The Didit Webhooks UI shows "Signing secret" with eye + copy icons. We copied via the copy icon. There may be a secondary "rotation key" or an unrelated value the copy button captures. Worth re-opening the destination and confirming visually which 43-char value is in Vercel.

### Hypothesis D — Cloudflare or Vercel rewrites the request body in transit
Very unlikely for `application/json` POST bodies, and `runtime = 'nodejs'` on the route means `request.text()` returns raw bytes. But not zero-probability.

### Hypothesis E — Didit's `Test Webhook` UI is broken / they're aware of it
A few webhook providers' test panels diverge from production behavior. Worth a Didit support ping in parallel. WhatsApp +19544659728 is documented as their fastest channel.

---

## 6. The exact next probes to add

These are the next debug-log iterations to commit. Each probe is ~10 lines added to `field-service/app/api/webhooks/verification/[vendor]/route.ts` inside the existing `TEMP-DIDIT-DEBUG` block. Order them by which hypothesis they discriminate.

### Probe 1 — does the secret itself produce the simple HMAC? (tests hypothesis A)
Compute `HMAC(secret_string, "<ts>:<sid>:<status>:<type>")` and compare to `provided_simple`. The simple message is small, parser-independent, and uses the exact same secret. If this matches, the secret is correct and the body-hashing must be where the divergence lives. If it does not match, **the secret itself is wrong** — and Hypothesis A or C is confirmed.

```ts
const simpleMessage = [
  body.timestamp ?? '',
  body.session_id ?? '',
  body.status ?? '',
  body.webhook_type ?? '',
].join(':')
const ourHmacSimple = secret
  ? createHmac('sha256', secret).update(simpleMessage, 'utf8').digest('hex')
  : null
const ourHmacSimpleB64 = secretB64Bytes
  ? createHmac('sha256', secretB64Bytes).update(simpleMessage, 'utf8').digest('hex')
  : null
```
You'll need to parse `rawBody` to get `body.timestamp`, etc. — do it inside the existing try/catch so a bad payload doesn't break the log.

### Probe 2 — `<timestamp>.<body>` prefix (tests hypothesis B)
```ts
const timestampPrefixedRaw = `${headers['x-timestamp']}.${rawBody}`
const ourHmacTsRaw = secret
  ? createHmac('sha256', secret).update(timestampPrefixedRaw, 'utf8').digest('hex')
  : null
const ourHmacTsRawB64 = secretB64Bytes
  ? createHmac('sha256', secretB64Bytes).update(timestampPrefixedRaw, 'utf8').digest('hex')
  : null
```

### Probe 3 — secret prefix/suffix sanity check
Log `secret.slice(0, 4)` and `secret.slice(-4)` so the operator can manually verify against what Didit's destination panel shows. This is a tiny leak (8 chars of 43, no full key) and disposable.

```ts
secret_first_4: secret?.slice(0, 4) ?? null,
secret_last_4: secret?.slice(-4) ?? null,
```

### Probe 4 — alternate base64 variants
```ts
const secretB64UrlBytes = secret
  ? Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  : null
const ourHmacB64UrlCanonical = secretB64UrlBytes
  ? createHmac('sha256', secretB64UrlBytes).update(rawBody, 'utf8').digest('hex')
  : null
```

Commit all four probes together in a single commit (less Vercel cycle time) and push to `main` directly. Each Vercel build runs about 1m 40s.

---

## 7. How to deploy + test (the loop)

Each iteration is the same routine:

```bash
# 1. Edit field-service/app/api/webhooks/verification/[vendor]/route.ts
# 2. Commit + push
cd "/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro/field-service"
git checkout main
git pull origin main
git add app/api/webhooks/verification/\[vendor\]/route.ts
git commit -m "debug(identity): TEMP — <what this probe tests>"
git push origin main

# 3. Wait for Vercel build (about 1m 40s)
# Check: https://vercel.com/lebogangs-projects-6ffadd97/plug-a-pro/deployments

# 4. Fire the Test Webhook
# Open: https://business.didit.me/  → workspace "Plug A Pro" → Developers → Webhooks
# Click "Test Webhook" → Send Webhook (or "Send Another" if a previous result is showing)

# 5. Read the log
# Open: https://vercel.com/lebogangs-projects-6ffadd97/plug-a-pro/logs
# Search box (NOT URL query param): type "TEMP-DIDIT-DEBUG" + Return
# Click the latest 401 POST entry, scroll the bottom panel
```

To get the full JSON out of Vercel's log UI (it truncates), open Chrome DevTools on the Vercel logs tab and run:
```js
JSON.parse(document.body.innerText.match(/TEMP-DIDIT-DEBUG\s+(\{[\s\S]*?\})\s*(?:TEMP-DIDIT-DEBUG|MAY 29|$)/)[1])
```
Note: Vercel's UI masks fields it detects as sensitive (anything that looks like base64 or hex). That's why our earlier JS extraction showed `[BLOCKED: Base64 encoded data]` for the HMACs. The values *are* there in the underlying log entry — read them off the inline-rendered text or use the Vercel API.

---

## 8. The fix shape (whichever hypothesis wins)

| If probe shows | Then the fix is |
|---|---|
| `ourHmacSimple == provided_simple` and body hash still wrong | Body is being mutated in transit (Hypothesis D); investigate Vercel/Cloudflare body handling. Possibly switch to `request.arrayBuffer()` and verify byte-exactness. |
| `ourHmacSimple != provided_simple` | Secret itself is wrong (Hypothesis A or C); re-copy from Didit destination, paste into Vercel, redeploy. Or detect that test webhooks use a different secret and either ask Didit support or skip test-webhook signature verification only in non-prod. |
| `ourHmacTsRaw == provided_v2` | Didit prepends `<timestamp>.` to the message (Hypothesis B); fix `signing.ts` to do the same. |
| `ourHmacB64UrlCanonical == provided_v2` | Secret is base64url-encoded, not base64; decode appropriately in `signing.ts`. |
| Nothing matches | Open a ticket with Didit support and escalate. Include the request body, headers, and three HMAC variants. WhatsApp +19544659728 or `hello@didit.me`. |

In all cases, the production fix also requires:
- New unit test in `field-service/__tests__/lib/identity-verification/vendors/didit/signing.test.ts` that uses a **captured real Didit signature** (not a self-signed one) so we don't repeat the "tested against itself" trap. Hard-code the captured payload + provided HMAC + secret in the test and assert verification returns `valid: true`. **This is the most important test in this file.**
- Revert all `TEMP-DIDIT-DEBUG` lines in `route.ts` (one block + three imports).
- Add a feature-flag or pilot allowlist check before any real webhook reaches the orchestrator (Layer 3 of the test plan, see § 11).

---

## 9. Key code locations

| File | Purpose |
|---|---|
| `field-service/app/api/webhooks/verification/[vendor]/route.ts` | Entry point. Has the current `TEMP-DIDIT-DEBUG` block. |
| `field-service/lib/identity-verification/vendors/didit/signing.ts` | HMAC verifier. Contains `verifyDiditWebhookSignature`, `canonicalJson`, `canonicalJsonOrNull`. |
| `field-service/lib/identity-verification/vendors/didit/config.ts` | Env-loader. Throws `DiditConfigError` in production when any required env var is missing. Exports `getDiditConfig`. |
| `field-service/lib/identity-verification/vendors/didit/parse.ts` | Calls `verifyDiditWebhookSignature`. |
| `field-service/lib/identity-verification/vendors/didit/client.ts` | Outbound API calls. Header is `X-Api-Key`. Base URL `https://verification.didit.me`. Session path `/v3/session/`. |
| `field-service/lib/identity-verification/vendors/registry.ts` | Vendor adapter registry — confirms didit is wired in (`if (vendorKey === 'didit') return diditVerificationAdapter`). |
| `field-service/__tests__/lib/identity-verification/vendors/didit/signing.test.ts` | Circular tests (sign + verify with same `canonicalJson`). Add a fixture-based test alongside, see §8. |
| `field-service/docs/runbooks/didit-credentials-activation.md` | Operator runbook for env-var rollout. Outdated — see §11 for the corrected rollout flow. |

---

## 10. Useful reference data

Didit's docs page (Mintlify-hosted):
- Webhooks guide: https://docs.didit.me/integration/webhooks
- Documentation index (LLM-friendly text): https://docs.didit.me/llms.txt
- Sessions API: https://docs.didit.me/sessions-api/overview

Didit's documented Node reference for V2 verification (relevant excerpt):
```js
function shortenFloats(data) { /* whole-valued floats → ints */ }
function sortKeys(obj) { /* alphabetical recursive */ }
const canonical = JSON.stringify(sortKeys(shortenFloats(body)));
const expected = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
```
In JavaScript, `shortenFloats` is effectively a no-op because `JSON.parse("92.0") === 92` (integer); `JSON.stringify` then emits `"92"` for both cases. Our implementation's `canonicalJsonOrNull` matches the documented recipe.

---

## 11. Layer 3 — pilot rollout (deferred until signature fix lands)

Once Layer 2 (signature verification) returns 200, the pilot can be turned on. **Do not touch any of these before §8's fix is in production.** Steps (separate runbook):

1. Set `verification_vendor_configs.active = true` for the `didit` row (Prisma query, schema location in `field-service/prisma/schema.prisma`).
2. Enable the `provider.identity.vendor.didit` feature flag in the DB / env JSON via `field-service/scripts/seed-flags.ts` or directly through the admin flags surface.
3. Insert one test provider into `ProviderIdentityVerificationPilotAllowlist`.
4. Have that provider start the onboarding flow at the Plug A Pro PWA. The session-create call hits Didit's `/v3/session/`. Didit issues a hosted-flow URL. Provider completes the flow. Didit POSTs a real (non-test) webhook to `/api/webhooks/verification/didit`.
5. Watch:
   - Vercel logs for the webhook arriving and processing
   - DB row in `ProviderVerificationWebhookEvent`
   - Status transition on the provider's `ProviderIdentityVerification` row

Rollback: flip the flag off, set `active = false` on the vendor config row. The pilot allowlist row can stay.

---

## 12. Open follow-ups (independent of the signature fix)

- **Rotate the Didit Primary API key.** Its plaintext value leaked into the Cowork chat transcript during the Vercel modal paste step. Didit UI → Developers → API Keys → ⋯ → Rotate, then edit `DIDIT_API_KEY` in Vercel.
- **Revert the `TEMP-DIDIT-DEBUG` block** in `route.ts` (one `if (...)` block plus three imports). Grep is sufficient.
- **Write the fixture-based unit test** described in §8 so the next person doesn't fall into the self-signed-test trap.
- **Optionally drop the unused `legal/consolidate-into-terms` debug commit** that's still on that branch (`6dca6be91`). It will harmlessly become a no-op when the branch merges to main, but you can `git reset --hard HEAD^` on the branch if you want a clean history.

---

## 13. Quick context — house rules from `CLAUDE.md`

- No `as any` without a nearby TODO explaining why.
- Additive Prisma migrations only — no drops/renames in feature PRs.
- Every admin mutation through `crudAction()` (N/A here — webhook ingest is its own path).
- Smoke coverage in `field-service/e2e/smoke.spec.ts` should be extended to hit the webhook endpoint with a known-good fixture once the fix is in.
- Project memory and implementation logs go to OpenBrain, never to local tracker files.

---

## 14. One-paragraph summary for Codex

The Didit webhook endpoint returns 401 INVALID_SIGNATURE because our HMAC-SHA256 of the request body using `DIDIT_WEBHOOK_SECRET` does not equal Didit's `X-Signature-V2`. Two debug-log iterations (commits `be2ef5442` and `889f253ae`, both on main and live in production) have proved that the canonical-JSON recipe is correct (raw body already equals canonical for this payload), V1 and V2 are the same hash, and base64-decoding the secret produces yet another different HMAC. The next step is a third debug iteration that adds (a) the "simple" message HMAC, (b) a timestamp-prefixed body variant, (c) base64url variant, and (d) a 4-char prefix/suffix of the secret for human verification. Once one of those matches, fix `signing.ts` accordingly, add a fixture-based test against the captured real Didit signature, revert the debug block (grep `TEMP-DIDIT-DEBUG`), then proceed to Layer 3 pilot rollout. The operator is signed in to Vercel and Didit in Chrome and pushes to `main` directly — house rules allow it for this kind of small additive change.
