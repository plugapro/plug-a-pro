export type BottomNavAuthRole = 'customer' | 'provider' | 'admin' | 'owner' | null

export type BottomNavAuthStatus = 'loading' | 'signed_out' | 'signed_in'

export interface BottomNavAuthState {
  status: BottomNavAuthStatus
  role: BottomNavAuthRole
}

export interface BottomNavItemLike {
  id: string
  label: string
  href: string
}

export interface BottomNavAccountTarget {
  label: string
  href: string
}

export function pathRequiresAuthenticatedAccount(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function resolveBottomNavAccountItem<T extends BottomNavItemLike>(
  item: T,
  params: {
    accountItemId: string
    auth: BottomNavAuthState
    pathname: string
    protectedPathPrefixes: string[]
    signedOutTarget: BottomNavAccountTarget
    signedInCustomerTarget: BottomNavAccountTarget
    signedInProviderTarget?: BottomNavAccountTarget
    loadingTarget?: BottomNavAccountTarget
  },
): T {
  if (item.id !== params.accountItemId) return item

  const signedInTarget = params.auth.role === 'provider' && params.signedInProviderTarget
    ? params.signedInProviderTarget
    : params.signedInCustomerTarget

  if (params.auth.status === 'signed_in') {
    return {
      ...item,
      label: signedInTarget.label,
      href: signedInTarget.href,
    }
  }

  if (params.auth.status === 'signed_out') {
    return {
      ...item,
      label: params.signedOutTarget.label,
      href: params.signedOutTarget.href,
    }
  }

  const isProtectedRoute = pathRequiresAuthenticatedAccount(params.pathname, params.protectedPathPrefixes)
  if (isProtectedRoute) {
    const loadingTarget = params.loadingTarget ?? {
      label: 'Account',
      href: params.signedInCustomerTarget.href,
    }
    return {
      ...item,
      label: loadingTarget.label,
      href: loadingTarget.href,
    }
  }

  return {
    ...item,
    label: params.signedOutTarget.label,
    href: params.signedOutTarget.href,
  }
}
