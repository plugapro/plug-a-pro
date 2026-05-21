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

function mapActionErrorToUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('network') || message.includes('fetch')) {
      return 'Could not reach the server. Check your connection and try again.'
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'The request took too long. Please try again.'
    }
  }

  return fallback
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
  const inFlightRef = React.useRef(false)

  React.useEffect(() => {
    if (!isPending) return

    // Warn before tab close while a mutation is in-flight to reduce accidental duplicate submissions.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isPending])

  const handleSubmit = (formData: FormData) => {
    if (inFlightRef.current || isPending) {
      return
    }

    // Fast-fail when the browser is offline so users get immediate guidance.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      notify.userError('You are offline. Check your connection and try again.')
      return
    }

    inFlightRef.current = true
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
          notify.userError(result.error ?? errorFallback ?? 'Could not save changes. Please try again.')
        }
      } catch (err) {
        notify.error(err, mapActionErrorToUserMessage(err, errorFallback ?? 'Could not save changes. Please try again.'))
      } finally {
        inFlightRef.current = false
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
