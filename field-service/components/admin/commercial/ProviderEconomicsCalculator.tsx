'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BadgeDollarSign,
  Calculator,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import {
  calculateProviderEconomics,
  ProviderEconomicsValidationError,
  type OnboardingVendorScenario,
  type ProviderEconomicsInput,
} from '@/lib/commercial/provider-economics'
import type { DiditWorkflowProfile } from '@/lib/commercial/didit-pricing'
import {
  ONBOARDING_VERIFICATION_MODELS,
  SMILE_ID_CHECKS,
  SMILE_SECURE_COMMERCIAL_NOTE,
  type OnboardingVerificationModel,
  type SmileIdCheckKey,
} from '@/lib/commercial/smileid-pricing'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const MODEL_OPTIONS = Object.entries(ONBOARDING_VERIFICATION_MODELS).map(([key, value]) => ({
  key: key as OnboardingVerificationModel,
  label: value.label,
}))

const CHECK_OPTIONS = Object.values(SMILE_ID_CHECKS)

const DEFAULT_ASSUMPTIONS: ProviderEconomicsInput = {
  activeProviderCount: 100,
  newProvidersPerMonth: 25,
  onboardingVerificationModel: 'recommended',
  smileSecureApplies: false,
  monthlyFixedStackCostUsd: 0,
  monthlyVariableCostPerProviderUsd: 0,
  recurringVerificationCostPerProviderUsd: 0,
  leadFeeUsd: 5,
  variableCostPerLeadUsd: 0,
  paidLeadConversionRate: 1,
  customCheckSelection: [],
  onboardingVendorScenario: 'SMILE_ID',
  diditWorkflowProfile: 'KYC_AUTHORITATIVE',
  diditIncludeAmlOngoing: false,
}

export type ProviderEconomicsCalculatorProps = {
  diditScenarioEnabled?: boolean
}

type FieldKey = keyof Pick<
  ProviderEconomicsInput,
  | 'activeProviderCount'
  | 'newProvidersPerMonth'
  | 'monthlyFixedStackCostUsd'
  | 'monthlyVariableCostPerProviderUsd'
  | 'recurringVerificationCostPerProviderUsd'
  | 'leadFeeUsd'
  | 'variableCostPerLeadUsd'
  | 'paidLeadConversionRate'
>

export function ProviderEconomicsCalculator({ diditScenarioEnabled = false }: ProviderEconomicsCalculatorProps = {}) {
  const [assumptions, setAssumptions] = useState<ProviderEconomicsInput>(DEFAULT_ASSUMPTIONS)
  const [exchangeRateValue, setExchangeRateValue] = useState('')
  const scenario: OnboardingVendorScenario = assumptions.onboardingVendorScenario ?? 'SMILE_ID'

  const calculationInput = useMemo<ProviderEconomicsInput>(() => ({
    ...assumptions,
    exchangeRateZarPerUsd: exchangeRateValue.trim() === ''
      ? undefined
      : Number(exchangeRateValue),
  }), [assumptions, exchangeRateValue])

  const calculation = useMemo(() => {
    try {
      return {
        result: calculateProviderEconomics(calculationInput),
        errors: [] as string[],
      }
    } catch (error) {
      if (error instanceof ProviderEconomicsValidationError) {
        return { result: null, errors: error.errors }
      }
      throw error
    }
  }, [calculationInput])

  const result = calculation.result
  const showZar = Boolean(exchangeRateValue.trim() && result?.zar)
  const marginIsRecoverable = Boolean(result && result.contributionMarginPerProcessedLeadUsd > 0)

  function updateNumberField(field: FieldKey, value: string) {
    setAssumptions((current) => ({
      ...current,
      [field]: value === '' ? 0 : Number(value),
    }))
  }

  function toggleCustomCheck(checkKey: SmileIdCheckKey, checked: boolean) {
    setAssumptions((current) => {
      const existing = current.customCheckSelection ?? []
      return {
        ...current,
        customCheckSelection: checked
          ? Array.from(new Set([...existing, checkKey]))
          : existing.filter((key) => key !== checkKey),
      }
    })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <section className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" />
              Assumptions
            </CardTitle>
            <CardDescription>
              USD is the base currency. People, sales and support staffing costs are excluded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <NumberField
                label="Active providers"
                min={0}
                step={1}
                value={assumptions.activeProviderCount}
                onChange={(value) => updateNumberField('activeProviderCount', value)}
              />
              <NumberField
                label="New providers / month"
                min={0}
                step={1}
                value={assumptions.newProvidersPerMonth}
                onChange={(value) => updateNumberField('newProvidersPerMonth', value)}
              />
            </div>

            {diditScenarioEnabled ? (
              <label className="grid gap-2">
                <span className="text-sm font-medium">Onboarding vendor</span>
                <Select
                  value={scenario}
                  onValueChange={(value) => {
                    setAssumptions((current) => ({
                      ...current,
                      onboardingVendorScenario: value as OnboardingVendorScenario,
                    }))
                  }}
                >
                  <SelectTrigger className="h-[52px] w-full rounded-[16px] px-[14px] text-[15px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIDIT">Didit (Recommended)</SelectItem>
                    <SelectItem value="SMILE_ID">SmileID</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : null}

            {scenario === 'DIDIT' ? (
              <div className="grid gap-3 rounded-[16px] border border-border/80 p-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Didit workflow profile</span>
                  <Select
                    value={assumptions.diditWorkflowProfile ?? 'KYC_AUTHORITATIVE'}
                    onValueChange={(value) => {
                      setAssumptions((current) => ({
                        ...current,
                        diditWorkflowProfile: value as DiditWorkflowProfile,
                      }))
                    }}
                  >
                    <SelectTrigger className="h-[44px] w-full rounded-[12px] px-[12px] text-[14px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KYC_AUTHORITATIVE">Authoritative (KYC + AML + SA DHA)</SelectItem>
                      <SelectItem value="KYC_BASIC">Basic (KYC + AML)</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={assumptions.diditIncludeAmlOngoing ?? false}
                    onCheckedChange={(checked) => {
                      setAssumptions((current) => ({
                        ...current,
                        diditIncludeAmlOngoing: checked === true,
                      }))
                    }}
                  />
                  <span className="grid gap-1">
                    <span className="font-medium">Add ongoing AML monitoring</span>
                    <span className="text-muted-foreground">Adds $0.07/user/year to the per-provider onboarding cost.</span>
                  </span>
                </label>
              </div>
            ) : null}

            <label className="grid gap-2">
              <span className="text-sm font-medium">SmileID verification model</span>
              <Select
                value={assumptions.onboardingVerificationModel}
                onValueChange={(value) => {
                  setAssumptions((current) => ({
                    ...current,
                    onboardingVerificationModel: value as OnboardingVerificationModel,
                  }))
                }}
                disabled={scenario === 'DIDIT'}
              >
                <SelectTrigger className="h-[52px] w-full rounded-[16px] px-[14px] text-[15px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((model) => (
                    <SelectItem key={model.key} value={model.key}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {assumptions.onboardingVerificationModel === 'custom' ? (
              <div className="grid gap-3 rounded-[16px] border border-border/80 p-4">
                <p className="text-sm font-medium">Custom SmileID checks</p>
                {CHECK_OPTIONS.map((check) => (
                  <label key={check.key} className="flex items-start gap-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={(assumptions.customCheckSelection ?? []).includes(check.key)}
                      onCheckedChange={(checked) => toggleCustomCheck(check.key, checked === true)}
                    />
                    <span className="grid gap-1">
                      <span>{check.label}</span>
                      <span className="text-xs text-muted-foreground">{formatUsd(check.priceUsd)} per check</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}

            <label className="flex items-start gap-3 rounded-[16px] border border-border/80 p-4 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={assumptions.smileSecureApplies}
                onCheckedChange={(checked) => {
                  setAssumptions((current) => ({
                    ...current,
                    smileSecureApplies: checked === true,
                  }))
                }}
              />
              <span className="grid gap-1">
                <span className="font-medium">Smile Secure applies</span>
                <span className="text-muted-foreground">Adds a conditional fixed subscription of $500/month.</span>
              </span>
            </label>

            <div className="grid gap-4">
              <NumberField
                label="Monthly fixed stack cost"
                min={0}
                step={1}
                value={assumptions.monthlyFixedStackCostUsd}
                onChange={(value) => updateNumberField('monthlyFixedStackCostUsd', value)}
                help="Hosting, database, storage, monitoring, analytics, logs, WhatsApp infra."
              />
              <NumberField
                label="Monthly variable cost / provider"
                min={0}
                step={0.01}
                value={assumptions.monthlyVariableCostPerProviderUsd}
                onChange={(value) => updateNumberField('monthlyVariableCostPerProviderUsd', value)}
              />
              <NumberField
                label="Recurring verification cost / provider"
                min={0}
                step={0.01}
                value={assumptions.recurringVerificationCostPerProviderUsd}
                onChange={(value) => updateNumberField('recurringVerificationCostPerProviderUsd', value)}
              />
              <NumberField
                label="Lead fee"
                min={0}
                step={0.01}
                value={assumptions.leadFeeUsd}
                onChange={(value) => updateNumberField('leadFeeUsd', value)}
              />
              <NumberField
                label="Variable cost / lead"
                min={0}
                step={0.01}
                value={assumptions.variableCostPerLeadUsd}
                onChange={(value) => updateNumberField('variableCostPerLeadUsd', value)}
              />
              <NumberField
                label="Paid lead conversion rate"
                min={0}
                max={1}
                step={0.01}
                value={assumptions.paidLeadConversionRate}
                onChange={(value) => updateNumberField('paidLeadConversionRate', value)}
                help="Use 1.0 when every processed lead earns revenue."
              />
              <NumberField
                label="Exchange rate ZAR / USD"
                min={0.01}
                step={0.01}
                value={exchangeRateValue}
                onChange={setExchangeRateValue}
                help="Optional display-only rate. No market rate is assumed."
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-5">
        {calculation.errors.length > 0 ? (
          <div className="tone-danger rounded-[16px] border px-4 py-3 text-sm">
            <p className="font-medium">Fix these assumptions before calculating:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {calculation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {result ? (
          <>
            {result.warnings.map((warning) => (
              <div key={warning} className="tone-warning flex gap-3 rounded-[16px] border px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{warning}</p>
              </div>
            ))}

            {!marginIsRecoverable ? (
              <div className="tone-warning flex gap-3 rounded-[16px] border px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Break-even cannot be calculated because lead contribution margin is zero or negative.</p>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                icon={ShieldCheck}
                label="Direct onboarding / provider"
                value={formatUsd(result.directOnboardingCostPerProviderUsd)}
                zarValue={showZar ? formatZar(result.zar!.directOnboardingCostPerProviderZar) : undefined}
                sub={`${result.selectedChecks.length} SmileID checks selected`}
              />
              <MetricCard
                icon={BadgeDollarSign}
                label="First-month loaded / new provider"
                value={formatUsd(result.firstMonthFullyLoadedCostPerNewProviderUsd)}
                zarValue={showZar ? formatZar(result.zar!.firstMonthFullyLoadedCostPerNewProviderZar) : undefined}
                sub="Direct onboarding plus active-base upkeep share"
              />
              <MetricCard
                icon={TrendingUp}
                label="Contribution margin / processed lead"
                value={formatUsd(result.contributionMarginPerProcessedLeadUsd)}
                zarValue={showZar ? formatZar(result.zar!.contributionMarginPerProcessedLeadZar) : undefined}
                sub="Lead fee times paid conversion, minus variable lead cost"
              />
              <MetricCard
                label="Monthly new-provider onboarding"
                value={formatUsd(result.monthlyNewProviderOnboardingCostUsd)}
                zarValue={showZar ? formatZar(result.zar!.monthlyNewProviderOnboardingCostZar) : undefined}
              />
              <MetricCard
                label="Monthly upkeep for active base"
                value={formatUsd(result.monthlyUpkeepCostUsd)}
                zarValue={showZar ? formatZar(result.zar!.monthlyUpkeepCostZar) : undefined}
                sub="Excludes new-provider onboarding"
              />
              <MetricCard
                label="Monthly total tech cost"
                value={formatUsd(result.monthlyTotalTechCostUsd)}
                zarValue={showZar ? formatZar(result.zar!.monthlyTotalTechCostZar) : undefined}
                sub="Includes new-provider onboarding"
              />
              <MetricCard
                label="Upkeep / active provider"
                value={formatUsd(result.upkeepCostPerActiveProviderUsd)}
                zarValue={showZar ? formatZar(result.zar!.upkeepCostPerActiveProviderZar) : undefined}
              />
              <MetricCard
                label="Leads for monthly tech cost"
                value={formatLeadCount(result.leadsRequiredToRecoverMonthlyTechCost)}
                sub="Uses contribution margin, not gross lead fee"
              />
              <MetricCard
                label="Leads for one provider onboarding"
                value={formatLeadCount(result.leadsRequiredToRecoverOneProviderOnboarding)}
                sub="Uses first-month fully loaded cost"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Selected SmileID checks</CardTitle>
                  <CardDescription>Per-check assumptions used for the direct onboarding cost.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Check</th>
                          <th className="py-2 text-right font-medium">USD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {result.selectedChecks.length > 0 ? result.selectedChecks.map((check) => (
                          <tr key={check.key}>
                            <td className="py-3 pr-4">{check.label}</td>
                            <td className="py-3 text-right font-medium">{formatUsd(check.priceUsd)}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td className="py-3 pr-4 text-muted-foreground" colSpan={2}>
                              No checks selected.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="h-4 w-4" />
                    Smile Secure impact
                  </CardTitle>
                  <CardDescription>{SMILE_SECURE_COMMERCIAL_NOTE}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-[16px] bg-muted/50 px-4 py-3">
                    <span>Toggle state</span>
                    <span className={cn('font-semibold', assumptions.smileSecureApplies ? 'text-[var(--tone-success-fg)]' : 'text-muted-foreground')}>
                      {assumptions.smileSecureApplies ? 'Included' : 'Excluded'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[16px] bg-muted/50 px-4 py-3">
                    <span>Monthly fixed cost</span>
                    <span className="font-semibold">{formatUsd(result.smileSecureMonthlyCostUsd)}</span>
                  </div>
                  {showZar ? (
                    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-muted/50 px-4 py-3">
                      <span>ZAR display</span>
                      <span className="font-semibold">{formatZar(result.zar!.smileSecureMonthlyCostZar)}</span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  help,
}: {
  label: string
  value: number | string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  help?: string
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {help ? <span className="text-xs leading-5 text-muted-foreground">{help}</span> : null}
    </label>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  zarValue,
  sub,
}: {
  icon?: typeof Calculator
  label: string
  value: string
  zarValue?: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
        </div>
        <div>
          <p className="text-2xl font-semibold leading-tight">{value}</p>
          {zarValue ? <p className="mt-1 text-sm font-medium text-muted-foreground">{zarValue}</p> : null}
        </div>
        {sub ? <p className="text-xs leading-5 text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatZar(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatLeadCount(value: number | null) {
  return value === null
    ? 'Not available'
    : new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(value)
}
