function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function lastFour(value: string): string {
  return digitsOnly(value).slice(-4)
}

export function maskIdNumber(value: string): string {
  const digits = digitsOnly(value)
  if (!digits) return ''

  const visibleDigits = lastFour(digits)
  const hiddenLength = Math.max(0, digits.length - visibleDigits.length)

  return `${'*'.repeat(hiddenLength)}${visibleDigits}`
}
