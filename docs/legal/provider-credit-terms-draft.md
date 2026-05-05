# Provider Credit Terms Draft

Status: draft for attorney/legal review.

TODO legal review:

- Confirm whether credits should be described as non-cash, non-transferable platform credits in all jurisdictions where Plug A Pro operates.
- Confirm refund and reversal language for invalid leads, duplicate leads, technical failures, and approved support reviews.
- Confirm expiry wording for starter/onboarding credits and purchased credits.
- Confirm required notice period for updates to credit rules.
- Confirm misuse, fraud, suspension, and credit reversal rights.
- Confirm support and escalation wording.

Implementation note:

- Provider-facing copy should say "starter credits", "onboarding credits", "credit balance", "top up credits", and "1 credit is used when you accept a lead".
- Provider-facing copy must not mention "promo pilot phase".
- The public fallback terms page is `field-service/app/provider/terms/credits/page.tsx`.
- Runtime links should use `PROVIDER_TERMS_URL` when configured, otherwise `NEXT_PUBLIC_PROVIDER_TERMS_URL`, otherwise `${NEXT_PUBLIC_APP_URL}/provider/terms/credits`, otherwise `/provider/terms/credits`.
