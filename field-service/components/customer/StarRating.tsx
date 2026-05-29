'use client'

import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  /** Form field name for the chosen score (1–5). */
  name: string
  /** Default selected score. */
  defaultValue?: number
  /** Whether selection is required for the surrounding form. */
  required?: boolean
}

/**
 * Mobile-friendly 5-star rating selector. Renders five large tappable
 * targets, fills all stars up to the selected value and reads correctly
 * for screen readers via a hidden radio group. Used on the customer rating
 * screen after job completion.
 */
export function StarRating({
  name,
  defaultValue = 0,
  required,
}: StarRatingProps) {
  const [score, setScore] = React.useState<number>(defaultValue)
  const [hover, setHover] = React.useState<number>(0)

  const display = hover || score
  const labels = ['Bad', 'Poor', 'OK', 'Good', 'Great'] as const

  return (
    <div
      className="flex flex-col items-center gap-2"
      onMouseLeave={() => setHover(0)}
    >
      <div role="radiogroup" aria-label="Your rating" className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = display >= n
          return (
            <label
              key={n}
              className={cn(
                'relative inline-flex size-12 cursor-pointer items-center justify-center rounded-full transition-colors',
                filled ? 'bg-[var(--tone-warning-bg)]' : 'bg-muted/40',
              )}
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name={name}
                value={n}
                required={required}
                checked={score === n}
                onChange={() => setScore(n)}
                className="sr-only"
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
              />
              <Star
                className={cn(
                  'size-6 transition-transform',
                  filled
                    ? 'fill-[var(--tone-warning-fg)] text-[var(--tone-warning-fg)] scale-110'
                    : 'text-muted-foreground',
                )}
              />
            </label>
          )
        })}
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {display ? labels[display - 1] : 'Tap a star'}
      </p>
    </div>
  )
}
