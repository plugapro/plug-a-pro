import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FormFieldProps {
  /** Stable id used by the label and the rendered control. */
  id: string
  label: React.ReactNode
  /** Helper text shown below the field when there is no error. */
  hint?: React.ReactNode
  /** Error string. When set, hint is hidden and control is marked invalid. */
  error?: React.ReactNode
  /** Marks the field as required for screen readers and an inline asterisk. */
  required?: boolean
  /** Marks the field as optional with an inline "Optional" hint. */
  optional?: boolean
  /**
   * Render-prop receives the wiring (id, aria-describedby, aria-invalid)
   * to apply to your control of choice - Input, Textarea, Select, custom.
   */
  children: (controlProps: {
    id: string
    'aria-invalid': boolean
    'aria-describedby'?: string
    'aria-required'?: boolean
  }) => React.ReactNode
  className?: string
}

/**
 * Consistent label + control + hint/error scaffolding used across forms.
 * Wires aria attributes correctly so screen readers announce errors and
 * help text. Removes the need for ad-hoc Label + Input + <p> trios on
 * every screen.
 *
 * Example:
 *   <FormField id="email" label="Email" hint="We'll never spam you.">
 *     {(p) => <Input type="email" {...p} />}
 *   </FormField>
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  optional,
  children,
  className,
}: FormFieldProps) {
  const helperId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = errorId ?? helperId

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-[var(--tone-danger-fg)]">
              *
            </span>
          ) : null}
        </Label>
        {optional && !required ? (
          <span className="text-xs text-muted-foreground">Optional</span>
        ) : null}
      </div>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[var(--tone-danger-fg)]"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={helperId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
