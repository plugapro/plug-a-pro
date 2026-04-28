export type SignInAccountRole = 'customer' | 'provider'

export async function phoneExistsForSignIn(
  phone: string,
  role: SignInAccountRole,
): Promise<boolean> {
  const response = await fetch('/api/auth/phone-exists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, role }),
  })

  if (!response.ok) {
    throw new Error('Phone lookup failed')
  }

  const data = await response.json() as { exists?: boolean }
  return data.exists === true
}
