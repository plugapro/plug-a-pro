'use client'

import { useMemo, useState } from 'react'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

type Props = {
  initialSkillLabels: string[]
}

export function SkillPicker({ initialSkillLabels }: Props) {
  const initialSelectedTags = useMemo(() => {
    const selected = new Set<string>()
    for (const option of SERVICE_CATEGORY_OPTIONS) {
      if (initialSkillLabels.includes(option.label)) {
        selected.add(option.tag)
      }
    }
    return selected
  }, [initialSkillLabels])

  const [selectedTags, setSelectedTags] = useState<Set<string>>(initialSelectedTags)

  function toggle(tag: string, checked: boolean) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (checked) next.add(tag)
      else next.delete(tag)
      return next
    })
  }

  const selected = SERVICE_CATEGORY_OPTIONS.filter((option) => selectedTags.has(option.tag))

  return (
    <div className="space-y-3">
      {selected.map((option) => (
        <input key={option.tag} type="hidden" name="skillTags" value={option.tag} />
      ))}

      <div className="flex flex-wrap gap-2">
        {selected.length > 0 ? (
          selected.map((option) => (
            <span
              key={option.tag}
              className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium"
            >
              {option.label}
            </span>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            Select the services you offer. At least one skill is required.
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {SERVICE_CATEGORY_OPTIONS.map((option) => (
          <label
            key={option.tag}
            className="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedTags.has(option.tag)}
              onChange={(event) => toggle(option.tag, event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 accent-primary"
            />
            <span className="space-y-1">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
