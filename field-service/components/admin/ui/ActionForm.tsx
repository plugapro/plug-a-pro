'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { notify } from './ActionToast'

// ─── Context ──────────────────────────────────────────────────────────────────

interface ActionFormContextValue {
  isPending: boolean
}

export const ActionFormContext = React.createContext<ActionFormContextValue>({
  isPending: false,
})

export function useActionFormContext(): ActionFormContextValue {
  return React.useContext(ActionFormContext)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionResult<T = unknown> {
  ok: boolean
  error?: string
  data?: T
  message?: string
  warning?: string
}

interface ActionFormProps<T = unknown> {
  action: (formData: FormData) => Promise<ActionResult<T>>
  onSuccess?: (data?: T) => void
  successMessage?: string
  errorFallback?: string
  children: React.ReactNode
  className?: string
  resetOnSuccess?: boolean
  refreshOnSuccess?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionForm<T = unknown>({
  action,
  onSuccess,
  successMessage,
  errorFallback,
  children,
  className,
  resetOnSuccess = false,
  refreshOnSuccess = false,
}: ActionFormProps<T>) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = React.useTransition()

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      try {
        const result = await action(formData)

        if (result.ok) {
          if (result.warning) {
            notify.warning(result.warning)
          } else if (successMessage ?? result.message) {
            notify.success(successMessage ?? result.message!)
          }

          if (resetOnSuccess) {
            formRef.current?.reset()
          }

          if (refreshOnSuccess) {
            router.refresh()
          }

          onSuccess?.(result.data)
        } else {
          notify.userError(result.error ?? errorFallback ?? 'Something went wrong')
        }
      } catch (err) {
        notify.error(err, errorFallback ?? 'Something went wrong')
      }
    })
  }

  return (
    <ActionFormContext.Provider value={{ isPending }}>
      <form ref={formRef} action={handleSubmit} className={className}>
        {children}
      </form>
    </ActionFormContext.Provider>
  )
}
