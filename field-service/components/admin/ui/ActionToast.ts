import { toast } from 'sonner'

export const notify = {
  success(text: string) {
    toast.success(text)
  },

  error(err: unknown, fallback = 'Something went wrong') {
    console.error('[action error]', err)
    toast.error(fallback)
  },

  /** Use for pre-formatted user-safe messages from server action result.error fields. */
  userError(message: string) {
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
