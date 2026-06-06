'use client'

// TODO: replace text URL input with Vercel Blob client upload in follow-on PR
import { useFormContext, useController } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export function EvidenceSection() {
  const { control, formState: { errors } } = useFormContext<{ evidenceFileUrls?: string[] }>()
  const { field } = useController({ name: 'evidenceFileUrls', control, defaultValue: [] })

  function clear() {
    field.onChange([])
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Supporting evidence</legend>
      <div>
        <Label htmlFor="evidenceFileUrls">Evidence URL (portfolio, certificates, etc.)</Label>
        <Input
          id="evidenceFileUrls"
          type="url"
          placeholder="https://…"
          onChange={(e) => field.onChange(e.target.value ? [e.target.value] : [])}
          value={(field.value as string[])?.[0] ?? ''}
        />
        <p className="mt-1 text-xs text-muted-foreground">Paste a public URL. Direct upload coming soon.</p>
        {errors.evidenceFileUrls && <p className="mt-1 text-xs text-destructive">{String(errors.evidenceFileUrls.message)}</p>}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={clear} className="text-xs text-muted-foreground">
        Skip evidence for now
      </Button>
    </fieldset>
  )
}
