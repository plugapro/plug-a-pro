import { cn } from '@/lib/utils'

type StatusPillTone = 'brand' | 'warn' | 'success' | 'danger' | 'neutral' | 'whatsapp'

const TONE_CLASS: Record<StatusPillTone, string> = {
  brand: 'bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]',
  warn: 'bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]',
  success: 'bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]',
  danger: 'bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]',
  neutral: 'bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]',
  whatsapp: 'bg-[rgba(37,211,102,0.12)] text-[var(--color-whatsapp-hover)]',
}

export function StatusPill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusPillTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-bold tracking-[0.01em]',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
