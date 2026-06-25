# WhatsApp messaging guidelines

Provider and customer-facing WhatsApp message bodies must never show raw URLs.

Bad:

`Credit history: https://app.plugapro.co.za/provider/credits`

Good:

`Credit history is available below.`

CTA: `View credit history`

Rules:
- Put actual URLs only in WhatsApp CTA URL buttons, approved template URL buttons, or supported interactive URL components.
- Do not use Markdown links in WhatsApp bodies.
- Do not expose signed URLs, private URLs, tokens, or internal admin URLs in visible body text.
- Use `ctaLabelFor()` / `ctaLink()` from `lib/whatsapp-copy.ts` for shared CTA labels.
- All central WhatsApp send helpers run `assertNoRawUrlsInWhatsAppBody()` before sending body text.
