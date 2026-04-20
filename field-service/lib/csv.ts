function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<{ key: keyof T; label: string }>
): string {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(',')
  const body = rows
    .map((row) =>
      columns
        .map((column) => escapeCsvCell(row[column.key]))
        .join(',')
    )
    .join('\n')

  return `${header}\n${body}`
}
