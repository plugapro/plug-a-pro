import { toast } from 'sonner'

export const notify = {
  success(text: string) {
    toast.success(text)
  },

  error(err: unknown, fallback?: string) {
    const message =
      err instanceof Error ? err.message : (fallback ?? 'Something went wrong')
    toast.error(message)
  },

  info(text: string) {
    toast.info(text)
  },

  warning(text: string) {
    toast.warning(text)
  },

  promise<T>(
    promise: Promise<T>,
    opts: { loading: string; success: string; error: string },
  ) {
    return toast.promise(promise, opts)
  },
}
