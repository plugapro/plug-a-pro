'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog, DestructiveConfirmDialog } from '@/components/admin/crud'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CategoryAdminRecord } from '@/lib/category-config'
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  updateCategoryRiskTierAction,
} from './actions'

type Props = {
  categories: CategoryAdminRecord[]
  crudEnabled: boolean
  riskTierEnabled: boolean
}

type CategoryDraft = {
  slug: string
  label: string
  description: string
  active: boolean
  regulated: boolean
  bookingOnAssignment: boolean
  sortOrder: number
  requiredCertifications: string
  requiredEquipment: string
  requiredVehicleTypes: string
}

function draftFromCategory(category: CategoryAdminRecord): CategoryDraft {
  return {
    slug: category.slug,
    label: category.label,
    description: category.description ?? '',
    active: category.active,
    regulated: category.regulated,
    bookingOnAssignment: category.bookingOnAssignment,
    sortOrder: category.sortOrder,
    requiredCertifications: category.requiredCertifications.map((entry) => entry.code).join('\n'),
    requiredEquipment: category.requiredEquipment.map((entry) => entry.tag).join('\n'),
    requiredVehicleTypes: category.requiredVehicleTypes.map((entry) => entry.vehicleType).join('\n'),
  }
}

const EMPTY_DRAFT: CategoryDraft = {
  slug: '',
  label: '',
  description: '',
  active: true,
  regulated: false,
  bookingOnAssignment: false,
  sortOrder: 0,
  requiredCertifications: '',
  requiredEquipment: '',
  requiredVehicleTypes: '',
}

export function CategoriesClient({ categories, crudEnabled, riskTierEnabled }: Props) {
  const router = useRouter()
  const [creating, startCreateTransition] = React.useTransition()
  const [newDraft, setNewDraft] = React.useState<CategoryDraft>(EMPTY_DRAFT)

  const handleCreate = () => {
    startCreateTransition(async () => {
      try {
        await createCategoryAction(newDraft)
        toast.success('Category created.')
        setNewDraft(EMPTY_DRAFT)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create category.')
      }
    })
  }

  return (
    <div className="space-y-6">
      {crudEnabled ? (
        <CategoryFormCard
          title="Create category"
          description="DB-backed categories now drive matcher requirements when present. Slugs remain the compatibility key."
          draft={newDraft}
          onDraftChange={setNewDraft}
          onSubmit={handleCreate}
          submitLabel="Create category"
          loading={creating}
        />
      ) : (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          Category mutations are disabled. Enable the <code>admin.crud.categories</code> feature flag to create, edit, or delete category config.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            crudEnabled={crudEnabled}
            riskTierEnabled={riskTierEnabled}
          />
        ))}
      </div>
    </div>
  )
}

function RiskTierCell({
  categoryId,
  currentTier,
  crudEnabled,
}: {
  categoryId: string
  currentTier: 'LOW' | 'STANDARD'
  crudEnabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const applyChange = (tier: 'LOW' | 'STANDARD') => {
    startTransition(async () => {
      try {
        const result = await updateCategoryRiskTierAction({ categoryId, riskTier: tier })
        if (result.data.bulkApproved > 0) {
          toast.success(`Risk tier set to LOW. ${result.data.bulkApproved} provider category row(s) auto-approved.`)
        } else {
          toast.success('Risk tier updated.')
        }
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update risk tier.')
      }
    })
  }

  const handleChange = (value: string) => {
    const tier = value as 'LOW' | 'STANDARD'
    if (tier === currentTier) return
    if (tier === 'LOW') {
      setConfirmOpen(true)
      return
    }
    applyChange('STANDARD')
  }

  if (!crudEnabled) {
    return (
      <span className="text-xs text-muted-foreground font-mono px-1">
        {currentTier}
      </span>
    )
  }

  return (
    <>
      <Select value={currentTier} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger className="h-6 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="STANDARD">STANDARD</SelectItem>
          <SelectItem value="LOW">LOW</SelectItem>
        </SelectContent>
      </Select>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change to LOW risk?"
        description="Changing this category to LOW risk will auto-approve it for all currently active providers awaiting review. This takes effect immediately."
        confirmLabel="Yes, set to LOW"
        variant="destructive"
        onConfirm={() => {
          setConfirmOpen(false)
          applyChange('LOW')
        }}
      />
    </>
  )
}

function CategoryCard({
  category,
  crudEnabled,
  riskTierEnabled,
}: {
  category: CategoryAdminRecord
  crudEnabled: boolean
  riskTierEnabled: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = React.useState<CategoryDraft>(() => draftFromCategory(category))
  const [saving, startSaveTransition] = React.useTransition()
  const [deleting, startDeleteTransition] = React.useTransition()
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  // Avoid set-state-in-effect lint false-positive for prop-to-state sync.
  // The draft intentionally resets when category props change after a server refresh.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(draftFromCategory(category))
  }, [category])

  const handleSave = () => {
    startSaveTransition(async () => {
      try {
        await updateCategoryAction({
          categoryId: category.id,
          ...draft,
        })
        toast.success(`Saved ${draft.label}.`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save category.')
      }
    })
  }

  const handleDelete = async () => {
    startDeleteTransition(async () => {
      try {
        await deleteCategoryAction({ categoryId: category.id })
        toast.success(`Deleted ${category.label}.`)
        setDeleteOpen(false)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete category.')
      }
    })
  }

  return (
    <>
      <CategoryFormCard
        title={category.label}
        description={category.slug}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={handleSave}
        submitLabel="Save changes"
        loading={saving}
        badges={(
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={category.active ? 'secondary' : 'outline'} className="rounded-full">
              {category.active ? 'Active' : 'Inactive'}
            </Badge>
            {category.regulated && (
              <Badge variant="outline" className="rounded-full">Regulated</Badge>
            )}
            {riskTierEnabled && (
              <RiskTierCell
                categoryId={category.id}
                currentTier={category.riskTier}
                crudEnabled={crudEnabled}
              />
            )}
          </div>
        )}
        disabled={!crudEnabled}
        footer={crudEnabled ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            Delete
          </Button>
        ) : null}
      />

      <DestructiveConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${category.label}?`}
        description="This removes the category and all DB-backed requirement rows. The legacy policy fallback may still apply for the same slug until it is removed from code."
        confirmText={category.slug}
        confirmLabel="Delete category"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </>
  )
}

function CategoryFormCard({
  title,
  description,
  draft,
  onDraftChange,
  onSubmit,
  submitLabel,
  loading,
  badges,
  disabled = false,
  footer,
}: {
  title: string
  description?: string
  draft: CategoryDraft
  onDraftChange: React.Dispatch<React.SetStateAction<CategoryDraft>>
  onSubmit: () => void
  submitLabel: string
  loading: boolean
  badges?: React.ReactNode
  disabled?: boolean
  footer?: React.ReactNode
}) {
  const setField = <K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]) => {
    onDraftChange((current) => ({ ...current, [key]: value }))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground font-mono">{description}</p>
            )}
          </div>
          {badges}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <LabeledField label="Slug">
            <Input
              value={draft.slug}
              onChange={(event) => setField('slug', event.target.value)}
              disabled={disabled || loading}
            />
          </LabeledField>
          <LabeledField label="Label">
            <Input
              value={draft.label}
              onChange={(event) => setField('label', event.target.value)}
              disabled={disabled || loading}
            />
          </LabeledField>
          <div className="md:col-span-2">
            <LabeledField label="Description">
              <Textarea
                value={draft.description}
                onChange={(event) => setField('description', event.target.value)}
                disabled={disabled || loading}
              />
            </LabeledField>
          </div>
          <LabeledField label="Sort order">
            <Input
              type="number"
              min={0}
              value={draft.sortOrder}
              onChange={(event) => setField('sortOrder', Number(event.target.value || 0))}
              disabled={disabled || loading}
            />
          </LabeledField>
          <div className="grid gap-3">
            <CheckboxField
              label="Active"
              checked={draft.active}
              onCheckedChange={(checked) => setField('active', checked)}
              disabled={disabled || loading}
            />
            <CheckboxField
              label="Regulated"
              checked={draft.regulated}
              onCheckedChange={(checked) => setField('regulated', checked)}
              disabled={disabled || loading}
            />
            <CheckboxField
              label="Booking on assignment"
              checked={draft.bookingOnAssignment}
              onCheckedChange={(checked) => setField('bookingOnAssignment', checked)}
              disabled={disabled || loading}
            />
          </div>
          <LabeledField label="Required certifications">
            <Textarea
              value={draft.requiredCertifications}
              onChange={(event) => setField('requiredCertifications', event.target.value)}
              placeholder="wireman&#10;electrical_coc"
              disabled={disabled || loading}
            />
          </LabeledField>
          <LabeledField label="Required equipment">
            <Textarea
              value={draft.requiredEquipment}
              onChange={(event) => setField('requiredEquipment', event.target.value)}
              placeholder="drain_snake&#10;pipe_freezer"
              disabled={disabled || loading}
            />
          </LabeledField>
          <LabeledField label="Required vehicle types">
            <Textarea
              value={draft.requiredVehicleTypes}
              onChange={(event) => setField('requiredVehicleTypes', event.target.value)}
              placeholder="van&#10;bakkie"
              disabled={disabled || loading}
            />
          </LabeledField>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {footer ?? <span />}
          <Button type="button" size="sm" onClick={onSubmit} disabled={disabled || loading}>
            {loading ? 'Working…' : submitLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LabeledField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        disabled={disabled}
        id={label}
      />
      <Label htmlFor={label}>{label}</Label>
    </div>
  )
}
