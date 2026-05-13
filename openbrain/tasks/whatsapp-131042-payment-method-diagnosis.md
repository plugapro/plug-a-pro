# WhatsApp send block: Meta error 131042 — payment method missing

Status: diagnosed, awaiting user action
Date: 2026-05-12

## 2026-05-13 verification update

Status after read-only re-check: application and WABA prerequisites are healthy; billing activation remains the only unproven gate for error 131042.

Verified on 2026-05-13:
- Production deployment is `READY` on Vercel, aliased to `app.plugapro.co.za`, running commit `a2655b4e30289d810b35a5a16e14e0542279267e`.
- `https://app.plugapro.co.za/api/health` returned `200` with `db: "ok"`, `whatsapp: "ok"`, and `payments: "ok"`.
- Production `auth.otp.whatsapp` feature flag is enabled in the database.
- WABA `104200042667877` still resolves to `Kgolaentle Holdings`; account review is `APPROVED`; business verification is `verified`; currency is `USD`.
- Production phone number resolves to `+27 69 355 2447`; Cloud API status is reachable; quality rating is `GREEN`; throughput is `STANDARD`.
- WhatsApp templates are all approved: 1 Authentication template, 23 Utility templates, 4 Marketing templates. `otp_login` is `APPROVED` in `en_ZA`.

Important distinction:
- The Meta Graph API read checks prove credentials, WABA review, phone reachability, and template approval.
- They do not prove billing eligibility. Error 131042 only closes after a billable template send succeeds or Meta Business Suite shows an active payment method on the WABA billing account.

Current close-out path:
1. Human operator confirms the WABA billing account has an active payment method, or adds one in Meta Business Suite.
2. Run one real billable `otp_login` send to the configured admin/test number.
3. If the send succeeds, mark 131042 resolved. If it fails with 131042 again, open Meta Business Support because WABA review and business verification are already healthy.

Secondary status:
- Display name status remains `DECLINED` for `PlugAPro`. This is not the 131042 root cause because the phone is reachable and quality is green, but it still needs a separate resubmission/appeal path.

## 2026-05-13 post-card-entry assessment

User reported that card details were populated on the business profile.

Read-only verification repeated after that update:
- Production `/api/health` still returns `200` with `db: "ok"`, `whatsapp: "ok"`, and `payments: "ok"`.
- Production `auth.otp.whatsapp` flag remains enabled.
- WABA `104200042667877` remains `APPROVED`; business verification remains `verified`.
- Phone `+27 69 355 2447` remains Cloud API reachable, `GREEN` quality, `STANDARD` throughput.
- `otp_login` remains `APPROVED`; no templates are non-approved.

Assessment:
- If the card was added to the WABA billing/payment account, the next real billable template send should clear the incident.
- If the card was added only to the Meta business profile, ad account, or a general Business Suite payment profile, `131042` may persist. The card must be attached to the WhatsApp Business Account billing asset/payment account for WABA `104200042667877`.

Next required proof:
1. Confirm in Meta Business Suite billing that the payment method is active for the WhatsApp Business Account / WABA asset `104200042667877`, not only the parent business profile.
2. Run one real billable `otp_login` send to a test/admin number.
3. If Meta returns `131042` again despite the active WABA payment method, escalate to Meta Business Support with the evidence that WABA review, business verification, phone, template, app deployment, and feature flag are all healthy.

## 2026-05-13 billing-attachment check attempt

Tried to verify directly whether the card is attached to the WABA billing asset.

Result:
- Graph API confirms WABA ownership/health and `owner_business_info`, but payment-account fields such as `payment_account`, `payment_account_id`, `billing_payment_account`, and `billing_payment_account_id` are not readable on the WABA object.
- Business-level WABA/payment edges require `business_management`, which the current WhatsApp access token does not have.
- Direct read of the known payment account ID `1278298302794428` is blocked by Meta permissions / unsupported object access.
- Browser access to the billing URL redirects to Meta login in the automation session, so the authenticated Business Suite billing UI could not be inspected from here.

Conclusion:
- Card attachment to the WABA billing asset is not yet independently verified by the agent.
- A human must visually confirm the card appears under the WhatsApp Business Account / WABA billing settings for asset `104200042667877`, or authorize one real billable `otp_login` test send as the operational proof.

## 2026-05-13 browser retry

Retried the Meta browser verification.

Observed:
- Direct asset billing URL redirected to `business.facebook.com/latest/billing_hub/accounts/details/...asset_id=104200042667877...` and showed "Sorry, this content isn't available at the moment".
- Generic `business.facebook.com/latest/billing_hub/payment_settings/` failed with `ERR_TOO_MANY_REDIRECTS`.
- Business Settings WABA URL redirected to the Meta Business login/create-business-portfolio flow.

Conclusion:
- The browser automation session still cannot access the authenticated Business Suite billing page for this WABA.
- This does not prove the card is absent. It only proves the current browser session lacks the right Meta authenticated/permission context for the billing UI.
- The remaining options are human visual confirmation in the logged-in Meta UI, or one authorized billable `otp_login` send as operational proof.

## 2026-05-13 authenticated billing confirmation

After the user logged in with the relevant Meta account, the browser reached the correct WABA billing pages.

Confirmed URLs / identifiers:
- Billing account page: `payment_account_id=1278298302794428`
- Business ID: `167675401665793`
- WABA asset ID: `104200042667877`
- WABA selector on Payment methods tab: `Kgolaentle Holdings (104200042667877)`

Confirmed UI state:
- Account details page shows `Payment methods` → `You haven't added any payment methods.`
- WABA-specific Payment methods tab shows `No payment methods added`.
- The page includes an `Add payment method` button for this WhatsApp Business account.

Conclusion:
- The card is not attached to the WhatsApp Business Account billing asset for WABA `104200042667877`.
- This remains the active root cause for Meta error `131042`.

Required next action:
1. On the WABA-specific Payment methods tab, click `Add payment method`.
2. Attach the card to `Kgolaentle Holdings (104200042667877)`.
3. Return to the same tab and verify the card appears under the WABA.
4. Run one real billable `otp_login` test send to confirm `131042` is cleared.

## 2026-05-13 card attachment confirmed

After the user added the card on the WABA-specific billing screen, the browser refreshed the Payment methods page.

Confirmed state:
- URL remained scoped to `business_id=167675401665793`, `asset_id=104200042667877`, `payment_account_id=1278298302794428`.
- Business portfolio section now shows a MasterCard payment method.
- WhatsApp Business accounts tab remained selected.
- WABA selector shows `Kgolaentle Holdings (104200042667877)`.
- WABA-specific payment method list now shows the same MasterCard as `Default`.

Conclusion:
- The card is now attached to the WhatsApp Business Account billing asset for WABA `104200042667877`.
- The original missing-payment-method root cause should be resolved at the Meta billing configuration layer.

Remaining verification:
- Run one real billable `otp_login` send. If it succeeds, close the `131042` incident.
- If it still returns `131042`, wait a short Meta propagation window and retry once. If the second retry fails, escalate to Meta Business Support with the confirmed WABA billing screenshot/state and the healthy WABA/template evidence above.

## 2026-05-13 billable send verification — resolved

A real `otp_login` template send was run against the configured production WhatsApp Cloud API phone number after card attachment.

Result:
- Request returned HTTP `200`.
- Meta returned a WhatsApp message ID: `wamid.HBgLMjc3NjI0MTE3ODMVAgARGBJCOTcxMTc2OUVDN0Y4NUY3ODQA`.
- No `131042` billing/payment error was returned.

Conclusion:
- Meta billing is now active for WABA `104200042667877`.
- The `131042` incident is resolved.
- Remaining non-blocking Meta issue: display name status is still `DECLINED` for `PlugAPro`; handle separately from billing/send delivery.

## 2026-05-13 Lovemore login check

User tested Lovemore login after card attachment.

Production identity checked:
- Provider: `Lovemore Sibanda`
- Provider status: `ACTIVE`
- Test cohort: `isTestUser=true`
- Login phone: `+27823035070`

Latest OTP delivery attempt:
- Created at `2026-05-13T10:10:57.114Z`
- Template: `otp_login`
- Initial send produced a WhatsApp message ID: `wamid.HBgLMjc4MjMwMzUwNzAVAgARGBJDMkZGNUY3RTQ1RDRCRTI4N0QA`
- Final delivery status: `failed`
- Failure code: `131042`
- Failure reason: `Business eligibility payment issue`

Browser billing follow-up:
- Payment Activity for the WABA still shows no transactions for the selected period.

Conclusion:
- Lovemore's tested OTP did not go through.
- The send was accepted initially but failed at Meta delivery status with `131042`.
- Most likely causes are Meta billing propagation delay after card attachment, or Meta still has a backend billing eligibility hold despite the card now appearing as default on the WABA.

Next action:
1. Wait a short propagation window and retry Lovemore login once.
2. If the retry still fails with `131042`, escalate to Meta Business Support with:
   - WABA `104200042667877`
   - Payment account `1278298302794428`
   - Evidence that the WABA-specific Payment methods tab shows a default card
   - Failed message ID from Lovemore's attempt
   - Confirmation that WABA review, business verification, phone quality, and template approval are all healthy

## 2026-05-13 Lovemore provider login final verification — closed

User reported OTP was received and provider login completed successfully.

Production verification:
- Provider: `Lovemore Sibanda`
- Provider ID: `04e41353-e599-476f-938c-6898941d21c3`
- Provider status: `ACTIVE`
- Phone: `+27823035070`
- Recent `otp_login` delivery attempts at `2026-05-13T10:21:27Z` and `2026-05-13T10:21:34Z` show status `delivered`.
- Audit log contains `auth.otp_verify_success` at `2026-05-13T10:22:22.837Z`.
- Successful verification audit references provider ID `04e41353-e599-476f-938c-6898941d21c3`.

Conclusion:
- Lovemore OTP delivery and provider login are confirmed working in production.
- The WABA `131042` incident is closed end-to-end.
- Non-blocking follow-up remains Meta display-name remediation for `PlugAPro`.

## Symptom

Sends from the production WhatsApp pipeline returned Meta error code 131042. Error description: WABA blocked from sending messages because of a billing/payment issue on the Meta side.

## Root cause

No payment method on file for the Kgolaentle Holdings WABA payment account.

Observed in Meta Business Suite > Billing & payments for the relevant WABA:
- Payment account ID: 1278298302794428
- WABA asset ID: 104200042667877 (Kgolaentle Holdings)
- Business ID: 167675401665793
- Current balance: $0.00
- Payment methods section: "You haven't added any payment methods."
- Payment activity: "You have no recent spending."

This blocks every paid message category — Authentication, Marketing, business-initiated Utility. Customer-initiated service messages within the 24-hour window remain free and continue to deliver. That is why prior insights still show 540 free customer service deliveries this month while authentication-category sends are rejected.

## Why authentication sends are affected

OTP delivery through the `otp_login` template falls under the Authentication message category, which is billable per conversation. With no card on file, Meta will not authorise paid conversations.

The `otp_login` template itself is healthy: status Active – Quality pending, body fixed by Meta as `{{1}} is your verification code. For your security, do not share this code. Expires in 5 minutes.` plus a Copy code button. Submission for this template is recorded in the WhatsApp Meta Business Profile memory note.

## Production code path

Production sends use `WHATSAPP_PHONE_NUMBER_ID`, not `WHATSAPP_WABA_ID`. Reference: `field-service/lib/whatsapp.ts:83`. `WHATSAPP_WABA_ID` only appears in `field-service/scripts/register-whatsapp-templates.mjs` and is not used at runtime.

The phone number in the env var almost certainly resolves to +27 69 355 2447 (PlugAPro), which sits under the Kgolaentle Holdings WABA. That is the same WABA with the missing payment method, which closes the loop on the error.

## Required user action

The AI assistant in this session cannot enter card details, settle balances, or update payment methods. A human must:

1. Open https://business.facebook.com/billing_hub/payment_settings/?asset_id=104200042667877&business_id=167675401665793
2. Click "Add payment method"
3. Add a valid card. Card number, expiry, and CVV are entered by the human directly.
4. Sends resume immediately once the card is active. No redeploy, no template re-submission, no flag changes.

## Verification once payment is added

- Trigger a real OTP send through the production endpoint. If WhatsApp delivery lands, the issue is closed.
- Confirm card status in Meta Business Suite > Billing & payments > Payment activity. The card record should read Active.
- Watch WhatsApp Manager > Insights for new "Approximate charges" line items.
- Optional: check WhatsApp Manager > Account Quality for any remaining holds.

## If 131042 persists after a card is active

The remaining likely cause is incomplete Business Verification in Meta Business Manager. That step is separate from payment and is required for higher messaging tiers. It usually does not block basic sends, but it is the next item to check if billing has been resolved and the error continues.

## Secondary issues spotted while diagnosing

Not the 131042 root cause, but real and worth tracking:

1. Display name "PlugAPro" was REJECTED for +27 69 355 2447. The number remains Connected with High quality, so messages will send under a fallback name (likely the legal entity "Kgolaentle Holdings") until a revised display name is submitted and approved.
2. +27 66 423 8087 (ServiceMyBike Joburg) is still "In review" / Unverified at Meta. Pending Meta review.

These can be addressed separately. The 131042 fix does not depend on either of them.

## Related infrastructure context

This diagnosis sits inside the broader OTP-via-WhatsApp activation that already completed in the same session:
- Upstash Redis provisioned and connected to the plug-a-pro Vercel project (Pay-As-You-Go, Dublin).
- `SUPABASE_AUTH_HOOK_SECRET` set in Vercel Production.
- Supabase Send SMS hook rewired to https://app.plugapro.co.za/api/auth/hooks/send-sms with the new shared secret.
- `field-service/lib/rate-limit.ts` patched to accept either the canonical Upstash env var names or Vercel's KV-prefixed names.
- `otp_login` template submitted on Kgolaentle Holdings WABA.

The remaining gates before the WhatsApp OTP flow is fully live are:
- Push the rate-limit.ts change and let Vercel redeploy.
- Enable the `auth.otp.whatsapp` flag with the seed-flags script.
- Resolve this 131042 payment-method gap.
