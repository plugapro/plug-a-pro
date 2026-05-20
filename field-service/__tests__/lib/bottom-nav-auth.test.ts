import { describe, expect, it } from 'vitest'
import { resolveBottomNavAccountItem } from '@/lib/bottom-nav-auth'

const baseItem = {
  id: 'account',
  label: 'Sign in',
  href: '/sign-in',
}

describe('bottom nav auth account resolution', () => {
  it('keeps Sign in for signed-out users', () => {
    const result = resolveBottomNavAccountItem(baseItem, {
      accountItemId: 'account',
      auth: { status: 'signed_out', role: null },
      pathname: '/',
      protectedPathPrefixes: ['/bookings', '/profile'],
      signedOutTarget: { label: 'Sign in', href: '/sign-in' },
      signedInCustomerTarget: { label: 'Profile', href: '/profile' },
      signedInProviderTarget: { label: 'Profile', href: '/provider/profile' },
      loadingTarget: { label: 'Account', href: '/profile' },
    })

    expect(result.label).toBe('Sign in')
    expect(result.href).toBe('/sign-in')
  })

  it('uses authenticated destination for signed-in customer', () => {
    const result = resolveBottomNavAccountItem(baseItem, {
      accountItemId: 'account',
      auth: { status: 'signed_in', role: 'customer' },
      pathname: '/bookings',
      protectedPathPrefixes: ['/bookings', '/profile'],
      signedOutTarget: { label: 'Sign in', href: '/sign-in' },
      signedInCustomerTarget: { label: 'Profile', href: '/profile' },
      signedInProviderTarget: { label: 'Profile', href: '/provider/profile' },
      loadingTarget: { label: 'Account', href: '/profile' },
    })

    expect(result.label).toBe('Profile')
    expect(result.href).toBe('/profile')
  })

  it('shows neutral account state while loading on protected routes', () => {
    const result = resolveBottomNavAccountItem(baseItem, {
      accountItemId: 'account',
      auth: { status: 'loading', role: null },
      pathname: '/bookings',
      protectedPathPrefixes: ['/bookings', '/profile'],
      signedOutTarget: { label: 'Sign in', href: '/sign-in' },
      signedInCustomerTarget: { label: 'Profile', href: '/profile' },
      signedInProviderTarget: { label: 'Profile', href: '/provider/profile' },
      loadingTarget: { label: 'Account', href: '/profile' },
    })

    expect(result.label).toBe('Account')
    expect(result.href).toBe('/profile')
  })

  it('returns to Sign in after logout transition', () => {
    const signedIn = resolveBottomNavAccountItem(baseItem, {
      accountItemId: 'account',
      auth: { status: 'signed_in', role: 'customer' },
      pathname: '/profile',
      protectedPathPrefixes: ['/bookings', '/profile'],
      signedOutTarget: { label: 'Sign in', href: '/sign-in' },
      signedInCustomerTarget: { label: 'Profile', href: '/profile' },
      signedInProviderTarget: { label: 'Profile', href: '/provider/profile' },
      loadingTarget: { label: 'Account', href: '/profile' },
    })

    const signedOut = resolveBottomNavAccountItem(baseItem, {
      accountItemId: 'account',
      auth: { status: 'signed_out', role: null },
      pathname: '/profile',
      protectedPathPrefixes: ['/bookings', '/profile'],
      signedOutTarget: { label: 'Sign in', href: '/sign-in' },
      signedInCustomerTarget: { label: 'Profile', href: '/profile' },
      signedInProviderTarget: { label: 'Profile', href: '/provider/profile' },
      loadingTarget: { label: 'Account', href: '/profile' },
    })

    expect(signedIn.label).toBe('Profile')
    expect(signedOut.label).toBe('Sign in')
    expect(signedOut.href).toBe('/sign-in')
  })
})
