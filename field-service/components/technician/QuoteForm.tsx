'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

interface QuoteFormProps {
  matchId: string
  postInspection?: boolean
  category: string
  area: string
  description: string
}

export function QuoteForm({ matchId, postInspection: preChecked = false, category, area, description }: QuoteFormProps) {
  const router = useRouter()
  const [labourCost, setLabourCost] = useState('')
  const [materialsCost, setMaterialsCost] = useState('')
  const [desc, setDesc] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [validFor, setValidFor] = useState('48h')
  const [preferredDate, setPreferredDate] = useState('')
  const [isInspection, setIsInspection] = useState(preChecked)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const labour = parseFloat(labourCost) || 0
  const materials = parseFloat(materialsCost) || 0
  const total = labour + materials

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (labour <= 0) { setError('Labour cost is required'); return }
    if (desc.trim().length < 10) { setError('Description must be at least 10 characters'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/technician/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          labourCost: labour,
          materialsCost: materials,
          description: desc.trim(),
          estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
          validFor,
          preferredDate: preferredDate || undefined,
          postInspection: isInspection,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Failed to submit quote')
      }

      router.push('/technician?quote=sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Job summary (read-only) */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-1">
        <p className="text-sm font-medium">{category}</p>
        <p className="text-xs text-muted-foreground">{area}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
      </div>

      {preChecked && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 px-4 py-3">
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            You marked this as needing an inspection. Submit your quote once you&apos;ve assessed the site.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="labour">Labour cost (R) *</Label>
            <Input
              id="labour"
              type="number"
              min="1"
              step="0.01"
              placeholder="0.00"
              value={labourCost}
              onChange={(e) => setLabourCost(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="materials">Materials (R)</Label>
            <Input
              id="materials"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={materialsCost}
              onChange={(e) => setMaterialsCost(e.target.value)}
            />
          </div>
        </div>

        {total > 0 && (
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">R {total.toFixed(2)}</span>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="desc">Scope of work *</Label>
          <Textarea
            id="desc"
            placeholder="Describe what is included in your quote..."
            rows={4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            required
            minLength={10}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="hours">Estimated hours</Label>
            <Input
              id="hours"
              type="number"
              min="0.5"
              step="0.5"
              placeholder="e.g. 2"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="validFor">Quote valid for</Label>
            <Select value={validFor} onValueChange={setValidFor}>
              <SelectTrigger id="validFor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 hours</SelectItem>
                <SelectItem value="48h">48 hours</SelectItem>
                <SelectItem value="72h">72 hours</SelectItem>
                <SelectItem value="1w">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="preferredDate">Preferred job date</Label>
          <Input
            id="preferredDate"
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="inspection"
            checked={isInspection}
            onCheckedChange={(v) => !preChecked && setIsInspection(v === true)}
            disabled={preChecked}
            className="mt-0.5"
          />
          <Label
            htmlFor="inspection"
            className={`text-sm leading-snug ${preChecked ? 'text-muted-foreground' : 'cursor-pointer'}`}
          >
            {preChecked
              ? 'This quote is submitted after a site inspection'
              : 'I need to inspect the site before finalising this quote'}
          </Label>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Quote to Client'}
        </Button>
      </div>
    </form>
  )
}
