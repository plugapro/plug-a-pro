'use client'

import { Button } from '@/components/ui/button'

export function StepFooter({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  primaryDisabled,
}: {
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  primaryDisabled?: boolean
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[rgba(246,246,248,0.92)] px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl dark:bg-[rgba(11,11,16,0.92)]">
      <div className="mx-auto flex w-full max-w-md gap-3">
        {secondaryLabel && onSecondary ? (
          <Button variant="secondary" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        ) : null}
        <Button
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="flex-1"
          style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  )
}
