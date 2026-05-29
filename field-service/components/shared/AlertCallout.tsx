import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

interface AlertCalloutProps {
  tone?: Tone
  title?: React.ReactNode
  /** Optional override icon. Falls back to a tone-appropriate default. */
  icon?: React.ReactNode
  /** Optional CTA slot - usually a Button. Rendered to the right. */
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

const DEFAULT_ICON: Record<Tone, React.ReactNode> = {
  neutral: <Info className="size-4" />,
  info: <Info className="size-4" />,
  success: <CheckCircle2 className="size-4" />,
  warning: <AlertTriangle className="size-4" />,
  danger: <ShieldAlert className="size-4" />,
  brand: <Sparkles className="size-4" />,
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'tone-neutral',
  info: 'tone-info',
  success: 'tone-success',
  warning: 'tone-warning',
  danger: 'tone-danger',
  brand: 'tone-brand',
}

/**
 * Tone-aware callout banner used inside cards and detail screens to
 * explain a status, warn the user or celebrate a state change. Replaces
 * the older pattern of inline `bg-emerald-50 / bg-amber-50 / bg-blue-50`
 * boxes which leaked light-mode colours and didn't theme properly.
 *
 * Use:
 *   <AlertCallout tone="warning" title="Quote awaiting approval">
 *     Your customer was notified by SMS and WhatsApp.
 *   </AlertCallout>
 */
export function AlertCallout({
  tone = 'info',
  title,
  icon,
  action,
  className,
  children,
}: AlertCalloutProps) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10"
      >
        {icon ?? DEFAULT_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? (
          <p className="font-semibold leading-snug">{title}</p>
        ) : null}
        {children ? (
          <div className="text-sm leading-relaxed opacity-95">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
