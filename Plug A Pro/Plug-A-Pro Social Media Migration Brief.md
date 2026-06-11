# Plug A Pro – Social Media Account Migration Brief

**Prepared for:** AI cowork assistant / technical coordinator helping with the migration
**Owner:** the business owner (Kgolaentle Holdings)
**Subject:** Move operational control of Plug A Pro social assets from `<shared-inbox@example.com>` to `<owner-email@example.com>`

---

## 1. Task Introduction

Plug A Pro's social presence (Facebook Page, Instagram, Meta Business Suite, WhatsApp Business, ad accounts, pixel, catalogue, and any linked domains) is currently sitting under the `<shared-inbox@example.com>` email. We need to move proper ownership and admin control to `<owner-email@example.com>`, which is the correct business owner identity for Kgolaentle Holdings (Reg <COMPANY_REG_NO>).

This is not a simple "change the email" job. Think of it more like changing the locks on a shop. We need to cut new keys for the right person, test that they actually open every door, and only then take the old keys back. If we rush this, the business can get locked out of its own page, which would be a real problem for customer communication and any live ads.

The work will mostly happen inside Meta Business Suite, Business Manager, and the Facebook Page settings. Some steps will need a real human in front of a screen, because Meta's security flow doesn't let an AI log in and click around on a private account.

---

## 2. Why This Task Matters

Right now, `<shared-inbox@example.com>` is a generic shared inbox. That's risky for a few reasons:

If someone leaves the team, or that mailbox gets compromised, or password recovery emails go to a place no one is watching, the business effectively loses its social media. For a service business like Plug A Pro, the Facebook Page and WhatsApp number ARE the front door. Customers find us there, message us there, and trust the brand they see there. Losing that, even for a few days, hurts revenue and reputation.

There's also a governance angle. Meta tracks who legally owns a Business Portfolio. If the registered admin is a generic inbox rather than the business owner, it weakens our position if we ever need to prove ownership during a recovery dispute or business verification. Linking the assets to `<owner-email@example.com>` puts control in the right hands and makes future audits, ad spend approvals, and verifications much smoother.

Bottom line: keeping critical business assets behind a shared inbox is one of those quiet risks that only becomes obvious the day something goes wrong. We're fixing it before that day arrives.

---

## 3. Current-State Assumptions (Confirm Before Starting)

Before touching anything, we need to take a clear picture of what exists today. Please confirm or document the following:

**Identity and access**

- Does `<shared-inbox@example.com>` currently have full admin / "Full control" rights on the Plug A Pro Facebook Page, or only Editor / Moderator level?
- Does `<owner-email@example.com>` already have a Facebook personal profile attached to it? If not, one needs to be created first, because Meta admin roles are tied to a personal profile, not just an email.
- Is there an existing Meta Business Portfolio (formerly Business Manager) for Kgolaentle / Plug A Pro? If yes, who is listed as the Business Admin?

**Assets to inventory**

- All Facebook Pages owned or managed (Plug A Pro and any sub-brand pages)
- Instagram accounts linked to those pages
- WhatsApp Business account / phone numbers connected to the Page or to a WhatsApp Business API setup
- Ad accounts, including any with active spend or saved payment methods
- Meta Pixel / Conversions API setup
- Product catalogues
- Verified domains (for example, plugapro.co.za if added under domain verification)
- Saved payment methods (cards, EFT mandates, PayPal, etc.)
- Any business verification status (verified, pending, not started)

**People and partners**

- Any other admins, editors, or partner agencies currently with access
- Any third-party tools connected via OAuth (Hootsuite, Meta Ads partners, etc.)

If any of the above is unknown, that itself is the first thing to check before we go further.

---

## 4. Target-State Outcome (What "Done" Looks Like)

When this migration is finished, the picture should look like this:

`<owner-email@example.com>` is set as a Full Control admin on the Plug A Pro Facebook Page and as a Business Admin on the Meta Business Portfolio that owns the Page. the owner's profile is also the primary recovery contact, with 2FA enabled using an authenticator app (not SMS, where possible).

The Instagram account, WhatsApp Business number, ad account, pixel, catalogue, and any verified domains all sit inside the same Business Portfolio and are administered by the owner's profile. Payment methods on the ad account are confirmed working and tied to Kgolaentle Holdings.

The `<shared-inbox@example.com>` access is either fully removed, or downgraded to a backup-only role (for example, kept as a secondary admin in case of emergency, but stripped of finance and ownership rights). The decision on which option to use depends on whether `info@` will continue to be monitored by the team.

Business contact details on the Portfolio reflect Kgolaentle Holdings' real registered information: company name, registration number <COMPANY_REG_NO>, business address, and the owner as point of contact.

No pages, no Instagram accounts, no WhatsApp assets, no ad spend history, and no audiences are lost in the process. Everything is either retained or properly re-linked.

---

## 5. Step-by-Step Migration Checklist

This is meant to be followed manually inside Meta. Menu names change often, so the checklist focuses on the action, not the exact button. Work through it in order — skipping ahead is what causes lockouts.

**Phase A: Inventory and prep**

1. List every social asset currently associated with Plug A Pro (use Section 3 as your template).
2. Confirm `<owner-email@example.com>` has an active Facebook personal profile. If not, create one. Use the real name and a strong unique password.
3. Enable 2FA on the owner's new profile immediately, before adding any business roles.
4. Take screenshots of the current admin list for the Page and the Business Portfolio. This is your "before" snapshot — useful if anything goes sideways.

**Phase B: Add the new admin without removing the old one**

5. From the existing admin account (`<shared-inbox@example.com>`), invite `<owner-email@example.com>` to the Business Portfolio as a Business Admin (full access, including finance and pages).
6. From the same account, add the owner as a Full Control admin on the Plug A Pro Facebook Page.
7. If there is no Business Portfolio yet, create one now under the owner's profile, and then claim or request access to the Plug A Pro Page from inside it. Don't just "add" the Page — claim ownership properly so the Portfolio holds the asset.
8. the owner accepts the invitations from his account. Check email and Facebook notifications.

**Phase C: Re-link and verify each asset**

9. Confirm the Instagram account is connected through the Business Portfolio (Accounts → Instagram accounts), not just linked at the Page level. If only linked at Page level, re-link it through the Portfolio so admin control flows correctly.
10. Confirm the WhatsApp Business number is in the Portfolio under WhatsApp Accounts. If it's tied to the wrong portfolio, this needs a Meta support request — flag it.
11. Confirm the ad account is in the Portfolio. Verify the payment method, billing threshold, and that no spend is paused unexpectedly.
12. Confirm the Pixel and any Conversions API setup is owned by the Portfolio and assigned to the right ad account.
13. Confirm any product catalogues are in the Portfolio.
14. Confirm domain verification for plugapro.co.za (or whatever domain is in use) is intact. If not done, add it.

**Phase D: Update business and recovery details**

15. Update the Business Info on the Portfolio: registered legal name (Kgolaentle Holdings), reg number, address, and primary business contact (the owner).
16. Set the owner's email and phone as the recovery contacts where Meta allows it.
17. If business verification has not been completed, start it now using Kgolaentle Holdings' CIPC documents.

**Phase E: Test before removing the old account**

18. Log in as `<owner-email@example.com>` and confirm you can: post on the Page, reply to a Page message, view ad account billing, send a WhatsApp Business test message, edit Instagram from the Portfolio, and view the Pixel.
19. Have the owner send a test post or a test message and confirm it goes out properly.
20. Wait at least 24 hours after the test before doing anything destructive. This window is your safety net.

**Phase F: Reduce or remove the old account**

21. Decide: remove `<shared-inbox@example.com>` entirely, or downgrade it to a limited backup role.
22. If removing: revoke its admin role on the Page, then remove it from the Business Portfolio. Do this as the LAST step, not before.
23. Document the final state: who has what role on what asset.

---

## 6. Acceptance Criteria

The task is considered complete when ALL of these are true:

- `<owner-email@example.com>` can independently administer the Plug A Pro Facebook Page, Instagram, WhatsApp Business, ad account, pixel, catalogue, and Business Portfolio without needing `<shared-inbox@example.com>` for anything.
- 2FA is active on the owner's profile, ideally via authenticator app.
- Business Portfolio shows Kgolaentle Holdings' correct legal info and the owner as primary contact.
- Recovery email and recovery phone on the Portfolio are pointing to the owner, not the old shared inbox.
- A real-world test (post + message reply + ad account view) was completed successfully from the owner's account.
- `<shared-inbox@example.com>` is either removed or explicitly documented as a downgraded backup role.
- A short written record exists describing the final access model (who has what).
- No customer-facing disruption was experienced: no Page outages, no paused ads from access loss, no WhatsApp downtime.

If any of these fail, the migration is not yet done.

---

## 7. Risks and Edge Cases

Things that genuinely happen and that we should be ready for:

**The Page is owned by a Business Portfolio that cannot be transferred directly.** Meta does not allow Page ownership to move freely between Portfolios. If the current Portfolio is the wrong one, you may need to request the Page back into a new Portfolio you create under the owner. This often requires a Meta support ticket. Don't try to brute-force it.

**`<shared-inbox@example.com>` is the only admin, and no one can log in.** If access to that mailbox is shaky, do NOT remove it from any role until the owner's account is fully tested. If we're already locked out of `info@`, we may need to use Meta's account recovery process (ID upload, business documents) — slow but workable.

**the owner's email has no existing Facebook identity.** Meta admin roles attach to a Facebook profile, not an email address. A profile must exist first. Use the real name (it makes business verification easier later).

**The Instagram account is linked but invisible in Business Suite.** This usually means it's connected at Page level only, or it's a personal account that was never converted to a Business or Creator account. Convert it first, then re-link via the Portfolio.

**The WhatsApp Business number is attached to the wrong Portfolio.** Moving WhatsApp Business assets between Portfolios is restricted and may need Meta support. If the number is on a Cloud API setup, this also affects any messaging integrations Plug A Pro plans to use later — important for the WhatsApp-first model.

**Ad account or payment method cannot be transferred.** Ad accounts can be moved between Portfolios in some cases, but billing thresholds and payment methods sometimes need to be re-added. Capture screenshots of current spend, audiences, and saved cards before moving anything financial.

**Business verification is required.** Meta sometimes blocks ownership changes until the Portfolio is verified. Have CIPC documents (Reg <COMPANY_REG_NO>), proof of address, and a business utility/bank document ready in PDF.

**Removing the old admin too early locks the business out.** This is the one mistake that turns a routine migration into an emergency. The rule is simple: new admin works first, old admin removed last.

**Personal-account risk.** the owner's personal Facebook profile becomes a critical business asset the moment it holds these admin roles. It needs strong 2FA, a unique password, and ideally a backup admin person added to the Portfolio so we're never single-threaded on one human.

---

## 8. Final Handover Note (Template)

Use this as the closing record once the migration is done. Fill in the blanks before saving.

---

> **Plug A Pro Social Media Migration – Handover Note**
>
> **Date completed:** _________
> **Completed by:** _________
> **Verified by:** the business owner
>
> **What was moved**
> The following Plug A Pro social assets were migrated from `<shared-inbox@example.com>` administration to `<owner-email@example.com>` administration:
>
> - Facebook Page: _________
> - Instagram account: _________
> - WhatsApp Business number(s): _________
> - Ad account ID: _________
> - Meta Pixel ID: _________
> - Catalogue(s): _________
> - Verified domain(s): _________
> - Business Portfolio: _________
>
> **Final access model**
> Primary admin / owner: `<owner-email@example.com>` (Full Control + Business Admin)
> Backup admin (if retained): `_________`
> 2FA status on primary admin: Enabled via authenticator app
> Recovery email: _________
> Recovery phone: _________
>
> **What remains**
> `<shared-inbox@example.com>` status: [Removed entirely / Downgraded to backup role] — circle one.
> Business verification status: [Verified / Pending / Not started]
> Outstanding items needing Meta support: _________
>
> **What to monitor for the next 30 days**
>
> - Login alerts on the owner's Facebook profile (any unexpected sign-in attempts)
> - Ad account billing — confirm first invoice after migration runs cleanly
> - WhatsApp Business message delivery — confirm no drop in customer reply rate
> - Page reach and Instagram insights — confirm no shadow-ban or reach drop after ownership change
> - Recovery email inbox (`<owner-email@example.com>`) — make sure Meta's security emails are arriving and read
>
> **Notes for future**
> Add at least one secondary human admin to the Business Portfolio so the business is never dependent on a single person's account. Keep CIPC documents and proof of address on hand for any future Meta verification requests.

---

*Final word for whoever picks this up: take the slow, boring path. Add first, test second, remove last. Meta doesn't give second chances when you lock yourself out, and the company's customer communication runs through these accounts.*
