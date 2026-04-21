export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { listCategoriesForAdmin } from '@/lib/category-config'
import { CategoriesClient } from './categories-client'

export const metadata = buildMetadata({ title: 'Categories', noIndex: true })

export default async function CategoriesPage() {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.categories', { userId: actor.id })
  const categories = await listCategoriesForAdmin()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Categories now resolve from the database when present, with the legacy policy file retained as a compatibility fallback.
        </p>
      </div>

      <CategoriesClient categories={categories} crudEnabled={crudEnabled} />
    </div>
  )
}
