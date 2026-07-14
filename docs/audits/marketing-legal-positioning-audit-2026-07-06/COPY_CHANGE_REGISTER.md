# Copy Change Register — 2026-07-06

18 amendments. All on branch `chore/positioning-audit`. Legend: **Meta⚠** = template body approved at Meta; the in-repo rewording does **not** change live sends until the new body is submitted to and approved by Meta (placeholder count/order kept identical in every case).

---

## Field-service (12)

### CC-01 — `field-service/lib/messaging-templates.ts` — WhatsApp template `technician_assigned` **Meta⚠**
- **Old:** "Hi {{1}}, great news! {{2}} has been assigned to your {{3}} on {{4}}. They will contact you through this app only."
- **New:** "Hi {{1}}, great news! Independent provider {{2}} is confirmed for your {{3}} on {{4}}. They will contact you through this app only."
- **Reason:** "has been assigned" reads as the platform allocating its own worker.
- **Risk reduced:** employer impression. **Legal review:** N (copy), Y for eventual template set sign-off.

### CC-02 — `field-service/lib/messaging-templates.ts` — WhatsApp template `technician_on_the_way` **Meta⚠**
- **Old:** "Hi {{1}}, your Plug A Pro technician {{2}} is heading your way now. Expected arrival in {{3}} - see you soon!"
- **New:** "Hi {{1}}, your service provider {{2}} is heading your way now. Expected arrival in {{3}} - see you soon!"
- **Reason:** "your Plug A Pro technician" was the strongest employer-impression claim on the platform, in a live customer send.
- **Risk reduced:** employer impression (Critical). **Legal review:** N.

### CC-03 — `field-service/lib/messaging-templates.ts` — WhatsApp template `extra_work_approval` **Meta⚠**
- **Old:** "Hi {{1}}, your technician has found additional work needed: {{2}} ({{3}}). Approve or decline using the button below."
- **New:** "Hi {{1}}, your service provider has identified additional work needed: {{2}} ({{3}}). Approve or decline using the button below."
- **Reason:** "your technician" employer framing. **Risk reduced:** employer impression. **Legal review:** N.

### CC-04 — `field-service/lib/messaging-templates.ts` — WhatsApp template `customer_match_found` (Meta template id 1508767677372957) **Meta⚠**
- **Old:** "…We've matched your {{2}} request with {{3}}.\n\nThey're highly rated and ready to assist you.\n\nTrack your request…"
- **New:** "…We've matched your {{2}} request with {{3}}.\n\nYou can review their details and quote before approving anything.\n\nTrack your request…"
- **Reason:** "highly rated" asserted generically regardless of actual rating data; replacement also reinforces customer decision responsibility.
- **Risk reduced:** misleading quality claim. **Legal review:** N.

### CC-05 — `field-service/scripts/register-whatsapp-templates.mjs` — `technician_assigned` registration body
- **Old/New:** as CC-01 (registration script aligned with `messaging-templates.ts`).
- **Reason:** same template name carried the old body in the registration script. **Risk reduced:** employer impression + template-source divergence. **Legal review:** N.

### CC-06 — `field-service/scripts/register-whatsapp-templates.mjs` — `technician_application_received` registration body
- **Old:** "Hi {{1}}, we received your application to join Plug a Pro. Ref: {{2}}. We review all applications within 24 hours and will update you here."
- **New:** "Hi {{1}}, we received your Plug A Pro provider application. Ref: {{2}}. We will review your details and update you here. Approval is not automatic."
- **Reason:** 24-hour SLA promise diverged from `messaging-templates.ts` (no-SLA + approval-not-automatic); same template name had two different bodies.
- **Risk reduced:** unmet SLA promise; source divergence. **Legal review:** N.

### CC-07 — `field-service/lib/whatsapp-flows/status.ts:845` — customer shortlist rendering
- **Old:** `item.verified ? ' ✓ verified' : ''`
- **New:** `item.verified ? ' ✓ ID verified' : ''` (+ explanatory comment)
- **Reason:** `provider.verified` is KYC/identity only; a bare "verified" badge implies skill/workmanship vetting.
- **Risk reduced:** overstated vetting (High). **Legal review:** N.

### CC-08 — `field-service/app/provider/signup/confirmation/page.tsx:13` — provider signup confirmation screen
- **Old:** "We'll WhatsApp you within 30 minutes once an admin reviews it."
- **New:** "We'll WhatsApp you once your application has been reviewed - most reviews happen within one business day. Approval is not automatic."
- **Reason:** hard 30-minute review promise, contradicted by all other SLA copy.
- **Risk reduced:** unmet SLA promise / expectation mismatch. **Legal review:** N.

### CC-09 — `field-service/app/(customer)/for-providers/page.tsx` — provider recruitment page (2 occurrences, replace-all)
- **Old:** "Approval usually takes under 24 hours."
- **New:** "Applications are reviewed before approval - most within one business day."
- **Reason:** SLA promise; also reinforces that review precedes approval.
- **Risk reduced:** unmet SLA promise; overstated ease of approval. **Legal review:** N.

### CC-10 — `field-service/lib/whatsapp-flows/help.ts:44` — WhatsApp help menu row
- **Old:** `title: '👷🏽 Our providers'`
- **New:** `title: '👷🏽 Service providers'`
- **Reason:** possessive "our" implies employment. **Risk reduced:** employer impression (mild). **Legal review:** N.

### CC-11 — `field-service/lib/whatsapp-flows/help.ts` — WhatsApp help FAQ body (`faq_technician`)
- **Old:** "👷🏽 *Our Providers*\n\nPlug A Pro shows provider profiles…"
- **New:** "👷🏽 *Providers on Plug A Pro*\n\nProviders are independent service providers. Plug A Pro shows provider profiles…"
- **Reason:** possessive header; added explicit independence statement at the top of the customer-facing provider explainer.
- **Risk reduced:** employer impression. **Legal review:** N.

### CC-12 — `field-service/app/(customer)/services/page.tsx:40` — customer request-a-service screen
- **Old:** "Pick a category and describe your job. We'll match you with skilled providers."
- **New:** "Pick a category and describe your job. We'll match you with independent local providers."
- **Reason:** "skilled" is an implicit platform skill-vetting claim on a booking surface.
- **Risk reduced:** overstated vetting (mild). **Legal review:** N.

---

## Marketing (6)

### CC-13 — `marketing/lib/jsonld.ts` — `serviceLd()` structured data
- **Old:** `provider: { "@type": "Organization", name: "Plug A Pro", … }`
- **New:** `broker: { "@type": "Organization", name: "Plug A Pro", … }` (+ comment)
- **Reason:** schema.org `Service.provider` asserts the entity performs the service; `broker` is the schema.org property for "an entity that arranges for an exchange between a buyer and a seller". Emitted on every `/services/[slug]` and `/areas/[city]/[service]` page.
- **Risk reduced:** we-perform-the-work claim in durable structured data. **Legal review:** N. **Note:** may affect Service rich-result eligibility; monitor GSC after deploy.

### CC-14 — `marketing/lib/jsonld.ts` — `localBusinessLd()` structured data
- **Old:** no `description` field.
- **New:** `description: siteConfig.description` ("…connect with independent local service providers…").
- **Reason:** `LocalBusiness` typing alone reads as a local service business; the description clarifies marketplace nature.
- **Risk reduced:** employer/we-perform impression in structured data (partial mitigation; full typing review is P3). **Legal review:** N.

### CC-15 — `marketing/app/(marketing)/for-customers/page.tsx:191-196` — protections section
- **Old:** heading "How we protect you"; subline "Letting a stranger into your home takes trust. Here's how Plug A Pro builds it."
- **New:** heading "How Plug A Pro reduces your risk"; subline "Letting someone new into your home takes trust. Here's how Plug A Pro helps you make an informed choice."
- **Reason:** "protect you" implies a protection duty/assurance; new copy frames the platform as informing the customer's choice.
- **Risk reduced:** overstated platform assurance / implied duty of care. **Legal review:** N.

### CC-16 — `marketing/app/(marketing)/about/page.tsx:24-27` — About page "What we do"
- **Old:** "…finding a trustworthy person to fix it is harder than it should be… Plug A Pro solves that." / "We match customers with skilled local service providers in their area… We find nearby available local pros. Both sides connect, confirm and get the job done."
- **New:** "…finding the right person to fix it is harder than it should be… Plug A Pro closes that gap." / "We connect customers with independent local service providers in their area… We help match them to nearby available local pros. Customers review the provider's details and quote, then decide who to appoint. Both sides connect, confirm and get the job done."
- **Reason:** "trustworthy… solves that" implied the platform vouches for trustworthiness; "skilled" implied skill vetting; the decision step (customer reviews and appoints) was missing.
- **Risk reduced:** overstated vetting; missing customer-responsibility framing. **Legal review:** N.

### CC-17 — `marketing/lib/chat-context.ts` — AI chatbot FAQ content
- **Old:** FAQ ended at support question; no employment/vetting/liability entries.
- **New:** added two Q&As: "Does Plug A Pro employ the service providers?" (No — independent; platform facilitates; provider responsible for work) and "Are providers vetted or verified?" (application review + ID/KYC; not a guarantee of skill/licensing/insurance/workmanship; customer reviews details; ask for certification for regulated work).
- **Reason:** the chatbot is a generative public surface that previously had none of the site's disclaimers available to it.
- **Risk reduced:** chatbot inventing/overstating claims. **Legal review:** N.

### CC-18 — `marketing/lib/chat-context.ts` — AI chatbot system prompt
- **Old:** "Do not make up features, pricing or commitments not listed below." (only guardrail)
- **New:** added a "Positioning rules (always follow)" block: marketplace/intermediary; does not employ providers or perform work; never say "vetted/certified/guaranteed/insured/background-checked"; describe review + ID/KYC exactly; never guarantee outcomes; customers choose and review.
- **Reason:** hard behavioural guardrails for the generative surface, mirroring `banned-copy.ts`.
- **Risk reduced:** chatbot claim risk (systemic). **Legal review:** N.
