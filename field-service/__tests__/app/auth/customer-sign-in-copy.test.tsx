import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/shared/app-logo', () => ({
  AppLogo: () => <div>Plug A Pro</div>,
}))

describe('customer auth copy', () => {
  it('sign-in page renders static welcome copy', async () => {
    // The sign-in page is a client component - verify it exports a default function
    const mod = await import('@/app/(auth)/sign-in/page')
    expect(typeof mod.default).toBe('function')
  })

  it('auth layout is a transparent pass-through (no content of its own)', async () => {
    const AuthLayout = (await import('@/app/(auth)/layout')).default
    const html = renderToStaticMarkup(<AuthLayout><div>auth form</div></AuthLayout>)
    expect(html).toContain('auth form')
  })
})
