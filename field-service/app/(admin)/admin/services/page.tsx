// ─── Admin: Job Categories ─────────────────────────────────────────────────────
// Static display of the 8 job categories the platform supports.

export const revalidate = 60

import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Categories', noIndex: true })

const JOB_CATEGORIES = [
  {
    name: 'Plumbing',
    description: 'Pipe repairs, leaks, installations, drain unblocking',
  },
  {
    name: 'Painting',
    description: 'Interior and exterior painting, touch-ups, feature walls',
  },
  {
    name: 'Garden',
    description: 'Lawn mowing, pruning, landscaping, garden maintenance',
  },
  {
    name: 'Handyman',
    description: 'General repairs, assembly, hanging, mounting, odd jobs',
  },
  {
    name: 'Appliances',
    description: 'Appliance installation, repair, and maintenance',
  },
  {
    name: 'Electrical',
    description: 'Fault-finding, light fittings, plug points, DB boards',
  },
  {
    name: 'DIY',
    description: 'Tiling, grouting, small carpentry, shelving',
  },
  {
    name: 'Roofing',
    description: 'Roof leak repairs, tile replacement, waterproofing',
  },
]

export default async function CategoriesPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Categories</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {JOB_CATEGORIES.length} job categories supported on the platform
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {JOB_CATEGORIES.map((cat) => (
          <div
            key={cat.name}
            className="rounded-lg border bg-card p-4 space-y-1"
          >
            <p className="font-semibold text-sm">{cat.name}</p>
            <p className="text-xs text-muted-foreground">{cat.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
