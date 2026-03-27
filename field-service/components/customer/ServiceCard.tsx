import Link from 'next/link'
import type { Service } from '@prisma/client'
import { formatCurrency } from '@/lib/payments'
import { Badge } from '@/components/ui/badge'

interface Props {
  service: Service
}

export function ServiceCard({ service }: Props) {
  const priceLabel =
    service.pricingType === 'FIXED' && service.basePrice
      ? `From ${formatCurrency(Number(service.basePrice))}`
      : 'Quote required'

  return (
    <Link
      href={`/book/${service.id}`}
      className="flex items-center justify-between rounded-xl border bg-card p-4 hover:bg-accent/50 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate">{service.name}</p>
        {service.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {service.description}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          ~{service.duration} min
        </p>
      </div>
      <div className="ml-4 text-right shrink-0 space-y-1">
        <Badge variant="secondary" className="text-xs font-semibold">
          {priceLabel}
        </Badge>
        <p className="text-xs text-muted-foreground mt-0.5">Book →</p>
      </div>
    </Link>
  )
}
