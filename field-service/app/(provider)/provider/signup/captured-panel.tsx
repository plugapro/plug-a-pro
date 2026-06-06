'use client'

import { useState } from 'react'

export function CapturedPanel({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const captured = summarise(data)
  if (captured.length === 0) return null

  return (
    <section className="mb-4 rounded border bg-muted/30 p-3 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between font-medium">
        <span>Already captured ({captured.length} field{captured.length === 1 ? '' : 's'})</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {captured.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function summarise(data: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  if (typeof data.name === 'string' && data.name.trim()) out.push({ label: 'Name', value: data.name })
  if (typeof data.idNumber === 'string' && data.idNumber.trim()) out.push({ label: 'ID', value: `••• ${data.idNumber.slice(-4)}` })
  if (Array.isArray(data.skills) && data.skills.length) out.push({ label: 'Skills', value: (data.skills as string[]).join(', ') })
  if (typeof data.regionLabel === 'string') out.push({ label: 'Region', value: data.regionLabel })
  if (typeof data.cityLabel === 'string') out.push({ label: 'City', value: data.cityLabel })
  if (Array.isArray(data.availability) && data.availability.length) out.push({ label: 'Availability', value: (data.availability as string[]).join(', ') })
  if (typeof data.hourlyRate === 'number') out.push({ label: 'Rate', value: `R${data.hourlyRate}/hr` })
  if (typeof data.profilePhotoUrl === 'string') out.push({ label: 'Photo', value: '✓ uploaded' })
  if (typeof data.bio === 'string' && data.bio.trim()) out.push({ label: 'Bio', value: `${data.bio.slice(0, 40)}…` })
  if (Array.isArray(data.evidenceFileUrls) && data.evidenceFileUrls.length) out.push({ label: 'Evidence', value: `${(data.evidenceFileUrls as string[]).length} file(s)` })
  return out
}
