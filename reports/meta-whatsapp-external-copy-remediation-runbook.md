# Meta / WhatsApp External Copy Remediation Runbook
## Claude Code Browser Execution Pack

Date: 2026-04-10

## 1. Purpose

This runbook is for a browser-based audit in Meta Business Manager, WhatsApp Business Manager, Facebook Pages, ads, message templates, and operator macros that may sit outside the Plug-A-Pro repository.

The objective is to find every place where externally managed copy implies stronger platform responsibility or stronger provider vetting than Plug-A-Pro actually supports.

This runbook assumes the auditor is using Chrome automation and can log into:

- Meta Business Manager
- WhatsApp Business Manager
- Facebook Page settings and inbox tools
- ad assets and lead forms
- any connected FAQ / quick reply / saved reply tooling

## 2. Audit Scope

Inspect all user-visible and operator-visible text in:

1. WhatsApp Business approved templates
2. WhatsApp welcome messages
3. WhatsApp quick replies / saved replies
4. Customer support macros
5. Provider onboarding macros
6. Facebook Page About text
7. Facebook Page CTA text
8. ads, ad variations, headlines, descriptions, and captions
9. lead forms
10. trust / safety / policy snippets in Meta-hosted surfaces
11. Business Manager internal note templates that staff may copy into chats

## 3. Exact Blocked Terms To Search For

Search exact and close variants of:

- verified
- vetted
- trusted
- trusted professional
- approved professional
- qualified
- certified
- safe
- safer
- screened
- background checked
- guaranteed
- protected
- secure provider
- recommended provider
- reliable every time
- on time every time
- fully verified
- professional you can trust
- trusted worker
- trusted handyman
- trusted plumber
- trusted electrician
- safe to hire
- checked by us
- inspected by us
- quality guaranteed
- workmanship guaranteed
- satisfaction guaranteed
- refund guaranteed

Also search phrase patterns like:

- “we verify”
- “we vet”
- “we screen”
- “our providers are checked”
- “we guarantee”
- “all providers are”
- “every provider is”
- “safe and trusted”
- “qualified experts”

## 4. Classification Rules

Each claim found must be classified as one of:

### Accurate

Use only if the exact claim is directly supported by implemented and repeatable operational process.

Examples:

- “We record customer reviews completed through Plug-A-Pro.”
- “You can review quote history before accepting.”

### Overstated

The direction is partly true, but the wording is stronger than the actual process.

Examples:

- “Reviewed providers” when the process is only marketplace admission review
- “Safer hiring” when there are records and audit trails, but no stronger safety controls

### Misleading

The wording is likely to make users believe the platform has verified, guaranteed, or enforced something it does not.

Examples:

- “Verified provider”
- “Trusted worker”
- “Approved professional”

### Unsupported

No implemented process exists behind the claim.

Examples:

- “Background checked”
- “ID-verified”
- “Skill-assessed”
- “Guaranteed workmanship”

## 5. Rewrite Rules

When a claim is overstated, misleading, or unsupported, rewrite it using one of these patterns.

### Preferred honest replacements

- `provider profile`
- `independent provider`
- `application reviewed for marketplace participation`
- `provider-supplied details`
- `provider-shared evidence`
- `platform-recorded job history`
- `customer reviews collected on Plug-A-Pro`
- `quote, booking, and job record kept in writing`
- `risk reduced through records and traceability`

### Replace these terms

| Bad term | Replace with |
|---|---|
| verified provider | provider profile / reviewed marketplace profile |
| vetted worker | nearby provider / matched provider |
| trusted professional | independent provider |
| qualified worker | provider whose profile matches the job type |
| safe to hire | review the provider profile, work history, and quote before proceeding |
| guaranteed | recorded / coordinated / documented |
| screened | application reviewed for marketplace participation |

### Rewrite style rules

- Keep trust without inventing assurance
- Prefer narrow factual statements
- Distinguish what the provider says from what the platform records
- Never imply licensing, legality, or safety unless that exact check exists

## 6. Screenshots And Evidence To Capture

Capture one screenshot for every risky claim before changing it.

Required screenshot set:

1. Template list view showing the template name
2. Template detail view showing the exact risky text
3. Facebook ad or Page section showing the risky phrase in context
4. Any support macro / saved reply editor where risky wording appears
5. Post-change screenshot showing corrected wording

Use this filename pattern:

- `meta-copy-risk-[surface]-[template-or-asset-name]-before.png`
- `meta-copy-risk-[surface]-[template-or-asset-name]-after.png`

Also record:

- exact phrase
- location
- current classification
- rewritten text
- whether the change was made
- whether approval was required

## 7. Immediate Change vs Escalation Rules

### Change immediately if

- the wording is clearly unsupported
- no legal commitment is implied by the replacement
- the new copy simply narrows language to factual behaviour

Examples:

- replace `verified provider` with `provider profile`
- replace `trusted professional` with `independent provider`
- replace `guaranteed` with `documented` or remove it entirely

### Escalate for product/legal review if

- the copy touches refunds, liability, insurance, or safety commitments
- the copy may be contractually tied to a campaign or approved policy
- the team might intend to launch a real verification programme later
- changing the message affects regulated categories or legal disclaimers

Examples:

- refund promises
- insurance references
- safety promises
- claims about licences or certifications

## 8. Browser Execution Checklist

### Phase 1: WhatsApp Template Audit

1. Open WhatsApp Business Manager template library
2. List all active, draft, and paused templates
3. Search template names and bodies for blocked terms
4. Open each matching template
5. Classify the claim
6. Capture before screenshot
7. Rewrite if safe to change immediately
8. Capture after screenshot or mark as escalated

### Phase 2: Facebook Page / Business Copy Audit

1. Open Page About / Services / CTA sections
2. Search manually for blocked trust and guarantee terms
3. Capture before screenshots
4. Rewrite using the preferred patterns
5. Capture after screenshots

### Phase 3: Ads / Lead Forms

1. Open active ads and draft campaigns
2. Inspect headlines, body copy, CTA text, lead form intro text, thank-you text
3. Search for blocked terms and implied safety/verification promises
4. Capture before screenshots
5. Rewrite or escalate

### Phase 4: Operator Macros / Saved Replies

1. Open all saved replies or macros used by support and onboarding
2. Search for risky terms
3. Rewrite any unsupported trust claims
4. Preserve service tone, but keep the platform role honest

## 9. Deliverables Claude Code Should Produce

At the end of browser execution, Claude Code should produce:

1. `external-meta-copy-risk-register.md`
2. `external-meta-corrected-claims.md`
3. `external-meta-escalations.md`
4. Screenshot bundle with before/after evidence

Each entry should include:

- surface
- asset name
- exact risky phrase
- classification
- rewrite
- action taken
- escalation required or not

## 10. Final Instruction To The Browser Auditor

The rule is simple:

- preserve trust
- remove fake assurance
- keep the marketplace honest

Plug-A-Pro can claim transparency, records, coordination, matching, reviews, and auditability where implemented.

It cannot claim provider character, safety, legality, competence, or workmanship guarantees unless a real labelled process supports each claim.
