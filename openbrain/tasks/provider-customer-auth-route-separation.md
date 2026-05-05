# Provider/customer auth route separation

Date: 2026-05-05

Decision:
Customer-owned routes such as `/bookings` and `/profile` must always route unauthenticated users to customer sign-in. Provider sign-in must only accept provider-owned callback destinations and must normalize customer callbacks such as `/bookings` to the provider jobs entry point.

Implementation note:
Role-specific redirect helpers now sit on top of the existing local-path open-redirect guard. Customer sign-in uses customer-safe callbacks, provider sign-in and provider OTP verification use provider-safe callbacks, and provider jobs are exposed through `/provider/jobs` while reusing the existing provider jobs dashboard.

UX rule:
Provider-not-found errors must not imply that a customer profile is missing. The provider sign-in recovery state must offer customer sign-in, provider application via WhatsApp, and support, while keeping technical diagnostics behind optional support details.
