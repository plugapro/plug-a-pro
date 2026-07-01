#!/usr/bin/env tsx
// Application triage sweep — classify + act on the provider-application queue.
// Spec: docs/superpowers/specs/2026-07-01-application-triage-sweep-design.md
//
// Default is --dry-run: prints the classification table, writes and sends NOTHING.
// Usage:
//   pnpm tsx scripts/application-triage-sweep.ts                 # dry-run, all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute       # apply all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute --rule=3

import { areaInPilot } from '@/lib/ops-agents/pilot-area'
import { getServiceComplianceRequirement } from '@/lib/service-category-policy'

export type TriageRule =
  | 'DUPLICATE'
  | 'RULE_1_NO_ID'
  | 'RULE_2_PARTIAL_APPROVE'
  | 'RULE_2B_HIGH_RISK_ONLY'
  | 'RULE_3_OUT_OF_PILOT'
  | 'SKIP_ALREADY_SWEPT'

export interface TriageInput {
  id: string
  name: string | null
  phone: string
  skills: string[]
  serviceAreas: string[]
  idNumber: string | null
  status: 'PENDING' | 'MORE_INFO_REQUIRED'
  notes: string | null
  hasVerificationRow: boolean
  isActiveProviderPhone: boolean
}

export interface TriageDecision {
  rule: TriageRule
  targetStatus: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | null
  template:
    | 'provider_registration_continue'
    | 'provider_high_risk_cert_nudge'
    | 'provider_area_waitlist'
    | null
  approvedSkills: string[] | null
  heldSkills: string[] | null
  waitlist: boolean
  areaLabel: string | null
}

const SWEEP_MARKER = '[triage-sweep'

function normaliseSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

function isHighRisk(skillSlug: string): boolean {
  const req = getServiceComplianceRequirement(skillSlug)
  return req.riskLevel !== 'standard'
}

function hasIdCaptured(input: TriageInput): boolean {
  return Boolean(input.idNumber && input.idNumber.trim() !== '') || input.hasVerificationRow
}

function inPilot(input: TriageInput): boolean {
  return input.serviceAreas.some((area) => areaInPilot(area))
}

const NO_DECISION: Omit<TriageDecision, 'rule'> = {
  targetStatus: null,
  template: null,
  approvedSkills: null,
  heldSkills: null,
  waitlist: false,
  areaLabel: null,
}

export function classifyApplication(input: TriageInput): TriageDecision {
  if (input.notes?.includes(SWEEP_MARKER)) {
    return { rule: 'SKIP_ALREADY_SWEPT', ...NO_DECISION }
  }
  if (input.isActiveProviderPhone) {
    return { rule: 'DUPLICATE', ...NO_DECISION }
  }

  const idCaptured = hasIdCaptured(input)

  if (!inPilot(input)) {
    return {
      rule: 'RULE_3_OUT_OF_PILOT',
      targetStatus: idCaptured ? null : 'MORE_INFO_REQUIRED',
      template: 'provider_area_waitlist',
      approvedSkills: null,
      heldSkills: null,
      waitlist: true,
      areaLabel: input.serviceAreas[0]?.trim() || 'your area',
    }
  }

  if (!idCaptured) {
    return {
      rule: 'RULE_1_NO_ID',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_registration_continue',
      approvedSkills: null,
      heldSkills: null,
      waitlist: false,
      areaLabel: null,
    }
  }

  const slugs = input.skills.map(normaliseSkill)
  const held = slugs.filter(isHighRisk)
  const approved = slugs.filter((s) => !isHighRisk(s))

  if (approved.length === 0) {
    return {
      rule: 'RULE_2B_HIGH_RISK_ONLY',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_high_risk_cert_nudge',
      approvedSkills: null,
      heldSkills: held,
      waitlist: false,
      areaLabel: null,
    }
  }

  return {
    rule: 'RULE_2_PARTIAL_APPROVE',
    targetStatus: 'APPROVED',
    template: 'provider_high_risk_cert_nudge',
    approvedSkills: approved,
    heldSkills: held,
    waitlist: false,
    areaLabel: null,
  }
}
