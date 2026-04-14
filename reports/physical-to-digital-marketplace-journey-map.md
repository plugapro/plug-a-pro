# Plug-A-Pro Physical-to-Digital Marketplace Journey Map

Date: 2026-04-10

## 1. Purpose

Plug-A-Pro is digitising a real-world informal hiring interaction:

1. customer sees workers physically
2. customer visually evaluates them
3. customer talks to them
4. worker explains capability
5. worker may show proof informally
6. customer negotiates scope and price
7. customer decides whether to proceed

This document maps those physical trust signals to the current digital implementation and assesses whether the replacement is good enough.

## 2. Journey Map

| Physical-world step | Physical trust signal | Digital Plug-A-Pro equivalent | Current adequacy | What is missing | Recommendation |
|---|---|---|---|---|---|
| Customer arrives at a hardware store and sees available workers | Immediate sense that a real person exists and is present | Discovery page, request flow, provider listing/profile entry points | `Partial` | Digital discovery is present, but provider evidence depth is still limited | Keep provider identity visible early and avoid blind booking |
| Customer visually evaluates the worker | Face, age, demeanor, confidence, presentation | Provider profile with profile details, service area, reviews, completed jobs | `Partial` | Richer photo/portfolio context and clearer provenance labels are still limited | Add portfolio and clearly label profile sections as provider-supplied vs platform-recorded |
| Customer talks to the worker | Human explanation and informal negotiation | WhatsApp-assisted flows and request / quote clarification | `Partial to good` | Not all nuance is structured unless routed back into the platform | Keep WhatsApp for comfort, but always push critical decisions into structured in-app confirmation |
| Worker explains what they can do | Claimed capability | Provider bio, service categories, work areas | `Partial` | Claimed capability is visible, but evidence of capability is still thin | Add optional work examples, references, and credentials with provenance labels |
| Worker may show prior work or references informally | Real-world ad hoc proof | Reviews and completed jobs on provider page | `Partial` | Limited portfolio/reference support in current product | Add optional evidence modules and moderation/review states later |
| Customer negotiates scope and price | Both parties hear and clarify what is included | Quote creation and quote approval flow | `Good` | Change-order evidence could grow richer | Keep quote revision and extra-work approval explicit and timestamped |
| Customer decides whether to proceed | Personal judgement based on visible cues and conversation | Provider profile + quote + booking confirmation | `Partial to good` | Still fewer cues than physical interaction | Strengthen provider profile context before final acceptance |
| Customer knows who will do the work | Direct identity | Booking detail and provider identity surface | `Good` | Could be stronger if worker-level identity becomes more explicit for team providers | Keep assigned provider visible before booking commitment and before arrival |
| Worker arrives and customer confirms it is the same person | Physical identity continuity | En route / arrival state and booking record | `Partial` | No strong worker identity confirmation flow yet | Add optional arrival identity/photo confirmation only if operationally realistic |
| Customer sees work progress and can challenge scope changes | Real-time, in-person visibility | Status updates, extra-work approval, issue reporting | `Good` | Better photo-based change evidence would help | Require photo/context on extra-work requests wherever possible |
| Customer pays after job or per agreement | Direct value exchange | Payment record and invoice/receipt flow | `Partial` | Payment semantics vary across launch mode and offline flows | Keep collection role explicit: platform-collected, provider-collected, or recorded-only |
| Customer complains if unhappy | Immediate face-to-face or phone confrontation | Issue reporting, disputes, reviews, audit trail | `Good` | Resolution expectations must stay honest | Continue framing the platform as recordkeeper and resolver within actual capability, not guarantor |

## 3. Digital Trust Signal Assessment

### Trust signals that now work reasonably well

- provider identity is presented more honestly
- reviews and completed jobs provide platform-recorded evidence
- quote acceptance provides a clear digital equivalent of negotiated agreement
- job lifecycle states create a usable audit trail
- issue reporting gives customers a non-silent fallback

### Trust signals that remain weaker than the physical marketplace

- visual evaluation of the worker before hiring
- richer proof of prior work
- nuanced sense of whether the provider is experienced, careful, or trustworthy
- direct inspection of informal references

### Trust signals that were previously misleading and are now corrected

- implied vetting
- implied qualification
- implied ID verification
- implied skill assessment
- implied guarantee of provider quality or safety

## 4. Current Conclusion

The digital journey is no longer faking physical trust through unsupported labels. That is a major improvement.

But the digital replacement is still thinner than the real-world interaction in one important way:

- the platform is now more honest than it is rich

That is the correct short-term tradeoff. Honest thin trust is better than fake strong trust.

The next product step is not to restore broad “verified” language. It is to add narrow, evidence-backed trust signals that customers can inspect.

## 5. Recommended Additions

### Add now or soon

- optional provider portfolio images
- optional customer-visible references or work examples
- clearer separation of:
  - provider-supplied claims
  - provider-uploaded evidence
  - platform-recorded history
- more visible explanation of what customer reviews represent

### Add later only if real process exists

- formal check badges
- identity review badge
- licence review badge
- reference-checked badge
- category-specific qualification markers

Each of those should only appear once the operational process behind them is real.
