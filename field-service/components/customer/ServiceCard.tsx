import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

interface ServiceCategory {
  slug: string
  name: string
  description?: string
}

interface Props {
  category: ServiceCategory
}

export function ServiceCard({ category }: Props) {
  return (
    <Link
      href={`/book/${category.slug}`}
      className="flex items-center justify-between rounded-xl border bg-card p-4 hover:bg-accent/50 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate">{category.name}</p>
        {category.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {category.description}
          </p>
        )}
      </div>
      <div className="ml-4 text-right shrink-0 space-y-1">
        <Badge variant="secondary" className="text-xs font-semibold">
          Get a quote
        </Badge>
        <p className="text-xs text-muted-foreground mt-0.5">Book →</p>
      </div>
    </Link>
  )
}
