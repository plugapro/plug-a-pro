'use client'

import * as React from 'react'
import { useForm, useWatch, type DefaultValues, type FieldValues, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ─── Field descriptors ────────────────────────────────────────────────────────

type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'date'

export interface CRUDFieldDef<T extends FieldValues> {
  name: Path<T>
  label: string
  type?: FieldType
  placeholder?: string
  /** Options for type='select' */
  options?: { label: string; value: string }[]
  /** Show this field only when condition is true */
  showWhen?: (values: T) => boolean
  className?: string
}

export interface CRUDFormProps<T extends FieldValues> {
  schema: z.ZodType<T, T>
  fields: CRUDFieldDef<T>[]
  defaultValues?: DefaultValues<T>
  onSubmit: (data: T) => Promise<void>
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  loading?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CRUDForm<T extends FieldValues>({
  schema,
  fields,
  defaultValues,
  onSubmit,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  onCancel,
  loading,
}: CRUDFormProps<T>) {
  const form = useForm<T>({
    resolver: zodResolver<T, unknown, T>(schema),
    defaultValues,
  })

  const watchedValues = useWatch({ control: form.control }) as Partial<T> | undefined

  const handleSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data)
  })

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => {
        if (field.showWhen && !field.showWhen(watchedValues as T)) return null

        const error = form.formState.errors[field.name]?.message as string | undefined
        const type = field.type ?? 'text'

        return (
          <div key={String(field.name)} className={cn('space-y-1.5', field.className)}>
            <Label htmlFor={String(field.name)}>{field.label}</Label>

            {type === 'textarea' ? (
              <Textarea
                id={String(field.name)}
                placeholder={field.placeholder}
                {...form.register(field.name)}
                className={cn(error && 'border-destructive')}
              />
            ) : type === 'select' ? (
              <Select
                defaultValue={String(defaultValues?.[field.name as keyof typeof defaultValues] ?? '')}
                onValueChange={(v) => form.setValue(field.name, v as T[Path<T>])}
              >
                <SelectTrigger
                  id={String(field.name)}
                  className={cn(error && 'border-destructive')}
                >
                  <SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={String(field.name)}
                type={type}
                placeholder={field.placeholder}
                {...form.register(field.name, type === 'number' ? { valueAsNumber: true } : {})}
                className={cn(error && 'border-destructive')}
              />
            )}

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={loading || form.formState.isSubmitting}>
          {form.formState.isSubmitting || loading ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
