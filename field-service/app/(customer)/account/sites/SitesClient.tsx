'use client'

// ─── Client components for /account/sites ─────────────────────────────────────
// Handles form state, add/edit dialogs and delete/set-default interactions.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Badge }    from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  createCustomerSiteAction,
  updateCustomerSiteAction,
  deleteCustomerSiteAction,
  setDefaultCustomerSiteAction,
  type SiteInput,
} from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteRow {
  id:         string
  label:      string | null
  street:     string
  suburb:     string
  city:       string
  province:   string
  postalCode: string | null
  isDefault:  boolean
}

// ─── Blank form state ─────────────────────────────────────────────────────────

const EMPTY: SiteInput = {
  label:      '',
  street:     '',
  suburb:     '',
  city:       '',
  province:   '',
  postalCode: '',
}

// ─── Site form (shared for add and edit) ─────────────────────────────────────

function SiteForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial:     SiteInput
  onSubmit:    (data: SiteInput) => Promise<void>
  onCancel:    () => void
  submitLabel: string
}) {
  const [values, setValues] = useState<SiteInput>(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function set(field: keyof SiteInput) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await onSubmit(values)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2">
          {error}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="label" className="text-sm">Site label <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="label" value={values.label ?? ''} onChange={set('label')} placeholder="e.g. Home, Office, Site A" className="h-9" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="street" className="text-sm">Street address <span className="text-destructive">*</span></Label>
        <Input id="street" value={values.street} onChange={set('street')} placeholder="12 Main Road" required className="h-9" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="suburb" className="text-sm">Suburb <span className="text-destructive">*</span></Label>
          <Input id="suburb" value={values.suburb} onChange={set('suburb')} placeholder="Sandton" required className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city" className="text-sm">City <span className="text-destructive">*</span></Label>
          <Input id="city" value={values.city} onChange={set('city')} placeholder="Johannesburg" required className="h-9" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="province" className="text-sm">Province <span className="text-destructive">*</span></Label>
          <Input id="province" value={values.province} onChange={set('province')} placeholder="Gauteng" required className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode" className="text-sm">Postal code</Label>
          <Input id="postalCode" value={values.postalCode ?? ''} onChange={set('postalCode')} placeholder="2196" className="h-9" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ─── Add site dialog ──────────────────────────────────────────────────────────

export function AddSiteDialog() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleAdd(data: SiteInput) {
    await createCustomerSiteAction(data)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">Add new site</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new site</DialogTitle>
        </DialogHeader>
        <SiteForm
          initial={EMPTY}
          onSubmit={handleAdd}
          onCancel={() => setOpen(false)}
          submitLabel="Add site"
        />
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit site dialog ─────────────────────────────────────────────────────────

export function EditSiteDialog({ site }: { site: SiteRow }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleEdit(data: SiteInput) {
    await updateCustomerSiteAction(site.id, data)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit site</DialogTitle>
        </DialogHeader>
        <SiteForm
          initial={{
            label:      site.label ?? '',
            street:     site.street,
            suburb:     site.suburb,
            city:       site.city,
            province:   site.province,
            postalCode: site.postalCode ?? '',
          }}
          onSubmit={handleEdit}
          onCancel={() => setOpen(false)}
          submitLabel="Save changes"
        />
      </DialogContent>
    </Dialog>
  )
}

// ─── Site card (row with actions) ─────────────────────────────────────────────

export function SiteCard({ site }: { site: SiteRow }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleSetDefault() {
    if (site.isDefault) return
    startTransition(async () => {
      try {
        await setDefaultCustomerSiteAction(site.id)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update default')
      }
    })
  }

  function handleDelete() {
    if (!confirm(`Delete "${site.label ?? site.suburb}"? This cannot be undone.`)) return
    startTransition(async () => {
      try {
        await deleteCustomerSiteAction(site.id)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete site')
      }
    })
  }

  const displayName = site.label ?? site.suburb

  return (
    <Card>
      <CardContent className="px-4 py-4 space-y-3">
        {error && (
          <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="font-medium">{displayName}</p>
              {site.isDefault && (
                <Badge variant="secondary" className="text-xs">Default</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {site.street}, {site.suburb}
            </p>
            <p className="text-sm text-muted-foreground">
              {site.city}, {site.province}
              {site.postalCode ? `, ${site.postalCode}` : ''}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <EditSiteDialog site={site} />

          {!site.isDefault && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSetDefault}
              disabled={pending}
            >
              {pending ? 'Updating…' : 'Set as default'}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
