export function normalizeEmailInput(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function normalizePasswordInput(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}
