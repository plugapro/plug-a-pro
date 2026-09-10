# VodaPay Mini Program Application

## Partner Form Answers

| Field | Value |
|---|---|
| Business name | Kgolaentle Solutions (Pty) Ltd t/a Plug A Pro |
| Nature of business | Home services |
| Product offering | On-demand vetted home-service bookings (plumbing, electrical, handyman) in Johannesburg West |
| App URL | https://app.plugapro.co.za/vodapay |
| Website | https://plugapro.co.za |

## Open Questions for VodaPay (from research §7.1)

1. Commission or flat fee per transaction inside a mini program; settlement terms and bank account.
2. Is a PWA (HTML5) mini program accepted for public release, or does QA require Native? Does "quality review not supported" mean skipped or blocked?
3. Legal entity: CIPC mandatory? sole prop accepted? FICA documents for the Merchant-ID?
4. Can Peach / Pay@ be used for payment inside the mini program, or VodaPay cashier only?
5. Refund, partial refund and payment-inquiry APIs for mini programs.
6. The send API behind `NOTIFICATION_PUSH` / `NOTIFICATION_INBOX`, rate limits, template approval.
7. Is the phone number from `inquiryUserInfo` KYC-verified?
8. Discovery/ranking inside the consumer app; services category; can a mini program be geo-restricted to Gauteng/Johannesburg?
9. Current SA MAU and mini-program count (last: 5.8m registered FY24; "over 100 mini-apps" May 2023).
10. End-to-end lead time and the SMME mini-program onboarding owner (only address found: miniprogramsupport@vodacom.co.za).
11. Contract counterparty: Vodacom Financial Services, Alipay Singapore, or both?

## Sandbox Testers

| Name | Email | Apple ID / Gmail | Device |
|---|---|---|---|
| ⚠️ OWNER INPUT REQUIRED | ⚠️ OWNER INPUT REQUIRED | ⚠️ OWNER INPUT REQUIRED | ⚠️ OWNER INPUT REQUIRED |
| | | | |
| | | | |

## QA Mapping

| VodaPay QA item | Plug A Pro test |
|---|---|
| Auth positive/negative | /vodapay login happy path + declined-consent fallback to inline OTP |
| Full sunny-day journey | address → describe → confirm → quote accept → tradePay → paid state |
| All tenders (card, SOV, coupons) | pay one booking with each tender in sandbox wallet |
| After-sales communication | booking confirmation + review link visible in /bookings |
| MSISDN validation | phone from inquiryUserInfo matches session customer |
| No crashes / error handling | kill network mid-checkout → retry screen; expired quote → clear message |
