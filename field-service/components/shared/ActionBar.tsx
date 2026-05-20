import * as React from 'react'
import { cn } from '@/lib/utils'

interface ActionBarProps {
  /**
   * Primary action(s). Rendered at the right edge on wide containers,
   * full width on narrow. Buttons or links accepted.
   */
  primary: React.ReactNode
  /**
   * Optional helper text or pricing summary shown to the left of the
   * primary action - useful for "Subtotal R450" / "Step 2 of 4" copy.
   */
  helper?: React.ReactNode
  /**
   * Optional secondary action - typically a quiet variant.
   */
  secondary?: React.ReactNode
  className?: string
}

/**
 * Sticky bottom action bar for flows that need a persistent primary CTA
 * (booking wizard, quote review, payment). Sits above the bottom-nav
 * with safe-area padding, blurred backdrop, and a hairline top border
 * so it reads as part of the system, not floating chrome.
 *
 * Use sparingly - only on flow screens where the user must commit to a
 * decision. List screens should let the page scroll without occlusion.
 */
export function ActionBar({
  primary,
  helper,
  secondary,
  className,
}: ActionBarProps) {
  return (
    <div
      className={cn(
        'app-action-bar layer-sticky fixed bottom-0 left-0 right-0 safe-bottom',
        className,
      )}
      role="region"
      aria-label="Page actions"
    >
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        {helper ? (
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {helper}
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-center gap-2',
            !helper && 'flex-1 justify-end',
          )}
        >
          {secondary}
          {primary}
        </div>
      </div>
    </div>
  )
}
