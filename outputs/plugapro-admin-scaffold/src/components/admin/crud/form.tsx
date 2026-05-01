'use client';

// <CRUDForm> — typed, validated, audited form that calls a crudAction.
//
// Usage:
//
//   <CRUDForm
//     schema={customerSchema}
//     defaultValues={customer}
//     action={updateCustomer}        // a crudAction
//     fields={[
//       { name: 'name',  label: 'Name',  type: 'text', required: true },
//       { name: 'phone', label: 'Phone', type: 'tel',  required: true },
//       { name: 'email', label: 'Email', type: 'email' },
//     ]}
//     onSuccess={(data) => router.push(`/admin/customers/${data.entityId}`)}
//   />

import * as React from 'react';
import { useForm, FieldValues, DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ZodSchema } from 'zod';
import type { CrudActionResult, CrudRunResult } from '@/lib/crud-action';
import { cn } from '@/lib/utils';

export interface FieldDef<TName extends string = string> {
  name: TName;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'hidden' | 'password';
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  /** Required when type === 'select'. */
  options?: Array<{ value: string; label: string }>;
  /** Multi-select: only for type === 'select'. */
  multiple?: boolean;
}

interface Props<TInput extends FieldValues, TOutput extends CrudRunResult> {
  schema: ZodSchema<TInput>;
  defaultValues?: DefaultValues<TInput>;
  fields: FieldDef<Extract<keyof TInput, string>>[];
  action: (input: unknown) => Promise<CrudActionResult<TOutput>>;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onSuccess?: (data: TOutput) => void;
  className?: string;
}

export function CRUDForm<TInput extends FieldValues, TOutput extends CrudRunResult>({
  schema,
  defaultValues,
  fields,
  action,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  onCancel,
  onSuccess,
  className,
}: Props<TInput, TOutput>) {
  const form = useForm<TInput>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur',
  });

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setPending(true);
    try {
      const result = await action(values);
      if (!result.ok) {
        setServerError(result.message);
        if (result.code === 'VALIDATION' && result.details) {
          // Project Zod flattened errors onto react-hook-form.
          const flattened = result.details as { fieldErrors?: Record<string, string[] | undefined> };
          if (flattened.fieldErrors) {
            for (const [name, errors] of Object.entries(flattened.fieldErrors)) {
              if (errors?.[0]) {
                form.setError(name as never, { message: errors[0] });
              }
            }
          }
        }
        return;
      }
      onSuccess?.(result.data);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setPending(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className={cn('space-y-4', className)}>
      {fields.map((f) => (
        <Field key={f.name} field={f} form={form} />
      ))}

      {serverError && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">
          {serverError}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded border px-3 py-1.5 text-sm">
            {cancelLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={pending || form.formState.isSubmitting}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// --- Field renderer ------------------------------------------------------

interface FieldProps<TInput extends FieldValues> {
  field: FieldDef<Extract<keyof TInput, string>>;
  form: ReturnType<typeof useForm<TInput>>;
}

function Field<TInput extends FieldValues>({ field, form }: FieldProps<TInput>) {
  const error = form.formState.errors[field.name]?.message as string | undefined;

  if (field.type === 'hidden') {
    return <input type="hidden" {...form.register(field.name as never)} />;
  }

  if (field.type === 'textarea') {
    return (
      <div>
        <Label>{field.label}{field.required && ' *'}</Label>
        <textarea
          rows={4}
          className={cn('w-full rounded border px-2 py-1 text-sm', error && 'border-red-500')}
          placeholder={field.placeholder}
          {...form.register(field.name as never)}
        />
        {field.helpText && <Help>{field.helpText}</Help>}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <Label>{field.label}{field.required && ' *'}</Label>
        <select
          className={cn('w-full rounded border px-2 py-1 text-sm', error && 'border-red-500')}
          multiple={field.multiple}
          {...form.register(field.name as never)}
        >
          {!field.required && !field.multiple && <option value="">—</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.helpText && <Help>{field.helpText}</Help>}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-2">
        <input id={field.name} type="checkbox" {...form.register(field.name as never)} />
        <label htmlFor={field.name} className="text-sm">{field.label}</label>
        {field.helpText && <Help>{field.helpText}</Help>}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  return (
    <div>
      <Label>{field.label}{field.required && ' *'}</Label>
      <input
        className={cn('w-full rounded border px-2 py-1 text-sm', error && 'border-red-500')}
        type={field.type}
        placeholder={field.placeholder}
        {...form.register(field.name as never)}
      />
      {field.helpText && <Help>{field.helpText}</Help>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-muted-foreground">{children}</label>;
}
function Help({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}
function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-red-600">{children}</p>;
}
